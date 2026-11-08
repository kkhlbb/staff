/**
 * 测试用合成 PDF 生成器。
 *
 * 只生成结构合法、无内容的 PDF；用于坐标、页数、哈希与不可变版本测试，
 * 不冒充真实工程图纸。xref 偏移按 ASCII 编码计算，因此字符偏移等于字节偏移。
 */

export interface SyntheticPdfOptions {
  pageCount?: number
  width?: number
  height?: number
  /** 页面边界框 [x0, y0, x1, y1]；给定时优先于 width/height。 */
  mediaBox?: readonly [number, number, number, number]
  /** 写入 PDF 注释；用于制造“同名但字节与哈希不同”的新版本。 */
  variant?: string
}

/** 按对象体拼出带 xref / trailer 的 PDF 字节。 */
function assemblePdf(objects: string[], variant?: string): Uint8Array {
  let pdf = '%PDF-1.4\n'
  if (variant !== undefined) {
    pdf += `% variant: ${variant}\n`
  }
  const offsets: number[] = []
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }

  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`

  return new TextEncoder().encode(pdf)
}

export function buildSyntheticPdf(options: SyntheticPdfOptions = {}): Uint8Array {
  const pageCount = options.pageCount ?? 2
  const width = options.width ?? 600
  const height = options.height ?? 800
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error('pageCount 必须是正整数')
  }
  const [x0, y0, x1, y1] = options.mediaBox ?? [0, 0, width, height]

  const pageObjectIds = Array.from({ length: pageCount }, (_, index) => index + 3)
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageObjectIds
      .map((id) => `${id} 0 R`)
      .join(' ')}] /Count ${pageCount} >>`,
  ]
  for (let index = 0; index < pageCount; index += 1) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [${x0} ${y0} ${x1} ${y1}] /Resources << >> >>`,
    )
  }

  return assemblePdf(objects, options.variant)
}

/**
 * 真实损坏夹具：两页 PDF，但 /Pages 树的第二个 Kids 指向整数对象 42，
 * 不是 Page 字典。
 *
 * pdfjs 6.5.438 读这种文件时 numPages 仍返回 2；只有 getPage(2) 才抛
 * “Page dictionary kid reference points to wrong type of object.”。
 * 因此“只取 numPages 就算可解析”会漏拒绝，必须逐页解析。
 */
export function buildPdfWithBrokenSecondPage(): Uint8Array {
  return assemblePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << >> >>',
    '42',
  ])
}
