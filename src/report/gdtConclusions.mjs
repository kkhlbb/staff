import { linearizedMateResponse, solveAssembly } from '../core/solver/assemblySolver.mjs'
import { scene } from '../core/solver/spatial.mjs'
import { evaluateCompliantGdt, evaluateGdt, prepareGdt } from '../core/solver/gdt.mjs'
import { prepareCompliance } from '../core/solver/compliance.mjs'
import { parseAndValidateMicMatrix, evaluateMicBatch, buildMicDisplacementField } from '../core/solver/mic.mjs'

function micEvaluator(payload) {
  if (!payload) return undefined
  const matrix = parseAndValidateMicMatrix(payload)
  const evaluated = evaluateMicBatch(matrix, new Float64Array(matrix.cols).fill(1))
  const field = buildMicDisplacementField(matrix, evaluated.displacements)
  return () => ({
    modelId: payload.partId, parts: [field.partId],
    pointsByPart: new Map([[field.partId, field.samples.map(sample => sample.posMm)]]),
    at(partId, point) {
      let nearest
      let distance = Infinity
      if (partId === field.partId) {
        for (const sample of field.samples) {
          const squared = sample.posMm.reduce((sum, value, i) => sum + (value - point[i]) ** 2, 0)
          if (squared < distance) {
            nearest = sample
            distance = squared
          }
        }
      }
      return [[...(nearest?.dispMm ?? [0, 0, 0]), 0, 0, 0]]
    },
  })
}

function processMetrics(score, samples) {
  return { threeSigmaIntervalMm: score.threeSigmaIntervalMm, cp: null, cpk: score.cpk,
    ppm: score.failures.reduce((sum, value) => sum + value, 0) * 1e6 / samples }
}

function histogram(errors, failures, min, max) {
  const width = (max - min) / 24
  const bins = Array.from({ length: 24 }, (_, i) => ({
    intervalMm: [min + i * width, min + (i + 1) * width], count: 0, outOfSpecCount: 0,
  }))
  for (let i = 0; i < errors.length; i++) {
    const bin = bins[width ? Math.min(23, Math.floor((errors[i] - min) / width)) : 0]
    bin.count++
    bin.outOfSpecCount += failures[i]
  }
  return bins
}

export function gdtConclusions(assembly, seed, samples, mic) {
  if (!assembly?.gdt.length) return { conclusions: [], contributions: [], warnings: [] }
  const solution = solveAssembly({ assembly })
  if (solution.status === 'overconstrained') return { conclusions: [], contributions: [], warnings: [] }
  const geometry = scene({ ...assembly, parts: solution.parts.map(part => ({ ...part, id: part.partId })) })
  const parameters = new Map()
  const response = linearizedMateResponse(assembly, geometry, solution.fixedPartIds)
  const options = { seed, samples, distribution: 'uniform', parameters, response, micEvaluator: micEvaluator(mic) }
  const model = prepareGdt(assembly, geometry, parameters, new Map(), samples, seed, {}, 'uniform', true)
  const rigid = evaluateGdt(model, parameters)
  const compliant = prepareCompliance(assembly, geometry, options)
  const sorted = [...rigid.metrics.contributions].sort((a, b) => b.varianceSharePct - a.varianceSharePct)
  let running = 0
  const pareto = sorted.map(item => ({
    inputId: item.gdtId, label: item.label, varianceSharePct: item.varianceSharePct,
    cumulativeSharePct: (running += item.varianceSharePct),
  }))
  const conclusions = assembly.gdt.flatMap(control => {
    const score = rigid.scores.get(control.id)
    const errors = rigid.draws.get(control.id)?.errors
    if (!score || !errors?.length) return []
    const min = Math.min(...errors)
    const max = Math.max(...errors)
    const rigidStats = processMetrics(score, samples)
    const entry = model.entries.find(item => item.control.id === control.id)
    const flexible = compliant && entry
      ? evaluateCompliantGdt({ ...model, entries: [entry] }, parameters, rigid, compliant.models)
      : null
    const flexStats = flexible ? { ...flexible.metrics, cp: null } : null
    return [{
      checkId: control.id, label: control.kind + ' · ' + control.featureId + ' (sampled)',
      requirementMm: [0, control.toleranceQ / 10_000], extremeIntervalMm: [min, max],
      status: rigidStats.ppm > 0 || (flexStats?.ppm ?? 0) > 0 ? 'fail' : 'indeterminate',
      rigid: rigidStats, compliant: flexStats,
      flexDeltaCpk: rigidStats.cpk != null && flexStats?.cpk != null ? flexStats.cpk - rigidStats.cpk : null,
      histogram: histogram(errors, score.failures, min, max), pareto,
    }]
  })
  return { conclusions, contributions: rigid.metrics.contributions, warnings: rigid.metrics.warnings }
}
