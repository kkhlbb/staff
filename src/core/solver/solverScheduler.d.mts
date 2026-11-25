import type { ChainDefinition, ChainResult } from '../../domain/types.ts'
import type { MonteCarloOptions, MonteCarloResult } from '../../domain/statistics.ts'

type TaskOptions = { signal?: AbortSignal; timeoutMs?: number }
export type SolverRequest =
  | { kind: 'extremes1d'; chain: ChainDefinition }
  | { kind: 'monteCarlo1d'; chain: ChainDefinition; options?: MonteCarloOptions }
  | { kind: 'se3'; inputs: unknown }
  | { kind: 'multivariate'; inputs: unknown }

type SolverResult<T extends SolverRequest> = T extends { kind: 'extremes1d' } ? ChainResult
  : T extends { kind: 'monteCarlo1d' } ? MonteCarloResult
    : { status: 'unsupported'; kind: T['kind'] }

export function createSolverScheduler(workerUrl?: URL): {
  run<T extends SolverRequest>(request: T, options?: TaskOptions): Promise<SolverResult<T>>
  close(): Promise<void>
}
