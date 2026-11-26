import type { EvidenceRef } from '../../../src/document-extraction/types'
import type { MicMatrixAttachment, MicMatrixPayloadV1, ProjectFileAttachmentRef } from '../../../src/project-file/types'
import type { FeaSidecarStatus } from '../../../src/transport/types'

export type FeaSolverId = 'ccx' | 'gmsh'

export type FeaSolverProbe =
  | { installed: true; binaryPath: string; version: string }
  | { installed: false; reason: string }

export interface FeaSidecarDetectionResult {
  available: boolean
  solvers: {
    ccx: FeaSolverProbe
    gmsh: FeaSolverProbe
  }
  statuses: readonly FeaSidecarStatus[]
}

export interface CommandRunOptions {
  stdin?: string
  timeoutMs: number
  maxOutputBytes: number
  signal?: AbortSignal
}

export interface CommandRunResult {
  exitCode: number | null
  stdout: string
  stderr: string
  errorCode?: string
  timedOut?: boolean
  outputExceeded?: boolean
  cancelled?: boolean
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: CommandRunOptions,
) => Promise<CommandRunResult>

export interface DetectFeaSidecarsOptions {
  runner?: CommandRunner
  timeoutMs?: number
  ccxBinary?: string
  gmshBinary?: string
  signal?: AbortSignal
}

export interface GenerateMicSpec {
  partId: string
  fileName?: string
  material: {
    youngsModulusMpa: number
    poissonRatio: number
    densityKgPerM3?: number
  }
  controlPointsMm: readonly (readonly [number, number, number])[]
  measurePointsMm: readonly (readonly [number, number, number])[]
  fixedBoundaryPointsMm?: readonly (readonly [number, number, number])[]
  unitLoadN?: number
  meshSizeMm?: number
  solver?: 'calculix' | 'gmsh-calculix' | 'custom'
  evidence?: readonly EvidenceRef[]
}

export interface GenerateMicOptions {
  adapterPath: string
  adapterArgs?: readonly string[]
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
  runner?: CommandRunner
  verifyStepFile?: boolean
  attachmentId?: string
  blobKey?: string
}

export interface GenerateMicResult {
  micMatrixRef: string
  payload: MicMatrixPayloadV1
  bytes: Uint8Array
  byteSize: number
  sha256: string
  attachment: ProjectFileAttachmentRef & { kind: 'mic-matrix' }
  record: MicMatrixAttachment
  evidence: readonly EvidenceRef[]
  summary: {
    partId: string
    controlPointCount: number
    measurePointCount: number
    solverName: string | null
    meshNodes: number | null
    generatedAtIso: string | null
  }
  sidecarMeta: {
    adapterPath: string
    durationMs: number
  }
}

export type FeaPluginErrorCode =
  | 'FEA_ADAPTER_MISSING'
  | 'FEA_STEP_NOT_FOUND'
  | 'FEA_TIMEOUT'
  | 'FEA_EXEC_FAILED'
  | 'FEA_OUTPUT_TOO_LARGE'
  | 'FEA_INVALID_JSON'
  | 'FEA_INVALID_MIC'
  | 'FEA_INVALID_SPEC'
  | 'FEA_CANCELLED'

export class FeaPluginError extends Error {
  readonly code: FeaPluginErrorCode
  readonly detail?: string

  constructor(code: FeaPluginErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'FeaPluginError'
    this.code = code
    this.detail = detail
  }
}
