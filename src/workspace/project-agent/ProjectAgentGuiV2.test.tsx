// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectAgentM1Workbench } from './ProjectAgentM1Workbench'
import {
  WORKBENCH_THEME_STORAGE_KEY,
  persistWorkbenchTheme,
  readStoredWorkbenchTheme,
} from './workbenchTheme'
import type { M2CheckItem } from './m2WorkbenchBridge'

describe('寸链 v2 GUI 工作台专项验收（极简工作流、渐进披露、双主题、悬浮引用条与零参数表红线）', () => {
  afterEach(() => {
    window.localStorage.removeItem(WORKBENCH_THEME_STORAGE_KEY)
    vi.restoreAllMocks()
  })

  it('默认启用暖炭灰暗色主题（data-theme="dark"），通过顶栏「浅色/深色」按钮切换并持久化到 localStorage', async () => {
    const user = userEvent.setup()

    const { unmount } = render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialDraftRevision="draft-8"
      />,
    )

    const root = screen.getByRole('main', { name: '寸链 M1 双入口工作台' })
    expect(root).toHaveAttribute('data-theme', 'dark')

    // 顶栏直接切换主题
    const themeBtn = screen.getByTestId('theme-toggle-btn')
    expect(themeBtn).toHaveAttribute('aria-pressed', 'true')
    expect(themeBtn).toHaveTextContent('浅色')

    await user.click(themeBtn)
    expect(root).toHaveAttribute('data-theme', 'light')
    expect(window.localStorage.getItem(WORKBENCH_THEME_STORAGE_KEY)).toBe('light')

    // 重挂载后应恢复暖羊皮纸浅色主题
    unmount()
    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialDraftRevision="draft-8"
      />,
    )
    expect(screen.getByRole('main', { name: '寸链 M1 双入口工作台' })).toHaveAttribute(
      'data-theme',
      'light',
    )
  })

  it('localStorage 受限抛错时主题读写优雅降级不报错', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(readStoredWorkbenchTheme('dark')).toBe('dark')
    expect(persistWorkbenchTheme('light')).toBe(false)

    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialDraftRevision="draft-2"
      />,
    )
    expect(screen.getByRole('main', { name: '寸链 M1 双入口工作台' })).toHaveAttribute(
      'data-theme',
      'dark',
    )
  })

  it('36px 一体化顶栏集成项目菜单完整触达导入、模板、模式切换、只读视图与旧工作台', async () => {
    const user = userEvent.setup()

    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialProjectName="安装板组件"
        initialBaseRevision="v1"
        initialDraftRevision="draft-8"
      />,
    )

    const topbar = screen.getByLabelText('顶部连接状态栏')
    expect(topbar).toHaveTextContent('草稿 draft-8')

    // 常态顶栏不再平铺展示低频链接或授权下拉框
    expect(within(topbar).queryByRole('link', { name: '只读授权视图' })).not.toBeInTheDocument()
    expect(within(topbar).queryByRole('link', { name: '返回旧工作台' })).not.toBeInTheDocument()
    expect(within(topbar).queryByLabelText('写入目标入口')).not.toBeInTheDocument()

    // 打开左侧「项目名 ▾」集成项目菜单验证全部入口可达
    await user.click(screen.getByTestId('more-menu-btn'))
    const menu = screen.getByRole('menu', { name: '项目与工作台菜单' })
    expect(within(menu).getByRole('menuitem', { name: /切换本地项目/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: '只读授权视图' })).toHaveAttribute(
      'href',
      '#/desktop-m1-readonly',
    )
    expect(within(menu).getByRole('menuitem', { name: '返回旧工作台' })).toHaveAttribute(
      'href',
      '#/desktop-legacy',
    )

    // 菜单内切换工作模式同步驱动右侧栏
    await user.click(within(menu).getByRole('menuitem', { name: /切换到内置模型对话/ }))
    expect(screen.getByLabelText('内置模式多轮对话侧栏')).toBeInTheDocument()

    await user.click(screen.getByTestId('more-menu-btn'))
    await user.click(
      within(screen.getByRole('menu', { name: '项目与工作台菜单' })).getByRole('menuitem', {
        name: /切换到外置 Agent 活动/,
      }),
    )
    expect(screen.getByLabelText('外置模式任务活动侧栏')).toBeInTheDocument()
  })

  it('悬浮对象引用条按需浮现（未选中时 100% 隐藏），选中后支持路径展示、带入对话、复制引用与取消选择', async () => {
    const user = userEvent.setup()
    const copied: string[] = []

    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialDraftRevision="draft-8"
        clipboardWriter={(text) => {
          copied.push(text)
        }}
      />,
    )

    // 展开零件结构浮层并选择第二个特征
    await user.click(screen.getByTestId('toggle-structure-btn'))
    const objectList = screen.getByLabelText('对象列表')
    const featureBtns = within(
      within(objectList).getByRole('group', { name: '可选几何特征对象' }),
    ).getAllByRole('button')
    const targetFeatureBtn = featureBtns[1] ?? featureBtns[0]
    await user.click(targetFeatureBtn)

    const contextBar = screen.getByRole('region', { name: '对象引用上下文区' })
    expect(contextBar).toHaveAttribute('data-selection-active', 'true')
    expect(screen.getByTestId('selection-breadcrumb')).toBeInTheDocument()

    // 复制到外部会话
    await user.click(within(contextBar).getByRole('button', { name: '复制到外部会话' }))
    expect(copied.length).toBe(1)

    // 带入下一句话
    await user.click(within(contextBar).getByRole('button', { name: '带入下一句话' }))
    expect(screen.getByLabelText('内置模式多轮对话侧栏')).toBeInTheDocument()

    // 取消选择后，悬浮对象引用上下文条 100% 隐藏
    await user.click(within(contextBar).getByRole('button', { name: '取消选择' }))
    expect(screen.queryByRole('region', { name: '对象引用上下文区' })).not.toBeInTheDocument()
  })

  it('主工作台常态首屏画布常驻按钮 ≤ 2 个（无旋转/缩放文字按钮堆与平铺附件），且零参数表/滑块红线保持', async () => {
    const user = userEvent.setup()
    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialViewMode="model"
        initialDraftRevision="draft-8"
        initialPreviewSnapshot={{
          currentRevision: 'draft-8',
          model: { status: 'ready', revision: 'draft-8', revisionOrder: 8, isDraft: true, fingerprint: 'fp-8' },
          drawing: { status: 'ready', revision: 'draft-8', revisionOrder: 8, isDraft: true, fingerprint: 'fp-8' },
          modelMesh: {
            bounds: { min: [0, 0, 0], max: [80, 50, 8] },
            positions: [0, 0, 0, 80, 0, 0, 80, 50, 0],
            indices: [0, 1, 2],
            triangleRanges: [{ objectId: 'obj-plate-body', featureRef: 'part:plate', startTriangle: 0, endTriangle: 1 }],
          },
          features: [
            { objectId: 'obj-plate-body', breadcrumb: '安装板 › 主体', featureRef: 'part:plate', partName: '安装板', role: '主体', kind: 'plate', linkedAnnotationIds: [] },
          ],
        }}
      />,
    )

    // 取消初始默认选中后，画布未选中常态仅剩 2 个按钮：「零件结构 (N)」与右下角「适配」
    await user.click(screen.getByRole('button', { name: '取消选择' }))
    const canvas = screen.getByLabelText('中央画布')
    expect(within(canvas).getAllByRole('button').length).toBeLessThanOrEqual(2)
    expect(within(canvas).queryByRole('button', { name: '左旋' })).not.toBeInTheDocument()
    expect(within(canvas).queryByRole('button', { name: '右旋' })).not.toBeInTheDocument()
    expect(within(canvas).queryByRole('button', { name: '放大' })).not.toBeInTheDocument()
    expect(within(canvas).queryByRole('button', { name: '缩小' })).not.toBeInTheDocument()
    expect(within(canvas).queryByLabelText('对象列表')).not.toBeInTheDocument()

    // 产品红线：零滑块、零数字输入
    expect(document.querySelectorAll('input[type="range"]')).toHaveLength(0)
    expect(document.querySelectorAll('input[type="number"]')).toHaveLength(0)
  })

  it('完整 3 步新手 workflow（连接/进入 → 选特征带入对话发指令 → 查看检查 → 完成并保存 → 绑定确认提交）顺畅可达', async () => {
    const user = userEvent.setup()
    const sendM1ChatMessage = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        messageId: 'msg-wf-1',
        reply: '已将右孔向右移动 1 mm，边距复核通过。',
        draftRevision: 'draft-2',
      },
    })
    const commitM3ApprovedDraft = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        projectId: 'proj-plate-01',
        committedRevision: 'v2',
        previousBaseRevision: 'v1',
        fromDraftRevision: 'draft-2',
        summary: '正式保存 v2',
      },
    })

    const bridge = {
      testM1ModelApiConnection: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          availableModels: ['gpt-4.1'],
          selectedModel: 'gpt-4.1',
          toolCallSupported: true,
          toolRoundTripPassed: true,
          toolRoundTripName: 'describe_project',
        },
      }),
      sendM1ChatMessage,
      commitM3ApprovedDraft,
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={true}
        initialBaseRevision="v1"
        initialDraftRevision="draft-2"
        initialPreviewSnapshot={{
          currentRevision: 'draft-2',
          model: { status: 'ready', revision: 'draft-2', revisionOrder: 2, isDraft: true, fingerprint: 'fp-2' },
          drawing: { status: 'ready', revision: 'draft-2', revisionOrder: 2, isDraft: true, fingerprint: 'fp-2' },
          features: [
            { objectId: 'obj-right-hole', breadcrumb: '安装板 › 右孔 › 圆柱面', featureRef: 'hole:right', partName: '安装板', role: '右孔', kind: 'hole', linkedAnnotationIds: [] },
          ],
          requirements: [
            {
              requirementId: 'r1',
              title: '右孔边距 ≥ 13 mm',
              interpretation: '最差边距不少于 13 mm',
              required: true,
              status: 'confirmed',
              anchor: { documentRef: 'tb-1', documentName: '安装板任务书.pdf', page: 2, excerpt: '至少 13 mm' },
              linkedFeatureIds: ['obj-right-hole'],
              linkedAnnotationIds: [],
            },
          ],
          checks: [
            { checkId: 'c1', requirementId: 'r1', title: '右孔边距 ≥ 13 mm', required: true, status: 'pass', summary: '通过', linkedFeatureIds: [], linkedAnnotationIds: [], revisionFingerprint: 'fp-2' },
          ],
          checksInProgress: false,
        }}
      />,
    )

    // Step 1: 向导独占聚焦 -> 选模型 API -> 测试连接 -> 开始建模
    expect(screen.queryByLabelText('中央画布')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /使用模型 API/ }))
    await user.type(screen.getByLabelText('密钥'), 'sk-workflow-demo')
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    await user.click(await screen.findByRole('button', { name: '开始建模' }))

    // Step 2: 展开零件结构选特征 -> 带入对话 -> 点击示例/输入指令并发送（附件默认收纳在 + 引用浮层）
    expect(screen.queryByRole('dialog', { name: '对话上下文附加' })).not.toBeInTheDocument()
    await user.click(screen.getByTestId('toggle-structure-btn'))
    const featureBtns = within(
      within(screen.getByLabelText('对象列表')).getByRole('group', { name: '可选几何特征对象' }),
    ).getAllByRole('button')
    await user.click(featureBtns[0])
    await user.click(screen.getByRole('button', { name: '带入下一句话' }))
    await user.type(screen.getByLabelText('内置对话输入框'), '向右移动选中孔 1 mm')
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(sendM1ChatMessage).toHaveBeenCalledTimes(1)

    // Step 3: 查看检查 -> 点击顶栏「完成并保存」-> 绑定一次性确认提交
    await user.click(within(screen.getByRole('tablist', { name: '侧栏功能切换' })).getByRole('tab', { name: /检查/ }))
    expect(screen.getByLabelText('检查结果面板')).toHaveTextContent('右孔边距 ≥ 13 mm')

    await user.click(screen.getByTestId('complete-and-save-btn'))
    const completionView = screen.getByTestId('completion-view')
    await user.click(within(completionView).getByRole('button', { name: '保存正式版本' }))
    await user.click(within(completionView).getByRole('button', { name: '确认提交正式版本' }))
    expect(commitM3ApprovedDraft).toHaveBeenCalledTimes(1)
  })

  it('暗色主题下键盘跨区导航（F6/Alt+1..3）、六类检查统计与零手动参数表/滑块红线全部通过', async () => {
    const user = userEvent.setup()
    const checks: readonly M2CheckItem[] = [
      { checkId: 'c1', requirementId: 'r1', title: '条款通过', required: true, status: 'pass', summary: '通过', linkedFeatureIds: [], linkedAnnotationIds: [] },
      { checkId: 'c2', requirementId: 'r2', title: '条款失败', required: true, status: 'fail', summary: '失败', linkedFeatureIds: [], linkedAnnotationIds: [] },
      { checkId: 'c3', requirementId: 'r3', title: '条款待澄清', required: false, status: 'needsClarification', summary: '待澄清', linkedFeatureIds: [], linkedAnnotationIds: [] },
      { checkId: 'c4', requirementId: 'r4', title: '条款未覆盖', required: false, status: 'uncovered', summary: '未覆盖', linkedFeatureIds: [], linkedAnnotationIds: [] },
      { checkId: 'c5', requirementId: 'r5', title: '条款执行失败', required: false, status: 'executionFailed', summary: '执行失败', linkedFeatureIds: [], linkedAnnotationIds: [] },
      { checkId: 'c6', requirementId: 'r6', title: '条款检查中', required: false, status: 'checking', summary: '检查中', linkedFeatureIds: [], linkedAnnotationIds: [] },
    ]

    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialSidebarSection="checks"
        initialDraftRevision="draft-8"
        initialPreviewSnapshot={{
          currentRevision: 'draft-8',
          model: { status: 'ready', revision: 'draft-8', revisionOrder: 8, isDraft: true, fingerprint: 'fp-8' },
          drawing: { status: 'ready', revision: 'draft-8', revisionOrder: 8, isDraft: true, fingerprint: 'fp-8' },
          checks,
        }}
      />,
    )

    // 默认处于暖炭灰暗色主题，切换一次到浅色再切回暗色验证
    const workbench = screen.getByRole('main', { name: '寸链 M1 双入口工作台' })
    expect(workbench).toHaveAttribute('data-theme', 'dark')
    await user.click(screen.getByTestId('theme-toggle-btn'))
    expect(workbench).toHaveAttribute('data-theme', 'light')
    await user.click(screen.getByTestId('theme-toggle-btn'))
    expect(workbench).toHaveAttribute('data-theme', 'dark')

    // 6 类检查统计网格全部渲染（图形+文字）
    const summaryGrid = screen.getByLabelText('六类检查状态统计')
    expect(summaryGrid).toHaveTextContent('✓ 通过')
    expect(summaryGrid).toHaveTextContent('✕ 失败')
    expect(summaryGrid).toHaveTextContent('? 待澄清')
    expect(summaryGrid).toHaveTextContent('○ 未覆盖')
    expect(summaryGrid).toHaveTextContent('! 执行失败')
    expect(summaryGrid).toHaveTextContent('◌ 检查中')

    // 键盘 F6 / Alt+1..3 跨区切换（自动展开零件结构浮层并聚焦）
    const canvasRegion = screen.getByLabelText('中央画布')
    const sidebarRegion = screen.getByLabelText('主工作台侧栏')

    fireEvent.keyDown(workbench, { key: 'F6' })
    const objectListRegion = screen.getByLabelText('对象列表')
    expect(document.activeElement).toBe(objectListRegion)
    fireEvent.keyDown(workbench, { key: 'F6' })
    expect(document.activeElement).toBe(canvasRegion)
    fireEvent.keyDown(workbench, { key: 'F6' })
    expect(document.activeElement).toBe(sidebarRegion)
    fireEvent.keyDown(workbench, { key: '1', altKey: true })
    expect(document.activeElement).toBe(objectListRegion)

    // 产品红线：主流程零手动参数表、尺寸滑块与数字输入框
    expect(document.querySelectorAll('input[type="range"]')).toHaveLength(0)
    expect(document.querySelectorAll('input[type="number"]')).toHaveLength(0)
  })
})
