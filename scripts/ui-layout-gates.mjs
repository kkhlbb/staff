import { spawnSync } from 'node:child_process'
import { writeFile, mkdir, open, readFile, appendFile } from 'node:fs/promises'
import { serializeEvidence } from './evidence-json.ts'
const out = 'docs/evidence/ui-layout'
await mkdir(`${out}/logs`, { recursive: true })
const commands = ['typecheck', 'typecheck:desktop', 'lint', 'test', 'test:desktop', 'test:mcp', 'build', 'package:desktop', 'test:desktop:layout']
const rows = []
// Create the evidence file before npm test discovers JSON fixtures, so its own count is stable.
await writeFile(`${out}/gates.json`, serializeEvidence({ commands: [] }))
for (const [index, command] of commands.entries()) {
  const file = `logs/${String(index + 1).padStart(2, '0')}-${command.replaceAll(':', '-')}.log`
  const handle = await open(`${out}/${file}`, 'w')
  const result = spawnSync('npm', command === 'test' ? ['test'] : ['run', command], { stdio: ['ignore', handle.fd, handle.fd], timeout: 240000 })
  await handle.close(); await appendFile(`${out}/${file}`, `\nEXIT_CODE=${result.status}\n`)
  const output = await readFile(`${out}/${file}`, 'utf8')
  rows.push({ command: command === 'test' ? 'npm test' : `npm run ${command}`, exitCode: result.status,
    summary: output.split('\n').filter(line => /Test Files|Tests\s|LAYOUT_RESULT|RESULT PASS|built in/.test(line)), log: file })
  console.log(`${command}: exit ${result.status}; ${rows.at(-1).summary.join(' / ')}`)
  await writeFile(`${out}/gates.json`, serializeEvidence({ commands: rows }))
}
if (rows.some(row => row.exitCode !== 0)) process.exitCode = 1
