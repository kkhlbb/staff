import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloseGuard } from '../main/closeGuard'
import type { EditorFlushRequest } from '../shared/contracts'

function makeGuard(overrides: { timeoutMs?: number } = {}): {
  guard: CloseGuard
  sent: EditorFlushRequest[]
} {
  const sent: EditorFlushRequest[] = []
  const guard = new CloseGuard({
    timeoutMs: overrides.timeoutMs ?? 3000,
    sendFlush: (_webContentsId, payload) => {
      sent.push(payload)
    },
  })
  return { guard, sent }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('CloseGuard', () => {
  it('同一窗口的合法 flushed 回复放行关闭', async () => {
    const { guard, sent } = makeGuard()
    expect(guard.beginClose(1)).toBe(true)
    const pending = guard.requestFlush(1)
    expect(sent).toHaveLength(1)
    const requestId = sent[0]?.requestId ?? ''
    expect(requestId.length).toBeGreaterThan(0)

    const verdict = guard.acceptFlushed(1, { requestId })
    expect(verdict.ok).toBe(true)
    await expect(pending).resolves.toEqual({ ok: true })
  })

  it('超时返回 EDITOR_TIMEOUT，不抛异常', async () => {
    vi.useFakeTimers()
    const { guard } = makeGuard({ timeoutMs: 3000 })
    const pending = guard.requestFlush(1)
    await vi.advanceTimersByTimeAsync(3000)
    const outcome = await pending
    expect(outcome.ok).toBe(false)
    expect(outcome.error?.code).toBe('EDITOR_TIMEOUT')
  })

  it('非发起窗口的回复被拒绝，且不破坏待处理请求', async () => {
    const { guard, sent } = makeGuard()
    const pending = guard.requestFlush(1)
    const requestId = sent[0]?.requestId ?? ''
    const wrong = guard.acceptFlushed(2, { requestId })
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) {
      expect(wrong.error.code).toBe('FORBIDDEN_SENDER')
    }
    expect(guard.acceptFlushed(1, { requestId }).ok).toBe(true)
    await expect(pending).resolves.toEqual({ ok: true })
  })

  it('无效 editSeq 与未知 requestId 都返回 INVALID_REQUEST', async () => {
    const { guard, sent } = makeGuard()
    const pending = guard.requestFlush(1)
    const requestId = sent[0]?.requestId ?? ''

    const badSeq = guard.acceptFlushed(1, { requestId, editSeq: -1 })
    expect(badSeq.ok).toBe(false)
    if (!badSeq.ok) {
      expect(badSeq.error.code).toBe('INVALID_REQUEST')
    }

    const unknown = guard.acceptFlushed(1, { requestId: 'not-pending' })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) {
      expect(unknown.error.code).toBe('INVALID_REQUEST')
    }

    guard.acceptFlushed(1, { requestId })
    await expect(pending).resolves.toEqual({ ok: true })
  })

  it('防重入：同一窗口同时只允许一次关闭流程', () => {
    const { guard } = makeGuard()
    expect(guard.beginClose(7)).toBe(true)
    expect(guard.beginClose(7)).toBe(false)
    guard.endClose(7)
    expect(guard.beginClose(7)).toBe(true)
  })

  it('dispose 让等待中的请求以 CANCELLED 结束', async () => {
    const { guard } = makeGuard()
    const pending = guard.requestFlush(1)
    guard.dispose()
    const outcome = await pending
    expect(outcome.ok).toBe(false)
    expect(outcome.error?.code).toBe('CANCELLED')
  })
})
