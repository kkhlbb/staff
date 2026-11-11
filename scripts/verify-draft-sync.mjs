import fs from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { serializeEvidence } from './evidence-json.ts'
const dir = 'docs/evidence/V3.5-draft-sync/'
const commands = ['typecheck', 'typecheck:desktop', 'lint', 'test', 'test:desktop', 'build', 'package:desktop']
const results = []
for (const name of commands) {
  const r = spawnSync('npm', ['run', name], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const log = `logs/${name.replaceAll(':', '-')}.log`
  await fs.writeFile(dir + log, (r.stdout ?? '') + (r.stderr ?? ''))
  results.push({ command: `npm run ${name}`, exitCode: r.status, signal: r.signal, log })
  console.log(JSON.stringify(results.at(-1)))
  console.log(((r.stdout ?? '') + (r.stderr ?? '')).split('\n').slice(-12).join('\n'))
}
const files = [
  'out/寸链-darwin-arm64/寸链.app/Contents/Resources/app.asar',
  'out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链',
  '/Users/aston/DSH/tmp/v35-indep/saved-after-12.05.cunlian',
  dir+'fixtures/legacy-stale.cunlian',
  '/Users/aston/DSH/tmp/v35-indep/baseline.cunlian.pre-v35.ded17783b6b540d8.cunlian',
]
const hashes = []
for (const file of files) {
  const bytes=await fs.readFile(file)
  hashes.push({ file, byteSize:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex') })
}
const pkg=JSON.parse(await fs.readFile('package.json','utf8'))
await fs.writeFile(dir+'verification.json',serializeEvidence({ version:pkg.version,platform:'darwin-arm64',commands:results,hashes }))
console.log(JSON.stringify(hashes,null,2))
if(results.some(x=>x.exitCode!==0))process.exitCode=1
