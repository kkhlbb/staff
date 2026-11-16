#!/usr/bin/env node
import path from 'node:path'
import { runGates } from './gate-executor.mjs'
import { gateThemes } from './gate-themes.mjs'
import { loadEvidenceJson } from './real-docs/tsImport.mjs'
const { serializeEvidence } = await loadEvidenceJson()
const dir = path.resolve(process.argv[2] ?? '../slop-cleanup-evidence/ground-truth')
const steps = gateThemes['ground-truth'].map(step => step.name === 'metrics' ? { ...step, args: [...step.args, '--evidence-dir', path.join(dir, 'metrics')] } : step)
await runGates({ steps, output: path.join(dir, 'logs'), report: path.join(dir, 'gates.json'), serialize: serializeEvidence, env: { npm_config_offline: 'true' } })
