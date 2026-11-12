#!/usr/bin/env node
/**
 * 变异实验（M30 / M31）：把实现改坏，验收用例必须变红；恢复后必须变绿。
 *
 * M30：未支持实体改成静默跳过 → 「未渲染计数」用例红。
 * M31：关掉 GBK 解码（按 UTF-8 硬解）→ 中文用例红。
 *
 * 用法：node docs/evidence/dxf-viewer/mutations/run.mjs
 * 输出：docs/evidence/dxf-viewer/mutations/{m30,m31}-*.log
 *       docs/evidence/dxf-viewer/mutations.json（serializeEvidence）
 *
 * 安全：只在内存里改文件→写盘→跑测试→**恢复原文**（finally），结束核对 SHA-256。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { serializeEvidence } from '../../../../scripts/evidence-json.ts'

const ROOT = process.cwd()
const EVIDENCE = path.join(ROOT, 'docs', 'evidence', 'dxf-viewer')
const LOGS = path.join(EVIDENCE, 'mutations')
const RESULT = path.join(EVIDENCE, 'mutations.json')

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

function runVitest(testFile, testName) {
  const result = spawnSync(
    path.join(ROOT, 'node_modules', '.bin', 'vitest'),
    ['run', testFile, '-t', testName],
    { cwd: ROOT, encoding: 'utf8', timeout: 180_000 },
  )
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const failed = /Tests\s+\d+ failed/.test(output) || result.status !== 0
  return { status: result.status, failed, output }
}

async function mutate({ id, file, description, pattern, replacement, testFile, testName }) {
  const absolute = path.join(ROOT, file)
  const original = await fsp.readFile(absolute, 'utf8')
  const mutated = original.replace(pattern, replacement)
  if (mutated === original) {
    throw new Error(`${id}: 变异未命中（pattern 不存在）：${pattern}`)
  }
  await fsp.writeFile(absolute, mutated)
  let mutatedRun
  try {
    mutatedRun = runVitest(testFile, testName)
  } finally {
    await fsp.writeFile(absolute, original)
  }
  const restoredRun = runVitest(testFile, testName)
  const restoredHashOk = sha256(await fsp.readFile(absolute, 'utf8')) === sha256(original)
  const logName = `${id}-${mutatedRun.failed ? 'red' : 'unexpected-green'}.log`
  await fsp.writeFile(path.join(LOGS, logName), `${description}\n\n${mutatedRun.output}\n`)
  const restoreLog = `${id}-restored.log`
  await fsp.writeFile(path.join(LOGS, restoreLog), `${restoredRun.output}\n`)
  console.log(`${id} mutated failed=${mutatedRun.failed} restored ok=${!restoredRun.failed} hash=${restoredHashOk}`)
  return {
    id,
    file,
    description,
    mutated: { failed: mutatedRun.failed, status: mutatedRun.status, log: path.relative(ROOT, path.join(LOGS, logName)) },
    restored: { failed: restoredRun.failed, status: restoredRun.status, log: path.relative(ROOT, path.join(LOGS, restoreLog)) },
    restoredHashOk,
    ok: mutatedRun.failed && !restoredRun.failed && restoredHashOk,
  }
}

await fsp.mkdir(LOGS, { recursive: true })

const results = []

results.push(await mutate({
  id: 'm30',
  file: 'src/dxf-view/parse.ts',
  description: '把不支持实体改成静默跳过（不再 collectUnsupported）',
  pattern: 'if (!STRUCTURAL_TYPES.has(raw.type)) collectUnsupported(unsupported, raw.type)\n      continue',
  replacement: 'continue',
  testFile: 'src/dxf-view/dxfView.test.ts',
  testName: 'SPLINE / HATCH / INSERT / SOLID 按类型计数，LINE 仍照常渲染',
}))

results.push(await mutate({
  id: 'm31',
  file: 'src/dxf-view/decode.ts',
  description: '关掉 GBK 解码：ANSI_936 文件按 UTF-8 硬解',
  pattern: "if (declared === 'gbk') {\n    const text = tryDecode(body, 'gbk')",
  replacement: "if (declared === 'gbk') {\n    const text = tryDecode(body, 'utf-8')",
  testFile: 'src/dxf-view/dxfView.test.ts',
  testName: 'GBK（ANSI_936）样本解码出完整中文，不是问号也不是乱码',
}))

const payload = {
  schema: 'dxf-viewer-mutations-v1',
  methodology: '同一用例：变异后必须失败，恢复后必须通过；文件 SHA-256 恢复前后一致。',
  results,
  summary: { total: results.length, passed: results.filter((item) => item.ok).length },
}
await fsp.mkdir(EVIDENCE, { recursive: true })
await fsp.writeFile(RESULT, serializeEvidence(payload))
console.log(`\n${results.every((item) => item.ok) ? 'ALL MUTATIONS OK' : 'MUTATION CHECK FAILED'}`)
process.exit(results.every((item) => item.ok) ? 0 : 1)
