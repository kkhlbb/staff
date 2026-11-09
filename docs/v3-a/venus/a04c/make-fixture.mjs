import { createServer } from 'vite'
import { writeFile } from 'node:fs/promises'
const server = await createServer({ server: { middlewareMode: true } })
try {
  const { createSampleSnapshot } = await server.ssrLoadModule('/src/project-file/__fixtures__/sampleProjectFile.ts')

  const { sha256Hex } = await server.ssrLoadModule('/src/sources/hash.ts')
  const { encodeProjectFile } = await server.ssrLoadModule('/src/project-file/codec.ts')
  const snapshot = await createSampleSnapshot()
  const streams = [1, 2].map(page => `BT /F1 18 Tf 70 760 Td (A-04c PDF fixture - page ${page}) Tj 0 -30 Td (NOT an engineering drawing) Tj ET\n80 600 220 60 re S\nBT /F1 12 Tf 90 625 Td (Source region S - fixture only) Tj ET\n`)
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    ...[5, 6].map(id => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents ${id} 0 R >>`),
    ...streams.map(stream => `<< /Length ${stream.length} >>\nstream\n${stream}endstream`),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((body, index) => { const offset = pdf.length; pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; return offset })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const bytes = new TextEncoder().encode(pdf)
  const sha256 = await sha256Hex(bytes)
  snapshot.revisions[0] = { ...snapshot.revisions[0], sha256, byteSize: bytes.byteLength }
  snapshot.blobs[0] = { ...snapshot.blobs[0], sha256, byteSize: bytes.byteLength }
  snapshot.attachments[0].bytes = bytes
  snapshot.analysisSnapshots[0].sourceManifest.revisions = structuredClone(snapshot.revisions)
  snapshot.bindings[0].page = 2
  snapshot.bindings[0].rectPdf = [80, 600, 300, 660]
  const encoded = await encodeProjectFile(snapshot)
  if (!encoded.ok) throw new Error(JSON.stringify(encoded.error))
  console.log(Object.keys(encoded.value))
  await writeFile('docs/v3-a/venus/a04c/source-fixture.pdf', bytes)
  await writeFile('docs/v3-a/venus/a04c/fixture.cunlian', encoded.value.bytes)
  console.log('fixture written: two labelled synthetic PDF pages, existing sample chain and historical snapshot')
} finally { await server.close() }
