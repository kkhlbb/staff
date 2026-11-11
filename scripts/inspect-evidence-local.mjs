import { readdirSync, readFileSync } from 'node:fs'
import { evidenceFiles, evidenceViolations } from './evidence-json.ts'
function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]) }
for (const f of walk('docs/evidence').filter(f => f.endsWith('.json') && !evidenceFiles.includes(f))) console.log(f, evidenceViolations(readFileSync(f, 'utf8')))
