// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopSessionAdapter, type DesktopSessionState } from '../../src/workspace/desktopAdapter'
import { createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile'
import { toSnapshotDto } from '../../src/project-file/codec'
import type {
  CunlianApi,
  EditorFlushRequest,
  IpcResult,
  MenuAction,
  MenuActionPayload,
  ProjectOpenValue,
  ProjectSaveValue,
  ProjectStageValue,
  SnapshotDto,
} from '../../desktop/shared/contracts'

const FINGERPRINT = 'a'.repeat(64)

interface FakeApi {
  api: CunlianApi
  stageDraft: ReturnType<typeof vi.fn>
  saveProject: ReturnType<typeof vi.fn>
  openProject: ReturnType<typeof vi.fn>
  respondEditorFlush: ReturnType<typeof vi.fn>
  emitMenu: (action: MenuAction) => void
  emitFlush: (requestId: string) => void
  saveResult: IpcResult<ProjectSaveValue>
}

function makeFakeApi(open: ProjectOpenValue, options: {
  stageError?: IpcResult<ProjectStageValue>
  saveError?: IpcResult<ProjectSaveValue>
} = {}): FakeApi {
  let menuListener: ((payload: { action: MenuAction }) => void) | undefined
  let flushListener: ((payload: { requestId: string }) => void) | undefined
  const state: FakeApi = {
    api: undefined as unknown as CunlianApi,
    stageDraft: vi.fn(async (request: { editSeq: number }) =>
      options.stageError ?? {
        ok: true,
        value: { acceptedSeq: request.editSeq, recovery: 'pending' },
      }),
    saveProject: vi.fn(async (request: { editSeq: number }) =>
      options.saveError ?? {
        ok: true,
        value: {
          path: '/tmp/saved.cunlian',
          fingerprint: FINGERPRINT,
          savedSeq: request.editSeq,
          warnings: [],
        },
      }),
    openProject: vi.fn(async () => ({ ok: true, value: open } as IpcResult<ProjectOpenValue>)),
    respondEditorFlush: vi.fn(),
    emitMenu: (action) => menuListener?.({ action }),
    emitFlush: (requestId) => flushListener?.({ requestId }),
    saveResult: {
      ok: true,
      value: { path: '/tmp/saved.cunlian', fingerprint: FINGERPRINT, savedSeq: 0, warnings: [] },
    },
  }
  state.api = {
    newProject: vi.fn(async () => ({ ok: true, value: open })),
    openProject: state.openProject,
    stageDraft: state.stageDraft,
    saveProject: state.saveProject,
    saveProjectAs: state.saveProject,
    listRecent: vi.fn(async () => ({ ok: true, value: { items: [] } })),
    relinkRecent: vi.fn(),
    listRecovery: vi.fn(async () => ({ ok: true, value: { items: [] } })),
    restoreRecovery: vi.fn(async () => ({ ok: true, value: open })),
    requestClose: vi.fn(async () => ({ ok: true, value: { closed: true as const } })),
    inspectV2: vi.fn(),
    commitV2: vi.fn(),
    onMenuAction: (listener: (payload: MenuActionPayload) => void) => {
      menuListener = listener
      return () => {
        menuListener = undefined
      }
    },
    onEditorFlush: (listener: (payload: EditorFlushRequest) => void) => {
      flushListener = listener
      return () => {
        flushListener = undefined
      }
    },
    respondEditorFlush: state.respondEditorFlush,
  } as unknown as CunlianApi
  return state
}

async function openValue(): Promise<ProjectOpenValue> {
  const snapshot = await createSampleSnapshot()
  return {
    sessionId: 'session-1',
    editSeq: 0,
    snapshot: toSnapshotDto(snapshot),
    path: '/tmp/project.cunlian',
    fingerprint: FINGERPRINT,
    warnings: [],
  }
}

async function renamedDto(name: string): Promise<SnapshotDto> {
  const snapshot = await createSampleSnapshot()
  return toSnapshotDto({
    ...snapshot,
    project: { ...snapshot.project, name },
  })
}

let adapter: DesktopSessionAdapter | undefined

afterEach(() => {
  adapter?.dispose()
  adapter = undefined
})

describe('桌面会话适配器', () => {
  it('编辑后按序号 stage；保存前先 flush，成功后 dirty=false', async () => {
    const open = await openValue()
    const fake = makeFakeApi(open)
    const states: DesktopSessionState[] = []
    adapter = new DesktopSessionAdapter({
      api: fake.api,
      stageDelayMs: 10_000,
      onStateChange: (state) => states.push(state),
    })
    const opened = await adapter.openProject()
    expect(opened.ok).toBe(true)

    adapter.edit(await renamedDto('适配器改名'))
    expect(adapter.getState().dirty).toBe(true)
    expect(adapter.getState().localSeq).toBe(1)

    const flushed = await adapter.flushStage()
    expect(flushed.ok).toBe(true)
    if (!flushed.ok) return
    expect(flushed.value.acceptedSeq).toBe(1)
    expect(fake.stageDraft).toHaveBeenCalledTimes(1)
    expect(fake.stageDraft.mock.calls[0][0]).toMatchObject({
      sessionId: 'session-1',
      editSeq: 1,
    })

    const saved = await adapter.saveProject()
    expect(saved.ok).toBe(true)
    expect(fake.saveProject).toHaveBeenCalledWith({
      sessionId: 'session-1',
      editSeq: 1,
      expectedFingerprint: FINGERPRINT,
    })
    expect(adapter.getState().dirty).toBe(false)
    expect(adapter.getState().savedSeq).toBe(1)
    expect(adapter.getState().path).toBe('/tmp/saved.cunlian')
    expect(states.length).toBeGreaterThan(2)
  })

  it('编辑屏障：先 flush 再回复 main 已接受的序号', async () => {
    const open = await openValue()
    const fake = makeFakeApi(open)
    adapter = new DesktopSessionAdapter({ api: fake.api, stageDelayMs: 10_000 })
    await adapter.openProject()
    adapter.bind()
    adapter.edit(await renamedDto('屏障提交'))

    fake.emitFlush('req-1')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fake.stageDraft).toHaveBeenCalledTimes(1)
    expect(fake.respondEditorFlush).toHaveBeenCalledWith({
      requestId: 'req-1',
      sessionId: 'session-1',
      editSeq: 1,
    })
  })

  it('stage 失败时保留 dirty，save 直接返回错误且不调用 saveProject', async () => {
    const open = await openValue()
    const fake = makeFakeApi(open, {
      stageError: {
        ok: false,
        error: { code: 'INVALID_RECORD', message: '结构不合法' },
      },
    })
    adapter = new DesktopSessionAdapter({ api: fake.api, stageDelayMs: 10_000 })
    await adapter.openProject()
    adapter.edit(await renamedDto('无效编辑'))

    const saved = await adapter.saveProject()
    expect(saved.ok).toBe(false)
    if (!saved.ok) {
      expect(saved.error.code).toBe('INVALID_RECORD')
    }
    expect(fake.saveProject).not.toHaveBeenCalled()
    expect(adapter.getState().dirty).toBe(true)
    expect(adapter.getState().acceptedSeq).toBe(0)
  })

  it('保存失败不把 dirty 清掉', async () => {
    const open = await openValue()
    const fake = makeFakeApi(open, {
      saveError: { ok: false, error: { code: 'NO_SPACE', message: '磁盘空间不足' } },
    })
    adapter = new DesktopSessionAdapter({ api: fake.api, stageDelayMs: 10_000 })
    await adapter.openProject()
    adapter.edit(await renamedDto('保存失败'))
    const saved = await adapter.saveProject()
    expect(saved.ok).toBe(false)
    expect(adapter.getState().dirty).toBe(true)
    expect(adapter.getState().lastError?.code).toBe('NO_SPACE')
    expect(adapter.getState().path).toBe('/tmp/project.cunlian')
  })

  it('菜单 save/open 走具体方法；没有活动项目时编辑被拒绝', async () => {
    const open = await openValue()
    const fake = makeFakeApi(open)
    adapter = new DesktopSessionAdapter({ api: fake.api, stageDelayMs: 10_000 })
    expect(() => adapter!.edit({} as SnapshotDto)).toThrow(/没有活动项目/)

    adapter.bind()
    await adapter.openProject()
    fake.emitMenu('open')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fake.openProject).toHaveBeenCalledTimes(2)

    adapter.edit(await renamedDto('菜单保存'))
    fake.emitMenu('save')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(fake.saveProject).toHaveBeenCalledTimes(1)
  })
})
