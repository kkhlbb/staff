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
  /** 写入 PDF 注释；用于制造“同名但字节与哈希不同”的新版本。 */
  variant?: string
}

export function buildSyntheticPdf(options: SyntheticPdfOptions = {}): Uint8Array {
  const pageCount = options.pageCount ?? 2
  const width = options.width ?? 600
  const height = options.height ?? 800
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error('pageCount 必须是正整数')
  }

  const pageObjectIds = Array.from({ length: pageCount }, (_, index) => index + 3)
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageObjectIds
      .map((id) => `${id} 0 R`)
      .join(' ')}] /Count ${pageCount} >>`,
  ]
  for (let index = 0; index < pageCount; index += 1) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> >>`,
    )
  }

  let pdf = '%PDF-1.4\n'
  if (options.variant !== undefined) {
    pdf += `% variant: ${options.variant}\n`
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
