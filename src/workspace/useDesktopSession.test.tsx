// @vitest-environment jsdom
/**
 * 缺陷 2 回归：没有活动会话时，所有写路径都必须给出统一 notice。
 *
 * 工程图页的参数联动只在有会话快照时渲染，因此“无会话”这一早退分支在界面上不可达；
 * 这里直接对 useDesktopSession 的真实早退分支取证：adapter 缺失（无 preload 桥）
 * 与 adapter 存在但 sessionId 为 null 两种情况。
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CunlianApi } from '../../desktop/shared/contracts'
import { NO_WRITABLE_SESSION_NOTICE, useDesktopSession } from './useDesktopSession'

const NO_SESSION_COPY = '当前没有可写入的活动项目，请先保存项目文件。'

/** 只提供挂载期必需的通道；五个写通道全是 spy，用来证明没有发生写入。 */
function stubApi() {
  const api = {
    reattachSession: vi.fn(async () => ({ ok: true as const, value: { session: null } })),
    listRecent: vi.fn(async () => ({ ok: true as const, value: { items: [] } })),
    listRecovery: vi.fn(async () => ({ ok: true as const, value: { items: [] } })),
    onMenuAction: vi.fn(() => () => undefined),
    onEditorFlush: vi.fn(() => () => undefined),
    respondEditorFlush: vi.fn(),
    stageChangeDraft: vi.fn(),
    previewChange: vi.fn(),
    applyChange: vi.fn(),
    bindParameter: vi.fn(),
    unbindParameter: vi.fn(),
  }
  return api
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('缺陷 2 · 无活动会话的写路径不再静默', () => {
  it('统一文案：常量与界面使用的是同一句', () => {
    expect(NO_WRITABLE_SESSION_NOTICE).toBe(NO_SESSION_COPY)
  })

  it('adapter 存在但没有会话：五个写路径都给出 notice，且不产生任何写入', async () => {
    const api = stubApi()
    vi.stubGlobal('cunlian', api as unknown as CunlianApi)
    const { result } = renderHook(() => useDesktopSession())
    await act(async () => {}) // 等挂载期 reattach/refresh 落定
    expect(result.current.state).toBeNull()

    const calls: [string, () => Promise<unknown>][] = [
      ['stageChange', () => result.current.stageChange({ innerDiameter: '20.00', outerDiameter: '32.00', length: '14.00' })],
      ['previewChange', () => result.current.previewChange()],
      ['applyChange', () => result.current.applyChange('参数变更（只同步 nominal）')],
      ['bindParameter', () => result.current.bindParameter('t-s', 'builtin:shaft-demo:spacer', 'param:spacer:length')],
      ['unbindParameter', () => result.current.unbindParameter('binding:spacer-length')],
    ]
    for (const [name, call] of calls) {
      let returned: unknown = 'unset'
      await act(async () => { returned = await call() })
      expect(returned, name).toBeNull()
      expect(result.current.notice, name).toBe(NO_SESSION_COPY)
      expect(result.current.change.notice, name).toBe(NO_SESSION_COPY)
    }

    // 不产生任何写入；草稿仍为空 ⇒ 绑定数仍为 0。
    expect(api.stageChangeDraft).not.toHaveBeenCalled()
    expect(api.previewChange).not.toHaveBeenCalled()
    expect(api.applyChange).not.toHaveBeenCalled()
    expect(api.bindParameter).not.toHaveBeenCalled()
    expect(api.unbindParameter).not.toHaveBeenCalled()
    expect(result.current.change.draft).toBeNull()
    expect(result.current.change.preview).toBeNull()
  })

  it('没有 preload 桥（adapter 为空）：点绑定参数同样给出同一条 notice，不静默', async () => {
    vi.stubGlobal('cunlian', undefined)
    const { result } = renderHook(() => useDesktopSession())
    await act(async () => {})
    await act(async () => {
      await result.current.bindParameter('t-s', 'builtin:shaft-demo:spacer', 'param:spacer:length')
    })
    expect(result.current.notice).toBe(NO_SESSION_COPY)
    expect(result.current.change.draft).toBeNull()
  })
})
