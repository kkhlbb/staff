import '../../mcp/register-ts.mjs'
import { randomUUID } from 'node:crypto'
import { createGeometryManager, fingerprint } from '../../src/core/geometry/geometryManager.mjs'
import { createSolverScheduler } from '../../src/core/solver/solverScheduler.mjs'
import { createMountingPlate } from '../../desktop/main/project-agent/m2/model.mjs'
import { computeSpacerChain, spacerParametersFromQ } from '../../mcp/lib/spacer.ts'
import { partRevolveData, spacerDemoDefinition } from '../../src/parts/shaftDemoGeometry.ts'
import { computeChange } from '../../src/revisions/compute.ts'
import { SPACER_PARAMETER_IDS, SPACER_PART_ID } from '../../src/drawing/types.ts'
import { decodeProjectFile } from '../../src/project-file/codec.ts'
import { formatMm } from '../../src/domain/units.ts'
import { closedIntervalVerdict } from '../../src/requirements/check.ts'
import { ASSUMPTION_NOTE, STATISTICS_GENERATOR_VERSION, crossCheck, rssOf } from '../../src/domain/statistics.ts'
import { buildDxfDocument } from '../../src/drawing/dxfExport.ts'
import { renderDrawingSvg } from '../../src/drawing/renderDrawingSvg.ts'
import { HttpError } from './contracts.mjs'
import { plateDrawing } from './plate-export.mjs'

export const defaultSpacer = { innerDiameterQ: 200000, outerDiameterQ: 320000, lengthQ: 120000 }
const asMm = q => Number(formatMm(q))
const check = (id, status, summary, features = [], annotations = [], anchor) => ({
  checkId: id, requirementId: id, title: id, summary, required: true, status,
  linkedFeatureIds: features, linkedAnnotationIds: annotations, ...(anchor ? { anchor } : {}),
})

export function computeProjectSpacer(snapshot, state, revisionId) {
  const { project } = snapshot
  let base = snapshot
  if (!project.dimensionChain.terms.some(term => term.id === 't-s')) {
    const { previousChain } = computeSpacerChain(defaultSpacer)
    base = { ...snapshot, project: { ...project, dimensionChain: { ...previousChain, target: null } } }
  }
  const bindings = project.dimensionLinks.filter(link => link.kind === 'parameter-binding')
  if (!bindings.some(link => link.termId === 't-s')) bindings.push({
    kind: 'parameter-binding', bindingId: 'cloud-spacer-length', termId: 't-s', partId: SPACER_PART_ID,
    parameterId: SPACER_PARAMETER_IDS.length, syncField: 'nominal', createdAt: project.createdAt,
  })
  const parameters = spacerParametersFromQ(state.spacer).map(parameter => {
    const old = project.parameters.find(row => row.parameterId === parameter.parameterId)
    if (old?.valueQ === parameter.valueQ) return old
    return { ...parameter, parameterRevision: (old?.parameterRevision ?? 0) + 1 }
  })
  return computeChange(base, { parameters, bindings }, { revisionId, now: project.updatedAt })
}

async function spacer(state) {
  const result = await decodeProjectFile(Buffer.from(state.archive, 'base64'))
  if (!result.ok) throw Error('Stored archive failed validation')
  return computeProjectSpacer(result.value.snapshot, state, state.draftRevision)
}

export function createEngine(timeoutMs) {
  const geometry = createGeometryManager()
  const solver = createSolverScheduler()
  const reports = new Map()

  async function plate(state, signal) {
    const model = { ...(state.plateModel ?? createMountingPlate()), revision: state.draftRevision }
    const key = fingerprint([state.projectId, model])
    if (!reports.has(key)) {
      const { report } = await geometry.execute({ model }, {
        projectId: state.projectId, jobId: randomUUID(), attempt: 1, signal, timeoutMs,
      })
      if (reports.size >= 16) reports.delete(reports.keys().next().value)
      reports.set(key, report)
    }
    return reports.get(key)
  }

  async function simulate(chain, monteCarlo, signal) {
    if (chain.terms.length > 200 || (monteCarlo && monteCarlo.samples > 2_000_000)) {
      throw new HttpError(422, 'SIMULATION_LIMIT')
    }
    const options = { signal, timeoutMs }
    const extreme = await solver.run({ kind: 'extremes1d', chain }, options)
    if (!monteCarlo) return { extreme, statistical: null }
    const mc = await solver.run({ kind: 'monteCarlo1d', chain, options: monteCarlo }, options)
    const rss = rssOf(chain, extreme.nominalQ)
    return { extreme, statistical: {
      generatorVersion: STATISTICS_GENERATOR_VERSION,
      extreme: { method: 'extreme', minQ: extreme.minQ, maxQ: extreme.maxQ, toleranceQ: extreme.toleranceQ, judgementBasis: true },
      rss, monteCarlo: mc, crossCheck: crossCheck(rss, mc), assumptionNote: ASSUMPTION_NOTE,
    } }
  }

  async function checks(state, signal) {
    const { projectId, draftRevision } = state
    let items
    if (state.template === 'builtin-mounting-plate') {
      const report = await plate(state, signal)
      items = report.checks.map(row => {
        const requirement = state.plateRequirements?.find(item => item.requirementId === row.id)
        const result = { ...row }
        delete result.targets
        const missing = state.plateRequirements && row.id.startsWith('MP-') && !requirement
        return check(row.id, missing ? 'needsClarification' : requirement?.status === 'uncovered' ? 'uncovered' : ['needsClarification', 'conflict'].includes(requirement?.status) ? 'needsClarification' : row.status,
          JSON.stringify(result), row.targets?.map(target => target.featureId).filter(Boolean),
          report.drawing?.annotations.filter(annotation => row.targets?.some(target => target.role === annotation.reference.role))
            .map(annotation => annotation.id), requirement?.anchor)
      })
      for (const requirement of state.plateRequirements ?? []) {
        if (!items.some(item => item.checkId === requirement.requirementId)) {
          items.push(check(requirement.requirementId, 'uncovered', requirement.interpretation, [], [], requirement.anchor))
        }
      }
    } else if (state.spacer) {
      const { chain } = await spacer(state)
      const { extreme } = await simulate(chain, null, signal)
      const target = state.requirement ?? (state.template === 'builtin-shaft-spacer' ? { minQ: 1000, maxQ: 3000 } : chain.target)
      const verdict = target && closedIntervalVerdict({
        minQ: extreme.minQ, maxQ: extreme.maxQ, lowerQ: target.minQ, upperQ: target.maxQ,
      })
      items = [check('spacer-closed-interval', verdict ? (verdict.satisfied ? 'pass' : 'fail') : 'needsClarification',
        JSON.stringify({ extreme, target, verdict }), ['spacer'], ['length'])]
    } else {
      items = [check('draft-input', 'needsClarification', 'Draft parameters are required')]
    }
    return { projectId, draftRevision, checks: items, checksetFingerprint: fingerprint({
      projectId, draftRevision, baseRevision: state.baseRevision, items,
    }) }
  }

  function spacerMesh(parameters) {
    const data = partRevolveData(spacerDemoDefinition({
      innerRadius: asMm(parameters.innerDiameterQ) / 2,
      outerRadius: asMm(parameters.outerDiameterQ) / 2, length: asMm(parameters.lengthQ),
    }))
    const positions = Array.from(data.positions)
    const indices = Array.from(data.indices)
    const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
    positions.forEach((number, index) => {
      const axis = index % 3
      bounds.min[axis] = Math.min(bounds.min[axis], number)
      bounds.max[axis] = Math.max(bounds.max[axis], number)
    })
    return { positions, indices, normals: Array.from(data.normals), bounds,
      triangleRanges: [{ startTriangle: 0, endTriangle: indices.length / 3, objectId: 'spacer' }] }
  }

  return {
    simulate, checks, plate,
    async mesh(state, signal) {
      if (state.template === 'builtin-mounting-plate') {
        const { mesh } = await plate(state, signal)
        if (mesh) return mesh
      } else if (state.spacer) {
        return spacerMesh(state.spacer)
      }
      throw new HttpError(422, 'GEOMETRY_UNAVAILABLE')
    },
    async drawing(state, format, signal) {
      if (state.template === 'builtin-mounting-plate') {
        const { drawing } = await plate(state, signal)
        if (!drawing) throw new HttpError(422, 'DRAWING_UNAVAILABLE')
        return plateDrawing(drawing, format)
      }
      if (!state.spacer) throw new HttpError(422, 'DRAWING_UNAVAILABLE')
      const data = (await spacer(state)).drawing.data
      return {
        bytes: format === 'svg' ? Buffer.from(renderDrawingSvg(data)) : buildDxfDocument(data, format.slice(4)).bytes,
        fingerprint: data.fingerprint,
      }
    },
    close: () => Promise.all([geometry.close(), solver.close()]),
  }
}
