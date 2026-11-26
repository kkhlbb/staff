// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElectronTransport } from '../../transport/electronTransport'
import type { ExportSimulationReportRequest, Transport } from '../../transport/types'
import type { DatumDefinition, GdtFeatureControl, PickedFeatureGeometryKind } from './assembly3dTypes'
import {
  formatFcfCells,
  GDT_KIND_ORDER,
  getRecommendedGdtKindsForFeature,
  validateGdtControlDraft,
} from './gdt3dMath'
import { ReportExportMenu } from './components/ReportExportMenu'
import { ProjectAgentM1Workbench } from './ProjectAgentM1Workbench'
import { DEFAULT_LOCAL_PROJECTS } from './workbenchHelpers'

describe('V100-FE-01: 5 类进阶 GD&T 3D 框格（含双层复合框格）+ 一键导出工程报告 + GA 打磨', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('1. 纯函数校验：10 类 GD&T 符号/UZ 不等距/双层复合格式化、按特征智能过滤与非法组合拦截', () => {
    expect(GDT_KIND_ORDER).toHaveLength(10)

    const datums: readonly DatumDefinition[] = [
      { id: 'datum-A', label: 'A', featureId: 'feat-plane' },
      { id: 'datum-B', label: 'B', featureId: 'feat-cyl-datum' },
      { id: 'datum-C', label: 'C', featureId: 'feat-plane-2' },
    ]
    const featureKindById = new Map<string, PickedFeatureGeometryKind>([
      ['feat-plane', 'face'],
      ['feat-plane-2', 'face'],
      ['feat-cyl-datum', 'cylindrical-hole-axis'],
      ['feat-hole', 'cylindrical-hole-axis'],
    ])

    // 1) 面轮廓度（对称 vs 不等距 UZ 0.3）
    const profileUnequal: GdtFeatureControl = {
      id: 'gdt-prof-1',
      featureId: 'feat-plane',
      kind: 'profile-surface',
      toleranceQ: 10000, // 1.00 mm
      datumIds: ['datum-A'],
      unequalProfileOuterFraction: 0.3,
    }
    const profCells = formatFcfCells(profileUnequal, datums, 'face')
    expect(profCells.symbol).toBe('⌒')
    expect(profCells.diameterPrefix).toBe('')
    expect(profCells.unequalUzText).toBe('UZ 0.3')
    expect(profCells.summaryText).toContain('UZ 0.3')
    expect(validateGdtControlDraft(profileUnequal, { featureKindById, datums }).valid).toBe(true)

    // 面轮廓度允许 0 基准
    const profileZeroDatum: GdtFeatureControl = {
      id: 'gdt-prof-0',
      featureId: 'feat-plane',
      kind: 'profile-surface',
      toleranceQ: 1500,
      datumIds: [],
    }
    expect(validateGdtControlDraft(profileZeroDatum, { featureKindById, datums }).valid).toBe(true)

    // 2) 圆跳动 ↗ 与 全跳动 ↗↗（仅允许 RFS，须引用轴类基准）
    const circRunout: GdtFeatureControl = {
      id: 'gdt-crun',
      featureId: 'feat-hole',
      kind: 'circular-runout',
      toleranceQ: 500,
      modifier: 'RFS',
      datumIds: ['datum-B'],
    }
    expect(formatFcfCells(circRunout, datums, 'cylindrical-hole-axis').symbol).toBe('↗')
    expect(formatFcfCells(circRunout, datums, 'cylindrical-hole-axis').diameterPrefix).toBe('')
    expect(validateGdtControlDraft(circRunout, { featureKindById, datums }).valid).toBe(true)

    const totalRunoutBadMmc: GdtFeatureControl = {
      id: 'gdt-trun-bad',
      featureId: 'feat-hole',
      kind: 'total-runout',
      toleranceQ: 800,
      modifier: 'MMC',
      datumIds: ['datum-B'],
    }
    expect(formatFcfCells(totalRunoutBadMmc, datums, 'cylindrical-hole-axis').symbol).toBe('↗↗')
    const runoutRes = validateGdtControlDraft(totalRunoutBadMmc, { featureKindById, datums })
    expect(runoutRes.valid).toBe(false)
    expect(runoutRes.warnings.some((w) => w.code === 'ILLEGAL_MODIFIER')).toBe(true)

    // 3) 圆柱度 ⌭（禁止基准，仅限圆柱特征）
    const cylValid: GdtFeatureControl = {
      id: 'gdt-cyl-ok',
      featureId: 'feat-hole',
      kind: 'cylindricity',
      toleranceQ: 400,
      datumIds: [],
    }
    expect(formatFcfCells(cylValid, datums, 'cylindrical-hole-axis').symbol).toBe('⌭')
    expect(formatFcfCells(cylValid, datums, 'cylindrical-hole-axis').diameterPrefix).toBe('')
    expect(validateGdtControlDraft(cylValid, { featureKindById, datums }).valid).toBe(true)

    const cylWithDatum: GdtFeatureControl = { ...cylValid, id: 'gdt-cyl-bad', datumIds: ['datum-A'] }
    const cylRes = validateGdtControlDraft(cylWithDatum, { featureKindById, datums })
    expect(cylRes.valid).toBe(false)
    expect(cylRes.warnings.some((w) => w.code === 'DRF_REDUNDANT')).toBe(true)

    // 4) 复合位置度（上格 PLTZF + 下格 FRTZF）
    const compValid: GdtFeatureControl = {
      id: 'gdt-comp-ok',
      featureId: 'feat-hole',
      kind: 'composite-position',
      toleranceQ: 2000, // Ø0.20
      modifier: 'MMC',
      datumIds: ['datum-A', 'datum-B'],
      datumModifiers: ['RFS', 'MMC'],
      lowerSegment: {
        toleranceQ: 800, // Ø0.08
        modifier: 'MMC',
        datumIds: ['datum-A'],
      },
    }
    const compCells = formatFcfCells(compValid, datums, 'cylindrical-hole-axis')
    expect(compCells.isComposite).toBe(true)
    expect(compCells.symbol).toBe('⌖')
    expect(compCells.diameterPrefix).toBe('Ø')
    expect(compCells.lowerSegment?.toleranceText).toBe('0.08')
    expect(compCells.lowerSegment?.datumCells.map((d) => d.label)).toEqual(['A'])
    expect(validateGdtControlDraft(compValid, { featureKindById, datums }).valid).toBe(true)

    // 下格公差 > 上格公差 -> 拦截
    const compBadTol = validateGdtControlDraft(
      { ...compValid, lowerSegment: { toleranceQ: 2500, datumIds: ['datum-A'] } },
      { featureKindById, datums },
    )
    expect(compBadTol.valid).toBe(false)
    expect(compBadTol.warnings.some((w) => w.code === 'DRF_DEGENERATE')).toBe(true)

    // 下格基准不是上格前缀 -> 拦截
    const compBadPrefix = validateGdtControlDraft(
      { ...compValid, lowerSegment: { toleranceQ: 800, datumIds: ['datum-B'] } },
      { featureKindById, datums },
    )
    expect(compBadPrefix.valid).toBe(false)
    expect(compBadPrefix.warnings.some((w) => w.code === 'DRF_REDUNDANT')).toBe(true)

    // 5) 按特征类型智能过滤
    const faceKinds = getRecommendedGdtKindsForFeature('face')
    expect(faceKinds).toContain('profile-surface')
    expect(faceKinds).not.toContain('circular-runout')
    expect(faceKinds).not.toContain('total-runout')
    expect(faceKinds).not.toContain('cylindricity')

    const cylKinds = getRecommendedGdtKindsForFeature('cylindrical-hole-axis')
    expect(cylKinds).toContain('composite-position')
    expect(cylKinds).toContain('circular-runout')
    expect(cylKinds).toContain('total-runout')
    expect(cylKinds).toContain('cylindricity')
    expect(cylKinds).not.toContain('flatness')
  })

  it('2. 3D 视口渲染 5 类新框格与双层复合框格 + 上下文胶囊智能过滤与非法组合实时拦截', async () => {
    const user = userEvent.setup()
    const advancedControls: readonly GdtFeatureControl[] = [
      {
        id: 'gdt-v100-profile',
        featureId: 'feat-base-top-face',
        kind: 'profile-surface',
        toleranceQ: 10000,
        datumIds: ['datum-A'],
        unequalProfileOuterFraction: 0.3,
      },
      {
        id: 'gdt-v100-crun',
        featureId: 'feat-spacer-bore-axis',
        kind: 'circular-runout',
        toleranceQ: 500,
        modifier: 'RFS',
        datumIds: ['datum-B'],
      },
      {
        id: 'gdt-v100-trun',
        featureId: 'feat-base-hole-axis',
        kind: 'total-runout',
        toleranceQ: 800,
        modifier: 'RFS',
        datumIds: ['datum-B'],
      },
      {
        id: 'gdt-v100-cyl',
        featureId: 'feat-bracket-hole-axis',
        kind: 'cylindricity',
        toleranceQ: 400,
        datumIds: [],
      },
      {
        id: 'gdt-v100-comp',
        featureId: 'feat-bracket-hole-axis',
        kind: 'composite-position',
        toleranceQ: 2000,
        modifier: 'MMC',
        datumIds: ['datum-A', 'datum-B'],
        lowerSegment: {
          toleranceQ: 800,
          modifier: 'MMC',
          datumIds: ['datum-A'],
        },
      },
    ]

    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        feature3dAssemblyM1={true}
        initialShowOnboarding={false}
        initialViewMode="model"
        initialDraftRevision="draft-v100"
        initialGdtControls={advancedControls}
      />,
    )

    await user.click(screen.getByTestId('gdt-mode-expand-all'))

    // 验证 5 类新框格及双层复合框格 DOM 渲染
    expect(screen.getByTestId('gdt-fcf-box-gdt-v100-profile')).toHaveTextContent('⌒')
    expect(screen.getByTestId('gdt-fcf-uz-gdt-v100-profile')).toHaveTextContent('UZ 0.3')
    expect(screen.getByTestId('gdt-fcf-box-gdt-v100-crun')).toHaveTextContent('↗')
    expect(screen.getByTestId('gdt-fcf-box-gdt-v100-trun')).toHaveTextContent('↗↗')
    expect(screen.getByTestId('gdt-fcf-box-gdt-v100-cyl')).toHaveTextContent('⌭')

    const compBox = screen.getByTestId('gdt-fcf-box-gdt-v100-comp')
    expect(compBox).toHaveAttribute('data-composite', 'true')
    expect(screen.getByTestId('gdt-fcf-upper-gdt-v100-comp')).toHaveTextContent('Ø0.20Ⓜ')
    expect(screen.getByTestId('gdt-fcf-lower-gdt-v100-comp')).toHaveTextContent('Ø0.08Ⓜ')

    // 点击平面特征 -> 验证「贴 GD&T 框格」不展示跳动/圆柱度
    const svg = screen.getByTestId('m2-three-fallback-svg')
    const planeEl = svg.querySelector('[data-range-object-id="feat-base-top-face"]') as Element
    fireEvent.click(planeEl)
    await user.click(screen.getByTestId('ctx-action-attach-gdt'))
    expect(screen.getByTestId('gdt-kind-profile-surface')).toBeInTheDocument()
    expect(screen.queryByTestId('gdt-kind-circular-runout')).not.toBeInTheDocument()
    expect(screen.queryByTestId('gdt-kind-cylindricity')).not.toBeInTheDocument()

    // 点击复合位置度框格 -> 验证就地微调气泡支持下格 FRTZF 滑块
    await user.click(compBox)
    expect(screen.getByTestId('gdt-inline-lower-row')).toBeInTheDocument()
  })

  it('3. 一键导出工程报告：调用 transport.exportSimulationReport（含快照透传与多格式）及顶部更多菜单入口', async () => {
    const user = userEvent.setup()
    const capturedRequests: ExportSimulationReportRequest[] = []
    const baseTransport = createElectronTransport({ bridge: {}, feature3dAssemblyM1: true })
    const transportWithReport: Transport = {
      ...baseTransport,
      exportSimulationReport: vi.fn(async (req: ExportSimulationReportRequest) => {
        capturedRequests.push(req)
        const mimeType =
          req.format === 'html'
            ? ('text/html' as const)
            : req.format === 'pdf'
              ? ('application/pdf' as const)
              : req.format === 'csv'
                ? ('text/csv' as const)
                : ('application/json' as const)
        return {
          ok: true as const,
          value: {
            fileName: `${req.projectId}-report.${req.format}`,
            mimeType,
            sha256: 'a1b2c3d4e5f60000111122223333444455556666777788889999aaaabbbbcccc',
            revision: 'draft-v100',
            checksetFingerprint: 'fp-v100',
            content: '<html>report</html>',
          },
        }
      }),
    }

    // 1) 独立组件验证快照透传（含 nominalPngDataUrl + heatmapPngDataUrl）与多格式
    const { unmount } = render(
      <ReportExportMenu
        transport={transportWithReport}
        projectId="proj-v100"
        projectName="薄铝盖板项目"
        draftRevision="draft-v100"
        captureSnapshots={() => ({
          nominalPngDataUrl: 'data:image/png;base64,NOMINAL',
          heatmapPngDataUrl: 'data:image/png;base64,HEATMAP',
        })}
      />,
    )

    await user.click(screen.getByTestId('export-report-html'))
    await waitFor(() => {
      expect(screen.getByTestId('report-export-feedback')).toHaveTextContent('proj-v100-report.html')
    })
    expect(screen.getByTestId('report-export-feedback')).toHaveTextContent('a1b2c3d4e5f6')
    expect(capturedRequests[0]).toMatchObject({
      projectId: 'proj-v100',
      format: 'html',
      includeSnapshots: true,
      viewportSnapshots: {
        nominalPngDataUrl: 'data:image/png;base64,NOMINAL',
        heatmapPngDataUrl: 'data:image/png;base64,HEATMAP',
      },
    })

    await user.click(screen.getByTestId('export-report-csv'))
    await user.click(screen.getByTestId('export-report-json'))
    await waitFor(() => {
      expect(capturedRequests.map((r) => r.format)).toEqual(['html', 'csv', 'json'])
    })
    unmount()

    // 2) 工作台右侧仿真区 + 顶部「更多 ⋯」菜单入口集成验证
    render(
      <ProjectAgentM1Workbench
        transport={transportWithReport}
        feature3dAssemblyM1={true}
        initialShowOnboarding={false}
        initialViewMode="model"
        initialSidebarSection="simulation"
        initialDraftRevision="draft-v100"
      />,
    )

    expect(screen.getByTestId('report-export-card')).toBeInTheDocument()
    await user.click(screen.getByTestId('export-report-pdf'))
    await waitFor(() => {
      expect(capturedRequests.some((r) => r.format === 'pdf')).toBe(true)
    })

    await user.click(screen.getByTestId('more-menu-btn'))
    expect(screen.getByTestId('topbar-report-export-group')).toBeInTheDocument()
    await user.click(screen.getByTestId('topbar-export-report-html'))
    await waitFor(() => {
      expect(capturedRequests.length).toBeGreaterThanOrEqual(5)
    })
  })

  it('4. GA 细节核查：3 大内置模板完整可见且亮/暗主题切换正常', async () => {
    const user = userEvent.setup()
    const templateIds = DEFAULT_LOCAL_PROJECTS.map((p) => p.templateId)
    expect(templateIds).toContain('builtin-mounting-plate')
    expect(templateIds).toContain('builtin-shaft-spacer')
    expect(templateIds).toContain('builtin-compliant-cover-warpage')

    const { container } = render(
      <ProjectAgentM1Workbench
        bridge={{}}
        feature3dAssemblyM1={true}
        initialShowOnboarding={false}
        initialViewMode="model"
      />,
    )

    const main = container.querySelector('main.pa-workbench')
    expect(main).toHaveAttribute('data-theme', 'light')
    await user.click(screen.getByTestId('more-menu-btn'))
    await user.click(screen.getByTestId('theme-toggle-btn'))
    expect(main).toHaveAttribute('data-theme', 'dark')
  })

  it('5. P1 回归：切换 3 套内置模板呈现 3 组独立 3D 零件与非空 2D 矢量图，未绑定模板报告导出与 What-If 滑块零 AUTH_REQUIRED/FEATURE_DISABLED', async () => {
    const user = userEvent.setup()
    const baseTransport = createElectronTransport({ bridge: {}, feature3dAssemblyM1: true })
    const unboundTransport: Transport = {
      ...baseTransport,
      exportSimulationReport: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'AUTH_REQUIRED', message: '请先授权当前窗口访问项目' },
      })),
      analyzeGdtStackup: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'AUTH_REQUIRED', message: '请先授权当前窗口访问项目' },
      })),
    }

    render(
      <ProjectAgentM1Workbench
        transport={unboundTransport}
        feature3dAssemblyM1={true}
        initialShowOnboarding={true}
        initialViewMode="split"
        forceNarrowViewport={false}
      />,
    )

    // 1) 打开内置模板 1：安装板项目（2 个零件：安装板 + 参考盖板 + 非空 2D 工程图）
    await user.click(screen.getByTestId('more-menu-btn'))
    await user.click(screen.getByRole('menuitem', { name: /切换本地项目/i }))
    await user.click(screen.getByRole('button', { name: '打开项目 安装板项目' }))
    await waitFor(() => {
      expect(screen.getByTestId('m2-drawing-svg')).toBeInTheDocument()
    })
    const treeToggle = screen.getByTestId('toggle-structure-btn')
    await user.click(treeToggle)
    expect(screen.getByTestId('assembly-part-part-mounting-plate')).toHaveTextContent('安装板')
    expect(screen.getByTestId('assembly-part-part-reference-cover')).toHaveTextContent('参考盖板')

    // 2) 切换到内置模板 2：隔套兼容示例（2 个零件：隔套 + 阶梯轴/端盖 + 非空 2D 工程图）
    await user.click(screen.getByTestId('more-menu-btn'))
    await user.click(screen.getByRole('menuitem', { name: /切换本地项目/i }))
    await user.click(screen.getByRole('button', { name: '打开项目 隔套兼容示例' }))
    await waitFor(() => {
      expect(screen.getByTestId('m2-drawing-svg')).toBeInTheDocument()
    })
    expect(screen.getByTestId('assembly-part-part-shaft-spacer')).toHaveTextContent('隔套')
    expect(screen.getByTestId('assembly-part-part-stepped-shaft')).toHaveTextContent('阶梯轴/端盖')

    // 3) 切换到内置模板 3：薄铝盖板翘曲锁紧（3 个零件：双定位孔安装板 + 弹性隔套 + 薄铝盖板 + 非空 2D 工程图）
    await user.click(screen.getByTestId('more-menu-btn'))
    await user.click(screen.getByRole('menuitem', { name: /切换本地项目/i }))
    await user.click(screen.getByRole('button', { name: '打开项目 薄铝盖板翘曲锁紧' }))
    await waitFor(() => {
      expect(screen.getByTestId('m2-drawing-svg')).toBeInTheDocument()
    })
    expect(screen.getByTestId('assembly-part-part-mounting-plate')).toHaveTextContent('双定位孔安装板')
    expect(screen.getByTestId('assembly-part-part-elastic-spacer')).toHaveTextContent('弹性隔套')
    expect(screen.getByTestId('assembly-part-part-thin-al-cover')).toHaveTextContent('薄铝盖板 (1.5mm 6061)')

    // 4) 切到仿真区：拖动 What-If 滑块不应弹出 AUTH_REQUIRED 错误，且 HTML/CSV/JSON 离线报告导出全部成功
    await user.click(screen.getByRole('tab', { name: /仿真/i }))
    const slider = screen.getByTestId('whatif-slider-contrib-cover-warpage')
    fireEvent.change(slider, { target: { value: '0.08' } })
    await waitFor(() => {
      expect(unboundTransport.analyzeGdtStackup).toHaveBeenCalled()
    })
    expect(screen.queryByText(/AUTH_REQUIRED/)).not.toBeInTheDocument()

    await user.click(screen.getByTestId('export-report-html'))
    await waitFor(() => {
      expect(screen.getByTestId('report-export-feedback')).toHaveTextContent(/已生成本地报告.*\.html/)
    })
    expect(screen.getByTestId('report-export-feedback')).not.toHaveTextContent(/AUTH_REQUIRED|FEATURE_DISABLED/)

    await user.click(screen.getByTestId('export-report-csv'))
    await waitFor(() => {
      expect(screen.getByTestId('report-export-feedback')).toHaveTextContent(/已生成本地报告.*\.csv/)
    })
    await user.click(screen.getByTestId('export-report-json'))
    await waitFor(() => {
      expect(screen.getByTestId('report-export-feedback')).toHaveTextContent(/已生成本地报告.*\.json/)
    })
  })
})
