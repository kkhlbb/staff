import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { decodeProjectFile, encodeProjectFile } from '../../src/project-file/codec.ts'
import { upgradeSnapshotToCurrent } from '../../src/project-file/upgrade.ts'
import { createNewProjectSnapshot } from '../../desktop/main/newProject.ts'
import { inspectSourcePdf } from '../../desktop/main/pdfSourceInspect.ts'
import { importRequirements, interpret } from '../../desktop/main/project-agent/m2/requirements.ts'
import { createMountingPlate } from '../../desktop/main/project-agent/m2/model.mjs'
import { spacerParametersFromQ } from '../../mcp/lib/spacer.ts'
import { analyzeGdtSchema, assemblyWarnings, gdtSources, stageControls, stageDatumSchema, stageDatums, stageGdtSchema } from '../../mcp/lib/gdt.ts'
import { parseStl } from '../../src/parts/stlValidation.ts'
import { HttpError } from './contracts.mjs'
import { computeProjectSpacer, defaultSpacer } from './engine.mjs'

export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const id = prefix => prefix + '-' + randomUUID()
const stamp = () => new Date().toISOString()
const userSource = { type: 'userInput' }
const keys = ['innerDiameterQ', 'outerDiameterQ', 'lengthQ']
function hash(value) {
  return digest(JSON.stringify(value, (_key, entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
    return Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]]))
  }))
}
export function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string'
    && timingSafeEqual(Buffer.from(digest(a), 'hex'), Buffer.from(digest(b), 'hex'))
}

function unwrap(result) {
  if (!result.ok) throw new HttpError(422, result.error.code, result.error.message)
  return result.value
}

function summary({ projectId, name, baseRevision, draftRevision }) {
  return { projectId, name, baseRevision, draftRevision }
}

function record(state, type, principal, detail = {}) {
  state.events.push({
    projectId: state.projectId, sequence: state.events.length + 1, type,
    actor: principal.name, createdAt: stamp(), ...detail,
  })
}

function authorize(state, principal) {
  if (!state.authorized.includes(principal.name)) throw new HttpError(403, 'AUTH_REQUIRED')
}

const holder = state => state.lease?.until > Date.now() ? state.lease.owner : null

function requireWriter(state, principal) {
  authorize(state, principal)
  if (!principal.write || holder(state) !== principal.name) throw new HttpError(409, 'WRITER_LEASE_REQUIRED')
}

function draftMatches(state, revision) {
  if (!state.draftRevision || state.draftRevision !== revision) throw new HttpError(409, 'STALE_DRAFT')
}

function writerState(state) {
  return { writerEpoch: state.epoch, baseRevision: state.baseRevision, draftRevision: state.draftRevision }
}

function context(state) {
  return { baseRevision: state.baseRevision, draftRevision: state.draftRevision, cursor: state.events.length,
    spacerDraft: state.spacer && state.draftRevision ? {
      ...state.spacer, draftRevision: state.draftRevision, sources: state.sources, question: null,
    } : null,
    ...(state.template === 'builtin-mounting-plate' && state.draftRevision
      ? { mountingPlateDraftRevision: state.draftRevision } : {}),
  }
}

async function replay(state, principal, input, action) {
  const key = input.idempotencyKey
  const prior = state.receipts.find(row => row.key === key && row.actor === principal.name)
  const fingerprint = hash(input)
  if (prior) {
    if (prior.fingerprint !== fingerprint) throw new HttpError(409, 'REQUEST_COLLISION')
    return prior.value
  }
  const value = await action()
  state.receipts.push({ key, actor: principal.name, fingerprint, value })
  return value
}

export function createProjects(storage, engine, config) {
  const read = async (projectId, principal) => {
    const state = await storage.read(projectId)
    authorize(state, principal)
    return state
  }

  async function attachment(state, { kind, fileName, file }, principal, signal) {
    if (kind === 'step') throw new HttpError(422, 'FEATURE_DISABLED')
    if (!file.length) throw new HttpError(422, 'EMPTY_ATTACHMENT')
    if (Object.values(state.attachments).reduce((sum, row) => sum + row.ref.byteSize, 0) + file.length > config.maxUpload) {
      throw new HttpError(413, 'PROJECT_ATTACHMENT_LIMIT')
    }
    const attachmentId = id('attachment')
    const ref = {
      kind: kind === 'stl' ? 'model' : kind, revisionId: attachmentId,
      blobKey: id('blob'), path: '/api/v1/projects/' + state.projectId + '/attachments/' + attachmentId,
      sha256: digest(file), byteSize: file.length,
    }
    const { snapshot } = unwrap(await decodeProjectFile(Buffer.from(state.archive, 'base64')))
    const projectId = snapshot.project.id
    const createdAt = stamp()
    const blob = { projectId, blobKey: ref.blobKey, sha256: ref.sha256, byteSize: ref.byteSize }
    snapshot.blobs.push(blob)
    snapshot.attachments.push({ blobKey: ref.blobKey, bytes: file })
    if (kind === 'pdf') {
      let inspection
      try {
        inspection = await inspectSourcePdf(file)
      } catch (error) {
        throw new HttpError(422, error.code ?? 'INVALID_PDF', error.message)
      }
      signal.throwIfAborted()
      const documentId = id('doc')
      snapshot.documents.push({ id: documentId, projectId, title: fileName, latestRevisionId: attachmentId })
      snapshot.revisions.push({ ...blob, id: attachmentId, documentId, fileName, createdAt, pageCount: inspection.pageCount })
      snapshot.events.push({ id: id('event'), projectId, type: 'source_import', createdAt, documentId, revisionId: attachmentId })
      const clauses = await importRequirements({
        bytes: file, documentRef: ref.path, documentName: fileName, sha256: ref.sha256, pageCount: inspection.pageCount,
      })
      if (clauses.length) {
        const { model, requirements } = interpret(clauses)
        state.template = 'builtin-mounting-plate'
        state.plateModel = model
        state.plateRequirements = requirements
        state.spacer = null
        state.draftRevision = id('draft')
      }
    } else {
      const parsed = unwrap(parseStl(new Uint8Array(file)))
      const partId = id('part')
      const model = { modelRevisionId: attachmentId, partId, kind: 'stl', parentModelRevisionId: null,
        createdAt, reason: '云端上传', fileName, blobKey: ref.blobKey, attachmentSha256: ref.sha256,
        byteSize: ref.byteSize, encoding: parsed.encoding, triangleCount: parsed.triangleCount, bounds: parsed.bounds, unitNote: '' }
      const part = { partId, kind: 'imported-mesh', name: fileName, currentModelRevisionId: attachmentId, origin: 'stl-import' }
      snapshot.project = { ...snapshot.project, parts: [...snapshot.project.parts, part], modelRevisions: [...snapshot.project.modelRevisions, model] }
    }
    state.archive = Buffer.from(unwrap(await encodeProjectFile(snapshot)).bytes).toString('base64')
    state.attachments[attachmentId] = { ref, fileName, bytes: file.toString('base64') }
    record(state, 'attachment_uploaded', principal, { attachmentId, kind })
    return ref
  }

  async function create(input, principal, signal) {
    if (!principal.write) throw new HttpError(403, 'WRITE_FORBIDDEN')
    let snapshot
    let importedAttachments
    let template = input.template ?? 'empty'
    if (input.kind === 'cunlian') {
      const decoded = unwrap(await decodeProjectFile(input.file))
      const byKey = new Map(decoded.snapshot.attachments.map(row => [row.blobKey, row.bytes]))
      importedAttachments = Object.fromEntries(decoded.manifest.attachments.flatMap(ref => {
        const bytes = byKey.get(ref.blobKey)
        return bytes ? [[ref.revisionId, { ref, bytes: Buffer.from(bytes).toString('base64') }]] : []
      }))
      snapshot = upgradeSnapshotToCurrent(decoded.snapshot, { newRevisionId: () => id('rev') }).snapshot
      if (snapshot.project.parameters.length && snapshot.project.dimensionChain.terms.some(term => term.id === 't-s')) {
        template = 'builtin-shaft-spacer'
      }
    } else {
      snapshot = createNewProjectSnapshot({
        name: input.name ?? input.fileName,
        template: template === 'builtin-shaft-spacer' || template === 'chain-demo' ? 'chain-demo' : 'empty',
        appVersion: 'cunlian-cloud', electronVersion: 'n/a',
      })
    }
    const projectId = input.kind === 'cunlian' ? id('project') : snapshot.project.id
    const spacer = template === 'builtin-shaft-spacer' || template === 'chain-demo'
      ? Object.fromEntries(keys.map(key => [key, snapshot.project.parameters.find(row => row.key === key.slice(0, -1))?.valueQ ?? defaultSpacer[key]]))
      : null
    const requirement = snapshot.project.requirementRevisions.find(row => row.revisionId === snapshot.project.activeRequirementRevisionId)
    const state = {
      projectId, name: snapshot.project.name, baseRevision: snapshot.project.currentRevisionId,
      template, imported: input.kind === 'cunlian', draftRevision: template !== 'empty' ? id('draft') : null, spacer,
      sources: Object.fromEntries(keys.map(key => [key, userSource])),
      archive: Buffer.from(unwrap(await encodeProjectFile(snapshot)).bytes).toString('base64'),
      importedAttachments, attachments: {}, exports: {}, events: [], activities: [], receipts: [], commits: [], outbox: [],
      authorized: [principal.name], lease: null, epoch: 0,
      requirement: requirement ? { minQ: requirement.lowerQ, maxQ: requirement.upperQ } : null,
    }
    record(state, input.kind ? 'project_imported' : 'project_created', principal)
    if (input.kind && input.kind !== 'cunlian') await attachment(state, input, principal, signal)
    await storage.write(projectId, state, signal)
    return summary(state)
  }

  function confirmation(state, principal, review, expires) {
    return createHmac('sha256', config.approvalSecret).update(JSON.stringify([
      state.projectId, state.baseRevision, state.draftRevision, state.epoch, principal.name,
      review.checksetFingerprint, expires,
    ])).digest('hex')
  }

  async function commit(state, body, principal, signal) {
    if (state.gdtDraft && !config.feature3dAssemblyM1) throw new HttpError(422, 'FEATURE_DISABLED')
    if (body.projectId !== state.projectId || body.baseRevision !== state.baseRevision) throw new HttpError(409, 'STALE_BASE')
    draftMatches(state, body.draftRevision)
    requireWriter(state, principal)
    const review = await engine.checks(state, signal)
    if (body.checksetFingerprint !== review.checksetFingerprint) throw new HttpError(409, 'STALE_CHECKSET')
    if (review.checks.some(item => item.required && item.status !== 'pass')) throw new HttpError(422, 'CHECKS_BLOCKED')
    const [expires, signature, extra] = body.confirmationToken.split('.')
    if (!config.approvalSecret || extra !== undefined || !/^\d{13}$/.test(expires)
      || Number(expires) < Date.now() || !equal(signature, confirmation(state, principal, review, expires))) {
      throw new HttpError(422, 'CONFIRMATION_INVALID')
    }
    if (body.webhook) config.webhookUrl(body.webhook.url)
    const result = {
      projectId: state.projectId, committedRevision: id('rev'), committedDraftRevision: state.draftRevision,
      previousBaseRevision: state.baseRevision, nextDraftRevision: null,
      checksetFingerprint: review.checksetFingerprint, committedAtLabel: stamp(),
      summary: review.checks.map(item => item.checkId + '=' + item.status).join(', '),
    }
    const { snapshot } = unwrap(await decodeProjectFile(Buffer.from(state.archive, 'base64')))
    const computed = state.spacer && state.template !== 'builtin-mounting-plate'
      && computeProjectSpacer(snapshot, state, result.committedRevision)
    const project = {
      ...snapshot.project, currentRevisionId: result.committedRevision, updatedAt: result.committedAtLabel,
      ...(state.gdtDraft && { assembly3d: state.gdtDraft.assembly }),
      ...(computed && {
        parameters: computed.parameters,
        dimensionChain: computed.chain,
        dimensionLinks: [...snapshot.project.dimensionLinks.filter(link => link.kind !== 'parameter-binding'), ...computed.bindings],
        drawings: [computed.drawing.record, ...snapshot.project.drawings.slice(1)],
        currentRequirementCheck: null,
      }),
    }
    const event = { id: id('event'), projectId: project.id, type: 'project_revision_committed',
      revisionId: result.committedRevision, createdAt: result.committedAtLabel, message: result.summary }
    const archive = await encodeProjectFile({
      ...snapshot, project, events: [...snapshot.events, event],
      fileRevisions: [...snapshot.fileRevisions, {
        project, revisionId: result.committedRevision, parentId: state.baseRevision,
        createdAt: result.committedAtLabel, reason: '云端人工确认',
      }],
    })
    const formats = state.spacer || state.template === 'builtin-mounting-plate' ? ['svg', 'dxf-r12', 'dxf-2000'] : []
    const renderings = await Promise.all(formats.map(async format => {
      const item = await engine.drawing(state, format, signal)
      return [format, { fingerprint: item.fingerprint, bytes: Buffer.from(item.bytes).toString('base64') }]
    }))
    requireWriter(state, principal)
    state.archive = Buffer.from(unwrap(archive).bytes).toString('base64')
    state.commits.push({ result, requestId: body.requestId, plateModel: state.plateModel, spacer: state.spacer, review })
    for (const [format, item] of renderings) state.exports[body.draftRevision + ':' + format] = item
    state.baseRevision = result.committedRevision
    state.draftRevision = null
    delete state.gdtDraft
    if (body.webhook) state.outbox.push({ url: body.webhook.url, result, attempts: 0, next: Date.now() })
    record(state, event.type, principal, { revisionId: result.committedRevision, draftRevision: result.committedDraftRevision })
    return result
  }

  const mutate = (projectId, principal, signal, apply) =>
    storage.transact(projectId, signal, state => {
      authorize(state, principal)
      return apply(state)
    })

  return {
    read, create, summary,
    async list(principal) {
      const states = await Promise.all((await storage.ids()).map(projectId => storage.read(projectId)))
      return { projects: states.filter(state => state.authorized.includes(principal.name)).map(summary) }
    },
    attach: (projectId, body, principal, signal) => mutate(projectId, principal, signal, state => {
      requireWriter(state, principal)
      return attachment(state, body, principal, signal)
    }),
    authorize: (projectId, principal, signal) => storage.transact(projectId, signal, state => {
      if (!state.authorized.includes(principal.name)) {
        state.authorized.push(principal.name)
        record(state, 'project_authorized', principal)
      }
      return { projectId, authorized: true }
    }),
    lease: (projectId, operation, body, principal, signal) => mutate(projectId, principal, signal, state => {
      if (!principal.write) throw new HttpError(403, 'WRITE_FORBIDDEN')
      const owner = holder(state)
      if (operation === 'revoke') {
        if (owner && owner !== principal.name && !principal.takeover) throw new HttpError(409, 'WRITER_OCCUPIED')
        state.lease = null
        state.epoch++
        record(state, 'writer_revoked', principal)
        return { revoked: true }
      }
      if (state.epoch !== body.expectedWriterEpoch) throw new HttpError(409, 'STALE_WRITER_EPOCH')
      if (owner && owner !== principal.name && operation !== 'takeover') throw new HttpError(409, 'WRITER_OCCUPIED')
      if (operation === 'takeover' && !principal.takeover) throw new HttpError(403, 'TAKEOVER_FORBIDDEN')
      if (owner !== principal.name) state.epoch++
      state.lease = { owner: principal.name, until: Date.now() + config.leaseMs }
      record(state, 'writer_' + operation, principal, { writerEpoch: state.epoch })
      return writerState(state)
    }),
    context, holder,
    stageGdt: (operation, raw, principal, signal) => mutate(raw.projectId, principal, signal, state => {
      if (!config.feature3dAssemblyM1) throw new HttpError(422, 'FEATURE_DISABLED')
      requireWriter(state, principal)
      const isDatum = operation === 'stage_datum'
      const parsed = (isDatum ? stageDatumSchema : stageGdtSchema).safeParse(raw)
      if (!parsed.success) throw new HttpError(422, 'INVALID_GDT', parsed.error.message)
      const request = parsed.data
      if (state.epoch !== request.expectedWriterEpoch) throw new HttpError(409, 'STALE_WRITER_EPOCH')
      return replay(state, principal, { operation, ...request }, async () => {
        if (state.baseRevision !== request.baseRevision) throw new HttpError(409, 'STALE_BASE')
        if (state.draftRevision !== request.expectedDraftRevision) throw new HttpError(409, 'STALE_DRAFT')
        const { snapshot } = unwrap(await decodeProjectFile(Buffer.from(state.archive, 'base64')))
        const assembly = state.gdtDraft?.assembly ?? snapshot.project.assembly3d
        if (!assembly) throw new HttpError(422, 'ASSEMBLY_REQUIRED')
        let updated
        try {
          updated = isDatum ? stageDatums(assembly, request) : stageControls(assembly, request)
        } catch (error) {
          throw new HttpError(422, 'INVALID_GDT', error.message)
        }
        let sources
        try {
          sources = gdtSources(snapshot, updated, request.items)
        } catch {
          throw new HttpError(422, 'REFERENCE_STALE')
        }
        signal.throwIfAborted()
        requireWriter(state, principal)
        const evidence = { ...state.gdtDraft?.evidence }
        for (const [itemId, source] of Object.entries(sources)) evidence[operation + ':' + itemId] = source
        state.gdtDraft = { assembly: updated, evidence }
        state.draftRevision = id('draft')
        record(state, 'draft_staged', principal, { draftRevision: state.draftRevision })
        return { projectId: raw.projectId, draftRevision: state.draftRevision, warnings: assemblyWarnings(updated) }
      })
    }),
    async analyzeGdt(raw, principal, signal) {
      if (!config.feature3dAssemblyM1) throw new HttpError(422, 'FEATURE_DISABLED')
      const parsed = analyzeGdtSchema.safeParse(raw)
      if (!parsed.success) throw new HttpError(422, 'INVALID_GDT', parsed.error.message)
      const request = parsed.data
      const verify = state => {
        requireWriter(state, principal)
        if (state.epoch !== request.expectedWriterEpoch) throw new HttpError(409, 'STALE_WRITER_EPOCH')
        draftMatches(state, request.draftRevision)
      }
      const state = await read(raw.projectId, principal)
      verify(state)
      const assembly = state.gdtDraft?.assembly ??
        unwrap(await decodeProjectFile(Buffer.from(state.archive, 'base64'))).snapshot.project.assembly3d
      if (!assembly) throw new HttpError(422, 'ASSEMBLY_REQUIRED')
      let result
      try {
        result = await engine.gdtAnalyzer.run(assembly, request, { signal, timeoutMs: config.timeoutMs })
      } catch (error) {
        signal.throwIfAborted()
        throw new HttpError(422, /^[A-Z_]+$/.test(error.message) ? error.message : 'SIMULATION_FAILED')
      }
      verify(await read(raw.projectId, principal))
      try {
        await mutate(raw.projectId, principal, signal, current => {
          if (current.gdtDraft && current.draftRevision === request.draftRevision) {
            current.gdtDraft.analysis = { draftRevision: request.draftRevision, baseline: result.baseline }
          }
        })
      } catch {
        // Non-fatal cache update; analysis result is still valid
      }
      return result
    },
    stage: (projectId, change, principal, signal) => mutate(projectId, principal, signal, state => {
      requireWriter(state, principal)
      return replay(state, principal, change, () => {
        if (change.baseRevision !== state.baseRevision || change.expectedDraftRevision !== state.draftRevision) {
          throw new HttpError(409, 'STALE_DRAFT')
        }
        if (state.template === 'builtin-mounting-plate' || (state.imported && !state.spacer)) {
          return { kind: 'clarification', code: 'UNSUPPORTED_SCOPE',
            question: { questionId: id('question'), reason: 'ambiguousReference', prompt: '此项目不支持隔套草稿。', anchors: [] } }
        }
        const operation = change.operation
        const resume = operation.type === 'resumeSpacerDraft'
        const task = resume && state.activities.find(row => row.taskId === operation.taskId && row.status === 'awaitingInput')
        if (resume && !task) throw new HttpError(409, 'STALE_TASK')
        const parameters = { ...state.spacer, ...task?.parameters }
        const sources = { ...state.sources, ...task?.sources }
        for (const key of keys) {
          if (operation[key] !== undefined) {
            if (!change.sources[key]) throw new HttpError(422, 'SOURCE_REQUIRED')
            parameters[key] = operation[key]
            sources[key] = change.sources[key]
          }
        }
        const missing = keys.filter(key => parameters[key] === undefined)
        if (missing.length) {
          const activity = {
            taskId: task?.taskId ?? id('task'), projectId, source: 'external', baseRevision: state.baseRevision,
            draftRevision: null, lastStep: 'stageChange', errorCode: null, status: 'awaitingInput',
            question: { questionId: id('question'), reason: 'missing', prompt: missing.join(', '), anchors: [] },
            updatedAtMs: Date.now(),
          }
          state.activities = [...state.activities.filter(row => row.taskId !== activity.taskId), { ...activity, parameters, sources }]
          record(state, 'draft_input_requested', principal, { taskId: activity.taskId })
          return { draftRevision: null, activity }
        }
        try {
          spacerParametersFromQ(parameters)
        } catch (error) {
          throw new HttpError(422, 'INVALID_PARAMETER', error.message)
        }
        if (task) Object.assign(task, { status: 'succeeded', question: null, updatedAtMs: Date.now() })
        state.spacer = parameters
        state.sources = sources
        state.draftRevision = id('draft')
        record(state, 'draft_staged', principal, { draftRevision: state.draftRevision })
        return { ...parameters, sources, question: null, draftRevision: state.draftRevision }
      })
    }),
    move: (projectId, body, principal, signal) => mutate(projectId, principal, signal, state => {
      requireWriter(state, principal)
      return replay(state, principal, body, () => {
        if (state.template !== 'builtin-mounting-plate') throw new HttpError(422, 'UNSUPPORTED_SCOPE')
        if (state.baseRevision !== body.baseRevision) throw new HttpError(409, 'STALE_BASE')
        draftMatches(state, body.expectedDraftRevision)
        const model = state.plateModel ?? createMountingPlate()
        const right = model.holes.find(hole => hole.id === model.bindings['hole.right.axis'])
        if (!right || !Number.isSafeInteger(right.x.nominalQ + body.deltaQ)) throw new HttpError(422, 'INVALID_PARAMETER')
        right.x.nominalQ += body.deltaQ
        state.plateModel = model
        state.draftRevision = id('draft')
        record(state, 'draft_staged', principal, { draftRevision: state.draftRevision })
        return { jobId: id('job'), revision: state.draftRevision }
      })
    }),
    commit: (projectId, revision, body, principal, signal) => mutate(projectId, principal, signal, state => {
      if (revision !== body.draftRevision) throw new HttpError(409, 'STALE_DRAFT')
      return commit(state, body, principal, signal)
    }),
    async review(state, principal, revision, approval, signal) {
      draftMatches(state, revision)
      const review = await engine.checks(state, signal)
      let token
      if (approval !== undefined) {
        requireWriter(state, principal)
        if (!config.approvalSecret || !equal(approval, config.approvalSecret)) throw new HttpError(403, 'APPROVAL_FORBIDDEN')
        const expires = String(Date.now() + config.confirmationMs)
        token = expires + '.' + confirmation(state, principal, review, expires)
      }
      const value = {
        review,
        summary: review.checks.map(item => item.title + ' ' + item.status).join(', '),
        baseRevision: state.baseRevision,
      }
      if (config.feature3dAssemblyM1) {
        const assembly = state.gdtDraft?.assembly ?? null
        const hasStagedGdt = Boolean(
          assembly && (assembly.datums.length > 0 || assembly.gdt.length > 0 || state.gdtDraft?.analysis),
        )
        if (hasStagedGdt) {
          let analysisMetrics =
            state.gdtDraft?.analysis?.draftRevision === revision ? state.gdtDraft.analysis.baseline : null
          if (!analysisMetrics && assembly.gdt.length > 0) {
            try {
              const analyzed = await engine.gdtAnalyzer.run(
                assembly,
                {
                  projectId: state.projectId,
                  draftRevision: revision,
                  expectedWriterEpoch: state.epoch,
                  monteCarlo: { seed: 42, samples: 2000, distribution: 'normal' },
                },
                { signal, timeoutMs: config.timeoutMs },
              )
              analysisMetrics = analyzed.baseline
            } catch {
              signal.throwIfAborted()
              analysisMetrics = null
            }
          }
          value.gdtSnapshot = {
            datums: assembly.datums,
            gdt: assembly.gdt,
            gdtControls: assembly.gdt,
            contributions: analysisMetrics?.contributions ?? [],
            warnings: analysisMetrics?.warnings ?? assemblyWarnings(assembly),
            ...(analysisMetrics
              ? {
                  metrics: {
                    cpk: analysisMetrics.cpk,
                    ppm: analysisMetrics.ppm,
                    threeSigmaIntervalMm: analysisMetrics.threeSigmaIntervalMm,
                  },
                }
              : {}),
          }
        }
      }
      return { token, value }
    },
    draftMatches,
    activities: state => state.activities.map(({ parameters, sources, ...activity }) => activity),
    saveExport: (projectId, revision, format, item, principal, signal) => mutate(projectId, principal, signal, state => {
      if (state.draftRevision !== revision && !state.commits.some(row => row.result.committedDraftRevision === revision)) {
        throw new HttpError(409, 'STALE_DRAFT')
      }
      state.exports[revision + ':' + format] = { fingerprint: item.fingerprint, bytes: Buffer.from(item.bytes).toString('base64') }
    }),
  }
}
