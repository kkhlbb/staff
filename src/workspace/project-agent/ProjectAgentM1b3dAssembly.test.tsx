// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BufferGeometry, Float32BufferAttribute, Group } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElectronTransport } from '../../transport/electronTransport'
import {
  applyPartGroupTransform,
  applyVertexColorField,
  applyVertexDisplacementField,
  CAMERA_PRESETS,
  computeAssemblyCentroid,
  computeLocalSimulationDiagnostics,
  computePartExplodedMatrix4,
  createDefaultM1bAssemblyFixture,
  resolveContextPillActions,
  rowMajor4x4ToThreeMatrix4,
} from './assembly3dMath'
import { ProjectAgentM1Workbench } from './ProjectAgentM1Workbench'

describe('M1B-FE-01: 3D 多零件装配视口、装配树、精确拾取与智能上下文胶囊、AI 配合草案及 What-If 仿真诊断', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('1. 多零件 Matrix4 位姿计算、爆炸度 0%–100% 零重新三角化变换、X-Ray 开关、视角预设与 M3/M4 预留通道', async () => {
    const user = userEvent.setup()
    const fixture = createDefaultM1bAssemblyFixture()
    const centroid = computeAssemblyCentroid(fixture.partMeshes)

    // 纯矩阵变换：0% 为名义位姿，100% 沿 explodeVector 线性平移，且不重建几何
    const basePart = fixture.partMeshes[0]
    const bracketPart = fixture.partMeshes[2]
    const m0 = computePartExplodedMatrix4(bracketPart, centroid, 0, 28)
    const mNominal = rowMajor4x4ToThreeMatrix4(bracketPart.nominalTransform)
    expect(m0.elements).toEqual(mNominal.elements)

    const m100 = computePartExplodedMatrix4(bracketPart, centroid, 1, 28)
    // bracket nominal z = 14, explodeVector z = 1.2 * 28 = 33.6 => 47.6
    expect(m100.elements[14]).toBeCloseTo(14 + 1.2 * 28, 4)

    const group = new Group()
    applyPartGroupTransform(group, m100)
    expect(group.matrixAutoUpdate).toBe(false)
    expect(group.matrix.elements[14]).toBeCloseTo(47.6, 4)

    // M4 预留：BufferGeometry vertexColors 与 displacement 通道纯更新
    const geom = new BufferGeometry()
    const basePos = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0])
    geom.setAttribute('position', new Float32BufferAttribute(new Float32Array(basePos), 3))
    expect(
      applyVertexColorField(geom, {
        partId: basePart.partId,
        colors: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      }),
    ).toBe(true)
    expect(geom.getAttribute('color')).toBeDefined()
    expect(
      applyVertexDisplacementField(geom, basePos, {
        partId: basePart.partId,
        displacements: [0, 0, 1, 0, 0, 2, 0, 0, 3],
        scale: 2,
      }),
    ).toBe(true)
    expect(geom.getAttribute('position').getZ(2)).toBeCloseTo(6, 5)

    // 渲染多零件 3D 视口：验证视角预设（等轴/前/顶/右）、爆炸滑块零重新三角化与 X-Ray 开关
    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        feature3dAssemblyM1={true}
        initialShowOnboarding={false}
        initialViewMode="model"
        initialDraftRevision="draft-1"
      />,
    )

    const viewport = screen.getByTestId('m2-three-viewport')
    expect(viewport).toHaveAttribute('data-assembly-mode', 'multi-part')
    expect(viewport).toHaveAttribute('data-geometry-build-count', '1')
    expect(viewport).toHaveAttribute('data-xray-mode', 'false')
    expect(screen.getByTestId('css2d-annotation-layer')).toBeInTheDocument()

    // 展开装配树，拖动爆炸度 0% -> 80%，几何重建计数保持 1（零重新三角化）
    await user.click(screen.getByTestId('toggle-structure-btn'))
    const explodeSlider = screen.getByTestId('assembly-explosion-slider')
    fireEvent.change(explodeSlider, { target: { value: '80' } })
    expect(viewport).toHaveAttribute('data-explosion-percent', '80')
    expect(viewport).toHaveAttribute('data-geometry-build-count', '1')

    // 切换 X-Ray 半透明透视
    await user.click(screen.getByTestId('assembly-xray-toggle'))
    expect(viewport).toHaveAttribute('data-xray-mode', 'true')

    // 4 个标准视角预设 + 适配复位
    await user.click(screen.getByTestId('camera-preset-front'))
    expect(screen.getByLabelText('模型视角状态')).toHaveTextContent(
      `视角 ${CAMERA_PRESETS.front.yawDeg}°/${CAMERA_PRESETS.front.pitchDeg}°`,
    )
    await user.click(screen.getByTestId('camera-preset-top'))
    expect(screen.getByLabelText('模型视角状态')).toHaveTextContent(
      `视角 ${CAMERA_PRESETS.top.yawDeg}°/${CAMERA_PRESETS.top.pitchDeg}°`,
    )
    await user.click(screen.getByTestId('camera-preset-right'))
    expect(screen.getByLabelText('模型视角状态')).toHaveTextContent(
      `视角 ${CAMERA_PRESETS.right.yawDeg}°/${CAMERA_PRESETS.right.pitchDeg}°`,
    )
    await user.click(screen.getByRole('button', { name: '适合窗口' }))
    expect(screen.getByLabelText('模型视角状态')).toHaveTextContent(
      `视角 ${CAMERA_PRESETS.iso.yawDeg}°/${CAMERA_PRESETS.iso.pitchDeg}°`,
    )
  })

  it('2. 装配树浮层默认收起为「装配树 (N 零件)」，展开后支持单零件显隐、选中高亮定位及爆炸/X-Ray 联动', async () => {
    const user = userEvent.setup()

    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        feature3dAssemblyM1={true}
        initialShowOnboarding={false}
        initialViewMode="model"
        initialDraftRevision="draft-1"
      />,
    )

    // 默认收起为紧凑胶囊
    const toggleBtn = screen.getByTestId('toggle-structure-btn')
    expect(toggleBtn).toHaveTextContent('装配树 (3 零件)')
    expect(screen.queryByLabelText('装配树列表')).not.toBeInTheDocument()

    // 展开后可见全部零件与控制项
    await user.click(toggleBtn)
    const tree = screen.getByLabelText('装配树列表')
    expect(within(tree).getByText('底座安装板')).toBeInTheDocument()
    expect(within(tree).getByText('弹性隔套')).toBeInTheDocument()
    expect(within(tree).getByText('盖板支架')).toBeInTheDocument()

    // 隐藏弹性隔套 -> 3D 视口中对应零件多边形消失；再次点击恢复显示
    const svg = screen.getByTestId('m2-three-fallback-svg')
    expect(svg.querySelectorAll('[data-part-id="part-spacer"]').length).toBeGreaterThan(0)
    await user.click(screen.getByTestId('toggle-part-visibility-part-spacer'))
    expect(svg.querySelectorAll('[data-part-id="part-spacer"]')).toHaveLength(0)
    await user.click(screen.getByTestId('toggle-part-visibility-part-spacer'))
    expect(svg.querySelectorAll('[data-part-id="part-spacer"]').length).toBeGreaterThan(0)

    // 点击零件特征触发 3D 高亮
    const topFaceBtn = within(tree).getByRole('button', { name: '顶安装面' })
    await user.click(topFaceBtn)
    expect(
      svg.querySelector('[data-range-object-id="feat-base-top-face"]'),
    ).toHaveAttribute('data-highlighted', 'true')
  })

  it('3. 精确拾取（面/圆柱孔轴/边）、Shift+点击与「+ 加选第二特征」双选、零选中 100% 隐藏与无裸 ID 泄露', async () => {
    const user = userEvent.setup()

    // 纯函数动作矩阵验证
    expect(resolveContextPillActions([])).toHaveLength(0)

    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        feature3dAssemblyM1={true}
        initialShowOnboarding={false}
        initialViewMode="model"
        initialDraftRevision="draft-1"
      />,
    )

    // 零选中态 100% 隐藏智能上下文胶囊
    expect(screen.queryByTestId('assembly-context-pill')).not.toBeInTheDocument()

    const svg = screen.getByTestId('m2-three-fallback-svg')
    const baseTopFace = svg.querySelector('[data-range-object-id="feat-base-top-face"]') as Element
    const spacerBottomFace = svg.querySelector(
      '[data-range-object-id="feat-spacer-bottom-face"]',
    ) as Element
    const baseHoleAxis = screen.getByTestId('assembly-edge-feat-base-hole-axis')
    const bracketHoleAxis = screen.getByTestId('assembly-edge-feat-bracket-hole-axis')
    const baseFrontEdge = screen.getByTestId('assembly-edge-feat-base-front-edge')

    // 1) 单选一个面 -> 显示「已选 1 项」与 3 个原子动作，且不泄露裸 ID
    fireEvent.click(baseTopFace)
    const pill = screen.getByTestId('assembly-context-pill')
    expect(screen.getByTestId('selection-count-badge')).toHaveTextContent('已选 1 项')
    expect(pill).toHaveTextContent('底座安装板 › 顶安装面')
    expect(pill).not.toHaveTextContent('feat-base-top-face')
    expect(pill).not.toHaveTextContent('part-base')
    expect(screen.getByTestId('ctx-action-set-datum')).toHaveTextContent('设为基准')
    expect(screen.getByTestId('ctx-action-add-second-feature')).toHaveTextContent('+ 加选第二特征')
    expect(screen.getByTestId('ctx-action-send-to-ai')).toHaveTextContent('带入 AI 对话')

    // 2) 点击「+ 加选第二特征」再点击第二个面 -> 面 + 面动态呈现「建立面贴合配合」
    await user.click(screen.getByTestId('ctx-action-add-second-feature'))
    fireEvent.click(spacerBottomFace)
    expect(screen.getByTestId('selection-count-badge')).toHaveTextContent('已选 2 项')
    expect(screen.getByTestId('ctx-action-create-face-contact')).toHaveTextContent('建立面贴合配合')
    expect(screen.getByTestId('ctx-action-create-3d-loop')).toHaveTextContent(
      '设为 3D 封闭环测量目标',
    )
    await user.click(screen.getByTestId('ctx-action-create-face-contact'))
    expect(screen.getByTestId('context-action-feedback')).toHaveTextContent('已建立面贴合配合')

    // 3) 圆柱孔轴 + Shift+点击 圆柱孔轴 -> 动态呈现「建立同轴配合」
    fireEvent.click(baseHoleAxis)
    fireEvent.click(bracketHoleAxis, { shiftKey: true })
    expect(screen.getByTestId('selection-count-badge')).toHaveTextContent('已选 2 项')
    expect(screen.getByTestId('ctx-action-create-coaxial')).toHaveTextContent('建立同轴配合')
    expect(screen.getByTestId('assembly-context-pill')).not.toHaveTextContent('feat-base-hole-axis')

    // 4) 边 + Shift+点击 面（混合几何） -> 动态呈现「建立距离/对齐配合」
    fireEvent.click(baseFrontEdge)
    fireEvent.click(baseTopFace, { shiftKey: true })
    expect(screen.getByTestId('ctx-action-create-distance-align')).toHaveTextContent(
      '建立距离/对齐配合',
    )

    // 5) 取消选择 × -> 胶囊 100% 隐藏
    await user.click(within(screen.getByTestId('assembly-context-pill')).getByRole('button', { name: '取消选择' }))
    expect(screen.queryByTestId('assembly-context-pill')).not.toBeInTheDocument()
  })

  it('4. AI 建议配合草案卡片：EvidenceRef 来源展示、逐条勾选/取消与「一键应用已选配合 (K)」反馈', async () => {
    const user = userEvent.setup()

    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        feature3dAssemblyM1={true}
        initialShowOnboarding={false}
        initialSidebarSection="conversation"
        initialDraftRevision="draft-1"
      />,
    )

    const card = screen.getByTestId('ai-mate-drafts-card')
    expect(card).toHaveTextContent('96%')
    expect(screen.getByTestId('mate-evidence-draft-mate-1-0')).toHaveTextContent('任务书 PDF 第 2 页')
    expect(screen.getByTestId('mate-evidence-draft-mate-3-0')).toHaveTextContent('用户确认声明')

    const applyBtn = screen.getByTestId('apply-mate-drafts-btn')
    expect(applyBtn).toHaveTextContent('一键应用已选配合 (3)')

    // 取消勾选第二条 -> 计数变为 2
    const draft2Checkbox = within(screen.getByTestId('ai-mate-draft-draft-mate-2')).getByRole(
      'checkbox',
    )
    await user.click(draft2Checkbox)
    expect(applyBtn).toHaveTextContent('一键应用已选配合 (2)')

    // 点击一键应用 -> 确认反馈与已应用徽标更新
    await user.click(applyBtn)
    expect(screen.getByTestId('ai-mates-applied-count')).toHaveTextContent('已应用 2 项')
    expect(screen.getByTestId('ai-mates-feedback')).toHaveTextContent('已确认并应用 2 条 AI 建议配合')
  })

  it('5. 仿真诊断与 What-If 面板：指标卡片、SVG 直方图、帕累托降序、滑块 <500ms 重算及双向高亮 3D 特征', async () => {
    const user = userEvent.setup()
    const fixture = createDefaultM1bAssemblyFixture()
    const baseTransport = createElectronTransport({ bridge: {}, feature3dAssemblyM1: true })
    const runSimulationSpy = vi.spyOn(baseTransport, 'runSimulation')

    // 纯计算耗时验证 (< 500ms)
    const t0 = performance.now()
    const diag = computeLocalSimulationDiagnostics(fixture.simulationSpec)
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(500)
    expect(diag.pareto[0].varianceSharePercent).toBeGreaterThanOrEqual(
      diag.pareto[1].varianceSharePercent,
    )
    expect(diag.pareto[1].varianceSharePercent).toBeGreaterThanOrEqual(
      diag.pareto[2].varianceSharePercent,
    )

    render(
      <ProjectAgentM1Workbench
        transport={baseTransport}
        feature3dAssemblyM1={true}
        initialShowOnboarding={false}
        initialViewMode="model"
        initialSidebarSection="simulation"
        initialDraftRevision="draft-1"
      />,
    )

    // KPI 指标与纯 SVG 直方图（含 LSL/USL 标线）
    expect(screen.getByTestId('sim-kpi-nominal')).toHaveTextContent('0.200 mm')
    expect(screen.getByTestId('sim-kpi-3sigma')).toBeInTheDocument()
    const initialCpkText = screen.getByTestId('sim-kpi-cpk').textContent ?? ''
    const initialPpmText = screen.getByTestId('sim-kpi-ppm').textContent ?? ''
    expect(screen.getByTestId('simulation-histogram-svg')).toBeInTheDocument()
    expect(screen.getByTestId('sim-hist-lsl-line')).toBeInTheDocument()
    expect(screen.getByTestId('sim-hist-usl-line')).toBeInTheDocument()

    // 悬停帕累托条 -> 双向高亮中央 3D 视口中对应的特征
    const svg = screen.getByTestId('m2-three-fallback-svg')
    const paretoBracket = screen.getByTestId('pareto-item-contrib-bracket-flat')
    fireEvent.mouseEnter(paretoBracket)
    expect(
      svg.querySelector('[data-range-object-id="feat-bracket-bottom-face"]'),
    ).toHaveAttribute('data-highlighted', 'true')
    fireEvent.mouseLeave(paretoBracket)

    // 点击帕累托条 -> 选中并高亮该 3D 特征
    await user.click(within(paretoBracket).getByRole('button'))
    expect(
      svg.querySelector('[data-range-object-id="feat-bracket-bottom-face"]'),
    ).toHaveAttribute('data-selected', 'true')

    // 拖动 What-If 滑块收紧公差 -> 实时刷新 Cpk/PPM，且防抖调用 Transport.runSimulation
    const slider = screen.getByTestId('whatif-slider-contrib-bracket-flat')
    const dragStart = performance.now()
    fireEvent.change(slider, { target: { value: '0.03' } })
    const dragElapsed = performance.now() - dragStart
    expect(dragElapsed).toBeLessThan(500)
    expect(screen.getByTestId('sim-kpi-cpk').textContent).not.toBe(initialCpkText)
    expect(screen.getByTestId('sim-kpi-ppm').textContent).not.toBe(initialPpmText)

    await waitFor(() => {
      expect(runSimulationSpy).toHaveBeenCalled()
    })
  })

  it('6. FEATURE_3D_ASSEMBLY_M1 = false 时单件模式 100% 零回归（无滑块、无仿真标签页、保留原行为）', async () => {
    const user = userEvent.setup()

    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        feature3dAssemblyM1={false}
        initialShowOnboarding={false}
        initialViewMode="model"
        initialDraftRevision="draft-8"
      />,
    )

    expect(screen.getByTestId('toggle-structure-btn')).toHaveTextContent('零件结构')
    expect(screen.queryByTestId('sidebar-tab-simulation')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-mate-drafts-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('camera-preset-group')).not.toBeInTheDocument()

    // 展开零件结构也绝不渲染 input[type="range"]
    await user.click(screen.getByTestId('toggle-structure-btn'))
    expect(document.querySelectorAll('input[type="range"]')).toHaveLength(0)
  })
})
