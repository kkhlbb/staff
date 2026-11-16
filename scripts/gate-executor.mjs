import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Only process execution is shared; callers retain topic-specific commands/guards. */
export async function executeGate({ name, command, args = [], output, cwd = process.cwd(), env = {}, timeoutMs = 600000 }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw Error('positive timeout required')
  await mkdir(output, { recursive: true })
  const startedAt = new Date().toISOString()
  const childEnv = { ...process.env, ...env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const run = spawnSync(command, args, { cwd, env: childEnv, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 128 * 1024 * 1024 })
  const stem = name.replaceAll(':', '-')
  const stdoutLog = path.join(output, `${stem}.stdout.log`)
  const stderrLog = path.join(output, `${stem}.stderr.log`)
  const log = path.join(output, `${stem}.log`)
  const stdout = run.stdout ?? ''
  const stderr = run.stderr ?? ''
  const row = { name, command: [command, ...args].join(' '), exitCode: run.status, signal: run.signal,
    error: run.error?.message ?? null, timedOut: run.error?.code === 'ETIMEDOUT', timeoutMs,
    startedAt, finishedAt: new Date().toISOString(), stdoutLog, stderrLog, log,
    summary: (stdout + '\n' + stderr).split('\n').filter(line => /Test Files|Tests\s|LAYOUT_RESULT|RESULT PASS|built in|correctness:|BASELINE MATCH|error TS|✖/.test(line)) }
  await writeFile(stdoutLog, stdout)
  await writeFile(stderrLog, stderr)
  await writeFile(log, `$ ${row.command}\nSTDOUT\n${stdout}\nSTDERR\n${stderr}\nEXIT_CODE=${run.status}\nSIGNAL=${run.signal}\nERROR=${row.error ?? ''}\nTIMED_OUT=${row.timedOut}\n`)
  return row
}

export async function runGates({ steps, output, report, serialize = value => JSON.stringify(value, null, 2) + '\n', reportKey = 'rows', env = {}, timeoutMs }) {
  const rows = []
  await mkdir(path.dirname(report), { recursive: true })
  await writeFile(report, serialize({ [reportKey]: rows }))
  for (const step of steps) {
    const row = await executeGate({ ...step, output, env: { ...env, ...step.env }, ...(timeoutMs === undefined ? {} : { timeoutMs }) })
    rows.push(row)
    await writeFile(report, serialize({ [reportKey]: rows }))
    console.log(`${row.name}: exit=${row.exitCode}; signal=${row.signal}; timeout=${row.timedOut}; ${row.summary.join(' / ')}`)
  }
  if (rows.some(row => row.exitCode !== 0 || row.signal !== null || row.error !== null)) process.exitCode = 1
  return rows
}
