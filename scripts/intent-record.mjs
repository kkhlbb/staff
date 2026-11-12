#!/usr/bin/env node
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
  realModel: {
    status: 'BLOCKED',
    reason: '本机没有 DEEPSEEK_API_KEY（环境变量与 Keychain com.kkhlbb.cunlian.model 均不存在），真实模型 3 条未执行；不记为通过。',
  },
  uiTextLeak: {
    fixed: '侧栏离线演示提示改为“已启动离线演示（本机假模型）”；界面不出现 fake- 与任务实例号（AgentSidebar.test.tsx 守卫）',
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
