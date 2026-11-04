/** 经校验的安全整数，单位 0.0001 mm（1 q = 0.0001 mm）。 */
export type Q = number

export const Q_PER_MM = 10000
export const MAX_ABS_MM = 1_000_000
/** 10^10，远小于 Number.MAX_SAFE_INTEGER（2^53 - 1），所以 Q 用 number 即可，不需要 BigInt。 */
export const MAX_ABS_Q = MAX_ABS_MM * Q_PER_MM

export interface DimensionTerm {
  id: string
  symbol: string
  name: string
  nominalQ: Q
  lowerDeviationQ: Q
  upperDeviationQ: Q
  sign: 1 | -1
  sourceNote: string
}

export interface ChainDefinition {
  terms: DimensionTerm[]
  target: { minQ: Q; maxQ: Q } | null
  assumptions: string
  relationConfirmed: boolean
}

export interface Project {
  schemaVersion: 1
  engineVersion: string
  id: string
  name: string
  createdAt: string // ISO 8601
  updatedAt: string
  working: ChainDefinition
  baseline: {
    savedAt: string
    definition: ChainDefinition
  } | null
}

export interface ChainResult {
  nominalQ: Q
  minQ: Q
  maxQ: Q
  lowerDeviationQ: Q
  upperDeviationQ: Q
  toleranceQ: Q
  status: 'within' | 'outside' | 'no-target'
  lowerMarginQ: Q | null
  upperMarginQ: Q | null
  contributions: { termId: string; toleranceQ: Q }[]
}
