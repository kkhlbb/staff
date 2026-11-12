#!/usr/bin/env node
/**
 * 真实文档抽取基线：一条命令出全部数字。
 *
 *   node scripts/real-doc-metrics.mjs                     # 度量 + 与 baseline.json 对比
 *   node scripts/real-doc-metrics.mjs --update-baseline --reason "……"
 *
 * 语料从 REAL_DOC_CORPUS 读取（默认 ~/DSH/tmp/cunlian-v36/real-docs）。
 * 语料缺失或与 manifest 的 SHA-256/字节数不符 → CORPUS_MISSING / CORPUS_MISMATCH，退出 1；
 * 绝不静默跳过、绝不用别的文件顶替。数字与 baseline.json 不一致 → 打印逐项差异并退出 3，
 * 必须显式 --update-baseline 并写明原因（防止悄悄退化）。
 *
 * 本脚本只度量：不改抽取规则、不改阈值、不清洗原文。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASELINE_RELATIVE_PATH,
  CorpusError,
  MANIFEST_RELATIVE_PATH,
  METRICS_RELATIVE_PATH,
  defaultCorpusDir,
  diffMeasured,
  measuredPayload,
  measureCorpus,
} from './real-docs/metrics.mjs'
import { loadEvidenceJson } from './real-docs/tsImport.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const options = { updateBaseline: false, reason: null, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--update-baseline') options.updateBaseline = true
    else if (arg === '--reason') options.reason = argv[(index += 1)] ?? null
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`未知参数：${arg}`)
  }
  return options
}

const percent = (value) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`)

function printTable(measured) {
  const rule = measured.rules
  console.log(
    `提取器 ${rule.extractorVersion}｜页数上限 ${rule.maxExtractionPages}｜` +
      `候选上限 ${rule.maxExtractionCandidates}｜问题上限 ${rule.maxExtractionIssues}`,
  )
  console.log(
    `文本读取预算（仅度量放大，不影响规则）：maxTextItems=${rule.readBudget.maxTextItems}，` +
      `timeoutMs=${rule.readBudget.timeoutMs}`,
  )
  console.log('')
  const header = ['文档', '语言', '页数', '文本项', '候选', 'pending', 'blocked', '可确认率', '阻塞率', 'PageLimit']
  const rows = measured.documents.map((doc) => [
    `${doc.id} ${doc.file}`,
    doc.language,
    String(doc.pages),
    String(doc.textItems),
    String(doc.candidates.total),
    String(doc.candidates.pending),
    String(doc.candidates.blocked),
    percent(doc.candidates.total === 0 ? null : doc.candidates.pending / doc.candidates.total),
    percent(doc.candidates.total === 0 ? null : doc.candidates.blocked / doc.candidates.total),
    doc.pageLimit === null ? '-' : 'PAGE_LIMIT',
  ])
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column].length)),
  )
  const format = (row) => row.map((cell, column) => cell.padEnd(widths[column])).join('  ')
  console.log(format(header))
  console.log(widths.map((width) => '-'.repeat(width)).join('  '))
  for (const row of rows) console.log(format(row))
  console.log('')
  for (const doc of measured.documents) {
    const issues = doc.issues.byCode.map((item) => `${item.code}×${item.count}`).join(', ') || '无'
    const reasonCodes = doc.blockedReasonCodes.map((item) => `${item.code}×${item.count}`).join(', ') || '无'
    console.log(`${doc.id} 阻塞原因码：${reasonCodes}`)
    console.log(`${doc.id} 问题码：${issues}；无文本层页：${doc.issues.noTextLayerPages.join(',') || '无'}`)
  }
  console.log('')
  const summary = measured.summary
  console.log(
    `汇总：${summary.documents} 份 / ${summary.pages} 页 / 候选 ${summary.candidates.total}` +
      `（pending ${summary.candidates.pending}｜blocked ${summary.candidates.blocked}｜confirmed ${summary.candidates.confirmed}）`,
  )
  console.log(
    `可确认率 = pending/候选 = ${summary.candidates.pending}/${summary.candidates.total} = ` +
      `${percent(summary.confirmableRate)}；阻塞率 = ${percent(summary.blockedRate)}`,
  )
  console.log(
    `PAGE_LIMIT 文档：${summary.pageLimitDocuments.join(',') || '无'}；` +
      `NO_TEXT_LAYER 页数：${summary.noTextLayerPages}`,
  )
  console.log(
    `原因码 Top5：${summary.reasonCodeTop5.map((item) => `${item.code}×${item.count}`).join(', ') || '无'}`,
  )
  console.log('')
  for (const probe of summary.pageRangeProbe) {
    const codes = probe.blockedReasonCodes.map((item) => `${item.code}×${item.count}`).join(', ') || '无'
    console.log(
      `页范围探针 ${probe.id}：候选 ${probe.candidates.total}（pending ${probe.candidates.pending}｜` +
        `blocked ${probe.candidates.blocked}）；阻塞原因码 ${codes}；` +
        `问题码 ${probe.issues.byCode.map((item) => `${item.code}×${item.count}`).join(', ') || '无'}；` +
        `无文本层页 ${probe.issues.noTextLayerPages.join(',') || '无'}`,
    )
  }
}

async function writeEvidence(file, value, evidenceJson) {
  mkdirSync(path.dirname(file), { recursive: true })
  const text = evidenceJson.serializeEvidence(value)
  const violations = evidenceJson.evidenceViolations(text)
  if (violations.length > 0) {
    throw new Error(`${file} 未通过证据守卫：${violations.join(', ')}`)
  }
  if (evidenceJson.serializeEvidence(JSON.parse(text)) !== text) {
    throw new Error(`${file} 的序列化不可幂等`)
  }
  writeFileSync(file, text)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(
      '用法：node scripts/real-doc-metrics.mjs [--update-baseline --reason "<为什么数字变了>"]\n' +
        '环境变量：REAL_DOC_CORPUS（默认 ~/DSH/tmp/cunlian-v36/real-docs）',
    )
    return 0
  }
  const corpusDir = process.env.REAL_DOC_CORPUS ?? defaultCorpusDir()
  const manifestPath = path.join(repoRoot, MANIFEST_RELATIVE_PATH)
  const measured = await measureCorpus({ manifestPath, corpusDir })
  const evidenceJson = await loadEvidenceJson()

  printTable(measured)
  console.log('')
  console.log(`语料目录：${corpusDir}（manifest：${MANIFEST_RELATIVE_PATH}）`)

  const metricsPath = path.join(repoRoot, METRICS_RELATIVE_PATH)
  await writeEvidence(metricsPath, measured, evidenceJson)
  console.log(`已写 ${METRICS_RELATIVE_PATH}`)

  const baselinePath = path.join(repoRoot, BASELINE_RELATIVE_PATH)
  if (options.updateBaseline) {
    if (options.reason === null || options.reason.trim() === '') {
      throw new Error('--update-baseline 必须同时给出 --reason（说明数字为什么变化）')
    }
    const previous = existsSync(baselinePath)
      ? JSON.parse(readFileSync(baselinePath, 'utf8'))
      : null
    const diffs = previous === null ? [] : diffMeasured(measuredPayload(measured), measuredPayload(previous))
    await writeEvidence(
      baselinePath,
      { ...measured, baselineReason: options.reason.trim() },
      evidenceJson,
    )
    console.log(`已更新 ${BASELINE_RELATIVE_PATH}（原因：${options.reason.trim()}）`)
    for (const diff of diffs) {
      console.log(`  变化 ${diff.path}: ${JSON.stringify(diff.expected)} → ${JSON.stringify(diff.actual)}`)
    }
    if (diffs.length > 0 && previous !== null) {
      console.log(`  相对旧基线共 ${diffs.length} 处变化，已随本次更新记录在提交说明里。`)
    }
    return 0
  }

  if (!existsSync(baselinePath)) {
    console.log(`未找到 ${BASELINE_RELATIVE_PATH}；用 --update-baseline --reason "首次建立基线" 生成。`)
    return 3
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  if (typeof baseline.baselineReason !== 'string' || baseline.baselineReason.trim() === '') {
    throw new Error(`${BASELINE_RELATIVE_PATH} 缺少 baselineReason；基线必须写明数字成立的原因`)
  }
  const diffs = diffMeasured(measuredPayload(measured), measuredPayload(baseline))
  if (diffs.length === 0) {
    console.log(`BASELINE MATCH：与 ${BASELINE_RELATIVE_PATH} 完全一致（${measured.summary.documents} 份文档）`)
    return 0
  }
  console.log(`BASELINE DIFF：与 ${BASELINE_RELATIVE_PATH} 有 ${diffs.length} 处差异`)
  for (const diff of diffs) {
    console.log(`  ${diff.path}: 基线=${JSON.stringify(diff.expected)} 实测=${JSON.stringify(diff.actual)}`)
  }
  console.log(
    '数字变化必须显式更新基线并说明原因：\n' +
      '  node scripts/real-doc-metrics.mjs --update-baseline --reason "<为什么变化：规则/阈值/语料/依赖>"',
  )
  return 3
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    if (error instanceof CorpusError) {
      console.error(`${error.code}: ${error.message}`)
      process.exitCode = 1
      return
    }
    console.error(`METRICS_FAILED: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 4
  })
