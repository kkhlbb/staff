import type {
  DatumDefinition,
  GdtFeatureControl,
  GdtMaterialModifier,
  SimulationDiagnosticResult,
} from '../assembly3dTypes'
import { formatFcfCells, GDT_KIND_META, GDT_MODIFIER_LABELS, mmToToleranceQ } from '../gdt3dMath'

export interface SimulationWhatIfPanelProps {
  readonly result: SimulationDiagnosticResult
  readonly computing?: boolean
  readonly activeFeatureId?: string | null
  readonly activeGdtId?: string | null
  readonly gdtControls?: readonly GdtFeatureControl[]
  readonly datums?: readonly DatumDefinition[]
  readonly onChangeContributorTolerance: (contributorId: string, nextTolMm: number) => void
  readonly onUpdateGdtControl?: (
    gdtId: string,
    patch: { readonly toleranceQ?: number; readonly modifier?: GdtMaterialModifier },
  ) => void
  readonly onHoverContributor?: (
    target: { readonly featureId: string; readonly partId?: string; readonly gdtId?: string } | null,
  ) => void
  readonly onClickContributor?: (target: {
    readonly featureId: string
    readonly partId?: string
    readonly gdtId?: string
  }) => void
}

const GDT_QUICK_MODIFIERS: readonly GdtMaterialModifier[] = ['RFS', 'MMC', 'LMC']

function formatStatusLabel(status: SimulationDiagnosticResult['status']): {
  readonly text: string
  readonly toneClass: string
} {
  if (status === 'pass') return { text: '稳健达标', toneClass: 'pa-tone-pass' }
  if (status === 'warn') return { text: '临界风险', toneClass: 'pa-tone-pending' }
  return { text: '超差风险', toneClass: 'pa-tone-danger' }
}

/**
 * Right-sidebar 3D closed-loop simulation diagnostics & live What-If panel:
 * - KPI cards: Nominal, ±3σ interval, Cp / Cpk, predicted PPM
 * - Pure SVG distribution histogram with LSL / USL tolerance limit lines
 * - Descending Pareto variance contribution bars
 * - Per-contributor What-If slider (<500ms refresh) & bidirectional 3D feature highlight
 */
export function SimulationWhatIfPanel({
  result,
  computing = false,
  activeFeatureId = null,
  activeGdtId = null,
  gdtControls = [],
  datums = [],
  onChangeContributorTolerance,
  onUpdateGdtControl,
  onHoverContributor,
  onClickContributor,
}: SimulationWhatIfPanelProps) {
  const statusMeta = formatStatusLabel(result.status)
  const gdtById = new Map(gdtControls.map((g) => [g.id, g]))
  const gdtContributions = result.gdtContributions ?? []
  const gdtWarnings = result.gdtWarnings ?? []

  const histWidth = 260
  const histHeight = 84
  const padX = 8
  const padTop = 10
  const padBottom = 18
  const plotWidth = histWidth - padX * 2
  const plotHeight = histHeight - padTop - padBottom

  const minMm = result.histogram[0]?.startMm ?? result.lslMm
  const maxMm = result.histogram[result.histogram.length - 1]?.endMm ?? result.uslMm
  const spanMm = Math.max(maxMm - minMm, 1e-6)
  const mapX = (valueMm: number) =>
    padX + Math.max(0, Math.min(1, (valueMm - minMm) / spanMm)) * plotWidth
  const lslX = mapX(result.lslMm)
  const uslX = mapX(result.uslMm)
  const barGap = 2
  const barWidth = Math.max(
    4,
    (plotWidth - barGap * Math.max(0, result.histogram.length - 1)) /
      Math.max(1, result.histogram.length),
  )

  return (
    <section
      className="pa-sim-panel"
      aria-label="3D 仿真诊断与 What-If 面板"
      data-testid="simulation-whatif-panel"
    >
      {/* Closed-loop KPI Summary Card */}
      <div className="pa-card pa-sim-kpi-card">
        <div className="pa-header">
          <strong>封闭环：{result.title}</strong>
          <span
            className={`pa-pill ${statusMeta.toneClass}`}
            data-testid="sim-status-pill"
          >
            {statusMeta.text}
          </span>
        </div>

        <div className="pa-sim-spec-meta">
          <span>
            公差要求：<span className="pa-mono">{result.lslMm.toFixed(2)} ~ {result.uslMm.toFixed(2)} mm</span>
          </span>
          <span className="pa-mono pa-muted">
            {computing ? '重算中…' : `${result.computeMs.toFixed(1)} ms`}
          </span>
        </div>

        <div className="pa-sim-kpi-grid">
          <div className="pa-sim-kpi-box">
            <span className="pa-sim-kpi-label">名义值</span>
            <strong className="pa-sim-kpi-val pa-mono" data-testid="sim-kpi-nominal">
              {result.nominalMm.toFixed(3)} mm
            </strong>
          </div>
          <div className="pa-sim-kpi-box">
            <span className="pa-sim-kpi-label">±3σ 区间</span>
            <strong className="pa-sim-kpi-val pa-mono" data-testid="sim-kpi-3sigma">
              {result.threeSigmaLowMm.toFixed(3)}~{result.threeSigmaHighMm.toFixed(3)}
            </strong>
          </div>
          <div className="pa-sim-kpi-box">
            <span className="pa-sim-kpi-label">Cp / Cpk</span>
            <strong className="pa-sim-kpi-val pa-mono" data-testid="sim-kpi-cpk">
              {result.cp.toFixed(2)} / {result.cpk.toFixed(2)}
            </strong>
          </div>
          <div className="pa-sim-kpi-box">
            <span className="pa-sim-kpi-label">预测不良率 PPM</span>
            <strong className="pa-sim-kpi-val pa-mono" data-testid="sim-kpi-ppm">
              {result.ppm.toLocaleString('en-US')}
            </strong>
          </div>
        </div>

        {/* Pure SVG Distribution Histogram with LSL / USL lines */}
        <div className="pa-sim-histogram-wrap">
          <svg
            className="pa-sim-histogram-svg"
            data-testid="simulation-histogram-svg"
            viewBox={`0 0 ${histWidth} ${histHeight}`}
            role="img"
            aria-label={`3D 封闭环分布直方图，LSL ${result.lslMm.toFixed(2)} mm，USL ${result.uslMm.toFixed(2)} mm`}
          >
            {result.histogram.map((bin, idx) => {
              const bh = Math.max(2, bin.ratio * plotHeight)
              const x = padX + idx * (barWidth + barGap)
              const y = padTop + (plotHeight - bh)
              return (
                <rect
                  key={idx}
                  x={x.toFixed(1)}
                  y={y.toFixed(1)}
                  width={barWidth.toFixed(1)}
                  height={bh.toFixed(1)}
                  rx={1.5}
                  data-out-of-spec={bin.outOfSpec ? 'true' : 'false'}
                  className={
                    bin.outOfSpec ? 'pa-sim-hist-bar pa-sim-hist-bar-oos' : 'pa-sim-hist-bar'
                  }
                />
              )
            })}
            <line
              x1={lslX.toFixed(1)}
              y1={padTop - 3}
              x2={lslX.toFixed(1)}
              y2={padTop + plotHeight + 2}
              className="pa-sim-limit-line"
              data-testid="sim-hist-lsl-line"
            />
            <line
              x1={uslX.toFixed(1)}
              y1={padTop - 3}
              x2={uslX.toFixed(1)}
              y2={padTop + plotHeight + 2}
              className="pa-sim-limit-line"
              data-testid="sim-hist-usl-line"
            />
            <text x={lslX.toFixed(1)} y={histHeight - 4} textAnchor="middle" className="pa-sim-axis-text">
              LSL {result.lslMm.toFixed(2)}
            </text>
            <text x={uslX.toFixed(1)} y={histHeight - 4} textAnchor="middle" className="pa-sim-axis-text">
              USL {result.uslMm.toFixed(2)}
            </text>
          </svg>
        </div>
      </div>

      {/* Top Contributors Pareto + What-If Sliders */}
      <div className="pa-sim-pareto-section">
        <div className="pa-header">
          <span className="pa-card-label">Top 贡献度帕累托 · What-If 实时试算</span>
        </div>

        <ul className="pa-sim-pareto-list" aria-label="公差贡献度帕累托列表">
          {result.pareto.map((item, rank) => {
            const isHighlighted = activeFeatureId === item.featureId
            const barTone =
              item.varianceSharePercent >= 45
                ? 'pa-pareto-fill-high'
                : item.varianceSharePercent >= 25
                  ? 'pa-pareto-fill-mid'
                  : 'pa-pareto-fill-low'
            return (
              <li
                key={item.contributorId}
                data-testid={`pareto-item-${item.contributorId}`}
                data-rank={String(rank + 1)}
                data-feature-id={item.featureId}
                data-highlighted={isHighlighted ? 'true' : 'false'}
                className={`pa-sim-pareto-item ${isHighlighted ? 'pa-sim-pareto-item-active' : ''}`}
                onMouseEnter={() =>
                  onHoverContributor?.({ featureId: item.featureId, partId: item.partId })
                }
                onMouseLeave={() => onHoverContributor?.(null)}
              >
                <button
                  type="button"
                  className="pa-sim-pareto-head"
                  onClick={() =>
                    onClickContributor?.({ featureId: item.featureId, partId: item.partId })
                  }
                >
                  <span>
                    <strong>{rank + 1}.</strong> {item.label}
                  </span>
                  <span
                    className="pa-mono pa-sim-share-pct"
                    data-testid={`pareto-pct-${item.contributorId}`}
                  >
                    {item.varianceSharePercent.toFixed(1)}%
                  </span>
                </button>

                <div className="pa-pareto-bar-track" aria-hidden="true">
                  <div
                    className={`pa-pareto-bar-fill ${barTone}`}
                    style={{ width: `${Math.min(100, Math.max(2, item.varianceSharePercent))}%` }}
                  />
                </div>

                <label className="pa-whatif-slider-row">
                  <span>试调</span>
                  <input
                    type="range"
                    data-testid={`whatif-slider-${item.contributorId}`}
                    aria-label={`${item.label} What-If 公差滑块`}
                    min={item.minTolMm}
                    max={item.maxTolMm}
                    step={item.stepMm}
                    value={item.currentTolMm}
                    onChange={(event) => {
                      onChangeContributorTolerance(item.contributorId, Number(event.target.value))
                    }}
                  />
                  <span className="pa-mono pa-whatif-val" data-testid={`whatif-val-${item.contributorId}`}>
                    {item.formatPrefix}
                    {item.currentTolMm.toFixed(3)} mm
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </div>

      {/* M3G GD&T Contributions (Variance Share, MMC Bonus, Datum Shift) & What-If */}
      {gdtContributions.length > 0 ? (
        <div
          className="pa-sim-pareto-section pa-sim-gdt-section"
          data-testid="sim-gdt-contributions-section"
        >
          <div className="pa-header">
            <span className="pa-card-label">GD&amp;T 贡献度 · MMC 补偿与基准偏移</span>
            <span className="pa-mono pa-muted">{gdtContributions.length} 条</span>
          </div>

          <ul className="pa-sim-pareto-list" aria-label="GD&T 公差贡献度明细">
            {gdtContributions.map((item) => {
              const control = gdtById.get(item.gdtId)
              const fcf = control ? formatFcfCells(control, datums) : null
              const isHighlighted =
                activeGdtId === item.gdtId ||
                (control !== undefined && activeFeatureId === control.featureId)
              const tolMm = control ? control.toleranceQ / 10000 : 0.1
              const currentMod: GdtMaterialModifier = control?.modifier ?? 'RFS'
              return (
                <li
                  key={item.gdtId}
                  data-testid={`gdt-contrib-item-${item.gdtId}`}
                  data-gdt-id={item.gdtId}
                  data-highlighted={isHighlighted ? 'true' : 'false'}
                  className={`pa-sim-pareto-item pa-sim-gdt-item ${isHighlighted ? 'pa-sim-pareto-item-active pa-fourway-highlighted' : ''}`}
                  onMouseEnter={() => {
                    if (control) {
                      onHoverContributor?.({
                        featureId: control.featureId,
                        gdtId: control.id,
                      })
                    }
                  }}
                  onMouseLeave={() => onHoverContributor?.(null)}
                >
                  <button
                    type="button"
                    className="pa-sim-pareto-head"
                    onClick={() => {
                      if (control) {
                        onClickContributor?.({
                          featureId: control.featureId,
                          gdtId: control.id,
                        })
                      }
                    }}
                  >
                    <span>
                      <strong>{GDT_KIND_META[item.kind].symbol}</strong> {item.label}
                    </span>
                    <span
                      className="pa-mono pa-sim-share-pct"
                      data-testid={`gdt-contrib-pct-${item.gdtId}`}
                    >
                      {item.varianceSharePct.toFixed(1)}%
                    </span>
                  </button>

                  {fcf ? <div className="pa-mono pa-muted pa-sim-fcf-line">{fcf.summaryText}</div> : null}

                  <div className="pa-sim-gdt-metrics">
                    <span
                      className="pa-pill pa-tone-pass pa-mono"
                      data-testid={`gdt-bonus-${item.gdtId}`}
                    >
                      MMC Bonus +{item.bonusMeanMm.toFixed(3)} mm
                    </span>
                    <span
                      className="pa-pill pa-tone-action pa-mono"
                      data-testid={`gdt-shift-${item.gdtId}`}
                    >
                      Datum Shift {item.datumShiftContributionPct.toFixed(1)}%
                    </span>
                  </div>

                  {control && onUpdateGdtControl ? (
                    <div className="pa-sim-gdt-whatif">
                      <label className="pa-whatif-slider-row">
                        <span>试调</span>
                        <input
                          type="range"
                          data-testid={`gdt-whatif-slider-${item.gdtId}`}
                          aria-label={`${item.label} GD&T What-If 滑块`}
                          min={0.01}
                          max={0.5}
                          step={0.01}
                          value={Number(tolMm.toFixed(3))}
                          onChange={(event) => {
                            onUpdateGdtControl(control.id, {
                              toleranceQ: mmToToleranceQ(Number(event.target.value)),
                            })
                          }}
                        />
                        <span className="pa-mono pa-whatif-val">{tolMm.toFixed(2)} mm</span>
                      </label>
                      <div className="pa-gdt-inline-mods" role="group" aria-label={`${item.label} 实体条件切换`}>
                        {GDT_QUICK_MODIFIERS.map((mod) => (
                          <button
                            key={mod}
                            type="button"
                            data-testid={`gdt-whatif-mod-${item.gdtId}-${mod}`}
                            aria-pressed={currentMod === mod}
                            className={
                              currentMod === mod
                                ? 'pa-btn pa-btn-primary pa-btn-sm'
                                : 'pa-btn pa-btn-ghost pa-btn-sm'
                            }
                            onClick={() => onUpdateGdtControl(control.id, { modifier: mod })}
                          >
                            {GDT_MODIFIER_LABELS[mod]}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {/* GD&T Validation Warnings */}
      {gdtWarnings.length > 0 ? (
        <div className="pa-notice pa-sim-gdt-warnings" role="status" data-testid="sim-gdt-warnings">
          <strong>GD&amp;T 工程校验提示（{gdtWarnings.length}）</strong>
          <ul className="pa-sim-warning-list">
            {gdtWarnings.map((w, idx) => (
              <li key={`${w.code}-${w.gdtId}-${idx}`} data-warning-code={w.code}>
                <span className="pa-mono">[{w.code}]</span> {w.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
