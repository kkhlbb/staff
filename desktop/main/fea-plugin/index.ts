import { existsSync } from 'node:fs'
import { parseAndValidateMicMatrix, prepareMicAttachment, MicValidationError } from '../../../src/core/solver/mic.mjs'
import type { FeaSidecarStatus } from '../../../src/transport/types'
import { runExternalCommand } from './runner'
import {
  FeaPluginError,
  type CommandRunner,
  type DetectFeaSidecarsOptions,
  type FeaSidecarDetectionResult,
  type FeaSolverProbe,
  type GenerateMicOptions,
  type GenerateMicResult,
  type GenerateMicSpec,
} from './types'

export * from './types'
export { runExternalCommand } from './runner'

export const FEA_PLUGIN_PROTOCOL_VERSION = 1
export const DEFAULT_PROBE_TIMEOUT_MS = 5_000
export const DEFAULT_GENERATE_TIMEOUT_MS = 120_000
export const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024 // 32 MiB

function parseSolverVersion(output: string): string {
  const combined = output.trim()
  if (!combined) return 'unknown'
  const versionMatch = combined.match(/(?:version\s*)?(\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?)/i)
  if (versionMatch?.[1]) return versionMatch[1]
  const firstLine = combined.split(/\r?\n/)[0]?.trim()
  return firstLine && firstLine.length <= 120 ? firstLine : 'unknown'
}

async function probeSingleSolver(
  binaryPath: string,
  args: readonly string[],
  runner: CommandRunner,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<FeaSolverProbe> {
  if (!binaryPath || binaryPath.includes('\0')) {
    return { installed: false, reason: 'Invalid solver binary path' }
  }
  const result = await runner(binaryPath, args, {
    timeoutMs,
    maxOutputBytes: 64 * 1024,
    signal,
  })
  if (result.cancelled) {
    return { installed: false, reason: 'Probe cancelled' }
  }
  if (result.timedOut) {
    return { installed: false, reason: `Probe timed out after ${timeoutMs}ms` }
  }
  if (result.errorCode === 'ENOENT') {
    return { installed: false, reason: `Binary "${binaryPath}" not found in PATH` }
  }
  if (result.errorCode) {
    return { installed: false, reason: `Failed to execute "${binaryPath}" (${result.errorCode})` }
  }
  const combinedOutput = `${result.stdout}\n${result.stderr}`.trim()
  // CalculiX `ccx -v` prints version and exits 0 (or non-zero on some builds while still printing Version x.y).
  if (result.exitCode === 0 || /version\s+\d+\.\d+/i.test(combinedOutput)) {
    return {
      installed: true,
      binaryPath,
      version: parseSolverVersion(combinedOutput),
    }
  }
  return {
    installed: false,
    reason: `Solver exited with code ${result.exitCode ?? 'unknown'}`,
  }
}

/**
 * Safely probes for optional locally installed external FEA solvers (`ccx` CalculiX / `gmsh`).
 * Zero errors and zero bundled binaries when neither solver is installed.
 */
export async function detectFeaSidecars(
  options: DetectFeaSidecarsOptions = {},
): Promise<FeaSidecarDetectionResult> {
  const runner = options.runner ?? runExternalCommand
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const ccxBinary = options.ccxBinary ?? 'ccx'
  const gmshBinary = options.gmshBinary ?? 'gmsh'

  const [ccx, gmsh] = await Promise.all([
    probeSingleSolver(ccxBinary, ['-v'], runner, timeoutMs, options.signal),
    probeSingleSolver(gmshBinary, ['--version'], runner, timeoutMs, options.signal),
  ])

  const statuses: FeaSidecarStatus[] = [
    ccx.installed
      ? { solver: 'calculix', available: true, version: ccx.version }
      : { solver: 'calculix', available: false, reason: ccx.reason },
    gmsh.installed
      ? { solver: 'gmsh', available: true, version: gmsh.version }
      : { solver: 'gmsh', available: false, reason: gmsh.reason },
  ]

  return {
    available: ccx.installed || gmsh.installed,
    solvers: { ccx, gmsh },
    statuses,
  }
}

function validatePointListSpec(
  points: readonly (readonly [number, number, number])[],
  fieldName: string,
): void {
  if (!Array.isArray(points) || points.length === 0) {
    throw new FeaPluginError('FEA_INVALID_SPEC', `spec.${fieldName} must be a non-empty array of 3D points`)
  }
  for (let i = 0; i < points.length; i++) {
    const pt = points[i]
    if (
      !Array.isArray(pt) ||
      pt.length !== 3 ||
      !Number.isFinite(pt[0]) ||
      !Number.isFinite(pt[1]) ||
      !Number.isFinite(pt[2])
    ) {
      throw new FeaPluginError('FEA_INVALID_SPEC', `Invalid 3D point at spec.${fieldName}[${i}]`)
    }
  }
}

function validateGenerateSpec(spec: GenerateMicSpec): void {
  if (!spec || typeof spec !== 'object') {
    throw new FeaPluginError('FEA_INVALID_SPEC', 'spec must be an object')
  }
  if (typeof spec.partId !== 'string' || spec.partId.length < 1 || spec.partId.length > 200) {
    throw new FeaPluginError('FEA_INVALID_SPEC', 'spec.partId must be a non-empty string (1..200 chars)')
  }
  if (
    !spec.material ||
    !Number.isFinite(spec.material.youngsModulusMpa) ||
    spec.material.youngsModulusMpa <= 0
  ) {
    throw new FeaPluginError('FEA_INVALID_SPEC', 'spec.material.youngsModulusMpa must be a positive finite number')
  }
  if (
    !Number.isFinite(spec.material.poissonRatio) ||
    spec.material.poissonRatio <= -1 ||
    spec.material.poissonRatio >= 0.5
  ) {
    throw new FeaPluginError('FEA_INVALID_SPEC', 'spec.material.poissonRatio must be in (-1, 0.5)')
  }
  validatePointListSpec(spec.controlPointsMm, 'controlPointsMm')
  validatePointListSpec(spec.measurePointsMm, 'measurePointsMm')
  if (spec.unitLoadN !== undefined && (!Number.isFinite(spec.unitLoadN) || spec.unitLoadN <= 0)) {
    throw new FeaPluginError('FEA_INVALID_SPEC', 'spec.unitLoadN must be a positive finite number')
  }
  if (spec.meshSizeMm !== undefined && (!Number.isFinite(spec.meshSizeMm) || spec.meshSizeMm <= 0)) {
    throw new FeaPluginError('FEA_INVALID_SPEC', 'spec.meshSizeMm must be a positive finite number')
  }
}

/**
 * Invokes an external FEA sidecar CLI adapter via a clean, timeout-guarded, no-shell
 * JSON stdin/stdout protocol to generate a MicMatrixPayloadV1 JSON, validates it via
 * `parseAndValidateMicMatrix`, and returns the prepared `'mic-matrix'` attachment + SHA-256.
 */
export async function generateMicFromSidecar(
  partStepPath: string,
  spec: GenerateMicSpec,
  options: GenerateMicOptions,
): Promise<GenerateMicResult> {
  if (typeof partStepPath !== 'string' || partStepPath.trim().length === 0 || partStepPath.includes('\0')) {
    throw new FeaPluginError('FEA_INVALID_SPEC', 'partStepPath must be a non-empty file path')
  }
  if (!options || typeof options.adapterPath !== 'string' || options.adapterPath.trim().length === 0 || options.adapterPath.includes('\0')) {
    throw new FeaPluginError('FEA_INVALID_SPEC', 'options.adapterPath must be a non-empty executable path')
  }

  validateGenerateSpec(spec)

  const shouldVerifyStep = options.verifyStepFile ?? (options.runner === undefined)
  if (shouldVerifyStep && !existsSync(partStepPath)) {
    throw new FeaPluginError('FEA_STEP_NOT_FOUND', `STEP file not found: ${partStepPath}`)
  }

  const runner = options.runner ?? runExternalCommand
  const timeoutMs = options.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES

  const requestEnvelope = {
    protocolVersion: FEA_PLUGIN_PROTOCOL_VERSION,
    command: 'generate-mic',
    partStepPath,
    spec: {
      partId: spec.partId,
      material: spec.material,
      controlPointsMm: spec.controlPointsMm,
      measurePointsMm: spec.measurePointsMm,
      ...(spec.fixedBoundaryPointsMm ? { fixedBoundaryPointsMm: spec.fixedBoundaryPointsMm } : {}),
      unitLoadN: spec.unitLoadN ?? 1.0,
      ...(spec.meshSizeMm !== undefined ? { meshSizeMm: spec.meshSizeMm } : {}),
      solver: spec.solver ?? 'calculix',
    },
  }

  const startedAt = Date.now()
  const runResult = await runner(options.adapterPath, options.adapterArgs ?? [], {
    stdin: JSON.stringify(requestEnvelope),
    timeoutMs,
    maxOutputBytes,
    signal: options.signal,
  })
  const durationMs = Date.now() - startedAt

  if (runResult.cancelled) {
    throw new FeaPluginError('FEA_CANCELLED', 'External FEA sidecar execution was cancelled')
  }
  if (runResult.timedOut) {
    throw new FeaPluginError('FEA_TIMEOUT', `External FEA sidecar timed out after ${timeoutMs}ms`)
  }
  if (runResult.outputExceeded) {
    throw new FeaPluginError('FEA_OUTPUT_TOO_LARGE', `External FEA sidecar output exceeded ${maxOutputBytes} bytes`)
  }
  if (runResult.errorCode === 'ENOENT') {
    throw new FeaPluginError(
      'FEA_ADAPTER_MISSING',
      `External FEA adapter binary not found: ${options.adapterPath}`,
      runResult.stderr,
    )
  }
  if (runResult.errorCode) {
    throw new FeaPluginError(
      'FEA_EXEC_FAILED',
      `Failed to spawn external FEA adapter (${runResult.errorCode})`,
      runResult.stderr,
    )
  }
  if (runResult.exitCode !== 0) {
    throw new FeaPluginError(
      'FEA_EXEC_FAILED',
      `External FEA adapter exited with code ${runResult.exitCode ?? 'unknown'}`,
      runResult.stderr.trim() || undefined,
    )
  }

  let rawJson: unknown
  try {
    rawJson = JSON.parse(runResult.stdout)
  } catch (error) {
    throw new FeaPluginError(
      'FEA_INVALID_JSON',
      'External FEA adapter stdout is not valid JSON',
      error instanceof Error ? error.message : String(error),
    )
  }

  let validated
  try {
    validated = parseAndValidateMicMatrix(rawJson)
  } catch (error) {
    const detail = error instanceof MicValidationError ? `${error.code}: ${error.message}` : String(error)
    throw new FeaPluginError('FEA_INVALID_MIC', 'External FEA adapter produced an invalid MIC matrix', detail)
  }

  if (validated.payload.partId !== spec.partId) {
    throw new FeaPluginError(
      'FEA_INVALID_MIC',
      `MIC payload partId "${validated.payload.partId}" does not match requested spec.partId "${spec.partId}"`,
    )
  }

  const prepared = await prepareMicAttachment(validated.payload, {
    attachmentId: options.attachmentId,
    blobKey: options.blobKey,
    fileName: spec.fileName ?? `${spec.partId}-mic.json`,
    ...(spec.evidence && spec.evidence.length > 0 ? { evidence: spec.evidence } : {}),
  })

  return {
    ...prepared,
    sidecarMeta: {
      adapterPath: options.adapterPath,
      durationMs,
    },
  }
}
