import type { SpacerParameterKey } from '../drawing/types'

/** Ephemeral generation input, not a persisted project schema or old STEP digest. */
export interface CadGenerationInput {
  readonly revisionId: string
  readonly projectId: string
  readonly partId: string
  readonly template: 'spacer-hollow-cylinder'
  readonly generatorVersion: 'spacer-step-generator-v1'
  readonly unit: 'mm'
  readonly axis: 'X'
  readonly origin: 'part-center'
  readonly innerDiameterQ: number
  readonly outerDiameterQ: number
  readonly lengthQ: number
  readonly parameters: readonly Readonly<{
    parameterId: string
    key: SpacerParameterKey
    parameterRevision: number | null
    reviewStatus: 'pending' | 'confirmed'
    source: Readonly<{ kind: 'recorded' | 'unrecorded'; fingerprint: string }>
  }>[]
  readonly source: Readonly<{ kind: 'pdf' | 'user-intent'; fingerprint: string }>
  readonly fileStatus: 'historical-frozen'
  readonly historicalByteIdentical: null
  readonly geometryFingerprint: string
  readonly inputFingerprint: string
}
