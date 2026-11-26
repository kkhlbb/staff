declare module '*/src/core/solver/mic.mjs' {
  import type { EvidenceRef } from '../../../src/document-extraction/types'
  import type { MicMatrixAttachment, MicMatrixPayloadV1, ProjectFileAttachmentRef } from '../../../src/project-file/types'
  import type { PartDisplacementField } from '../../../src/transport/types'

  export class MicValidationError extends Error {
    readonly code: string
    readonly path: readonly (string | number)[]
    constructor(code: string, message: string, path?: readonly (string | number)[])
  }

  export interface CompiledMicMatrix {
    payload: MicMatrixPayloadV1
    rows: number
    cols: number
    matrix: Float64Array
    controlPoints: Float64Array
    measurePoints: Float64Array
  }

  export function parseAndValidateMicMatrix(raw: unknown): CompiledMicMatrix

  export function evaluateMicBatch(
    mic: CompiledMicMatrix | MicMatrixPayloadV1,
    loadVectors: Float64Array | Float32Array | readonly ArrayLike<number>[] | readonly number[],
    options?: {
      initialWarpVector?: ArrayLike<number>
      externalLoadVectors?: Float64Array | Float32Array | readonly ArrayLike<number>[] | readonly number[]
      out?: Float64Array
      computeStats?: boolean
    },
  ): {
    partId: string
    sampleCount: number
    measureCount: number
    controlCount: number
    displacements: Float64Array
    stats?: {
      mean: Float64Array
      stdDev: Float64Array
      min: Float64Array
      max: Float64Array
    }
  }

  export function buildMicDisplacementField(
    mic: CompiledMicMatrix | MicMatrixPayloadV1,
    displacementVector: ArrayLike<number>,
    options?: {
      direction?: readonly [number, number, number]
      directions?: readonly (readonly [number, number, number])[]
    },
  ): PartDisplacementField

  export function prepareMicAttachment(
    rawPayload: unknown,
    meta?: {
      attachmentId?: string
      blobKey?: string
      fileName?: string
      evidence?: readonly EvidenceRef[]
    },
  ): Promise<{
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
  }>
}
