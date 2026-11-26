import { BufferGeometry, Float32BufferAttribute, Group, Matrix4, Vector3 } from 'three'
import type { EvidenceRef } from '../../document-extraction/types'
import { createRng } from '../../domain/statistics'
import type { M2CameraState } from './m2WorkbenchBridge'
import {
  IDENTITY_MATRIX_4X4,
  type AiMateDraftItem,
  type AssemblyFeatureSelectionItem,
  type CameraPresetId,
  type ContextPillActionSpec,
  type HistogramBin,
  type ParetoContributionItem,
  type PartMesh,
  type RowMajorMatrix4,
  type SimulationDiagnosticResult,
  type SimulationLoopSpec,
  type VertexColorFieldChannel,
  type VertexDisplacementChannel,
} from './assembly3dTypes'

export const CAMERA_PRESETS: Readonly<Record<CameraPresetId, M2CameraState>> = {
  iso: { yawDeg: 35, pitchDeg: 25, zoomPercent: 100 },
  front: { yawDeg: 0, pitchDeg: 0, zoomPercent: 100 },
  top: { yawDeg: 0, pitchDeg: 85, zoomPercent: 100 },
  right: { yawDeg: 90, pitchDeg: 0, zoomPercent: 100 },
}

export const CAMERA_PRESET_LABELS: Readonly<Record<CameraPresetId, string>> = {
  iso: '等轴',
  front: '前',
  top: '顶',
  right: '右',
}

/** Converts a Schema 11 row-major 4x4 homogeneous transform to a Three.js Matrix4. */
export function rowMajor4x4ToThreeMatrix4(transform: RowMajorMatrix4): Matrix4 {
  const m = new Matrix4()
  m.set(
    transform[0][0],
    transform[0][1],
    transform[0][2],
    transform[0][3],
    transform[1][0],
    transform[1][1],
    transform[1][2],
    transform[1][3],
    transform[2][0],
    transform[2][1],
    transform[2][2],
    transform[2][3],
    transform[3][0],
    transform[3][1],
    transform[3][2],
    transform[3][3],
  )
  return m
}

/** Computes a part's world-space centroid from its nominal transform and local bounds. */
export function computePartWorldCentroid(part: PartMesh): readonly [number, number, number] {
  const local = part.centroid ?? [
    (part.bounds.min[0] + part.bounds.max[0]) / 2,
    (part.bounds.min[1] + part.bounds.max[1]) / 2,
    (part.bounds.min[2] + part.bounds.max[2]) / 2,
  ]
  const m = rowMajor4x4ToThreeMatrix4(part.nominalTransform)
  const v = new Vector3(local[0], local[1], local[2]).applyMatrix4(m)
  return [v.x, v.y, v.z]
}

/** Computes the overall centroid of a multi-part assembly. */
export function computeAssemblyCentroid(
  parts: readonly PartMesh[],
): readonly [number, number, number] {
  if (parts.length === 0) return [0, 0, 0]
  let sx = 0
  let sy = 0
  let sz = 0
  for (const part of parts) {
    const [cx, cy, cz] = computePartWorldCentroid(part)
    sx += cx
    sy += cy
    sz += cz
  }
  return [sx / parts.length, sy / parts.length, sz / parts.length]
}

/**
 * Computes the part's exploded 4x4 Matrix4 transform by linearly translating along its
 * explodeVector or radial direction away from the assembly centroid.
 * Pure matrix operation: zero BufferGeometry re-triangulation.
 */
export function computePartExplodedMatrix4(
  part: PartMesh,
  assemblyCentroid: readonly [number, number, number],
  explosionFactor: number,
  explodeScaleMm = 28,
): Matrix4 {
  const clampedFactor = Number.isFinite(explosionFactor)
    ? Math.max(0, Math.min(1, explosionFactor))
    : 0
  const baseMatrix = rowMajor4x4ToThreeMatrix4(part.nominalTransform)
  if (clampedFactor <= 0) {
    return baseMatrix
  }

  let dirX: number
  let dirY: number
  let dirZ: number
  if (part.explodeVector) {
    dirX = part.explodeVector[0]
    dirY = part.explodeVector[1]
    dirZ = part.explodeVector[2]
  } else {
    const [cx, cy, cz] = computePartWorldCentroid(part)
    dirX = cx - assemblyCentroid[0]
    dirY = cy - assemblyCentroid[1]
    dirZ = cz - assemblyCentroid[2]
    const len = Math.hypot(dirX, dirY, dirZ)
    if (len > 1e-6) {
      dirX /= len
      dirY /= len
      dirZ /= len
    } else {
      dirX = 0
      dirY = 0
      dirZ = 1
    }
  }

  const offset = new Matrix4().makeTranslation(
    dirX * clampedFactor * explodeScaleMm,
    dirY * clampedFactor * explodeScaleMm,
    dirZ * clampedFactor * explodeScaleMm,
  )
  return offset.multiply(baseMatrix)
}

/** Applies a 4x4 transform directly to a THREE.Group without re-triangulating child geometry. */
export function applyPartGroupTransform(group: Group, matrix: Matrix4): void {
  group.matrixAutoUpdate = false
  group.matrix.copy(matrix)
  group.matrixWorldNeedsUpdate = true
}

/** Computes aggregate bounds across all visible parts (including explosion offset). */
export function computeAssemblyBounds(
  parts: readonly PartMesh[],
  explosionFactor: number,
  hiddenPartIds?: ReadonlySet<string>,
): { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] } {
  const activeParts = parts.filter((p) => !hiddenPartIds?.has(p.partId))
  const sourceParts = activeParts.length > 0 ? activeParts : parts
  if (sourceParts.length === 0) {
    return { min: [-10, -10, -10], max: [10, 10, 10] }
  }
  const centroid = computeAssemblyCentroid(parts)
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  const corner = new Vector3()

  for (const part of sourceParts) {
    const matrix = computePartExplodedMatrix4(part, centroid, explosionFactor)
    const { min, max } = part.bounds
    for (const x of [min[0], max[0]]) {
      for (const y of [min[1], max[1]]) {
        for (const z of [min[2], max[2]]) {
          corner.set(x, y, z).applyMatrix4(matrix)
          if (corner.x < minX) minX = corner.x
          if (corner.y < minY) minY = corner.y
          if (corner.z < minZ) minZ = corner.z
          if (corner.x > maxX) maxX = corner.x
          if (corner.y > maxY) maxY = corner.y
          if (corner.z > maxZ) maxZ = corner.z
        }
      }
    }
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  }
}

/** M4 pre-wired pure updater: writes vertexColors channel onto a BufferGeometry in-place. */
export function applyVertexColorField(
  geometry: BufferGeometry,
  channel: VertexColorFieldChannel,
): boolean {
  const posAttr = geometry.getAttribute('position')
  if (!posAttr) return false
  const expectedLength = posAttr.count * 3
  if (channel.colors.length < expectedLength) return false
  const colorArray =
    channel.colors instanceof Float32Array
      ? channel.colors
      : new Float32Array(channel.colors.slice(0, expectedLength))
  const existing = geometry.getAttribute('color')
  if (existing && existing.array instanceof Float32Array && existing.array.length === expectedLength) {
    existing.array.set(colorArray.subarray(0, expectedLength))
    existing.needsUpdate = true
  } else {
    geometry.setAttribute('color', new Float32BufferAttribute(colorArray.subarray(0, expectedLength), 3))
  }
  return true
}

/** M4 pre-wired pure updater: applies vertex displacements onto base positions in-place. */
export function applyVertexDisplacementField(
  geometry: BufferGeometry,
  basePositions: Float32Array,
  channel: VertexDisplacementChannel,
): boolean {
  const posAttr = geometry.getAttribute('position')
  if (!posAttr || !(posAttr.array instanceof Float32Array)) return false
  const count = Math.min(posAttr.array.length, basePositions.length, channel.displacements.length)
  if (count === 0) return false
  const scale = channel.scale ?? 1
  for (let i = 0; i < count; i += 1) {
    posAttr.array[i] = basePositions[i] + channel.displacements[i] * scale
  }
  posAttr.needsUpdate = true
  geometry.computeVertexNormals()
  return true
}

/**
 * Formats a human-readable feature label (e.g. `底座 › 顶安装面`) without leaking internal raw IDs.
 */
export function formatHumanReadableFeatureLabel(item: AssemblyFeatureSelectionItem): string {
  const partName = item.partName.trim() || '零件'
  const featureLabel = item.featureLabel.trim() || '几何特征'
  return `${partName} › ${featureLabel}`
}

/** Formats an EvidenceRef into a clean, human-readable provenance tag. */
export function formatEvidenceRefLabel(ref: EvidenceRef): string {
  switch (ref.kind) {
    case undefined:
    case 'pdf-text':
      return `任务书 PDF 第 ${ref.page} 页`
    case 'pdf-ocr':
      return `任务书 OCR 第 ${ref.page} 页`
    case 'image-ocr':
      return `图纸图像 OCR（${ref.fileName}）`
    case 'user-attestation':
      return `用户确认声明`
    case 'agent-read':
      return ref.source.kind === 'pdf-page'
        ? `Agent 读取 PDF 第 ${ref.source.page} 页`
        : `Agent 读取草图图像`
  }
}

/** Extracts a concise human-readable excerpt from an EvidenceRef. */
export function getEvidenceRefExcerpt(ref: EvidenceRef): string {
  switch (ref.kind) {
    case undefined:
    case 'pdf-text':
    case 'pdf-ocr':
      return ref.textSnippet
    case 'image-ocr':
      return ref.recognizedText
    case 'user-attestation':
    case 'agent-read':
      return ref.statement
  }
}

/**
 * Resolves 2–4 dynamic atomic actions for the bottom smart context pill based on
 * selection count (1 or 2) and picked geometry kinds.
 */
export function resolveContextPillActions(
  selectedItems: readonly AssemblyFeatureSelectionItem[],
  additivePickMode = false,
): readonly ContextPillActionSpec[] {
  if (selectedItems.length === 0) return []
  if (selectedItems.length === 1) {
    const first = selectedItems[0]
    const supportsGdt =
      first.geometryKind === 'face' || first.geometryKind === 'cylindrical-hole-axis'
    return [
      { id: 'set-datum', label: '设为基准 A/B/C' },
      ...(supportsGdt ? [{ id: 'attach-gdt' as const, label: '贴 GD&T 框格' }] : []),
      { id: 'configure-physics', label: '开启/配置柔性形变' },
      {
        id: 'add-second-feature',
        label: '+ 加选第二特征',
        active: additivePickMode,
      },
      { id: 'send-to-ai', label: '带入 AI 对话', primary: true },
    ]
  }
  const hasHoleAxis = selectedItems.some((item) => item.geometryKind === 'cylindrical-hole-axis')
  const hasFace = selectedItems.some((item) => item.geometryKind === 'face')
  const clampAction: readonly ContextPillActionSpec[] =
    hasHoleAxis && (hasFace || selectedItems.length >= 2)
      ? [{ id: 'set-clamp-warpage', label: '设为锁紧点 & 翘曲拉平' }]
      : [{ id: 'configure-physics', label: '开启/配置柔性形变' }]

  const [first, second] = selectedItems
  if (first.geometryKind === 'face' && second.geometryKind === 'face') {
    return [
      { id: 'create-face-contact', label: '建立面贴合配合', primary: true },
      ...clampAction,
      { id: 'create-3d-loop', label: '设为 3D 封闭环测量目标' },
      { id: 'send-to-ai', label: '带入 AI 对话' },
    ]
  }
  if (
    first.geometryKind === 'cylindrical-hole-axis' &&
    second.geometryKind === 'cylindrical-hole-axis'
  ) {
    return [
      { id: 'create-coaxial', label: '建立同轴配合', primary: true },
      ...clampAction,
      { id: 'create-3d-loop', label: '设为 3D 封闭环测量目标' },
      { id: 'send-to-ai', label: '带入 AI 对话' },
    ]
  }
  return [
    { id: 'create-distance-align', label: '建立距离/对齐配合', primary: true },
    ...clampAction,
    { id: 'create-3d-loop', label: '设为 3D 封闭环测量目标' },
    { id: 'send-to-ai', label: '带入 AI 对话' },
  ]
}

/** Abramowitz & Stegun 7.1.26 approximation for erfc(x), max error < 1.5e-7. */
function erfcApprox(x: number): number {
  const z = Math.abs(x)
  const t = 1 / (1 + 0.5 * z)
  const ans =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    )
  return x >= 0 ? ans : 2 - ans
}

/** Standard normal CDF Φ(z). */
function normalCdf(z: number): number {
  return 0.5 * erfcApprox(-z / Math.SQRT2)
}

/**
 * Fast deterministic 3D closed-loop RSS + seeded Monte Carlo diagnostics fallback (< 50ms).
 * Computes Nominal, ±3σ, Cp, Cpk, PPM, 18-bin SVG histogram, and descending Pareto shares.
 */
export function computeLocalSimulationDiagnostics(
  spec: SimulationLoopSpec,
  toleranceOverrides?: Readonly<Record<string, number>>,
): SimulationDiagnosticResult {
  const startMs = typeof performance !== 'undefined' ? performance.now() : Date.now()

  const activeContributors = spec.contributors.map((item) => {
    const rawTol = toleranceOverrides?.[item.id] ?? item.currentTolMm
    const tol = Math.max(item.minTolMm, Math.min(item.maxTolMm, rawTol))
    // σ_i = (T_i * |sensitivity|) / 3 for ±tol symmetric half-width (or / 6 for full width)
    const sigma = (tol * Math.abs(item.sensitivity)) / 3
    return {
      ...item,
      currentTolMm: tol,
      sigma,
      variance: sigma * sigma,
    }
  })

  const totalVariance = activeContributors.reduce((acc, c) => acc + c.variance, 0)
  const sigmaMm = Math.sqrt(Math.max(totalVariance, 1e-12))
  const meanMm = spec.nominalMm
  const threeSigmaLowMm = meanMm - 3 * sigmaMm
  const threeSigmaHighMm = meanMm + 3 * sigmaMm

  const specWidth = Math.max(spec.uslMm - spec.lslMm, 1e-9)
  const cp = specWidth / (6 * sigmaMm)
  const cpkUpper = (spec.uslMm - meanMm) / (3 * sigmaMm)
  const cpkLower = (meanMm - spec.lslMm) / (3 * sigmaMm)
  const cpk = Math.min(cpkUpper, cpkLower)

  const pBelow = normalCdf((spec.lslMm - meanMm) / sigmaMm)
  const pAbove = 1 - normalCdf((spec.uslMm - meanMm) / sigmaMm)
  const ppm = Math.max(0, Math.round((pBelow + pAbove) * 1_000_000))

  const status: 'pass' | 'warn' | 'fail' = cpk >= 1.33 ? 'pass' : cpk >= 1.0 ? 'warn' : 'fail'

  // Seeded lightweight Monte Carlo for histogram bins (deterministic via mulberry32)
  const binCount = 18
  const rangeMin = Math.min(spec.lslMm, threeSigmaLowMm) - sigmaMm * 0.5
  const rangeMax = Math.max(spec.uslMm, threeSigmaHighMm) + sigmaMm * 0.5
  const binWidth = Math.max((rangeMax - rangeMin) / binCount, 1e-6)
  const counts = new Array<number>(binCount).fill(0)
  const rng = createRng(spec.seed >>> 0)
  const drawCount = Math.min(Math.max(spec.sampleCount, 400), 4000)

  for (let i = 0; i < drawCount; i += 1) {
    const u1 = Math.max(1e-12, 1 - rng.next())
    const u2 = rng.next()
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    const sample = meanMm + z * sigmaMm
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor((sample - rangeMin) / binWidth)))
    counts[idx] += 1
  }
  const maxBinCount = Math.max(1, ...counts)
  const histogram: HistogramBin[] = counts.map((count, idx) => {
    const startMm = rangeMin + idx * binWidth
    const endMm = startMm + binWidth
    const mid = (startMm + endMm) / 2
    return {
      startMm,
      endMm,
      count,
      ratio: count / maxBinCount,
      outOfSpec: mid < spec.lslMm || mid > spec.uslMm,
    }
  })

  const pareto: ParetoContributionItem[] = activeContributors
    .map((c) => ({
      contributorId: c.id,
      label: c.label,
      partId: c.partId,
      featureId: c.featureId,
      currentTolMm: c.currentTolMm,
      minTolMm: c.minTolMm,
      maxTolMm: c.maxTolMm,
      stepMm: c.stepMm,
      formatPrefix: c.formatPrefix ?? '±',
      varianceSharePercent:
        totalVariance > 0 ? Math.round((c.variance / totalVariance) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.varianceSharePercent - a.varianceSharePercent)

  const endMs = typeof performance !== 'undefined' ? performance.now() : Date.now()

  return {
    loopId: spec.id,
    title: spec.title,
    nominalMm: spec.nominalMm,
    meanMm,
    sigmaMm,
    threeSigmaLowMm,
    threeSigmaHighMm,
    lslMm: spec.lslMm,
    uslMm: spec.uslMm,
    cp,
    cpk,
    ppm,
    status,
    sampleCount: spec.sampleCount,
    histogram,
    pareto,
    computeMs: Math.max(0.1, Math.round((endMs - startMs) * 10) / 10),
    source: 'local-fallback',
  }
}

/** Builds a lightweight default 3-part 3D assembly fixture when M1B 3D mode is enabled without custom meshes. */
export function createDefaultM1bAssemblyFixture(): {
  readonly partMeshes: readonly PartMesh[]
  readonly aiMateDrafts: readonly AiMateDraftItem[]
  readonly simulationSpec: SimulationLoopSpec
} {
  const partMeshes: readonly PartMesh[] = [
    {
      partId: 'part-base',
      displayName: '底座安装板',
      color: '#64748b',
      positions: [
        0, 0, 0, 80, 0, 0, 80, 50, 0, 0, 50, 0,
        0, 0, 8, 80, 0, 8, 80, 50, 8, 0, 50, 8,
      ],
      indices: [
        4, 5, 6, 4, 6, 7,
        0, 1, 2, 0, 2, 3,
      ],
      faceTriangleRanges: [
        {
          partId: 'part-base',
          objectId: 'feat-base-top-face',
          label: '顶安装面',
          geometryKind: 'face',
          startTriangle: 0,
          endTriangle: 2,
        },
        {
          partId: 'part-base',
          objectId: 'feat-base-bottom-face',
          label: '底基准面',
          geometryKind: 'face',
          startTriangle: 2,
          endTriangle: 4,
        },
      ],
      edgeSegments: [
        {
          featureId: 'feat-base-hole-axis',
          partId: 'part-base',
          label: '定位孔轴',
          kind: 'cylindrical-hole-axis',
          points: [60, 25, 0, 60, 25, 8],
        },
        {
          featureId: 'feat-base-front-edge',
          partId: 'part-base',
          label: '前基准边',
          kind: 'edge',
          points: [0, 0, 8, 80, 0, 8],
        },
      ],
      nominalTransform: IDENTITY_MATRIX_4X4,
      bounds: { min: [0, 0, 0], max: [80, 50, 8] },
      explodeVector: [0, 0, -1],
    },
    {
      partId: 'part-spacer',
      displayName: '弹性隔套',
      color: '#f59e0b',
      positions: [
        30, 15, 0, 50, 15, 0, 50, 35, 0, 30, 35, 0,
        30, 15, 6, 50, 15, 6, 50, 35, 6, 30, 35, 6,
      ],
      indices: [
        0, 1, 2, 0, 2, 3,
        4, 5, 6, 4, 6, 7,
      ],
      faceTriangleRanges: [
        {
          partId: 'part-spacer',
          objectId: 'feat-spacer-bottom-face',
          label: '下贴合面',
          geometryKind: 'face',
          startTriangle: 0,
          endTriangle: 2,
        },
        {
          partId: 'part-spacer',
          objectId: 'feat-spacer-top-face',
          label: '上支撑面',
          geometryKind: 'face',
          startTriangle: 2,
          endTriangle: 4,
        },
      ],
      edgeSegments: [
        {
          featureId: 'feat-spacer-bore-axis',
          partId: 'part-spacer',
          label: '内孔轴线',
          kind: 'cylindrical-hole-axis',
          points: [40, 25, 0, 40, 25, 6],
        },
      ],
      nominalTransform: [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 8],
        [0, 0, 0, 1],
      ],
      bounds: { min: [30, 15, 0], max: [50, 35, 6] },
      explodeVector: [0, 0, 0.4],
    },
    {
      partId: 'part-bracket',
      displayName: '盖板支架',
      color: '#60a5fa',
      positions: [
        0, 0, 0, 80, 0, 0, 80, 50, 0, 0, 50, 0,
        0, 0, 4, 80, 0, 4, 80, 50, 4, 0, 50, 4,
      ],
      indices: [
        0, 1, 2, 0, 2, 3,
        4, 5, 6, 4, 6, 7,
      ],
      faceTriangleRanges: [
        {
          partId: 'part-bracket',
          objectId: 'feat-bracket-bottom-face',
          label: '底贴合面',
          geometryKind: 'face',
          startTriangle: 0,
          endTriangle: 2,
        },
        {
          partId: 'part-bracket',
          objectId: 'feat-bracket-top-face',
          label: '顶表面',
          geometryKind: 'face',
          startTriangle: 2,
          endTriangle: 4,
        },
      ],
      edgeSegments: [
        {
          featureId: 'feat-bracket-hole-axis',
          partId: 'part-bracket',
          label: '定位孔轴',
          kind: 'cylindrical-hole-axis',
          points: [60, 25, 0, 60, 25, 4],
        },
      ],
      nominalTransform: [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 14],
        [0, 0, 0, 1],
      ],
      bounds: { min: [0, 0, 0], max: [80, 50, 4] },
      explodeVector: [0, 0, 1.2],
    },
  ]

  const aiMateDrafts: readonly AiMateDraftItem[] = [
    {
      id: 'draft-mate-1',
      kind: 'face-contact',
      mateTypeLabel: '面贴合',
      featureIds: ['feat-base-top-face', 'feat-spacer-bottom-face'],
      featureLabels: ['底座安装板 › 顶安装面', '弹性隔套 › 下贴合面'],
      confidencePercent: 96,
      rationale: '两平面法向反向平行且零间隙贴合，适合作为主装配基准。',
      evidenceRefs: [
        {
          kind: 'pdf-text',
          documentId: 'doc-taskbook-1',
          revisionId: 'rev-taskbook-1',
          sha256: '0'.repeat(64),
          blobKey: 'blob-taskbook-1',
          page: 2,
          rectPdf: [48, 120, 268, 138],
          pageBoxPdf: [0, 0, 595, 842],
          textSnippet: '隔套下端面贴合底座顶安装面',
          normalizedSnippet: '隔套下端面贴合底座顶安装面',
          textItemIndexes: [0],
        },
      ],
      selected: true,
    },
    {
      id: 'draft-mate-2',
      kind: 'coaxial',
      mateTypeLabel: '同轴配合',
      featureIds: ['feat-base-hole-axis', 'feat-bracket-hole-axis'],
      featureLabels: ['底座安装板 › 定位孔轴', '盖板支架 › 定位孔轴'],
      confidencePercent: 92,
      rationale: '两圆柱孔轴线重合且公称直径匹配，建议建立同轴定位配合。',
      evidenceRefs: [
        {
          kind: 'pdf-text',
          documentId: 'doc-taskbook-1',
          revisionId: 'rev-taskbook-1',
          sha256: '0'.repeat(64),
          blobKey: 'blob-taskbook-1',
          page: 3,
          rectPdf: [48, 180, 288, 198],
          pageBoxPdf: [0, 0, 595, 842],
          textSnippet: '定位孔与盖板孔同轴对中装配',
          normalizedSnippet: '定位孔与盖板孔同轴对中装配',
          textItemIndexes: [0],
        },
      ],
      selected: true,
    },
    {
      id: 'draft-mate-3',
      kind: 'face-contact',
      mateTypeLabel: '面贴合',
      featureIds: ['feat-spacer-top-face', 'feat-bracket-bottom-face'],
      featureLabels: ['弹性隔套 › 上支撑面', '盖板支架 › 底贴合面'],
      confidencePercent: 89,
      rationale: '隔套上端面与盖板底面零间隙接触，控制轴向封闭环。',
      evidenceRefs: [
        {
          kind: 'user-attestation',
          actorId: 'engineer',
          at: '2026-11-25T00:00:00.000Z',
          sessionSeq: 1,
          sessionLabel: '初始装配确认',
          statement: '盖板压紧于隔套上端面',
          fieldPath: 'assembly3d.mates[2]',
        },
      ],
      selected: true,
    },
  ]

  const simulationSpec: SimulationLoopSpec = {
    id: 'loop-cover-base-gap',
    title: '盖板-底座残余间隙',
    measurementKind: 'gap',
    nominalMm: 0.2,
    lslMm: 0.05,
    uslMm: 0.35,
    sampleCount: 50000,
    seed: 20261125,
    contributors: [
      {
        id: 'contrib-bracket-flat',
        label: '盖板支架底面平面度',
        partId: 'part-bracket',
        featureId: 'feat-bracket-bottom-face',
        partName: '盖板支架',
        featureLabel: '底贴合面',
        currentTolMm: 0.14,
        minTolMm: 0.02,
        maxTolMm: 0.3,
        stepMm: 0.01,
        sensitivity: 1.0,
        sign: 1,
        formatPrefix: '±',
      },
      {
        id: 'contrib-base-hole-pos',
        label: '底座定位孔位置度',
        partId: 'part-base',
        featureId: 'feat-base-hole-axis',
        partName: '底座安装板',
        featureLabel: '定位孔轴',
        currentTolMm: 0.1,
        minTolMm: 0.02,
        maxTolMm: 0.25,
        stepMm: 0.01,
        sensitivity: 0.85,
        sign: 1,
        formatPrefix: 'Ø',
      },
      {
        id: 'contrib-spacer-height',
        label: '弹性隔套高度公差',
        partId: 'part-spacer',
        featureId: 'feat-spacer-top-face',
        partName: '弹性隔套',
        featureLabel: '上支撑面',
        currentTolMm: 0.06,
        minTolMm: 0.01,
        maxTolMm: 0.15,
        stepMm: 0.005,
        sensitivity: 1.0,
        sign: -1,
        formatPrefix: '±',
      },
    ],
  }

  return { partMeshes, aiMateDrafts, simulationSpec }
}
