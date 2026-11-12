#!/usr/bin/env node
/**
 * 证据后处理：把测试日志里的四组判据行与 stdio 冒烟摘要合成 evidence JSON。
 *
 * 输入（由前面的命令生成）：
 *   docs/evidence/mcp-entry/logs/test-mcp-green.log      npm run test:mcp --reporter=verbose
 *   docs/evidence/mcp-entry/logs/stdio-summary.json      node scripts/mcp-smoke.mjs --repeat 3
 * 输出：
 *   docs/evidence/mcp-entry/logs/stdio-summary.json      用规范序列化器归一（去机器路径/UUID）
 *   docs/evidence/mcp-entry/consistency.json
 *
 * 规范序列化器是 scripts/evidence-json.ts（`src/test/evidenceRepro.test.ts` 的守卫
 * 会扫描 docs/evidence 下所有 JSON），这里不另写一套清洗规则。
 */
import './../mcp/register-ts.mjs'
import { readFileSync, writeFileSync } from 'node:fs'

const { serializeEvidence } = await import('./evidence-json.ts')

const root = new URL('..', import.meta.url).pathname
const log = readFileSync(`${root}docs/evidence/mcp-entry/logs/test-mcp-green.log`, 'utf8')
const rows = log
  .split('\n')
  .filter((line) => line.startsWith('{"length"'))
  .map((line) => JSON.parse(line))
if (rows.length !== 4) {
  throw new Error(`期望 4 组判据行，实际 ${rows.length}`)
}

const smokePath = `${root}docs/evidence/mcp-entry/logs/stdio-summary.json`
const smoke = JSON.parse(readFileSync(smokePath, 'utf8'))
writeFileSync(smokePath, serializeEvidence(smoke))

const evidence = {
  task: 'MCP 通用入口',
  baseline: 'main = aacdab8',
  note: '四组判据值：服务端路径 createRequirementProject → computeCandidateRequirementCheck；MCP 路径 calc_chain → check_requirement。',
  rows: rows.map((row) => ({
    length: row.length,
    server: row.server,
    mcp: {
      nominalQ: row.mcp.nominalQ,
      minQ: row.mcp.minQ,
      maxQ: row.mcp.maxQ,
      toleranceQ: row.mcp.toleranceQ,
      status: row.mcp.status,
    },
    mcpMargins: row.mcp.margins,
    equal: row.equal,
  })),
  allEqual: rows.every((row) => row.equal === true),
  stdio: {
    node: smoke.node,
    runs: smoke.runs,
    toolNames: smoke.toolNames,
    anyError: smoke.anyError,
    idempotency: smoke.idempotency,
  },
}
writeFileSync(
  `${root}docs/evidence/mcp-entry/consistency.json`,
  serializeEvidence(evidence),
)
process.stdout.write(
  `wrote consistency.json：${rows.length} 行，allEqual=${evidence.allEqual}，allByteIdentical=${smoke.idempotency.every((item) => item.byteIdentical)}\n`,
)
