#!/usr/bin/env node
import { INTENT_CASES, recordsStatus } from './evidence-status.mjs'
/**
 * 生成 docs/evidence/intent-project/evidence.json（走 serializeEvidence）。
 *
 *   node scripts/intent-record.mjs
 *
 * 只从已生成的产物读数：真实语料基线、候选身份快照、变异日志、走查结果与门禁日志。
 * 不手写结论，也不复制一份“新的度量”。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEvidenceJson } from './real-docs/tsImport.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(repoRoot, 'docs/evidence/intent-project')
const read = (relative) => JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'))
const log = (name) => {
  const file = path.join(dir, 'logs', name)
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}
const mutationLog = (name) => {
  const file = path.join(dir, 'mutations', name)
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
const baseline = read('docs/evidence/real-doc-baseline/baseline.json')
const after = read('docs/evidence/intent-project/real-docs-candidates-after.json')
const step2 = read('docs/evidence/evidence-ref/real-docs-candidates-after.json')
const e2e = read('docs/evidence/intent-project/e2e-result.json')

const afterByDoc = new Map(after.documents.map((doc) => [doc.id, doc]))
const step2ByDoc = new Map(step2.documents.map((doc) => [doc.id, doc]))

const documents = baseline.documents.map((row) => {
  const now = afterByDoc.get(row.id)
  const before = step2ByDoc.get(row.id)
  if (now === undefined || before === undefined) throw new Error(`缺少候选身份快照：${row.id}`)
  return {
    id: row.id,
    file: row.file,
    pages: row.pages,
    candidates: row.candidates.total,
    pending: row.candidates.pending,
    blocked: row.candidates.blocked,
    idempotencyKey: now.idempotencyKey,
    draftId: now.draftId,
    candidateArraySha256: now.candidateArraySha256,
    identicalToStep2: now.candidateArraySha256 === before.candidateArraySha256,
  }
})

const testsFrom = (text) => text.match(/\n\s*Tests\s+([^\n]+)/u)?.[1]?.trim() ?? null

const payload = {
  adr: 'ADR-001 第 3 步：意图驱动建件（无任务书入口）',
  branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
  baselineCommit: 'f79d73b',
  implementationCommit: git(['log', '--format=%h', '-1', '--', 'src/intent', 'desktop/main/intentProject.ts']),
  rules: after.rules,
  pdfPath: {
    corpus: '本机真实语料：6 份 PDF / 269 页（目录写在 logs/01-metrics.log 的“语料目录”）',
    baselineMatch: log('01-metrics.log').includes('BASELINE MATCH'),
    totals: baseline.summary.candidates,
    pageRangeProbe: baseline.summary.pageRangeProbe,
    documents,
    candidatesByteIdenticalToStep2:
      readFileSync(path.join(repoRoot, 'docs/evidence/intent-project/real-docs-candidates-after.json'), 'utf8') ===
      readFileSync(path.join(repoRoot, 'docs/evidence/evidence-ref/real-docs-candidates-after.json'), 'utf8'),
  },
  schema: {
    projectFile: '9 → 10（加法：sourceKind / actorId / sessionSeq / sessionLabel / attestations；条款来源支持 user-attestation）',
    dbVersion: 'PROJECT_DB_VERSION 未变（IndexedDB store 结构未动）',
    schema9Read: 'sourceKind=pdf、账本为空，不重算不改值（schema10.test.ts 4 条）',
  },
  mutations: {
    M25: {
      description: '删掉 setRequirement 的用户原话/数值校验',
      domain: testsFrom(mutationLog('M25-red.log')),
      desktop: testsFrom(mutationLog('M25-desktop-red.log')),
      restored: testsFrom(mutationLog('M25-green.log')),
    },
    M26: {
      description: '去掉图纸“依据：用户输入，无外部原文件”标记',
      desktop: testsFrom(mutationLog('M26-red.log')),
      restored: testsFrom(mutationLog('M26-green.log')),
    },
  },
  e2e: {
    verdict: e2e.verdict,
    checks: e2e.checks,
    screenshots: e2e.screenshots,
    limitation: e2e.limitation,
  },
  export: {
    dxfFileName: log('14-export.log').match(/DXF_FILE (\S+)/u)?.[1] ?? null,
    dxfBytes: log('14-export.log').match(/bytes=(\d+)/u)?.[1] ?? null,
    dxfSha256: log('14-export.log').match(/sha256=([0-9a-f]{64})/u)?.[1] ?? null,
    note: '真实导出代码路径 + 注入路径选择端口（原生对话框需要辅助功能权限）',
  },
  gates: {
    typecheck: log('20-typecheck.log').includes('EXIT=0'),
    typecheckDesktop: log('21-typecheck-desktop.log').includes('EXIT=0'),
    lint: log('22-lint.log').includes('EXIT=0'),
    test: testsFrom(log('23-test.log')),
    testDesktop: testsFrom(log('24-test-desktop.log')),
    intentDesktop: testsFrom(log('13-intent-desktop.log')),
    build: log('10-build.log').includes('built in'),
    package: log('11-package.log').includes('RESULT PASS'),
    packagedPdfWorker: log('12-check-pdf-worker.log').includes('RESULT PASS'),
  },
  realModel: (() => {
    const file = path.join(dir, 'real-model-results.json')
    if (!existsSync(file)) {
      return { status: 'BLOCKED', reason: '本机没有 DEEPSEEK_API_KEY；真实模型 3 条未执行，不记为通过。' }
    }
    const result = JSON.parse(readFileSync(file, 'utf8'))
    const assessment = recordsStatus(result, INTENT_CASES)
    if (['INVALID', 'NOT_RUN'].includes(assessment.status)) return { status: assessment.status, reason: '预期 D1/D2/D3/D3b，必填回执和非空断言未满足', assessment }
    const items = result.records.map((record) => ({
      item: record.item,
      outcome: record.outcome,
      taskState: record.taskState,
      taskErrorCode: record.taskErrorCode,
      tools: record.toolCallNames,
      toolCalls: record.toolCalls.length,
      modelCalls: record.modelCalls,
      tokens: record.modelUsage,
      durationMs: record.durationMs,
      assertions: record.assertions.map((assertion) => ({ name: assertion.name, ok: assertion.ok })),
      notes: record.notes,
    }))
    return {
      status: assessment.status,
      switch: 'INTENT_REAL_MODEL=1 且 DEEPSEEK_API_KEY 有值（密钥只从 $HERMES_HOME/.env 读进进程，不落盘）',
      command: 'INTENT_REAL_MODEL=1 npx vitest run --config vitest.desktop.config.ts desktop/tests/intentRealModel.test.ts',
      testFile: 'desktop/tests/intentRealModel.test.ts',
      adapter: result.adapter,
      providerProbe: result.providerProbe,
      identity: result.identity,
      cost: result.cost,
      items,
      rawReceipts: 'logs/25-intent-real-model-raw.log（逐条原始回执：模型给的参数 + 应用返回的 ToolResult）',
      log: testsFrom(log('25-intent-real-model.log')),
    }
  })(),
  uiTextLeak: {
    fixed: '侧栏离线演示提示改为“已启动离线演示（本机假模型）”；界面不出现 fake- 与任务实例号（AgentSidebar.test.tsx 守卫）',
    guardRed: testsFrom(log('26-guard-red.log')),
    guardGreen: testsFrom(log('27-guard-green.log')),
    mutation: '临时把提示改回带 modelId 与 taskId（旧写法），守卫用例红；恢复后绿',
  },
  drawingVersion: {
    before: '标题栏版本栏留空时印「草稿 rev-<内部版本 id>」，内部 UUID 直接画在图上',
    after: '生成新图时写「草稿 · 第 N 版」（N = 该项目版本序号：预览/提交按现存版本数 + 1，图纸面板按当前版本数），字符串随图纸记录持久化，UUID 只留在项目文件里',
    legacy: '旧记录（frameFields.version 为空的已保存图纸）保持原回退文字：dataFingerprint 是用它算的，换字会让旧项目打不开（draftSyncLegacy 已实测）。下一次改图/保存即写入可读版本号',
    assertions: [
      'src/drawing/spacerDrawing.test.ts：新图写「草稿 · 第 3 版」；旧记录保持回退文字；两种形态的 SVG <text> 都不出现 ≥32 位连续十六进制串',
      'desktop/tests/intentProject.test.ts：提交后版本栏 = 草稿 · 第 2 版（fileRevisions 数），SVG 可见文字不含 revisionId 与 ≥32 位十六进制串',
    ],
    note: 'SVG 根节点仍带 data-drawing-fingerprint（机器元数据，不画在图上）；重建只读持久化后的版本字符串，指纹不随版本数变化',
  },
}

const evidenceJson = await loadEvidenceJson()
const text = evidenceJson.serializeEvidence(payload)
const violations = evidenceJson.evidenceViolations(text)
if (violations.length > 0) {
  console.error('EVIDENCE_VIOLATIONS', violations)
  process.exit(1)
}
writeFileSync(path.join(dir, 'evidence.json'), text)
console.log('EVIDENCE_WRITTEN docs/evidence/intent-project/evidence.json')
