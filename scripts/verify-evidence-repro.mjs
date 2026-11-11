#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { evidenceFiles } from './evidence-json.ts'

const root = process.env.EVIDENCE_VERIFY_OUT ?? 'docs/evidence/V3.6'
mkdirSync(`${root}/mutations`, { recursive: true })
mkdirSync(`${root}/logs/evidence-repro`, { recursive: true })
function run(command, args, log) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const output = `$ ${command} ${args.join(' ')}\n${result.stdout ?? ''}${result.stderr ?? ''}\nEXIT ${result.status}\n`
  writeFileSync(log, output)
  console.log(`${log}: exit ${result.status}`)
  if (result.error) throw result.error
  return result
}

if (process.argv.includes('--suites')) {
  const commands = [
    ['test'], ['run', 'test:desktop'], ['run', 'typecheck'],
    ['run', 'typecheck:desktop'], ['run', 'lint'], ['run', 'build'],
    ['run', 'package:desktop', '--', '--arch=arm64'],
  ]
  let failed = false
  for (const [index, args] of commands.entries()) {
    if (run('npm', args, `${root}/logs/evidence-repro/command-${index + 1}.log`).status !== 0) failed = true
  }
  process.exitCode = failed ? 1 : 0
} else {
  const hashes = []
  for (const pass of [1, 2]) {
    if (run('node', ['scripts/reproduce-evidence.mjs'], `${root}/logs/evidence-repro/generate-${pass}.log`).status !== 0) throw new Error('generation failed')
    const result = run('shasum', ['-a', '256', ...evidenceFiles], `${root}/logs/evidence-repro/sha256-${pass}.log`)
    if (result.status !== 0) throw new Error('shasum failed')
    hashes.push(result.stdout)
    console.log(`PASS ${pass}\n${result.stdout}`)
  }
  if (hashes[0] !== hashes[1]) throw new Error('byte reproducibility failed')
  const file = evidenceFiles[3]
  const original = readFileSync(file, 'utf8')
  try {
    // M06: regress a portable file reference to the old absolute target shape.
    const mutant = original.replace('{\n', '{\n  "target": "/Users/aston/DSH/staff/src/document-extraction/__fixtures__/taskbook-TB-2026-1110.pdf",\n')
    if (mutant === original) throw new Error('M06 did not apply')
    writeFileSync(file, mutant)
    mkdirSync('node_modules/.tmp/evidence-repro', { recursive: true })
    const baseline = 'node_modules/.tmp/evidence-repro/M06-before.json'
    writeFileSync(baseline, original)
    const diff = spawnSync('git', ['diff', '--no-index', '--', baseline, file], { encoding: 'utf8' })
    if (diff.status !== 1 || !diff.stdout.includes('@@')) throw new Error('M06 patch capture failed')
    writeFileSync(`${root}/mutations/M06.patch`,
      `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n${diff.stdout.slice(diff.stdout.indexOf('@@'))}`)
    const red = run('npx', ['vitest', 'run', 'src/test/evidenceRepro.test.ts'], `${root}/mutations/M06-red.log`)
    if (red.status !== 1 || !`${red.stdout}${red.stderr}`.includes('absolute path')) throw new Error('M06 did not fail for absolute path')
  } finally {
    writeFileSync(file, original)
  }
  const green = run('npx', ['vitest', 'run', 'src/test/evidenceRepro.test.ts'], `${root}/mutations/M06-green.log`)
  if (green.status !== 0) throw new Error('M06 restoration failed')
  console.log('PASS: six byte-identical outputs; M06 red -> restored green')
}
