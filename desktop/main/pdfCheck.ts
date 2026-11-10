/**
 * PDF 结构校验（V3-C-04）：不是只看文件头或“文件非空”。
 *
 * 解析实际字节里的页面字典与字体资源：
 * - 恰好 1 页；
 * - MediaBox/CropBox/Rotate 换算后的有效页面为 A4 横向 841.89×595.28pt（±1pt）；
 * - 至少一个嵌入字体（FontFile2/FontFile3），并记录 BaseFont；
 * - 不得是整页位图（拒绝 /Subtype /Image 作为唯一内容）；
 * - 内容流解压后包含矢量路径/文字操作符。
 */
import { inflateSync } from 'node:zlib'

export interface PdfFontInfo {
  baseFont: string
  embedded: boolean
  subtype: string | null
}

export interface PdfCheckResult {
  ok: boolean
  errors: string[]
  pageCount: number
  mediaBox: [number, number, number, number] | null
  cropBox: [number, number, number, number] | null
  rotate: number
  effectiveWidthPt: number | null
  effectiveHeightPt: number | null
  fonts: PdfFontInfo[]
  embeddedFontCount: number
  imageCount: number
  vectorOperatorCount: number
  hasTextOperator: boolean
}

const A4_LANDSCAPE_WIDTH_PT = 841.8897637795
const A4_LANDSCAPE_HEIGHT_PT = 595.2755905512
const PAGE_TOLERANCE_PT = 1

function parseBox(text: string, key: string): [number, number, number, number] | null {
  const match = new RegExp(`/${key}\\s*\\[\\s*([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s*\\]`).exec(
    text,
  )
  if (match === null) return null
  const values = match.slice(1, 5).map(Number)
  if (values.some((value) => !Number.isFinite(value))) return null
  return values as [number, number, number, number]
}

/** 解析 /Type /Page（不是 /Pages）的个数。 */
function countPages(text: string): number {
  const matches = text.match(/\/Type\s*\/Page(?![sA-Za-z])/g)
  return matches === null ? 0 : matches.length
}

function findRotate(text: string): number {
  const match = /\/Rotate\s+(-?\d+)/.exec(text)
  return match === null ? 0 : Number(match[1])
}

/** 收集普通对象里的字体字典；对象流（ObjStm）里的字体需要解压后再看。 */
function collectFonts(allText: string): PdfFontInfo[] {
  const fonts: PdfFontInfo[] = []
  const fontDictPattern = /\/Type\s*\/Font[\s\S]{0,600}?\/BaseFont\s*\/([^\s/<>()[\]]+)/g
  let match: RegExpExecArray | null
  while ((match = fontDictPattern.exec(allText)) !== null) {
    const start = Math.max(0, match.index)
    const windowText = allText.slice(start, start + 1200)
    const subtype = /\/Subtype\s*\/(Type0|TrueType|CIDFontType0|CIDFontType2|Type1|Type3)/.exec(
      windowText,
    )?.[1]
    const embedded = /\/FontFile[23]?\s/.test(windowText)
    fonts.push({ baseFont: match[1], embedded, subtype: subtype ?? null })
  }
  return fonts
}

/** 把文件里所有 FlateDecode 流解压后拼起来，用于找对象流里的字体与内容操作符。 */
function decompressedStreams(bytes: Uint8Array): string {
  const latin = Buffer.from(bytes).toString('latin1')
  const chunks: string[] = []
  const streamPattern = /stream\r?\n/g
  let match: RegExpExecArray | null
  while ((match = streamPattern.exec(latin)) !== null) {
    const start = match.index + match[0].length
    const end = latin.indexOf('endstream', start)
    if (end < 0) break
    const raw = Buffer.from(bytes.subarray(start, end))
    try {
      chunks.push(inflateSync(raw).toString('latin1'))
    } catch {
      // 未压缩的流（或非 Flate 编码）直接按 latin1 参与操作符统计。
      chunks.push(raw.toString('latin1'))
    }
  }
  return chunks.join('\n')
}

export function checkPdf(bytes: Uint8Array): PdfCheckResult {
  const errors: string[] = []
  const text = Buffer.from(bytes).toString('latin1')
  if (!text.startsWith('%PDF-')) {
    errors.push('不是 PDF 文件（缺少 %PDF- 头）')
  }
  if (bytes.byteLength === 0) {
    errors.push('PDF 为空')
  }
  if (!text.includes('%%EOF')) {
    errors.push('缺少 %%EOF 结束标记')
  }

  const pageCount = countPages(text)
  if (pageCount !== 1) {
    errors.push(`PDF 页数不是 1：实际 ${pageCount}`)
  }

  const mediaBox = parseBox(text, 'MediaBox')
  const cropBox = parseBox(text, 'CropBox')
  const rotate = findRotate(text)
  if (mediaBox === null) {
    errors.push('缺少 MediaBox')
  }
  if (rotate % 90 !== 0) {
    errors.push(`Rotate 不是 90 的倍数：${rotate}`)
  }
  if (cropBox !== null && mediaBox !== null) {
    const mediaWidth = mediaBox[2] - mediaBox[0]
    const mediaHeight = mediaBox[3] - mediaBox[1]
    const cropWidth = cropBox[2] - cropBox[0]
    const cropHeight = cropBox[3] - cropBox[1]
    if (cropWidth < mediaWidth - PAGE_TOLERANCE_PT || cropHeight < mediaHeight - PAGE_TOLERANCE_PT) {
      errors.push(
        `CropBox 裁切了页面：media=${mediaWidth.toFixed(2)}×${mediaHeight.toFixed(2)}，crop=${cropWidth.toFixed(2)}×${cropHeight.toFixed(2)}`,
      )
    }
  }

  let effectiveWidthPt: number | null = null
  let effectiveHeightPt: number | null = null
  if (mediaBox !== null) {
    const width = Math.abs(mediaBox[2] - mediaBox[0])
    const height = Math.abs(mediaBox[3] - mediaBox[1])
    const swapped = Math.abs(rotate) % 180 === 90
    effectiveWidthPt = swapped ? height : width
    effectiveHeightPt = swapped ? width : height
    if (
      Math.abs(effectiveWidthPt - A4_LANDSCAPE_WIDTH_PT) > PAGE_TOLERANCE_PT ||
      Math.abs(effectiveHeightPt - A4_LANDSCAPE_HEIGHT_PT) > PAGE_TOLERANCE_PT
    ) {
      errors.push(
        `有效页面不是 A4 横向：${effectiveWidthPt.toFixed(2)}×${effectiveHeightPt.toFixed(2)}pt，` +
          `应为 ${A4_LANDSCAPE_WIDTH_PT.toFixed(2)}×${A4_LANDSCAPE_HEIGHT_PT.toFixed(2)}pt`,
      )
    }
  }

  const content = decompressedStreams(bytes)
  const searchable = `${text}\n${content}`
  const fonts = collectFonts(searchable)
  const embeddedFontCount = fonts.filter((font) => font.embedded).length
  if (fonts.length === 0) {
    errors.push('PDF 没有字体资源')
  } else if (embeddedFontCount === 0) {
    errors.push('PDF 字体未嵌入（没有 FontFile2/FontFile3）')
  }

  const imageCount = (searchable.match(/\/Subtype\s*\/Image/g) ?? []).length
  if (imageCount > 0) {
    errors.push(`PDF 含 ${imageCount} 个位图对象，疑似截图出图`)
  }

  const vectorOps =
    (content.match(/(?:^|\s)(?:l|m|c|v|y|re)(?:\s|$)/g) ?? []).length
  if (vectorOps === 0) {
    errors.push('PDF 内容流没有矢量路径操作符')
  }
  const hasTextOperator = /(?:^|\s)(?:Tj|TJ|Tf)(?:\s|$)/.test(content)

  return {
    ok: errors.length === 0,
    errors,
    pageCount,
    mediaBox,
    cropBox,
    rotate,
    effectiveWidthPt,
    effectiveHeightPt,
    fonts,
    embeddedFontCount,
    imageCount,
    vectorOperatorCount: vectorOps,
    hasTextOperator,
  }
}
