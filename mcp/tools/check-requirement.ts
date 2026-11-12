/**
 * 工具 `check_requirement`：闭区间条款判定（只读，纯计算）。
 *
 * 判定**不另写一份**：直接调用 `src/requirements/check.ts` 的
 * `closedIntervalVerdict`（服务端 `numericVerdict` 也用它）。边界相等默认算满足；
 * 裕量含负值，`marginQ` 取最紧的一侧（下/上裕量取小）。
 */
import { closedIntervalVerdict, REQUIREMENT_REASON_TEXT } from '../../src/requirements/check'
import { MAX_ABS_Q } from '../../src/domain/types'
import {
  asObject,
  readBoolean,
  readInteger,
  readString,
  ToolInputError,
} from '../lib/args'
import { mm, success } from '../lib/format'

const Q_LIMIT = MAX_ABS_Q

export const checkRequirementDefinition = {
  name: 'check_requirement',
  title: '按闭区间判定条款是否满足',
  description:
    '把封闭环 C（整数 q）与任务书要求的闭区间比较：返回 satisfied / exceeded、下/上裕量（q + mm）与判定依据原因码。边界相等默认算满足；只读、不写文件。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      cQ: {
        type: 'integer',
        minimum: -Q_LIMIT,
        maximum: Q_LIMIT,
        description: '封闭环 C 的（下）值，整数 q；1q = 0.0001 mm。',
      },
      cMaxQ: {
        type: 'integer',
        minimum: -Q_LIMIT,
        maximum: Q_LIMIT,
        description: '可选：封闭环 C 的区间上限（极值法的 Cmax）。缺省时按单值点判定。',
      },
      lowerQ: { type: 'integer', minimum: -Q_LIMIT, maximum: Q_LIMIT, description: '条款下限，整数 q。' },
      upperQ: { type: 'integer', minimum: -Q_LIMIT, maximum: Q_LIMIT, description: '条款上限，整数 q。' },
      inclusive: {
        type: 'boolean',
        description: '是否含边界（闭区间）；默认 true。false 时边界相等算不满足。',
      },
      note: { type: 'string', maxLength: 500, description: '可选：条款原文或说明（仅回显）。' },
    },
    required: ['cQ', 'lowerQ', 'upperQ'],
  },
} as const

export async function runCheckRequirement(
  rawArguments: unknown,
): Promise<Record<string, unknown>> {
  const args = asObject(rawArguments ?? {}, 'arguments')
  const cQ = readInteger(args, 'cQ', { required: true, min: -Q_LIMIT, max: Q_LIMIT })!
  const cMaxQ =
    readInteger(args, 'cMaxQ', { min: -Q_LIMIT, max: Q_LIMIT }) ?? cQ
  const lowerQ = readInteger(args, 'lowerQ', { required: true, min: -Q_LIMIT, max: Q_LIMIT })!
  const upperQ = readInteger(args, 'upperQ', { required: true, min: -Q_LIMIT, max: Q_LIMIT })!
  const inclusive = readBoolean(args, 'inclusive', true)
  const note = readString(args, 'note', { maxLength: 500 })

  if (cMaxQ < cQ) {
    throw new ToolInputError('INVALID_ARGUMENTS', 'cMaxQ 不能小于 cQ（Cmin）')
  }
  if (lowerQ > upperQ) {
    throw new ToolInputError('INVALID_ARGUMENTS', 'lowerQ 不能大于 upperQ')
  }

  const verdict = closedIntervalVerdict({ minQ: cQ, maxQ: cMaxQ, lowerQ, upperQ, inclusive })
  const marginQ = Math.min(verdict.lowerMarginQ, verdict.upperMarginQ)

  return success('check_requirement', {
    status: verdict.satisfied ? 'satisfied' : 'exceeded',
    satisfied: verdict.satisfied,
    closed: {
      minQ: cQ,
      minMm: mm(cQ),
      maxQ: cMaxQ,
      maxMm: mm(cMaxQ),
    },
    requirement: {
      lowerQ,
      lowerMm: mm(lowerQ),
      upperQ,
      upperMm: mm(upperQ),
      inclusive,
      note,
    },
    margins: {
      marginQ,
      marginMm: mm(marginQ),
      lowerQ: verdict.lowerMarginQ,
      lowerMm: mm(verdict.lowerMarginQ),
      upperQ: verdict.upperMarginQ,
      upperMm: mm(verdict.upperMarginQ),
    },
    reasonCodes: verdict.codes,
    reasons: verdict.codes.map((code) => REQUIREMENT_REASON_TEXT[code]),
    basis: `${inclusive ? '闭区间' : '开区间'}判定：C=[${mm(cQ)}, ${mm(cMaxQ)}] 对要求 [${mm(lowerQ)}, ${mm(upperQ)}]；最紧裕量 ${mm(marginQ)} mm。`,
    readOnly: true,
  })
}
