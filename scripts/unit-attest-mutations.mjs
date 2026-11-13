#!/usr/bin/env node
/**
 * 「批量补单位做成真状态变更」变异驱动（M34 / M35）。
 *
 *   node scripts/unit-attest-mutations.mjs m34 apply|revert
 *   node scripts/unit-attest-mutations.mjs m35 apply|revert
 *
 * M34（撤销只改界面不改存储）：撤销时只追加决定/失效标记，不把候选状态改回 blocked。
 *      目标用例：`confirmBatch.test.ts`「撤销必须真的改存储…」必须红。
 * M35（把“公式不支持”也纳入批量）：放宽 `isUnitOnlyCandidate`，让 FORMULA_UNSUPPORTED
 *      也能通过资格。目标用例：「三类“不支持”无论怎么传…」必须红。
 *
 * 只做文本替换；revert 用同一组替换反向执行（不依赖 git 提交状态）。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const batchFile = 'src/document-extraction/batch.ts'
const groupsFile = 'src/document-extraction/confirmGroups.ts'

const m34 = {
  file: batchFile,
  pairs: [
    [
      `      status: 'blocked',
      reasonCodes: [...new Set([...nextCandidate.reasonCodes, 'UNKNOWN_UNIT' as const])],`,
      `      // M34 变异：撤销只改界面/决定留痕，候选状态保持补单位后的样子。
      status: candidate.status,
      reasonCodes: candidate.reasonCodes,`,
    ],
  ],
}

const m35 = {
  file: groupsFile,
  pairs: [
    [
      `  if (candidate.reasonCodes.length !== 1 || candidate.reasonCodes[0] !== 'UNKNOWN_UNIT') {
    return false
  }`,
      `  // M35 变异：允许 FORMULA_UNSUPPORTED 也进入批量补单位（范围被放宽）。
  if (candidate.reasonCodes.length === 0) {
    return false
  }`,
    ],
  ],
}

function apply(file, pairs) {
  let text = readFileSync(file, 'utf8')
  for (const [from, to] of pairs) {
    if (!text.includes(from)) throw new Error(`找不到目标文本：${file}\n${from.slice(0, 120)}`)
    text = text.replace(from, to)
  }
  writeFileSync(file, text)
}

const [target, action] = process.argv.slice(2)
const bundle = target === 'm34' ? m34 : target === 'm35' ? m35 : null
if (bundle === null) throw new Error('用法：m34|m35 apply|revert')

if (action === 'apply') {
  apply(bundle.file, bundle.pairs)
  console.log(`${target.toUpperCase()} 变异已应用`)
} else if (action === 'revert') {
  apply(bundle.file, bundle.pairs.map(([from, to]) => [to, from]))
  console.log(`${target.toUpperCase()} 变异已恢复`)
} else {
  throw new Error('用法：m34|m35 apply|revert')
}
