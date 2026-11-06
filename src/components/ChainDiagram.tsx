import { useId, type KeyboardEvent } from 'react'
import { Q_PER_MM, type Q } from '../domain/types'
import { formatMm, tryParseMm } from '../domain/units'

/**
 * ChainDiagram 只读取展示所需的最小字段，因此既可以直接接收
 * useWorkspace().draft.terms（nominal 为输入字符串），也可以接收
 * useWorkspace().chain.terms（nominalQ 为领域整数）。
 */
export interface ChainDiagramTerm {
  id: string
  symbol: string
  sign: 1 | -1
  /** 草稿中的十进制 mm 字符串。 */
  nominal?: string
  /** 领域层的整数 q（0.0001 mm）。nominal 存在时优先使用 nominal。 */
  nominalQ?: Q
}

export interface ChainDiagramProps {
  terms: readonly ChainDiagramTerm[]
  selectedTermId?: string | null
  onSelect: (termId: string) => void
}

const AXIS_BASE_Y = 92
const VIEWBOX_HEIGHT = 176
const VIEWBOX_MIN_WIDTH = 520
const PADDING_X = 56
const MIN_SEGMENT_WIDTH = 84
const MAX_SEGMENT_WIDTH = 180

/** 标签块按两行文字估算；只用于示意图排版，不参与尺寸或公差结论。 */
const LABEL_BOX_HEIGHT = 36
const LABEL_BOX_TOP = 14
const LABEL_BOX_BOTTOM = 22
const LABEL_ROW_GAP = 42
const LABEL_HORIZONTAL_GAP = 4
const ABOVE_LABEL_OFFSET = 34
const BELOW_LABEL_OFFSET = 38
const LABEL_EDGE_PADDING = 8

/**
 * 示意图允许非等比例。用平方根压缩长短尺寸的悬殊差异，
 * 并给有效段设置最小可视宽度，避免短段不可见或不可点击。
 * 这里只负责画图几何，不参与任何公差计算。
 */
function displayWidth(nominalQ: Q | null): number {
  if (nominalQ === null || nominalQ <= 0) {
    return 0
  }
  const mm = nominalQ / Q_PER_MM
  const scaled = Math.sqrt(mm) * 18
  return Math.min(MAX_SEGMENT_WIDTH, Math.max(MIN_SEGMENT_WIDTH, scaled))
}

interface NominalDisplay {
  text: string
  valueQ: Q | null
  /** 非正尺寸在领域层无效，但仍按零宽点绘制并保留用户输入。 */
  invalid: boolean
}

function describeNominal(term: ChainDiagramTerm): NominalDisplay {
  if (term.nominal !== undefined) {
    const raw = term.nominal.trim()
    const parsed = tryParseMm(raw)
    if (!parsed.ok) {
      return {
        text: raw === '' ? '未填写尺寸' : raw,
        valueQ: null,
        invalid: true,
      }
    }
    return {
      text: formatMm(parsed.value),
      valueQ: parsed.value,
      invalid: parsed.value <= 0,
    }
  }

  if (term.nominalQ !== undefined) {
    if (Number.isSafeInteger(term.nominalQ)) {
      return {
        text: formatMm(term.nominalQ),
        valueQ: term.nominalQ,
        invalid: term.nominalQ <= 0,
      }
    }
    return { text: '尺寸无效', valueQ: null, invalid: true }
  }

  return { text: '未填写尺寸', valueQ: null, invalid: true }
}

type LabelSide = 'above' | 'below'

interface SegmentGeometry {
  term: ChainDiagramTerm
  nominal: NominalDisplay
  width: number
  index: number
  direction: 'right' | 'left'
  startX: number
  endX: number
  labelX: number
  labelY: number
  labelWidth: number
  labelText: string
  labelSide: LabelSide
  labelLane: number
  markerY: number
  zeroWidth: boolean
}

function labelTextFor(nominal: NominalDisplay): string {
  if (nominal.valueQ === 0) {
    return `${nominal.text}（零宽）`
  }
  if (nominal.invalid) {
    return `${nominal.text}（无效）`
  }
  return nominal.text
}

function labelWidthFor(symbol: string, text: string): number {
  return Math.max(56, Math.max(symbol.length, text.length) * 8 + 16)
}

interface LabelPlacement {
  lane: number
}

/**
 * 同一侧按标签中心从左到右分配“行”。同一行内的标签互不重叠，
 * 行与行之间保持固定垂直间距；这样 7 环 REAL-01 这类正负交错、
 * 同侧标签密集的布局也不需要把文字压在一起。
 */
function assignLabelLanes(
  items: readonly {
    index: number
    labelX: number
    labelWidth: number
  }[],
): { placements: Map<number, LabelPlacement>; laneCount: number } {
  const placements = new Map<number, LabelPlacement>()
  const laneRightEdges: number[] = []

  const sorted = items.slice().sort(
    (left, right) => left.labelX - right.labelX || left.index - right.index,
  )

  for (const item of sorted) {
    const left = item.labelX - item.labelWidth / 2
    const right = item.labelX + item.labelWidth / 2
    let lane = 0
    while (
      lane < laneRightEdges.length &&
      left < laneRightEdges[lane] + LABEL_HORIZONTAL_GAP
    ) {
      lane += 1
    }
    if (lane === laneRightEdges.length) {
      laneRightEdges.push(right)
    } else {
      laneRightEdges[lane] = right
    }
    placements.set(item.index, { lane })
  }

  return { placements, laneCount: laneRightEdges.length }
}

function layoutSegments(terms: readonly ChainDiagramTerm[]): {
  segments: SegmentGeometry[]
  viewWidth: number
  viewHeight: number
  axisY: number
} {
  const parsed = terms.map((term) => {
    const nominal = describeNominal(term)
    return { term, nominal, width: displayWidth(nominal.valueQ) }
  })

  let cursor = 0
  let zeroRank = 0
  const raw = parsed.map((item, index) => {
    const startX = cursor
    const endX = cursor + item.term.sign * item.width
    cursor = endX

    const zeroWidth = item.width === 0
    // 连续零宽段都落在同一 x 上；轻微错开标记点，避免完全重叠后无法选择。
    const markerOffset = zeroWidth ? ((zeroRank++ % 3) - 1) * 16 : 0
    const labelText = labelTextFor(item.nominal)
    const labelSide: LabelSide = zeroWidth
      ? markerOffset < 0
        ? 'above'
        : 'below'
      : index % 2 === 0
        ? 'above'
        : 'below'

    return {
      ...item,
      index,
      direction: (item.term.sign === 1 ? 'right' : 'left') as 'right' | 'left',
      startX,
      endX,
      zeroWidth,
      markerOffset,
      labelText,
      labelWidth: labelWidthFor(item.term.symbol, labelText),
      labelSide,
    }
  })

  let minX = 0
  let maxX = 0
  for (const segment of raw) {
    minX = Math.min(minX, segment.startX, segment.endX)
    maxX = Math.max(maxX, segment.startX, segment.endX)
  }

  const shift = PADDING_X - minX
  const viewWidth = Math.max(
    VIEWBOX_MIN_WIDTH,
    maxX - minX + PADDING_X * 2,
  )

  const shifted = raw.map((segment) => ({
    ...segment,
    startX: segment.startX + shift,
    endX: segment.endX + shift,
    labelX: (segment.startX + segment.endX) / 2 + shift,
  }))

  const above = assignLabelLanes(
    shifted.filter((segment) => segment.labelSide === 'above'),
  )
  const below = assignLabelLanes(
    shifted.filter((segment) => segment.labelSide === 'below'),
  )

  // 上方标签行数增加时把轴线整体下移，保证最上面一行仍在视口内。
  const axisY = Math.max(
    AXIS_BASE_Y,
    ABOVE_LABEL_OFFSET +
      LABEL_BOX_TOP +
      LABEL_EDGE_PADDING +
      Math.max(0, above.laneCount - 1) * LABEL_ROW_GAP,
  )
  const viewHeight = Math.max(
    VIEWBOX_HEIGHT,
    axisY +
      BELOW_LABEL_OFFSET +
      Math.max(0, below.laneCount - 1) * LABEL_ROW_GAP +
      LABEL_BOX_BOTTOM +
      LABEL_EDGE_PADDING,
  )

  const segments = shifted.map((segment): SegmentGeometry => {
    const lane =
      (segment.labelSide === 'above' ? above : below).placements.get(
        segment.index,
      )?.lane ?? 0
    const labelY =
      segment.labelSide === 'above'
        ? axisY - ABOVE_LABEL_OFFSET - lane * LABEL_ROW_GAP
        : axisY + BELOW_LABEL_OFFSET + lane * LABEL_ROW_GAP

    return {
      ...segment,
      labelY,
      labelSide: segment.labelSide,
      labelLane: lane,
      markerY: axisY + segment.markerOffset,
    }
  })

  return { segments, viewWidth, viewHeight, axisY }
}

function signLabel(sign: 1 | -1): string {
  return sign === 1 ? '增加封闭环（向右）' : '减小封闭环（向左）'
}

function accessibleDescription(terms: readonly ChainDiagramTerm[]): string {
  if (terms.length === 0) {
    return '尺寸链关系示意，非装配图。当前还没有组成环。非等比例绘制。'
  }

  const parts = terms.map((term) => {
    const nominal = describeNominal(term)
    const size = nominal.invalid
      ? `基本尺寸无效（${nominal.text}）`
      : `基本尺寸 ${nominal.text} 毫米`
    return `${term.symbol}，${size}，${signLabel(term.sign)}`
  })

  return `尺寸链关系示意，非装配图。共 ${terms.length} 段，按输入顺序首尾相接：${parts.join('；')}。非等比例绘制。`
}

function segmentAccessibleName(segment: SegmentGeometry): string {
  const size = segment.nominal.invalid
    ? `基本尺寸无效（${segment.nominal.text}）`
    : `基本尺寸 ${segment.nominal.text} 毫米`
  const zero = segment.zeroWidth ? '，零宽按点显示' : ''
  return `${segment.term.symbol}，${size}，${signLabel(segment.term.sign)}${zero}`
}

export function ChainDiagram({
  terms,
  selectedTermId = null,
  onSelect,
}: ChainDiagramProps) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const titleId = `chain-diagram-title-${reactId}`
  const markerId = `chain-diagram-arrow-${reactId}`
  const selectedMarkerId = `chain-diagram-arrow-selected-${reactId}`
  const { segments, viewWidth, viewHeight, axisY } = layoutSegments(terms)

  const handleSelect = (termId: string) => {
    onSelect(termId)
  }

  const handleKeyDown = (
    event: KeyboardEvent<SVGGElement>,
    termId: string,
  ) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      handleSelect(termId)
    }
  }

  return (
    <figure
      className="chain-diagram"
      style={{
        margin: 0,
        padding: 12,
        border: '1px solid var(--border, #e5e4e7)',
        borderRadius: 8,
        background: 'var(--bg, #fff)',
        color: 'var(--text, #334155)',
        textAlign: 'left',
      }}
    >
      <figcaption
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span
          className="chain-diagram__title"
          style={{
            fontWeight: 600,
            color: 'var(--text-h, #08060d)',
          }}
        >
          尺寸链关系示意，非装配图
        </span>
        <span
          className="chain-diagram__non-scale"
          style={{
            display: 'inline-block',
            padding: '1px 6px',
            border: '1px solid var(--border, #e5e4e7)',
            borderRadius: 999,
            fontSize: 12,
            lineHeight: '18px',
          }}
        >
          非比例
        </span>
      </figcaption>

      <div style={{ overflowX: 'auto' }}>
        <svg
          role="img"
          aria-labelledby={titleId}
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
          style={{ display: 'block', width: '100%', minWidth: 320, height: 'auto' }}
        >
          <title id={titleId}>{accessibleDescription(terms)}</title>
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
            <marker
              id={selectedMarkerId}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent, #aa3bff)" />
            </marker>
          </defs>

          <line
            x1={0}
            y1={axisY}
            x2={viewWidth}
            y2={axisY}
            stroke="var(--border, #e5e4e7)"
            strokeDasharray="4 6"
            pointerEvents="none"
          />

          {terms.length === 0 ? (
            <text
              x={viewWidth / 2}
              y={axisY - 18}
              textAnchor="middle"
              fill="currentColor"
              fontSize={14}
            >
              尚未添加组成环
            </text>
          ) : null}

          {segments.map((segment) => {
            const selected = segment.term.id === selectedTermId
            const stroke = selected
              ? 'var(--accent, #aa3bff)'
              : 'currentColor'

            return (
              <g
                key={segment.term.id}
                role="button"
                tabIndex={0}
                aria-label={segmentAccessibleName(segment)}
                aria-pressed={selected}
                data-term-id={segment.term.id}
                data-sign={segment.term.sign}
                data-direction={segment.direction}
                data-selected={selected ? 'true' : 'false'}
                data-zero-width={segment.zeroWidth ? 'true' : 'false'}
                data-invalid={segment.nominal.invalid ? 'true' : 'false'}
                data-label-x={segment.labelX}
                data-label-y={segment.labelY}
                data-label-width={segment.labelWidth}
                data-label-height={LABEL_BOX_HEIGHT}
                data-label-side={segment.labelSide}
                data-label-lane={segment.labelLane}
                onClick={() => handleSelect(segment.term.id)}
                onKeyDown={(event) => handleKeyDown(event, segment.term.id)}
                style={{ cursor: 'pointer', outline: 'none' }}
              >
                {selected ? (
                  <rect
                    x={segment.labelX - segment.labelWidth / 2}
                    y={segment.labelY - LABEL_BOX_TOP}
                    width={segment.labelWidth}
                    height={LABEL_BOX_HEIGHT}
                    rx={6}
                    fill="var(--accent-bg, rgba(170, 59, 255, 0.12))"
                    pointerEvents="none"
                  />
                ) : null}

                {segment.zeroWidth ? (
                  <>
                    <circle
                      data-zero-width-marker="true"
                      cx={segment.startX}
                      cy={segment.markerY}
                      r={selected ? 7 : 5.5}
                      fill={stroke}
                      stroke="var(--bg, #fff)"
                      strokeWidth={2}
                      pointerEvents="none"
                    />
                    <line
                      x1={segment.startX}
                      y1={axisY}
                      x2={segment.startX}
                      y2={segment.markerY}
                      stroke={stroke}
                      strokeDasharray="2 3"
                      pointerEvents="none"
                    />
                    <circle
                      cx={segment.startX}
                      cy={segment.markerY}
                      r={18}
                      fill="transparent"
                      pointerEvents="all"
                    />
                  </>
                ) : (
                  <>
                    <line
                      data-segment-line="true"
                      x1={segment.startX}
                      y1={axisY}
                      x2={segment.endX}
                      y2={axisY}
                      stroke={stroke}
                      strokeWidth={selected ? 6 : 3}
                      strokeLinecap="round"
                      markerEnd={`url(#${selected ? selectedMarkerId : markerId})`}
                      pointerEvents="none"
                    />
                    <line
                      x1={Math.min(segment.startX, segment.endX)}
                      y1={axisY}
                      x2={Math.max(segment.startX, segment.endX)}
                      y2={axisY}
                      stroke="transparent"
                      strokeWidth={24}
                      strokeLinecap="round"
                      pointerEvents="stroke"
                    />
                    <circle
                      cx={segment.startX}
                      cy={axisY}
                      r={3}
                      fill={stroke}
                      pointerEvents="none"
                    />
                  </>
                )}

                <text
                  x={segment.labelX}
                  y={segment.labelY}
                  textAnchor="middle"
                  fill={stroke}
                  fontSize={13}
                  fontWeight={700}
                  pointerEvents="none"
                >
                  {segment.term.symbol}
                </text>
                <text
                  x={segment.labelX}
                  y={segment.labelY + 16}
                  textAnchor="middle"
                  fill={stroke}
                  fontSize={12}
                  fontFamily="var(--mono, ui-monospace, monospace)"
                  pointerEvents="none"
                >
                  {segment.labelText}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </figure>
  )
}
