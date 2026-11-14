/**
 * 真实文档基线（v3.6 真实文档 6 份）的度量核心。
 *
 * 本文件只做三件事：按 manifest 校验语料、跑真实提取器、汇总计数。
 * 不改抽取规则、不改阈值、不清洗原文 —— 度量脚本一旦改动规则，
 * baseline.json 的对比就失去意义。
 *
 * 与产品链路的一致性：
 *   pdfjs legacy getTextContent → buildPdfTextLayer → buildExtractionDraft
 * 与 desktop/main/extractionService.ts 相同；唯一差别是文本读取预算（见 READ_BUDGET）。
 *
 * 为什么不能用 node 直接 import src/*.ts：仓库内的 TS 相对导入没有扩展名，
 * node 的类型剥离不做扩展名补全，因此由 tsImport.mjs 注册解析钩子后再动态导入。
 * 这样 `node scripts/real-doc-metrics.mjs` 一条命令即可运行，不需要先构建。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { loadExtraction, loadPdfTextExtract } from './tsImport.mjs'

/** manifest 固定在证据目录：仓库只提交清单，不提交 PDF 字节。 */
export const MANIFEST_RELATIVE_PATH = 'docs/evidence/real-doc-baseline/corpus-manifest.json'
export const METRICS_RELATIVE_PATH = 'docs/evidence/real-doc-baseline/metrics.json'
export const BASELINE_RELATIVE_PATH = 'docs/evidence/real-doc-baseline/baseline.json'

/** 默认语料目录（可用 REAL_DOC_CORPUS 覆盖）。 */
export function defaultCorpusDir(home = process.env.HOME) {
  return path.join(home ?? '', 'DSH/tmp/cunlian-v36/real-docs')
}

/**
 * 文本读取预算：产品默认是 20,000 项 / 20 s，超了整份拒绝读取。
 * 度量要看到 buildExtractionDraft 的判定（尤其 r4 的 100 页 PAGE_LIMIT），
 * 而 r4 全篇有 9 万多文本项，用产品默认预算会先在“读取预算”处失败，
 * 看不到页数规则。因此这里只放大“读取预算”，页数/候选数/问题数规则一概不动；
 * 实际用量记在 metrics.json 的 readBudget 里。
 */
export const READ_BUDGET = { maxTextItems: 200000, timeoutMs: 300000 }

/** 超预算文档的附加探针：只取前 20 页，单独记一行。 */
export const PAGE_RANGE_PROBE_PAGES = 20

export class CorpusError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'CorpusError'
    this.code = code
    this.details = details
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** 读取并校验 manifest 结构；字段缺失直接报错，不猜默认值。 */
export function loadManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    throw new CorpusError('CORPUS_MANIFEST_INVALID', `manifest 不存在：${manifestPath}`)
  }
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!Array.isArray(raw.documents) || raw.documents.length === 0) {
    throw new CorpusError('CORPUS_MANIFEST_INVALID', 'manifest.documents 必须是非空数组')
  }
  const seen = new Set()
  for (const doc of raw.documents) {
    const problems = []
    for (const field of ['id', 'file', 'bytes', 'sha256', 'pages', 'language', 'source']) {
      if (doc[field] === undefined || doc[field] === null || doc[field] === '') {
        problems.push(field)
      }
    }
    if (problems.length > 0) {
      throw new CorpusError(
        'CORPUS_MANIFEST_INVALID',
        `manifest 条目缺少字段 ${problems.join(',')}：${JSON.stringify(doc)}`,
      )
    }
    if (!/^[0-9a-f]{64}$/u.test(doc.sha256)) {
      throw new CorpusError('CORPUS_MANIFEST_INVALID', `${doc.file} 的 sha256 不是 64 位小写十六进制`)
    }
    if (!Number.isSafeInteger(doc.bytes) || doc.bytes <= 0) {
      throw new CorpusError('CORPUS_MANIFEST_INVALID', `${doc.file} 的 bytes 必须是正整数`)
    }
    if (!Number.isSafeInteger(doc.pages) || doc.pages <= 0) {
      throw new CorpusError('CORPUS_MANIFEST_INVALID', `${doc.file} 的 pages 必须是正整数`)
    }
    if (seen.has(doc.id)) {
      throw new CorpusError('CORPUS_MANIFEST_INVALID', `manifest 里 id 重复：${doc.id}`)
    }
    seen.add(doc.id)
  }
  return raw
}

/**
 * 严格校验语料：缺失的、字节数不符的、SHA-256 不符的一次报全，绝不跳过/顶替。
 * 返回顺序与 manifest 一致。
 */
export function verifyCorpus(manifest, corpusDir) {
  const missing = []
  const mismatched = []
  const verified = []
  for (const doc of manifest.documents) {
    const absolutePath = path.join(corpusDir, doc.file)
    if (!existsSync(absolutePath)) {
      missing.push({ id: doc.id, file: doc.file, absolutePath })
      continue
    }
    const bytes = readFileSync(absolutePath)
    const actualSha256 = sha256(bytes)
    if (bytes.byteLength !== doc.bytes || actualSha256 !== doc.sha256) {
      mismatched.push({
        id: doc.id,
        file: doc.file,
        expectedBytes: doc.bytes,
        actualBytes: bytes.byteLength,
        expectedSha256: doc.sha256,
        actualSha256,
      })
      continue
    }
    verified.push({ doc, absolutePath, bytes, sha256: actualSha256 })
  }
  if (missing.length > 0 || mismatched.length > 0) {
    const lines = []
    for (const item of missing) lines.push(`MISSING ${item.file}（期望在 ${item.absolutePath}）`)
    for (const item of mismatched) {
      lines.push(
        `MISMATCH ${item.file}：期望 ${item.expectedBytes} B / ${item.expectedSha256}，` +
          `实际 ${item.actualBytes} B / ${item.actualSha256}`,
      )
    }
    const code = missing.length > 0 && mismatched.length === 0 ? 'CORPUS_MISSING' : 'CORPUS_MISMATCH'
    throw new CorpusError(
      code,
      `语料校验失败（${corpusDir}）：\n${lines.join('\n')}\n` +
        '本任务不允许静默跳过或用别的文件顶替；请按 README 获取这 6 份并放在 REAL_DOC_CORPUS 目录。',
      { missing, mismatched },
    )
  }
  return verified
}

/** pdfjs 读页数；页数只用于核对 manifest 并决定全篇页范围。 */
async function countPages(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, verbosity: 0 })
  try {
    const document = await task.promise
    return document.numPages
  } finally {
    try {
      await task.destroy()
    } catch {
      /* 释放失败不影响已读到的页数 */
    }
  }
}

/** 统计候选状态；confirmed 在全新草稿里必须为 0（没有人工决定）。 */
function countStatuses(candidates) {
  const counts = { pending: 0, blocked: 0, confirmed: 0, rejected: 0, stale: 0 }
  for (const candidate of candidates) {
    counts[candidate.status] = (counts[candidate.status] ?? 0) + 1
  }
  return counts
}

/** 状态 + 阻塞原因码的快照，用于“补单位前 / 后 / 撤销后”逐项核对。 */
function statusSnapshot(candidates) {
  const counts = countStatuses(candidates)
  return {
    pending: counts.pending,
    blocked: counts.blocked,
    confirmed: counts.confirmed,
    reasonCodes: countBy(
      candidates
        .filter((candidate) => candidate.status === 'blocked')
        .flatMap((candidate) => candidate.reasonCodes),
    ),
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function countBy(values) {
  const map = new Map()
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1)
  return [...map.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
}

function kindCounts(candidates) {
  return countBy(candidates.map((candidate) => candidate.kind))
}

function issueSummary(issues) {
  const blocked = issues.filter((issue) => issue.severity === 'blocked')
  return {
    total: issues.length,
    blocked: blocked.length,
    warning: issues.length - blocked.length,
    byCode: countBy(issues.map((issue) => issue.code)),
    noTextLayerPages: issues
      .filter((issue) => issue.code === 'NO_TEXT_LAYER' && issue.page !== null)
      .map((issue) => issue.page)
      .sort((a, b) => a - b),
  }
}

/** Exact decimal -> q; no floating-point tolerance or rounding. */
function truthQ(value) {
  const text = String(value)
  if (!/^[+\-]?\d+(?:\.\d{1,4})?$/u.test(text)) throw new Error(`Invalid ground truth number: ${text}`)
  const [integer, fraction = ''] = text.replace(/^[+\-]/u, '').split('.')
  return Number(BigInt(integer) * 10000n + BigInt(fraction.padEnd(4, '0'))) * (text.startsWith('-') ? -1 : 1)
}

/** A crop must exist and really be a PNG before any field counts as checked. */
function validTruthCrop(truth) {
  if (truth.verifiedBy !== 'render-crop' || !truth.originalText?.trim() ||
      typeof truth.cropFile !== 'string' || !/^crops\/[\w./-]+\.png$/u.test(truth.cropFile) ||
      truth.cropFile.split('/').includes('..')) return false
  const file = new URL(`../../docs/evidence/ground-truth/${truth.cropFile}`, import.meta.url)
  return existsSync(file) && readFileSync(file).subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
}

/** Match by document/page/geometry (and stable ID where recorded), NEVER by numeric value. */
export function compareGroundTruth(docId, candidates, truths) {
  const checked = new Set()
  const details = truths.filter(t => t.docId === docId).map(truth => {
    const located = candidates.filter(c => c.kind === 'ring' &&
      (!truth.candidateId || c.candidateId === truth.candidateId) && c.data.nominal?.evidence.some(e => {
        if (e.page !== truth.page) return false
        const [x0, y0, x1, y1] = e.rectPdf
        const x = (x0 + x1) / 2, y = (y0 + y1) / 2
        return x >= truth.rect[0] && x <= truth.rect[2] && y >= truth.rect[1] && y <= truth.rect[3]
      }))
    const distance = c => {
      const anchor = c.evidence?.find(e => e.page === truth.page) ?? c.data.nominal.evidence.find(e => e.page === truth.page)
      return Math.abs(anchor.rectPdf[0] - truth.rect[0])
    }
    const nearest = Math.min(...located.map(distance))
    const matches = located.filter(c => distance(c) === nearest)
    const pending = matches.filter(c => c.status === 'pending' && !checked.has(c.candidateId))
    const cropValid = validTruthCrop(truth) && (truth.deviationSources ?? []).every(source =>
      validTruthCrop({ ...source, verifiedBy: 'render-crop' }))
    // Ambiguous or absent crop evidence is not a successful verification.
    const verified = cropValid && pending.length === 1 ? pending : []
    const expectedQ = truthQ(truth.nominal)
    const fields = ['nominal', 'upperDeviation', 'lowerDeviation']
    const comparisons = verified.map(c => {
      checked.add(c.candidateId)
      const differences = fields.flatMap(field => {
        const expected = truth[field]
        const actual = c.data[field]?.valueQ ?? null
        const expectedValueQ = expected === null ? null : truthQ(expected)
        return actual === expectedValueQ ? [] : [{ field, expected: expectedValueQ, actual }]
      })
      return { candidateId: c.candidateId, differences }
    })
    return { docId, page: truth.page, rect: truth.rect, originalText: truth.originalText, expectedQ,
      cropFile: truth.cropFile ?? null, cropValid, pendingChecked: verified.length,
      wrongPending: comparisons.filter(c => c.differences.length > 0).length,
      nominalWrong: comparisons.filter(c => c.differences.some(d => d.field === 'nominal')).length,
      upperDeviationChecked: truth.upperDeviation === null ? 0 : verified.length,
      lowerDeviationChecked: truth.lowerDeviation === null ? 0 : verified.length,
      comparisons,
      matches: matches.map(c => ({ candidateId: c.candidateId, status: c.status, nominal: c.data.nominal?.text,
        valueQ: c.data.nominal?.valueQ, upperDeviation: c.data.upperDeviation?.text ?? null,
        lowerDeviation: c.data.lowerDeviation?.text ?? null, reasonCodes: c.reasonCodes })) }
  })
  const unchecked = candidates.filter(c => c.status === 'pending' && !checked.has(c.candidateId)).map(c => c.candidateId)
  const uncheckedDetails = unchecked.map(candidateId => ({ candidateId, reason:
    details.some(d => !d.cropValid && d.matches.some(c => c.candidateId === candidateId))
      ? 'missing-or-invalid-crop' : details.some(d => d.matches.some(c => c.candidateId === candidateId))
        ? 'ambiguous-match' : 'no-verified-truth-match' }))
  const uncheckedReasons = Object.fromEntries(countBy(uncheckedDetails.map(d => d.reason)).map(d => [d.code, d.count]))
  const sum = field => details.reduce((n, d) => n + d[field], 0)
  return { gtVersion: 'gt-02', pendingTotal: candidates.filter(c => c.status === 'pending').length,
    pendingChecked: checked.size, wrongPending: sum('wrongPending'), nominalChecked: checked.size,
    nominalWrong: sum('nominalWrong'), upperDeviationChecked: sum('upperDeviationChecked'),
    lowerDeviationChecked: sum('lowerDeviationChecked'), unchecked, uncheckedReasons, uncheckedDetails, details }
}

/**
 * 每份文档一行：页数、候选、状态、阻塞原因码、问题码。
 *
 * `unitAttestation` 非空时，按用户声明**真跑一遍**补单位（领域层同一函数），
 * 再按 batchId 整批撤销；三组数字（前 / 后 / 撤销后）都记在行里。任一步失败、
 * 或撤销后与原状态不一致，直接抛错——绝不只算操作成本、不改状态。
 */
async function measureDocument(entry, modules, unitAttestation = null) {
  const { buildExtractionDraft, buildPdfTextLayer, MAX_EXTRACTION_PAGES } = modules
  const { extractPdfTextPages } = await loadPdfTextExtract()
  const pages = await countPages(entry.bytes)
  if (pages !== entry.doc.pages) {
    throw new CorpusError(
      'CORPUS_MISMATCH',
      `${entry.doc.file} 的 SHA-256 与 manifest 一致，但页数不同：manifest=${entry.doc.pages}，` +
        `实际=${pages}。请确认 pdfjs 版本或文件来源，不要静默接受。`,
    )
  }
  const rawPages = await extractPdfTextPages(
    entry.bytes,
    { from: 1, to: pages },
    { ...READ_BUDGET },
  )
  const layer = buildPdfTextLayer(rawPages)
  const textItems = layer.pages.reduce((sum, page) => sum + page.items.length, 0)
  const textChars = layer.pages.reduce(
    (sum, page) => sum + page.items.reduce((inner, item) => inner + item.text.length, 0),
    0,
  )
  const source = {
    documentId: `real-doc-${entry.doc.id}`,
    revisionId: `real-doc-${entry.doc.id}-${entry.sha256.slice(0, 12)}`,
    sha256: entry.sha256,
    blobKey: `corpus:${entry.doc.file}`,
    pageCount: pages,
  }
  const draft = buildExtractionDraft({
    projectId: 'real-doc-baseline',
    baseToken: 'real-doc-baseline-1',
    source,
    pageRange: { from: 1, to: pages },
    layer,
  })
  let measuredDraft = draft
  let unitDetail = null
  if (unitAttestation !== null) {
    const result = attachUnitsAndVerify(draft, modules, unitAttestation)
    measuredDraft = result.attestedDraft
    unitDetail = result.detail
  }
  const statuses = countStatuses(measuredDraft.candidates)
  const blockedCandidates = measuredDraft.candidates.filter(
    (candidate) => candidate.status === 'blocked',
  )
  const pageLimitIssues = draft.issues.filter((issue) => issue.code === 'PAGE_LIMIT')
  const row = {
    id: entry.doc.id,
    file: entry.doc.file,
    language: entry.doc.language,
    pages,
    textItems,
    textChars,
    pageRange: draft.pageRange,
    extractorVersion: draft.extractorVersion,
    candidates: {
      total: measuredDraft.candidates.length,
      pending: statuses.pending,
      blocked: statuses.blocked,
      confirmed: statuses.confirmed,
      byKind: kindCounts(measuredDraft.candidates),
    },
    blockedReasonCodes: countBy(blockedCandidates.flatMap((candidate) => candidate.reasonCodes)),
    issues: issueSummary(draft.issues),
    pageLimit: pageLimitIssues.length > 0 ? { maxPages: MAX_EXTRACTION_PAGES, blocked: true } : null,
  }
  if (unitDetail !== null) row.unitAttestation = unitDetail
  return { row, draft: measuredDraft, layer, source, pages }
}

/**
 * 对一份草稿做「批量补单位 → 整批撤销」并逐项核对。
 *
 * 硬边界（任一失败就抛错，不产出“看起来对”的数字）：
 * 1. 只有 `isUnitOnlyCandidate` 的候选进批；公式/数值/单位不支持一条都不进来；
 * 2. 补单位后候选必须真的变 pending，且每条数值出处都能过完整性判据（由领域层保证）；
 * 3. 三类“不支持”的阻塞数在补单位前后必须完全不变；
 * 4. 撤销后 pending / blocked / 阻塞原因码必须与补单位前逐项相同。
 */
export function attachUnitsAndVerify(draft, modules, options) {
  const { attestCandidateUnits, isUnitOnlyCandidate, revokeUnitAttestations, NO_BATCH_BLOCKED_CODES } =
    modules
  const before = statusSnapshot(draft.candidates)
  const ids = draft.candidates
    .filter((candidate) => isUnitOnlyCandidate(candidate))
    .map((candidate) => candidate.candidateId)
  if (ids.length === 0) {
    throw new CorpusError('UNIT_ATTEST_EMPTY', `${options.label}: 没有任何“仅差单位”候选，拒绝伪造补单位记录`)
  }
  const attested = attestCandidateUnits(draft, {
    candidateIds: ids,
    statement: options.statement,
    actor: options.actor,
    decidedAt: options.at,
    sessionSeq: options.sessionSeq,
    turnId: options.turnId,
    sessionLabel: null,
  })
  if (!attested.ok) {
    throw new CorpusError('UNIT_ATTEST_FAILED', `${options.label}: ${attested.code}: ${attested.message}`)
  }
  const afterCandidates = attested.value.draft.candidates
  const after = statusSnapshot(afterCandidates)
  const converted = ids.filter(
    (candidateId) =>
      afterCandidates.find((candidate) => candidate.candidateId === candidateId)?.status ===
      'pending',
  ).length
  if (converted !== ids.length) {
    throw new CorpusError(
      'UNIT_ATTEST_INCOMPLETE',
      `${options.label}: 仅 ${converted}/${ids.length} 条真的从 blocked 变成 pending，拒绝接受`,
    )
  }
  const preserved = {}
  for (const code of NO_BATCH_BLOCKED_CODES) {
    const beforeCount = before.reasonCodes.find((item) => item.code === code)?.count ?? 0
    const afterCount = after.reasonCodes.find((item) => item.code === code)?.count ?? 0
    if (beforeCount !== afterCount) {
      throw new CorpusError(
        'UNIT_ATTEST_SCOPE',
        `${options.label}: ${code} 的阻塞数从 ${beforeCount} 变成 ${afterCount}；补单位不许碰这三类`,
      )
    }
    preserved[code] = afterCount
  }
  const revoke = revokeUnitAttestations(attested.value.draft, {
    batchId: attested.value.batchId,
    actor: options.actor,
    decidedAt: options.at,
    reason: options.revokeReason,
  })
  if (!revoke.ok) {
    throw new CorpusError('UNIT_REVOKE_FAILED', `${options.label}: ${revoke.code}: ${revoke.message}`)
  }
  const reverted = statusSnapshot(revoke.value.draft.candidates)
  if (!sameJson(before, reverted)) {
    throw new CorpusError(
      'UNIT_REVOKE_INCOMPLETE',
      `${options.label}: 撤销后没有回到补单位前（前 ${JSON.stringify(before)}；撤销后 ${JSON.stringify(reverted)}）`,
    )
  }
  return {
    attestedDraft: attested.value.draft,
    revertedDraft: revoke.value.draft,
    detail: {
      statement: options.statement,
      actor: options.actor,
      turnId: options.turnId,
      sessionSeq: options.sessionSeq,
      batchId: attested.value.batchId,
      declared: ids.length,
      converted,
      decisionCount: attested.value.decisionIds.length,
      preservedBlocked: preserved,
      before,
      after,
      reverted,
      revokeRestored: true,
    },
  }
}

/** 汇总：可确认率 = pending / 候选总数；页码/文本层计数单独列。 */
export function summarize(rows, probe, rules) {
  const sum = (pick) => rows.reduce((total, row) => total + pick(row), 0)
  const totalCandidates = sum((row) => row.candidates.total)
  const pending = sum((row) => row.candidates.pending)
  const blocked = sum((row) => row.candidates.blocked)
  const confirmed = sum((row) => row.candidates.confirmed)
  const reasonCodes = countBy(
    rows.flatMap((row) =>
      row.blockedReasonCodes.flatMap((item) => Array.from({ length: item.count }, () => item.code)),
    ),
  )
  const ratio = (value, total) => (total === 0 ? null : Math.round((value / total) * 1e6) / 1e6)
  return {
    documents: rows.length,
    pages: sum((row) => row.pages),
    textItems: sum((row) => row.textItems),
    candidates: { total: totalCandidates, pending, blocked, confirmed },
    correctness: {
      gtVersion: 'gt-02',
      pendingTotal: pending,
      pendingChecked: sum(row => row.correctness?.pendingChecked ?? 0),
      wrongPending: sum(row => row.correctness?.wrongPending ?? 0),
      wrongRate: ratio(sum(row => row.correctness?.wrongPending ?? 0), sum(row => row.correctness?.pendingChecked ?? 0)),
      nominalChecked: sum(row => row.correctness?.nominalChecked ?? 0),
      nominalWrong: sum(row => row.correctness?.nominalWrong ?? 0),
      upperDeviationChecked: sum(row => row.correctness?.upperDeviationChecked ?? 0),
      lowerDeviationChecked: sum(row => row.correctness?.lowerDeviationChecked ?? 0),
      unchecked: rows.flatMap(row => row.correctness?.unchecked ?? []),
      uncheckedReasons: Object.fromEntries(countBy(rows.flatMap(row =>
        (row.correctness?.uncheckedDetails ?? []).map(d => d.reason))).map(d => [d.code, d.count])),
      uncheckedDetails: rows.flatMap(row => (row.correctness?.uncheckedDetails ?? []).map(d => ({ docId: row.id, ...d }))),
    },
    confirmableRate: ratio(pending, totalCandidates),
    blockedRate: ratio(blocked, totalCandidates),
    reasonCodeTop5: reasonCodes.slice(0, 5),
    pageLimitDocuments: rows.filter((row) => row.pageLimit !== null).map((row) => row.id),
    noTextLayerPages: rows.reduce((total, row) => total + row.issues.noTextLayerPages.length, 0),
    rules,
    pageRangeProbe: probe,
  }
}

/**
 * 完整度量：校验语料 → 逐份跑提取器 → 汇总 → 对 PAGE_LIMIT 文档追加前 20 页探针。
 * 返回可以直接写进 metrics.json 的对象（不含时间戳，保证可逐字节比较）。
 */
export async function measureCorpus({
  manifestPath,
  corpusDir,
  pageRangeProbePages = PAGE_RANGE_PROBE_PAGES,
  unitAttestation = null,
}) {
  const manifest = loadManifest(manifestPath)
  const groundTruth = JSON.parse(readFileSync(new URL('../../docs/evidence/ground-truth/gt-02.json', import.meta.url), 'utf8')).entries
  const verified = verifyCorpus(manifest, corpusDir)
  const modules = await loadExtraction()
  const rules = {
    extractorVersion: modules.EXTRACTOR_VERSION,
    maxExtractionPages: modules.MAX_EXTRACTION_PAGES,
    maxExtractionCandidates: modules.MAX_EXTRACTION_CANDIDATES,
    maxExtractionIssues: modules.MAX_EXTRACTION_ISSUES,
    readBudget: READ_BUDGET,
  }
  if (unitAttestation !== null) {
    rules.unitAttestation = {
      statement: unitAttestation.statement,
      actor: unitAttestation.actor,
    }
  }
  const rows = []
  const probes = []
  for (const [index, entry] of verified.entries()) {
    const perDocument =
      unitAttestation === null
        ? null
        : {
            ...unitAttestation,
            label: `${entry.doc.id} ${entry.doc.file}`,
            sessionSeq: index + 1,
            turnId: `real-doc-attest-${index + 1}`,
          }
    const measured = await measureDocument(entry, modules, perDocument)
    measured.row.correctness = compareGroundTruth(entry.doc.id, measured.draft.candidates, groundTruth)
    rows.push(measured.row)

    // 1-20 页探针的对象：页跨度超过上限、确实会被切块的文档（当前为 r4，170 页）。
    // 旧口径按“出现 PAGE_LIMIT 的文档”触发；document-extractor-6 起不再产生 PAGE_LIMIT，
    // 因此改为按“是否切块”判定。探针本身（前 20 页单独扫一次）保持原样，
    // 用来证明同一页范围的子集扫描与切块后的整份扫描给出同样的候选。
    if (measured.pages <= modules.MAX_EXTRACTION_PAGES) continue
    const to = Math.min(pageRangeProbePages, measured.pages)
    const probeDraft = modules.buildExtractionDraft({
      projectId: 'real-doc-baseline',
      baseToken: 'real-doc-baseline-1',
      source: measured.source,
      pageRange: { from: 1, to },
      layer: measured.layer,
    })
    const statuses = countStatuses(probeDraft.candidates)
    probes.push({
      id: `${measured.row.id}@1-${to}`,
      forDocument: measured.row.id,
      pageRange: { from: 1, to },
      candidates: {
        total: probeDraft.candidates.length,
        pending: statuses.pending,
        blocked: statuses.blocked,
        confirmed: statuses.confirmed,
        byKind: kindCounts(probeDraft.candidates),
      },
      blockedReasonCodes: countBy(
        probeDraft.candidates
          .filter((candidate) => candidate.status === 'blocked')
          .flatMap((candidate) => candidate.reasonCodes),
      ),
      issues: issueSummary(probeDraft.issues),
    })
  }
  return {
    corpus: { manifest: 'corpus-manifest.json', documents: verified.length },
    rules,
    documents: rows,
    summary: summarize(rows, probes, rules),
  }
}

/** 取“可比较部分”（度量本身），基线文件里的说明字段不参与比较。 */
export function measuredPayload(value) {
  return {
    corpus: value.corpus,
    rules: value.rules,
    documents: value.documents,
    summary: value.summary,
  }
}

/** 深度比较，返回差异清单（路径 + 期望 + 实际），用于“数字变化必须显式更新基线”。 */
export function diffMeasured(actual, expected, basePath = '') {
  const diffs = []
  const isObject = (value) => value !== null && typeof value === 'object'
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      diffs.push({ path: basePath, expected, actual })
      return diffs
    }
    const length = Math.max(expected.length, actual.length)
    for (let index = 0; index < length; index += 1) {
      diffs.push(...diffMeasured(actual[index], expected[index], `${basePath}[${index}]`))
    }
    return diffs
  }
  if (isObject(expected) || isObject(actual)) {
    if (!isObject(expected) || !isObject(actual)) {
      diffs.push({ path: basePath, expected, actual })
      return diffs
    }
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()
    for (const key of keys) {
      diffs.push(
        ...diffMeasured(actual[key], expected[key], basePath === '' ? key : `${basePath}.${key}`),
      )
    }
    return diffs
  }
  if (expected !== actual) diffs.push({ path: basePath, expected, actual })
  return diffs
}
