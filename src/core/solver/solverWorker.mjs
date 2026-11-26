import { parentPort, threadId } from 'node:worker_threads'
import { calculateChain } from '../../domain/calculate.ts'
import { monteCarloOf } from '../../domain/statistics.ts'
import { solveAssembly } from './assemblySolver.mjs'
import { buildMicDisplacementField, evaluateMicBatch, parseAndValidateMicMatrix } from './mic.mjs'
import { createSimulation } from './multivariate.mjs'

let activeMicPayloads = null

function micEvaluator({ reference }) {
  const raw = activeMicPayloads?.[reference]
  if (!raw) return null
  const compiled = parseAndValidateMicMatrix(raw)
  const loadVec = new Float64Array(compiled.cols)
  loadVec.fill(1)
  const evaluated = evaluateMicBatch(compiled, loadVec)
  const field = buildMicDisplacementField(compiled, evaluated.displacements)
  const points = field.samples.map(sample => sample.posMm)
  return {
    modelId: reference,
    parts: [field.partId],
    pointsByPart: new Map([[field.partId, points]]),
    at(partId, point) {
      if (partId !== field.partId || field.samples.length === 0) return [[0, 0, 0, 0, 0, 0]]
      let best = field.samples[0]
      let bestDistSq = Infinity
      for (const sample of field.samples) {
        const dx = point[0] - sample.posMm[0]
        const dy = point[1] - sample.posMm[1]
        const dz = point[2] - sample.posMm[2]
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 < bestDistSq) {
          bestDistSq = d2
          best = sample
        }
      }
      return [[best.dispMm[0], best.dispMm[1], best.dispMm[2], 0, 0, 0]]
    },
    amplitudes(z) {
      return [1 + 0.1 * z]
    },
  }
}

const runSimulation = createSimulation(threadId, { micEvaluator })

function solve({ version, kind, chain, options, inputs }) {
  if (version !== 1) throw new Error('Unsupported solver protocol version')
  // Preserve the original feature-probe reply for callers of the reserved empty input.
  if ((kind === 'se3' || kind === 'multivariate') && inputs && Object.keys(inputs).length === 0) {
    return { status: 'unsupported', kind }
  }
  if (kind === 'se3') return solveAssembly(inputs)
  if (kind === 'multivariate') {
    if (inputs && !('incremental' in inputs)) activeMicPayloads = inputs.micPayloads ?? null
    else if (inputs && 'micPayloads' in inputs) activeMicPayloads = inputs.micPayloads ?? null
    return runSimulation(inputs)
  }
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
