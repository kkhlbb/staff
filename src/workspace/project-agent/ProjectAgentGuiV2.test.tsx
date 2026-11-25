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

describe('寸链 v2 GUI 工作台专项验收（双主题、单行顶栏、悬浮引用条、六类检查与零参数表红线）', () => {
  afterEach(() => {
    window.localStorage.removeItem(WORKBENCH_THEME_STORAGE_KEY)
    vi.restoreAllMocks()
  })

  it('默认启用 Light Studio（data-theme="light"），一键切换 Dark CAD 并安全持久化到 localStorage', async () => {
    const user = userEvent.setup()

    const { unmount } = render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialDraftRevision="draft-8"
      />,
    )

    const root = screen.getByRole('main', { name: '寸链 M1 双入口工作台' })
    expect(root).toHaveAttribute('data-theme', 'light')

    const themeBtn = screen.getByTestId('theme-toggle-btn')
    expect(themeBtn).toHaveAttribute('aria-pressed', 'false')
    expect(themeBtn).toHaveTextContent('Light Studio')

    await user.click(themeBtn)
    expect(root).toHaveAttribute('data-theme', 'dark')
    expect(themeBtn).toHaveAttribute('aria-pressed', 'true')
    expect(themeBtn).toHaveTextContent('Dark CAD')
    expect(window.localStorage.getItem(WORKBENCH_THEME_STORAGE_KEY)).toBe('dark')

    // 重挂载后应恢复 Dark CAD 主题
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
      'dark',
    )
  })

  it('localStorage 受限抛错时主题读写优雅降级不报错', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(readStoredWorkbenchTheme('light')).toBe('light')
    expect(persistWorkbenchTheme('dark')).toBe(false)

    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialDraftRevision="draft-2"
      />,
    )
    expect(screen.getByRole('main', { name: '寸链 M1 双入口工作台' })).toHaveAttribute(
      'data-theme',
      'light',
    )
  })

  it('顶栏提供分节修订胶囊、快捷双入口切换与低干扰导航链接', async () => {
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
    expect(topbar).toHaveTextContent('正式版 v1 · 草稿 draft-8')
    expect(within(topbar).getByRole('link', { name: '只读授权视图' })).toHaveAttribute(
      'href',
      '#/desktop-m1-readonly',
    )
    expect(within(topbar).getByRole('link', { name: '返回旧工作台' })).toHaveAttribute(
      'href',
      '#/desktop-legacy',
    )

    // 顶栏内置对话 / 外置活动快捷切换同步驱动右侧栏
    const quickSwitch = within(topbar).getByRole('group', { name: '顶部入口快捷切换' })
    await user.click(within(quickSwitch).getByRole('button', { name: '内置对话' }))
    expect(screen.getByLabelText('内置模式多轮对话侧栏')).toBeInTheDocument()

    await user.click(within(quickSwitch).getByRole('button', { name: '外置活动' }))
    expect(screen.getByLabelText('外置模式任务活动侧栏')).toBeInTheDocument()
  })

  it('悬浮对象引用条支持层级路径展示、带入下一句话、复制到外部会话与取消选择', async () => {
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

    const contextBar = screen.getByRole('region', { name: '对象引用上下文区' })
    expect(contextBar).toHaveAttribute('data-selection-active', 'true')

    // 点选对象列表中的第二个特征，验证面包屑切换
    const objectList = screen.getByLabelText('对象列表')
    const featureBtns = within(objectList).getAllByRole('button')
    const targetFeatureBtn = featureBtns[1] ?? featureBtns[0]
    await user.click(targetFeatureBtn)

    expect(contextBar).toHaveAttribute('data-selection-active', 'true')
    expect(screen.getByTestId('selection-breadcrumb')).toHaveTextContent(
      targetFeatureBtn.textContent ?? '',
    )

    // 复制到外部会话
    await user.click(within(contextBar).getByRole('button', { name: '复制到外部会话' }))
    expect(copied.length).toBe(1)

    // 带入下一句话
    await user.click(within(contextBar).getByRole('button', { name: '带入下一句话' }))
    expect(screen.getByLabelText('内置模式多轮对话侧栏')).toBeInTheDocument()

    // 取消选择
    await user.click(within(contextBar).getByRole('button', { name: '取消选择' }))
    expect(contextBar).toHaveAttribute('data-selection-active', 'false')
    expect(within(contextBar).getByText('未选中任何几何对象')).toBeInTheDocument()
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

    // 切换 Dark CAD 主题
    await user.click(screen.getByTestId('theme-toggle-btn'))
    const workbench = screen.getByRole('main', { name: '寸链 M1 双入口工作台' })
    expect(workbench).toHaveAttribute('data-theme', 'dark')

    // 6 类检查统计网格全部渲染（图形+文字）
    const summaryGrid = screen.getByLabelText('六类检查状态统计')
    expect(summaryGrid).toHaveTextContent('✓ 通过')
    expect(summaryGrid).toHaveTextContent('✕ 失败')
    expect(summaryGrid).toHaveTextContent('? 待澄清')
    expect(summaryGrid).toHaveTextContent('○ 未覆盖')
    expect(summaryGrid).toHaveTextContent('! 执行失败')
    expect(summaryGrid).toHaveTextContent('◌ 检查中')

    // 键盘 F6 / Alt+1..3 跨区切换
    const objectListRegion = screen.getByLabelText('对象列表')
    const canvasRegion = screen.getByLabelText('中央画布')
    const sidebarRegion = screen.getByLabelText('主工作台侧栏')

    fireEvent.keyDown(workbench, { key: 'F6' })
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
