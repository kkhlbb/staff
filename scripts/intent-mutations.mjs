#!/usr/bin/env node
/**
 * ADR-001 第 3 步的回退实验（变异）驱动。
 *
 *   node scripts/intent-mutations.mjs m25 apply|revert
 *   node scripts/intent-mutations.mjs m26 apply|revert
 *
 * M25：让“模型代填条款区间”也能通过（删掉 setRequirement 的用户原话/数值校验）。
 * M26：去掉“无外部来源”标记（图纸依据栏不再写入；标题栏/文件头/文件名后缀随之为空）。
 *
 * 只做文本替换；revert 用同一组替换反向执行（不依赖 git 提交状态）。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const intentDraftFile = 'src/intent/draft.ts'
const computeFile = 'src/revisions/compute.ts'

const m25 = {
  file: intentDraftFile,
  pairs: [
    [
      `  if (!statementIsUserGiven(input.statement, input.turn.userText)) {
    return intentFail(
      'REQUIREMENT_MUST_BE_USER_GIVEN',
      '条款区间必须由用户原话给出；模型不能代填、引用标准等级或推算默认值',
    )
  }
  if (!numbersAreUserGiven([input.lowerMm, input.upperMm], input.turn.userText)) {
    return intentFail(
      'REQUIREMENT_MUST_BE_USER_GIVEN',
      '条款上下限必须出现在用户原话里；模型不能代填、引用标准等级或推算默认值',
    )
  }`,
      `  // M25 变异：不再要求条款区间来自用户原话，模型传什么就收什么。`,
    ],
  ],
}

const m26 = {
  file: computeFile,
  pairs: [
    [
      `  // 无任务书项目：标题栏与技术要求的依据栏是强制标记，不由用户备注决定。
  if (snapshot.project.sourceKind === 'user-intent') frameFields.basis = USER_INPUT_BASIS`,
      `  // M26 变异：去掉“依据：用户输入，无外部原文件”标记。`,
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
const bundle = target === 'm25' ? m25 : target === 'm26' ? m26 : null
if (bundle === null) throw new Error('用法：m25|m26 apply|revert')

if (action === 'apply') {
  apply(bundle.file, bundle.pairs)
  console.log(`${target.toUpperCase()} 变异已应用`)
} else if (action === 'revert') {
  apply(bundle.file, bundle.pairs.map(([from, to]) => [to, from]))
  console.log(`${target.toUpperCase()} 变异已恢复`)
} else {
  throw new Error('用法：m25|m26 apply|revert')
}
