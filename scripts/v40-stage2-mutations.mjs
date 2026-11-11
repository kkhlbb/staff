import fs from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const file = 'desktop/main/agentScheduler.ts'
const original = await fs.readFile(file, 'utf8')
const dir = 'docs/evidence/v40-stage2/mutations'
await fs.mkdir(dir, { recursive: true })

const variants = [
  [
    'M10',
    "          const validation = validateToolArguments(call.name, args)",
    "          const validation = { ok: true as boolean, value: args, message: '' }",
    'S2-04',
  ],
  [
    'M11',
    "          const target: AgentTaskState = anyToolFailed ? 'failed' : previewOk ? 'ready-to-commit' : 'completed'",
    "          const target: AgentTaskState = reply.text.length > 0 ? 'completed' : anyToolFailed ? 'failed' : previewOk ? 'ready-to-commit' : 'completed'",
    'S2-05',
  ],
  [
    'M12',
    '  private isStaleReply(entry: TaskEntry): boolean {\n    return entry.task.projectId !== this.activeProjectId\n  }',
    '  private isStaleReply(entry: TaskEntry): boolean {\n    // M12: projectId identity check deliberately removed.\n    void entry\n    return false\n  }',
    'S2-09',
  ],
]

let failed = false
for (const [id, needle, replacement, test] of variants) {
  if (!original.includes(needle)) throw new Error(`Mutation anchor missing: ${id}`)
  const mutant = original.replace(needle, replacement)
  const before = `${dir}/${id}-before.ts.txt`
  const after = `${dir}/${id}-after.ts.txt`
  await fs.writeFile(before, original)
  await fs.writeFile(after, mutant)
  const diff = spawnSync('diff', ['-u', '--label', `a/${file}`, before, '--label', `b/${file}`, after], { encoding: 'utf8' })
  await fs.writeFile(`${dir}/${id}.patch`, diff.stdout)
  await fs.unlink(before)
  await fs.unlink(after)
  try {
    await fs.writeFile(file, mutant)
    const red = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.desktop.config.ts', 'desktop/tests/agentScheduler.test.ts', '-t', test, '--reporter=verbose'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    await fs.writeFile(`${dir}/${id}-red.log`, `$ mutation ${id} (${test})\n${red.stdout}${red.stderr}\nexitCode=${red.status}\n`)
    console.log(`${id} RED exit=${red.status}`)
    if (red.status !== 1 || !(red.stdout + red.stderr).includes('AssertionError')) failed = true
  } finally {
    await fs.writeFile(file, original)
  }
  const green = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.desktop.config.ts', 'desktop/tests/agentScheduler.test.ts', '-t', test, '--reporter=verbose'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  await fs.writeFile(`${dir}/${id}-green.log`, `$ restored ${id} (${test})\n${green.stdout}${green.stderr}\nexitCode=${green.status}\n`)
  console.log(`${id} GREEN exit=${green.status}`)
  if (green.status !== 0) failed = true
}
if ((await fs.readFile(file, 'utf8')) !== original) throw new Error('Restoration mismatch')
if (failed) process.exitCode = 1
