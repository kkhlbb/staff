import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { serializeEvidence } from './evidence-json.ts'
const baseline = 'a86cf8a'
const files = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, 'src'], { encoding: 'utf8' }).trim().split('\n').filter(p => p.endsWith('.css')).sort()
const original = []
for (const file of files) {
  const source = execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' })
  for (const [index, line] of source.split('\n').entries()) {
    const m = line.match(/(?<![\w-])((?:min-|max-)?width):\s*(\d+)px/)
    if (m) original.push({ file, line: index + 1, declaration: `${m[1]}: ${m[2]}px` })
  }
}
const rows = readFileSync('docs/ui-layout-width-inventory.md', 'utf8').split('\n').filter(r => /^\| W\d\d \|/.test(r))
assert.equal(original.length, 52)
assert.equal(rows.length, original.length)
for (const [index, value] of original.entries()) {
  assert(rows[index].includes(`\`${value.file}:${value.line}\``), `baseline location mismatch W${index + 1}`)
  assert(rows[index].includes(`\`${value.declaration}\``), `baseline value mismatch W${index + 1}`)
}
const variables = rows.filter(r => r.includes('| 变量 ')).length
const retained = rows.filter(r => r.includes('| 保留：')).length
assert.equal(variables, 36); assert.equal(retained, 16); assert.equal(variables + retained, 52)
const result = { baseline, originalCount: original.length, variables, retained, complete: true, entries: original }
writeFileSync('docs/evidence/ui-layout/width-audit.json', serializeEvidence(result))
console.log(`WIDTH_AUDIT=PASS baseline=${baseline} original=${original.length} N=${variables} M=${retained} N+M=${variables + retained}`)
