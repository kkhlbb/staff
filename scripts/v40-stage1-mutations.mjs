import fs from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
const file = 'desktop/main/agentToolService.ts'
const original = await fs.readFile(file, 'utf8')
const dir = 'docs/evidence/v40-stage1/mutations'
await fs.mkdir(dir, { recursive: true })
const variants = [
  ['M08', 'const plan = planApplication(draft, { source: draft.sourceIdentity, candidateIds: req.candidateIds })', `const plan = { ok: true as const, value: { applied: false as const, items: draft.candidates.filter(c => req.candidateIds.includes(c.candidateId)).map(c => ({ candidateId: c.candidateId, kind: c.kind, groupId: c.groupId, fields: candidateNumericFields(c).map(({ field, value }) => ({ field, text: value.text, valueQ: value.valueQ, unit: value.unit })), evidence: c.evidence })) } }`, '02 伪造'],
  ['M09', "if (req.baseRevisionId !== revisionId) throw new MappingError('STALE_BASE', '计划正式基准已过期')", '// M09: formal basis check deliberately removed', '03 基准过期'],
]
let failed = false
for (const [id, needle, replacement, test] of variants) {
  if (!original.includes(needle)) throw new Error('Mutation anchor missing')
  let mutant = original.replace(needle, replacement)
  if (id === 'M08') mutant = mutant.replace('import { planApplication,', 'import { candidateNumericFields, planApplication,')
  const before = `${dir}/${id}-before.ts.txt`, after = `${dir}/${id}-after.ts.txt`
  await fs.writeFile(before, original); await fs.writeFile(after, mutant)
  const diff = spawnSync('diff', ['-u', '--label', `a/${file}`, before, '--label', `b/${file}`, after], { encoding: 'utf8' })
  await fs.writeFile(`${dir}/${id}.patch`, diff.stdout)
  // Preserve only the focused patch, never keep duplicate product source in evidence.
  await fs.unlink(before); await fs.unlink(after)
  try {
    await fs.writeFile(file, mutant)
    const red = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.desktop.config.ts', 'desktop/tests/agentTools.test.ts', '-t', test, '--reporter=verbose'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    await fs.writeFile(`${dir}/${id}-red.log`, `$ mutation ${id}\n${red.stdout}${red.stderr}\nexitCode=${red.status}\n`)
    console.log(`${id} RED exit=${red.status}`)
    if (red.status !== 1 || !(red.stdout + red.stderr).includes('AssertionError')) failed = true
  } finally { await fs.writeFile(file, original) }
  const green = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.desktop.config.ts', 'desktop/tests/agentTools.test.ts', '-t', test, '--reporter=verbose'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  await fs.writeFile(`${dir}/${id}-green.log`, `$ restored ${id}\n${green.stdout}${green.stderr}\nexitCode=${green.status}\n`)
  console.log(`${id} GREEN exit=${green.status}`)
  if (green.status !== 0) failed = true
}
if ((await fs.readFile(file, 'utf8')) !== original) throw new Error('Restoration mismatch')
if (failed) process.exitCode = 1
