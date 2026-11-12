#!/usr/bin/env node
/**
 * I1 证据：逐行比对改前 `isEvidenceComplete` 与改后 `isProvenanceCompleteness` 的
 * pdf-text 分支。只做文本归一（去注释/缩进，去掉函数名与类型收窄行），
 * 输出差异行；用于证明“pdf-text 分支与改前逐条等价”，而不是口头声明。
 *
 *   node scripts/evidence-ref-gate-identity.mjs [baseRev]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const base = process.argv[2] ?? '8fa7531'
const oldText = execFileSync('git', ['show', `${base}:src/document-extraction/types.ts`], {
  encoding: 'utf8',
})
const newText = readFileSync('src/document-extraction/types.ts', 'utf8')

function slice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker)
  if (start < 0) throw new Error(`找不到起点：${startMarker}`)
  const end = text.indexOf(endMarker, start)
  if (end < 0) throw new Error(`找不到终点：${endMarker}`)
  return text.slice(start, end)
}

const oldBody = slice(oldText, 'export function isEvidenceComplete', '\nexport function evidenceKey')
const newBody = slice(newText, "  if (kind === 'pdf-text') {", "  if (kind === 'pdf-ocr') {")

const normalize = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .filter((line) => !line.startsWith('export function'))
    .filter((line) => !line.startsWith('if (!evidence) return false'))
    .filter((line) => !line.startsWith('const evidence = ref as ExtractionEvidence'))
    .filter((line) => !line.startsWith("if (kind === 'pdf-text')"))
    .filter((line) => !line.startsWith('function isConfidence'))
    .filter((line) => !line.startsWith('return typeof value'))

const oldLines = normalize(oldBody)
const newLines = normalize(newBody)
console.log(`基线 ${base} 的 pdf 校验行数=${oldLines.length}；当前 pdf-text 分支行数=${newLines.length}`)
const max = Math.max(oldLines.length, newLines.length)
let differences = 0
for (let index = 0; index < max; index += 1) {
  const left = oldLines[index] ?? '(none)'
  const right = newLines[index] ?? '(none)'
  if (left !== right) {
    differences += 1
    console.log(`L${index + 1}\n  改前: ${left}\n  改后: ${right}`)
  }
}
console.log(differences === 0 ? 'IDENTICAL_AFTER_NORMALIZATION' : `DIFFERENCES=${differences}`)
process.exitCode = differences === 0 ? 0 : 1
