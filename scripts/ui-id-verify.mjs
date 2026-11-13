#!/usr/bin/env node
/** Real acceptance gates. Optional output directory keeps post-commit verification clean. */
import { spawnSync } from 'node:child_process'
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const output = path.resolve(process.argv[2] ?? 'docs/evidence/ui-id-leak/logs')
mkdirSync(output, { recursive: true })
const gates = [
  ['01-test', ['test']],
  ['02-test-desktop', ['run', 'test:desktop']],
  ['03-typecheck', ['run', 'typecheck']],
  ['04-typecheck-desktop', ['run', 'typecheck:desktop']],
  ['05-lint', ['run', 'lint']],
  ['06-build', ['run', 'build']],
  ['07-package-desktop', ['run', 'package:desktop', '--', '--arch=arm64']],
  ['08-test-mcp', ['run', 'test:mcp']],
]
const rows = []
for (const [name, args] of gates) {
  const log = path.join(output, `${name}.log`)
  const fd = openSync(log, 'w')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const run = spawnSync('npm', args, { cwd: process.cwd(), env, stdio: ['ignore', fd, fd] })
  closeSync(fd)
  const text = readFileSync(log, 'utf8').replace(/\u001b\[[0-9;]*m/g, '')
  const summaries = text.split('\n').filter(line => /^\s*(?:Test Files|Tests)\s/.test(line) || line.includes('RESULT PASS') || line.includes('built in') || line.includes('Packaging for arm64')).map(line => line.trim())
  console.log(`${name}: exit=${run.status}; ${summaries.join('; ')}`)
  rows.push(`| npm ${args.join(' ')} | ${run.status} | ${(summaries.join('; ') || (run.status === 0 ? '无诊断，退出 0' : '见完整日志')).replaceAll('|', '\\|')} | ${name}.log |`)
  if (run.status !== 0) process.exitCode = 1
}
writeFileSync(path.join(output, 'verification.md'), '# 实际执行结果\n\n| 命令 | 退出码 | 实际输出摘录 | 原始日志 |\n|---|---|---|---|\n' + rows.join('\n') + '\n')
