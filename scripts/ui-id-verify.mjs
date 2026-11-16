#!/usr/bin/env node
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { runGates } from './gate-executor.mjs'
import { gateThemes } from './gate-themes.mjs'
import { loadEvidenceJson } from './real-docs/tsImport.mjs'
const { serializeEvidence } = await loadEvidenceJson()
const output = path.resolve(process.argv[2] ?? '../slop-cleanup-evidence/ui-id/logs')
const rows = await runGates({ steps: gateThemes['ui-id'], output, report: path.join(output, 'verification.json'), serialize: serializeEvidence })
await writeFile(path.join(output, 'verification.md'), '# Actual execution results (format scans are not business cases)\n\n' + rows.map(row => `${row.command}: exit=${row.exitCode}, signal=${row.signal}, timedOut=${row.timedOut}; ${row.summary.join('; ')}; ${row.log}`).join('\n') + '\n')
