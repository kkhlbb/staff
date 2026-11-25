import { computeCheckSetFingerprint, type M3CommitApprovedDraftRequest, type M3CommitApprovedDraftResult, type M3UndoDraftChangeRequest, type M3UndoDraftChangeResult } from '../../../shared/project-agent/m3-lifecycle'
import { createHash, randomUUID } from 'node:crypto'
import type {
  M2ArtifactSlotState, M2CheckItem, M2ClarificationSubmitRequest, M2DrawingAnnotationItem,
  M2DrawingFailureNotice, M2LocateEvidenceRequest, M2ModelFeatureItem, M2PreviewEvent,
  M2PreviewSnapshot, M2RetryDrawingRequest, M2RetryDrawingResult,
} from '../../../shared/project-agent/m2-preview'
import { fingerprint, runMountingPlate, runMountingPlateDrawing, type Drawing, type GeometryReport } from './engine.mjs'
import type { M2DraftInputs, M2Journal, openM2DraftStore } from './draftStore'
import type { MountingPlate } from './model.mjs'
import { importRequirements, interpret, type RequirementsSource } from './requirements'

type Clause = Awaited<ReturnType<typeof importRequirements>>[number]
const empty: M2ArtifactSlotState = { status: 'empty', revision: null, revisionOrder: null, isDraft: true, fingerprint: null }
const requirementRoles: Record<string, string[]> = {
  'MP-01': ['plate.rightFace', 'plate.topFace'],
  'MP-02': ['hole.left.axis', 'hole.right.axis'],
  'MP-03': ['hole.right.axis', 'plate.rightFace'],
  'MP-04': ['plate.topFace', 'cover.bottomFace'],
  'MP-05': ['plate.topFace', 'cover.bottomFace'],
}
interface Revision {
  order: number
  model: MountingPlate
  clauses: Clause[]
  requirements: ReturnType<typeof interpret>['requirements']
  fingerprint: string
  job: { id: string; controller: AbortController; scheduled: boolean; done?: Promise<void> }
  report?: GeometryReport
  features: M2ModelFeatureItem[]
  checks: M2CheckItem[]
  drawing?: Drawing
  annotations: M2DrawingAnnotationItem[]
  failure?: M2DrawingFailureNotice
  checking: boolean
  completed: boolean
  drawAttempt: number
  retry?: Promise<M2RetryDrawingResult>
  previousDrawing?: Revision
  events: Map<M2PreviewEvent['type'], M2PreviewEvent>
}

export class M2Pipeline {
  private current?: Revision
  private restored = false
  private committedDraftRevision: string | null = null
  fileBaseRevision: string | null = null
  private originalClauses: Clause[] = []
  private readonly revisions = new Map<string, Revision>()
  private readonly requests = new Map<string, { digest: string; value: unknown }>()
  private sequence = 0
  private importGeneration = 0
  private readonly seal: () => void
  private readonly store?: ReturnType<typeof openM2DraftStore>
  private sourceKey?: string
  private revisionOrder = 0
  private sourceCurrent: () => void = () => {}
  private draftInputs: M2DraftInputs = { order: 1, rightHoleOffsetQ: 0, corrections: [] }
  private readonly listeners = new Set<(event: M2PreviewEvent) => void>()

  readonly projectId: string
  private scopeEpoch: number
  private writerEpoch: number
  private readonly engine: { build: typeof runMountingPlate; draw: typeof runMountingPlateDrawing }

  constructor(projectId: string, scopeEpoch: number, writerEpoch: number,
    engine = { build: runMountingPlate, draw: runMountingPlateDrawing }, seal = () => {}, store?: ReturnType<typeof openM2DraftStore>) {
    this.projectId = projectId
    this.scopeEpoch = scopeEpoch
    this.writerEpoch = writerEpoch
    this.engine = engine
    this.seal = seal
    this.store = store
  }

  rebind(scopeEpoch: number, writerEpoch: number) {
    if (scopeEpoch === this.scopeEpoch && writerEpoch === this.writerEpoch) return
    this.scopeEpoch = scopeEpoch
    this.writerEpoch = writerEpoch
    const previous = this.current
    if (previous && !previous.completed && !previous.failure) this.start(previous.model, previous.clauses, previous.requirements, previous.order)
  }

  subscribe(listener: (event: M2PreviewEvent) => void) {
    this.listeners.add(listener)
    // A snapshot can finish before the renderer subscribes. Replay the current cut in sequence order.
    const state = this.current
    const initial = state && [...state.events.values()].sort((a, b) => a.sequence - b.sequence)
    queueMicrotask(() => {
      if (!state || !initial || !this.listeners.has(listener) || !this.live(state)) return
      for (const event of initial) listener({ ...event, scopeEpoch: this.scopeEpoch, writerEpoch: this.writerEpoch })
    })
    return () => { this.listeners.delete(listener) }
  }

  dispose() {
    this.importGeneration++
    if (this.current) this.cancelJob(this.current.job.id)
    this.listeners.clear()
  }

  reconcileSources(keys: ReadonlySet<string>) {
    if (!this.sourceKey || keys.has(this.sourceKey)) return
    if (this.current) this.cancelJob(this.current.job.id)
    this.current = undefined
    this.sourceKey = undefined
    this.sourceCurrent = () => {}
    this.revisions.clear()
    this.requests.clear()
  }

  async importRequirements(source: RequirementsSource, seal: () => void = () => {}) {
    const generation = ++this.importGeneration
    const base = this.current
    const clauses = await importRequirements(source)
    seal()
    if (generation !== this.importGeneration || base !== this.current) throw Error('STALE_BASE')
    if (clauses.length === 0) return null
    const key = fingerprint([source.documentRef, source.sha256])
    const journal = this.store?.read()
    const stored = journal?.sourceKey === key ? journal.inputs : undefined
    this.restored = !!stored
    this.committedDraftRevision = journal?.versions.at(-1)?.draftRevision ?? null
    this.originalClauses = structuredClone(clauses)
    for (const correction of stored?.corrections ?? []) {
      const clause = clauses.find(item => item.id === correction.targetId)
      if (clause) clause.correction = { mode: correction.mode, content: correction.content }
    }
    const { model, requirements } = interpret(clauses)
    const right = model.holes.find(hole => hole.role === 'hole.right.axis')
    if (right) right.x.nominalQ += stored?.rightHoleOffsetQ ?? 0
    const order = Math.max(this.revisionOrder + 1, stored?.order ?? (journal ? journal.inputs.order + 1 : 1))
    this.sourceKey = key
    this.sourceCurrent = seal
    this.draftInputs = { order, rightHoleOffsetQ: stored?.rightHoleOffsetQ ?? 0, corrections: stored?.corrections ?? [] }
    return this.start(model, clauses, requirements, order)
  }

  stageChange(revision: string, requestId: string, change: { kind: 'moveRightHoleX'; deltaQ: number }) {
    const input = change
    return this.once('change', requestId, input, () => {
      const receipt = this.savedReply<ReturnType<M2Pipeline['start']>>('change', requestId, input)
      if (receipt) return receipt
      const base = this.requireCurrent(revision)
      const model = structuredClone(base.model)
      const right = model.holes.find(hole => hole.role === 'hole.right.axis')
      const delta = change.deltaQ
      if (!right || model.bindings['hole.right.axis'] !== right.id || !Number.isSafeInteger(delta) || delta === 0) throw Error('INVALID_REQUEST')
      right.x.nominalQ += delta
      const order = base.order + 1
      const value = { jobId: randomUUID(), revision: 'draft-' + order }
      this.saveInputs({ ...this.draftInputs, order, rightHoleOffsetQ: this.draftInputs.rightHoleOffsetQ + delta },
        { operation: 'change', requestId, digest: fingerprint(input), value })
      return this.start(model, base.clauses, base.requirements, order, value.jobId)
    })
  }

  buildAndCheck(revision: string) {
    const state = this.requireCurrent(revision)
    if (!state.job.scheduled) {
      state.job.scheduled = true
      state.job.done = Promise.resolve().then(() => this.run(state))
    }
    return { jobId: state.job.id }
  }

  cancelJob(jobId: string) {
    const state = this.current
    if (!state || state.job.id !== jobId || state.completed || state.job.controller.signal.aborted) return false
    state.job.controller.abort()
    state.checking = false
    return true
  }

  private transact<T>(run: (journal: M2Journal) => { next?: M2Journal; value: T }) {
    if (!this.store || !this.sourceKey) throw Error('AUTH_REQUIRED')
    const sourceKey = this.sourceKey
    return this.store.transact(previous => {
      if (previous?.sourceKey === sourceKey) return run(previous)
      if (previous && previous.inputs.order >= this.draftInputs.order) throw Error('STALE_BASE')
      return run({ schema: 1, sourceKey, inputs: this.draftInputs, history: [],
        versions: previous?.versions ?? [], receipts: previous?.receipts ?? [] })
    }, () => { this.seal(); this.sourceCurrent() })
  }

  private savedReply<T>(operation: 'change' | 'clarification', requestId: string, input: unknown): T | undefined {
    const receipt = this.store?.read()?.receipts.find(item => item.requestId === requestId)
    if (!receipt) return
    if (receipt.operation !== operation || receipt.digest !== fingerprint(input)) throw Error('REQUEST_COLLISION')
    return receipt.value as T
  }

  private saveInputs(next: M2DraftInputs, receipt: M2Journal['receipts'][number]) {
    this.seal()
    this.sourceCurrent()
    if (this.store && this.sourceKey) this.transact(journal => {
      if (journal.inputs.order !== this.draftInputs.order) throw Error('STALE_BASE')
      if (journal.receipts.some(item => item.requestId === receipt.requestId)) throw Error('REQUEST_COLLISION')
      return { next: { ...journal, inputs: next, history: [...journal.history, this.draftInputs],
        receipts: [...journal.receipts, receipt] }, value: null }
    })
    this.draftInputs = next
  }

  get baseRevision() {
    return this.store?.read()?.versions.at(-1)?.revision ?? this.fileBaseRevision
  }

  async commit(request: M3CommitApprovedDraftRequest, confirm: () => Promise<boolean>, verify: () => void) {
    const digest = fingerprint(request)
    const confirmationHash = createHash('sha256').update(request.confirmationToken).digest('hex')
    const validate = (journal: M2Journal) => {
      verify()
      const receipt = journal.receipts.find(item => item.requestId === request.requestId)
      if (receipt) {
        if (receipt.operation !== 'commit' || receipt.digest !== digest) throw Error('DUPLICATE_REQUEST')
        return { replay: receipt.value as M3CommitApprovedDraftResult } as const
      }
      if (journal.receipts.some(item => item.confirmationHash === confirmationHash)) throw Error('CONFIRMATION_EXPIRED')
      const base = journal.versions.at(-1)
      if ((base?.revision ?? this.fileBaseRevision) !== request.baseRevision ||
        journal.inputs.order !== this.draftInputs.order) throw Error('BASE_REVISION_CONFLICT')
      const state = this.current
      if (!state || state.model.revision !== request.draftRevision || base?.draftRevision === request.draftRevision ||
        state.job.controller.signal.aborted || state.failure || !state.completed || !state.report ||
        state.report.revision !== request.draftRevision || state.drawing?.revision !== request.draftRevision) {
        throw Error('FINGERPRINT_MISMATCH')
      }
      const preview = this.snapshot()
      const required = preview.checks.filter(item => item.required)
      if (!required.length || required.some(item => item.status !== 'pass') ||
        preview.requirements.some(item => item.required && (item.status !== 'confirmed' ||
          !required.some(check => check.requirementId === item.requirementId)))) throw Error('CHECKS_BLOCKED')
      if (required.some(item => item.revisionFingerprint !== state.fingerprint) ||
        computeCheckSetFingerprint({ ...request, checks: preview.checks,
          modelFingerprint: preview.model.fingerprint, drawingFingerprint: preview.drawing.fingerprint }) !== request.checkSetFingerprint) {
        throw Error('FINGERPRINT_MISMATCH')
      }
      return { state, preview } as const
    }
    if (!this.current || !this.sourceKey) {
      verify()
      throw Error('FINGERPRINT_MISMATCH')
    }
    const initial = this.transact(journal => ({ value: validate(journal) }))
    if (initial.replay) return initial.replay
    const deadline = Date.now() + 120_000
    if (!await confirm() || Date.now() > deadline) throw Error('CONFIRMATION_EXPIRED')
    const result = this.transact(journal => {
      const validated = validate(journal)
      if (validated.replay) return { value: validated.replay }
      const { state, preview } = validated
      if (state !== initial.state) throw Error('CONFIRMATION_EXPIRED')
      const createdAt = new Date().toISOString()
      const revision = 'formal-' + randomUUID()
      const value: M3CommitApprovedDraftResult = {
        projectId: this.projectId, committedRevision: revision, previousBaseRevision: request.baseRevision,
        committedDraftRevision: request.draftRevision, checkSetFingerprint: request.checkSetFingerprint,
        nextDraftRevision: null, committedAtLabel: createdAt, summary: '已保存正式版本',
      }
      const version = { revision, draftRevision: request.draftRevision, createdAt, checkSetFingerprint: request.checkSetFingerprint,
        artifactHashes: { model: fingerprint(preview.modelMesh), drawing: fingerprint(preview.drawingVector) },
        model: state.model, clauses: state.clauses, solverRules: {
          rulesVersion: state.report!.rulesVersion, solverVersion: state.report!.solverVersion,
          modelingToleranceMm: state.report!.modelingToleranceMm, source: state.report!.source, checks: state.report!.checks,
        },
        preview: { ...preview, model: { ...preview.model, isDraft: false }, drawing: { ...preview.drawing, isDraft: false } } }
      return { value, next: { ...journal, history: [], versions: [...journal.versions, version],
        receipts: [...journal.receipts, { operation: 'commit', requestId: request.requestId, digest, confirmationHash, value }] } }
    })
    this.committedDraftRevision = result.committedDraftRevision
    return result
  }

  async undo(request: M3UndoDraftChangeRequest) {
    this.seal()
    if (!this.sourceKey) throw Error('NOTHING_TO_UNDO')
    const digest = fingerprint(request)
    const result = this.transact<M3UndoDraftChangeResult & { inputs?: M2DraftInputs }>(journal => {
      const receipt = journal.receipts.find(item => item.requestId === request.requestId)
      if (receipt) {
        if (receipt.operation !== 'undo' || receipt.digest !== digest) throw Error('DUPLICATE_REQUEST')
        return { value: receipt.value as M3UndoDraftChangeResult }
      }
      const previous = journal.history.at(-1)
      if (!previous) throw Error('NOTHING_TO_UNDO')
      if (!request.draftRevision || this.current?.model.revision !== request.draftRevision ||
        journal.inputs.order !== this.draftInputs.order) throw Error('BASE_REVISION_CONFLICT')
      const inputs = { ...previous, order: this.revisionOrder + 1 }
      const value = { projectId: this.projectId, previousDraftRevision: request.draftRevision,
        restoredDraftRevision: 'draft-' + inputs.order, summary: '已撤销最近一次草稿变更' }
      return { value: { ...value, inputs }, next: { ...journal, inputs, history: journal.history.slice(0, -1),
        receipts: [...journal.receipts, { operation: 'undo', requestId: request.requestId, digest, value }] } }
    })
    const { inputs, ...value } = result
    if (inputs) {
      const clauses = structuredClone(this.originalClauses)
      for (const correction of inputs.corrections) {
        const clause = clauses.find(item => item.id === correction.targetId)
        if (clause) clause.correction = { mode: correction.mode, content: correction.content }
      }
      const { model, requirements } = interpret(clauses)
      const right = model.holes.find(hole => hole.role === 'hole.right.axis')
      if (right) right.x.nominalQ += inputs.rightHoleOffsetQ
      this.draftInputs = inputs
      this.start(model, clauses, requirements, inputs.order)
    }
    const state = this.revisions.get(value.restoredDraftRevision ?? '')
    await state?.job.done
    return { ...value, previewSnapshot: state ? this.snapshot(state.model.revision) : undefined }
  }

  async restore(revision?: string | null) {
    const current = revision ? this.revisions.get(revision) : this.current
    await current?.job.done
    const journal = this.store?.read()
    const versions = journal?.versions ?? []
    const base = versions.at(-1)
    const draftRevision = this.current?.model.revision === base?.draftRevision ? null : this.current?.model.revision ?? null
    if (revision && !current && !versions.some(version => version.draftRevision === revision || version.revision === revision)) {
      throw Error('DRAFT_NOT_FOUND')
    }
    const formal = revision ? versions.find(version => version.draftRevision === revision || version.revision === revision) : base
    const previewSnapshot = (revision || !draftRevision ? formal : undefined)?.preview ?? this.snapshot(revision)
    return { baseRevision: base?.revision ?? this.fileBaseRevision, draftRevision, previewSnapshot,
      formalVersions: versions.map(version => ({ revision: version.revision, committedAtLabel: version.createdAt,
        summary: '安装板正式版本', isCurrent: base === version })),
      uncommittedDrafts: draftRevision ? [{ draftRevision, baseRevision: base?.revision ?? this.fileBaseRevision, updatedAtLabel: '',
        status: this.current?.completed ? (this.current.checks.some(check => check.required && check.status !== 'pass')
          ? 'blocked' as const : 'passed' as const) : 'in_progress' as const,
        summary: '安装板草稿', canUndo: !!journal?.history.length }] : [],
      restoreStatus: { restoredFromDisk: this.restored || !!base, baseRevision: base?.revision ?? this.fileBaseRevision, draftRevision,
        restoredSourceCount: new Set(previewSnapshot.requirements.map(item => item.anchor.documentRef)).size,
        viewsConsistentWithSnapshot: previewSnapshot.model.revision === previewSnapshot.drawing.revision,
        summary: this.restored || base ? '已从磁盘恢复' : '当前项目' } }
  }

  private start(model: MountingPlate, clauses: Clause[], requirements: Revision['requirements'], order = this.revisionOrder + 1, jobId = randomUUID()) {
    const previous = this.current
    if (previous) this.cancelJob(previous.job.id)
    model = { ...model, revision: 'draft-' + order }
    const state: Revision = {
      order, model, clauses, requirements, fingerprint: fingerprint({ model, clauses }),
      job: { id: jobId, controller: new AbortController(), scheduled: false }, checking: true,
      features: [], annotations: [], checks: [], drawAttempt: 0, completed: false, events: new Map(),
      previousDrawing: previous?.drawing ? previous : previous?.previousDrawing,
    }
    this.current = state
    this.revisionOrder = order
    this.revisions.set(model.revision, state)
    return { ...this.buildAndCheck(model.revision), revision: model.revision }
  }

  private live(state: Revision) {
    if (this.current !== state || state.job.controller.signal.aborted) return false
    try { this.seal(); this.sourceCurrent(); return true } catch {
      this.cancelJob(state.job.id)
      return false
    }
  }

  private emit(state: Revision, type: M2PreviewEvent['type'], fields: Partial<M2PreviewEvent> = {}) {
    if (!this.live(state)) return
    const event: M2PreviewEvent = {
      ...fields, type, projectId: this.projectId, scopeEpoch: this.scopeEpoch, writerEpoch: this.writerEpoch,
      sequence: ++this.sequence, revision: state.model.revision, revisionOrder: state.order, isDraft: true,
      fingerprint: state.fingerprint, taskCompleted: type === 'task_completed',
    }
    state.events.set(type, event)
    if (type === 'drawing_ready') state.events.delete('drawing_failed')
    for (const listener of this.listeners) listener(event)
  }

  private slot(state: Revision, status: M2ArtifactSlotState['status']): M2ArtifactSlotState {
    return { status, revision: state.model.revision, revisionOrder: state.order,
      isDraft: state.model.revision !== this.committedDraftRevision, fingerprint: state.fingerprint }
  }

  private async run(state: Revision) {
    if (!this.live(state)) return
    try {
      const report = await this.engine.build(state.model, {
        jobId: state.job.id, signal: state.job.controller.signal, deferDrawing: true,
      })
      if (!this.live(state)) return
      if (!('model' in report)) throw Error(report.error.message)
      state.report = report
      state.features = Object.values(report.references).flatMap(ref => {
        if (!ref.resolved) return []
        const kind = ref.role.startsWith('hole') ? 'hole' : 'face'
        return [{ objectId: ref.featureId, featureRef: ref.role, partName: '安装板组件', role: ref.role, kind,
          breadcrumb: '安装板组件 / ' + ref.role, linkedAnnotationIds: [] }]
      })
      this.link(state)
      this.emit(state, 'model_ready', { modelMesh: report.mesh, features: state.features, requirements: state.requirements, checksInProgress: true })
      this.publishChecks(state)
      await this.draw(state)
    } catch (error) {
      if (!this.live(state) || state.failure) return
      this.publishChecks(state, error instanceof Error ? error.message : '实体生成失败')
      this.failDrawing(state, '缺少有效实体，无法生成图纸', false)
    }
  }

  private link(state: Revision) {
    state.features = state.features.map(feature => ({
      ...feature, linkedAnnotationIds: state.annotations.filter(a => a.linkedFeatureIds.includes(feature.objectId)).map(a => a.annotationId),
    }))
    state.requirements = state.requirements.map(requirement => {
      const roles = requirementRoles[requirement.requirementId] ?? []
      return { ...requirement,
        linkedFeatureIds: [...new Set(state.features.filter(feature => roles.includes(feature.role)).map(f => f.objectId))],
        linkedAnnotationIds: state.annotations.filter(a => a.requirementIds?.includes(requirement.requirementId)).map(a => a.annotationId),
      }
    })
  }

  private publishChecks(state: Revision, detail?: string) {
    state.checking = false
    state.checks = state.requirements.map(requirement => {
      const check = state.report?.checks.find(item => item.id === requirement.requirementId)
      let status: M2CheckItem['status'] = check?.status ?? 'executionFailed'
      if (requirement.status === 'uncovered') status = 'uncovered'
      if (requirement.status === 'conflict' || requirement.status === 'needsClarification') status = 'needsClarification'
      if (requirement.requirementId === 'MP-03' && state.requirements.some(r => r.requirementId === 'MP-02' && r.status !== 'confirmed')) status = 'needsClarification'
      if (requirement.requirementId === 'MP-05' && state.requirements.some(r => r.requirementId === 'MP-04' && r.status !== 'confirmed')) status = 'needsClarification'
      return {
        ...requirement, checkId: requirement.requirementId, status, revisionFingerprint: state.fingerprint,
        summary: check?.intervalMm ? `[${check.intervalMm.join(', ')}] mm` : requirement.interpretation,
        detail: detail ?? check?.reason,
      }
    })
    this.emit(state, 'checks_updated', { checks: state.checks, checksInProgress: false })
  }

  private failDrawing(state: Revision, reason: string, retryable: boolean) {
    state.failure = { failedRevision: state.model.revision, failedRevisionOrder: state.order, reason, retryable }
    this.emit(state, 'drawing_failed', { errorReason: reason, retryable })
  }

  private async draw(state: Revision): Promise<M2RetryDrawingResult> {
    if (!this.live(state) || !state.report) throw Error('STALE_BASE')
    const attempt = ++state.drawAttempt
    let drawing: Drawing
    try {
      drawing = await this.engine.draw(state.report, { jobId: state.job.id, attempt, signal: state.job.controller.signal })
      if (drawing.revision !== state.model.revision) throw Error('图纸修订与模型不一致')
      if (drawing.errors.length) throw Error(drawing.errors.map(error => error.code === 'projectionFailed'
        ? `${error.code}: ${error.message}` : JSON.stringify(error)).join('；'))
    } catch (error) {
      if (!this.live(state)) throw new Error('STALE_BASE', { cause: error })
      this.failDrawing(state, error instanceof Error ? error.message : '图纸生成失败', true)
      throw new Error('DRAWING_FAILED', { cause: error })
    }
    if (!this.live(state)) throw Error('STALE_BASE')
    state.drawing = drawing
    state.failure = undefined
    state.annotations = drawing.annotations.map(annotation => ({
      annotationId: annotation.id, label: annotation.id, view: annotation.view,
      valueText: `${annotation.valueMm.toFixed(drawing.displayDecimals)} mm`,
      linkedFeatureIds: [annotation.reference.featureId],
      requirementIds: Object.keys(requirementRoles).filter(id => requirementRoles[id].includes(annotation.reference.role)),
    }))
    this.link(state)
    this.emit(state, 'drawing_ready', { drawingVector: drawing, annotations: state.annotations, features: state.features, requirements: state.requirements })
    this.publishChecks(state)
    state.completed = true
    this.emit(state, 'task_completed')
    return { projectId: this.projectId, revision: state.model.revision, revisionOrder: state.order,
      fingerprint: state.fingerprint, annotations: state.annotations, drawingVector: drawing }
  }

  private requireCurrent(revision: string | null) {
    if (!this.current || (revision !== null && this.current.model.revision !== revision)) throw Error('STALE_BASE')
    return this.current
  }

  private once<T>(operation: string, requestId: string, input: unknown, run: () => T): T {
    const key = JSON.stringify([this.writerEpoch, operation, requestId])
    const digest = fingerprint(input)
    const existing = this.requests.get(key)
    if (existing) {
      if (existing.digest !== digest) throw Error('REQUEST_COLLISION')
      return existing.value as T
    }
    const value = run()
    this.requests.set(key, { digest, value })
    return value
  }

  retryDrawing(request: M2RetryDrawingRequest) {
    const state = this.requireCurrent(request.revision)
    return this.once('drawing', request.requestId, request, () => {
      if (state.retry) return state.retry
      if (!state.failure?.retryable) throw Error('DRAWING_NOT_RETRYABLE')
      const retry = this.draw(state).finally(() => { state.retry = undefined })
      state.retry = retry
      return retry
    })
  }

  clarify(request: M2ClarificationSubmitRequest) {
    return this.once('clarification', request.requestId, request, () => {
      const receipt = this.savedReply<{ targetId: string; accepted: boolean; updatedInterpretation: string;
        nextRevision: string; message: string }>('clarification', request.requestId, request)
      if (receipt) return receipt
      const base = this.requireCurrent(request.revision)
      const clauses = structuredClone(base.clauses)
      const clause = clauses.find(item => item.id === request.targetId)
      if (!clause) throw Error('NOT_FOUND')
      clause.correction = { mode: request.mode, content: request.content }
      const { model, requirements } = interpret(clauses)
      const right = model.holes.find(hole => hole.role === 'hole.right.axis')
      if (right) right.x.nominalQ += this.draftInputs.rightHoleOffsetQ
      const corrections = this.draftInputs.corrections.filter(item => item.targetId !== request.targetId)
      corrections.push({ targetId: request.targetId, mode: request.mode, content: request.content })
      const order = base.order + 1
      const value = { targetId: request.targetId, accepted: true, updatedInterpretation: request.content,
        nextRevision: 'draft-' + order, message: '回答已保存，正在重算草稿。' }
      this.saveInputs({ ...this.draftInputs, order, corrections },
        { operation: 'clarification', requestId: request.requestId, digest: fingerprint(request), value })
      this.start(model, clauses, requirements, order)
      return value
    })
  }

  snapshot(revision?: string | null): M2PreviewSnapshot {
    const state = revision ? this.revisions.get(revision) : this.current
    if (revision && !state) throw Error('NOT_FOUND')
    const drawing = state?.drawing ? state : state?.previousDrawing
    return { projectId: this.projectId, currentRevision: state?.model.revision ?? null,
      currentRevisionOrder: state?.order ?? null, model: state ? this.slot(state, state.report ? 'ready' : state.checking ? 'building' : 'failed') : empty,
      drawing: drawing ? this.slot(drawing, 'ready') : state ? this.slot(state, state.failure ? 'failed' : 'building') : empty,
      modelMesh: state?.report?.mesh ?? null, drawingVector: drawing?.drawing ?? null,
      drawingFailure: state?.failure ?? null, checksInProgress: state?.checking ?? false,
      features: state?.features ?? [], annotations: drawing?.annotations ?? [],
      requirements: state?.requirements ?? [], checks: state?.checks ?? [] }
  }

  readAttachment(ref: string) {
    if (!this.current) return null
    this.sourceCurrent()
    const anchor = this.current?.clauses.flatMap(clause => clause.anchors).find(item => item.documentRef === ref)
    return anchor ? { excerpt: anchor.excerpt, page: anchor.page } : null
  }

  readSelectedObject(ref: string) {
    if (!this.current) return null
    this.sourceCurrent()
    const feature = this.current?.features.find(item => item.objectId === ref ||
      item.featureRef === ref)
    return feature ? JSON.stringify({ ...feature, draftRevision: this.current?.model.revision }) : null
  }

  locate({ revision, target }: M2LocateEvidenceRequest) {
    const state = revision ? this.revisions.get(revision) : this.current
    const requirement = state?.requirements.find(item => {
      switch (target.kind) {
        case 'check': return item.requirementId === target.requirementId && state.checks.some(c => c.checkId === target.checkId && c.requirementId === item.requirementId)
        case 'requirement': return item.requirementId === target.requirementId
        case 'feature': return requirementRoles[item.requirementId]?.includes(target.featureRef) &&
          state.features.some(f => f.objectId === target.objectId && f.featureRef === target.featureRef)
        case 'annotation': return item.linkedAnnotationIds.includes(target.annotationId)
      }
    })
    if (!state || !requirement) throw Error('NOT_FOUND')
    const id = requirement.requirementId
    const check = state.report?.checks.find(item => item.id === id)
    const anchors = state.clauses.filter(c => c.id === id || (id === 'MP-04' && requirement.status === 'conflict' && c.id === 'MP-01')).flatMap(c => c.anchors)
    return { requirementId: id, checkId: check?.id, anchors, featureIds: requirement.linkedFeatureIds,
      annotationIds: requirement.linkedAnnotationIds, inputs: check?.variables?.map(v => ({
        name: v.id, valueText: `${v.nominalQ / 10_000} ± ${v.toleranceQ / 10_000} mm`,
      })) ?? [], thresholdText: check?.targetMm === undefined ? null : `≥ ${check.targetMm} mm` }
  }
}
