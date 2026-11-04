import { useId, type Dispatch } from 'react'
import type { ChainDefinition, ChainResult, Q } from '../domain/types'
import { formatMm } from '../domain/units'
import type {
  CellErrors,
  WorkspaceAction,
  WorkspaceDraft,
} from '../workspace/draft'

export interface ResultPanelProps {
  draft: WorkspaceDraft
  dispatch: Dispatch<WorkspaceAction>
  result: ChainResult | null
  /** 与 ChainDefinition['target'] 同类型，由调用方从 chain.target 直接传入。 */
  target: ChainDefinition['target']
  cellErrors: CellErrors
  stale: boolean
}

function statusLabel(
  result: ChainResult | null,
  relationConfirmed: boolean,
  stale: boolean,
): string {
  if (result === null) {
    return '暂无结果'
  }
  // 正式判定必须同时满足“已确认”和“当前输入有效”；stale 时只展示预览。
  if (!relationConfirmed || stale) {
    return '待确认（预览）'
  }
  if (result.status === 'within') {
    return '满足'
  }
  if (result.status === 'outside') {
    return '不满足'
  }
  return '未设置目标'
}

function formatValue(value: Q | null, signed = false): string {
  return value === null ? '—' : formatMm(value, { signed })
}

function formatTarget(target: ChainDefinition['target']): string {
  return target === null
    ? '—'
    : `${formatMm(target.minQ)} ~ ${formatMm(target.maxQ)}`
}

interface ResultChartProps {
  result: ChainResult | null
  target: ChainDefinition['target']
}

/** SVG 视口与布局常量，仅用于绘图定位，不参与任何尺寸结论。 */
const CHART_WIDTH = 360
const CHART_HEIGHT = 108
const PLOT_LEFT = 82
const PLOT_RIGHT = 344
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT
const AXIS_Y = 88
const TARGET_Y = 30
const RESULT_Y = 58
const BAR_HEIGHT = 12

interface ChartScale {
  hasData: boolean
  dataMin: Q
  dataMax: Q
  /** 把 q 值线性映射到 SVG 横坐标。 */
  xFor: (value: Q) => number
  /** 由两端 q 值得到 SVG 矩形宽度，只用于像素定位。 */
  widthFor: (minQ: Q, maxQ: Q) => number
}

/**
 * 仅做 SVG 坐标缩放的纯函数：把数值区间映射到绘图区像素。
 *
 * 这里的最小/最大值、留白和比例只影响图形是否易读，不参与尺寸、公差、
 * 裕量或判定结论；所有结论仍直接来自 calculateChain 的结果和调用方
 * 传入的 chain.target。
 */
function createChartScale(values: readonly Q[]): ChartScale {
  if (values.length === 0) {
    return {
      hasData: false,
      dataMin: 0,
      dataMax: 0,
      xFor: () => PLOT_LEFT,
      widthFor: () => 0,
    }
  }

  const dataMin = Math.min(...values)
  const dataMax = Math.max(...values)
  const dataSpan = dataMax - dataMin
  const padding =
    dataSpan === 0 ? Math.max(Math.abs(dataMin), 100) : Math.max(dataSpan * 0.08, 1)
  const domainMin = dataMin - padding
  const domainMax = dataMax + padding

  const xFor = (value: Q): number =>
    PLOT_LEFT + ((value - domainMin) / (domainMax - domainMin)) * PLOT_WIDTH
  const widthFor = (minQ: Q, maxQ: Q): number =>
    Math.max(1, xFor(maxQ) - xFor(minQ))

  return { hasData: true, dataMin, dataMax, xFor, widthFor }
}

/**
 * 结果区间与允许区间共用一条数值坐标轴。零宽区间仍绘制 circle，
 * 避免宽度为 0 的 rect 在视觉上消失。
 */
function ResultChart({ result, target }: ResultChartProps) {
  const titleId = `${useId()}-result-chart-title`
  const descriptionId = `${useId()}-result-chart-description`

  const values = [
    result?.minQ,
    result?.maxQ,
    target?.minQ,
    target?.maxQ,
  ].filter((value): value is Q => value !== undefined)

  const scale = createChartScale(values)
  const { hasData, dataMin, dataMax } = scale

  const targetZeroWidth = target !== null && target.minQ === target.maxQ
  const resultZeroWidth = result !== null && result.minQ === result.maxQ
  const targetX = target === null ? 0 : scale.xFor(target.minQ)
  const resultX = result === null ? 0 : scale.xFor(result.minQ)
  const targetWidth =
    target === null ? 0 : scale.widthFor(target.minQ, target.maxQ)
  const resultWidth =
    result === null ? 0 : scale.widthFor(result.minQ, result.maxQ)

  return (
    <div className="result-panel__chart">
      <h3 className="result-panel__chart-title">结果区间与允许区间</h3>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        className="result-panel__svg"
        style={{ display: 'block', width: '100%', height: 'auto' }}
      >
        <title id={titleId}>结果区间与允许区间示意</title>
        <desc id={descriptionId}>
          结果区间与允许区间绘制在同一数值坐标轴上；零宽区间用圆点标记。
        </desc>

        <text x={8} y={TARGET_Y + 4} fontSize={12} fill="#374151">
          允许区间
        </text>
        <text x={8} y={RESULT_Y + 4} fontSize={12} fill="#374151">
          结果区间
        </text>

        <line
          x1={PLOT_LEFT}
          y1={AXIS_Y}
          x2={PLOT_RIGHT}
          y2={AXIS_Y}
          stroke="#6b7280"
          strokeWidth={1}
        />

        {target === null ? (
          <text
            x={PLOT_LEFT}
            y={TARGET_Y + 4}
            fontSize={12}
            fill="#9ca3af"
            data-testid="chart-no-target"
          >
            未设置目标区间
          </text>
        ) : targetZeroWidth ? (
          <circle
            data-testid="target-zero-marker"
            cx={targetX}
            cy={TARGET_Y}
            r={5.5}
            fill="#c7d2fe"
            stroke="#4f46e5"
            strokeWidth={1.5}
          >
            <title>允许区间为零宽</title>
          </circle>
        ) : (
          <rect
            data-testid="target-range"
            x={targetX}
            y={TARGET_Y - BAR_HEIGHT / 2}
            width={targetWidth}
            height={BAR_HEIGHT}
            rx={3}
            fill="#c7d2fe"
            stroke="#4f46e5"
            strokeWidth={1.5}
          >
            <title>允许区间</title>
          </rect>
        )}

        {result === null ? (
          <text
            x={PLOT_LEFT}
            y={RESULT_Y + 4}
            fontSize={12}
            fill="#9ca3af"
            data-testid="chart-no-result"
          >
            暂无有效结果
          </text>
        ) : resultZeroWidth ? (
          <circle
            data-testid="result-zero-marker"
            cx={resultX}
            cy={RESULT_Y}
            r={5.5}
            fill="#bbf7d0"
            stroke="#15803d"
            strokeWidth={1.5}
          >
            <title>结果区间为零宽</title>
          </circle>
        ) : (
          <rect
            data-testid="result-range"
            x={resultX}
            y={RESULT_Y - BAR_HEIGHT / 2}
            width={resultWidth}
            height={BAR_HEIGHT}
            rx={3}
            fill="#bbf7d0"
            stroke="#15803d"
            strokeWidth={1.5}
          >
            <title>结果区间</title>
          </rect>
        )}

        {hasData && (
          <>
            <text x={PLOT_LEFT} y={CHART_HEIGHT - 3} fontSize={11} fill="#6b7280">
              {formatMm(dataMin)}
            </text>
            <text
              x={PLOT_RIGHT}
              y={CHART_HEIGHT - 3}
              fontSize={11}
              fill="#6b7280"
              textAnchor="end"
            >
              {formatMm(dataMax)}
            </text>
          </>
        )}
      </svg>
    </div>
  )
}

/**
 * 受控结果卡：目标区间由调用方从 chain.target 直接传入，输入通过 dispatch 回传；
 * 组件只负责展示和格式化，不重新计算目标区间，也不做任何尺寸换算。
 */
export function ResultPanel({
  draft,
  dispatch,
  result,
  target,
  cellErrors,
  stale,
}: ResultPanelProps) {
  const baseId = useId()
  const headingId = `${baseId}-heading`
  const targetMinId = `${baseId}-target-min`
  const targetMaxId = `${baseId}-target-max`
  const targetMinErrorId = `${baseId}-target-min-error`
  const targetMaxErrorId = `${baseId}-target-max-error`
  const confirmedId = `${baseId}-confirmed`

  const targetMinError = cellErrors['target.min']
  const targetMaxError = cellErrors['target.max']
  const currentStatus = statusLabel(result, draft.relationConfirmed, stale)

  const updateTarget = (targetMin: string, targetMax: string) => {
    dispatch({ type: 'setTarget', targetMin, targetMax })
  }

  return (
    <section className="result-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="result-panel__title">
        结果卡
      </h2>

      {stale && (
        <p className="result-panel__stale" role="alert">
          输入有误，显示的是上次有效结果
        </p>
      )}

      <div className="result-panel__target">
        <div className="result-panel__target-field">
          <label htmlFor={targetMinId}>目标下限</label>
          <input
            id={targetMinId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={draft.targetMin}
            onChange={(event) =>
              updateTarget(event.target.value, draft.targetMax)
            }
            aria-invalid={targetMinError === undefined ? undefined : true}
            aria-describedby={
              targetMinError === undefined ? undefined : targetMinErrorId
            }
          />
          <span aria-hidden="true">mm</span>
          {targetMinError !== undefined && (
            <p id={targetMinErrorId} className="result-panel__field-error" role="alert">
              {targetMinError}
            </p>
          )}
        </div>

        <div className="result-panel__target-field">
          <label htmlFor={targetMaxId}>目标上限</label>
          <input
            id={targetMaxId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={draft.targetMax}
            onChange={(event) =>
              updateTarget(draft.targetMin, event.target.value)
            }
            aria-invalid={targetMaxError === undefined ? undefined : true}
            aria-describedby={
              targetMaxError === undefined ? undefined : targetMaxErrorId
            }
          />
          <span aria-hidden="true">mm</span>
          {targetMaxError !== undefined && (
            <p id={targetMaxErrorId} className="result-panel__field-error" role="alert">
              {targetMaxError}
            </p>
          )}
        </div>
      </div>

      <dl className="result-panel__values">
        <div className="result-panel__row" data-testid="result-nominal">
          <dt>C₀</dt>
          <dd>{formatValue(result?.nominalQ ?? null)}</dd>
        </div>
        <div className="result-panel__row" data-testid="result-min">
          <dt>Cmin</dt>
          <dd>{formatValue(result?.minQ ?? null)}</dd>
        </div>
        <div className="result-panel__row" data-testid="result-max">
          <dt>Cmax</dt>
          <dd>{formatValue(result?.maxQ ?? null)}</dd>
        </div>
        <div className="result-panel__row" data-testid="result-lower-deviation">
          <dt>EIc</dt>
          <dd>{formatValue(result?.lowerDeviationQ ?? null, true)}</dd>
        </div>
        <div className="result-panel__row" data-testid="result-upper-deviation">
          <dt>ESc</dt>
          <dd>{formatValue(result?.upperDeviationQ ?? null, true)}</dd>
        </div>
        <div className="result-panel__row" data-testid="result-tolerance">
          <dt>Tc</dt>
          <dd>{formatValue(result?.toleranceQ ?? null)}</dd>
        </div>
        <div className="result-panel__row" data-testid="result-target">
          <dt>允许区间</dt>
          <dd>{formatTarget(target)}</dd>
        </div>
        <div className="result-panel__row" data-testid="result-status">
          <dt>状态</dt>
          <dd aria-live="polite">{currentStatus}</dd>
        </div>
        <div className="result-panel__row" data-testid="result-lower-margin">
          <dt>下限裕量</dt>
          <dd>{formatValue(result?.lowerMarginQ ?? null, true)}</dd>
        </div>
        <div className="result-panel__row" data-testid="result-upper-margin">
          <dt>上限裕量</dt>
          <dd>{formatValue(result?.upperMarginQ ?? null, true)}</dd>
        </div>
      </dl>

      <ResultChart result={result} target={target} />

      <label className="result-panel__confirmed" htmlFor={confirmedId}>
        <input
          id={confirmedId}
          type="checkbox"
          checked={draft.relationConfirmed}
          onChange={(event) =>
            dispatch({
              type: 'setConfirmed',
              confirmed: event.target.checked,
            })
          }
        />
        已核对尺寸关系与作用方向
      </label>
    </section>
  )
}
