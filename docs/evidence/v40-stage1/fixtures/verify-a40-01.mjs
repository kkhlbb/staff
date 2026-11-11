// Run from repository root: node docs/evidence/v40-stage1/fixtures/verify-a40-01.mjs [--audit]
// Real project-local pdfjs extraction; never substitutes authored strings for extracted text.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { getDocument, version } from 'pdfjs-dist/legacy/build/pdf.mjs'

const dir = new URL('./', import.meta.url)
const audit = process.argv.includes('--audit')
const sources = audit ? [
  new URL('../../../../src/document-extraction/__fixtures__/taskbook-TB-2026-1110.pdf', dir),
  new URL('../../../../../tmp/v35-indep/generic/taskbook.pdf', dir),
] : [new URL('../../../../src/document-extraction/__fixtures__/taskbook-TB-2026-1110.pdf', dir)]
const checks = [
  ['内径20.00', /内径\s*20\.00\s*mm/],
  ['外径32.00', /外径\s*32\.00\s*mm/],
  ['长度12.00', /[长⻓]\s*度\s*12\.00\s*mm/],
  ['H52.20±0.02', /H\s*(?:52\.20\s*±\s*0\.02\s*mm|总\s*[长⻓]\s*52\.20\s*\+0\.02\s*-0\.02)/],
  ['B1 20.00±0.01', /B1\s*(?:20\.00\s*±\s*0\.01\s*mm|左轴承\s*20\.00\s*\+0\.01\s*-0\.01)/],
  ['S12.00±0.01', /S\s*(?:12\.00\s*±\s*0\.01\s*mm|隔套\s*12\.00\s*\+0\.01\s*-0\.01)/],
  ['B2 20.00±0.01', /B2\s*(?:20\.00\s*±\s*0\.01\s*mm|右轴承\s*20\.00\s*\+0\.01\s*-0\.01)/],
  ['公式方向', /C\s*=\s*H\s*[-−]\s*B1\s*[-−]\s*S\s*[-−]\s*B2/],
  ['目标闭区间', /0\.1000\s*～\s*0\.3000\s*mm\s*，含两端/],
]
const log = [`pdfjs-dist ${version}; actual getDocument → getPage → getTextContent`, '']
for (const url of sources) {
  const bytes = await readFile(url)
  log.push(`FILE ${fileURLToPath(url)}`, `BYTES ${bytes.length}`, `SHA256 ${createHash('sha256').update(bytes).digest('hex')}`)
  const task = getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, verbosity: 0 })
  try {
    const doc = await task.promise
    log.push(`PAGES ${doc.numPages}`)
    const pages = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      // Preserve line boundaries supplied by pdfjs, including table cell spacing.
      const text = content.items.filter(item => 'str' in item)
        .map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('')
      pages.push(text)
      log.push(`--- PAGE ${n} EXTRACTED TEXT ---`, text)
      page.cleanup()
    }
    const text = pages.join('\n')
    const normalized = text.replace(/\s+/g, ' ')
    for (const [label, regex] of checks) {
      const pass = regex.test(normalized)
      log.push(`${pass ? 'PASS' : 'MISSING'} ${label}`)
      if (!audit) assert.ok(pass, `Missing ${label}`)
    }
    if (!audit) {
      assert.equal(doc.numPages, 2)
      assert.match(normalized, /S\s*为隔套\s*[长⻓]\s*度/)
      log.push('PASS 2 pages; explicit S spacer-length relation')
    }
  } finally { await task.destroy() }
  log.push('')
}
const output = log.join('\n') + '\n'
await writeFile(new URL(audit ? 'existing-fixtures-audit.txt' : 'verification.txt', dir), output)
console.log(output)
