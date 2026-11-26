import { HttpError } from './contracts.mjs'
import { fingerprint } from '../../src/core/geometry/geometryManager.mjs'
import { modelConnection } from './model.mjs'

export const binary = (bytes, type, headers = {}) => ({ bytes, headers: { 'content-type': type, ...headers } })

export function createRest(projects, engine, config) {
  async function route({ route, params, query, body, principal, signal, req, res }) {
    const { projectId, draftRevision, attachmentId, format } = params
    const suffix = route.path.replace(/^\/api\/v1(?:\/projects(?:\/\{projectId\})?)?/, '')
    const method = route.method
    if (suffix === '/capabilities') return {
      attachments: config.feature3dAssemblyM1 ? ['pdf', 'stl', 'step'] : ['pdf', 'stl'],
      drawingFormats: ['svg', 'dxf-r12', 'dxf-2000'],
      writerLeases: true, modelConnection: config.models.size > 0,
      FEATURE_3D_ASSEMBLY_M1: Boolean(config.feature3dAssemblyM1),
    }
    if (!projectId) {
      if (suffix.startsWith('/model-connection/')) {
        await projects.read(body.projectId, principal)
        return modelConnection(config, body, suffix.endsWith('/test'), signal)
      }
      if (suffix !== '' && suffix !== '/import') throw new HttpError(404, 'NOT_FOUND')
      return method === 'get' ? projects.list(principal) : projects.create(body, principal, signal)
    }
    if (suffix === '/authorization') return projects.authorize(projectId, principal, signal)
    const state = await projects.read(projectId, principal)
    const { baseRevision } = state
    const activities = projects.activities(state)
    switch (suffix) {
      case '': return projects.summary(state)
      case '/report': return projects.exportReport({ ...body, projectId }, principal, signal)
      case '/attachments': return projects.attach(projectId, body, principal, signal)
      case '/attachments/{attachmentId}': {
        const attachment = state.attachments[attachmentId] ?? state.importedAttachments?.[attachmentId]
        if (!attachment?.bytes) throw new HttpError(404, 'ATTACHMENT_NOT_FOUND')
        if (attachment.ref.kind === 'step') throw new HttpError(422, 'FEATURE_DISABLED')
        return binary(Buffer.from(attachment.bytes, 'base64'), 'application/octet-stream')
      }
      case '/writer/takeover': return projects.lease(projectId, 'takeover', body, principal, signal)
      case '/writer':
        if (method === 'get') return projects.context(state)
        return projects.lease(projectId, method === 'delete' ? 'revoke' : 'acquire', body, principal, signal)
      case '/drafts/datums': return projects.stageGdt('stage_datum', { ...body, projectId }, principal, signal)
      case '/drafts/gdt': return projects.stageGdt('stage_gdt', { ...body, projectId }, principal, signal)
      case '/drafts/{draftRevision}/gdt-stackup': return projects.analyzeGdt({ ...body, projectId, draftRevision }, principal, signal)
      case '/drafts/physics': return projects.stagePhysics({ ...body, projectId }, principal, signal)
      case '/drafts/mic-matrix': return projects.importMicMatrix({ ...body, projectId }, principal, signal)
      case '/drafts/{draftRevision}/compliant-stackup': return projects.analyzeCompliant({ ...body, projectId, draftRevision }, principal, signal)
      case '/drafts/changes': return projects.stage(projectId, body.change, principal, signal)
      case '/external-activities': return { draftRevision: state.draftRevision, activities }
      case '/context': {
        const context = projects.context(state)
        const owner = projects.holder(state)
        return { baseRevision, activities, snapshot: {
          projectId, connection: 'connected', draftRevision: context.draftRevision, cursor: context.cursor,
          spacerDraft: context.spacerDraft, authorization: { authorized: true, canWrite: principal.write === true && owner === principal.name },
          writer: { epoch: state.epoch, occupied: Boolean(owner) },
        } }
      }
      case '/connection': {
        const writerOwner = projects.holder(state)
        return {
          connectionState: 'connected', source: 'local-agent', clientName: principal.name,
          projectId, projectName: state.name, baseRevision, draftRevision: state.draftRevision,
          authorizationState: principal.write && writerOwner === principal.name ? 'authorized-writable' : 'authorized-readonly',
          writerEpoch: state.epoch, writerOccupied: Boolean(writerOwner), writerOwner,
        }
      }
      case '/events': {
        const after = query.afterSequence ?? 0
        const events = state.events.slice(after, after + Math.min(query.limit ?? 100, 1000))
        return { events, nextCursor: events.at(-1)?.sequence ?? Math.min(after, state.events.length), highWatermark: state.events.length }
      }
      case '/drafts/{draftRevision}/commit': {
        if (method === 'post') return projects.commit(projectId, draftRevision, body, principal, signal)
        const prior = state.commits.find(row => row.result.committedDraftRevision === draftRevision)
        if (prior) return { state: 'committed', result: prior.result }
        projects.draftMatches(state, draftRevision)
        return { state: 'awaiting-confirmation' }
      }
      case '/drafts/{draftRevision}/drawing/{format}': {
        const prior = state.commits.find(row => row.result.committedDraftRevision === draftRevision)
        if (!prior) projects.draftMatches(state, draftRevision)
        const existing = state.exports[draftRevision + ':' + format]
        const item = existing ? { ...existing, bytes: Buffer.from(existing.bytes, 'base64') }
          : await engine.drawing(prior ? { ...state, ...prior, draftRevision } : state, format, signal)
        if (!existing) await projects.saveExport(projectId, draftRevision, format, item, principal, signal)
        return binary(item.bytes, format === 'svg' ? 'image/svg+xml' : 'application/dxf', { 'x-drawing-fingerprint': item.fingerprint })
      }
      default: break
    }
    projects.draftMatches(state, draftRevision)
    switch (suffix) {
      case '/drafts/{draftRevision}/geometry': {
        if (body.assembly3d) throw new HttpError(422, 'FEATURE_DISABLED')
        const mesh = await engine.mesh(state, signal)
        const withoutFrame = ({ frameId: _frame, ...value }) => value
        const canonical = mesh.plate
          ? { ...mesh, plate: withoutFrame(mesh.plate), cover: mesh.cover ? withoutFrame(mesh.cover) : null }
          : withoutFrame(mesh)
        return { projectId, draftRevision, geometryFingerprint: fingerprint(canonical) }
      }
      case '/drafts/{draftRevision}/mesh': return engine.mesh(state, signal)
      case '/drafts/{draftRevision}/checks': return engine.checks(state, signal)
      case '/drafts/{draftRevision}/simulation': return engine.simulate(body.chain, body.monteCarlo, signal)
      case '/drafts/{draftRevision}/review': {
        const { value, token } = await projects.review(state, principal, draftRevision, req.headers['x-cunlian-approval'], signal)
        if (token) res.setHeader('x-cunlian-confirmation-token', token)
        return value
      }
      default: throw new HttpError(404, 'NOT_FOUND')
    }
  }
  return route
}
