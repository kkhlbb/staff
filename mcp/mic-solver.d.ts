declare module '*/src/core/solver/mic.mjs' {
  import type { EvidenceRef } from '../src/document-extraction/types'
  import type { MicMatrixPayloadV1 } from '../src/project-file/assembly3d'
  import type { PartDisplacementField } from '../src/transport/types'

  export class MicValidationError extends Error {
    readonly code: string
    readonly path: readonly (string | number)[]
    constructor(code: string, message: string, path?: readonly (string | number)[])
  }

  export interface CompiledMicMatrix {
    readonly payload: MicMatrixPayloadV1
    readonly rows: number
    readonly cols: number
    readonly matrix: Float64Array
    readonly controlPoints: Float64Array
    readonly measurePoints: Float64Array
  }

  export interface MicBatchResult {
    readonly partId: string
    readonly sampleCount: number
    readonly measureCount: number
    readonly controlCount: number
    readonly displacements: Float64Array
    readonly stats?: {
      readonly mean: Float64Array
      readonly stdDev: Float64Array
      readonly min: Float64Array
      readonly max: Float64Array
    }
  }

  export interface PreparedMicAttachment {
    readonly micMatrixRef: string
    readonly payload: MicMatrixPayloadV1
    readonly bytes: Uint8Array
    readonly byteSize: number
    readonly sha256: string
    readonly attachment: {
      readonly kind: 'mic-matrix'
      readonly revisionId: string
      readonly blobKey: string
      readonly path: string
      readonly sha256: string
      readonly byteSize: number
    }
    readonly record: {
      readonly id: string
      readonly blobKey: string
      readonly fileName: string
    }
    readonly evidence: EvidenceRef[]
    readonly summary: {
      readonly partId: string
      readonly controlPointCount: number
      readonly measurePointCount: number
      readonly solverName: string | null
      readonly meshNodes: number | null
      readonly generatedAtIso: string | null
    }
  }

  export function parseAndValidateMicMatrix(raw: unknown): CompiledMicMatrix
  export function evaluateMicBatch(
    mic: CompiledMicMatrix | MicMatrixPayloadV1,
    loadVectors: Float64Array | Float32Array | readonly (ArrayLike<number>)[] | readonly number[],
    options?: {
      initialWarpVector?: ArrayLike<number>
      externalLoadVectors?: Float64Array | Float32Array | readonly (ArrayLike<number>)[] | readonly number[]
      out?: Float64Array
      computeStats?: boolean
    },
  ): MicBatchResult
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
      evidence?: readonly unknown[]
    },
  ): Promise<PreparedMicAttachment>
}
