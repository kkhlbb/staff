import '../../../mcp/register-ts.mjs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGeometryManager } from '../../../src/core/geometry/geometryManager.mjs'
import { solveAssembly } from '../../../src/core/solver/assemblySolver.mjs'
import { fixtureWriter } from '../fixtures/suiteB/build-step.mjs'
import truth from '../fixtures/suiteB/ground-truth-mates.json' with { type: 'json' }
import { fetchFusion, isMain, manifest, parseArgs, sha256 } from '../fetch-external.mjs'

const thresholds = { axisCrossMax: 1e-3, distanceMmMax: 0.05 }
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0)
const sub = (a, b) => a.map((value, i) => value - b[i])
const crossLength = ([x, y, z], [u, v, w]) => Math.hypot(y * w - z * v, z * u - x * w, x * v - y * u)
const q = value => Math.round(value * 10000)
const normalize = vector => vector.map(value => value / Math.hypot(...vector))

function frames(assembly) {
  const parts = new Map(assembly.parts.map(part => [part.id, part]))
  return assembly.features.flatMap(feature => {
    const plane = feature.kind === 'face' && feature.surface === 'plane'
    const axial = ['cylindrical-hole-axis', 'cone'].includes(feature.kind)
    if (!plane && !axial) return []
    const part = parts.get(feature.partId)
    const rows = part.nominalTransform.slice(0, 3)
    const pos = feature.kind === 'cone' ? feature.apexQ : feature.originQ
    const point = rows.map(row => dot(pos, row) / 10000 + row[3])
    const axis = normalize(rows.map(row => dot(plane ? feature.normal : feature.axis, row)))
    return [{ id: feature.id, part: part.displayName, plane, point, axis,
      radius: feature.radiusQ === undefined ? undefined : feature.radiusQ / 10000 }]
  })
}

function sameFeature(frame, expected, plane) {
  if (!frame || frame.plane !== plane || frame.part !== expected.part) return false
  if (crossLength(frame.axis, expected.axis) > thresholds.axisCrossMax) return false
  const delta = sub(frame.point, expected.point)
  if (plane) {
    return dot(frame.axis, expected.axis) > 0 && Math.abs(dot(delta, expected.axis)) <= thresholds.distanceMmMax
  }
  return crossLength(delta, expected.axis) <= thresholds.distanceMmMax &&
    Math.abs(frame.radius - expected.radius) <= thresholds.distanceMmMax
}

function compileTruth(expected, features) {
  return expected.map(({ kind, features: targets, minMm, maxMm }, index) => {
    const featureIds = targets.map(target => {
      const matches = features.filter(frame => sameFeature(frame, target, kind === 'face-contact'))
      if (matches.length !== 1) throw Error('Expected a unique ground truth feature for ' +
        JSON.stringify(target) + ', found ' + matches.length)
      return matches[0].id
    })
    const constrainedDofs = kind === 'face-contact' ? ['tz', 'rx', 'ry']
      : kind === 'coaxial' ? ['tx', 'ty', 'rx', 'ry'] : ['rx', 'ry']
    return { id: 'truth-' + index, kind, featureIds, constrainedDofs,
      ...(kind === 'floating-clearance' && { minQ: q(minMm), maxQ: q(maxMm) }) }
  })
}

function matchesMate(mate, expected, byId) {
  if (mate.kind !== expected.kind) return false
  const targets = expected.features
  const pair = mate.featureIds.map(id => byId.get(id))
  const plane = mate.kind === 'face-contact'
  const matches = (a, b) => sameFeature(pair[0], targets[a], plane) && sameFeature(pair[1], targets[b], plane)
  if (mate.kind === 'floating-clearance') {
    return matches(0, 1) && Math.abs(mate.minQ / 10000 - expected.minMm) <= thresholds.distanceMmMax &&
      Math.abs(mate.maxQ / 10000 - expected.maxMm) <= thresholds.distanceMmMax
  }
  return matches(0, 1) || matches(1, 0)
}

function matchOneToOne(mates, expected, features) {
  const byId = new Map(features.map(feature => [feature.id, feature]))
  const edges = mates.map(mate => expected.flatMap((target, i) => matchesMate(mate, target, byId) ? [i] : []))
  const assignments = new Map()
  function augment(candidate, visited) {
    for (const target of edges[candidate]) {
      if (visited.has(target)) continue
      visited.add(target)
      if (!assignments.has(target) || augment(assignments.get(target), visited)) {
        assignments.set(target, candidate)
        return true
      }
    }
    return false
  }
  for (const [candidate] of edges.entries()) augment(candidate, new Set())
  const matched = new Set(assignments.values())
  return {
    tp: assignments.size, fp: mates.length - assignments.size, fn: expected.length - assignments.size,
    unmatchedDrafts: mates.flatMap((mate, i) => matched.has(i) ? [] : [{
      ...mate, features: mate.featureIds.map(id => byId.get(id)),
    }]),
    missedTruth: expected.filter((_, i) => !assignments.has(i)),
  }
}

function scores({ tp, fp, fn }) {
  return {
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
    f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null,
  }
}

function solve(assembly, mates) {
  // Fix the datum part, then apply the same small perturbation to both solves.
  const parts = assembly.parts.map((part, i) => {
    if (!i) return part
    const matrix = part.nominalTransform.map((row, axis) => axis < 3
      ? [...row.slice(0, 3), row[3] + [0.018, -0.027, 0.035][axis] * i] : row)
    return { ...part, nominalTransform: matrix }
  })
  const start = performance.now()
  const { status, remainingDof, contradictions, conflictMateIds } = solveAssembly({ assembly: { ...assembly, parts, mates } })
  return { status, remainingDof, contradictions, conflictMateIds, converged: contradictions.length === 0 &&
    conflictMateIds.length === 0, durationMs: performance.now() - start }
}

async function projectTools() {
  const [{ runAssembly3d }, { readMateDrafts, mateDraftTool }, { encodeProjectFile }, { createSampleSnapshot }] =
    await Promise.all([
      import('../../../mcp/tools/assembly-3d.ts'),
      import('../../../desktop/main/project-agent/mateDraftTool.ts'),
      import('../../../src/project-file/codec.ts'),
      import('../../../src/project-file/__fixtures__/sampleProjectFile.ts'),
    ])
  return {
    async run(assembly, step, directory) {
      const analysis = await runAssembly3d({ operation: 'solve', assembly })
      const snapshot = await createSampleSnapshot()
      const project = { ...snapshot.project, assembly3d: assembly,
        stepAttachments: [{ id: step.id, fileName: step.fileName, blobKey: step.blobKey }] }
      const encoded = await encodeProjectFile({
        ...snapshot, project, fileRevisions: snapshot.fileRevisions.map(revision => ({ ...revision, project })),
        blobs: [...snapshot.blobs, { blobKey: step.blobKey, projectId: project.id, sha256: step.sha256,
          byteSize: step.bytes.length }],
        attachments: [...snapshot.attachments, { blobKey: step.blobKey, bytes: step.bytes }],
      })
      if (!encoded.ok) throw Error('Cannot encode clean project: ' + JSON.stringify(encoded.error))
      const path = join(directory, sha256(step.id) + '.cunlian')
      await writeFile(path, encoded.value.bytes)
      const suggestion = await readMateDrafts({ projectId: project.id, path,
        fingerprint: sha256(encoded.value.bytes) }, new AbortController().signal)
      if (!suggestion) throw Error(mateDraftTool.name + ' returned no result')
      return { analysis, suggestion }
    },
  }
}

async function caseResult(id, expected, manager, readStep, tools, directory) {
  const start = performance.now()
  const metrics = {}
  const issues = []
  try {
    const bytes = await readStep(id)
    const step = { id, blobKey: id, fileName: id + '.step', bytes, sha256: sha256(bytes) }
    const { report } = await manager.importStep(step, { jobId: id, attempt: 1 })
    const { assembly } = report
    metrics.partCount = assembly.parts.length
    if (assembly.parts.length !== expected.partCount) throw Error('Unexpected number of imported parts')
    const { analysis, suggestion } = await tools.run(assembly, step, directory)
    metrics.cleanAnalysis = { tool: analysis.tool, status: analysis.result.status,
      remainingDof: analysis.result.remainingDof }
    const mates = suggestion.drafts.map(({ mate }) => mate)
    metrics.mateKinds = Object.fromEntries(['face-contact', 'coaxial', 'floating-clearance'].map(kind => [kind, {
      recommended: mates.filter(mate => mate.kind === kind).length,
      expected: expected.mates.filter(mate => mate.kind === kind).length,
    }]))
    const features = frames(assembly)
    Object.assign(metrics, matchOneToOne(mates, expected.mates, features))
    Object.assign(metrics, scores(metrics))
    metrics.truthSolve = solve(assembly, compileTruth(expected.mates, features))
    metrics.draftSolve = solve(assembly, mates)
    metrics.expectedUnderConstrained = expected.underConstrained
    metrics.underConstrainedCorrect = metrics.draftSolve.converged &&
      (metrics.draftSolve.status === 'underconstrained') === expected.underConstrained
    metrics.remainingDofDelta = metrics.draftSolve.remainingDof - metrics.truthSolve.remainingDof
    if (metrics.fp || metrics.fn) issues.push('Topology drafts differ from independent mate truth')
    if (!metrics.truthSolve.converged ||
        (metrics.truthSolve.status === 'underconstrained') !== expected.underConstrained) {
      issues.push('Ground truth solve disagrees with the authored freedom or residual expectation')
    }
    if (!metrics.draftSolve.converged) issues.push('Draft mate solve has residuals or conflicts')
    if (!metrics.underConstrainedCorrect) issues.push('Draft mate freedom classification disagrees with independent truth')
    if (metrics.remainingDofDelta) issues.push('Draft and truth solves leave different numbers of free degrees')
  } catch (error) {
    issues.push(error.message)
  }
  return { id: 'B-' + id, name: id, status: issues.length ? 'FAIL' : 'PASS',
    durationMs: performance.now() - start, metrics, thresholds,
    ...(issues.length && { defectNote: issues.join('; ') }) }
}

async function fusionCase(input, manager, tools, directory) {
  const id = 'B-' + input.id
  if (input.status !== 'READY') return { id, name: input.id, status: input.status,
    reason: input.reason, durationMs: 0, metrics: {}, thresholds }
  const start = performance.now()
  try {
    const bytes = await readFile(input.paths.truth)
    if (sha256(bytes) !== input.truth.sha256) throw Error('Fusion ground truth changed after verification')
    const expected = JSON.parse(bytes)
    if (!Number.isInteger(expected.partCount) || expected.partCount < 2 || expected.partCount > 8 ||
        typeof expected.underConstrained !== 'boolean' || !expected.mates?.length) throw Error('Invalid Fusion ground truth')
    return caseResult(input.id, expected, manager, async () => {
      const step = await readFile(input.paths.step)
      if (sha256(step) !== input.step.sha256) throw Error('Fusion STEP changed after verification')
      return step
    }, tools, directory)
  } catch (error) {
    return { id, name: input.id, status: 'FAIL', durationMs: performance.now() - start,
      metrics: {}, thresholds, defectNote: error.message }
  }
}

export async function runSuite(options = {}) {
  const start = performance.now()
  const cases = []
  const directory = await mkdtemp(join(tmpdir(), 'cunlian-bench-b-'))
  const manager = createGeometryManager()
  const external = await fetchFusion(options)
  try {
    try {
      const [write, tools] = await Promise.all([fixtureWriter(), projectTools()])
      for (const [id, expected] of Object.entries(truth)) cases.push(await caseResult(id, expected, manager, write, tools, directory))
      for (const input of external) cases.push(await fusionCase(input, manager, tools, directory))
    } catch (error) {
      for (const id of Object.keys(truth)) cases.push({ id: 'B-' + id, name: id, status: 'FAIL',
        durationMs: 0, metrics: {}, thresholds, defectNote: 'Benchmark setup: ' + error.message })
      for (const input of external) cases.push(input.status === 'READY'
        ? { id: 'B-' + input.id, name: input.id, status: 'FAIL', durationMs: 0,
          metrics: {}, thresholds, defectNote: 'Benchmark setup: ' + error.message }
        : await fusionCase(input, manager, null, directory))
    }
  } finally {
    try { await manager.close() } finally { await rm(directory, { recursive: true, force: true }) }
  }
  const counts = { tp: 0, fp: 0, fn: 0 }
  const runs = cases.filter(row => row.status !== 'SKIPPED_EXTERNAL_ASSET').map(row => row.metrics)
  for (const row of runs) for (const key of Object.keys(counts)) counts[key] += row[key] ?? 0
  const solves = runs.flatMap(row => [row.draftSolve, row.truthSolve].filter(Boolean))
  const rate = fn => runs.filter(fn).length / runs.length
  const externalSkipped = cases.length - runs.length
  return { suiteId: 'B', title: 'Assembly mates and SE(3) solver', authority: manifest.fusion360.source,
    status: cases.some(row => row.status === 'FAIL') ? 'FAIL' : externalSkipped ? 'PARTIAL' : 'PASS',
    durationMs: performance.now() - start,
    summary: { ...counts, ...scores(counts), offlineCases: Object.keys(truth).length,
      scoredCases: runs.filter(row => 'tp' in row).length,
      convergenceRate: rate(row => row.draftSolve?.converged),
      groundTruthConvergenceRate: rate(row => row.truthSolve?.converged),
      underConstrainedAccuracy: rate(row => row.underConstrainedCorrect), solveCalls: solves.length,
      avgSolveMs: solves.length ? solves.reduce((sum, row) => sum + row.durationMs, 0) / solves.length : null,
      externalSkipped }, cases }
}

if (isMain(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) console.log('Usage: node suiteB-assembly-mates.mjs [--offline-dir PATH | --external] [--cache-dir PATH]')
  else console.log(JSON.stringify(await runSuite(options), null, 2))
}
