import { IPC_CHANNELS } from '../../shared/contracts.ts'
import { toSenderInfo } from '../ipc.ts'
import type { IpcMainLike } from '../ipc.ts'
import type { SenderGuard } from '../senderGuard.ts'
import { isM1AuthorizationRequest } from '../../shared/project-agent/m1-local-authorization-2002.ts'
import type { LocalM1Authority } from './m1LocalAuthority.ts'

export function installM1AuthorizationChannels(ipc: IpcMainLike, guard: SenderGuard, authority: LocalM1Authority) {
  for (const [channel, approve] of [[IPC_CHANNELS.m1RequestAuthorization, true], [IPC_CHANNELS.m1RevokeAuthorization, false]] as const) {
    ipc.handle(channel, async (event, ...args) => {
      const sender = toSenderInfo(event)
      const verdict = guard.verify(sender)
      if (!verdict.ok) return verdict
      if (args.length !== 1 || !isM1AuthorizationRequest(args[0])) {
        return { ok: false, error: { code: 'INVALID_REQUEST', message: '授权请求格式无效' } }
      }
      const frame = event.senderFrame
      try {
        const value = approve ? await authority.authorize(sender, args[0]) :
          await authority.revokeRequested(sender, args[0])
        if (frame !== event.senderFrame || !guard.verify(toSenderInfo(event)).ok) {
          await authority.revokeWindow(sender.webContentsId)
          return { ok: false, error: { code: 'FORBIDDEN_SENDER', message: '授权窗口已失效' } }
        }
        return { ok: true, value }
      } catch {
        return { ok: false, error: { code: 'AUTH_REQUIRED', message: '未授予当前窗口项目只读权限' } }
      }
    })
  }
}
