#!/usr/bin/env node
/**
 * M02 变异（当前基线复跑版）：把“必须有原文出处”改成可空。
 *   1. parse.buildQuantity 不再要求 evidence 完整（缺出处也保留数值）；
 *   2. draft.evidenceMissing 恒返回 null（确认/应用不再检查证据）。
 * 语义与 docs/evidence/V3.6/mutations/M02-evidence-optional.patch 相同，
 * 因 parse.ts 经过切块重构、上下文已变，故按当前文本重新定位。
 *
 *   node scripts/evidence-ref-mutate-m02.mjs apply-before|revert
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const parseFile = 'src/document-extraction/parse.ts'
const draftFile = 'src/document-extraction/draft.ts'

const parseOriginal = `  const evidence = input.evidence
  if (!evidence || !isEvidenceComplete(evidence)) {
    // M02：缺出处 → 数值不进候选，只留 issue。
    return { value: null, reason: 'SOURCE_UNRESOLVED', unitBasis: null }
  }`
const parseMutated = `  const evidence = input.evidence
  // M02 变异：出处可空，仍然保留数值候选。`

const parseListOriginal = `  const evidenceList = uniqueEvidence([
    evidence,`
const parseListMutated = `  const evidenceList = uniqueEvidence([
    ...(evidence ? [evidence] : []),`

const draftStart = `function evidenceMissing(candidate: ExtractionCandidate): string | null {`
const draftEndMarker = `  return null
}`
const draftOriginal = `function evidenceMissing(candidate: ExtractionCandidate): string | null {
  const fields = candidateNumericFields(candidate)
  for (const { field, value } of fields) {
    if (value.evidence.length === 0) return field
    for (const evidence of value.evidence) {
      if (!isEvidenceComplete(evidence)) return field
    }
  }
  if (candidate.kind === 'formula') {
    if (candidate.evidence.length === 0) return 'expression'
    for (const evidence of candidate.evidence) {
      if (!isEvidenceComplete(evidence)) return 'expression'
    }
  }
  return null
}`
const draftMutated = `function evidenceMissing(candidate: ExtractionCandidate): string | null {
  // M02 变异：出处可空，确认/应用不再检查证据。
  void candidate
  return null
}`

const mode = process.argv[2]

if (mode === 'apply-before') {
  const parse = readFileSync(parseFile, 'utf8')
  if (!parse.includes(parseOriginal)) throw new Error('parse.ts 找不到 M02 目标段')
  let nextParse = parse.replace(parseOriginal, parseMutated)
  if (!nextParse.includes(parseListOriginal)) throw new Error('parse.ts 找不到 evidenceList 目标段')
  nextParse = nextParse.replace(parseListOriginal, parseListMutated)
  writeFileSync(parseFile, nextParse)

  const draft = readFileSync(draftFile, 'utf8')
  if (!draft.includes(draftOriginal)) throw new Error('draft.ts 找不到 evidenceMissing 原文')
  writeFileSync(draftFile, draft.replace(draftOriginal, draftMutated))
  console.log('M02 变异已应用（parse + draft）')
} else if (mode === 'revert') {
  execFileSync('git', ['checkout', '--', parseFile, draftFile])
  console.log('M02 变异已恢复')
} else {
  throw new Error('用法：apply-before|revert')
}
