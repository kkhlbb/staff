/**
 * MIC (Method of Influence Coefficients) Engine for Cunlian M4 Track F2.
 *
 * Pure ESM JS with zero external dependencies.
 * Implements:
 * - Strict MicMatrixPayloadV1 validation (matching src/project-file/assembly3d.ts)
 * - Vectorized Float64Array batch evaluation: Δu_i = [S] · (Δv_0 + Δv_i)
 * - Frozen PartDisplacementField generation for 3D heatmap & animation
 * - Canonical UTF-8 JSON + SHA-256 'mic-matrix' attachment preparation
 */

const MAX_ID_LENGTH = 200
const TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'partId',
  'units',
  'forceUnits',
  'controlPointsMm',
  'measurePointsMm',
  'sensitivityMatrix',
  'sourceMeta',
])
const SOURCE_META_KEYS = new Set(['solverName', 'meshNodes', 'generatedAtIso'])
const ISO_DATETIME_OFFSET_RE =
  /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|(?:[+-](?:[01]\d|2[0-3]):[0-5]\d)))$/

export class MicValidationError extends Error {
  constructor(code, message, path = []) {
    super(message)
    this.name = 'MicValidationError'
    this.code = code
    this.path = path
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertIdString(value, path) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_ID_LENGTH) {
    throw new MicValidationError(
      'MIC_INVALID_FIELD',
      `Expected non-empty string (1..${MAX_ID_LENGTH} chars) at ${path.join('.')}`,
      path,
    )
  }
}

function assertFiniteNumber(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MicValidationError(
      'MIC_NON_FINITE_NUMBER',
      `Expected finite number at ${path.join('.')}`,
      path,
    )
  }
}

function validatePointList(points, fieldName) {
  if (!Array.isArray(points)) {
    throw new MicValidationError('MIC_INVALID_FIELD', `Expected array at ${fieldName}`, [fieldName])
  }
  const flat = new Float64Array(points.length * 3)
  const clean = new Array(points.length)
  for (let i = 0; i < points.length; i++) {
    const pt = points[i]
    if (!Array.isArray(pt) || pt.length !== 3) {
      throw new MicValidationError(
        'MIC_INVALID_POINT',
        `Expected 3D coordinate tuple [x, y, z] at ${fieldName}[${i}]`,
        [fieldName, i],
      )
    }
    const x = pt[0]
    const y = pt[1]
    const z = pt[2]
    assertFiniteNumber(x, [fieldName, i, 0])
    assertFiniteNumber(y, [fieldName, i, 1])
    assertFiniteNumber(z, [fieldName, i, 2])
    const base = i * 3
    flat[base] = x
    flat[base + 1] = y
    flat[base + 2] = z
    clean[i] = [x, y, z]
  }
  return { clean, flat }
}

/**
 * Parse and strictly validate a MicMatrixPayloadV1 from JSON string, UTF-8 bytes, or plain object.
 * Returns a compiled MIC descriptor with flat Float64Array buffers for high-speed evaluation.
 */
export function parseAndValidateMicMatrix(raw) {
  let obj = raw
  if (raw instanceof Uint8Array) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(raw)
      obj = JSON.parse(text)
    } catch (error) {
      throw new MicValidationError(
        'MIC_INVALID_JSON',
        `MIC attachment must be valid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  } else if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch (error) {
      throw new MicValidationError(
        'MIC_INVALID_JSON',
        `MIC payload must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  if (!isPlainObject(obj)) {
    throw new MicValidationError('MIC_INVALID_OBJECT', 'MIC payload must be a JSON object')
  }

  for (const key of Object.keys(obj)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      throw new MicValidationError('MIC_UNEXPECTED_KEY', `Unexpected property "${key}" in MIC payload`, [key])
    }
  }

  if (obj.schemaVersion !== 1) {
    throw new MicValidationError('MIC_UNSUPPORTED_VERSION', 'Expected schemaVersion === 1', ['schemaVersion'])
  }
  assertIdString(obj.partId, ['partId'])
  if (obj.units !== 'mm') {
    throw new MicValidationError('MIC_INVALID_UNITS', 'Expected units === "mm"', ['units'])
  }
  if (obj.forceUnits !== 'N') {
    throw new MicValidationError('MIC_INVALID_UNITS', 'Expected forceUnits === "N"', ['forceUnits'])
  }

  const control = validatePointList(obj.controlPointsMm, 'controlPointsMm')
  const measure = validatePointList(obj.measurePointsMm, 'measurePointsMm')
  const rows = measure.clean.length
  const cols = control.clean.length

  if (!Array.isArray(obj.sensitivityMatrix)) {
    throw new MicValidationError('MIC_INVALID_MATRIX', 'Expected sensitivityMatrix to be an array', ['sensitivityMatrix'])
  }
  if (obj.sensitivityMatrix.length !== rows) {
    throw new MicValidationError(
      'MIC_DIMENSION_MISMATCH',
      `Expected ${rows} matrix rows (matching measurePointsMm.length), got ${obj.sensitivityMatrix.length}`,
      ['sensitivityMatrix'],
    )
  }

  const flatMatrix = new Float64Array(rows * cols)
  const cleanMatrix = new Array(rows)
  for (let r = 0; r < rows; r++) {
    const row = obj.sensitivityMatrix[r]
    if (!Array.isArray(row) || row.length !== cols) {
      throw new MicValidationError(
        'MIC_DIMENSION_MISMATCH',
        `Expected ${cols} columns at sensitivityMatrix[${r}] (matching controlPointsMm.length), got ${Array.isArray(row) ? row.length : typeof row}`,
        ['sensitivityMatrix', r],
      )
    }
    const cleanRow = new Array(cols)
    const rowOffset = r * cols
    for (let c = 0; c < cols; c++) {
      const value = row[c]
      assertFiniteNumber(value, ['sensitivityMatrix', r, c])
      flatMatrix[rowOffset + c] = value
      cleanRow[c] = value
    }
    cleanMatrix[r] = cleanRow
  }

  let cleanSourceMeta
  if (obj.sourceMeta !== undefined) {
    if (!isPlainObject(obj.sourceMeta)) {
      throw new MicValidationError('MIC_INVALID_FIELD', 'Expected sourceMeta to be an object', ['sourceMeta'])
    }
    for (const key of Object.keys(obj.sourceMeta)) {
      if (!SOURCE_META_KEYS.has(key)) {
        throw new MicValidationError(
          'MIC_UNEXPECTED_KEY',
          `Unexpected property "${key}" in sourceMeta`,
          ['sourceMeta', key],
        )
      }
    }
    assertIdString(obj.sourceMeta.solverName, ['sourceMeta', 'solverName'])
    cleanSourceMeta = { solverName: obj.sourceMeta.solverName }
    if (obj.sourceMeta.meshNodes !== undefined) {
      if (!Number.isSafeInteger(obj.sourceMeta.meshNodes) || obj.sourceMeta.meshNodes < 0) {
        throw new MicValidationError(
          'MIC_INVALID_FIELD',
          'Expected sourceMeta.meshNodes to be a non-negative integer',
          ['sourceMeta', 'meshNodes'],
        )
      }
      cleanSourceMeta.meshNodes = obj.sourceMeta.meshNodes
    }
    if (obj.sourceMeta.generatedAtIso !== undefined) {
      if (
        typeof obj.sourceMeta.generatedAtIso !== 'string' ||
        !ISO_DATETIME_OFFSET_RE.test(obj.sourceMeta.generatedAtIso)
      ) {
        throw new MicValidationError(
          'MIC_INVALID_FIELD',
          'Expected sourceMeta.generatedAtIso to be an ISO-8601 datetime with timezone offset',
          ['sourceMeta', 'generatedAtIso'],
        )
      }
      cleanSourceMeta.generatedAtIso = obj.sourceMeta.generatedAtIso
    }
  }

  const payload = {
    schemaVersion: 1,
    partId: obj.partId,
    units: 'mm',
    forceUnits: 'N',
    controlPointsMm: control.clean,
    measurePointsMm: measure.clean,
    sensitivityMatrix: cleanMatrix,
    ...(cleanSourceMeta !== undefined ? { sourceMeta: cleanSourceMeta } : {}),
  }

  return {
    payload,
    rows,
    cols,
    matrix: flatMatrix,
    controlPoints: control.flat,
    measurePoints: measure.flat,
  }
}

function ensureCompiledMic(mic) {
  if (
    mic &&
    typeof mic === 'object' &&
    mic.matrix instanceof Float64Array &&
    mic.payload &&
    Number.isInteger(mic.rows) &&
    Number.isInteger(mic.cols)
  ) {
    return mic
  }
  return parseAndValidateMicMatrix(mic)
}

function normalizeBatchVectors(input, cols, label) {
  if (input instanceof Float64Array || input instanceof Float32Array) {
    if (cols === 0) {
      if (input.length !== 0) {
        throw new MicValidationError('MIC_VECTOR_MISMATCH', `${label} must be empty when controlPointsMm is empty`)
      }
      return { flat: input, sampleCount: 0, isBroadcast: false }
    }
    if (input.length % cols !== 0) {
      throw new MicValidationError(
        'MIC_VECTOR_MISMATCH',
        `${label} length (${input.length}) must be a multiple of control point count (${cols})`,
      )
    }
    return { flat: input, sampleCount: input.length / cols, isBroadcast: false }
  }

  if (!Array.isArray(input)) {
    throw new MicValidationError('MIC_VECTOR_MISMATCH', `${label} must be a Float64Array or array of vectors`)
  }
  if (input.length === 0) {
    return { flat: new Float64Array(0), sampleCount: 0, isBroadcast: false }
  }

  // Single 1D vector shorthand: number[] of length cols
  if (typeof input[0] === 'number') {
    if (input.length !== cols) {
      throw new MicValidationError(
        'MIC_VECTOR_MISMATCH',
        `Expected vector of length ${cols} for ${label}, got ${input.length}`,
      )
    }
    const flat = new Float64Array(cols)
    for (let c = 0; c < cols; c++) {
      const value = input[c]
      if (!Number.isFinite(value)) {
        throw new MicValidationError('MIC_NON_FINITE_NUMBER', `Non-finite entry in ${label}[${c}]`)
      }
      flat[c] = value
    }
    return { flat, sampleCount: 1, isBroadcast: true }
  }

  // Array of sample vectors: Array<ArrayLike<number>>
  const sampleCount = input.length
  const flat = new Float64Array(sampleCount * cols)
  for (let s = 0; s < sampleCount; s++) {
    const vec = input[s]
    if (!vec || typeof vec.length !== 'number' || vec.length !== cols) {
      throw new MicValidationError(
        'MIC_VECTOR_MISMATCH',
        `Expected vector of length ${cols} at ${label}[${s}]`,
      )
    }
    const base = s * cols
    for (let c = 0; c < cols; c++) {
      const value = vec[c]
      if (!Number.isFinite(value)) {
        throw new MicValidationError('MIC_NON_FINITE_NUMBER', `Non-finite entry at ${label}[${s}][${c}]`)
      }
      flat[base + c] = value
    }
  }
  return { flat, sampleCount, isBroadcast: false }
}

/**
 * High-speed vectorized MIC matrix evaluation:
 *   Δu_i = [S] · (Δv_base + Δv_i + Δv_ext_i)
 *
 * Uses a flat row-major Float64Array fast path so 50,000+ Monte Carlo samples
 * complete in well under 500ms.
 *
 * @param {object} mic - Compiled MIC object from parseAndValidateMicMatrix or raw MicMatrixPayloadV1
 * @param {Float64Array|Float32Array|Array<ArrayLike<number>>|number[]} loadVectors - Sample vectors (flat length N*n, array of N vectors, or single vector of length n)
 * @param {object} [options]
 * @param {ArrayLike<number>} [options.initialWarpVector] - Constant base/warp vector Δv_0 (length n) added to every sample
 * @param {Float64Array|Float32Array|Array<ArrayLike<number>>|number[]} [options.externalLoadVectors] - Optional external load perturbation (single length-n vector or N×n batch)
 * @param {Float64Array} [options.out] - Optional pre-allocated output Float64Array (length N*m)
 * @param {boolean} [options.computeStats=false] - Compute per-measure-point mean/stdDev/min/max
 */
export function evaluateMicBatch(mic, loadVectors, options = {}) {
  const compiled = ensureCompiledMic(mic)
  const { rows, cols, matrix, payload } = compiled

  const primary = normalizeBatchVectors(loadVectors, cols, 'loadVectors')
  const sampleCount = primary.sampleCount
  const src = primary.flat

  // Pre-compute constant offset response: u_base = [S] * (initialWarpVector + broadcast externalLoad)
  let baseResponse = null
  let extBatch = null

  const initialWarp = options.initialWarpVector
  if (initialWarp !== undefined && initialWarp !== null) {
    if (typeof initialWarp.length !== 'number' || initialWarp.length !== cols) {
      throw new MicValidationError(
        'MIC_VECTOR_MISMATCH',
        `Expected initialWarpVector of length ${cols}, got ${initialWarp.length}`,
      )
    }
    baseResponse = new Float64Array(rows)
    for (let c = 0; c < cols; c++) {
      if (!Number.isFinite(initialWarp[c])) {
        throw new MicValidationError('MIC_NON_FINITE_NUMBER', `Non-finite entry in initialWarpVector[${c}]`)
      }
    }
    for (let r = 0; r < rows; r++) {
      let sum = 0
      const rowOffset = r * cols
      for (let c = 0; c < cols; c++) {
        sum += matrix[rowOffset + c] * initialWarp[c]
      }
      baseResponse[r] = sum
    }
  }

  if (options.externalLoadVectors !== undefined && options.externalLoadVectors !== null) {
    const ext = normalizeBatchVectors(options.externalLoadVectors, cols, 'externalLoadVectors')
    if (ext.isBroadcast || (ext.sampleCount === 1 && sampleCount > 1)) {
      if (!baseResponse) baseResponse = new Float64Array(rows)
      for (let r = 0; r < rows; r++) {
        let sum = 0
        const rowOffset = r * cols
        for (let c = 0; c < cols; c++) {
          sum += matrix[rowOffset + c] * ext.flat[c]
        }
        baseResponse[r] += sum
      }
    } else if (ext.sampleCount !== sampleCount) {
      throw new MicValidationError(
        'MIC_VECTOR_MISMATCH',
        `externalLoadVectors sampleCount (${ext.sampleCount}) must match loadVectors sampleCount (${sampleCount})`,
      )
    } else {
      extBatch = ext.flat
    }
  }

  const totalOut = sampleCount * rows
  let dst
  if (options.out !== undefined) {
    if (!(options.out instanceof Float64Array) || options.out.length < totalOut) {
      throw new MicValidationError(
        'MIC_OUTPUT_BUFFER',
        `Expected options.out to be a Float64Array with length >= ${totalOut}`,
      )
    }
    dst = options.out
  } else {
    dst = new Float64Array(totalOut)
  }

  // Tight inner loop specialized by whether baseResponse / extBatch are present
  if (rows > 0 && sampleCount > 0) {
    if (extBatch === null && baseResponse === null) {
      for (let s = 0; s < sampleCount; s++) {
        const vOff = s * cols
        const uOff = s * rows
        for (let r = 0; r < rows; r++) {
          const mOff = r * cols
          let acc = 0
          for (let c = 0; c < cols; c++) {
            acc += matrix[mOff + c] * src[vOff + c]
          }
          dst[uOff + r] = acc
        }
      }
    } else if (extBatch === null && baseResponse !== null) {
      for (let s = 0; s < sampleCount; s++) {
        const vOff = s * cols
        const uOff = s * rows
        for (let r = 0; r < rows; r++) {
          const mOff = r * cols
          let acc = baseResponse[r]
          for (let c = 0; c < cols; c++) {
            acc += matrix[mOff + c] * src[vOff + c]
          }
          dst[uOff + r] = acc
        }
      }
    } else if (extBatch !== null && baseResponse === null) {
      for (let s = 0; s < sampleCount; s++) {
        const vOff = s * cols
        const uOff = s * rows
        for (let r = 0; r < rows; r++) {
          const mOff = r * cols
          let acc = 0
          for (let c = 0; c < cols; c++) {
            acc += matrix[mOff + c] * (src[vOff + c] + extBatch[vOff + c])
          }
          dst[uOff + r] = acc
        }
      }
    } else {
      for (let s = 0; s < sampleCount; s++) {
        const vOff = s * cols
        const uOff = s * rows
        for (let r = 0; r < rows; r++) {
          const mOff = r * cols
          let acc = baseResponse[r]
          for (let c = 0; c < cols; c++) {
            acc += matrix[mOff + c] * (src[vOff + c] + extBatch[vOff + c])
          }
          dst[uOff + r] = acc
        }
      }
    }
  }

  const result = {
    partId: payload.partId,
    sampleCount,
    measureCount: rows,
    controlCount: cols,
    displacements: dst,
  }

  if (options.computeStats) {
    const mean = new Float64Array(rows)
    const stdDev = new Float64Array(rows)
    const min = new Float64Array(rows)
    const max = new Float64Array(rows)
    if (sampleCount > 0) {
      for (let r = 0; r < rows; r++) {
        let sum = 0
        let lo = Infinity
        let hi = -Infinity
        for (let s = 0; s < sampleCount; s++) {
          const val = dst[s * rows + r]
          sum += val
          if (val < lo) lo = val
          if (val > hi) hi = val
        }
        const avg = sum / sampleCount
        let sqSum = 0
        for (let s = 0; s < sampleCount; s++) {
          const diff = dst[s * rows + r] - avg
          sqSum += diff * diff
        }
        mean[r] = avg
        stdDev[r] = Math.sqrt(sqSum / sampleCount)
        min[r] = lo
        max[r] = hi
      }
    }
    result.stats = { mean, stdDev, min, max }
  }

  return result
}

function normalizeUnitDirection(dir) {
  if (!Array.isArray(dir) || dir.length !== 3) {
    throw new MicValidationError('MIC_INVALID_DIRECTION', 'Expected direction to be a 3-element vector [dx, dy, dz]')
  }
  const [dx, dy, dz] = dir
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) {
    throw new MicValidationError('MIC_NON_FINITE_NUMBER', 'Direction vector must contain finite numbers')
  }
  const len = Math.hypot(dx, dy, dz)
  if (!(len > 0)) {
    throw new MicValidationError('MIC_INVALID_DIRECTION', 'Direction vector must be non-zero')
  }
  return [dx / len, dy / len, dz / len]
}

/**
 * Build a frozen PartDisplacementField matching src/transport/types.ts for 3D heatmap & animation.
 *
 * Accepts either:
 * - Scalar displacement vector of length m (projected along options.direction, default [0, 0, 1]), OR
 * - Explicit 3D displacement vector of length m * 3 (flat [dx0, dy0, dz0, ...]).
 */
export function buildMicDisplacementField(mic, displacementVector, options = {}) {
  const compiled = ensureCompiledMic(mic)
  const { rows, payload } = compiled

  if (!displacementVector || typeof displacementVector.length !== 'number') {
    throw new MicValidationError('MIC_VECTOR_MISMATCH', 'displacementVector must be an array or TypedArray')
  }

  const isVector3d = rows > 0 && displacementVector.length === rows * 3
  if (!isVector3d && displacementVector.length !== rows) {
    throw new MicValidationError(
      'MIC_VECTOR_MISMATCH',
      `Expected displacementVector of length ${rows} (scalar) or ${rows * 3} (3D), got ${displacementVector.length}`,
    )
  }

  const defaultDir = normalizeUnitDirection(options.direction ?? [0, 0, 1])
  const perPointDirs = options.directions
  if (perPointDirs !== undefined) {
    if (!Array.isArray(perPointDirs) || perPointDirs.length !== rows) {
      throw new MicValidationError(
        'MIC_INVALID_DIRECTION',
        `Expected options.directions to have length ${rows}`,
      )
    }
  }

  let maxDisplacementMm = 0
  let minDisplacementMm = rows > 0 ? Infinity : 0
  const samples = new Array(rows)

  for (let i = 0; i < rows; i++) {
    const pos = payload.measurePointsMm[i]
    let dx
    let dy
    let dz
    if (isVector3d) {
      const base = i * 3
      dx = displacementVector[base]
      dy = displacementVector[base + 1]
      dz = displacementVector[base + 2]
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) {
        throw new MicValidationError('MIC_NON_FINITE_NUMBER', `Non-finite 3D displacement at index ${i}`)
      }
    } else {
      const scalar = displacementVector[i]
      if (!Number.isFinite(scalar)) {
        throw new MicValidationError('MIC_NON_FINITE_NUMBER', `Non-finite scalar displacement at index ${i}`)
      }
      const dir = perPointDirs ? normalizeUnitDirection(perPointDirs[i]) : defaultDir
      dx = scalar * dir[0]
      dy = scalar * dir[1]
      dz = scalar * dir[2]
    }
    const magMm = Math.hypot(dx, dy, dz)
    if (magMm > maxDisplacementMm) maxDisplacementMm = magMm
    if (magMm < minDisplacementMm) minDisplacementMm = magMm
    samples[i] = Object.freeze({
      posMm: Object.freeze([pos[0], pos[1], pos[2]]),
      dispMm: Object.freeze([dx, dy, dz]),
      magMm,
    })
  }

  return Object.freeze({
    partId: payload.partId,
    maxDisplacementMm,
    minDisplacementMm,
    samples: Object.freeze(samples),
  })
}

function canonicalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue)
  }
  if (isPlainObject(value)) {
    const sorted = {}
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) {
        sorted[key] = canonicalizeValue(value[key])
      }
    }
    return sorted
  }
  return value
}

async function computeSha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const view = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * Validate a MIC payload, canonicalize JSON bytes, compute SHA-256, and construct
 * the 'mic-matrix' attachment record + micMatrixRef metadata (preserving EvidenceRef
 * external FEA provenance) ready for import_mic_matrix callers.
 *
 * @param {unknown} rawPayload - Raw MicMatrixPayloadV1 (object, JSON string, or Uint8Array)
 * @param {object} [meta]
 * @param {string} [meta.attachmentId] - Optional immutable project-scoped attachment ID
 * @param {string} [meta.blobKey] - Optional blob key for attachments/<blobKey>.bin
 * @param {string} [meta.fileName] - Display filename (1..200 chars)
 * @param {readonly object[]} [meta.evidence] - EvidenceRef[] external FEA provenance citations
 */
export async function prepareMicAttachment(rawPayload, meta = {}) {
  const compiled = parseAndValidateMicMatrix(rawPayload)
  const canonicalJson = JSON.stringify(canonicalizeValue(compiled.payload))
  const bytes = new TextEncoder().encode(canonicalJson)
  const sha256 = await computeSha256Hex(bytes)

  const attachmentId = meta.attachmentId ?? `mic-${sha256.slice(0, 12)}`
  const blobKey = meta.blobKey ?? `mic-${sha256.slice(0, 16)}`
  const fileName = meta.fileName ?? `${compiled.payload.partId}-mic.json`

  assertIdString(attachmentId, ['meta', 'attachmentId'])
  assertIdString(blobKey, ['meta', 'blobKey'])
  assertIdString(fileName, ['meta', 'fileName'])

  let evidence = []
  if (meta.evidence !== undefined) {
    if (!Array.isArray(meta.evidence) || meta.evidence.length === 0) {
      throw new MicValidationError(
        'MIC_INVALID_EVIDENCE',
        'meta.evidence must be a non-empty array of EvidenceRef records when provided',
        ['meta', 'evidence'],
      )
    }
    for (let i = 0; i < meta.evidence.length; i++) {
      if (!isPlainObject(meta.evidence[i])) {
        throw new MicValidationError(
          'MIC_INVALID_EVIDENCE',
          `meta.evidence[${i}] must be an EvidenceRef object`,
          ['meta', 'evidence', i],
        )
      }
    }
    evidence = meta.evidence.map(ref => structuredClone(ref))
  }

  return {
    micMatrixRef: attachmentId,
    payload: compiled.payload,
    bytes,
    byteSize: bytes.byteLength,
    sha256,
    attachment: {
      kind: 'mic-matrix',
      revisionId: attachmentId,
      blobKey,
      path: `attachments/${blobKey}.bin`,
      sha256,
      byteSize: bytes.byteLength,
    },
    record: {
      id: attachmentId,
      blobKey,
      fileName,
    },
    evidence,
    summary: {
      partId: compiled.payload.partId,
      controlPointCount: compiled.cols,
      measurePointCount: compiled.rows,
      solverName: compiled.payload.sourceMeta?.solverName ?? null,
      meshNodes: compiled.payload.sourceMeta?.meshNodes ?? null,
      generatedAtIso: compiled.payload.sourceMeta?.generatedAtIso ?? null,
    },
  }
}
