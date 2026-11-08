/**
 * PDF 坐标 ↔ viewport（CSS 像素）坐标转换。
 *
 * pdfjs-dist 6.5.438 的 PageViewport 只有 convertToViewportPoint /
 * convertToPdfPoint，没有 convertToViewportRectangle（v6.1.200 起移除）。
 * 因此矩形一律保存“未旋转 PDF 空间”的两个对角点，显示时分别转换两个对角点，
 * 再用 min/max 合成 minX/minY/maxX/maxY。页面旋转 90/270 度时两个点的先后
 * 顺序会颠倒，直接相减会得到负宽高，必须用 min/max。
 *
 * 持久化只允许 PDF 点。屏幕像素、CSS 尺寸与 DPR 属于显示层，不进入存储。
 */

/** [x1, y1, x2, y2]；两点是对角点，顺序不保证，使用前一律 normalize。 */
export type PdfRect = readonly [number, number, number, number]
export type PdfPoint = readonly [number, number]
/** 页面未旋转时的 PDF 尺寸 [width, height]。 */
export type PdfPageSize = readonly [number, number]

/** 浮点往返与页边贴边判断的容差（PDF 点，远小于 1 CSS 像素）。 */
export const PDF_COORD_EPSILON = 1e-6

export interface PageViewportLike {
  convertToViewportPoint: (x: number, y: number) => readonly number[]
  convertToPdfPoint: (x: number, y: number) => readonly number[]
}

function assertPoint(point: readonly number[], label: string): PdfPoint {
  const [x, y] = point
  if (typeof x !== 'number' || typeof y !== 'number') {
    throw new Error(`${label} 未返回数值坐标`)
  }
  return [x, y]
}

/** 把任意顺序的两个对角点规范化为 [minX, minY, maxX, maxY]。 */
export function normalizePdfRect(rect: PdfRect): PdfRect {
  const [x1, y1, x2, y2] = rect
  return [
    Math.min(x1, x2),
    Math.min(y1, y2),
    Math.max(x1, x2),
    Math.max(y1, y2),
  ]
}

export function pdfPointToViewportPoint(
  viewport: PageViewportLike,
  point: PdfPoint,
): PdfPoint {
  return assertPoint(
    viewport.convertToViewportPoint(point[0], point[1]),
    'convertToViewportPoint',
  )
}

export function viewportPointToPdfPoint(
  viewport: PageViewportLike,
  point: PdfPoint,
): PdfPoint {
  return assertPoint(
    viewport.convertToPdfPoint(point[0], point[1]),
    'convertToPdfPoint',
  )
}

/**
 * PDF 矩形 → viewport 矩形（CSS 像素，左上原点）。
 * 两个对角点各自转换后取 min/max，因此输入角点顺序与页面旋转都不会影响结果。
 */
export function pdfRectToViewportRect(
  viewport: PageViewportLike,
  rect: PdfRect,
): PdfRect {
  const [x1, y1, x2, y2] = rect
  const cornerA = pdfPointToViewportPoint(viewport, [x1, y1])
  const cornerB = pdfPointToViewportPoint(viewport, [x2, y2])
  return [
    Math.min(cornerA[0], cornerB[0]),
    Math.min(cornerA[1], cornerB[1]),
    Math.max(cornerA[0], cornerB[0]),
    Math.max(cornerA[1], cornerB[1]),
  ]
}

/**
 * viewport 矩形 → PDF 矩形，返回规范化后的 [minX, minY, maxX, maxY]。
 * 交互（框选）时用这个函数写入存储。
 */
export function viewportRectToPdfRect(
  viewport: PageViewportLike,
  rect: PdfRect,
): PdfRect {
  const [x1, y1, x2, y2] = rect
  const cornerA = viewportPointToPdfPoint(viewport, [x1, y1])
  const cornerB = viewportPointToPdfPoint(viewport, [x2, y2])
  return normalizePdfRect([cornerA[0], cornerA[1], cornerB[0], cornerB[1]])
}

/**
 * 页码从 1 开始。返回 null 表示合法，否则返回面向用户的错误说明。
 */
export function validatePageNumber(
  page: number,
  pageCount: number,
): string | null {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return '文档页数无效'
  }
  if (!Number.isInteger(page)) {
    return '页码必须是整数'
  }
  if (page < 1) {
    return '页码从 1 开始'
  }
  if (page > pageCount) {
    return `页码超出范围：文档共 ${pageCount} 页`
  }
  return null
}

/**
 * 校验 PDF 空间矩形：坐标有限、面积大于 0、不越出页面边界。
 * 输入角点顺序任意；反向角点会先规范化再判断。
 */
export function validatePdfRect(
  rect: PdfRect,
  pageSizePdf: PdfPageSize,
): string | null {
  if (rect.length !== 4 || !rect.every((value) => Number.isFinite(value))) {
    return '矩形坐标必须是 4 个有限数值'
  }
  const [width, height] = pageSizePdf
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '页面尺寸无效'
  }

  const [minX, minY, maxX, maxY] = normalizePdfRect(rect)
  if (
    maxX - minX <= PDF_COORD_EPSILON ||
    maxY - minY <= PDF_COORD_EPSILON
  ) {
    return '矩形面积必须大于 0'
  }
  if (
    minX < -PDF_COORD_EPSILON ||
    minY < -PDF_COORD_EPSILON ||
    maxX > width + PDF_COORD_EPSILON ||
    maxY > height + PDF_COORD_EPSILON
  ) {
    return '矩形超出页面边界'
  }
  return null
}
