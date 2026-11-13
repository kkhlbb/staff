/**
 * 隔套 A4 横向图纸生成器（V3-C-02）。
 *
 * 唯一生成器：已校验参数快照 + 固定模板 + 图框字段 + 比例 → DrawingData。
 * 固定输入产生稳定内容；时间与 ID 由调用方显式注入，这里不读系统时钟。
 *
 * 标注绑定 parameterId，数字统一走 resolveDimension；几何只由整数 q 换算，
 * 比例只作用于视图尺寸，不改参数、单位或输入精度。
 */
import { Q_PER_MM } from '../domain/types'
import { agentReadSources, readingSourceLabel } from '../sources/agentReadDisplay'
import { formatParameterValue, formatQWithDecimals, resolveDimension, dimensionText } from './formatDimension'
import { stableFingerprint } from './fingerprint'
import { computeLayout } from './layout'
import {
  A4_LANDSCAPE,
  DRAWING_DATA_VERSION,
  DRAWING_STYLES,
  DRAFT_STATUS_TEXT,
  MISSING_TEXT,
  SHEET_LAYOUT,
  SPACER_PARAMETER_IDS,
  SPACER_PART_ID,
  SPACER_TEMPLATE_ID,
  SPACER_TEMPLATE_VERSION,
  THIRD_ANGLE_PROJECTION,
  isAllowedScale,
  scaleKey,
  type CircleGeometry,
  type DimensionArrow,
  type DimensionGeometry,
  type DrawingAnnotation,
  type DrawingData,
  type DrawingFrame,
  type DrawingFrameFields,
  type DrawingPrimitive,
  type DrawingView,
  type LineGeometry,
  type ParameterSnapshotItem,
  type Point,
  type DrawingScale,
  type TextGeometry,
} from './types'
import { validateSpacerParameterSnapshot } from '../parts/spacerParameters'

export type DrawingBuildErrorCode =
  | 'INVALID_PARAMETER'
  | 'PART_NAME_REQUIRED'
  | 'INVALID_DRAWING'
  | 'DRAWING_OVERFLOW'

export class DrawingBuildError extends Error {
  readonly code: DrawingBuildErrorCode
  readonly detail?: string

  constructor(code: DrawingBuildErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'DrawingBuildError'
    this.code = code
    this.detail = detail
  }
}

export interface BuildSpacerDrawingInput {
  projectId: string
  revisionId: string
  drawingId: string
  parameters: readonly ParameterSnapshotItem[]
  scale: DrawingScale
  frameFields: DrawingFrameFields
  partId?: string
  /** Ring/parameter provenance collected by the project-level caller. */
  sourceProvenance?: readonly unknown[]
}

const FORBIDDEN_CLAIM = /已复核|已批准|符合\s*GB|符合\s*ISO/i

function qToMm(value: number): number {
  return value / Q_PER_MM
}

function round(value: number): number {
  // 纸面坐标保留 6 位，避免浮点噪声进入指纹/SVG；1e-6mm 远小于验收尺度。
  return Math.round(value * 1e6) / 1e6
}

function line(x1: number, y1: number, x2: number, y2: number): LineGeometry {
  return { x1: round(x1), y1: round(y1), x2: round(x2), y2: round(y2) }
}

function angleDeg(from: Point, to: Point): number {
  return round((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI)
}

function linePrimitive(
  primitiveId: string,
  viewId: string | undefined,
  geometry: LineGeometry,
  styleId: string,
  area: 'sheet' | 'drawing',
): DrawingPrimitive {
  return { primitiveId, ...(viewId === undefined ? {} : { viewId }), kind: 'line', geometryMm: geometry, styleId, area }
}

function textPrimitive(
  primitiveId: string,
  geometry: TextGeometry,
  styleId: string,
  area: 'sheet' | 'drawing',
  viewId?: string,
): DrawingPrimitive {
  return { primitiveId, ...(viewId === undefined ? {} : { viewId }), kind: 'text', geometryMm: geometry, styleId, area }
}

function normalizeField(
  value: string | undefined,
  label: string,
  missingFields: string[],
): string {
  const trimmed = (value ?? '').trim()
  if (trimmed === '') {
    missingFields.push(label)
    return MISSING_TEXT
  }
  return trimmed
}

/**
 * 标题栏版本栏的默认文字：可读的「草稿 · 第 N 版」。
 *
 * 序号由调用方在**生成时**算好并写进 `frameFields.version`（随图纸记录持久化），
 * 重建只读这个已保存的字符串，所以指纹稳定、不会因为版本数增长而自我不一致。
 * 拿不到序号时只写「草稿」——绝不把内部 revision UUID 印到图上。
 */
export function draftVersionText(ordinal?: number): string {
  return typeof ordinal === 'number' && Number.isInteger(ordinal) && ordinal > 0
    ? `草稿 · 第 ${ordinal} 版`
    : '草稿'
}

function buildFrame(
  fields: DrawingFrameFields,
  revisionId: string,
  scale: DrawingScale,
): DrawingFrame {
  const missingFields: string[] = []
  const partName = fields.partName.trim()
  if (partName === '') {
    throw new DrawingBuildError('PART_NAME_REQUIRED', '零件名不能为空')
  }
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string' && FORBIDDEN_CLAIM.test(value)) {
      throw new DrawingBuildError(
        'INVALID_DRAWING',
        '图框字段不得声明已复核/已批准或标准符合性',
        key,
      )
    }
  }
  const drawingNumber = normalizeField(fields.drawingNumber, '图号', missingFields)
  const material = normalizeField(fields.material, '材料', missingFields)
  const tolerance = normalizeField(fields.tolerance, '公差/配合', missingFields)
  const surface = normalizeField(fields.surface, '表面要求', missingFields)
  const drafter = normalizeField(fields.drafter, '制图人/日期', missingFields)
  // 旧记录（版本栏为空）保持既有回退文字：这些图纸的 dataFingerprint 是用这段文字算的，
  // 换掉会让已保存的旧项目打不开（重建指纹不一致）。新图由调用方在生成时写入
  // 「草稿 · 第 N 版」（见 draftVersionText），正常路径不会走到这里。
  const version = fields.version.trim() === '' ? `草稿 ${revisionId}` : fields.version.trim()
  const date = normalizeField(fields.date, '制图人/日期', [])

  const status = 'pending-review-draft' as const
  const cells: DrawingPrimitive[] = []
  const border = line(
    SHEET_LAYOUT.border.x1,
    SHEET_LAYOUT.border.y1,
    SHEET_LAYOUT.border.x2,
    SHEET_LAYOUT.border.y2,
  )
  cells.push({
    primitiveId: 'frame.border',
    kind: 'polyline',
    geometryMm: {
      points: [
        { x: SHEET_LAYOUT.border.x1, y: SHEET_LAYOUT.border.y1 },
        { x: SHEET_LAYOUT.border.x2, y: SHEET_LAYOUT.border.y1 },
        { x: SHEET_LAYOUT.border.x2, y: SHEET_LAYOUT.border.y2 },
        { x: SHEET_LAYOUT.border.x1, y: SHEET_LAYOUT.border.y2 },
        { x: SHEET_LAYOUT.border.x1, y: SHEET_LAYOUT.border.y1 },
      ],
    },
    styleId: 'frame',
    area: 'sheet',
  })
  cells.push({
    primitiveId: 'frame.title-block',
    kind: 'polyline',
    geometryMm: {
      points: [
        { x: SHEET_LAYOUT.titleBlock.x1, y: SHEET_LAYOUT.titleBlock.y1 },
        { x: SHEET_LAYOUT.titleBlock.x2, y: SHEET_LAYOUT.titleBlock.y1 },
        { x: SHEET_LAYOUT.titleBlock.x2, y: SHEET_LAYOUT.titleBlock.y2 },
        { x: SHEET_LAYOUT.titleBlock.x1, y: SHEET_LAYOUT.titleBlock.y2 },
        { x: SHEET_LAYOUT.titleBlock.x1, y: SHEET_LAYOUT.titleBlock.y1 },
      ],
    },
    styleId: 'frame',
    area: 'sheet',
  })
  cells.push({
    primitiveId: 'frame.tech-block',
    kind: 'polyline',
    geometryMm: {
      points: [
        { x: SHEET_LAYOUT.techBlock.x1, y: SHEET_LAYOUT.techBlock.y1 },
        { x: SHEET_LAYOUT.techBlock.x2, y: SHEET_LAYOUT.techBlock.y1 },
        { x: SHEET_LAYOUT.techBlock.x2, y: SHEET_LAYOUT.techBlock.y2 },
        { x: SHEET_LAYOUT.techBlock.x1, y: SHEET_LAYOUT.techBlock.y2 },
        { x: SHEET_LAYOUT.techBlock.x1, y: SHEET_LAYOUT.techBlock.y1 },
      ],
    },
    styleId: 'frame',
    area: 'sheet',
  })

  // 标题栏：表头 4mm + 9 行 × 4mm。
  const basis = typeof fields.basis === 'string' ? fields.basis.trim() : ''
  // 标题栏左列已经写“依据”，右列去掉重复前缀，避免出现“依据：依据：…”。
  const basisValue =
    basis.startsWith('依据：') ? basis.slice('依据：'.length) : basis
  const rows: [string, string][] = [
    ['零件名', partName],
    ['图号', drawingNumber],
    ['版本', version],
    ['材料', material],
    ['公差/配合', tolerance],
    ['表面要求', surface],
    ['制图人/日期', `${drafter} / ${date}`],
    ['比例/单位', `${scaleKey(scale)} · mm`],
    ['纸张/投影', `A4 横向 · 第三角`],
    ...(basisValue === '' ? [] : ([['依据', basisValue]] as [string, string][])),
  ]
  const headerBottom = SHEET_LAYOUT.titleBlock.y1 + 4
  cells.push(
    textPrimitive(
      'frame.title',
      {
        x: SHEET_LAYOUT.titleBlock.x1 + 2,
        y: headerBottom - 1.2,
        text: `寸链 · ${DRAFT_STATUS_TEXT}`,
        anchor: 'start',
        baseline: 'alphabetic',
      },
      'frame-text',
      'sheet',
    ),
  )
  const rowHeight = (SHEET_LAYOUT.titleBlock.y2 - headerBottom) / rows.length
  rows.forEach(([label, value], index) => {
    const top = headerBottom + rowHeight * index
    const baseline = top + rowHeight * 0.72
    cells.push(
      linePrimitive(
        `frame.row-line-${index}`,
        undefined,
        line(SHEET_LAYOUT.titleBlock.x1, top, SHEET_LAYOUT.titleBlock.x2, top),
        'frame-thin',
        'sheet',
      ),
    )
    cells.push(
      textPrimitive(
        `frame.cell-label-${index}`,
        { x: SHEET_LAYOUT.titleBlock.x1 + 2, y: baseline, text: label, anchor: 'start', baseline: 'alphabetic' },
        'frame-text',
        'sheet',
      ),
      textPrimitive(
        `frame.cell-value-${index}`,
        { x: SHEET_LAYOUT.titleBlock.x1 + 26, y: baseline, text: value, anchor: 'start', baseline: 'alphabetic' },
        'frame-text',
        'sheet',
      ),
    )
  })

  // 技术要求/缺项区。
  const techLines = [
    '技术要求 / 缺项',
    '1. 本图为待复核草稿：未复核、未批准。',
    '2. 未注公差、配合与表面要求：待补充。',
    '3. 材料、图号、制图人/日期：待补充。',
    '4. 不声明符合 GB/ISO 等制图标准。',
    '5. 单位 mm；比例只作用于视图几何。',
    ...(basis === '' ? [] : [`6. ${basis}。`]),
  ]
  techLines.forEach((text, index) => {
    cells.push(
      textPrimitive(
        `frame.tech-${index}`,
        {
          x: SHEET_LAYOUT.techBlock.x1 + 3,
          y: SHEET_LAYOUT.techBlock.y1 + 6 + index * 5,
          text,
          anchor: 'start',
          baseline: 'alphabetic',
        },
        index === 0 ? 'frame-text-strong' : 'frame-text',
        'sheet',
      ),
    )
  })

  cells.push(
    textPrimitive(
      'sheet.status',
      {
        x: 148.5,
        y: 16,
        text: `${DRAFT_STATUS_TEXT} · 未复核、未批准`,
        anchor: 'middle',
        baseline: 'alphabetic',
      },
      'sheet-status',
      'sheet',
    ),
  )

  return {
    borderMm: border,
    cells,
    fields: {
      partName,
      drawingNumber,
      version,
      material,
      tolerance,
      surface,
      drafter,
      date,
      scale: scaleKey(scale),
      unit: 'mm',
      paper: 'A4 横向',
      projection: '第三角',
      status: DRAFT_STATUS_TEXT,
      ...(basis === '' ? {} : { basis }),
    },
    missingFields,
    status,
  }
}

function diameterLeader(
  circle: { cx: number; cy: number; r: number },
  direction: 'up-right' | 'down-left',
): { lines: LineGeometry[]; arrow: DimensionArrow; end: Point; textAnchor: 'start' | 'end'; textAt: Point } {
  const sign = direction === 'up-right' ? 1 : -1
  const p0: Point = {
    x: circle.cx + sign * circle.r * Math.SQRT1_2,
    y: circle.cy - sign * circle.r * Math.SQRT1_2,
  }
  const elbow: Point = {
    x: circle.cx + sign * (circle.r + 8),
    y: circle.cy - sign * (circle.r + 8),
  }
  const end: Point = { x: elbow.x + sign * 8, y: elbow.y }
  const textAt: Point =
    direction === 'up-right'
      ? { x: end.x + 1, y: end.y + 1.2 }
      : { x: end.x - 1, y: end.y + 1.2 }
  return {
    lines: [line(p0.x, p0.y, elbow.x, elbow.y), line(elbow.x, elbow.y, end.x, end.y)],
    arrow: { at: { x: round(p0.x), y: round(p0.y) }, angleDeg: angleDeg(p0, { x: circle.cx, y: circle.cy }) },
    end,
    textAnchor: direction === 'up-right' ? 'start' : 'end',
    textAt,
  }
}

export function buildSpacerDrawing(input: BuildSpacerDrawingInput): DrawingData {
  if (input.partId !== undefined && input.partId !== SPACER_PART_ID) {
    throw new DrawingBuildError('INVALID_PARAMETER', `图纸部件必须是隔套：${input.partId}`)
  }
  if (!isAllowedScale(input.scale)) {
    throw new DrawingBuildError('INVALID_PARAMETER', '未登记的比例', scaleKey(input.scale))
  }
  const validated = validateSpacerParameterSnapshot(input.parameters)
  if (!validated.ok) {
    throw new DrawingBuildError('INVALID_PARAMETER', validated.message)
  }
  const parameters = validated.parameters.map((parameter) => {
    const provenance = input.parameters.find((item) => item.parameterId === parameter.parameterId)?.provenance
    return provenance === undefined ? parameter : { ...parameter, provenance }
  })
  const byKey = new Map(parameters.map((item) => [item.key, item]))
  const inner = byKey.get('innerDiameter') as ParameterSnapshotItem
  const outer = byKey.get('outerDiameter') as ParameterSnapshotItem
  const length = byKey.get('length') as ParameterSnapshotItem

  const scaleFactor = input.scale.numerator / input.scale.denominator
  const halfLengthMm = (qToMm(length.valueQ) * scaleFactor) / 2
  const innerRadiusMm = (qToMm(inner.valueQ) * scaleFactor) / 2
  const outerRadiusMm = (qToMm(outer.valueQ) * scaleFactor) / 2
  if (![halfLengthMm, innerRadiusMm, outerRadiusMm].every((value) => Number.isFinite(value) && value > 0)) {
    throw new DrawingBuildError('INVALID_PARAMETER', '缩放后的几何尺寸不合法')
  }

  const axial = SHEET_LAYOUT.axialCenter
  const end = SHEET_LAYOUT.endCenter
  const x1 = axial.x - halfLengthMm
  const x2 = axial.x + halfLengthMm
  const yTop = axial.y - outerRadiusMm
  const yBottom = axial.y + outerRadiusMm

  const primitives: DrawingPrimitive[] = []
  const axialViewId = 'view:axial'
  const endViewId = 'view:right-end'

  primitives.push({
    primitiveId: 'axial.outline',
    viewId: axialViewId,
    kind: 'polyline',
    geometryMm: {
      points: [
        { x: round(x1), y: round(yTop) },
        { x: round(x2), y: round(yTop) },
        { x: round(x2), y: round(yBottom) },
        { x: round(x1), y: round(yBottom) },
        { x: round(x1), y: round(yTop) },
      ],
    },
    styleId: 'outline',
    area: 'drawing',
  })
  primitives.push(
    linePrimitive('axial.hidden.top', axialViewId, line(x1, axial.y - innerRadiusMm, x2, axial.y - innerRadiusMm), 'hidden', 'drawing'),
    linePrimitive('axial.hidden.bottom', axialViewId, line(x1, axial.y + innerRadiusMm, x2, axial.y + innerRadiusMm), 'hidden', 'drawing'),
    linePrimitive('axial.center', axialViewId, line(x1 - 4, axial.y, x2 + 4, axial.y), 'center', 'drawing'),
  )

  const circle = (id: string, radius: number): DrawingPrimitive => ({
    primitiveId: id,
    viewId: endViewId,
    kind: 'circle',
    geometryMm: { cx: end.x, cy: end.y, r: round(radius) } satisfies CircleGeometry,
    styleId: 'outline',
    area: 'drawing',
  })
  primitives.push(circle('end.outer', outerRadiusMm), circle('end.inner', innerRadiusMm))
  primitives.push(
    linePrimitive('end.center.h', endViewId, line(end.x - outerRadiusMm - 4, end.y, end.x + outerRadiusMm + 4, end.y), 'center', 'drawing'),
    linePrimitive('end.center.v', endViewId, line(end.x, end.y - outerRadiusMm - 4, end.x, end.y + outerRadiusMm + 4), 'center', 'drawing'),
  )

  primitives.push(
    textPrimitive(
      'note.projection',
      {
        x: 148.5,
        y: 148,
        text: THIRD_ANGLE_PROJECTION.label,
        anchor: 'middle',
        baseline: 'alphabetic',
      },
      'drawing-note',
      'drawing',
    ),
  )

  // 长度标注：界线自轮廓下缘引出，尺寸线距轮廓固定 14mm。
  const dimensionY = yBottom + 14
  const lengthGeometry: DimensionGeometry = {
    lines: [
      line(x1, yBottom + 1, x1, dimensionY + 2),
      line(x2, yBottom + 1, x2, dimensionY + 2),
      line(x1, dimensionY, x2, dimensionY),
    ],
    arrows: [
      { at: { x: round(x1), y: round(dimensionY) }, angleDeg: 180 },
      { at: { x: round(x2), y: round(dimensionY) }, angleDeg: 0 },
    ],
  }

  const innerLeader = diameterLeader({ cx: end.x, cy: end.y, r: innerRadiusMm }, 'down-left')
  const outerLeader = diameterLeader({ cx: end.x, cy: end.y, r: outerRadiusMm }, 'up-right')

  const annotations: DrawingAnnotation[] = [
    {
      annotationId: 'ann.length',
      parameterId: length.parameterId,
      viewId: axialViewId,
      kind: 'length',
      dimensionGeometryMm: lengthGeometry,
      textPositionMm: { x: round((x1 + x2) / 2), y: round(dimensionY - 1.2) },
      textAnchor: 'middle',
      styleId: 'dim',
    },
    {
      annotationId: 'ann.inner-diameter',
      parameterId: inner.parameterId,
      viewId: endViewId,
      kind: 'diameter',
      dimensionGeometryMm: { lines: innerLeader.lines.map((item) => ({ ...item })), arrows: [innerLeader.arrow] },
      textPositionMm: { x: round(innerLeader.textAt.x), y: round(innerLeader.textAt.y) },
      textAnchor: innerLeader.textAnchor,
      styleId: 'dim',
    },
    {
      annotationId: 'ann.outer-diameter',
      parameterId: outer.parameterId,
      viewId: endViewId,
      kind: 'diameter',
      dimensionGeometryMm: { lines: outerLeader.lines.map((item) => ({ ...item })), arrows: [outerLeader.arrow] },
      textPositionMm: { x: round(outerLeader.textAt.x), y: round(outerLeader.textAt.y) },
      textAnchor: outerLeader.textAnchor,
      styleId: 'dim',
    },
  ]

  // 标注文字必须由 parameterId + 快照解析；解析失败直接拒绝生成。
  const annotationTexts: Record<string, string> = {}
  for (const annotation of annotations) {
    const resolved = resolveDimension(annotation.parameterId, parameters)
    if (!resolved.ok) {
      throw new DrawingBuildError('INVALID_DRAWING', resolved.message)
    }
    // layout 是持久化指纹的一部分，保留按输入精度计算的既有布局度量。
    // 可见标注由 renderDrawingSvg / annotationTextsOf 经 formatMm 单独生成。
    const layoutText = formatQWithDecimals(resolved.value.valueQ, resolved.value.inputDecimals)!
    annotationTexts[annotation.annotationId] = annotation.kind === 'diameter' ? `⌀${layoutText}` : layoutText
  }

  const views: DrawingView[] = [
    { viewId: axialViewId, kind: 'axial', anchorMm: { ...axial }, scaleFactor, primitiveIds: ['axial.outline', 'axial.hidden.top', 'axial.hidden.bottom', 'axial.center'] },
    { viewId: endViewId, kind: 'right-end', anchorMm: { ...end }, scaleFactor, primitiveIds: ['end.outer', 'end.inner', 'end.center.h', 'end.center.v'] },
  ]

  const readings = agentReadSources([
    ...(input.sourceProvenance ?? []),
    ...parameters.flatMap((parameter) => parameter.provenance ?? []),
  ])
  const readingBasis = [...new Set(readings.map(readingSourceLabel))].join('；')
  const frameFields = readingBasis === '' ? input.frameFields : {
    ...input.frameFields,
    basis: [input.frameFields.basis, `读数来源：${readingBasis}`].filter(Boolean).join('；'),
  }
  const frame = buildFrame(frameFields, input.revisionId, input.scale)
  primitives.push(...frame.cells)

  const layout = computeLayout({
    primitives,
    annotations,
    annotationTexts,
    drawableRect: { ...SHEET_LAYOUT.drawable },
    fontSizeMm: DRAWING_STYLES.fontSizeMm,
  })
  if (!layout.fits) {
    throw new DrawingBuildError(
      'DRAWING_OVERFLOW',
      '当前比例无法容纳图纸，请选择更小比例',
      layout.conflicts.slice(0, 4).join('；'),
    )
  }

  const parameterFingerprint = stableFingerprint(parameters)
  const modelRevisionId = `parametric-spacer:${SPACER_TEMPLATE_ID}:${parameterFingerprint.slice(0, 16)}`
  const withoutFingerprint: Omit<DrawingData, 'fingerprint'> = {
    drawingDataVersion: DRAWING_DATA_VERSION,
    drawingId: input.drawingId,
    projectId: input.projectId,
    revisionId: input.revisionId,
    partId: SPACER_PART_ID,
    templateId: SPACER_TEMPLATE_ID,
    templateVersion: SPACER_TEMPLATE_VERSION,
    parameterSnapshot: parameters,
    modelRef: {
      kind: 'parametric-spacer' as const,
      modelRevisionId,
      parameterFingerprint,
    },
    paper: { ...A4_LANDSCAPE },
    scale: { ...input.scale },
    projection: { ...THIRD_ANGLE_PROJECTION },
    views,
    primitives,
    annotations,
    frame,
    styles: DRAWING_STYLES,
    layout,
  }
  const fingerprint = stableFingerprint(withoutFingerprint)
  return { ...withoutFingerprint, fingerprint }
}

/** 生成时展示用：用同一解析器给出所有标注文字，供 UI 与测试核对。 */
export function annotationTextsOf(data: DrawingData): Record<string, string> {
  const texts: Record<string, string> = {}
  for (const annotation of data.annotations) {
    const resolved = resolveDimension(annotation.parameterId, data.parameterSnapshot)
    if (!resolved.ok) continue
    texts[annotation.annotationId] = dimensionText(resolved.value, annotation.kind)
  }
  return texts
}

/** 供属性栏显示：参数值与显示文字都取自快照，不读几何。 */
export function parameterRows(data: DrawingData): {
  parameterId: string
  key: string
  valueQ: number
  inputDecimals: number
  valueText: string
  sourceNote: string
}[] {
  return data.parameterSnapshot.map((item) => ({
    parameterId: item.parameterId,
    key: item.key,
    valueQ: item.valueQ,
    inputDecimals: item.inputDecimals,
    valueText: formatParameterValue(item.valueQ, item.inputDecimals) ?? '数据不一致',
    sourceNote: item.sourceNote ?? '',
  }))
}

export { SPACER_PARAMETER_IDS, SPACER_PART_ID }
