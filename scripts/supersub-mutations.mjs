#!/usr/bin/env node
/** Sequential source mutations; restores byte-for-byte in finally, no flags in production. */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { loadEvidenceJson } from './real-docs/tsImport.mjs'
const parsePath = 'src/document-extraction/parse.ts'
const geometryPath = 'src/document-extraction/scriptsGeometry.ts'
const original = new Map([parsePath, geometryPath].map(file => [file, readFileSync(file, 'utf8')]))
const directory = 'docs/evidence/supersub-fix'
mkdirSync(`${directory}/logs`, { recursive: true })
const mutations = [
  { id: 'M43', file: parsePath, from: 'const {line,decorations} = protectScriptNominals(originalLine,page)',
    to: 'const {line,decorations} = {line:originalLine,decorations:[]}', test: 'M43' },
  { id: 'M44', file: parsePath, from: "const lower = make(decoration.lower ?? '0')",
    to: "const lower = make(String(-Number(decoration.upper ?? '0')))", test: 'M44 asymmetric' },
  { id: 'M45', file: geometryPath, from: "  return {line:{...line,normalizedText:chars.join('')},decorations}",
    to: "  if (decorations.some(d=>d.ambiguous)) return {line,decorations:[]}\n  return {line:{...line,normalizedText:chars.join('')},decorations}", test: 'M45' },
]
const results = []
function restore() {
  for (const [file, text] of original) writeFileSync(file, text)
}
function run(id, state, name) {
  const args = ['node_modules/vitest/vitest.mjs', 'run', 'src/document-extraction/__tests__/scriptsGeometry.test.ts', '-t', name]
  const child = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  if (child.error) throw child.error
  const log = `${directory}/logs/${id}-${state}.log`
  writeFileSync(log, `$ node ${args.join(' ')}\n${child.stdout}${child.stderr}\nexit=${child.status}\n`)
  console.log(`${id} ${state}: exit=${child.status} ${log}`)
  return { exit: child.status, log }
}
try {
  for (const mutation of mutations) {
    restore()
    const text = original.get(mutation.file)
    if (text.split(mutation.from).length !== 2) throw new Error(`Nonunique mutation ${mutation.id}`)
    writeFileSync(mutation.file, text.replace(mutation.from, mutation.to))
    const red = run(mutation.id, 'red', mutation.test)
    restore()
    const green = run(mutation.id, 'green', mutation.test)
    if (red.exit !== 1 || green.exit !== 0) throw new Error(`${mutation.id}: expected red=1 green=0`)
    results.push({ id: mutation.id, mutation: mutation.to, red, green })
  }
} finally {
  restore()
}
for (const [file, text] of original) if (readFileSync(file, 'utf8') !== text) throw new Error(`Restore failed ${file}`)
const { serializeEvidence } = await loadEvidenceJson()
writeFileSync(`${directory}/mutations.json`, serializeEvidence({ results, restored: true }))
