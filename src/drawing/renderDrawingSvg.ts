/**
 * 唯一 SVG 序列化器（V3-C-02，红线段 1）。
 *
 * 预览、SVG 文件导出、PDF 打印页都调用这一个函数；任何一路都不允许再用三参数
 * 或 HTML/CSS 手画另一套线，也不允许截图/整页位图。
 *
 * 安全边界：只输出白名单图元；文本 XML 转义；禁止 script/foreignObject/image、
 * 事件属性、外链 href、CSS url() 与远程字体。字体只按 family 引用（打印页在
 * HTML 层用内嵌子集 @font-face 提供），SVG 文件本身零外部依赖。
 */
import { dimensionText, resolveDimension } from './formatDimension'
import { DRAFT_STATUS_TEXT, SPACER_PARAMETER_LABELS } from './types'
import type {
  CircleGeometry,
  DrawingAnnotation,
  DrawingData,
  DrawingPrimitive,
  LineGeometry,
  Point,
  PolylineGeometry,
  TextGeometry,
} from './types'

export interface SvgRenderOptions {
  /** 仅预览用：加高亮类；导出必须不传，保证与预览的规范化图元一致。 */
  selectedAnnotationId?: string | null
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function number(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`SVG 坐标必须是有限数值，收到 ${String(value)}`)
  }
  return String(Math.round(value * 1e6) / 1e6)
}

function pointList(points: readonly Point[]): string {
  return points.map((point) => `${number(point.x)},${number(point.y)}`).join(' ')
}

const STYLE_CLASS: Record<string, string> = {
  frame: 's-frame',
  'frame-thin': 's-frame-thin',
  outline: 's-outline',
  center: 's-center',
  hidden: 's-hidden',
  dim: 's-dim',
}

const TEXT_CLASS: Record<string, string> = {
  'frame-text': 't-frame',
  'frame-text-strong': 't-frame-strong',
  'sheet-status': 't-status',
  'drawing-note': 't-note',
}

function styleAttribute(styleId: string): string {
  const className = STYLE_CLASS[styleId]
  if (className === undefined) {
    throw new Error(`未知线型样式：${styleId}`)
  }
  return `class="${className}"`
}

function renderPrimitive(primitive: DrawingPrimitive): string {
  if (primitive.kind === 'line') {
    const geometry = primitive.geometryMm as LineGeometry
    return `<line x1="${number(geometry.x1)}" y1="${number(geometry.y1)}" x2="${number(geometry.x2)}" y2="${number(geometry.y2)}" ${styleAttribute(primitive.styleId)}/>`
  }
  if (primitive.kind === 'circle') {
    const geometry = primitive.geometryMm as CircleGeometry
    return `<circle cx="${number(geometry.cx)}" cy="${number(geometry.cy)}" r="${number(geometry.r)}" ${styleAttribute(primitive.styleId)}/>`
  }
  if (primitive.kind === 'polyline') {
    const geometry = primitive.geometryMm as PolylineGeometry
    return `<polyline points="${pointList(geometry.points)}" ${styleAttribute(primitive.styleId)}/>`
  }
  if (primitive.kind === 'text') {
    const geometry = primitive.geometryMm as TextGeometry
    const className = TEXT_CLASS[primitive.styleId]
    if (className === undefined) {
      throw new Error(`未知文字样式：${primitive.styleId}`)
    }
    return `<text x="${number(geometry.x)}" y="${number(geometry.y)}" text-anchor="${geometry.anchor}" dominant-baseline="alphabetic" class="${className}">${escapeXml(geometry.text)}</text>`
  }
  throw new Error(`未知图元类型：${String((primitive as { kind?: unknown }).kind)}`)
}

function renderAnnotation(
  annotation: DrawingAnnotation,
  data: DrawingData,
  selected: boolean,
): string {
  const resolved = resolveDimension(annotation.parameterId, data.parameterSnapshot)
  if (!resolved.ok) {
    throw new Error(`标注数字无法解析：${resolved.message}`)
  }
  const text = dimensionText(resolved.value, annotation.kind)
  const label = annotation.kind === 'diameter' ? '直径' : '长度'
  const className = selected ? 'annotation is-selected' : 'annotation'
  const lines = annotation.dimensionGeometryMm.lines
    .map(
      (line) =>
        `<line x1="${number(line.x1)}" y1="${number(line.y1)}" x2="${number(line.x2)}" y2="${number(line.y2)}" class="s-dim"/>`,
    )
    .join('')
  const arrows = annotation.dimensionGeometryMm.arrows
    .map((arrow) => {
      const radians = (arrow.angleDeg * Math.PI) / 180
      const dx = Math.cos(radians) * 0.01
      const dy = Math.sin(radians) * 0.01
      return `<path d="M ${number(arrow.at.x)} ${number(arrow.at.y)} l ${number(dx)} ${number(dy)}" class="s-arrow" marker-end="url(#arrow-head)"/>`
    })
    .join('')
  return `<g class="${className}" data-annotation-id="${escapeXml(annotation.annotationId)}" data-parameter-id="${escapeXml(annotation.parameterId)}" data-kind="${annotation.kind}" tabindex="0" role="button" aria-label="${escapeXml(`${label}标注 ${text}，点击定位参数`)}"><title>${escapeXml(`${label} ${text}（点击定位参数）`)}</title>${lines}${arrows}<text x="${number(annotation.textPositionMm.x)}" y="${number(annotation.textPositionMm.y)}" text-anchor="${annotation.textAnchor}" dominant-baseline="alphabetic" class="t-dim">${escapeXml(text)}</text></g>`
}

function buildStyleSheet(data: DrawingData): string {
  const widths = data.styles.lineWidthsMm
  return [
    `text{font-family:'Noto Sans SC Cunlian','Noto Sans Math Cunlian','Noto Sans SC','PingFang SC',sans-serif;fill:#000000}`,
    `.s-frame{fill:none;stroke:#000000;stroke-width:${widths.frame};stroke-linejoin:miter}`,
    `.s-frame-thin{fill:none;stroke:#000000;stroke-width:0.25}`,
    `.s-outline{fill:none;stroke:#000000;stroke-width:${widths.outline};stroke-linejoin:miter;stroke-linecap:butt}`,
    `.s-center{fill:none;stroke:#000000;stroke-width:${widths.center};stroke-dasharray:${data.styles.dashPatternsMm.center.join(' ')};stroke-linecap:butt}`,
    `.s-hidden{fill:none;stroke:#000000;stroke-width:${widths.hidden};stroke-dasharray:${data.styles.dashPatternsMm.hidden.join(' ')};stroke-linecap:butt}`,
    `.s-dim{fill:none;stroke:#000000;stroke-width:${widths.dim};stroke-linecap:butt}`,
    `.s-arrow{fill:none;stroke:#000000;stroke-width:${widths.dim}}`,
    `.t-frame{font-size:3px}`,
    `.t-frame-strong{font-size:3.2px}`,
    `.t-status{font-size:4px;font-weight:500}`,
    `.t-note{font-size:3.5px}`,
    `.t-dim{font-size:${data.styles.fontSizeMm}px}`,
    `.annotation .s-dim{stroke:#000000;fill:none}`,
    `.annotation .t-dim{fill:#000000;stroke:none}`,
    `.annotation:focus{outline:none}`,
    `.annotation.is-selected .s-dim{stroke:#4338ca;stroke-width:0.5}`,
    `.annotation.is-selected .s-arrow{stroke:#4338ca}`,
    `.annotation.is-selected .t-dim{fill:#4338ca}`,
    `@media print{.annotation{pointer-events:none}}`,
  ].join('\n')
}

/**
 * 序列化 DrawingData。输出只依赖数据本身（selectedAnnotationId 只影响高亮类），
 * 不含时间、随机数或环境信息，同一份数据得到同一份 SVG。
 */
export function renderDrawingSvg(data: DrawingData, options: SvgRenderOptions = {}): string {
  if (data.paper.format !== 'A4' || data.paper.orientation !== 'landscape') {
    throw new Error('C 首版只支持 A4 横向')
  }
  const selected = options.selectedAnnotationId ?? null
  const annotations = data.annotations
    .map((annotation) => renderAnnotation(annotation, data, annotation.annotationId === selected))
    .join('')
  const metadata = escapeXml(
    JSON.stringify({
      drawingId: data.drawingId,
      drawingFingerprint: data.fingerprint,
      drawingDataVersion: data.drawingDataVersion,
      templateId: data.templateId,
      templateVersion: data.templateVersion,
      scale: `${data.scale.numerator}:${data.scale.denominator}`,
      status: DRAFT_STATUS_TEXT,
      parameterIds: data.parameterSnapshot.map((item) => item.parameterId),
    }),
  )
  const basis = typeof data.frame.fields.basis === 'string' ? data.frame.fields.basis : ''
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    ...(basis === '' ? [] : [`<!-- ${basis} -->`]),
    `<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210" version="1.1" data-drawing-id="${escapeXml(data.drawingId)}" data-drawing-fingerprint="${escapeXml(data.fingerprint)}">`,
    `<metadata id="drawing-metadata">${metadata}</metadata>`,
    '<defs>',
    `<marker id="arrow-head" markerWidth="${data.styles.arrow.lengthMm}" markerHeight="${data.styles.arrow.widthMm}" refX="0" refY="0" viewBox="-${data.styles.arrow.lengthMm} -${data.styles.arrow.widthMm / 2} ${data.styles.arrow.lengthMm} ${data.styles.arrow.widthMm}" orient="auto" markerUnits="userSpaceOnUse" overflow="visible"><path d="M0,0 L-${data.styles.arrow.lengthMm},${data.styles.arrow.widthMm / 2} L-${data.styles.arrow.lengthMm},-${data.styles.arrow.widthMm / 2} Z" fill="#000000"/></marker>`,
    `<style>${buildStyleSheet(data)}</style>`,
    '</defs>',
    '<g id="sheet-frame">',
    data.primitives.filter((primitive) => primitive.area === 'sheet').map(renderPrimitive).join(''),
    '</g>',
    '<g id="drawing-geometry">',
    data.primitives.filter((primitive) => primitive.area === 'drawing').map(renderPrimitive).join(''),
    '</g>',
    '<g id="dimensions">',
    annotations,
    '</g>',
    '</svg>',
  ].join('\n')
}

export interface SvgValidation {
  ok: boolean
  errors: string[]
}

/** 导出前结构校验；不是只检查文件非空。 */
export function validateDrawingSvgMarkup(markup: string, expected: DrawingData): SvgValidation {
  const errors: string[] = []
  if (!markup.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) {
    errors.push('缺少 XML 声明')
  }
  if (!markup.includes('width="297mm" height="210mm" viewBox="0 0 297 210"')) {
    errors.push('纸张尺寸/viewBox 不是 297×210mm')
  }
  if (!markup.includes(`data-drawing-fingerprint="${expected.fingerprint}"`)) {
    errors.push('SVG 缺少当前图纸指纹')
  }
  if (/<script|<foreignObject|<image/i.test(markup)) {
    errors.push('SVG 含禁止的 script/foreignObject/image 元素')
  }
  if (/\son[a-z]+\s*=/i.test(markup)) {
    errors.push('SVG 含事件属性')
  }
  if (/\s(?:href|src)\s*=\s*"(?!#)/i.test(markup)) {
    errors.push('SVG 含外链 href/src')
  }
  if (/url\s*\(\s*(?!['"]?#)/i.test(markup)) {
    errors.push('SVG 含非本地 CSS url()')
  }
  if (/@font-face|@import/i.test(markup)) {
    errors.push('SVG 不得携带外部字体/CSS 导入')
  }
  for (const annotation of expected.annotations) {
    const resolved = resolveDimension(annotation.parameterId, expected.parameterSnapshot)
    const text = resolved.ok ? dimensionText(resolved.value, annotation.kind) : null
    if (text === null || !markup.includes(`>${escapeXml(text)}</text>`)) {
      errors.push(`SVG 缺少标注文字：${annotation.annotationId}`)
    }
    if (!markup.includes(`data-parameter-id="${escapeXml(annotation.parameterId)}"`)) {
      errors.push(`SVG 缺少参数绑定：${annotation.annotationId}`)
    }
  }
  if (!markup.includes(DRAFT_STATUS_TEXT)) {
    errors.push('SVG 缺少待复核草稿状态文字')
  }
  if (/已复核|已批准/.test(markup)) {
    errors.push('SVG 出现已复核/已批准字样')
  }
  return { ok: errors.length === 0, errors }
}

/** 预览与导出的规范化比较基准：去掉缩进空白后逐字节比较。 */
export function canonicalizeSvg(markup: string): string {
  return markup.replace(/>\s+</g, '><').trim()
}

export const SVG_FONT_FAMILY =
  "'Noto Sans SC Cunlian','Noto Sans Math Cunlian','Noto Sans SC','PingFang SC',sans-serif"
export const PARAMETER_LABELS = SPACER_PARAMETER_LABELS
