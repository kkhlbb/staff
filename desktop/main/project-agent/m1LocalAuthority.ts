// Main-process trust owner. This module is never exposed to renderer or a local bridge.
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { createGdtAnalyzer } from '../../../mcp/lib/gdt.ts'
import { desktopGdtWorkerUrl, type GdtToolName } from './gdtTools.ts'
import { M1FileBindings } from './m1FileBindings.ts'
import { M1InternalService } from './m1InternalService.ts'
import type { SenderInfo } from '../senderGuard.ts'
import { nat, object, positive, text } from '../../shared/project-agent/schema.ts'
import { isM1FullEventPage } from '../../shared/project-agent/m1-protocol-1915.ts'
import type { M1StageChangeRequest, M1StageResult, M1WriterContext, VerifyM1Binding } from './m1StageContracts.ts'
import type { M1ContextFields } from '../../shared/project-agent/m1-fields.ts'

import { isM1AuthorizationRequest } from '../../shared/project-agent/m1-local-authorization-2002.ts'
export type LocalM1Session = { sessionId: string; projectId: string; path: string | null; fingerprint: string | null }
type Binding = { sessionId: string; projectId: string; path?: string | null }
type Caller = Parameters<M1InternalService['context']>[1]
const isWriterRequest = object({ windowId: positive, sessionId: text, projectId: text, expectedWriterEpoch: nat })
export type M1WriterRequest = { windowId: number; sessionId: string; projectId: string; expectedWriterEpoch: number }
export type M1WriterConfirmation = (target: Readonly<{
  windowId: number; projectId: string; projectPath: string; takeover: boolean
}>, signal?: AbortSignal) => Promise<'approve' | 'deny' | 'cancel'>
declare const writerLease: unique symbol
export type M1WriterLease = Readonly<{
  writerToken: string; writerEpoch: number; baseRevision: string; draftRevision: string | null
  [writerLease]: true
}>
export type M1ExternalScope = Readonly<{
  windowId: number
  sessionId: string
  projectId: string
  [externalScope]: true
}>
declare const externalScope: unique symbol
type ExternalGrant = { signal: AbortSignal; controller: AbortController; grant?: Grant }
type WriteGrant = { anchor: Grant; caller: Caller; lease: M1WriterLease }
type Grant = { external?: M1ExternalScope; windowId: number; session: LocalM1Session; key: string; caller: Caller; service: M1InternalService }
interface Ports {
  root: string
  sessionFor(windowId: number): LocalM1Session | null
  onGrantInvalidated?(windowId: number): void
  onExternalDraft?(windowId: number, result: M1StageResult, lease: M1WriterLease): void
  serviceFactory?(root: string): M1InternalService
  confirm(windowId: number, projectId: string, projectPath: string): Promise<'approve' | 'deny' | 'cancel'>
}
const same = (a: LocalM1Session | null, b: LocalM1Session | null) => a === null || b === null ? a === b :
  a.sessionId === b.sessionId && a.projectId === b.projectId && a.path === b.path && a.fingerprint === b.fingerprint

export class LocalM1Authority {
  private grants = new Map<number, Grant>()
  private external = new Map<M1ExternalScope, ExternalGrant>()
  private writers = new Map<string, WriteGrant>()
  private pending = new Map<number, symbol>()
  private services = new Map<string, M1InternalService>()
  private installation?: Promise<{ installationId: string; localPrincipalId: string }>
  private ports: Ports
  private bindings: M1FileBindings
  private saving = new Map<string, number>()
  private saveGeneration = 0
  constructor(ports: Ports) {
    this.ports = ports
    this.bindings = new M1FileBindings(ports.root)
  }

  // Called inside ProjectService's serialized save, with publication inside the same bracket.
  async preserveBinding<T>(session: LocalM1Session, publish: (advance: (saved: LocalM1Session) => Promise<void>) => Promise<T>): Promise<T> {
    this.saveGeneration++
    this.saving.set(session.sessionId, (this.saving.get(session.sessionId) ?? 0) + 1)
    try {
      const previous = await this.bindings.observe(session).catch(() => null)
      return await publish(async saved => {
        if (previous) await this.bindings.advance(previous, await this.bindings.observe(saved))
      })
    } finally {
      this.saveGeneration++
      const pending = this.saving.get(session.sessionId) ?? 1
      if (pending === 1) this.saving.delete(session.sessionId)
      else this.saving.set(session.sessionId, pending - 1)
    }
  }

  async installationId(): Promise<string> {
    return (await this.localIdentity()).installationId
  }
  private localIdentity() { return this.installation ??= this.loadInstallation() }
  private async loadInstallation() {
    await fs.mkdir(this.ports.root, { recursive: true })
    const file = path.join(this.ports.root, 'installation.json')
    try {
      const handle = await fs.open(file, 'wx')
      try {
        await handle.writeFile(JSON.stringify({ storage: 1, installationId: randomUUID(), localPrincipalId: randomUUID() }))
        await handle.sync()
      } finally { await handle.close() }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const bytes = await fs.readFile(file)
    if (bytes.length > 384) throw Error('SAVE_FAILED')
    const value: unknown = JSON.parse(bytes.toString())
    if (!object({ storage: (v): v is 1 => v === 1, installationId: text, localPrincipalId: text })(value) ||
      ![value.installationId, value.localPrincipalId].every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) || value.installationId === value.localPrincipalId) throw Error('SAVE_FAILED')
    return { installationId: value.installationId, localPrincipalId: value.localPrincipalId }
  }
  private service(key: string) {
    let service = this.services.get(key)
    if (!service) {
      const root = path.join(this.ports.root, 'bindings', key)
      service = this.ports.serviceFactory?.(root) ?? new M1InternalService(root)
      this.services.set(key, service)
    }
    return service
  }
  async authorize(sender: SenderInfo, request: unknown) {
    if (!isM1AuthorizationRequest(request)) throw Error('INVALID_REQUEST')
    const current = this.ports.sessionFor(sender.webContentsId)
    if (!current || current.projectId !== request.projectId) throw Error('AUTH_REQUIRED')
    const session = { ...current }
    const ticket = Symbol()
    this.pending.set(sender.webContentsId, ticket)
    const isCurrent = () => this.pending.get(sender.webContentsId) === ticket &&
      !this.saving.has(session.sessionId) && same(session, this.ports.sessionFor(sender.webContentsId))
    const version = await this.bindings.observe(session)
    if (!isCurrent()) throw Error('AUTH_REQUIRED')
    const decision = await this.ports.confirm(sender.webContentsId, session.projectId, version.canonical)
    if (!isCurrent()) throw Error('AUTH_REQUIRED')
    if (decision !== 'approve') {
      this.pending.delete(sender.webContentsId)
      throw Error('AUTH_REQUIRED')
    }
    const old = this.grants.get(sender.webContentsId)
    if (old) this.ports.onGrantInvalidated?.(sender.webContentsId)
    this.grants.delete(sender.webContentsId)
    if (old) await this.revokeGrant(old)
    const key = await this.bindings.confirm(version, isCurrent)
    if (!isCurrent()) throw Error('AUTH_REQUIRED')
    const local = await this.localIdentity()
    const caller: Caller = { projectId: session.projectId, userId: `local-principal:${local.localPrincipalId}`,
      callerId: `window:${randomUUID()}`, authorizationRef: randomUUID(), canWrite: false }
    const service = this.service(key)
    await service.context(session.projectId, caller)
    if (!isCurrent()) {
      await service.revoke(session.projectId, caller)
      throw Error('AUTH_REQUIRED')
    }
    this.pending.delete(sender.webContentsId)
    this.grants.set(sender.webContentsId, { windowId: sender.webContentsId, session, key, caller, service })
    return { projectId: session.projectId, authorizationRef: caller.authorizationRef, requestGeneration: request.requestGeneration }
  }
  async revokeRequested(sender: SenderInfo, request: unknown) {
    if (!isM1AuthorizationRequest(request)) throw Error('INVALID_REQUEST')
    if (this.ports.sessionFor(sender.webContentsId)?.projectId !== request.projectId) throw Error('AUTH_REQUIRED')
    await this.revokeWindow(sender.webContentsId)
    return { revoked: true as const }
  }
  async revokeWindow(windowId: number) {
    this.ports.onGrantInvalidated?.(windowId)
    this.pending.delete(windowId)
    const grant = this.grants.get(windowId)
    this.grants.delete(windowId) // invalidate late replies before disk I/O
    const cleanup = [...this.external.keys()].filter(scope => scope.windowId === windowId)
      .map(scope => this.revokeExternal(scope))
    if (grant) cleanup.push(this.revokeGrant(grant))
    await Promise.all(cleanup)
  }

  async authorizeExternal(windowId: number, projectId: string, connection: AbortSignal,
    confirm: M1WriterConfirmation): Promise<M1ExternalScope> {
    const live = this.ports.sessionFor(windowId)
    if (!live || live.projectId !== projectId || connection.aborted) throw Error('AUTH_REQUIRED')
    const session = { ...live }
    const scope = Object.freeze({ windowId, sessionId: session.sessionId, projectId }) as M1ExternalScope
    const controller = new AbortController()
    const signal = AbortSignal.any([connection, controller.signal])
    const entry: ExternalGrant = { signal, controller }
    this.external.set(scope, entry)
    const isCurrent = () => this.external.get(scope) === entry && !signal.aborted &&
      !this.saving.has(session.sessionId) && same(session, this.ports.sessionFor(windowId))
    try {
      const version = await this.bindings.observe(session).catch(() => null)
      if (!version || !isCurrent()) throw Error('AUTH_REQUIRED')
      const decision = await confirm({ windowId, projectId, projectPath: version.canonical, takeover: false }, signal)
      if (decision !== 'approve' || !isCurrent()) throw Error('AUTH_REQUIRED')
      const key = await this.bindings.confirm(version, isCurrent)
      const local = await this.localIdentity()
      if (!isCurrent()) throw Error('AUTH_REQUIRED')
      this.bindings.assertCurrent(version, session.path!)
      entry.grant = { windowId, session, key, service: this.service(key), external: scope,
        caller: { projectId, userId: `local-principal:${local.localPrincipalId}`, callerId: `peer:${randomUUID()}`,
          authorizationRef: randomUUID(), canWrite: false } }
      return scope
    } catch (error) {
      await this.revokeExternal(scope)
      throw error
    }
  }

  async revokeExternal(scope: M1ExternalScope) {
    const entry = this.external.get(scope)
    this.external.delete(scope)
    entry?.controller.abort()
    if (entry?.grant) await this.revokeGrant(entry.grant)
  }

  private hasGrant(grant: Grant) {
    if (!grant.external) return this.grants.get(grant.windowId) === grant
    const entry = this.external.get(grant.external)
    return entry?.grant === grant && !entry.signal.aborted
  }

  async readExternalContext(scope: M1ExternalScope, lease: M1WriterLease | undefined) {
    const grant = this.external.get(scope)?.grant
    if (!grant) throw Error('AUTH_REQUIRED')
    const verify = this.verifyWriterBinding(grant)
    const before = await verify()
    before.seal()
    const cut = await grant.service.context(scope.projectId, grant.caller)
    const after = await verify()
    after.seal()
    if (after.baseRevision !== before.baseRevision) throw Error('AUTH_REQUIRED')
    const writer = this.writers.get(grant.key)
    return { baseRevision: after.baseRevision, snapshot: {
      projectId: scope.projectId, draftRevision: cut.snapshot.draftRevision, cursor: cut.snapshot.cursor,
      connection: 'connected' as const, authorization: { authorized: true,
        canWrite: !!lease && writer?.lease === lease && cut.snapshot.writerEpoch === lease.writerEpoch },
      writer: { epoch: cut.snapshot.writerEpoch, occupied: cut.snapshot.writerOccupied }, spacerDraft: cut.snapshot.spacerDraft,
    }, activities: cut.activities.filter(activity => activity.source === 'external') }
  }

  private async revokeGrant(grant: Grant) {
    const writer = this.writers.get(grant.key)
    if (writer?.anchor === grant) {
      this.writers.delete(grant.key)
      await Promise.all([
        grant.service.retireWriter(grant.session.projectId, writer.caller),
        grant.service.revoke(grant.session.projectId, grant.caller),
      ])
    } else {
      await grant.service.revoke(grant.session.projectId, grant.caller)
    }
  }

  // Called only by a trusted main-process adapter after it authenticates the endpoint.
  acquireWriter(request: M1WriterRequest, confirm: M1WriterConfirmation, scope?: M1ExternalScope, checkRequest?: () => void): Promise<M1WriterLease> {
    return this.grantWriter(request, confirm, false, scope, checkRequest)
  }
  takeOverWriter(request: M1WriterRequest, confirm: M1WriterConfirmation, scope?: M1ExternalScope, checkRequest?: () => void, expectedDraftRevision?: string | null): Promise<M1WriterLease> {
    return this.grantWriter(request, confirm, true, scope, checkRequest, expectedDraftRevision)
  }

  private async grantWriter(request: M1WriterRequest, confirm: M1WriterConfirmation, takeover: boolean, scope?: M1ExternalScope, checkRequest?: () => void, expectedDraftRevision?: string | null): Promise<M1WriterLease> {
    if (!isWriterRequest(request)) throw Error('INVALID_REQUEST')
    const { windowId, sessionId, projectId, expectedWriterEpoch } = request
    const external = scope && this.external.get(scope)
    const anchor = scope ? external?.grant : this.grants.get(windowId)
    if (!anchor || anchor.windowId !== windowId || anchor.session.sessionId !== sessionId || anchor.session.projectId !== projectId) throw Error('AUTH_REQUIRED')
    const verify = this.verifyWriterBinding(anchor, undefined, checkRequest)
    const before = await verify()
    before.seal()
    const target = Object.freeze({ windowId, projectId, projectPath: before.canonicalPath, takeover })
    const decision = external ? await confirm(target, external.signal) : await confirm(target)
    if (decision !== 'approve') throw Error('AUTH_REQUIRED')
    // The adapter receives a capability object. It supplies neither identity nor authorization fields.
    const caller: Caller = { ...anchor.caller, callerId: `writer:${randomUUID()}`, authorizationRef: randomUUID(), canWrite: true }
    const approvedBinding: VerifyM1Binding = async () => {
      const current = await verify()
      if (current.baseRevision !== before.baseRevision) throw Error('AUTH_REQUIRED')
      return current
    }
    const result = await anchor.service.acquire(projectId, caller, {
      version: '0.1.0-m0', requestId: randomUUID(), projectId, authorizationRef: caller.authorizationRef, expectedWriterEpoch,
    }, takeover, approvedBinding, expectedDraftRevision)
    if (!this.hasGrant(anchor)) {
      await anchor.service.retireWriter(projectId, caller)
      throw Error('AUTH_REQUIRED')
    }
    const lease = Object.freeze(result) as M1WriterLease
    this.writers.set(anchor.key, { anchor, caller, lease })
    return lease
  }

  private verifyWriterBinding(grant: Grant, writer?: WriteGrant, checkRequest?: () => void): VerifyM1Binding {
    return async () => {
      const live = this.ports.sessionFor(grant.windowId)
      const current = live && { ...live }
      const saveGeneration = this.saveGeneration
      const checkLifecycle = () => {
        checkRequest?.()
        if (!this.hasGrant(grant) || this.saving.has(grant.session.sessionId) ||
          saveGeneration !== this.saveGeneration || !same(current, this.ports.sessionFor(grant.windowId))) {
          throw Error('AUTH_REQUIRED')
        }
        if (writer && this.writers.get(grant.key) !== writer) throw Error('WRITER_REVOKED')
      }
      checkLifecycle()
      const invalidate = () => {
        // Revocation queues on the journal, so a transaction performing a binding check cannot await it.
        void (grant.external ? this.revokeExternal(grant.external) : this.revokeWindow(grant.windowId)).catch(() => {})
        throw Error('AUTH_REQUIRED')
      }
      if (!current || current.sessionId !== grant.session.sessionId || current.projectId !== grant.session.projectId ||
        current.path !== grant.session.path || !current.path) return invalidate()
      const projectPath = current.path
      const version = await this.bindings.observe(current).catch(() => null)
      const key = version && await this.bindings.keyFor(version).catch(() => null)
      checkLifecycle()
      if (!version || key !== grant.key) return invalidate()
      return { baseRevision: version.fingerprint, canonicalPath: version.canonical, seal: () => {
        checkLifecycle()
        try { this.bindings.assertCurrent(version, projectPath) } catch { invalidate() }
      } }
    }
  }

  private writerFor(lease: M1WriterLease) {
    const writer = [...this.writers.values()].find(entry => entry.lease === lease)
    if (!writer) throw Error('WRITER_REVOKED')
    return writer
  }

  async stageChange(lease: M1WriterLease, request: M1StageChangeRequest, checkRequest?: () => void): Promise<M1StageResult> {
    const writer = this.writerFor(lease)
    const { anchor, caller } = writer
    const result = await anchor.service.stageChange(caller.projectId, caller, lease, structuredClone(request),
      this.verifyWriterBinding(anchor, writer, checkRequest), anchor.external ? 'external' : 'internal')
    if (anchor.external) this.ports.onExternalDraft?.(anchor.windowId, result, lease)
    return result
  }

  private gdtAnalyzer?: ReturnType<typeof createGdtAnalyzer>

  async runWindowGdtTool(sender: SenderInfo, projectId: string, operation: GdtToolName, raw: unknown,
    checkRequest: () => void) {
    const session = this.ports.sessionFor(sender.webContentsId)
    if (!session || session.projectId !== projectId || !await this.resolve(sender, session)) throw Error('AUTH_REQUIRED')
    checkRequest()
    const grant = this.grants.get(sender.webContentsId)
    const writer = grant && this.writers.get(grant.key)
    if (!writer) throw Error('WRITER_REVOKED')
    if (writer.anchor !== grant) throw Error('WRITER_HELD')
    return this.runGdtTool(writer.lease, operation, raw, { checkRequest })
  }

  async runGdtTool(lease: M1WriterLease, operation: GdtToolName, raw: unknown,
    options: { scope?: M1ExternalScope; origin?: 'model' | 'client'; signal?: AbortSignal; checkRequest?: () => void } = {}) {
    const writer = this.writerFor(lease)
    const { anchor, caller } = writer
    if (options.scope !== anchor.external) throw Error('AUTH_REQUIRED')
    const verify = this.verifyWriterBinding(anchor, writer, () => {
      options.signal?.throwIfAborted()
      options.checkRequest?.()
    })
    if (operation !== 'analyze_gdt_stackup') {
      return anchor.service.stageGdt(caller.projectId, caller, lease, operation, raw, verify, options.origin)
    }
    const { assembly, request, baseRevision } = await anchor.service.readGdtAnalysis(caller.projectId, caller, lease, raw, verify)
    this.gdtAnalyzer ??= createGdtAnalyzer(desktopGdtWorkerUrl())
    const result = await this.gdtAnalyzer.run(assembly, request, { signal: options.signal, timeoutMs: 30_000 })
    const context = await anchor.service.writerContext(caller.projectId, caller, lease, verify)
    if (context.baseRevision !== baseRevision) throw Error('STALE_BASE')
    if (context.draftRevision !== request.draftRevision) throw Error('STALE_DRAFT')
    return result
  }

  async withExternalWriter<T>(scope: M1ExternalScope, lease: M1WriterLease, run: (context: M1WriterContext) => T) {
    const writer = this.writerFor(lease)
    const { anchor, caller } = writer
    if (anchor.external !== scope) throw Error('AUTH_REQUIRED')
    return anchor.service.withWriter(caller.projectId, caller, lease, this.verifyWriterBinding(anchor, writer), run)
  }

  async externalWorkbenchCut(scope: M1ExternalScope, lease: M1WriterLease) {
    const writer = this.writerFor(lease)
    const grant = writer.anchor
    if (grant.external !== scope) throw Error('AUTH_REQUIRED')
    const cut = await this.grantCut(grant)
    if (cut.snapshot.writerEpoch !== lease.writerEpoch || this.writers.get(grant.key) !== writer) throw Error('WRITER_REVOKED')
    return { ...cut, caller: grant.caller }
  }

  async readWriterContext(lease: M1WriterLease): Promise<M1WriterContext> {
    const writer = this.writerFor(lease)
    const { anchor, caller } = writer
    return anchor.service.writerContext(caller.projectId, caller, lease, this.verifyWriterBinding(anchor, writer))
  }

  async registerStageReference(lease: M1WriterLease, content: string, checkRequest?: () => void): Promise<string> {
    const writer = this.writerFor(lease)
    const { anchor, caller } = writer
    return anchor.service.registerReference(caller.projectId, caller, content, {
      credentials: lease, verify: this.verifyWriterBinding(anchor, writer, checkRequest),
    })
  }

  async revokeWriter(lease: M1WriterLease): Promise<void> {
    const writer = [...this.writers.values()].find(entry => entry.lease === lease)
    if (!writer) return
    const { anchor, caller } = writer
    this.writers.delete(anchor.key)
    await anchor.service.retireWriter(caller.projectId, caller)

  }
  async resolve(sender: SenderInfo, binding: Binding) {
    const grant = this.grants.get(sender.webContentsId)
    if (!grant) return null
    const current = this.ports.sessionFor(sender.webContentsId)
    if (this.saving.has(grant.session.sessionId)) return null
    const saveGeneration = this.saveGeneration
    const version = current && await this.bindings.observe(current).catch(() => null)
    const key = version && await this.bindings.keyFor(version).catch(() => null)
    if (this.grants.get(sender.webContentsId) !== grant || saveGeneration !== this.saveGeneration ||
      this.saving.has(grant.session.sessionId) ||
      !current || !same(current, this.ports.sessionFor(sender.webContentsId))) return null
    if (binding.sessionId !== grant.session.sessionId || current.sessionId !== grant.session.sessionId ||
      binding.projectId !== grant.session.projectId || current.projectId !== grant.session.projectId ||
      current.path !== grant.session.path || ('path' in binding && binding.path !== grant.session.path) ||
      key !== grant.key) {
      await this.revokeWindow(sender.webContentsId)
      return null
    }
    return { ...grant.caller }
  }
  // The legacy peer resolver never supplies identity. Verified sockets use authorizeExternal.
  async resolvePeer(): Promise<null> { return null }
  private async active(binding: Binding, caller: Omit<Caller, 'canWrite'>) {
    for (const grant of this.grants.values()) {
      if (grant.caller.callerId !== caller.callerId || grant.caller.userId !== caller.userId ||
        grant.caller.authorizationRef !== caller.authorizationRef || grant.caller.projectId !== caller.projectId) continue
      if (await this.resolve({ webContentsId: grant.windowId, isMainFrame: true, frameUrl: null }, binding)) return grant
    }
    throw Error('AUTH_REQUIRED')
  }
  async workbenchCut(binding: Binding, caller: Omit<Caller, 'canWrite'>) {
    return this.grantCut(await this.active(binding, caller))
  }

  private async grantCut(grant: Grant) {
    const verify = this.verifyWriterBinding(grant)
    const initial = await verify()
    const cut = await grant.service.context(grant.caller.projectId, grant.caller)
    const current = await verify()
    current.seal()
    if (current.baseRevision !== initial.baseRevision) throw Error('AUTH_REQUIRED')
    const writer = this.writers.get(grant.key)
    const owner = writer?.lease.writerEpoch === cut.snapshot.writerEpoch ? writer.anchor : undefined
    return { ...cut, bindingKey: grant.key, baseRevision: current.baseRevision, seal: () => {
      current.seal()
      if (writer !== this.writers.get(grant.key)) throw Error('STALE_BASE')
    },
      writerSource: owner ? (owner.external ? 'local-agent' as const : 'model-api' as const) : null,
      writable: owner === grant || (owner?.external !== undefined && owner.windowId === grant.windowId) }
  }

  hasAuthorization(windowId: number, authorizationRef: string) {
    return this.grants.get(windowId)?.caller.authorizationRef === authorizationRef
  }

  async readContext(binding: Binding, caller: Omit<Caller, 'canWrite'>): Promise<M1ContextFields> {
    const grant = await this.active(binding, caller)
    const cut = await grant.service.context(caller.projectId, grant.caller)
    await this.active(binding, caller)
    return { snapshot: { projectId: cut.snapshot.projectId, draftRevision: cut.snapshot.draftRevision,
      cursor: cut.snapshot.cursor, connection: 'disconnected', authorization: { authorized: true, canWrite: false },
      writer: { epoch: cut.snapshot.writerEpoch, occupied: cut.snapshot.writerOccupied }, spacerDraft: cut.snapshot.spacerDraft },
    activities: cut.activities }
  }
  async recordWorkbenchConnection(binding: Binding, caller: Omit<Caller, 'canWrite'>, checkRequest: () => void) {
    const grant = await this.active(binding, caller)
    return grant.service.recordWorkbenchConnection(caller.projectId, grant.caller,
      this.verifyWriterBinding(grant, undefined, checkRequest))
  }

  async readEvents(binding: Binding, caller: Omit<Caller, 'canWrite'>, after: number, limit: number) {
    return (await this.eventPage(binding, caller, after, limit)).page
  }

  async eventPage(binding: Binding, caller: Omit<Caller, 'canWrite'>, after: number, limit: number) {
    const grant = await this.active(binding, caller)
    const cut = await grant.service.read(caller.projectId, grant.caller, after, limit)
    await this.active(binding, caller)
    const connectionSequences = new Set<number>()
    const page = { ...cut, events: cut.events.map(event => {
      if (event.type === 'workbenchConnectionChanged') {
        connectionSequences.add(event.sequence)
        return { ...event, version: '0.1.0-m0', type: 'contextChanged' }
      }
      if ('projectId' in event) return event
      if (event.type === 'taskChanged') {
        if (!event.activity) throw Error('STEP_FAILED') // Legacy harness headers cannot masquerade as full events.
        return { candidate: 'm1-review-1853', type: 'taskChanged', projectId: caller.projectId, sequence: event.sequence,
          baseRevision: event.activity.baseRevision, draftRevision: event.activity.draftRevision, jobId: null, activity: event.activity }
      }
      return { version: '0.1.0-m0', type: 'contextChanged', projectId: caller.projectId, sequence: event.sequence,
        baseRevision: null, draftRevision: null, jobId: null }
    }) }
    if (!isM1FullEventPage(caller.projectId, after)(page)) throw Error('STEP_FAILED')
    return { page, connectionSequences }
  }
}
