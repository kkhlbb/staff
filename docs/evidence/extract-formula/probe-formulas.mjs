#!/usr/bin/env node
/**
 * 诊断探针（证据用，不参与 npm test / 产品接线）：P2 `FORMULA_UNSUPPORTED` 原文形态。
 *
 *   REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs \
 *     node docs/evidence/extract-formula/probe-formulas.mjs [--dump]
 *
 * 只做四件事，不改任何规则、不做算术求值、不给变量猜含义：
 * 1. 用产品同一套 API（buildExtractionDraft）取出全部 `FORMULA_UNSUPPORTED` 阻塞候选；
 * 2. 统计原文形态标记（多等号 / 函数 / 括号 / 乘除 / 汉字 / 单位混排 / 希腊字母 / 文本层拆碎小数…）；
 * 3. 给出**主归类**（每条只归一类，合计 = 45）+ 每类 3 个实例（文档 + 页 + 原文片段 + 候选索引）；
 * 4. 打印「产品解析器现判」：对同一条原文，用产品自己的 `matchExpressionAssignment`
 *    逐个逗号片段试形态，列出命中/未命中 —— 改前全是未命中，改后能直接看出哪几条被赋值路径接管。
 *
 * 匹配文本一律走产品的 `matchTextOf`（NFKC + 减号变体归一），与判定路径一致；
 * 探针自己只做字符事实统计，不另写一套解析。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')
const { loadExtraction, loadPdfTextExtract } = await import(
  path.join(repoRoot, 'scripts/real-docs/tsImport.mjs')
)
const extraction = await loadExtraction()
const { extractPdfTextPages } = await loadPdfTextExtract()
const { matchExpressionAssignment } = await import(
  path.join(repoRoot, 'src/document-extraction/expressionUnits.ts')
)
const { UNIT_TEXT_SOURCE } = await import(path.join(repoRoot, 'src/document-extraction/unitScope.ts'))
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')

const corpusDir =
  process.env.REAL_DOC_CORPUS ?? path.join(process.env.HOME, 'DSH/tmp/cunlian-v36/real-docs')
const manifest = JSON.parse(
  readFileSync(path.join(repoRoot, 'docs/evidence/real-doc-baseline/corpus-manifest.json'), 'utf8'),
)

const dump = process.argv.includes('--dump')

// ---------------------------------------------------------------- 字符事实
const UNIT_ANYWHERE = new RegExp(UNIT_TEXT_SOURCE, 'i')
const UNIT_AT_START = new RegExp(
  `^\\s*[+-]?\\d+(?:\\.\\d+)?\\s*(?:±\\s*\\d+(?:\\.\\d+)?\\s*)?(${UNIT_TEXT_SOURCE})(?![A-Za-z0-9])(?!\\.\\d)`,
  'i',
)
const TAIL_VALUE_UNIT = new RegExp(
  `^\\s*[+-]?\\d+(?:\\.\\d+)?\\s*(?:±\\s*\\d+(?:\\.\\d+)?\\s*)?${UNIT_TEXT_SOURCE}`,
  'i',
)
const SYMBOL_LEFT = /([A-Za-z\u0370-\u03ff][A-Za-z0-9\u0370-\u03ff]*)\s*$/
const FUNC_NAME =
  /(?:sin|cos|tan|cot|arcsin|arccos|arctan|sqrt|ln|lg|log|exp|max|min|sum|∑|∫|Δ)\s*\(/i
const SUBSUP = /[₀-₉ₐ-ₜ⁰-⁹ⁱ⁺⁻ⁿᵃ-ᶻ]|[_^]\s*\{?[0-9A-Za-z]/
const GREEK = /[\u0370-\u03ff]/
const CJK = /[\u4e00-\u9fff]/
const MULDIV = /[×÷*/]/
const PM = /[±∓]/

/** 形态标记（多标签）：每个都是纯字符事实。 */
const FEATURES = [
  { key: 'multiEquals', label: '多等号（≥2 个 =）', test: (raw) => (raw.match(/=/g) ?? []).length >= 2 },
  { key: 'function', label: '含函数调用', test: (raw) => FUNC_NAME.test(raw) },
  { key: 'subSup', label: '下标上标字符', test: (raw) => SUBSUP.test(raw) },
  { key: 'paren', label: '含括号', test: (raw) => /[()（）]/.test(raw) },
  { key: 'parenNest', label: '括号嵌套', test: (raw) => /\([^()]*\([^()]*\)[^()]*\)/.test(raw) },
  { key: 'mulDiv', label: '乘除混合', test: (raw) => MULDIV.test(raw) },
  { key: 'cjk', label: '含汉字', test: (raw) => CJK.test(raw) },
  { key: 'unitMixed', label: '含单位串', test: (raw) => UNIT_ANYWHERE.test(raw) },
  { key: 'greek', label: '希腊字母', test: (raw) => GREEK.test(raw) },
  { key: 'pm', label: '±偏差', test: (raw) => PM.test(raw) },
  { key: 'multiDotNumber', label: '数字里出现连续点号（数值本身错乱）', test: (raw) => /\d\.\d*\.\d/.test(raw) },
]

/** 中间式（第一个 = 与最后一个 = 之间）的形态：纯加减 / 含字母·乘除·括号·单位。 */
const PURE_SIGNS = /^\s*[+-]?\d+(?:\.\d+)?(?:\s*[+-]\s*(?:\d+(?:\.\d+)?|\(\s*[+-]?\d+(?:\.\d+)?\s*\)))*\s*$/

/**
 * 主归类：按「能不能在原文里直接读到末尾结果值」排序，一条只进一类。
 * 顺序即优先级，保证 45 条不重不漏。
 */
const PRIMARY = [
  {
    key: 'tailValueUnitSymbolOk',
    label: '末尾有「数值+单位」且等号左边是字母/希腊字母符号（原文里已给出结果值）',
    test: (f) => f.tailValueUnit && f.symbol !== null,
  },
  {
    key: 'tailValueUnitNoSymbol',
    label: '末尾有「数值+单位」但等号左边不是符号（`0=…`、纯算式行）',
    test: (f) => f.tailValueUnit && f.symbol === null,
  },
  {
    key: 'noTailValue',
    label: '末尾没有「数值+单位」（纯符号式 / 缺单位 / 正文夹带 / 数值错乱）',
    test: () => true,
  },
]

function classify(candidate, line, text) {
  const raw = text
  const items = line ? line.items.map((item) => item.text) : []
  // 逐逗号片段算“末尾值”：多赋值行里每段的末尾都可能带自己的结果值，整行末尾不是唯一依据。
  const segments = []
  let offset = 0
  for (const segment of raw.split(',')) {
    const start = offset
    offset += segment.length + 1
    const equals = [...segment.matchAll(/=/g)].map((match) => match.index)
    const firstEq = equals.length > 0 ? equals[0] : -1
    const lastEq = equals.length > 0 ? equals[equals.length - 1] : -1
    const tail = lastEq >= 0 ? segment.slice(lastEq + 1) : ''
    const left = firstEq >= 0 ? segment.slice(0, firstEq) : ''
    const middle = equals.length >= 2 ? segment.slice(firstEq + 1, lastEq) : null
    const symbolMatch = SYMBOL_LEFT.exec(left.trimEnd())
    const form = matchExpressionAssignment(raw, start, start + segment.length)
    segments.push({
      text: segment,
      tail,
      middle,
      middleClass: middle === null ? null : PURE_SIGNS.test(middle) ? '纯加减' : '含字母/乘除/括号',
      tailValueUnit: TAIL_VALUE_UNIT.test(tail),
      symbol: symbolMatch ? symbolMatch[1] : null,
      form: form === null ? null : form.form,
      formSymbol: form === null ? null : form.symbol.text,
      formNominal: form === null ? null : form.nominal.text,
      formUnit: form === null ? null : form.unit.text,
    })
  }
  const withTail = segments.filter((segment) => segment.tailValueUnit)
  const withTailSymbol = withTail.find((segment) => segment.symbol !== null) ?? null
  const facts = {
    segCount: segments.length,
    tailValueUnit: withTail.length > 0,
    // 取“带末尾值且等号左边是符号”的那一段作为归类依据；没有就退回整行第一段。
    symbol: withTailSymbol ? withTailSymbol.symbol : (segments[0]?.symbol ?? null),
    middleClass: withTailSymbol ? withTailSymbol.middleClass : (segments[0]?.middleClass ?? null),
    tail: withTailSymbol ? withTailSymbol.tail : (segments.at(-1)?.tail ?? ''),
    dotItems: items.filter((item) => item.trim() === '.').length,
    items,
    segments,
  }
  facts.features = FEATURES.filter((feature) => feature.test(raw)).map((feature) => feature.key)
  facts.primary = PRIMARY.find((entry) => entry.test(facts))
  return facts
}

const rows = []
const totals = { documents: 0, pages: 0, candidates: 0, formulaUnsupported: 0 }

for (const doc of manifest.documents) {
  const bytes = new Uint8Array(readFileSync(path.join(corpusDir, doc.file)))
  const task = getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, verbosity: 0 })
  const pdf = await task.promise
  const pageCount = pdf.numPages
  await task.destroy()
  const rawPages = await extractPdfTextPages(
    bytes,
    { from: 1, to: pageCount },
    { maxTextItems: 200000, timeoutMs: 300000 },
  )
  const layer = extraction.buildPdfTextLayer(rawPages)
  const draft = extraction.buildExtractionDraft({
    projectId: 'probe',
    baseToken: 'probe',
    source: {
      documentId: `real-doc-${doc.id}`,
      revisionId: `real-doc-${doc.id}-probe`,
      sha256: doc.sha256,
      blobKey: `corpus:${doc.file}`,
      pageCount,
    },
    pageRange: { from: 1, to: pageCount },
    layer,
  })
  totals.documents += 1
  totals.pages += pageCount
  totals.candidates += draft.candidates.length

  draft.candidates.forEach((candidate, index) => {
    if (candidate.kind !== 'formula') return
    if (!candidate.reasonCodes.includes('FORMULA_UNSUPPORTED')) return
    totals.formulaUnsupported += 1
    const line = layer.pages
      .find((page) => page.page === candidate.page)
      ?.lines.find((item) => item.rawText === candidate.rawText)
    const text = line ? extraction.matchTextOf(line) : candidate.data.expression
    rows.push({
      doc: doc.id,
      page: candidate.page,
      index,
      rawText: candidate.rawText,
      text,
      facts: classify(candidate, line, text),
    })
  })

  console.log(
    `${doc.id} ${doc.file}：页 ${pageCount}｜候选 ${draft.candidates.length}｜` +
      `FORMULA_UNSUPPORTED ${rows.filter((row) => row.doc === doc.id).length}`,
  )
}

console.log('')
console.log('================ 主归类（每条只归一类，合计 = 45） ================')
for (const entry of PRIMARY) {
  const list = rows.filter((row) => row.facts.primary.key === entry.key)
  if (list.length === 0) continue
  const docBreak = [...new Set(list.map((row) => row.doc))]
    .map((id) => `${id}×${list.filter((row) => row.doc === id).length}`)
    .join(' ')
  console.log(`\n## ${entry.label}：${list.length} 条（${docBreak}）`)
  if (entry.key === 'tailValueUnitSymbolOk') {
    for (const kind of ['纯加减', '含字母/乘除/括号']) {
      const sub = list.filter((row) => row.facts.middleClass === kind)
      console.log(`   子类「中间式${kind}」：${sub.length} 条`)
    }
  }
  for (const row of list.slice(0, 3)) {
    console.log(`  - ${row.doc} p${row.page} idx=${row.index} 原文=${JSON.stringify(row.text.slice(0, 120))}`)
  }
}
console.log(`\n主归类合计：${rows.length}`)

console.log('')
console.log('================ 形态标记（多标签，一行可命中多个） ================')
for (const feature of FEATURES) {
  const count = rows.filter((row) => row.facts.features.includes(feature.key)).length
  console.log(`${feature.label}：${count}`)
}

console.log('')
console.log('================ 逐条清单（45 条） ================')
for (const row of rows) {
  const facts = row.facts
  console.log(
    `${row.doc} p${String(row.page).padStart(3)} idx=${String(row.index).padStart(4)} ` +
      `[${facts.primary.key}] 段=${facts.segCount} 符号=${JSON.stringify(facts.symbol)} ` +
      `中间式=${JSON.stringify(facts.middleClass)} 末尾值+单位=${facts.tailValueUnit ? 'Y' : 'n'} 拆碎点=${facts.dotItems}`,
  )
  console.log(`     原文=${JSON.stringify(row.text)}`)
  const hits = facts.segments.filter((segment) => segment.form !== null)
  if (hits.length > 0) {
    console.log(
      `     产品形态命中=${JSON.stringify(
        hits.map((segment) => ({
          form: segment.form,
          symbol: segment.formSymbol,
          nominal: segment.formNominal,
          unit: segment.formUnit,
        })),
      )}`,
    )
  }
  if (dump) {
    console.log(`     文本项=${JSON.stringify(facts.items)}`)
  }
}

console.log('')
console.log(
  `汇总：${totals.documents} 份 / ${totals.pages} 页 / 候选 ${totals.candidates}｜` +
    `FORMULA_UNSUPPORTED ${totals.formulaUnsupported}`,
)
