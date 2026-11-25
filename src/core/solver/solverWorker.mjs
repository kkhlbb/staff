import { parentPort } from 'node:worker_threads'
import { calculateChain } from '../../domain/calculate.ts'
import { monteCarloOf } from '../../domain/statistics.ts'

function solve({ version, kind, chain, options }) {
  if (version !== 1) throw new Error('Unsupported solver protocol version')
  if (kind === 'se3' || kind === 'multivariate') return { status: 'unsupported', kind }
  if (kind !== 'extremes1d' && kind !== 'monteCarlo1d') throw new Error('Unknown solver task')
  const extremes = calculateChain(chain)
  if (kind === 'extremes1d') return extremes
  if (options?.samples > 2_000_000) throw new RangeError('Monte Carlo sample limit exceeded')
  return monteCarloOf(chain, extremes.nominalQ, options)
}

parentPort.on('message', ({ id, request }) => {
  try {
    parentPort.postMessage({ id, ok: true, value: solve(request) })
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: String(error) })
  }
})
