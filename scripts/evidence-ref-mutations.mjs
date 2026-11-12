#!/usr/bin/env node
/**
 * ADR-001 证据分支的回退实验（变异）驱动。
 *
 *   node scripts/evidence-ref-mutations.mjs m02 apply|revert
 *   node scripts/evidence-ref-mutations.mjs m24 apply|revert
 *
 * M02：把“必须有出处”改成可空（parse 不再拦缺出处 + draft 出处闸门恒 null）。
 * M24：把 user-attestation 当成“总是有效”（跳过 actorId/sessionSeq 一致性校验）。
 *
 * 只做文本替换；revert 用同一组替换反向执行（不依赖 git 提交状态，
 * 以免在未提交的工作区里误把实现回退到基线）。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const parseFile = 'src/document-extraction/parse.ts'
const draftFile = 'src/document-extraction/draft.ts'

const m02 = {
  parse: [
    [
      `  const evidence = input.evidence
  if (!evidence || !isProvenanceCompleteness(evidence)) {
    // M02：缺出处 → 数值不进候选，只留 issue。
    return { value: null, reason: 'SOURCE_UNRESOLVED', unitBasis: null }
  }`,
      `  const evidence = input.evidence
  // M02 变异：出处可空，仍然保留数值候选。`,
    ],
    [
      `  const evidenceList = uniqueEvidence([
    evidence,`,
      `  const evidenceList = uniqueEvidence([
    ...(evidence ? [evidence] : []),`,
    ],
  ],
  draft: [
    [
      `function provenanceMissing(candidate: ExtractionCandidate): string | null {
  for (const { field, value } of candidateNumericFields(candidate)) {`,
      `function provenanceMissing(candidate: ExtractionCandidate): string | null {
  // M02 变异：出处可空，确认/应用不再检查出处。
  if (candidate.candidateId !== '') return null
  for (const { field, value } of candidateNumericFields(candidate)) {`,
    ],
  ],
}

const m24 = {
  draft: [
    [
      `  if (evidenceRefKind(ref) !== 'user-attestation') return true
  if (session === undefined) return false`,
      `  // M24 变异：user-attestation 一律视为“总是有效”，跳过会话一致性校验。
  if (evidenceRefKind(ref) !== 'user-attestation') return true
  return true
  if (session === undefined) return false`,
    ],
  ],
}

function apply(file, pairs) {
  let text = readFileSync(file, 'utf8')
  for (const [from, to] of pairs) {
    if (!text.includes(from)) throw new Error(`找不到目标文本：${file}\n${from.slice(0, 80)}`)
    text = text.replace(from, to)
  }
  writeFileSync(file, text)
}

const [target, action] = process.argv.slice(2)
const bundle = target === 'm02' ? m02 : target === 'm24' ? m24 : null
if (bundle === null) throw new Error('用法：m02|m24 apply|revert')

if (action === 'apply') {
  if (bundle.parse) apply(parseFile, bundle.parse)
  apply(draftFile, bundle.draft)
  console.log(`${target.toUpperCase()} 变异已应用`)
} else if (action === 'revert') {
  if (bundle.parse) apply(parseFile, bundle.parse.map(([from, to]) => [to, from]))
  apply(draftFile, bundle.draft.map(([from, to]) => [to, from]))
  console.log(`${target.toUpperCase()} 变异已恢复`)
} else {
  throw new Error('用法：m02|m24 apply|revert')
}
