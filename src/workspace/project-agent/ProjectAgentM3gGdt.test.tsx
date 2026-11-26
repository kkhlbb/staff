// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElectronTransport } from '../../transport/electronTransport'
import { createDefaultM1bAssemblyFixture } from './assembly3dMath'
import type { PickedFeatureGeometryKind } from './assembly3dTypes'
import {
  computeAntiOverlapOffsets,
  computeFeatureWorldAnchor,
  computeLocalGdtSimulationDiagnostics,
  createDefaultM3gGdtFixture,
  formatFcfCells,
  validateGdtControlDraft,
} from './gdt3dMath'
import { ProjectAgentM1Workbench } from './ProjectAgentM1Workbench'

describe('M3G-FE-01: 3D CSS2D GD&T 框格、智能防遮挡/全部展开、上下文建标与就地微调、AI 草案与四向同步高亮', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('1. 纯函数校验：5 类 GD&T 符号/Ø/Ⓜ/Ⓛ/基准列格式化、爆炸锚点跟随、全部展开防重叠偏移与合法性校验阻断', () => {
    const m1b = createDefaultM1bAssemblyFixture()
    const gdtFixture = createDefaultM3gGdtFixture()

    // 5 类符号 + Ø + Ⓜ + Ⓛ + 基准列（含 datumModifiers）
    const posCells = formatFcfCells(gdtFixture.gdtControls[0], gdtFixture.datums, 'cylindrical-hole-axis')
    expect(posCells.symbol).toBe('⌖')
    expect(posCells.diameterPrefix).toBe('Ø')
    expect(posCells.toleranceText).toBe('0.12')
    expect(posCells.modifierSymbol).toBe('Ⓜ')
    expect(posCells.datumCells.map((d) => `${d.label}${d.modifierSymbol}`)).toEqual(['A', 'BⓂ'])

    const flatCells = formatFcfCells(gdtFixture.gdtControls[1], gdtFixture.datums, 'face')
    expect(flatCells.symbol).toBe('⏥')
    expect(flatCells.diameterPrefix).toBe('')
    expect(flatCells.datumCells).toHaveLength(0)

    const perpCells = formatFcfCells(gdtFixture.gdtControls[2], gdtFixture.datums, 'face')
    expect(perpCells.symbol).toBe('⊥')

    const paraCells = formatFcfCells(gdtFixture.gdtControls[3], gdtFixture.datums, 'face')
    expect(paraCells.symbol).toBe('∥')

    const coaxCells = formatFcfCells(gdtFixture.gdtControls[4], gdtFixture.datums, 'cylindrical-hole-axis')
    expect(coaxCells.symbol).toBe('◎')
    expect(coaxCells.diameterPrefix).toBe('Ø')
    expect(coaxCells.modifierSymbol).toBe('Ⓛ')

    // 爆炸视图锚点实时跟随
    const anchor0 = computeFeatureWorldAnchor(m1b.partMeshes, 'feat-bracket-hole-axis', 0)
    const anchor1 = computeFeatureWorldAnchor(m1b.partMeshes, 'feat-bracket-hole-axis', 1)
    expect(anchor0).not.toBeNull()
    expect(anchor1).not.toBeNull()
    expect(anchor1!.position[2]).toBeGreaterThan(anchor0!.position[2] + 20)

    // 屏幕空间防重叠错位偏移：4 个完全重合锚点展开后两两边界盒零重叠
    const boxes = [
      { id: 'f1', anchorX: 150, anchorY: 100, width: 130, height: 26 },
      { id: 'f2', anchorX: 150, anchorY: 100, width: 130, height: 26 },
      { id: 'f3', anchorX: 152, anchorY: 102, width: 130, height: 26 },
      { id: 'f4', anchorX: 148, anchorY: 98, width: 130, height: 26 },
    ]
    const offsets = computeAntiOverlapOffsets(boxes, 6)
    const resolved = boxes.map((b) => ({ ...b, ...offsets.get(b.id)! }))
    for (let i = 0; i < resolved.length; i += 1) {
      for (let j = i + 1; j < resolved.length; j += 1) {
        const a = resolved[i]
        const b = resolved[j]
        const overlapX = Math.abs(a.labelX - b.labelX) < (a.width + b.width) / 2
        const overlapY = Math.abs(a.labelY - b.labelY) < (a.height + b.height) / 2
        expect(overlapX && overlapY).toBe(false)
      }
    }

    // 实时合法性校验阻断非法组合
    const featureKindById = new Map<string, PickedFeatureGeometryKind>([
      ['feat-base-top-face', 'face'],
      ['feat-base-bottom-face', 'face'],
      ['feat-base-hole-axis', 'cylindrical-hole-axis'],
    ])

    // flatness 不允许引用基准
    const flatWithDatum = validateGdtControlDraft(
      {
        id: 'bad-flat',
        featureId: 'feat-base-top-face',
        kind: 'flatness',
        toleranceQ: 800,
        modifier: 'RFS',
        datumIds: ['datum-A'],
      },
      { featureKindById, datums: gdtFixture.datums },
    )
    expect(flatWithDatum.valid).toBe(false)
    expect(flatWithDatum.warnings.some((w) => w.code === 'DRF_REDUNDANT')).toBe(true)

    // 非尺寸要素平面不允许选 MMC
    const planeWithMmc = validateGdtControlDraft(
      {
        id: 'bad-mmc',
        featureId: 'feat-base-top-face',
        kind: 'parallelism',
        toleranceQ: 800,
        modifier: 'MMC',
        datumIds: ['datum-A'],
      },
      { featureKindById, datums: gdtFixture.datums },
    )
    expect(planeWithMmc.valid).toBe(false)
    expect(planeWithMmc.warnings.some((w) => w.code === 'ILLEGAL_MODIFIER')).toBe(true)

    // 重复基准阻断
    const dupDatum = validateGdtControlDraft(
      {
        id: 'bad-dup',
        featureId: 'feat-base-hole-axis',
        kind: 'position',
        toleranceQ: 1000,
        modifier: 'MMC',
        datumIds: ['datum-A', 'datum-A'],
      },
      { featureKindById, datums: gdtFixture.datums },
    )
    expect(dupDatum.valid).toBe(false)
    expect(dupDatum.warnings.some((w) => w.code === 'DRF_REDUNDANT')).toBe(true)

    // 本地 GD&T 仿真：MMC Bonus > 0 且 Datum Shift > 0
    const sim = computeLocalGdtSimulationDiagnostics(m1b.simulationSpec, {
      gdtControls: gdtFixture.gdtControls,
      datums: gdtFixture.datums,
      featureKindById: new Map<string, PickedFeatureGeometryKind>([
        ['feat-bracket-hole-axis', 'cylindrical-hole-axis'],
        ['feat-bracket-bottom-face', 'face'],
        ['feat-spacer-top-face', 'face'],
        ['feat-base-top-face', 'face'],
        ['feat-spacer-bore-axis', 'cylindrical-hole-axis'],
        ['feat-base-hole-axis', 'cylindrical-hole-axis'],
      ]),
    })
    const posContrib = sim.gdtContributions?.find((c) => c.gdtId === 'gdt-bracket-hole-pos')
    expect(posContrib).toBeDefined()
    expect(posContrib!.bonusMeanMm).toBeGreaterThan(0)
    expect(posContrib!.datumShiftContributionPct).toBeGreaterThan(0)
  })

  it('2. 3D 视口渲染 5 类 FCF + 青绿色基准徽标、智能防遮挡默认折叠 22px 圆点与悬停原地展开 ↔ 全部展开切换', async () => {
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

    // 默认处于智能防遮挡模式
    const overlay = screen.getByTestId('gdt-3d-overlay-layer')
    expect(overlay).toHaveAttribute('data-display-mode', 'smart')
    expect(screen.getByTestId('gdt-mode-smart')).toHaveAttribute('aria-pressed', 'true')

    // 青绿色基准徽标 A / B 渲染
    expect(screen.getByTestId('gdt-datum-datum-A')).toHaveTextContent('基准 A')
    expect(screen.getByTestId('gdt-datum-datum-B')).toHaveTextContent('基准 B')

    // 非聚焦特征（如底座顶面平行度 gdt-base-top-para）默认折叠为 22px 编号圆点
    const collapsedFcf = screen.getByTestId('gdt-fcf-gdt-base-top-para')
    expect(collapsedFcf).toHaveAttribute('data-collapsed', 'true')
    expect(screen.getByTestId('gdt-dot-gdt-base-top-para')).toBeInTheDocument()

    // 悬停编号圆点 -> 原地展开完整 FCF 框格；移开 -> 恢复折叠
    fireEvent.mouseEnter(collapsedFcf)
    expect(collapsedFcf).toHaveAttribute('data-collapsed', 'false')
    expect(screen.getByTestId('gdt-fcf-box-gdt-base-top-para')).toHaveTextContent('∥')
    expect(screen.getByTestId('gdt-fcf-box-gdt-base-top-para')).toHaveTextContent('0.06')
    fireEvent.mouseLeave(collapsedFcf)
    expect(collapsedFcf).toHaveAttribute('data-collapsed', 'true')

    // 切换至「全部展开」-> 所有 5 条 FCF 全部展开且无折叠圆点
    await user.click(screen.getByTestId('gdt-mode-expand-all'))
    expect(overlay).toHaveAttribute('data-display-mode', 'expand-all')
    expect(screen.getByTestId('gdt-fcf-gdt-bracket-hole-pos')).toHaveAttribute('data-collapsed', 'false')
    expect(screen.getByTestId('gdt-fcf-gdt-bracket-bottom-flat')).toHaveAttribute('data-collapsed', 'false')
    expect(screen.getByTestId('gdt-fcf-gdt-spacer-top-perp')).toHaveAttribute('data-collapsed', 'false')
    expect(screen.getByTestId('gdt-fcf-gdt-base-top-para')).toHaveAttribute('data-collapsed', 'false')
    expect(screen.getByTestId('gdt-fcf-gdt-spacer-bore-coax')).toHaveAttribute('data-collapsed', 'false')

    // 验证 5 类符号、Ø、Ⓜ、Ⓛ 与基准列文本全部正确呈现
    expect(screen.getByTestId('gdt-fcf-box-gdt-bracket-hole-pos')).toHaveTextContent('⌖')
    expect(screen.getByTestId('gdt-fcf-box-gdt-bracket-hole-pos')).toHaveTextContent('Ø0.12Ⓜ')
    expect(screen.getByTestId('gdt-fcf-box-gdt-bracket-hole-pos')).toHaveTextContent('BⓂ')
    expect(screen.getByTestId('gdt-fcf-box-gdt-spacer-bore-coax')).toHaveTextContent('◎')
    expect(screen.getByTestId('gdt-fcf-box-gdt-spacer-bore-coax')).toHaveTextContent('Ø0.10Ⓛ')
  })

  it('3. 上下文胶囊 1–2 次点击设为基准 A/B/C、贴 GD&T 框格气泡实时校验阻断非法组合并成功建标', async () => {
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

    const svg = screen.getByTestId('m2-three-fallback-svg')
    const baseTopFace = svg.querySelector('[data-range-object-id="feat-base-top-face"]') as Element
    fireEvent.click(baseTopFace)

    // 1) 点击「设为基准 A/B/C」-> 指派为基准 C -> 3D 视口即时生成青绿色基准 C 徽标
    await user.click(screen.getByTestId('ctx-action-set-datum'))
    expect(screen.getByTestId('datum-picker-popover')).toBeInTheDocument()
    await user.click(screen.getByTestId('assign-datum-C'))
    expect(screen.getByTestId('gdt-datum-datum-C')).toHaveTextContent('基准 C')

    // 2) 点击「贴 GD&T 框格」打开配置气泡
    await user.click(screen.getByTestId('ctx-action-attach-gdt'))
    const popover = screen.getByTestId('gdt-config-popover')
    expect(popover).toBeInTheDocument()

    // 平面度 + 勾选基准 A -> 触发非法组合阻断（DRF_REDUNDANT）且确认按钮禁用
    await user.click(screen.getByTestId('gdt-kind-flatness'))
    await user.click(screen.getByTestId('gdt-config-datum-A'))
    expect(screen.getByTestId('gdt-validation-warnings')).toHaveTextContent('DRF_REDUNDANT')
    expect(screen.getByTestId('gdt-config-submit')).toBeDisabled()

    // 切换为垂直度 + 选 MMC（在平面上非法）-> 触发 ILLEGAL_MODIFIER 阻断
    await user.click(screen.getByTestId('gdt-kind-perpendicularity'))
    await user.click(screen.getByTestId('gdt-config-mod-MMC'))
    expect(screen.getByTestId('gdt-validation-warnings')).toHaveTextContent('ILLEGAL_MODIFIER')
    expect(screen.getByTestId('gdt-config-submit')).toBeDisabled()

    // 改回 RFS -> 校验通过 -> 点击「确认贴标」成功生成新框格
    await user.click(screen.getByTestId('gdt-config-mod-RFS'))
    expect(screen.queryByTestId('gdt-validation-warnings')).not.toBeInTheDocument()
    expect(screen.getByTestId('gdt-config-submit')).toBeEnabled()
    await user.click(screen.getByTestId('gdt-config-submit'))
    expect(screen.queryByTestId('gdt-config-popover')).not.toBeInTheDocument()
    expect(screen.getByTestId('context-action-feedback')).toHaveTextContent('已为「底座安装板 › 顶安装面」贴附 GD&T 框格')
  })

  it('4. 点击 3D FCF 弹出就地微调气泡，改公差与切换 RFS↔MMC 在 <350ms 刷新右侧仿真并触发 Transport.runSimulation', async () => {
    const user = userEvent.setup()
    const baseTransport = createElectronTransport({ bridge: {}, feature3dAssemblyM1: true })
    const runSimulationSpy = vi.spyOn(baseTransport, 'runSimulation')

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

    // 先切换到全部展开并点击位置度 FCF（gdt-bracket-hole-pos，初始 MMC）
    await user.click(screen.getByTestId('gdt-mode-expand-all'))
    await user.click(screen.getByTestId('gdt-fcf-box-gdt-bracket-hole-pos'))

    const inlineEditor = screen.getByTestId('gdt-inline-editor')
    expect(inlineEditor).toHaveAttribute('data-editing-gdt-id', 'gdt-bracket-hole-pos')

    // 记录初始 Bonus，切换 MMC -> RFS 应在 <350ms 内将 Bonus 归零
    const bonusEl = screen.getByTestId('gdt-bonus-gdt-bracket-hole-pos')
    expect(bonusEl).not.toHaveTextContent('+0.000 mm')

    const t0 = performance.now()
    await user.click(screen.getByTestId('gdt-inline-mod-RFS'))
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(350)
    expect(screen.getByTestId('gdt-bonus-gdt-bracket-hole-pos')).toHaveTextContent('+0.000 mm')

    // 拖动就地微调滑块修改公差值 0.12 -> 0.24
    fireEvent.change(screen.getByTestId('gdt-inline-slider'), { target: { value: '0.24' } })
    expect(screen.getByTestId('gdt-fcf-box-gdt-bracket-hole-pos')).toHaveTextContent('Ø0.24')

    await waitFor(() => {
      expect(runSimulationSpy).toHaveBeenCalled()
    })
  })

  it('5. AI 建议基准/GD&T 草案悬停实时预览 + 一键应用 + 四向同步高亮（含 3D FCF 金色脉冲与 2D 标注联动）', async () => {
    const user = userEvent.setup()

    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        feature3dAssemblyM1={true}
        initialShowOnboarding={false}
        initialViewMode="split"
        initialSidebarSection="conversation"
        initialDraftRevision="draft-1"
        initialPreviewSnapshot={{
          drawing: {
            status: 'ready',
            revision: 'draft-1',
            revisionOrder: 1,
            fingerprint: 'fp-drw-1',
            isDraft: true,
          },
          annotations: [
            {
              annotationId: 'ann-bracket-hole-pos',
              label: '盖板定位孔位置度',
              valueText: '⌖ Ø0.12 Ⓜ | A | BⓂ',
              view: 'front',
              linkedFeatureIds: ['feat-bracket-hole-axis'],
            },
          ],
        }}
      />,
    )

    // 1) AI 建议基准/GD&T 草案卡片存在并包含 EvidenceRef
    const gdtCard = screen.getByTestId('ai-gdt-drafts-card')
    expect(gdtCard).toHaveTextContent('94%')
    expect(screen.getByTestId('gdt-evidence-ai-gdt-draft-datum-c-0')).toHaveTextContent('任务书 PDF 第 4 页')

    // 2) 悬停草案 -> 3D 视口实时呈现临时预览基准 C（data-preview="true"）
    const datumCDraft = screen.getByTestId('ai-gdt-draft-ai-gdt-draft-datum-c')
    fireEvent.mouseEnter(datumCDraft)
    const previewDatum = screen.getByTestId('gdt-datum-datum-C')
    expect(previewDatum).toHaveAttribute('data-preview', 'true')
    fireEvent.mouseLeave(datumCDraft)
    expect(screen.queryByTestId('gdt-datum-datum-C')).not.toBeInTheDocument()

    // 3) 一键确认应用 -> 正式写入 3D 视口基准 C 与新位置度框格
    await user.click(screen.getByTestId('apply-gdt-drafts-btn'))
    expect(screen.getByTestId('ai-gdt-applied-count')).toHaveTextContent('已应用 2 项')
    expect(screen.getByTestId('gdt-datum-datum-C')).toHaveAttribute('data-preview', 'false')
    expect(screen.getByTestId('gdt-fcf-gdt-ai-base-hole-pos')).toBeInTheDocument()

    // 4) 四向同步高亮：切至仿真标签页，悬停右侧 GD&T 贡献度条目 -> 3D FCF 金色脉冲 + 3D 特征高亮 + 2D 工程图标注高亮
    await user.click(screen.getByTestId('sidebar-tab-simulation'))
    await user.click(screen.getByTestId('gdt-mode-expand-all'))
    const contribItem = screen.getByTestId('gdt-contrib-item-gdt-bracket-hole-pos')
    fireEvent.mouseEnter(contribItem)

    expect(screen.getByTestId('gdt-fcf-gdt-bracket-hole-pos')).toHaveAttribute('data-golden-pulse', 'true')
    expect(screen.getByTestId('gdt-fcf-box-gdt-bracket-hole-pos')).toHaveClass('gdt-fcf-golden-pulse')
    expect(screen.getByTestId('assembly-edge-feat-bracket-hole-axis')).toHaveAttribute(
      'data-highlighted',
      'true',
    )
    const annBtn = document.querySelector('[data-annotation-id="ann-bracket-hole-pos"]')
    expect(annBtn).toHaveAttribute('data-highlighted', 'true')
    fireEvent.mouseLeave(contribItem)
  })

  it('6. FEATURE_3D_ASSEMBLY_M1 = false 时单件模式 100% 零回归（无 GD&T 浮层、无 AI GD&T 卡片、无额外 range/number 输入）', () => {
    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        feature3dAssemblyM1={false}
        initialShowOnboarding={false}
        initialViewMode="model"
        initialDraftRevision="draft-8"
      />,
    )

    expect(screen.queryByTestId('gdt-3d-overlay-layer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('gdt-display-mode-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-gdt-drafts-card')).not.toBeInTheDocument()
    expect(document.querySelectorAll('input[type="range"]')).toHaveLength(0)
    expect(document.querySelectorAll('input[type="number"]')).toHaveLength(0)

    // 顶栏极简 3 步红线：绝不包含重型 CAD GD&T 工具栏按钮
    const header = document.querySelector('header')
    expect(header?.textContent ?? '').not.toMatch(/位置度|垂直度|平行度|平面度|同轴度|贴 GD&T/)
  })
})
