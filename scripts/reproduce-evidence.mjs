#!/usr/bin/env node
/**
 * Re-serialize the six historical captures from a pinned, read-only Git input.
 * This is NOT a new UI capture and must not be reported as one. In particular,
 * before-report must retain the original failure and pixel measurements.
 * No input file is overwritten before all six inputs have been validated.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { evidenceFiles, serializeEvidence, evidenceViolations } from './evidence-json.ts'

const sourceCommit = '9fe22fdaac6cdfc2a7c7bbf254cded61e4e73d13'
const outputs = evidenceFiles.map((file) => {
  const input = JSON.parse(execFileSync('git', ['show', `${sourceCommit}:${file}`], { encoding: 'utf8' }))
  const text = serializeEvidence({
    ...input,
    reproduction: { kind: 'historical-capture-reserialization', sourceCommit, sourceFile: file },
  })
  const errors = evidenceViolations(text)
  if (errors.length) throw new Error(`${file}: ${errors.join(', ')}`)
  return { file, text }
})
for (const { file, text } of outputs) {
  writeFileSync(file, text)
  console.log(`REGENERATED ${file}`)
}
