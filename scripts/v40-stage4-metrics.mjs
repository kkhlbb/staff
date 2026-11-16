#!/usr/bin/env node
/**
 * 从真实模型证据 JSON 计算指标表（§12），不手工填数。
 * 用法：node scripts/v40-stage4-metrics.mjs
 * 输出：docs/evidence/v40-stage4/metrics.json 与 metrics.md
 */
import fs from 'node:fs/promises'
import { A40_CASES, recordsStatus, recordStatus } from './evidence-status.mjs'
import path from 'node:path'
import { serializeEvidence } from './evidence-json.ts'

const SRC = 'docs/evidence/v40-stage4/a40-real-results.json'
const data = JSON.parse(await fs.readFile(SRC, 'utf8'))
const assessment = recordsStatus(data, A40_CASES)
if (['INVALID', 'NOT_RUN'].includes(assessment.status)) {
  console.error(JSON.stringify(assessment))
  process.exit(1)
}
const records = assessment.records

const tools = records.flatMap((record) => record.toolReceipts ?? [])
const toolTotal = tools.length
const toolOk = tools.filter((tool) => tool.errorCode === null).length
const modelCalls = records.reduce((sum, record) => sum + (record.modelCalls ?? 0), 0)
const byItem = new Map()
for (const record of records) {
  if (!byItem.has(record.item)) byItem.set(record.item, [])
  byItem.get(record.item).push(record)
}
const askCount = records.filter((record) => record.toolReceipts?.some((tool) => tool.errorCode === 'NEEDS_CLARIFICATION' || tool.errorCode === 'NOT_CONFIRMED')).length
const recoveries = records.filter((record) => record.notes?.some((note) => /STALE_BASE|STALE_PREVIEW|恢复|重试/u.test(note))).length
const toolFailures = toolTotal - toolOk
const durations = [...byItem.entries()].map(([item, items]) => ({
  item,
  attempts: items.length,
  pass: items.filter((record) => recordStatus(record) === 'PASS').length,
  durationsMs: items.map((record) => record.durationMs),
  states: items.map((record) => `${record.taskState}${record.taskErrorCode === null ? '' : `/${record.taskErrorCode}`}`),
  failures: items.filter((record) => record.outcome === 'FAIL').map((record) => ({
    attempt: record.attempt,
    taskState: record.taskState,
    taskErrorCode: record.taskErrorCode,
    failedChecks: (record.assertions ?? []).filter((assertion) => !assertion.ok).map((assertion) => assertion.name),
    notes: record.notes ?? [],
  })),
}))

const metrics = {
  status: assessment.status,
  toolCalls: { total: toolTotal, ok: toolOk, failed: toolFailures, successRate: toolTotal === 0 ? null : Number((toolOk / toolTotal).toFixed(4)) },
  modelCalls,
  userSupplements: askCount,
  manualBackfill: 0,
  failureRecoveries: recoveries,
  byItem: durations,
  cost: data.cost ?? null,
  pricing: data.pricing ?? null,
  providerProbe: data.providerProbe ?? null,
  note: '人工回填 = 交付方手工填写工程数值的次数；本次为 0（所有数值来自提取候选或用户确认）。A40-02b 的 12.00 由用户在参数面板补充，并带「用户输入」来源备注，不属于交付方回填。',
}
await fs.writeFile('docs/evidence/v40-stage4/metrics.json', serializeEvidence(metrics))

const rows = durations.map((item) => `| ${item.item} | ${item.attempts} | ${item.pass} | ${item.durationsMs.join(' / ')} | ${item.states.join(' / ')} |`).join('\n')
const markdown = `# V4.0 阶段 4 指标（由脚本从 evidence JSON 计算）

- 工具调用：${toolOk}/${toolTotal} 成功（成功率 ${metrics.toolCalls.successRate === null ? 'n/a' : `${(metrics.toolCalls.successRate * 100).toFixed(1)}%`}），失败 ${toolFailures}
- 模型调用：${modelCalls} 次
- 用户补资料（追问答疑）次数：${askCount}
- 人工回填数值次数：0
- 失败恢复记录次数：${recoveries}
- 成本（按官网 off-peak 价估算，USD）：${data.cost?.estimatedUsd ?? 'n/a'}（prompt ${data.cost?.promptTokens ?? 0} / completion ${data.cost?.completionTokens ?? 0} / cache hit ${data.cost?.cacheHitTokens ?? 0} / cache miss ${data.cost?.cacheMissTokens ?? 0}）
- 供应商回执模型：${data.providerProbe?.model ?? 'n/a'}（请求 ${data.adapter?.modelRequested}，适配器 ${data.adapter?.id}）

| 项目 | 尝试 | 通过 | 尝试耗时 ms | 任务状态 |
|---|---|---|---|---|
${rows}
`
await fs.writeFile('docs/evidence/v40-stage4/metrics.md', markdown)
console.log(markdown)
if (assessment.status !== 'PASS') process.exitCode = 1
