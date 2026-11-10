/**
 * V3.5 测试夹具：合成两页任务书 PDF（ASCII 文本、标准 Helvetica）。
 *
 * 只用于校验 main 的“页数 + 每页 pageBoxPdf”解析与导入通道；真实 GUI 证据
 * 使用 Chromium printToPDF 生成的嵌字 PDF（docs/evidence/V3.5/fixtures）。
 * 第 2 页使用非零原点 MediaBox，覆盖“pageBox 不是 [0,0,width,height]”的契约。
 */
export function createTwoPageTaskbookPdf(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [100 200 795 1042] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  const contents = [
    'BT /F1 24 Tf 72 700 Td (Task book page 1 - general notes) Tj ET',
    'BT /F1 18 Tf 120 900 Td (Axial clearance C shall be 0.1000 to 0.3000 mm, inclusive) Tj ET',
  ]
  for (const content of contents) {
    objects.push(
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    )
  }
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(out, 'latin1'))
}
