import fs from 'node:fs/promises'
import path from 'node:path'
import { runGates } from './gate-executor.mjs'
import { gateThemes } from './gate-themes.mjs'
import { loadEvidenceJson } from './real-docs/tsImport.mjs'
const { evidenceViolations, serializeEvidence } = await loadEvidenceJson()
const dir = path.resolve(process.argv[2] ?? '../slop-cleanup-evidence/v40-stage2')
const results = await runGates({ steps: gateThemes['v40-stage2'], output: path.join(dir, 'logs'), report: path.join(dir, 'verification.json'), serialize: serializeEvidence, reportKey: 'results', env: { V40_RECORD_DIR: dir } })
const tracePath = path.join(dir, 'fake-session-trace.json')
try {
  const trace = await fs.readFile(tracePath, 'utf8')
  const parsed = JSON.parse(trace)
  const violations = evidenceViolations(trace)
  if (!parsed.task || !Array.isArray(parsed.steps) || parsed.steps.length === 0) violations.push('missing task or steps')
  results.push({ command: 'evidence-guard fake-session-trace.json', exitCode: violations.length === 0 ? 0 : 1, violations, log: tracePath })
} catch (error) {
  results.push({ command: 'evidence-guard fake-session-trace.json', exitCode: 1, error: error.code ?? error.message, log: tracePath })
}
await fs.writeFile(path.join(dir, 'verification.json'), serializeEvidence({ results }))
if (results.some(result => result.exitCode !== 0)) process.exitCode = 1
