import { IPC_CHANNELS } from '../../shared/contracts'
import type { ProjectAgentError } from '../../shared/project-agent/contracts.ts'
import { acceptEntryReply, entryRequests, M1_ENTRY_CANDIDATE } from '../../shared/project-agent/m1-entry-1933.ts'
import type { EntryScope } from '../../shared/project-agent/m1-entry-1933.ts'
import type { Infer } from '../../shared/project-agent/schema.ts'
import { toSenderInfo } from '../ipc'
import type { IpcMainLike } from '../ipc'
import type { SenderGuard, SenderInfo } from '../senderGuard'

type Binding = Readonly<{ sessionId: string; projectId: string }>
type TrustedCaller = Readonly<{ projectId: string; authorizationRef: string; userId: string; callerId: string }>
type Key = 'getContext' | 'readProjectEvents' | 'subscribe' | 'cancel'
type Requests = { [K in keyof typeof entryRequests]: Infer<(typeof entryRequests)[K]> }
interface Ports {
  guard: SenderGuard
  sessionFor(windowId: number): Binding | null
  resolveTrustedM1Caller?(sender: SenderInfo, binding: Binding): TrustedCaller | null | Promise<TrustedCaller | null>
  readContext?(binding: Binding, caller: TrustedCaller): Promise<unknown>
  readEvents?(binding: Binding, caller: TrustedCaller, afterSequence: number, limit: number): Promise<unknown>
}

const channels = {
  getContext: IPC_CHANNELS.m1GetProjectContext,
  readProjectEvents: IPC_CHANNELS.m1ReadProjectEvents,
  subscribe: IPC_CHANNELS.m1SubscribeProjectEvents,
  cancel: IPC_CHANNELS.m1CancelProjectSubscription,
} as const

function sameBinding(a: Binding, b: Binding | null) {
  return b !== null && a.sessionId === b.sessionId && a.projectId === b.projectId
}

export function installM1ReadChannels(ipc: IpcMainLike, ports: Ports): void {
  const resolveTrustedM1Caller = ports.resolveTrustedM1Caller ?? (() => null)
  function install<K extends Key>(operation: K, validate: (value: unknown) => value is Requests[K]) {
    ipc.handle(channels[operation], async (event, ...args) => {
      const sender = toSenderInfo(event)
      const verdict = ports.guard.verify(sender)
      if (!verdict.ok) return verdict
      const initialFrame = event.senderFrame
      const request = args[0]
      if (args.length !== 1 || !validate(request)) {
        return { ok: false, error: { code: 'INVALID_REQUEST', message: 'M1 请求格式无效' } }
      }

      const scope: EntryScope = { projectId: request.projectId, authorizationRef: request.authorizationRef,
        requestGeneration: request.requestGeneration }
      const header = { ...scope, requestId: request.requestId, operation, entry: M1_ENTRY_CANDIDATE }
      function fail(code: ProjectAgentError['code'], message: string) {
        const error: ProjectAgentError = { code, message, requestId: header.requestId, retryable: false,
          details: { baseRevision: null, draftRevision: null, retryStep: null,
            recovery: code === 'CURSOR_EXPIRED' ? 'refreshSnapshot' : null, question: null } }
        return { ok: true as const, value: { ...header, ok: false as const, error } }
      }
      const denied = () => fail('AUTH_REQUIRED', '当前窗口没有该项目的 M1 授权')
      const binding = ports.sessionFor(sender.webContentsId)
      if (!binding || binding.projectId !== scope.projectId) return denied()
      const session = { ...binding }
      function currentSender() {
        const current = toSenderInfo(event)
        return event.senderFrame === initialFrame && current.frameUrl === sender.frameUrl &&
          ports.guard.verify(current).ok
      }
      const forbidden = () => ({ ok: false as const,
        error: { code: 'FORBIDDEN_SENDER' as const, message: '当前调用方没有 IPC 权限' } })
      try {
        const resolved = await resolveTrustedM1Caller(sender, session)
        if (!currentSender()) return forbidden()
        if (!resolved || resolved.projectId !== scope.projectId || resolved.authorizationRef !== scope.authorizationRef ||
          !resolved.userId || !resolved.callerId || !sameBinding(session, ports.sessionFor(sender.webContentsId))) return denied()
        const caller = { ...resolved }

        let result: unknown
        let readError: unknown
        try {
          if (operation === 'getContext' && ports.readContext) {
            result = await ports.readContext(session, caller)
          } else if (operation === 'readProjectEvents' && ports.readEvents && entryRequests.readProjectEvents(request)) {
            result = await ports.readEvents(session, caller, request.afterSequence, request.limit)
          } else {
            return fail('UNSUPPORTED_SCOPE', '此 M1 能力尚不可用')
          }
        } catch (error) {
          readError = error
        }

        if (!currentSender()) return forbidden()
        if (!sameBinding(session, ports.sessionFor(sender.webContentsId))) return denied()
        const latest = await resolveTrustedM1Caller(sender, session)
        if (!currentSender()) return forbidden()
        if (!sameBinding(session, ports.sessionFor(sender.webContentsId)) || !latest ||
          latest.projectId !== caller.projectId || latest.userId !== caller.userId ||
          latest.callerId !== caller.callerId || latest.authorizationRef !== caller.authorizationRef) return denied()
        if (readError instanceof Error && readError.message === 'AUTH_REQUIRED') return denied()
        if (readError instanceof Error && readError.message === 'CURSOR_EXPIRED') {
          return fail('CURSOR_EXPIRED', '事件游标已过期，请刷新项目上下文')
        }
        const reply = { ...header, ok: true, result }
        return acceptEntryReply(operation, request, scope, reply)
          ? { ok: true, value: reply }
          : fail('STEP_FAILED', 'M1 数据读取失败')
      } catch {
        if (!currentSender()) return forbidden()
        return fail('STEP_FAILED', 'M1 数据读取失败')
      }
    })
  }
  install('getContext', entryRequests.getContext)
  install('readProjectEvents', entryRequests.readProjectEvents)
  install('subscribe', entryRequests.subscribe)
  install('cancel', entryRequests.cancel)
}
