// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CunlianApi, ProjectOpenValue, MenuActionPayload, EditorFlushRequest } from '../../desktop/shared/contracts'
import { createSampleSnapshot } from '../project-file/__fixtures__/sampleProjectFile'
import { createModelSnapshot, sampleStlTriangle, MODEL_PART_ID, MODEL_REVISION_ID } from '../project-file/__fixtures__/modelProjectFile'
import { toSnapshotDto } from '../project-file/codec'
import { DesktopWorkspace } from './DesktopWorkspace'

// 3D 场景在 jsdom 里没有 WebGL2：用伪场景模块替换，只验证接线与命令调用。
const scene = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  handles: [] as Record<string, unknown>[],
}))
vi.mock('../parts/threeScene', () => ({
  createDemoScene: (options: Record<string, unknown>) => {
    const handle: Record<string, unknown> = {
      probe: { webgl: 'webgl2', glVersion: 'WebGL 2.0 (Mock)', glRenderer: 'Mock GPU', glVendor: 'Mock', antialias: true, dpr: 2 },
      selected: null,
      explode: 0,
      active: true,
      disposed: false,
      setSelectedPartId: (id: string | null) => { handle.selected = id },
      setExplodeT: (t: number) => { handle.explode = t },
      setActive: (value: boolean) => { handle.active = value },
      resetView: () => undefined,
      zoomBy: () => undefined,
      frameCount: () => 0,
      getView: () => ({ position: [0, 0, 0], target: [0, 0, 0], zoom: 1 }),
      dispose: () => { handle.disposed = true },
    }
    scene.options.push(options)
    scene.handles.push(handle)
    return handle
  },
}))

// 导入模型的场景同样需要 WebGL2：用伪模块验证接线与命令，不冒充真渲染。
const modelScene = vi.hoisted(() => ({
  handles: [] as Record<string, unknown>[],
  options: [] as Record<string, unknown>[],
}))
vi.mock('../parts/modelScene', () => ({
  createModelScene: (options: Record<string, unknown>) => {
    const handle: Record<string, unknown> = {
      probe: { webgl: 'webgl2', glVersion: 'WebGL 2.0 (Mock)', glRenderer: 'Mock GPU', dpr: 2 },
      selected: Boolean(options.selected),
      active: true,
      disposed: false,
      frames: 0,
      setSelected: (value: boolean) => { handle.selected = value },
      setActive: (value: boolean) => { handle.active = value },
      resetView: () => undefined,
      zoomBy: () => undefined,
      getView: () => ({ position: [0, 0, 0], target: [0, 0, 0], zoom: 1 }),
      frameCount: () => handle.frames,
      dispose: () => { handle.disposed = true },
    }
    modelScene.handles.push(handle)
    modelScene.options.push(options)
    return handle
  },
}))

let menu: (payload: MenuActionPayload) => void
let flush: (payload: EditorFlushRequest) => void
let opened: ProjectOpenValue
let api: CunlianApi
const failure = { ok: false as const, error: { code: 'NO_SPACE' as const, message: '磁盘空间不足' } }
beforeEach(async () => {
  opened = { sessionId: 'session-1', editSeq: 0, snapshot: await createSampleSnapshot(), path: null, fingerprint: null, warnings: [] }
  api = {
    newProject: vi.fn(async () => ({ ok: true as const, value: opened })),
    openProject: vi.fn(async () => ({ ok: true as const, value: opened })),
    saveProject: vi.fn(async () => ({ ok: true as const, value: { path: '/project.cunlian', fingerprint: 'hash', savedSeq: 0, warnings: [] } })),
    saveProjectAs: vi.fn(async () => ({ ok: true as const, value: { path: '/copy.cunlian', fingerprint: 'hash-copy', savedSeq: 0, warnings: [] } })),
    stageDraft: vi.fn<CunlianApi['stageDraft']>(async request => ({ ok: true as const, value: { acceptedSeq: request.editSeq, recovery: 'pending' } })),
    listRecent: vi.fn(async () => ({ ok: true as const, value: { items: [{ recentId: 'recent-1', projectId: 'project-a', name: '失效项目', path: '/missing.cunlian', missing: true, lastOpenedAt: '2026-11-09T08:00:00Z' }] } })),
    relinkRecent: vi.fn(async () => ({ ok: false as const, error: { code: 'CANCELLED' as const, message: '取消' } })),
    listRecovery: vi.fn(async () => ({ ok: true as const, value: { items: [{ recoveryId: 'draft-1', projectId: 'project-a', name: '恢复项目', basePath: null, baseFingerprint: null, savedAt: '2026-11-09T08:00:00Z', editSeq: 1 }] } })),
    restoreRecovery: vi.fn(async () => ({ ok: true as const, value: opened })),
    reattachSession: vi.fn<CunlianApi['reattachSession']>(async () => ({ ok: true as const, value: { session: null } })),
    readAttachment: vi.fn(async () => ({ ok: false as const, error: { code: 'NOT_FOUND' as const, message: '附件未提供' } })),
    revealProject: vi.fn(async () => ({ ok: false as const, error: { code: 'NOT_FOUND' as const, message: '尚未保存' } })),
    requestClose: vi.fn(async () => ({ ok: false as const, error: { code: 'CANCELLED' as const, message: '取消' } })),
    inspectV2: vi.fn(async () => ({ ok: true as const, value: { importToken: 'token', projects: [{ id: 'project-a', name: '迁移项目', attachmentCount: 1, missingItems: 0 }], warnings: ['来源仍需复核'] } })),
    commitV2: vi.fn(async () => ({ ok: true as const, value: { ...opened, path: '/import.cunlian' } })),
    onMenuAction: vi.fn(listener => { menu = listener; return vi.fn() }),
    onEditorFlush: vi.fn(listener => { flush = listener; return vi.fn() }),
    respondEditorFlush: vi.fn(),
    // B2 新增：默认未选择/无模型，既有用例行为不变。
    pickModel: vi.fn(async () => ({ ok: false as const, error: { code: 'CANCELLED' as const, message: '取消' } })),
    readModel: vi.fn(async () => ({ ok: false as const, error: { code: 'CANDIDATE_EXPIRED' as const, message: '无候选' } })),
    commitModel: vi.fn(async () => ({ ok: false as const, error: { code: 'STALE_EDIT' as const, message: '无候选' } })),
    releaseModel: vi.fn(async () => ({ ok: true as const, value: { released: false } })),
    linkModel: vi.fn(async () => ({ ok: false as const, error: { code: 'MISSING_REFERENCE' as const, message: '无模型' } })),
  }
  vi.stubGlobal('cunlian', api)
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  modelScene.handles.length = 0
  modelScene.options.length = 0
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
async function openExample() {
  render(<DesktopWorkspace />)
  await waitFor(() => expect(screen.getByRole('button', { name: /打开内置示例/ })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: /打开内置示例/ }))
  await screen.findByRole('main', { name: '寸链桌面工作台' })
  await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled())
}

describe('A-04b 会话接线', () => {
  it('启动页列出最近/恢复，失效项只重新定位，Rev 不伪造', async () => {
    render(<DesktopWorkspace />)
    await screen.findByText('有尚未保存的恢复草稿')
    expect(screen.getByText(/Rev 不可用/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新定位' }))
    await waitFor(() => expect(api.relinkRecent).toHaveBeenCalledWith({ recentId: 'recent-1' }))
    expect(api.openProject).not.toHaveBeenCalled()
  })
  it('打开内置示例，树/属性/复核来自快照，布局与页签保留', async () => {
    await openExample()
    expect(api.newProject).toHaveBeenCalledWith({ name: '尺寸链示例（A）', template: 'chain-demo' })
    expect(screen.getByText('未保存草稿')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'H · 总长' }))
    expect(screen.getByRole('heading', { name: '属性 · H · 总长' })).toBeInTheDocument()
    expect(screen.getByText('52.2000 mm')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '尺寸链' }))
    expect(screen.getByRole('tab', { name: '尺寸链' })).toHaveAttribute('aria-selected', 'true')
    const splitter = screen.getByRole('separator', { name: '项目树宽度' })
    fireEvent.keyDown(splitter, { key: 'ArrowRight' }); expect(splitter).toHaveAttribute('aria-valuenow', '240')
    fireEvent.click(screen.getByRole('button', { name: /复核与变更/ }))
    expect(screen.getByText('极限范围 0.1500 至 0.2500 mm')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /复核与变更/ })).toHaveTextContent('图纸 未生成')
    expect(screen.getByRole('button', { name: '增加组成环' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: opened.snapshot.documents[0].title }))
    expect(screen.getByText('有元数据，未读取附件')).toBeInTheDocument()
  })
  it('菜单 save/saveAs/open/close 真实转交，屏障回复当前会话；失败不更换 UI 快照', async () => {
    await openExample()
    act(() => menu({ action: 'save' }))
    await screen.findByText('已保存')
    expect(api.saveProject).toHaveBeenCalledWith({ sessionId: 'session-1', editSeq: 0, expectedFingerprint: null })
    act(() => menu({ action: 'saveAs' }))
    await waitFor(() => expect(api.saveProjectAs).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled())
    vi.mocked(api.openProject).mockResolvedValueOnce(failure)
    act(() => menu({ action: 'open' }))
    await screen.findByText('保存失败，编辑内容仍可继续处理')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(opened.snapshot.project.name)
    await act(async () => flush({ requestId: 'barrier' }))
    expect(api.respondEditorFlush).toHaveBeenCalledWith({ requestId: 'barrier', sessionId: 'session-1', editSeq: 0 })
    act(() => menu({ action: 'close' }))
    await waitFor(() => expect(api.requestClose).toHaveBeenCalled())
    expect(screen.getByRole('main', { name: '寸链桌面工作台' })).toBeInTheDocument()
  })
  it('恢复为未保存副本', async () => {
    render(<DesktopWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: '恢复为未保存副本' }))
    await screen.findByText('未保存草稿')
    expect(api.restoreRecovery).toHaveBeenCalledWith({ recoveryId: 'draft-1' })
  })
  it('新建与迁移菜单有可操作表单，取消不改会话，迁移成功接入主进程结果', async () => {
    render(<DesktopWorkspace />)
    await waitFor(() => expect(screen.getByRole('button', { name: /打开内置示例/ })).toBeEnabled())
    act(() => menu({ action: 'new' }))
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '新项目' } })
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    await screen.findByText('未保存草稿')
    expect(api.newProject).toHaveBeenCalledWith({ name: '新项目', template: 'empty' })
    act(() => menu({ action: 'importV2' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '选择完整备份…' }))
    await within(dialog).findByText('迁移项目')
    fireEvent.click(within(dialog).getByRole('button', { name: '导入并另存为…' }))
    await screen.findByText('已保存')
    expect(api.commitV2).toHaveBeenCalledWith({ importToken: 'token', projectId: 'project-a' })
  })
  it('保存失败保留当前项目，之后仍可另存；取消打开不替换会话', async () => {
    await openExample()
    vi.mocked(api.saveProject).mockResolvedValueOnce(failure)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('保存失败，编辑内容仍可继续处理')
    await waitFor(() => expect(screen.getByRole('button', { name: '另存为…' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '另存为…' }))
    await screen.findByText('已保存')
    await waitFor(() => expect(screen.getByRole('button', { name: '打开项目' })).toBeEnabled())
    vi.mocked(api.openProject).mockResolvedValueOnce({ ok: false, error: { code: 'CANCELLED', message: '取消' } })
    fireEvent.click(screen.getByRole('button', { name: '打开项目' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled())
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(opened.snapshot.project.name)
  })
  it('卸载注销菜单与编辑屏障', () => {
    const offMenu = vi.fn(); const offFlush = vi.fn()
    vi.mocked(api.onMenuAction).mockReturnValueOnce(offMenu)
    vi.mocked(api.onEditorFlush).mockReturnValueOnce(offFlush)
    const { unmount } = render(<DesktopWorkspace />)
    unmount()
    expect(offMenu).toHaveBeenCalledOnce(); expect(offFlush).toHaveBeenCalledOnce()
  })
  it('没有桥时明确说明限制，不捏造文件成功', () => {
    vi.stubGlobal('cunlian', undefined)
    render(<DesktopWorkspace />)
    fireEvent.keyDown(window, { key: 's', metaKey: true })
    expect(screen.getByRole('status')).toHaveTextContent('window.cunlian 不可用')
  })
})

describe('A-04c 实质页面', () => {
  it('最近项目显示 main 返回的真实 Rev', async () => {
    vi.mocked(api.listRecent).mockResolvedValue({ ok: true, value: { items: [{ recentId: 'r', projectId: 'p', name: '项目', path: '/p.cunlian', lastOpenedAt: 'now', missing: false, rev: 'rev-real-7' }] } })
    render(<DesktopWorkspace />)
    expect(await screen.findByText(/Rev rev-real-7/)).toBeInTheDocument()
  })
  it('启动重新挂接 main 会话，沿用序号 stage，重挂接不伪报已保存', async () => {
    vi.mocked(api.reattachSession).mockResolvedValue({ ok: true, value: { ...opened, editSeq: 7, savedSeq: 0, path: '/p.cunlian', recovery: 'pending' } })
    render(<DesktopWorkspace />)
    await screen.findByText('有未保存修改')
    expect(api.newProject).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: '尺寸链' }))
    await waitFor(() => expect(screen.getByLabelText('第 1 行 H 基本尺寸')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('第 1 行 H 基本尺寸'), { target: { value: '52.3' } })
    await waitFor(() => expect(api.stageDraft).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1', editSeq: 8 })))
  })
  it('编辑数值/目标经既有领域计算并 stage，无效输入定位字段且不冒充旧结果', async () => {
    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '尺寸链' }))
    fireEvent.change(screen.getByLabelText('第 1 行 H 基本尺寸'), { target: { value: '52.3' } })
    expect(within(screen.getByRole('region', { name: '当前计算结果' })).getByText('0.2500 至 0.3500 mm')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('目标上限'), { target: { value: '0.4' } })
    await waitFor(() => expect(api.stageDraft).toHaveBeenCalled())
    const request = vi.mocked(api.stageDraft).mock.calls.at(-1)![0]
    expect(request.snapshot.project.dimensionChain.terms[0].nominalQ).toBe(523000)
    expect(request.snapshot.project.dimensionChain.target?.maxQ).toBe(4000)
    expect(request.snapshot.analysisSnapshots).toEqual(opened.snapshot.analysisSnapshots)
    fireEvent.change(screen.getByLabelText('第 1 行 H 基本尺寸'), { target: { value: 'bad' } })
    const input = screen.getByLabelText('第 1 行 H 基本尺寸')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(document.getElementById(input.getAttribute('aria-describedby')!)).toHaveTextContent(/.+/)
    expect(within(screen.getByRole('region', { name: '当前计算结果' })).queryByText('0.2500 至 0.3500 mm')).not.toBeInTheDocument()
    await waitFor(() => expect(vi.mocked(api.stageDraft).mock.calls.at(-1)![0].snapshot.draft?.terms[0].nominal).toBe('bad'))
  })
  it('来源 PDF 通过 readAttachment 取确切版本，读取失败有明确不可用提示，定位切页', async () => {
    opened.snapshot.bindings[0].page = 2
    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '来源 PDF' }))
    await waitFor(() => expect(api.readAttachment).toHaveBeenCalledWith({ sessionId: 'session-1', revisionId: 'sr-1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('附件不可用')
    fireEvent.click(screen.getByRole('button', { name: '查看原图位置' }))
    expect(screen.getByLabelText('页码跳转')).toHaveValue(2)
  })
  it('声明缺失不渲染空白 PDF，不尝试绕道读取', async () => {
    opened.snapshot.missingAttachments = [{ documentId: 'doc-1', revisionId: 'sr-1', blobKey: 'blob-1', reason: 'declared-missing' }]
    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '来源 PDF' }))
    expect(screen.getByRole('alert')).toHaveTextContent('已声明缺失')
    expect(api.readAttachment).not.toHaveBeenCalled()
  })
  it('历史报告只读原值，不重算；comparison 缺字段显示未冻结', async () => {
    delete opened.snapshot.analysisSnapshots[0].comparison
    opened.snapshot.analysisSnapshots[0].result.minQ = 1234
    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '历史报告' }))
    expect(screen.getByText('导入的历史记录/冻结结果，不代表当前已确认')).toBeInTheDocument()
    expect(screen.getByText('0.1234 至 0.2500 mm')).toBeInTheDocument()
    expect(screen.getByText('未冻结')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(api.stageDraft).not.toHaveBeenCalled()
  })
})

describe('B1 内置轴系示例整合', () => {
  beforeEach(() => { scene.options.length = 0; scene.handles.length = 0 })

  const PART_NAMES = ['阶梯轴', '左轴承', '隔套', '右轴承', '挡圈']
  const tree = () => screen.getByRole('complementary', { name: '项目树' })
  const partGroup = () => within(tree()).getByText('零件').closest('details')!

  async function openShaftExample() {
    render(<DesktopWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: '打开轴系示例 · 示意装配（B1）' }))
    await screen.findByRole('main', { name: '寸链桌面工作台' })
    await screen.findByText(/3D 就绪/)
  }

  it('B1-A01 启动页轴系入口：建可另存的尺寸链会话后开启示例并转到 3D', async () => {
    await openShaftExample()
    expect(api.newProject).toHaveBeenCalledWith({ name: '轴系示例（B1）· 示意装配', template: 'chain-demo' })
    expect(screen.getByRole('tab', { name: '3D' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/内置轴系示例 · 示意装配/)).toBeInTheDocument()
    expect(screen.getByText(/与当前项目尺寸链未关联/)).toBeInTheDocument()
    expect(screen.getByText(/需重新打开示例/)).toBeInTheDocument()
    expect(within(partGroup()).getAllByRole('button')).toHaveLength(5)
    for (const name of PART_NAMES) expect(within(partGroup()).getByRole('button', { name })).toBeInTheDocument()
    expect(within(tree()).queryByText('尚未打开轴系示例 · B1')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /轴系示意装配三维视图/ })).toBeInTheDocument()
    expect(document.querySelector('.three-viewport')!.getAttribute('data-part-count')).toBe('5')
  })

  it('B2 占位：3D 未开启时提供 STL 导入与内置示例入口，无出图假入口', async () => {
    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '3D' }))
    expect(screen.getByRole('button', { name: '查看内置轴系示例' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入 STL 模型…' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /导出 SVG|导出图纸/ })).toBeNull()
    expect(screen.getByText('尚未打开轴系示例 · B1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看内置轴系示例' }))
    await screen.findByText(/3D 就绪/)
    expect(within(partGroup()).getAllByRole('button')).toHaveLength(5)
    // 没有新建会话：示例挂到当前会话上。
    expect(api.newProject).toHaveBeenCalledTimes(1)
  })

  it('B1-A02 树→模型：隔套选中、属性只读、aria-pressed 与命令同步', async () => {
    await openShaftExample()
    fireEvent.click(within(tree()).getByRole('button', { name: '隔套' }))
    expect(within(tree()).getByRole('button', { name: '隔套' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(tree()).getByRole('button', { name: '阶梯轴' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('heading', { name: '属性 · 隔套' })).toBeInTheDocument()
    expect(screen.getByText('20.0000 mm')).toBeInTheDocument()
    expect(screen.getByText('32.0000 mm')).toBeInTheDocument()
    expect(screen.getByText('12.0000 mm')).toBeInTheDocument()
    expect(within(document.getElementById('desktop-panel-1')!).getByText('当前选择：隔套')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑参数（C 批次）' })).toBeDisabled()
    expect(scene.handles.at(-1)!.selected).toBe('builtin:shaft-demo:spacer')
  })

  it('B1-A03 模型→树：场景命中回调更新树与属性，空白清除选择', async () => {
    await openShaftExample()
    const options = scene.options.at(-1) as { onSelectPart: (partId: string | null) => void }
    act(() => options.onSelectPart('builtin:shaft-demo:bearing-left'))
    expect(within(tree()).getByRole('button', { name: '左轴承' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: '属性 · 左轴承' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑参数（C 批次）' })).toBeDisabled()
    act(() => options.onSelectPart(null))
    expect(within(tree()).getByRole('button', { name: '左轴承' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('heading', { name: '属性 · 未选择' })).toBeInTheDocument()
  })

  it('B1-A04/A05 爆炸与复位命令下发，选中在切换中保留', async () => {
    await openShaftExample()
    fireEvent.click(within(tree()).getByRole('button', { name: '隔套' }))
    const handle = scene.handles.at(-1)!
    fireEvent.change(screen.getByRole('slider', { name: '爆炸程度' }), { target: { value: '100' } })
    expect(handle.explode).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: '复位装配' }))
    expect(handle.explode).toBe(0)
    expect(within(tree()).getByRole('button', { name: '隔套' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('B1 属性栏「爆炸位移（当前）」随滑条变化，「设计最大位移（上限）」为静态值', async () => {
    await openShaftExample()
    fireEvent.click(within(tree()).getByRole('button', { name: '左轴承' }))
    const panel = document.getElementById('desktop-properties')!
    const value = (key: string) => within(panel).getByText(key).nextElementSibling?.textContent
    expect(value('爆炸位移（当前）')).toBe('0.0 mm（X）')
    expect(value('设计最大位移（上限）')).toBe('-24.0 mm（X）')
    fireEvent.change(screen.getByRole('slider', { name: '爆炸程度' }), { target: { value: '100' } })
    expect(value('爆炸位移（当前）')).toBe('-24.0 mm（X）')
    fireEvent.change(screen.getByRole('slider', { name: '爆炸程度' }), { target: { value: '50' } })
    expect(value('爆炸位移（当前）')).toBe('-12.0 mm（X）')
    fireEvent.click(screen.getByRole('button', { name: '复位装配' }))
    expect(value('爆炸位移（当前）')).toBe('0.0 mm（X）')
    fireEvent.click(within(tree()).getByRole('button', { name: '隔套' }))
    expect(value('爆炸位移（当前）')).toBe('0.0 mm（X）')
    expect(value('设计最大位移（上限）')).toBe('0.0 mm（X）（装配基准，不参与爆炸）')
  })

  it('B1-A07 标签保持：切走时暂停渲染，切换后选择/爆炸/实例不丢', async () => {
    await openShaftExample()
    fireEvent.click(within(tree()).getByRole('button', { name: '隔套' }))
    fireEvent.change(screen.getByRole('slider', { name: '爆炸程度' }), { target: { value: '40' } })
    const handle = scene.handles.at(-1)!
    fireEvent.click(screen.getByRole('tab', { name: '尺寸链' }))
    await waitFor(() => expect(handle.active).toBe(false))
    fireEvent.click(screen.getByRole('tab', { name: '3D' }))
    await waitFor(() => expect(handle.active).toBe(true))
    expect(handle.disposed).toBe(false)
    expect(handle.explode).toBe(0.4)
    expect(within(tree()).getByRole('button', { name: '隔套' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('B1-A09 状态隔离：3D 选择/爆炸/相机不产生 stageDraft，保存状态仍由 A-04 决定', async () => {
    await openShaftExample()
    fireEvent.click(within(tree()).getByRole('button', { name: '隔套' }))
    fireEvent.change(screen.getByRole('slider', { name: '爆炸程度' }), { target: { value: '70' } })
    const options = scene.options.at(-1) as { onViewChange: (view: unknown) => void }
    act(() => options.onViewChange({ position: [1, 2, 3], target: [0, 0, 0], zoom: 2 }))
    fireEvent.click(screen.getByRole('button', { name: '重置视角' }))
    expect(api.stageDraft).not.toHaveBeenCalled()
    expect(screen.getByText('未保存草稿')).toBeInTheDocument()
    // 主标题仍来自 main 返回的快照，3D 交互没有替换或重算项目数据。
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('寸链 ·')
    expect(screen.getByRole('heading', { name: '属性 · 隔套' })).toBeInTheDocument()
  })

  it('B1-A07 换会话：示例关闭、旧 3D 实例释放、零件选择清空', async () => {
    await openShaftExample()
    fireEvent.click(within(tree()).getByRole('button', { name: '隔套' }))
    vi.mocked(api.openProject).mockResolvedValueOnce({ ok: true, value: { ...opened, sessionId: 'session-2', editSeq: 0 } })
    fireEvent.click(screen.getByRole('button', { name: '打开项目' }))
    await waitFor(() => expect(screen.getByText('尚未打开轴系示例 · B1')).toBeInTheDocument())
    expect(screen.queryByRole('img', { name: /轴系示意装配三维视图/ })).toBeNull()
    expect(scene.handles.length).toBeGreaterThan(0)
    expect(scene.handles.every(handle => handle.disposed === true)).toBe(true)
    expect(screen.getByRole('heading', { name: '属性 · 未选择' })).toBeInTheDocument()
  })
})

describe('B2 模型导入与外形资料来源', () => {
  const tree = () => screen.getByRole('complementary', { name: '项目树' })
  const partGroup = () => within(tree()).getByText('零件').closest('details')!
  it('导入：pick→read→确认→commit；显示文件名/面数，爆炸入口禁用', async () => {
    const { snapshot } = await createModelSnapshot()
    const dto = toSnapshotDto(snapshot)
    const stlBytes = sampleStlTriangle()
    vi.mocked(api.pickModel).mockResolvedValueOnce({ ok: true, value: { candidateToken: 'tok-1', fileName: 'sleeve.stl', byteSize: stlBytes.byteLength, sha256: 'a'.repeat(64) } })
    vi.mocked(api.readModel).mockResolvedValueOnce({ ok: true, value: { bytes: stlBytes, sha256: 'a'.repeat(64), fileName: 'sleeve.stl', byteSize: stlBytes.byteLength } })
    vi.mocked(api.commitModel).mockResolvedValueOnce({ ok: true, value: { acceptedSeq: 1, modelRevisionId: MODEL_REVISION_ID, snapshot: dto, recovery: 'written' } })

    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '3D' }))
    fireEvent.click(screen.getByRole('button', { name: '导入 STL 模型…' }))
    const dialog = await screen.findByRole('dialog', { name: '确认导入模型' })
    expect(within(dialog).getByDisplayValue('sleeve')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('部件名称'), { target: { value: '隔套外形' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '导入为不可变版本' }))

    await waitFor(() => expect(api.commitModel).toHaveBeenCalled())
    const request = vi.mocked(api.commitModel).mock.calls.at(-1)![0]
    expect(request.expectedCurrentModelRevisionId).toBeNull()
    expect(request.partName).toBe('隔套外形')
    expect(request.unitNote).toBe('未注明（STL 无标准单位）')
    await screen.findByText(/导入模型 · sleeve.stl/)
    expect(screen.getByRole('button', { name: '爆炸（整体网格不支持）' })).toBeDisabled()
    expect(within(partGroup()).getByRole('button', { name: '隔套外形' })).toBeInTheDocument()
    fireEvent.click(within(partGroup()).getByRole('button', { name: '隔套外形' }))
    expect(screen.getAllByText(/不改变尺寸链数值、不自动同步/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/1 面/).length).toBeGreaterThan(0)
  })

  it('解析失败：具体错误、旧模型视图保留、候选被释放、不调用 commit', async () => {
    const { snapshot } = await createModelSnapshot()
    const dto = toSnapshotDto(snapshot)
    const stlBytes = sampleStlTriangle()
    vi.mocked(api.openProject).mockResolvedValueOnce({ ok: true, value: { ...opened, snapshot: dto } })
    // 首次按版本读取用于显示；替换候选读取返回坏字节。
    vi.mocked(api.readModel)
      .mockResolvedValueOnce({ ok: true, value: { bytes: stlBytes, sha256: 'a'.repeat(64), fileName: 'sleeve.stl', byteSize: stlBytes.byteLength } })
      .mockResolvedValueOnce({ ok: true, value: { bytes: new TextEncoder().encode('not an stl'), sha256: 'b'.repeat(64), fileName: 'broken.stl', byteSize: 10 } })
    vi.mocked(api.pickModel).mockResolvedValueOnce({ ok: true, value: { candidateToken: 'tok-bad', fileName: 'broken.stl', byteSize: 10, sha256: 'b'.repeat(64) } })
    vi.mocked(api.releaseModel).mockResolvedValue({ ok: true, value: { released: true } })

    render(<DesktopWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: /打开项目/ }))
    await screen.findByRole('main', { name: '寸链桌面工作台' })
    fireEvent.click(screen.getByRole('tab', { name: '3D' }))
    await screen.findByText(/导入模型 · sleeve.stl/)
    fireEvent.click(screen.getByRole('button', { name: '替换模型…' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('STL_')
    expect(alert).toHaveTextContent('旧视图、当前版本与关联未改变')
    expect(screen.getByText(/导入模型 · sleeve.stl/)).toBeInTheDocument()
    expect(api.commitModel).not.toHaveBeenCalled()
    expect(api.releaseModel).toHaveBeenCalledWith({ sessionId: 'session-1', candidateToken: 'tok-bad' })
  })

  it('关联：确认文案明确不改变数值；确认后显示已核对', async () => {
    const { snapshot } = await createModelSnapshot()
    const dto = toSnapshotDto(snapshot)
    const link = {
      kind: 'visual-reference' as const,
      linkId: 'link-ui',
      termId: 't-s',
      target: { granularity: 'model' as const, partId: MODEL_PART_ID, modelRevisionId: MODEL_REVISION_ID },
      reviewStatus: 'confirmed' as const,
      reviewedModelRevisionId: MODEL_REVISION_ID,
      reviewedAt: '2026-11-09T10:00:00.000Z',
      reason: '',
    }
    vi.mocked(api.openProject).mockResolvedValueOnce({ ok: true, value: { ...opened, snapshot: dto } })
    vi.mocked(api.readModel).mockResolvedValue({ ok: true, value: { bytes: sampleStlTriangle(), sha256: 'a'.repeat(64), fileName: 'sleeve.stl', byteSize: 134 } })
    vi.mocked(api.linkModel).mockResolvedValueOnce({
      ok: true,
      value: { acceptedSeq: 1, snapshot: { ...dto, project: { ...dto.project, dimensionLinks: [link] } }, recovery: 'written', warning: '该关联只表示外形资料来源，不改变尺寸链数值、不自动同步。' },
    })

    render(<DesktopWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: /打开项目/ }))
    await screen.findByRole('main', { name: '寸链桌面工作台' })
    fireEvent.click(within(tree()).getByRole('button', { name: 'S · 隔套' }))
    const section = screen.getByRole('region', { name: '外形资料来源关联' })
    fireEvent.click(within(section).getByRole('button', { name: '关联整体模型…' }))
    const dialog = await screen.findByRole('dialog', { name: '确认外形资料来源关联' })
    expect(dialog).toHaveTextContent('不改变尺寸链数值、不自动同步')
    expect(dialog).toHaveTextContent('不是 D 批次参数联动')
    fireEvent.click(within(dialog).getByRole('button', { name: '确认关联（不改变数值）' }))

    await waitFor(() => expect(api.linkModel).toHaveBeenCalled())
    const request = vi.mocked(api.linkModel).mock.calls.at(-1)![0]
    expect(request).toMatchObject({
      operation: 'bind',
      termId: 't-s',
      target: { granularity: 'model', partId: MODEL_PART_ID, modelRevisionId: MODEL_REVISION_ID },
    })
    await waitFor(() => expect(within(section).getByText(/已核对/)).toBeInTheDocument())
  })

  it('替换尺寸差异极大的模型：按新几何包围盒重新 fit，不沿用旧相机', async () => {
    // 伪场景模块替换了真实实现，这里取回未打桩的纯几何函数做数字核对。
    const actual = await vi.importActual<typeof import('../parts/modelScene')>('../parts/modelScene')
    const { snapshot } = await createModelSnapshot()
    const dto = toSnapshotDto(snapshot)
    // 替换后的快照：同一零件指向新不可变版本；新几何由 readModel 返回的 100×100 三角形决定。
    const dtoB = {
      ...dto,
      project: {
        ...dto.project,
        parts: dto.project.parts.map(part => ({ ...part, currentModelRevisionId: 'model-2' })),
        modelRevisions: [
          ...dto.project.modelRevisions,
          {
            ...dto.project.modelRevisions[0],
            modelRevisionId: 'model-2',
            parentModelRevisionId: MODEL_REVISION_ID,
            bounds: { min: [0, 0, 0] as [number, number, number], max: [100, 100, 0] as [number, number, number] },
          },
        ],
      },
    }

    vi.mocked(api.openProject).mockResolvedValueOnce({ ok: true, value: { ...opened, snapshot: dto } })
    vi.mocked(api.readModel).mockImplementation(async request =>
      request.ref.kind === 'candidate'
        ? { ok: true as const, value: { bytes: sampleStlTriangle(100), sha256: 'b'.repeat(64), fileName: 'wrench-like.stl', byteSize: 134 } }
        : { ok: true as const, value: { bytes: sampleStlTriangle(1), sha256: 'a'.repeat(64), fileName: 'sleeve.stl', byteSize: 134 } },
    )
    vi.mocked(api.pickModel).mockResolvedValueOnce({
      ok: true,
      value: { candidateToken: 'tok-2', fileName: 'wrench-like.stl', byteSize: 134, sha256: 'b'.repeat(64) },
    })
    vi.mocked(api.commitModel).mockResolvedValueOnce({
      ok: true,
      value: { acceptedSeq: 1, modelRevisionId: 'model-2', snapshot: dtoB, recovery: 'written' },
    })

    render(<DesktopWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: /打开项目/ }))
    await screen.findByRole('main', { name: '寸链桌面工作台' })
    fireEvent.click(screen.getByRole('tab', { name: '3D' }))
    await screen.findByText(/导入模型 · sleeve.stl/)
    await waitFor(() => expect(modelScene.options).toHaveLength(1))

    // 用户在旧模型（1×1×0）上手动转过视角：相机离原点 8.66。
    const first = modelScene.options[0] as { onViewChange: (view: unknown) => void }
    act(() => first.onViewChange({ position: [5, 5, 5], target: [0, 0, 0], zoom: 1 }))

    fireEvent.click(screen.getByRole('button', { name: '替换模型…' }))
    const dialog = await screen.findByRole('dialog', { name: '确认导入模型' })
    fireEvent.click(within(dialog).getByRole('button', { name: '导入为不可变版本' }))

    await waitFor(() => expect(modelScene.options).toHaveLength(2))
    const replaced = modelScene.options[1] as {
      view: unknown
      bounds: { min: readonly number[]; max: readonly number[] }
    }

    // 新场景拿到的是新几何包围盒，而不是旧版本的 view；由 modelScene 走首建同一套 fit。
    expect(replaced.bounds).toEqual({ min: [0, 0, 0], max: [100, 100, 0] })
    expect(replaced.view).toBeNull()

    // fit 距离与旧 pose 对比：新几何需要 >100 的相机距离，旧 pose 只有 8.66。
    const fitted = actual.defaultModelView({ min: [0, 0, 0], max: [100, 100, 0] }, 1.6)
    const fittedDistance = Math.hypot(
      fitted.position[0] - fitted.target[0],
      fitted.position[1] - fitted.target[1],
      fitted.position[2] - fitted.target[2],
    )
    expect(fittedDistance).toBeGreaterThan(100)
    expect(fittedDistance / Math.hypot(5, 5, 5)).toBeGreaterThan(10)

    // 同一版本内再转视角不会重建场景（手动视角仍只在本次会话保留）。
    act(() => (replaced as unknown as { onViewChange: (view: unknown) => void }).onViewChange({ position: [80, 60, 120], target: [50, 50, 0], zoom: 1 }))
    expect(modelScene.options).toHaveLength(2)
  })
})
