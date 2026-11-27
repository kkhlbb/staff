// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultM1bAssemblyFixture } from './assembly3dMath'
import { mapNormalizedValueToTurboColor, turboRgbToCssHex, WARM_HEAT_STOPS } from './physics3dMath'
import { ProjectAgentM1Workbench } from './ProjectAgentM1Workbench'
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  WORKBENCH_SIDEBAR_WIDTH_STORAGE_KEY,
  WORKBENCH_THEME_STORAGE_KEY,
  type WindowChromeInfo,
} from './workbenchTheme'

type MockDesktopWindow = Omit<Window, 'cunlianDesktop'> & {
  cunlianDesktop?: {
    windowChrome?: WindowChromeInfo
    setTitleBarTheme?: (theme: 'dark' | 'light') => Promise<{ ok: true }>
  }
}

describe('UI110-FE-01: v1.1.0 应用级 UI 焕新（v4 原型像素级对齐专项验收）', () => {
  afterEach(() => {
    window.localStorage.removeItem(WORKBENCH_THEME_STORAGE_KEY)
    window.localStorage.removeItem(WORKBENCH_SIDEBAR_WIDTH_STORAGE_KEY)
    delete (window as MockDesktopWindow).cunlianDesktop
    vi.restoreAllMocks()
  })

  it('1. 36px 自定义顶栏安全区（Win11 rightInsetPx=138 / macOS leftInsetPx=72）、集成项目菜单与 setTitleBarTheme 实时同步', async () => {
    const user = userEvent.setup()
    const setTitleBarTheme = vi.fn(async () => ({ ok: true as const }))
    ;(window as MockDesktopWindow).cunlianDesktop = {
      windowChrome: {
        platform: 'win32',
        hasCustomTitlebar: true,
        titlebarHeightPx: 36,
        rightInsetPx: 138,
        leftInsetPx: 0,
      },
      setTitleBarTheme,
    }

    const { unmount } = render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialProjectName="盖板-隔套组件"
        initialDraftRevision="draft-4"
      />,
    )

    // 初始化自动同步暗色原生标题栏主题
    expect(setTitleBarTheme).toHaveBeenCalledWith('dark')
    expect(screen.getByTestId('workbench-topbar')).toHaveAttribute('data-platform', 'win32')
    expect(screen.getByTestId('titlebar-right-inset')).toHaveStyle({ width: '138px' })
    expect(screen.queryByTestId('titlebar-left-inset')).not.toBeInTheDocument()

    // 切换浅色主题实时调用 setTitleBarTheme('light')
    await user.click(screen.getByTestId('theme-toggle-btn'))
    expect(setTitleBarTheme).toHaveBeenCalledWith('light')
    expect(screen.getByRole('main')).toHaveAttribute('data-theme', 'light')

    // 打开左侧一体化项目菜单，验证收编项完整可见
    await user.click(screen.getByTestId('more-menu-btn'))
    const menu = screen.getByTestId('project-dropdown-menu')
    expect(within(menu).getByTestId('menu-import-step')).toHaveTextContent('导入 STEP 装配…')
    expect(within(menu).getByTestId('menu-new-block')).toHaveTextContent('新建轻量 3D 积木')
    expect(within(menu).getByTestId('menu-open-project')).toHaveTextContent('打开 .cunlian 项目…')
    expect(within(menu).getByTestId('menu-ai-config')).toHaveTextContent('AI 连接与模型配置…')
    expect(within(menu).getByRole('menuitem', { name: '只读授权视图' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: '返回旧工作台' })).toBeInTheDocument()
    unmount()

    // macOS 平台左侧 72px 交通灯安全区
    ;(window as MockDesktopWindow).cunlianDesktop = {
      windowChrome: {
        platform: 'darwin',
        hasCustomTitlebar: true,
        titlebarHeightPx: 36,
        rightInsetPx: 0,
        leftInsetPx: 72,
      },
      setTitleBarTheme,
    }
    render(<ProjectAgentM1Workbench bridge={{}} initialShowOnboarding={false} />)
    expect(screen.getByTestId('workbench-topbar')).toHaveAttribute('data-platform', 'darwin')
    expect(screen.getByTestId('titlebar-left-inset')).toBeInTheDocument()
    expect(screen.queryByTestId('titlebar-right-inset')).not.toBeInTheDocument()
  })

  it('2. 无菜单栏全局快捷键（Ctrl/Cmd + I / N / O / S / ,）全通，并避让输入控件编辑态', () => {
    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialDraftRevision="draft-4"
        initialConnectionSnapshot={{
          connectionState: 'connected',
          source: 'model-api',
          authorizationState: 'authorized-writable',
        }}
      />,
    )

    // Ctrl+I 触发 STEP 导入提示
    fireEvent.keyDown(window, { key: 'i', ctrlKey: true })
    expect(screen.getByText(/STEP 装配导入/)).toBeInTheDocument()

    // Ctrl+S 打开完成确认视图
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    expect(screen.getByTestId('completion-view')).toBeInTheDocument()
    // 再按一次 Ctrl+S 收起
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    expect(screen.queryByTestId('completion-view')).not.toBeInTheDocument()

    // Ctrl+, 打开 AI 连接与模型配置向导
    fireEvent.keyDown(window, { key: ',', ctrlKey: true })
    expect(screen.getByText(/连接方式|使用模型 API/)).toBeInTheDocument()
    // 再按一次 Ctrl+, 返回工作台
    fireEvent.keyDown(window, { key: ',', ctrlKey: true })
    expect(screen.getByLabelText('中央画布')).toBeInTheDocument()

    // 输入框聚焦时，Ctrl+N 不应误打开新建/向导
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'n', ctrlKey: true })
    expect(screen.getByLabelText('中央画布')).toBeInTheDocument()
    document.body.removeChild(input)

    // 非编辑态按 Ctrl+O 打开项目选择
    fireEvent.keyDown(window, { key: 'o', ctrlKey: true })
    expect(screen.queryByLabelText('中央画布')).not.toBeInTheDocument()
  })

  it('3. 5px 可拖拽双栏分割线支持 300–560px 区间钳位、键盘微调与 localStorage 持久化', () => {
    const { unmount } = render(
      <ProjectAgentM1Workbench bridge={{}} initialShowOnboarding={false} />,
    )

    const resizer = screen.getByTestId('pane-resizer')
    const sidebar = screen.getByLabelText('主工作台侧栏')
    expect(resizer).toHaveAttribute('aria-valuenow', String(SIDEBAR_WIDTH_DEFAULT))
    expect(sidebar).toHaveStyle({ width: `${SIDEBAR_WIDTH_DEFAULT}px` })

    // 键盘向左增宽 20px 并持久化
    fireEvent.keyDown(resizer, { key: 'ArrowLeft' })
    expect(resizer).toHaveAttribute('aria-valuenow', String(SIDEBAR_WIDTH_DEFAULT + 20))
    expect(window.localStorage.getItem(WORKBENCH_SIDEBAR_WIDTH_STORAGE_KEY)).toBe(
      String(SIDEBAR_WIDTH_DEFAULT + 20),
    )

    // 指针拖拽超过上下界自动钳位在 [300, 560]
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    fireEvent.pointerDown(resizer, { clientX: 800, pointerId: 1 })
    fireEvent.pointerMove(resizer, { clientX: 200, pointerId: 1 })
    fireEvent.pointerUp(resizer, { pointerId: 1 })
    expect(resizer).toHaveAttribute('aria-valuenow', String(SIDEBAR_WIDTH_MAX))

    fireEvent.pointerDown(resizer, { clientX: 640, pointerId: 2 })
    fireEvent.pointerMove(resizer, { clientX: 1150, pointerId: 2 })
    fireEvent.pointerUp(resizer, { pointerId: 2 })
    expect(resizer).toHaveAttribute('aria-valuenow', String(SIDEBAR_WIDTH_MIN))

    // 重挂载后从 localStorage 恢复宽度
    unmount()
    render(<ProjectAgentM1Workbench bridge={{}} initialShowOnboarding={false} />)
    expect(screen.getByTestId('pane-resizer')).toHaveAttribute(
      'aria-valuenow',
      String(SIDEBAR_WIDTH_MIN),
    )
  })

  it('4. 3D 画布清场（左上默认收起 ▸ 装配 + 显/隐零 Emoji + 30px 底部控制条 + 贴边 30px 选择条）与单色暖度色带', async () => {
    const user = userEvent.setup()
    const fixtures = createDefaultM1bAssemblyFixture()

    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        feature3dAssemblyM1={true}
        initialShowOnboarding={false}
        initialPartMeshes={fixtures.partMeshes}
        initialSimulationSpec={fixtures.simulationSpec}
      />,
    )

    // 左上角默认收起，点击展开后零件显隐为纯文字「显 / 隐」
    const treeBtn = screen.getByTestId('toggle-structure-btn')
    expect(treeBtn).toHaveTextContent(`装配 (${fixtures.partMeshes.length})`)
    await user.click(treeBtn)
    const firstPartId = fixtures.partMeshes[0].partId
    const visBtn = screen.getByTestId(`toggle-part-visibility-${firstPartId}`)
    expect(visBtn).toHaveTextContent('显')
    await user.click(visBtn)
    expect(visBtn).toHaveTextContent('隐')

    // 底部 30px 无边框控制条集中收编云图、爆炸、透视、GD&T 标注与复位
    const vpBar = screen.getByTestId('viewport-control-bar')
    expect(within(vpBar).getByTestId('deformation-mode-nominal')).toBeInTheDocument()
    expect(within(vpBar).getByTestId('deformation-mode-heatmap')).toBeInTheDocument()
    expect(within(vpBar).getByTestId('deformation-mode-animation')).toBeInTheDocument()
    expect(within(vpBar).getByTestId('assembly-explosion-slider')).toBeInTheDocument()
    expect(within(vpBar).getByTestId('assembly-xray-toggle')).toBeInTheDocument()
    expect(within(vpBar).getByTestId('gdt-display-mode-toggle')).toBeInTheDocument()

    // 0 选中时贴边选择条 100% 隐藏
    expect(screen.queryByTestId('assembly-context-pill')).not.toBeInTheDocument()

    // 验证单色暖度色带（中性石色 #5a5853 -> 哑光锈红 #c9564b）
    expect(WARM_HEAT_STOPS).toHaveLength(4)
    expect(turboRgbToCssHex(mapNormalizedValueToTurboColor(0))).toBe('#5a5853')
    expect(turboRgbToCssHex(mapNormalizedValueToTurboColor(1))).toBe('#c9564b')
  })

  it('5. 右侧 36px 单行仿真摘要条折叠/展开与 Claude Code 风格安静工作流（左竖线消息 + 折叠工具步骤 + 纯净单盒输入）', async () => {
    const user = userEvent.setup()
    const fixtures = createDefaultM1bAssemblyFixture()

    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        feature3dAssemblyM1={true}
        initialShowOnboarding={false}
        initialPartMeshes={fixtures.partMeshes}
        initialSimulationSpec={fixtures.simulationSpec}
        initialConnectionSnapshot={{
          connectionState: 'connected',
          source: 'model-api',
          authorizationState: 'authorized-writable',
        }}
        initialMessages={[
          { id: 'u1', role: 'user', content: '请检查薄铝盖板残余间隙风险' },
          {
            id: 'a1',
            role: 'assistant',
            content: '已运行柔性公差仿真，建议收紧初始翘曲。',
            toolCalls: [{ name: 'analyze_assembly_3d', status: 'succeeded' }],
          },
        ]}
      />,
    )

    // 默认在对话视图顶部展示 36px 折叠态单行仿真摘要条
    const summaryBtn = screen.getByTestId('simulation-readout-summary')
    expect(summaryBtn).toHaveAttribute('aria-expanded', 'false')
    expect(summaryBtn).toHaveTextContent('调参 ▾')
    expect(screen.queryByTestId('simulation-readout-drawer')).not.toBeInTheDocument()

    // 点击「调参 ▾」平滑展开 What-If 滑块与直方图
    await user.click(summaryBtn)
    expect(summaryBtn).toHaveAttribute('aria-expanded', 'true')
    expect(summaryBtn).toHaveTextContent('收起 ▴')
    expect(screen.getByTestId('simulation-readout-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('simulation-histogram-svg')).toBeInTheDocument()

    // 切换到内置对话检查左竖线用户消息与 <details> 可折叠工具步骤条
    await user.click(screen.getByTestId('more-menu-btn'))
    await user.click(screen.getByRole('menuitem', { name: /切换到内置模型对话/ }))
    const toolStep = screen.getByTestId('tool-step-a1-0')
    expect(toolStep.tagName).toBe('DETAILS')
    expect(screen.getByLabelText('内置对话输入框')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toHaveTextContent('↵')
  })
})
