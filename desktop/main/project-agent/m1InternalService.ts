// Main-process journal and internal transaction primitives.
import { promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { assemblyModelV1Schema, assemblyPhysicsSpecSchema, micMatrixPayloadV1Schema } from '../../../src/project-file/assembly3d'
import { analyzeGdtSchema, assemblyWarnings, gdtSources, stageControls, stageDatumSchema, stageDatums,
  stageGdtSchema } from '../../../mcp/lib/gdt'
import { analyzeCompliantSchema, importMicMatrixSchema, stageMicMatrix, stagePhysicsPatch, stagePhysicsSchema,
  verifyEvidenceRefs } from '../../../mcp/lib/compliant'
import { parseAndValidateMicMatrix } from '../../../src/core/solver/mic.mjs'
import type { GdtStageResult, ImportMicMatrixResult, StagePhysicsResult } from '../../../src/transport/types'
import { desktopGdtEnabled, readGdtSnapshot, type GdtToolName } from './gdtTools'
import type { WriteReceipt } from './guards'
import type { ProjectAgentOperation } from '../../shared/project-agent/contracts'
import { checkWrite, checkWriterAcquisition } from './guards'
import { projectAgentResults } from '../../shared/project-agent/contracts'

import { isM1Activity, isM1CreateSpacerDraft, isM1SpacerDraft, spacerDraftEligibility } from '../../shared/project-agent/m1-fields'
import { bool, hash, list, nat, nullable, object, oneOf, positive, text } from '../../shared/project-agent/schema'
import type { Infer } from '../../shared/project-agent/schema'
import { canTransition, isStep, validTaskJournal } from './m1TaskMachine'
import type { TaskStep } from './m1TaskMachine'
import type { M1Activity, M1SpacerDraft } from '../../shared/project-agent/m1-fields'

import { isM1FullEvent } from '../../shared/project-agent/m1-protocol-1915'
import type { M1FullEventPage } from '../../shared/project-agent/m1-protocol-1915'
import type { M1StageResult, M1WriterContext, VerifyM1Binding, VerifiedM1Binding } from './m1StageContracts'

type Caller = Parameters<typeof checkWriterAcquisition>[3]
type Operation = Parameters<typeof checkWrite>[0]
const gdtJournalSchema = z.strictObject({
  baseRevision: z.string(),
  datums: assemblyModelV1Schema.shape.datums,
  gdt: assemblyModelV1Schema.shape.gdt,
  physics: assemblyPhysicsSpecSchema.optional(),
  micAttachments: z.record(z.string(), z.strictObject({
    fileName: z.string(),
    attachment: z.strictObject({
      kind: z.literal('mic-matrix'),
      revisionId: z.string(),
      blobKey: z.string(),
      path: z.string(),
      sha256: z.string(),
      byteSize: z.number().int().positive(),
    }),
    payload: micMatrixPayloadV1Schema,
    evidence: z.array(z.unknown()),
  })).optional(),
  evidence: z.record(z.string(), z.unknown()),
  receipts: z.record(z.string(), z.strictObject({
    digest: z.string(), draftRevision: z.string(), warnings: z.array(z.strictObject({
      code: z.enum(['DRF_UNDERCONSTRAINED', 'DRF_REDUNDANT', 'ILLEGAL_MODIFIER', 'DRF_DEGENERATE']),
      gdtId: z.string(), datumId: z.string().optional(), message: z.string(),
    })).optional(),
    result: z.unknown().optional(),
  })),
})

type RecordState = Parameters<typeof checkWrite>[2] & {
  spacerDraft: M1SpacerDraft | null; revoked: string[]; storage: 2; boot: string; cursor: number; floor: number
  tasks: M1Activity[]; steps: TaskStep[]; draftRefs: string[]
  references: ContentReference[]
  receiptReferences: Record<string, string[]>
  receiptPayloads: Record<string, string>
  grants: Authorization[]
  writerScope: string | null
  gdtDraft?: z.infer<typeof gdtJournalSchema>
  spacerReceipts: SpacerReceipt[]
  receipts: Record<string, WriteReceipt<ProjectAgentOperation>>; events: JournalEvent[]
}
type FullJournalEvent = Extract<M1FullEventPage['events'][number], { type: 'contextChanged' | 'taskChanged' }>
const isFullJournalEvent = (value: unknown): value is FullJournalEvent =>
  isM1FullEvent(value) && (value.type === 'contextChanged' || value.type === 'taskChanged')

const isConnectionMarker = object({ type: oneOf('workbenchConnectionChanged'), sequence: positive,
  projectId: text, baseRevision: nullable(text), draftRevision: nullable(text), jobId: oneOf(null) })
type JournalEvent = FullJournalEvent | Infer<typeof isConnectionMarker>
  | { sequence: number; type: 'contextChanged' }
  | { sequence: number; type: 'taskChanged'; activity?: M1Activity }
const isTaskEvent = object({ sequence: positive, type: oneOf('taskChanged'), activity: isM1Activity })
const isEventHeader = object({ sequence: positive, type: oneOf('contextChanged', 'taskChanged') })

const isAwaiting = object({ draftRevision: oneOf(null), activity: isM1Activity })
type Awaiting = { draftRevision: null; activity: M1Activity }
type SpacerResult = M1SpacerDraft | Awaiting
type SpacerOperation = 'createSpacerDraft' | 'resumeSpacerDraft' | 'updateSpacerDraft'
type SpacerReceipt = { scope: string; operation: SpacerOperation; digest: string; result: SpacerResult; logicalPayload: string; referenceIds: string[] }
const validReceipt = object({
  scope: text, operation: oneOf('createSpacerDraft', 'resumeSpacerDraft', 'updateSpacerDraft'), digest: hash, logicalPayload: text, referenceIds: list(text),
  result: (value: unknown): value is SpacerResult => isM1SpacerDraft(value) ||
    (isAwaiting(value) && value.activity.status === 'awaitingInput' && value.activity.question !== null &&
      value.activity.draftRevision === null),
})
const isStageEnvelope = object({
  baseRevision: nullable(text), expectedDraftRevision: nullable(text), idempotencyKey: text,
  operation: (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype &&
    Object.hasOwn(value, 'type') && text((value as Record<string, unknown>).type),
  sources: (value: unknown): value is unknown => value !== undefined,
})
const isCredentials = object({ writerToken: text, writerEpoch: positive, idempotencyKey: text })
type Credentials = { writerToken: string; writerEpoch: number; idempotencyKey: string }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    const fields = value as Record<string, unknown>
    return '{' + Object.keys(fields).sort().map(key => JSON.stringify(key) + ':' + canonical(fields[key])).join(',') + '}'
  }
  return JSON.stringify(value)
}

const dimensionKeys = ['innerDiameterQ', 'outerDiameterQ', 'lengthQ'] as const
const anchor = object({
  documentRef: text, documentFingerprint: hash, page: positive,
  region: nullable(object({ x: nat, y: nat, width: positive, height: positive, unit: oneOf('pdfPoint1000') })),
  excerpt: text,
})
const questionShape = object({
  questionId: text, reason: oneOf('missing', 'conflict', 'ambiguousReference'), prompt: text, anchors: list(anchor),
})
const sourceChecks = [object({ type: oneOf('userInput') }), object({ type: oneOf('document'), anchor })] as const
function partialFields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key))
}

function spacerInput(operation: unknown, providedSources: unknown, question: M1SpacerDraft['question']) {
  const sources = providedSources === undefined ? {} : providedSources
  if (!partialFields(operation, ['type', ...dimensionKeys]) || operation.type !== 'createSpacerDraft' ||
    !partialFields(sources, dimensionKeys) || !nullable(questionShape)(question) ||
    dimensionKeys.some(key => Object.hasOwn(operation, key) && !positive(operation[key])) ||
    dimensionKeys.some(key => Object.hasOwn(sources, key) && !sourceChecks.some(check => check(sources[key])))) {
    throw Error('INVALID_REQUEST')
  }
  const missing = dimensionKeys.filter(key => !Object.hasOwn(operation, key) || !Object.hasOwn(sources, key))
  if (dimensionKeys.every(key => Object.hasOwn(operation, key)) && !isM1CreateSpacerDraft(operation)) {
    throw Error('INVALID_REQUEST')
  }
  return { operation, sources, question, missing }
}

const isAuthorization = object({ identity: text, reference: text, active: bool, canWrite: bool, retired: list(text) })
type Authorization = Infer<typeof isAuthorization>
type InternalSubscription = { readonly active: boolean; readonly view: unknown }
type SubscriptionState = { caller: Caller; active: boolean; view: unknown }

const identity = (caller: Caller) => JSON.stringify([caller.projectId, caller.userId, caller.callerId])
const generation = (caller: Caller) => JSON.stringify([identity(caller), caller.authorizationRef])

const isInternalId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
const digestText = (content: string) => createHash('sha256').update(content).digest('hex')
const isContentReference = object({
  ref: text, projectId: text, userId: text, callerId: text, authorizationRef: text, content: text, digest: hash,
})
type ContentReference = Infer<typeof isContentReference>

function dictionary<T>(check: (value: unknown) => value is T) {
  return (value: unknown): value is Record<string, T> =>
    value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).every(key => typeof key === 'string' && text(key) && check((value as Record<string, unknown>)[key]))
}
const isM0Receipt = object({ scope: text, digest: hash, result: (value: unknown): value is unknown => value !== undefined })
const recordFields = {
  storage: (value: unknown): value is 2 => value === 2, boot: text, projectId: text,
  baseRevision: nullable(text), draftRevision: nullable(text), writerEpoch: nat,
  writer: nullable(object({ callerId: text, token: text })), writerScope: nullable(text),
  cursor: nat, floor: nat, spacerDraft: nullable(isM1SpacerDraft), revoked: list(text),
  tasks: list(isM1Activity), steps: list(isStep), draftRefs: list(text),
  grants: list(isAuthorization), references: list(isContentReference),
  receipts: dictionary(isM0Receipt), receiptReferences: dictionary(list(text)), receiptPayloads: dictionary(text),
  spacerReceipts: list(validReceipt),
  events: list((value: unknown): value is JournalEvent => isEventHeader(value) || isTaskEvent(value) || isFullJournalEvent(value) || isConnectionMarker(value)),
}
const legacyRecord = object(recordFields)
const gdtRecord = object({ ...recordFields, gdtDraft: (value): value is z.infer<typeof gdtJournalSchema> =>
  gdtJournalSchema.safeParse(value).success })
function unique(values: string[]) { return new Set(values).size === values.length }
function sourceAnchors(result: SpacerResult) {
  if (isM1SpacerDraft(result)) return Object.values(result.sources).flatMap(source => source.type === 'document' ? [source.anchor] : [])
  return result.activity.question?.anchors ?? []
}
function inputAnchors(input: ReturnType<typeof spacerInput>) {
  return Object.values(input.sources).flatMap(source =>
    sourceChecks[1](source) ? [source.anchor] : [])
}

function sourceReferences(anchors: ReturnType<typeof sourceAnchors>) {
  return [...new Set(anchors.map(entry => entry.documentRef))]
}
function validRecord(value: unknown, projectId: string): value is RecordState {
  if ((!legacyRecord(value) && !gdtRecord(value)) || value.projectId !== projectId || value.cursor !== value.floor + value.events.length ||
    !validTaskJournal(projectId, value.tasks, value.steps) ||
    value.tasks.some(task => !isInternalId(task.taskId)) ||
    value.steps.some(step => !isInternalId(step.stepId)) ||
    value.references.some(ref => !isInternalId(ref.ref)) ||
    !unique(value.tasks.map(task => task.taskId)) || !unique(value.references.map(ref => ref.ref)) ||
    !unique(value.draftRefs) || !unique(value.spacerReceipts.map(receipt => receipt.scope)) ||
    !unique(value.grants.map(grant => grant.identity)) ||
    value.events.some((event, i) => event.sequence !== value.floor + i + 1 ||
      ('projectId' in event && event.projectId !== projectId) ||
      ('candidate' in event && (event.baseRevision !== event.activity.baseRevision || event.jobId !== null)) ||
      ('activity' in event && (event.activity?.projectId !== projectId ||
        !value.tasks.some(task => task.taskId === event.activity?.taskId)))) ||
    value.references.some(ref => ref.projectId !== projectId || digestText(ref.content) !== ref.digest) ||
    (value.spacerDraft !== null && value.spacerDraft.draftRevision !== value.draftRevision) ||
    (gdtRecord(value) && (value.spacerDraft !== null || value.draftRevision === null ||
      !Object.values(value.gdtDraft.receipts).some(receipt => receipt.draftRevision === value.draftRevision)))) return false
  const refs = new Map(value.references.map(ref => [ref.ref, ref]))
  if (value.draftRefs.some(id => !refs.has(id)) || refs.size !== value.draftRefs.length) return false
  for (const grant of value.grants) {
    try {
      const identity: unknown = JSON.parse(grant.identity)
      if (!Array.isArray(identity) || identity.length !== 3 || identity[0] !== projectId ||
        !identity.every(text) || !unique(grant.retired) || grant.retired.includes(grant.reference)) return false
    } catch { return false }
  }
  let previousSpacer: M1SpacerDraft | null = null
  for (const receipt of value.spacerReceipts) {
    let anchors = sourceAnchors(receipt.result)
    try {
      if (digestText(receipt.logicalPayload) !== receipt.digest) return false
      const logical: unknown = JSON.parse(receipt.logicalPayload)
      const scope: unknown = JSON.parse(receipt.scope)
      if (!Array.isArray(scope) || scope.length !== 5 || scope[1] !== projectId || !text(scope[4]) || !text(scope[2])) return false
      const shared = scope[0] === 'internal-m1-stage-v1' && scope[3] === 'stageChange'
      if (!shared && (scope[0] !== 'internal-m1-spacer-v1' || scope[3] !== receipt.operation)) return false
      const updating = receipt.operation === 'updateSpacerDraft'
      if (updating && !shared) return false
      if (!partialFields(logical, [...(updating ? ['type'] : []), 'taskId', 'operation', 'sources', 'question', 'missing',
        ...(shared ? ['baseRevision', 'expectedDraftRevision'] : [])])) return false
      const revisions = shared ? { baseRevision: logical.baseRevision, expectedDraftRevision: logical.expectedDraftRevision } : {}
      if (shared && (!nullable(text)(logical.baseRevision) || !nullable(text)(logical.expectedDraftRevision))) return false
      if (receipt.operation !== 'resumeSpacerDraft' ? logical.taskId !== null : !text(logical.taskId)) return false
      if (updating && (logical.type !== receipt.operation || !previousSpacer ||
        logical.expectedDraftRevision !== previousSpacer.draftRevision || !isM1SpacerDraft(receipt.result))) return false
      const checked = spacerInput(logical.operation, logical.sources, logical.question as M1SpacerDraft['question'])
      if (shared && !isM1SpacerDraft(receipt.result)) anchors = [...anchors, ...inputAnchors(checked)]
      if (canonical({ taskId: logical.taskId, ...(updating ? { type: receipt.operation } : {}), ...checked, ...revisions }) !== receipt.logicalPayload) return false
      const owner: unknown = JSON.parse(scope[2])
      if (!Array.isArray(owner) || owner.length !== 2 || !owner.every(text) ||
        receipt.referenceIds.some(id => refs.get(id)?.userId !== owner[0] || refs.get(id)?.callerId !== owner[1])) return false
    } catch { return false }
    if (!unique(receipt.referenceIds) || canonical(sourceReferences(anchors)) !== canonical(receipt.referenceIds) ||
      receipt.referenceIds.some(id => !refs.has(id)) ||
      anchors.some(anchor => refs.get(anchor.documentRef)?.digest !== anchor.documentFingerprint)) return false
    if (isM1SpacerDraft(receipt.result)) {
      if (previousSpacer && receipt.operation !== 'updateSpacerDraft') return false
      previousSpacer = receipt.result
    } else {
      const activity = receipt.result.activity
      if (!value.tasks.some(task => task.taskId === activity.taskId)) return false
    }
  }
  if (canonical(previousSpacer) !== canonical(value.spacerDraft)) return false
  if (value.spacerDraft && sourceAnchors(value.spacerDraft).some(anchor =>
    refs.get(anchor.documentRef)?.digest !== anchor.documentFingerprint)) return false
  if (Object.keys(value.receipts).length !== Object.keys(value.receiptReferences).length ||
    Object.keys(value.receipts).length !== Object.keys(value.receiptPayloads).length) return false
  for (const [key, receipt] of Object.entries(value.receipts)) {
    if (key !== receipt.scope || digestText(value.receiptPayloads[key] ?? '') !== receipt.digest || !value.receiptReferences[key] ||
      value.receiptReferences[key].some(id => !refs.has(id))) return false
    try {
      const scope: unknown = JSON.parse(key)
      if (!Array.isArray(scope) || scope.length !== 6 || !scope.every(text) || scope[0] !== '0.1.0-m0' || scope[1] !== projectId ||
        typeof scope[4] !== 'string' || !Object.hasOwn(projectAgentResults, scope[4])) return false
      if (value.receiptReferences[key].some(id => refs.get(id)?.userId !== scope[2] || refs.get(id)?.callerId !== scope[3])) return false
      const operation = scope[4] as ProjectAgentOperation
      if (!projectAgentResults[operation](receipt.result)) return false
    } catch { return false }
  }
  return true
}

const queues = new Map<string, Promise<unknown>>()
export class M1InternalService {
  private boot = randomUUID()
  // Internal delivery only. A service instance issues and owns its handles and response provenance.
  private subscriptions = new Map<InternalSubscription, SubscriptionState>()
  private responses = new WeakMap<object, { scope: string; value: object }>()

  subscribe(caller: Caller) {
    return this.serial(caller.projectId, async () => {
      await this.readAuthorized(caller.projectId, caller)
      const entry: SubscriptionState = { caller: { ...caller }, active: true, view: null }
      const handle = Object.freeze({
        get active() { return entry.active },
        get view() { return structuredClone(entry.view) },
      })
      this.subscriptions.set(handle, entry)
      return handle
    })
  }

  switchProject(subscription: InternalSubscription) {
    const entry = this.subscriptions.get(subscription)
    if (!entry) return Promise.resolve()
    return this.revoke(entry.caller.projectId, entry.caller)
  }

  async acceptLate(subscription: InternalSubscription, view: unknown): Promise<boolean> {
    const entry = this.subscriptions.get(subscription)
    if (!entry) return false
    return this.serial(entry.caller.projectId, async () => {
      if (!this.subscriptions.has(subscription)) return false
      const state = await this.load(entry.caller.projectId)
      if (!this.isAuthorized(state, entry.caller)) {
        this.closeGeneration(entry.caller)
        return false
      }
      if (view === null || typeof view !== 'object') return false
      const response = this.responses.get(view)
      if (response?.scope !== generation(entry.caller)) return false
      entry.view = response.value
      return true
    })
  }

  private closeGeneration(caller: Caller) {
    for (const [handle, entry] of this.subscriptions) {
      if (generation(entry.caller) !== generation(caller)) continue
      entry.active = false
      entry.view = null
      this.subscriptions.delete(handle)
    }
  }

  // Called by the trusted harness authorization owner, including after an explicit revoke.
  rotateAuthorization(previous: Caller, next: Caller) {
    return this.serial(previous.projectId, async () => {
      const state = await this.load(previous.projectId)
      const grant = this.authorization(state, previous)
      if (!this.validCaller(previous) || !this.validCaller(next) ||
        identity(previous) !== identity(next) || previous.authorizationRef === next.authorizationRef ||
        (grant && (grant.reference !== previous.authorizationRef || grant.retired.includes(next.authorizationRef))) ||
        state.revoked.includes(next.authorizationRef)) throw Error('AUTH_REQUIRED')

      const record = grant ?? this.rememberAuthorization(state, previous)
      record.retired.push(record.reference)
      record.reference = next.authorizationRef
      record.canWrite = next.canWrite
      record.active = true
      this.releaseWriter(state, previous)
      await this.save(state)
      this.closeGeneration(previous)
    })
  }

  revoke(id: string, caller: Caller) {
    return this.serial(id, async () => {
      const state = await this.load(id)
      this.gate(state, caller)
      const grant = this.rememberAuthorization(state, caller)
      grant.active = false
      this.releaseWriter(state, caller)
      await this.save(state)
      this.closeGeneration(caller)
    })
  }

  retireWriter(id: string, caller: Caller) {
    return this.serial(id, async () => {
      const state = await this.load(id)
      const grant = this.authorization(state, caller)
      if (!grant?.active || grant.reference !== caller.authorizationRef || !grant.canWrite) return
      grant.active = false
      this.releaseWriter(state, caller)
      await this.save(state)
      this.closeGeneration(caller)
    })
  }

  private releaseWriter(state: RecordState, caller: Caller) {
    if (state.writerScope !== generation(caller)) return
    if (!nat(state.writerEpoch + 1)) throw Error('STEP_FAILED')
    state.writer = null
    state.writerScope = null
    state.writerEpoch++
  }

  private authorization(state: RecordState, caller: Caller) {
    return state.grants.find(grant => grant.identity === identity(caller))
  }

  private rememberAuthorization(state: RecordState, caller: Caller) {
    const existing = this.authorization(state, caller)
    if (existing) return existing
    const grant = { identity: identity(caller), reference: caller.authorizationRef,
      active: true, canWrite: caller.canWrite, retired: [] }
    state.grants.push(grant)
    return grant
  }

  private validCaller(caller: Caller) {
    return text(caller.projectId) && text(caller.userId) && text(caller.callerId) &&
      text(caller.authorizationRef) && bool(caller.canWrite)
  }

  private isAuthorized(state: RecordState, caller: Caller, write = false) {
    if (!this.validCaller(caller) || state.projectId !== caller.projectId ||
      state.revoked.includes(caller.authorizationRef) || (write && !caller.canWrite)) return false
    const grant = this.authorization(state, caller)
    // The input is already a trusted authenticated caller. Once enrolled, only its current generation is allowed.
    return !grant || (grant.active && grant.reference === caller.authorizationRef && (!write || grant.canWrite))
  }

  private gate(state: RecordState, caller: Caller, write = false) {
    if (!this.isAuthorized(state, caller, write)) throw Error('AUTH_REQUIRED')
  }

  private async readAuthorized(id: string, caller: Caller) {
    const state = await this.load(id)
    this.gate(state, caller)
    if (!this.authorization(state, caller)) {
      this.rememberAuthorization(state, caller)
      await this.save(state)
    }
    return state
  }

  private tagResponse<T extends object>(caller: Caller, value: T): T {
    this.responses.set(value, { scope: generation(caller), value: structuredClone(value) })
    return value
  }

  private prepared = new Map<string, ContentReference>()
  registerReference(id: string, caller: Caller, content: string,
    writer?: { credentials: Omit<Credentials, 'idempotencyKey'>; verify: VerifyM1Binding }) {
    return this.serial(id, async () => {
      const state = await this.load(id)
      const binding = await writer?.verify()
      if (writer && binding) {
        binding.seal()
        this.checkSpacerWriter(state, caller, writer.credentials)
      } else {
        this.gate(state, caller, true)
      }
      if (!text(content) || Buffer.byteLength(content) > 1024 * 1024) throw Error('INVALID_REQUEST')
      if (!this.authorization(state, caller)) {
        this.rememberAuthorization(state, caller)
        await this.save(state, writer && binding ? this.beforeBindingCommit(writer.verify, binding) : undefined)
      }
      binding?.seal()
      const reference: ContentReference = {
        ref: randomUUID(), projectId: id, userId: caller.userId, callerId: caller.callerId,
        authorizationRef: caller.authorizationRef, content, digest: digestText(content),
      }
      this.prepared.set(reference.ref, reference)
      return reference.ref
    })
  }

  readReference(id: string, caller: Caller, ref: string) {
    return this.serial(id, async () => {
      const state = await this.load(id)
      this.gate(state, caller)
      const reference = state.references.find(entry => entry.ref === ref)
      if (!reference || reference.userId !== caller.userId || reference.callerId !== caller.callerId) {
        throw Error('REFERENCE_STALE')
      }
      return structuredClone(reference)
    })
  }

  private commitReferences(state: RecordState, caller: Caller, ids: string[]) {
    for (const ref of ids) {
      const existing = state.references.find(entry => entry.ref === ref)
      const reference = existing ?? this.prepared.get(ref)
      if (!reference || reference.projectId !== state.projectId || reference.userId !== caller.userId ||
        reference.callerId !== caller.callerId || (!existing && reference.authorizationRef !== caller.authorizationRef) ||
        digestText(reference.content) !== reference.digest) throw Error('REFERENCE_STALE')
      if (!existing) state.references.push(structuredClone(reference))
    }
  }

  private root: string
  private fault?: (phase: string) => void
  constructor(root: string, fault?: (phase: string) => void) {
    this.root = root
    this.fault = fault
  }
  private file(id: string) { return path.join(this.root, createHash('sha256').update(id).digest('hex') + '.json') }
  private serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const key = this.file(id)
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn)
    queues.set(key, next)
    return next
  }
  private async load(id: string): Promise<RecordState> {
    try {
      const bytes = await fs.readFile(this.file(id))
      if (bytes.length > 2 * 1024 * 1024) throw Error('SAVE_FAILED')
      const parsed: unknown = JSON.parse(bytes.toString())
      if (!validRecord(parsed, id)) throw Error('SAVE_FAILED')
      const s = parsed
      if (s.boot !== this.boot || s.writerScope === null) {
        s.writer = null
        s.writerScope = null
      }
      return s
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('SAVE_FAILED', { cause: e })
      return { spacerDraft: null, revoked: [], references: [], receiptReferences: {}, receiptPayloads: {}, grants: [], writerScope: null, storage: 2, boot: this.boot, projectId: id, baseRevision: null, draftRevision: null,
        writerEpoch: 0, writer: null, cursor: 0, floor: 0, tasks: [], steps: [], draftRefs: [], spacerReceipts: [], receipts: {}, events: [] }
    }
  }
  private async save(s: RecordState, beforeCommit?: () => Promise<() => void>) {
    if (!validRecord(s, s.projectId)) throw Error('SAVE_FAILED')
    s.boot = this.boot
    const text = JSON.stringify(s)
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw Error('SAVE_FAILED')
    const temp = this.file(s.projectId) + '.' + randomUUID() + '.tmp'
    try {
      await fs.mkdir(this.root, { recursive: true })
      const handle = await fs.open(temp, 'wx', 0o600)
      try {
        await handle.writeFile(text)
        await handle.sync()
      } finally {
        await handle.close()
      }
      if ((await fs.readFile(temp, 'utf8')) !== text) throw Error('SAVE_FAILED')
      this.fault?.('beforeRename')
      const seal = await beforeCommit?.()
      seal?.()
      try {
        await fs.rename(temp, this.file(s.projectId))
        this.fault?.('afterRename')
      } catch (error) {
        // Compare the entire committed record after an ambiguous rename.
        if (await fs.readFile(this.file(s.projectId), 'utf8').catch(() => '') !== text) throw error
      }
    } catch (error) {
      if (!beforeCommit || (error instanceof Error &&
        ['AUTH_REQUIRED', 'STALE_BASE', 'WRITER_REVOKED', 'SAVE_FAILED', 'CANCELLED'].includes(error.message))) throw error
      throw Error('SAVE_FAILED', { cause: error })
    } finally {
      await fs.unlink(temp).catch(() => {})
    }
    try {
      const directory = await fs.open(this.root, 'r')
      try { await directory.sync() } finally { await directory.close() }
    } catch { /* rename committed; directory sync failure affects durability only */ }
  }
  acquire(id: string, caller: Caller, raw: unknown, takeover?: boolean): Promise<Omit<Credentials, 'idempotencyKey'>>
  acquire(id: string, caller: Caller, raw: unknown, takeover: boolean, verify: VerifyM1Binding, expectedDraftRevision?: string | null):
    Promise<Omit<Credentials, 'idempotencyKey'> & { baseRevision: string; draftRevision: string | null }>
  acquire(id: string, caller: Caller, raw: unknown, takeover = false, verify?: VerifyM1Binding, expectedDraftRevision?: string | null) {
    return this.serial(id, async () => {
      const s = await this.load(id)
      this.gate(s, caller, true)
      const binding = await verify?.()
      binding?.seal()
      const g = checkWriterAcquisition(takeover ? 'takeOverWriter' : 'acquireWriter', raw, s, caller)
      if (!g.ok) throw Error(g.code)
      if (expectedDraftRevision !== undefined && expectedDraftRevision !== s.draftRevision) throw Error('STALE_BASE')
      const previousScope = verify && takeover ? s.writerScope : null
      const previous = previousScope && s.grants.find(grant =>
        JSON.stringify([grant.identity, grant.reference]) === previousScope)
      if (previous && previousScope !== generation(caller)) previous.active = false
      this.rememberAuthorization(s, caller)
      s.writerScope = generation(caller)
      s.writerEpoch = g.nextEpoch
      s.writer = { callerId: caller.callerId, token: randomUUID() }
      s.events.push(binding ? this.contextEvent(s, binding.baseRevision) : { sequence: ++s.cursor, type: 'contextChanged' })
      await this.save(s, verify && binding ? this.beforeBindingCommit(verify, binding) : undefined)
      const credentials = { writerToken: s.writer.token, writerEpoch: s.writerEpoch }
      return binding ? { ...credentials, baseRevision: binding.baseRevision, draftRevision: s.draftRevision } : credentials
    })
  }
  // Trusted internal transaction payload; no engineering formulas or model execution.
  write(id: string, caller: Caller, operation: Operation, raw: unknown,
    update: { result: unknown; tasks: M1Activity[]; steps: TaskStep[]; draftRefs: string[] }) {
    return this.serial(id, async () => {
      const s = await this.load(id)
      this.gate(s, caller, true)
      if (operation === 'commitApprovedDraft') throw Error('UNSUPPORTED_SCOPE')
      const scopedState = s.writerScope === generation(caller) ? s : { ...s, writer: null }
      const g = checkWrite(operation, raw, scopedState, caller, scope => s.receipts[scope])
      if (g.status === 'rejected') throw Error(g.code)
      if (g.status === 'replay') return g.result
      if (!projectAgentResults[operation](update.result)) throw Error('INVALID_REQUEST')
      this.commitReferences(s, caller, update.draftRefs)
      // M0 result writes cannot replace the task journal or roll it back.
      if (!Array.isArray(update.tasks) || !Array.isArray(update.steps) || update.tasks.length || update.steps.length) {
        throw Error('INVALID_TRANSITION')
      }
      s.draftRefs = [...new Set([...s.draftRefs, ...update.draftRefs])]
      s.receiptReferences[g.scope] = [...new Set(update.draftRefs)]
      s.receiptPayloads[g.scope] = canonical({ ...g.request, requestId: null, authorizationRef: null, writerToken: null, writerEpoch: null })
      s.draftRevision = 'draftRevision' in update.result ? update.result.draftRevision : s.draftRevision
      s.receipts[g.scope] = { scope: g.scope, digest: g.digest, result: structuredClone(update.result) }
      s.events.push({ sequence: ++s.cursor, type: 'contextChanged' }, { sequence: ++s.cursor, type: 'taskChanged' })
      await this.save(s)
      return structuredClone(update.result)
    })
  }

  private contextEvent(state: RecordState, baseRevision: string | null): FullJournalEvent {
    return { version: '0.1.0-m0', type: 'contextChanged', projectId: state.projectId, baseRevision,
      draftRevision: state.draftRevision, jobId: null, sequence: ++state.cursor }
  }

  private beforeBindingCommit(verify: VerifyM1Binding, initial: VerifiedM1Binding) {
    return async () => {
      const current = await verify()
      if (current.baseRevision !== initial.baseRevision) throw Error('STALE_BASE')
      return current.seal
    }
  }

  withWriter<T>(id: string, caller: Caller, credentials: Omit<Credentials, 'idempotencyKey'>,
    verify: VerifyM1Binding, run: (context: M1WriterContext) => T): Promise<T> {
    return this.serial(id, async () => {
      const state = await this.load(id)
      const binding = await verify()
      binding.seal()
      this.checkSpacerWriter(state, caller, credentials)
      return run({ baseRevision: binding.baseRevision, draftRevision: state.draftRevision, cursor: state.cursor,
        spacerDraft: state.spacerDraft })
    })
  }

  writerContext(id: string, caller: Caller, credentials: Omit<Credentials, 'idempotencyKey'>,
    verify: VerifyM1Binding): Promise<M1WriterContext> {
    return this.withWriter(id, caller, credentials, verify, context => context)
  }

  stageGdt(id: string, caller: Caller, credentials: Omit<Credentials, 'idempotencyKey'>,
    operation: Exclude<GdtToolName, 'analyze_gdt_stackup'>, raw: unknown, verify: VerifyM1Binding,
    origin: 'model' | 'client' = 'client'): Promise<GdtStageResult> {
    return this.serial(id, async () => {
      if (!desktopGdtEnabled()) throw Error('FEATURE_DISABLED')
      const state = await this.load(id)
      const binding = await verify()
      binding.seal()
      this.checkSpacerWriter(state, caller, credentials)
      const parsed = (operation === 'stage_datum' ? stageDatumSchema : stageGdtSchema).safeParse(raw)
      if (!parsed.success || parsed.data.projectId !== id) throw Error('INVALID_REQUEST')
      const request = parsed.data
      if (request.expectedWriterEpoch !== credentials.writerEpoch) throw Error('WRITER_REVOKED')
      if (request.baseRevision !== binding.baseRevision ||
          (state.gdtDraft && state.gdtDraft.baseRevision !== binding.baseRevision)) throw Error('STALE_BASE')
      const scope = canonical([caller.callerId, credentials.writerEpoch, request.idempotencyKey])
      const digest = digestText(canonical({ operation, ...request }))
      const prior = state.gdtDraft?.receipts[scope]
      if (prior) {
        if (prior.digest !== digest) throw Error('IDEMPOTENCY_CONFLICT')
        return { projectId: id, draftRevision: prior.draftRevision, warnings: prior.warnings ?? [] }
      }
      if (request.expectedDraftRevision !== state.draftRevision) throw Error('STALE_DRAFT')
      if (state.draftRevision && !state.gdtDraft) throw Error('DRAFT_NOT_EMPTY')
      if (origin === 'model' && request.items.some(item => item.evidence.some(ref => ref.kind === 'user-attestation'))) {
        throw Error('REFERENCE_STALE')
      }
      const snapshot = await readGdtSnapshot(binding.canonicalPath, binding.baseRevision, id)
      const original = snapshot.project.assembly3d
      if (!original) throw Error('ASSEMBLY_REQUIRED')
      const assembly = state.gdtDraft
        ? { ...original, datums: state.gdtDraft.datums, gdt: state.gdtDraft.gdt,
            ...(state.gdtDraft.physics ? { physics: state.gdtDraft.physics } : {}) }
        : original
      let updated
      try {
        updated = operation === 'stage_datum'
          ? stageDatums(assembly, stageDatumSchema.parse(raw)) : stageControls(assembly, stageGdtSchema.parse(raw))
      } catch {
        throw Error('INVALID_GDT')
      }
      const sources = gdtSources(snapshot, updated, request.items)
      const evidence = { ...state.gdtDraft?.evidence }
      for (const [itemId, citation] of Object.entries(sources)) evidence[operation + ':' + itemId] = citation
      const draftRevision = randomUUID()
      const warnings = assemblyWarnings(updated)
      state.gdtDraft = {
        baseRevision: binding.baseRevision, datums: updated.datums, gdt: updated.gdt, evidence,
        ...(state.gdtDraft?.physics ? { physics: state.gdtDraft.physics } : {}),
        ...(state.gdtDraft?.micAttachments ? { micAttachments: state.gdtDraft.micAttachments } : {}),
        receipts: { ...state.gdtDraft?.receipts, [scope]: { digest, draftRevision, warnings } },
      }
      state.draftRevision = draftRevision
      state.events.push(this.contextEvent(state, binding.baseRevision))
      await this.save(state, this.beforeBindingCommit(verify, binding))
      return { projectId: id, draftRevision, warnings }
    })
  }

  stagePhysics(id: string, caller: Caller, credentials: Omit<Credentials, 'idempotencyKey'>,
    raw: unknown, verify: VerifyM1Binding, origin: 'model' | 'client' = 'client'): Promise<StagePhysicsResult> {
    return this.serial(id, async () => {
      if (!desktopGdtEnabled()) throw Error('FEATURE_DISABLED')
      const state = await this.load(id)
      const binding = await verify()
      binding.seal()
      this.checkSpacerWriter(state, caller, credentials)
      const parsed = stagePhysicsSchema.safeParse(raw)
      if (!parsed.success || parsed.data.projectId !== id) throw Error('INVALID_REQUEST')
      const request = parsed.data
      if (request.expectedWriterEpoch !== credentials.writerEpoch) throw Error('WRITER_REVOKED')
      if (request.baseRevision !== binding.baseRevision ||
          (state.gdtDraft && state.gdtDraft.baseRevision !== binding.baseRevision)) throw Error('STALE_BASE')
      const scope = canonical([caller.callerId, credentials.writerEpoch, request.idempotencyKey])
      const digest = digestText(canonical({ operation: 'stage_physics', ...request }))
      const prior = state.gdtDraft?.receipts[scope]
      if (prior) {
        if (prior.digest !== digest) throw Error('IDEMPOTENCY_CONFLICT')
        return prior.result as StagePhysicsResult
      }
      if (request.expectedDraftRevision !== state.draftRevision) throw Error('STALE_DRAFT')
      if (state.draftRevision && !state.gdtDraft) throw Error('DRAFT_NOT_EMPTY')
      const allEvidence = Object.values(request.evidenceByField).flat()
      if (origin === 'model' && allEvidence.some(ref => ref.kind === 'user-attestation')) {
        throw Error('REFERENCE_STALE')
      }
      const snapshot = await readGdtSnapshot(binding.canonicalPath, binding.baseRevision, id)
      const original = snapshot.project.assembly3d
      if (!original) throw Error('ASSEMBLY_REQUIRED')
      verifyEvidenceRefs(snapshot, allEvidence)
      const assembly = state.gdtDraft
        ? { ...original, datums: state.gdtDraft.datums, gdt: state.gdtDraft.gdt,
            ...(state.gdtDraft.physics ? { physics: state.gdtDraft.physics } : {}) }
        : original
      let updated
      try {
        updated = stagePhysicsPatch(assembly, request)
      } catch {
        throw Error('INVALID_PHYSICS')
      }
      const evidence = { ...state.gdtDraft?.evidence }
      for (const [pointer, refs] of Object.entries(request.evidenceByField)) {
        evidence['stage_physics:' + pointer] = refs
      }
      const draftRevision = randomUUID()
      const result: StagePhysicsResult = { projectId: id, draftRevision, physics: updated.physics! }
      state.gdtDraft = {
        baseRevision: binding.baseRevision, datums: updated.datums, gdt: updated.gdt,
        physics: updated.physics,
        ...(state.gdtDraft?.micAttachments ? { micAttachments: state.gdtDraft.micAttachments } : {}),
        evidence,
        receipts: { ...state.gdtDraft?.receipts, [scope]: { digest, draftRevision, result } },
      }
      state.draftRevision = draftRevision
      state.events.push(this.contextEvent(state, binding.baseRevision))
      await this.save(state, this.beforeBindingCommit(verify, binding))
      return result
    })
  }

  importMicMatrix(id: string, caller: Caller, credentials: Omit<Credentials, 'idempotencyKey'>,
    raw: unknown, verify: VerifyM1Binding, origin: 'model' | 'client' = 'client'): Promise<ImportMicMatrixResult> {
    return this.serial(id, async () => {
      if (!desktopGdtEnabled()) throw Error('FEATURE_DISABLED')
      const state = await this.load(id)
      const binding = await verify()
      binding.seal()
      this.checkSpacerWriter(state, caller, credentials)
      const parsed = importMicMatrixSchema.safeParse(raw)
      if (!parsed.success || parsed.data.projectId !== id) throw Error('INVALID_REQUEST')
      const request = parsed.data
      if (request.expectedWriterEpoch !== credentials.writerEpoch) throw Error('WRITER_REVOKED')
      if (request.baseRevision !== binding.baseRevision ||
          (state.gdtDraft && state.gdtDraft.baseRevision !== binding.baseRevision)) throw Error('STALE_BASE')
      const scope = canonical([caller.callerId, credentials.writerEpoch, request.idempotencyKey])
      const digest = digestText(canonical({ operation: 'import_mic_matrix', ...request }))
      const prior = state.gdtDraft?.receipts[scope]
      if (prior) {
        if (prior.digest !== digest) throw Error('IDEMPOTENCY_CONFLICT')
        return prior.result as ImportMicMatrixResult
      }
      if (request.expectedDraftRevision !== state.draftRevision) throw Error('STALE_DRAFT')
      if (state.draftRevision && !state.gdtDraft) throw Error('DRAFT_NOT_EMPTY')
      if (origin === 'model' && request.evidence.some(ref => ref.kind === 'user-attestation')) {
        throw Error('REFERENCE_STALE')
      }
      const snapshot = await readGdtSnapshot(binding.canonicalPath, binding.baseRevision, id)
      const original = snapshot.project.assembly3d
      if (!original) throw Error('ASSEMBLY_REQUIRED')
      verifyEvidenceRefs(snapshot, request.evidence)
      const assembly = state.gdtDraft
        ? { ...original, datums: state.gdtDraft.datums, gdt: state.gdtDraft.gdt,
            ...(state.gdtDraft.physics ? { physics: state.gdtDraft.physics } : {}) }
        : original
      let staged
      try {
        staged = await stageMicMatrix(assembly, request)
      } catch (error) {
        throw Error(error instanceof Error && error.message === 'UNKNOWN_PART' ? 'UNKNOWN_PART' : 'INVALID_MIC', { cause: error })
      }
      const evidence = { ...state.gdtDraft?.evidence, ['import_mic_matrix:' + staged.prepared.micMatrixRef]: request.evidence }
      const micAttachments = {
        ...state.gdtDraft?.micAttachments,
        [staged.prepared.micMatrixRef]: {
          fileName: request.fileName,
          attachment: { ...staged.prepared.attachment },
          payload: staged.prepared.payload,
          evidence: [...staged.prepared.evidence],
        },
      }
      const draftRevision = randomUUID()
      const result: ImportMicMatrixResult = { projectId: id, draftRevision, attachment: staged.prepared.attachment }
      state.gdtDraft = {
        baseRevision: binding.baseRevision, datums: staged.assembly.datums, gdt: staged.assembly.gdt,
        physics: staged.assembly.physics,
        micAttachments,
        evidence,
        receipts: { ...state.gdtDraft?.receipts, [scope]: { digest, draftRevision, result } },
      }
      state.draftRevision = draftRevision
      state.events.push(this.contextEvent(state, binding.baseRevision))
      await this.save(state, this.beforeBindingCommit(verify, binding))
      return result
    })
  }

  readCompliantAnalysis(id: string, caller: Caller, credentials: Omit<Credentials, 'idempotencyKey'>,
    raw: unknown, verify: VerifyM1Binding) {
    return this.serial(id, async () => {
      if (!desktopGdtEnabled()) throw Error('FEATURE_DISABLED')
      const state = await this.load(id)
      const binding = await verify()
      this.checkSpacerWriter(state, caller, credentials)
      const parsed = analyzeCompliantSchema.safeParse(raw)
      if (!parsed.success || parsed.data.projectId !== id) throw Error('INVALID_REQUEST')
      const request = parsed.data
      if (request.expectedWriterEpoch !== credentials.writerEpoch) throw Error('WRITER_REVOKED')
      if (!state.gdtDraft || request.draftRevision !== state.draftRevision) throw Error('STALE_DRAFT')
      if (state.gdtDraft.baseRevision !== binding.baseRevision) throw Error('STALE_BASE')
      binding.seal()
      const snapshot = await readGdtSnapshot(binding.canonicalPath, binding.baseRevision, id)
      const { project } = snapshot
      if (!project.assembly3d) throw Error('ASSEMBLY_REQUIRED')
      binding.seal()
      const micPayloads: Record<string, z.infer<typeof micMatrixPayloadV1Schema>> = {}
      for (const rec of project.micMatrixAttachments ?? []) {
        const blob = snapshot.attachments.find(a => a.blobKey === rec.blobKey)
        if (blob) {
          try { micPayloads[rec.id] = parseAndValidateMicMatrix(blob.bytes).payload as z.infer<typeof micMatrixPayloadV1Schema> } catch { /* ignore */ }
        }
      }
      for (const [micId, entry] of Object.entries(state.gdtDraft.micAttachments ?? {})) {
        micPayloads[micId] = entry.payload
      }
      return {
        request,
        baseRevision: binding.baseRevision,
        micPayloads,
        assembly: {
          ...project.assembly3d,
          datums: state.gdtDraft.datums,
          gdt: state.gdtDraft.gdt,
          ...(state.gdtDraft.physics ? { physics: state.gdtDraft.physics } : {}),
        },
      }
    })
  }

  readGdtAnalysis(id: string, caller: Caller, credentials: Omit<Credentials, 'idempotencyKey'>,
    raw: unknown, verify: VerifyM1Binding) {
    return this.serial(id, async () => {
      if (!desktopGdtEnabled()) throw Error('FEATURE_DISABLED')
      const state = await this.load(id)
      const binding = await verify()
      this.checkSpacerWriter(state, caller, credentials)
      const parsed = analyzeGdtSchema.safeParse(raw)
      if (!parsed.success || parsed.data.projectId !== id) throw Error('INVALID_REQUEST')
      const request = parsed.data
      if (request.expectedWriterEpoch !== credentials.writerEpoch) throw Error('WRITER_REVOKED')
      if (!state.gdtDraft || request.draftRevision !== state.draftRevision) throw Error('STALE_DRAFT')
      if (state.gdtDraft.baseRevision !== binding.baseRevision) throw Error('STALE_BASE')
      binding.seal()
      const { project } = await readGdtSnapshot(binding.canonicalPath, binding.baseRevision, id)
      if (!project.assembly3d) throw Error('ASSEMBLY_REQUIRED')
      binding.seal()
      return { request, baseRevision: binding.baseRevision, assembly: {
        ...project.assembly3d, datums: state.gdtDraft.datums, gdt: state.gdtDraft.gdt,
      } }
    })
  }

  stageChange(id: string, caller: Caller, credentials: Omit<Credentials, 'idempotencyKey'>,
    raw: unknown, verify: VerifyM1Binding, source: M1Activity['source'] = 'internal'): Promise<M1StageResult> {
    return this.serial(id, async () => {
      const state = await this.load(id)
      const binding = await verify()
      binding.seal()
      this.checkSpacerWriter(state, caller, credentials)
      if (!isStageEnvelope(raw)) throw Error('INVALID_REQUEST')
      const owner = JSON.stringify([caller.userId, caller.callerId])
      const scope = JSON.stringify(['internal-m1-stage-v1', id, owner, 'stageChange', raw.idempotencyKey])
      const receipt = state.spacerReceipts.find(entry => entry.scope === scope)
      const type = raw.operation.type
      if (type !== 'createSpacerDraft' && type !== 'resumeSpacerDraft' &&
        !(type === 'updateSpacerDraft' && source === 'internal')) {
        if (receipt) throw Error('IDEMPOTENCY_CONFLICT')
        return { kind: 'clarification', code: 'UNSUPPORTED_SCOPE', question: '此入口支持创建隔套草稿或续接该隔套任务。请指定适用的隔套操作。' }
      }
      const { taskId, ...values } = raw.operation
      if (type === 'resumeSpacerDraft' ? !text(taskId) : Object.hasOwn(raw.operation, 'taskId')) throw Error('INVALID_REQUEST')
      const operation = { ...values, type: 'createSpacerDraft' }
      const input = spacerInput(operation, raw.sources, null)
      const logicalPayload = canonical({ taskId: taskId ?? null, ...(type === 'updateSpacerDraft' ? { type } : {}), ...input,
        baseRevision: raw.baseRevision, expectedDraftRevision: raw.expectedDraftRevision })
      const digest = digestText(logicalPayload)
      if (receipt) {
        if (receipt.digest !== digest) throw Error('IDEMPOTENCY_CONFLICT')
        return receipt.result
      }
      if (raw.baseRevision !== binding.baseRevision || raw.expectedDraftRevision !== state.draftRevision) throw Error('STALE_BASE')
      if (type === 'createSpacerDraft') this.requireEmpty(state)
      if (type === 'updateSpacerDraft' && (!state.spacerDraft || input.missing.length)) throw Error('INVALID_REQUEST')
      return this.applySpacer(state, caller, type, text(taskId) ? taskId : null, input,
        { scope, digest, logicalPayload }, binding.baseRevision, this.beforeBindingCommit(verify, binding), source)
    })
  }

  createSpacer(id: string, caller: Caller, credentials: Credentials,
    operation: unknown, sources: unknown, question: M1SpacerDraft['question']) {
    return this.spacerTransaction(id, caller, credentials, 'createSpacerDraft', null, operation, sources, question)
  }

  async resumeSpacer(id: string, caller: Caller, credentials: Credentials, taskId: string,
    operation: unknown, sources: unknown): Promise<M1SpacerDraft> {
    const result = await this.spacerTransaction(id, caller, credentials, 'resumeSpacerDraft', taskId, operation, sources, null)
    if (!isM1SpacerDraft(result)) throw Error('SAVE_FAILED')
    return result
  }

  private spacerTransaction(id: string, caller: Caller, credentials: Credentials, action: SpacerOperation,
    taskId: string | null, operation: unknown, sources: unknown, question: M1SpacerDraft['question']) {
    return this.serial(id, async () => {
      const state = await this.load(id)
      this.gate(state, caller, true)
      if (!isCredentials(credentials) || (action === 'resumeSpacerDraft' && !text(taskId))) throw Error('INVALID_REQUEST')
      this.checkSpacerWriter(state, caller, credentials)

      const owner = JSON.stringify([caller.userId, caller.callerId])
      const scope = JSON.stringify(['internal-m1-spacer-v1', id, owner, action, credentials.idempotencyKey])
      const receipt = state.spacerReceipts.find(entry => entry.scope === scope)
      if (!receipt && action === 'createSpacerDraft') this.requireEmpty(state)

      const input = spacerInput(operation, sources, question)
      const logicalPayload = canonical({ taskId, ...input })
      const digest = digestText(logicalPayload)
      if (receipt) {
        if (receipt.digest !== digest) throw Error('IDEMPOTENCY_CONFLICT')
        return receipt.result
      }

      return this.applySpacer(state, caller, action, taskId, input, { scope, digest, logicalPayload }, state.baseRevision)
    })
  }

  private checkSpacerWriter(state: RecordState, caller: Caller, credentials: Omit<Credentials, 'idempotencyKey'>) {
    if (state.writerScope !== generation(caller) || state.writerEpoch !== credentials.writerEpoch ||
      state.writer?.callerId !== caller.callerId || state.writer.token !== credentials.writerToken) throw Error('WRITER_REVOKED')
    this.gate(state, caller, true)
  }

  private async applySpacer(state: RecordState, caller: Caller, action: SpacerOperation, taskId: string | null,
    input: ReturnType<typeof spacerInput>, receipt: Pick<SpacerReceipt, 'scope' | 'digest' | 'logicalPayload'>,
    baseRevision: string | null, beforeCommit?: () => Promise<() => void>,
    source: M1Activity['source'] = 'internal'): Promise<SpacerResult> {
    const owner = JSON.stringify([caller.userId, caller.callerId])
    let task: M1Activity
    if (action === 'resumeSpacerDraft') {
      const existing = state.tasks.find(entry => entry.taskId === taskId)
      if (!existing || !state.steps.some(step => step.taskId === taskId && step.owner === owner)) {
        throw Error('TASK_SCOPE_MISMATCH')
      }
      if (existing.status !== 'awaitingInput') throw Error('INVALID_TRANSITION')
      this.requireEmpty(state)
      if (input.missing.length) throw Error('INVALID_REQUEST')
      task = existing
      if (beforeCommit) task.baseRevision = baseRevision
    } else {
      task = {
        taskId: randomUUID(), projectId: state.projectId, source, baseRevision,
        draftRevision: null, status: 'queued', lastStep: null, question: null, errorCode: null, updatedAtMs: Date.now(),
      }
      this.recordStep(state, task, owner)
      state.tasks.push(task)
    }

    const advance = (status: M1Activity['status']) => {
      if (!canTransition(task.status, status)) throw Error('INVALID_TRANSITION')
      task.status = status
      this.recordStep(state, task, owner)
    }
    advance('running')
    let result: SpacerResult
    if (input.missing.length || input.question !== null) {
      task.question = input.question ?? {
        questionId: randomUUID(), reason: 'missing', anchors: [],
        prompt: '请补充以下尺寸及其来源：' + input.missing.join('、'),
      }
      advance('awaitingInput')
      result = { draftRevision: null, activity: structuredClone(task) }
    } else {
      const draft = {
        draftRevision: randomUUID(), innerDiameterQ: input.operation.innerDiameterQ,
        outerDiameterQ: input.operation.outerDiameterQ, lengthQ: input.operation.lengthQ,
        sources: input.sources, question: null,
      }
      if (!isM1SpacerDraft(draft)) throw Error('INVALID_REQUEST')
      state.spacerDraft = draft
      state.draftRevision = draft.draftRevision
      task.draftRevision = draft.draftRevision
      task.question = null
      advance('succeeded')
      state.events.push(beforeCommit ? this.contextEvent(state, baseRevision) : { sequence: ++state.cursor, type: 'contextChanged' })
      result = draft
    }
    const activity = structuredClone(task)
    const sequence = ++state.cursor
    state.events.push(beforeCommit ? { candidate: 'm1-review-1853', type: 'taskChanged', projectId: state.projectId,
      baseRevision, draftRevision: activity.draftRevision, jobId: null, sequence, activity }
      : { sequence, type: 'taskChanged', activity })
    const anchors = beforeCommit && !isM1SpacerDraft(result)
      ? [...sourceAnchors(result), ...inputAnchors(input)] : sourceAnchors(result)
    const referenceIds = sourceReferences(anchors)
    this.commitReferences(state, caller, referenceIds)
    for (const entry of anchors) {
      if (state.references.find(ref => ref.ref === entry.documentRef)?.digest !== entry.documentFingerprint) {
        throw Error('REFERENCE_STALE')
      }
    }
    state.draftRefs = [...new Set([...state.draftRefs, ...referenceIds])]
    state.spacerReceipts.push({ ...receipt, operation: action, result, referenceIds })
    await this.save(state, beforeCommit)
    return result
  }

  private requireEmpty(state: RecordState) {
    const occupancy = state.draftRevision !== null || state.spacerDraft !== null ? 'nonEmpty'
      : state.baseRevision === null ? 'emptyProject' : 'emptyDraft'
    if (spacerDraftEligibility(occupancy) !== 'eligible') throw Error('DRAFT_NOT_EMPTY')
  }

  private recordStep(state: RecordState, task: M1Activity, owner: string) {
    const stepId = randomUUID()
    state.steps.push({ stepId, taskId: task.taskId, status: task.status, owner })
    task.lastStep = stepId
    task.updatedAtMs = Date.now()
  }

  context(id: string, c: Caller) { return this.serial(id, async () => {
    const s = await this.readAuthorized(id, c)
    return this.tagResponse(c, { snapshot: { projectId: id, draftRevision: s.draftRevision, cursor: s.cursor,
      writerEpoch: s.writerEpoch, writerOccupied: s.writer !== null, spacerDraft: s.spacerDraft }, activities: s.tasks, steps: s.steps })
  }) }
  recordWorkbenchConnection(id: string, caller: Caller, verify: VerifyM1Binding) {
    return this.serial(id, async () => {
      const state = await this.readAuthorized(id, caller)
      const binding = await verify()
      binding.seal()
      const { sequence, projectId, baseRevision, draftRevision } = this.contextEvent(state, binding.baseRevision)
      state.events.push({ sequence, projectId, baseRevision, draftRevision, jobId: null, type: 'workbenchConnectionChanged' })
      await this.save(state, this.beforeBindingCommit(verify, binding))
    })
  }

  read(id: string, c: Caller, after: number, limit: number) { return this.serial(id, async () => {
    const s = await this.readAuthorized(id, c)
    if (!Number.isSafeInteger(after) || after < s.floor || after > s.cursor) throw Error('CURSOR_EXPIRED')
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('INVALID_REQUEST')
    const events = s.events.filter(e => e.sequence > after).slice(0, limit)
    return this.tagResponse(c, { events, nextCursor: events.at(-1)?.sequence ?? after, highWatermark: s.cursor })
  }) }
  // Explicit test hook; no production retention policy.
  expireHistoryForTest(id: string) { return this.serial(id, async () => {
    const s = await this.load(id); s.floor = s.cursor; s.events = []; await this.save(s)
  }) }
}
