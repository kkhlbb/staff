import path from 'node:path'
import { runGates } from './gate-executor.mjs'
import { gateThemes } from './gate-themes.mjs'
import { loadEvidenceJson } from './real-docs/tsImport.mjs'
const { serializeEvidence } = await loadEvidenceJson()
const dir = path.resolve(process.argv[2] ?? '../slop-cleanup-evidence/display-3dp')
await runGates({ steps: gateThemes['display-3dp'], output: path.join(dir, 'logs'), report: path.join(dir, 'verification.json'), serialize: serializeEvidence, reportKey: 'results' })
