import { useId, type Dispatch } from 'react'
import type { ChainResult, Q } from '../domain/types'
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
  cellErrors: CellErrors
  stale: boolean
}

interface TargetInterval {
  minQ: Q
  maxQ: Q
}

/**
 * 目标区间不在 ChainResult 中冗余存储；用上次有效结果的极限值和裕量反推，
 * 这样 stale 时显示的允许区间仍然与上次有效结果属于同一次计算。
 */
function targetFromResult(result: ChainResult | null): TargetInterval | null {
  if (
    result === null ||
    result.lowerMarginQ === null ||
    result.upperMarginQ === null
  ) {
    return null
  }

  return {
    minQ: result.minQ - result.lowerMarginQ,
    maxQ: result.maxQ + result.upperMarginQ,
  }
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

function formatTarget(target: TargetInterval | null): string {
  return target === null
    ? '—'
    : `${formatMm(target.minQ)} ~ ${formatMm(target.maxQ)}`
}

interface ResultChartProps {
  result: ChainResult | null
  target: TargetInterval | null
}

const CHART_WIDTH = 360
const CHART_HEIGHT = 108
const PLOT_LEFT = 82
const PLOT_RIGHT = 344
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT
const AXIS_Y = 88
const TARGET_Y = 30
const RESULT_Y = 58
const BAR_HEIGHT = 12

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

  const hasData = values.length > 0
  const dataMin = hasData ? Math.min(...values) : 0
  const dataMax = hasData ? Math.max(...values) : 1
  const dataSpan = dataMax - dataMin
  // 留白只用于绘图可读性，不参与任何工程判定；所有区间仍使用同一比例。
  const padding =
    dataSpan === 0 ? Math.max(Math.abs(dataMin), 100) : Math.max(dataSpan * 0.08, 1)
  const domainMin = dataMin - padding
  const domainMax = dataMax + padding

  const xFor = (value: Q): number =>
    PLOT_LEFT + ((value - domainMin) / (domainMax - domainMin)) * PLOT_WIDTH

  const targetZeroWidth = target !== null && target.minQ === target.maxQ
  const resultZeroWidth = result !== null && result.minQ === result.maxQ
  const targetX = target === null ? 0 : xFor(target.minQ)
  const resultX = result === null ? 0 : xFor(result.minQ)
  const targetWidth = target === null ? 0 : Math.max(1, xFor(target.maxQ) - targetX)
  const resultWidth = result === null ? 0 : Math.max(1, xFor(result.maxQ) - resultX)

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
 * 受控结果卡：目标区间由 draft 提供，操作通过 dispatch 回传；
 * 组件内部不调用 useWorkspace，也不重新计算公式。
 */
export function ResultPanel({
  draft,
  dispatch,
  result,
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

  const target = targetFromResult(result)
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
