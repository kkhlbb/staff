import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { serializeEvidence, evidenceViolations } from './evidence-json.ts'
const root = 'docs/evidence/v40-stage1'
const artifacts = []
for (const file of ['out/寸链-darwin-arm64/寸链.app/Contents/Resources/app.asar', 'out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链', `${root}/fixtures/a40-01-seed.cunlian`, 'src/document-extraction/__fixtures__/taskbook-TB-2026-1110.pdf']) {
  const bytes = await fs.readFile(file)
  artifacts.push({ path: file, byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
await fs.writeFile(`${root}/artifacts.json`, serializeEvidence({ artifacts, generatedAt: new Date().toISOString() }))
const files = []
async function visit(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name)
    if (e.isDirectory()) await visit(file)
    else if (file.endsWith('.json')) files.push(file)
  }
}
await visit(root)
for (const file of files) {
  const text = await fs.readFile(file, 'utf8')
  const violations = evidenceViolations(text)
  if (violations.length || serializeEvidence(JSON.parse(text)) !== text) throw new Error(`${file}: ${violations.join(',')} or serializer is not idempotent`)
  console.log(`PASS evidence serializer/guard ${file}`)
}
const summary = []
for (const name of ['nine-tests', 'test', 'test-desktop']) {
  const log = await fs.readFile(`${root}/logs/${name}.log`, 'utf8')
  summary.push(`${name}: ${log.match(/Test Files[^\n]*/u)?.[0]?.trim()}; ${log.match(/Tests\s+\d+[^\n]*/u)?.[0]?.trim()}`)
}
console.log(summary.join('\n'))
console.log(`PASS JSON count=${files.length}`)
console.log(execFileSync('git', ['diff', 'HEAD', '--check', '--', 'desktop', 'src', 'scripts'], { encoding: 'utf8' }) || 'PASS product git diff HEAD --check (raw PDF fixture text whitespace preserved)')
