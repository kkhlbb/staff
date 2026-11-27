// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElectronTransport } from '../../transport/electronTransport'
import type {
  AnalyzeCompliantStackupResult,
  ImportMicMatrixResult,
  PartDisplacementField,
  StagePhysicsResult,
} from '../../transport/types'
import type { MicMatrixPayloadV1 } from './assembly3dTypes'
import {
  applyExaggeratedDisplacement,
  buildVertexColorBuffer,
  ENGINEERING_MATERIAL_PRESETS,
  interpolatePartDisplacementField,
  mapNormalizedValueToTurboColor,
  validateMicMatrixJson,
} from './physics3dMath'
import { ProjectAgentM1Workbench } from './ProjectAgentM1Workbench'

const SAMPLE_MIC_PAYLOAD: MicMatrixPayloadV1 = {
  schemaVersion: 1,
  partId: 'part-bracket',
  units: 'mm',
  forceUnits: 'N',
  controlPointsMm: [
    [0, 0, 0],
    [80, 0, 0],
  ],
  measurePointsMm: [
    [40, 25, 4],
    [20, 15, 4],
    [60, 35, 4],
  ],
  sensitivityMatrix: [
    [0.0005, 0.0004],
    [0.0003, 0.0002],
    [0.0002, 0.0003],
  ],
  sourceMeta: {
    solverName: 'CalculiX 2.21',
    meshNodes: 4820,
    generatedAtIso: '2026-11-26T00:00:00Z',
  },
}

describe('M4F1-FE-01: Three.js 形变热力云图、60fps 夸张动画、极简柔性配置/MIC 导入、刚体柔性对比与 AI 柔性草案', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('1. 纯数学引擎：单色暖度色带钳位、IDW 位移插值、顶点色缓冲与零分配原地夸张更新', () => {
    // 单色暖度色带边界与钳位（中性石色 -> 暖砂 -> 陶土 -> 哑光锈红）
    const stone = mapNormalizedValueToTurboColor(-0.5)
    const mid = mapNormalizedValueToTurboColor(0.5)
    const rust = mapNormalizedValueToTurboColor(1.5)
    expect(stone[0]).toBeGreaterThan(0.3)
    expect(mid[0]).toBeGreaterThan(stone[0]) // warms up from stone to sand/terracotta
    expect(rust[0]).toBeGreaterThan(rust[2]) // rust red dominant at t=1
    expect(rust[0]).toBeGreaterThan(stone[0])

    // 9 种工程材料预设完整覆盖
    expect(ENGINEERING_MATERIAL_PRESETS).toHaveLength(9)
    expect(ENGINEERING_MATERIAL_PRESETS.map((p) => p.presetId)).toEqual([
      'steel-45',
      'sus304',
      'al-6061',
      'al-5052',
      'brass-h62',
      'abs',
      'pc',
      'pa66',
      'silicone-epdm',
    ])

    // IDW 插值精确命中控制点且平滑过渡
    const basePositions = new Float32Array([
      0, 0, 0,
      40, 25, 4,
      20, 12.5, 2,
    ])
    const field: PartDisplacementField = {
      partId: 'part-bracket',
      maxDisplacementMm: 0.28,
      minDisplacementMm: 0,
      samples: [
        { posMm: [0, 0, 0], dispMm: [0, 0, 0], magMm: 0 },
        { posMm: [40, 25, 4], dispMm: [0, 0, 0.28], magMm: 0.28 },
      ],
    }
    const interp = interpolatePartDisplacementField(basePositions, field)
    expect(interp.displacements[2]).toBeCloseTo(0, 6)
    expect(interp.displacements[5]).toBeCloseTo(0.28, 6)
    expect(interp.displacements[8]).toBeGreaterThan(0.05)
    expect(interp.displacements[8]).toBeLessThan(0.25)
    expect(interp.maxDisplacementMm).toBeCloseTo(0.28, 4)

    // 顶点色缓冲写入复用同一 Float32Array
    const reusedColorBuf = new Float32Array(9)
    const returned = buildVertexColorBuffer(interp.magnitudes, interp.maxDisplacementMm, reusedColorBuf)
    expect(returned).toBe(reusedColorBuf)
    expect(reusedColorBuf[3]).toBeGreaterThan(reusedColorBuf[0]) // v1 (mag=0.28) warmer than v0 (mag=0)
    expect(reusedColorBuf[3]).toBeGreaterThan(reusedColorBuf[5]) // v1 (mag=0.28) -> matte rust red

    // 原地夸张位移更新（零分配）
    const targetPositions = new Float32Array(basePositions)
    applyExaggeratedDisplacement(basePositions, interp.displacements, targetPositions, 25, 0.5)
    expect(targetPositions[5]).toBeCloseTo(4 + 0.28 * 25 * 0.5, 4)

    // MIC JSON 校验：合法与非法维度
    const okRes = validateMicMatrixJson(JSON.stringify(SAMPLE_MIC_PAYLOAD))
    expect(okRes.ok).toBe(true)
    if (okRes.ok) {
      expect(okRes.summary.solverName).toBe('CalculiX 2.21')
      expect(okRes.summary.meshNodes).toBe(4820)
      expect(okRes.summary.measurePointCount).toBe(3)
      expect(okRes.summary.controlPointCount).toBe(2)
    }

    const badRes = validateMicMatrixJson(
      JSON.stringify({
        ...SAMPLE_MIC_PAYLOAD,
        sensitivityMatrix: [[0.1]], // mismatch 3x2
      }),
    )
    expect(badRes.ok).toBe(false)
  })

  it('2. 视口左下角三态切换（名义态/形变云图/夸张动画）、色标 Legend、倍率滑块/暂停与零几何重建', async () => {
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

    const viewport = screen.getByTestId('m2-three-viewport')
    const initialBuildCount = viewport.getAttribute('data-geometry-build-count')
    expect(initialBuildCount).toBe('1')
    expect(viewport).toHaveAttribute('data-deformation-mode', 'nominal')
    expect(screen.queryByTestId('deformation-heatmap-legend')).not.toBeInTheDocument()

    // 切换至「形变云图」-> 出现紧凑色标 Legend 且几何构建次数恒定
    await user.click(screen.getByTestId('deformation-mode-heatmap'))
    expect(viewport).toHaveAttribute('data-deformation-mode', 'heatmap')
    expect(screen.getByTestId('deformation-heatmap-legend')).toHaveTextContent('0.00 mm')
    expect(screen.getByTestId('deformation-heatmap-legend')).toHaveTextContent('mm 变形')
    expect(viewport).toHaveAttribute('data-geometry-build-count', initialBuildCount)

    // 切换至「夸张动画」-> 浮出默认 25× 倍率滑块与播放/暂停按钮，调节倍率与暂停均零几何重建
    await user.click(screen.getByTestId('deformation-mode-animation'))
    expect(viewport).toHaveAttribute('data-deformation-mode', 'animation')
    expect(viewport).toHaveAttribute('data-exaggeration-scale', '25')
    expect(viewport).toHaveAttribute('data-animation-playing', 'true')
    expect(screen.getByTestId('exaggeration-scale-value')).toHaveTextContent('25×')

    fireEvent.change(screen.getByTestId('exaggeration-scale-slider'), { target: { value: '40' } })
    expect(viewport).toHaveAttribute('data-exaggeration-scale', '40')
    expect(screen.getByTestId('exaggeration-scale-value')).toHaveTextContent('40×')

    await user.click(screen.getByTestId('deformation-play-pause-btn'))
    expect(viewport).toHaveAttribute('data-animation-playing', 'false')
    expect(viewport).toHaveAttribute('data-geometry-build-count', initialBuildCount)

    // 切回「名义态」-> 隐藏 Legend 与动画控制条
    await user.click(screen.getByTestId('deformation-mode-nominal'))
    expect(viewport).toHaveAttribute('data-deformation-mode', 'nominal')
    expect(screen.queryByTestId('deformation-heatmap-legend')).not.toBeInTheDocument()
    expect(viewport).toHaveAttribute('data-geometry-build-count', initialBuildCount)
  })

  it('3. 极简柔性配置入口：装配树琥珀色「柔性」徽标、底部胶囊配置浮层（9 材料 + 4 模型）+ MIC 导入 + transport 真实接线', async () => {
    const user = userEvent.setup()
    const baseTransport = createElectronTransport({ bridge: {}, feature3dAssemblyM1: true })
    const stagePhysicsMock = vi.fn(async (req): Promise<{ ok: true; value: StagePhysicsResult }> => ({
      ok: true,
      value: {
        projectId: req.projectId,
        draftRevision: 'draft-phys-2',
        physics: { ...req.physics },
      },
    }))
    const importMicMock = vi.fn(async (req): Promise<{ ok: true; value: ImportMicMatrixResult }> => ({
      ok: true,
      value: {
        projectId: req.projectId,
        draftRevision: 'draft-mic-3',
        attachment: {
          kind: 'mic-matrix',
          revisionId: 'mic-att-01',
          blobKey: 'blobs/mic-01',
          path: 'attachments/mic-01.bin',
          sha256: 'a'.repeat(64),
          byteSize: 256,
        },
      },
    }))
    const transportWithM4 = {
      ...baseTransport,
      stagePhysics: stagePhysicsMock,
      importMicMatrix: importMicMock,
    }

    render(
      <ProjectAgentM1Workbench
        transport={transportWithM4}
        feature3dAssemblyM1={true}
        initialShowOnboarding={false}
        initialViewMode="model"
        initialDraftRevision="draft-1"
      />,
    )

    // 1) 展开装配树核查琥珀色「柔性」微徽标
    await user.click(screen.getByTestId('toggle-structure-btn'))
    const coverBadge = screen.getByTestId('part-compliant-badge-part-bracket')
    expect(coverBadge).toHaveAttribute('data-compliant-badge', 'true')
    expect(coverBadge).toHaveTextContent('柔性')

    // 2) 点击 3D 盖板面 -> 底部智能上下文胶囊呈现「开启/配置柔性形变」
    const svg = screen.getByTestId('m2-three-fallback-svg')
    const bracketFace = svg.querySelector('[data-range-object-id="feat-bracket-bottom-face"]') as Element
    fireEvent.click(bracketFace)
    await user.click(screen.getByTestId('ctx-action-configure-physics'))

    const popover = screen.getByTestId('physics-config-popover')
    expect(popover).toBeInTheDocument()

    // 校验 9 种材料预设并在切换时自动填充 E / ν / α
    const select = screen.getByTestId('physics-material-preset') as HTMLSelectElement
    expect(select.options).toHaveLength(9)
    await user.selectOptions(select, 'steel-45')
    expect(screen.getByTestId('physics-youngs-modulus')).toHaveValue(210000)
    expect(screen.getByTestId('physics-poisson-ratio')).toHaveValue(0.29)

    // 勾选 4 类物理模型（轴向压缩、薄板锁紧、梁弯曲、热膨胀）
    await user.click(screen.getByTestId('physics-model-axial-compression'))
    await user.click(screen.getByTestId('physics-model-beam-bending'))
    await user.click(screen.getByTestId('physics-model-thermal-expansion'))

    // 展开高阶入口导入 MIC 矩阵：先校验错误提示，再填入合法 JSON 并确认导入
    await user.click(screen.getByTestId('physics-mic-import-toggle'))
    fireEvent.change(screen.getByTestId('mic-json-textarea'), { target: { value: '{ bad json' } })
    expect(screen.getByTestId('mic-validation-errors')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('mic-json-textarea'), {
      target: { value: JSON.stringify(SAMPLE_MIC_PAYLOAD) },
    })
    expect(screen.getByTestId('mic-summary-card')).toHaveTextContent('CalculiX 2.21')
    expect(screen.getByTestId('mic-summary-card')).toHaveTextContent('4,820')
    expect(screen.getByTestId('mic-summary-card')).toHaveTextContent('3 观测点 × 2 控制载荷自由度')

    await user.click(screen.getByTestId('mic-import-confirm-btn'))
    await waitFor(() => {
      expect(importMicMock).toHaveBeenCalledTimes(1)
    })

    // 点击「保存柔性配置」调用 transport.stagePhysics
    await user.click(screen.getByTestId('physics-config-save-btn'))
    await waitFor(() => {
      expect(stagePhysicsMock).toHaveBeenCalledTimes(1)
    })
    expect(stagePhysicsMock.mock.calls[0][0].physics.materials.length).toBeGreaterThan(0)

    // 3) 多选薄板 + 定位孔 -> 智能胶囊呈现「设为锁紧点 & 翘曲拉平」
    const bracketHole = svg.querySelector('[data-range-object-id="feat-bracket-hole-axis"]') as Element
    fireEvent.click(bracketHole, { shiftKey: true })
    expect(screen.getByTestId('ctx-action-set-clamp-warpage')).toHaveTextContent('设为锁紧点 & 翘曲拉平')
  })

  it('4. 右侧仿真诊断：☑ 计入柔性形变刚体对比、风险提示、统一帕累托排序与 <350ms What-If 联动 analyzeCompliantStackup', async () => {
    const user = userEvent.setup()
    const baseTransport = createElectronTransport({ bridge: {}, feature3dAssemblyM1: true })
    const analyzeCompliantMock = vi.fn(
      async (req): Promise<{ ok: true; value: AnalyzeCompliantStackupResult }> => ({
        ok: true,
        value: {
          projectId: req.projectId,
          draftRevision: req.draftRevision,
          monteCarlo: req.monteCarlo,
          summary: {
            rigidBaseline: { cpk: 1.48, ppm: 9, threeSigmaIntervalMm: [0.09, 0.31] },
            compliantResult: { cpk: 0.96, ppm: 3820, threeSigmaIntervalMm: [0.03, 0.37] },
            flexDeltaCpk: -0.52,
            flexContributionItems: [
              {
                modelId: 'model-bracket-warpage',
                kind: 'plate-clamping',
                label: '盖板初始翘曲锁紧',
                varianceSharePct: 48.5,
              },
              {
                modelId: 'model-spacer-compression',
                kind: 'axial-compression',
                label: '弹性隔套压缩回弹',
                varianceSharePct: 19.2,
              },
            ],
          },
          displacementFields: [
            {
              partId: 'part-bracket',
              maxDisplacementMm: 0.24,
              minDisplacementMm: 0.01,
              samples: [{ posMm: [40, 25, 4], dispMm: [0, 0, 0.24], magMm: 0.24 }],
            },
          ],
        },
      }),
    )

    render(
      <ProjectAgentM1Workbench
        transport={{ ...baseTransport, analyzeCompliantStackup: analyzeCompliantMock }}
        feature3dAssemblyM1={true}
        initialShowOnboarding={false}
        initialViewMode="model"
        initialSidebarSection="simulation"
        initialDraftRevision="draft-1"
      />,
    )

    // 默认勾选「计入柔性形变」，显示刚体 vs 柔性对比卡与统一帕累托列表
    const toggle = screen.getByTestId('toggle-include-compliant') as HTMLInputElement
    expect(toggle.checked).toBe(true)
    expect(screen.getByTestId('rigid-vs-compliant-card')).toBeInTheDocument()
    expect(screen.getByTestId('unified-pareto-list')).toBeInTheDocument()
    expect(screen.queryByTestId('rigid-assumption-warning')).not.toBeInTheDocument()

    // 取消勾选 -> 立刻切回纯刚体并展示醒目风险提示，且触发 analyzeCompliantStackup（< 350ms）
    const t0 = performance.now()
    await user.click(toggle)
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(350)
    expect(toggle.checked).toBe(false)
    expect(screen.getByTestId('rigid-assumption-warning')).toHaveTextContent(
      '当前为纯刚体假设，忽略形变将低估风险',
    )

    await waitFor(() => {
      expect(analyzeCompliantMock).toHaveBeenCalled()
    })

    // 重新勾选 -> 展示服务端返回的刚体 vs 柔性 Cpk 差值（ΔCpk -0.52）与降序统一帕累托
    await user.click(toggle)
    await waitFor(() => {
      expect(screen.getByTestId('compare-flex-delta-cpk')).toHaveTextContent('ΔCpk -0.52')
    })

    const unifiedItems = screen
      .getByTestId('unified-pareto-list')
      .querySelectorAll('li[data-share-pct]')
    const shares = Array.from(unifiedItems).map((el) => Number(el.getAttribute('data-share-pct')))
    for (let i = 1; i < shares.length; i += 1) {
      expect(shares[i - 1]).toBeGreaterThanOrEqual(shares[i])
    }

    // 拖动 What-If 滑块 -> 触发增量重算
    const prevCalls = analyzeCompliantMock.mock.calls.length
    fireEvent.change(screen.getByTestId('whatif-slider-contrib-bracket-flat'), {
      target: { value: '0.08' },
    })
    await waitFor(() => {
      expect(analyzeCompliantMock.mock.calls.length).toBeGreaterThan(prevCalls)
    })
  })

  it('5. AI 柔性草案卡片：展示 EvidenceRef、悬停高亮目标零件并一键确认调用 transport.stagePhysics', async () => {
    const user = userEvent.setup()
    const baseTransport = createElectronTransport({ bridge: {}, feature3dAssemblyM1: true })
    const stagePhysicsMock = vi.fn(async (req): Promise<{ ok: true; value: StagePhysicsResult }> => ({
      ok: true,
      value: {
        projectId: req.projectId,
        draftRevision: 'draft-ai-phys',
        physics: { ...req.physics },
      },
    }))

    render(
      <ProjectAgentM1Workbench
        transport={{ ...baseTransport, stagePhysics: stagePhysicsMock }}
        feature3dAssemblyM1={true}
        initialShowOnboarding={false}
        initialViewMode="model"
        initialSidebarSection="conversation"
        initialDraftRevision="draft-1"
      />,
    )

    const card = screen.getByTestId('ai-physics-drafts-card')
    expect(card).toBeInTheDocument()
    expect(card).toHaveTextContent('6061-T6 铝合金')
    expect(screen.getByTestId('physics-evidence-draft-physics-cover-al6061-0')).toHaveTextContent(
      '任务书 PDF 第 4 页',
    )

    // 悬停草案 -> 高亮状态激活
    const firstDraft = screen.getByTestId('ai-physics-draft-draft-physics-cover-al6061')
    fireEvent.mouseEnter(firstDraft)
    expect(firstDraft).toHaveAttribute('data-fourway-highlighted', 'true')
    fireEvent.mouseLeave(firstDraft)

    // 点击「一键确认应用」-> 调用 transport.stagePhysics 并更新反馈
    await user.click(screen.getByTestId('apply-physics-drafts-btn'))
    await waitFor(() => {
      expect(stagePhysicsMock).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByTestId('ai-physics-applied-count')).toHaveTextContent('已应用 2 项')
    expect(screen.getByTestId('ai-physics-feedback')).toHaveTextContent('已确认并应用 2 条')
  })

  it('6. FEATURE_3D_ASSEMBLY_M1 = false 单件模式 100% 零回归（无形变 HUD、无柔性浮层与 AI 柔性草案）', () => {
    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        feature3dAssemblyM1={false}
        initialShowOnboarding={false}
        initialViewMode="model"
        initialDraftRevision="draft-1"
      />,
    )

    expect(screen.queryByTestId('deformation-hud')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-physics-drafts-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('toggle-include-compliant')).not.toBeInTheDocument()
    expect(screen.queryByTestId('physics-config-popover')).not.toBeInTheDocument()
  })
})
