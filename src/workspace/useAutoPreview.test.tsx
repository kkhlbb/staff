// @vitest-environment jsdom
/**
 * V3.5 自动预览：请求序号 + 串行 + 非法输入保留上次几何但清除通过资格。
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ChangeDraftValue,
  ChangePreviewValue,
  CunlianApi,
  ProjectOpenValue,
} from '../../desktop/shared/contracts'
import { createSampleSnapshot } from '../project-file/__fixtures__/sampleProjectFile'
import { toSnapshotDto } from '../project-file/codec'
import { useDesktopSession } from './useDesktopSession'

function draft(token: string, revision: number): ChangeDraftValue {
  return {
    draftId: 'draft-auto',
    draftRevision: revision,
    baseToken: 'a'.repeat(64),
    draftToken: token.padEnd(64, '0').slice(0, 64),
    parameters: [],
    bindings: [],
    confirmationCleared: false,
  }
}

function preview(id: string): ChangePreviewValue {
  return { previewId: id } as unknown as ChangePreviewValue
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function setup(overrides: Partial<CunlianApi>) {
  const snapshot = await createSampleSnapshot()
  const opened: ProjectOpenValue = {
    sessionId: 'session-auto',
    editSeq: 0,
    snapshot: toSnapshotDto(snapshot),
    path: '/auto.cunlian',
    fingerprint: 'f'.repeat(64),
    warnings: [],
  }
  const api = {
    newProject: vi.fn(async () => ({ ok: true as const, value: opened })),
    reattachSession: vi.fn(async () => ({ ok: true as const, value: { session: null } })),
    listRecent: vi.fn(async () => ({ ok: true as const, value: { items: [] } })),
    listRecovery: vi.fn(async () => ({ ok: true as const, value: { items: [] } })),
    onMenuAction: vi.fn(() => () => undefined),
    onEditorFlush: vi.fn(() => () => undefined),
    respondEditorFlush: vi.fn(),
    stageDraft: vi.fn(async () => ({ ok: true as const, value: { acceptedSeq: 0, recovery: 'pending' as const } })),
    ...overrides,
  } as unknown as CunlianApi
  vi.stubGlobal('cunlian', api)
  const { result } = renderHook(() => useDesktopSession())
  await act(async () => {})
  await act(async () => {
    await result.current.create('自动预览', 'chain-demo')
  })
  return { result, api }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('V3.5 自动预览：迟到响应不得覆盖新草稿', () => {
  it('快速连续输入：只接受最后序号的草稿/预览', async () => {
    let stageCount = 0
    const stage = vi.fn(async () => {
      stageCount += 1
      await sleep(stageCount === 1 ? 20 : 5)
      return { ok: true as const, value: draft(`token-${stageCount}`, stageCount) }
    })
    let previewCount = 0
    const previewFn = vi.fn(async () => {
      previewCount += 1
      const id = `preview-${previewCount}`
      await sleep(previewCount === 1 ? 80 : 5)
      return { ok: true as const, value: preview(id) }
    })
    const { result } = await setup({
      stageChangeDraft: stage as unknown as CunlianApi['stageChangeDraft'],
      previewChange: previewFn as unknown as CunlianApi['previewChange'],
    })

    let firstPromise: Promise<unknown> = Promise.resolve()
    await act(async () => {
      firstPromise = result.current.autoPreviewChange({ innerDiameter: '20.00', outerDiameter: '32.00', length: '12.04' })
      // 第一次 stage 已完成、preview 仍在途中时输入新值。
      await sleep(30)
    })
    await act(async () => {
      const second = result.current.autoPreviewChange({ innerDiameter: '20.00', outerDiameter: '32.00', length: '12.10' })
      await Promise.all([firstPromise, second])
    })

    // 两次输入都在 main 侧产生草稿，但界面只接受最后序号的结果。
    expect(stage).toHaveBeenCalledTimes(2)
    expect(previewFn).toHaveBeenCalledTimes(2)
    expect(result.current.change.draft?.draftToken).toBe('token-2'.padEnd(64, '0'))
    expect(result.current.change.preview?.previewId).toBe('preview-2')
    expect(result.current.change.autoState).toBe('valid')
    expect(result.current.change.staleReason).toBeNull()
  })

  it('非法输入：保留上次有效预览画面，但标“输入待修正，当前检查未完成”', async () => {
    const total = { value: 0 }
    const stage = vi.fn(async () => {
      total.value += 1
      if (total.value === 2) {
        return {
          ok: false as const,
          error: { code: 'INVALID_PARAMETER' as const, message: '长度：不是合法数值', detail: 'length/format' },
        }
      }
      return { ok: true as const, value: draft('token-ok', 1) }
    })
    const previewFn = vi.fn(async () => ({ ok: true as const, value: preview('preview-ok') }))
    const { result } = await setup({
      stageChangeDraft: stage as unknown as CunlianApi['stageChangeDraft'],
      previewChange: previewFn as unknown as CunlianApi['previewChange'],
    })

    await act(async () => {
      await result.current.autoPreviewChange({ innerDiameter: '20.00', outerDiameter: '32.00', length: '12.04' })
    })
    expect(result.current.change.preview?.previewId).toBe('preview-ok')

    await act(async () => {
      await result.current.autoPreviewChange({ innerDiameter: '20.00', outerDiameter: '32.00', length: '12mm' })
    })
    expect(result.current.change.autoState).toBe('invalid')
    expect(result.current.change.staleReason).toBe('输入待修正，当前检查未完成。')
    // 上次几何仍保留，但不再有当前有效通过资格。
    expect(result.current.change.preview?.previewId).toBe('preview-ok')
  })
})
