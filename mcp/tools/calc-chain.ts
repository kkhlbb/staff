/**
 * 工具 `calc_chain`：极值法尺寸链计算（只读）。
 *
 * 计算**只调用** `src/domain/calculate.ts` 的 `calculateChain`：
 * - `parameters` 模式走服务端同一条预览路径（`computeChange`），链结构取主进程
 *   新建项目模板，不在 MCP 里复制公式；
 * - `terms` 模式把调用方给的组成环原样交给同一内核。
 *
 * 输出里每个数都同时给整数 q 与 mm 文本（mm 文本由内核 `formatMm` 生成）。
 */
import { calculateChain, ENGINE_VERSION } from '../../src/domain/calculate'
import { MAX_ABS_Q, type ChainDefinition, type DimensionTerm } from '../../src/domain/types'
import {
  asObject,
  readArray,
  readEnum,
  readInteger,
  readString,
  ToolInputError,
} from '../lib/args'
import { mm, success } from '../lib/format'
import { MCP_PROVENANCE_NOTE, computeSpacerChain } from '../lib/spacer'

const Q_LIMIT = MAX_ABS_Q

export const calcChainDefinition = {
  name: 'calc_chain',
  title: '计算线性尺寸链（极值法）',
  description:
    '用与桌面端相同的确定性内核计算一维线性尺寸链：封闭环 C 的 q/ mm、极值上下限、公差与组成环清单。只读，不写任何文件。两种输入：parameters（隔套内径/外径/长度，q）或 terms（任意组成环数组，q）。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      parameters: {
        type: 'object',
        description: '隔套三参数（整数 q，1q = 0.0001 mm）。与 terms 二选一。',
        additionalProperties: false,
        properties: {
          innerDiameterQ: { type: 'integer', minimum: 1, maximum: Q_LIMIT },
          outerDiameterQ: { type: 'integer', minimum: 1, maximum: Q_LIMIT },
          lengthQ: { type: 'integer', minimum: 1, maximum: Q_LIMIT },
        },
        required: ['innerDiameterQ', 'outerDiameterQ', 'lengthQ'],
      },
      terms: {
        type: 'array',
        description: '显式组成环（与 parameters 二选一）。sign=1 为增环，-1 为减环。',
        minItems: 2,
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            symbol: { type: 'string', minLength: 1, maxLength: 32 },
            name: { type: 'string', maxLength: 64 },
            nominalQ: { type: 'integer', minimum: -Q_LIMIT, maximum: Q_LIMIT },
            lowerDeviationQ: { type: 'integer', minimum: -Q_LIMIT, maximum: Q_LIMIT },
            upperDeviationQ: { type: 'integer', minimum: -Q_LIMIT, maximum: Q_LIMIT },
            sign: { type: 'integer', enum: [1, -1] },
          },
          required: ['symbol', 'nominalQ', 'lowerDeviationQ', 'upperDeviationQ', 'sign'],
        },
      },
      formula: { type: 'string', maxLength: 200, description: '可选；仅用于输出说明。' },
      assumptions: { type: 'string', maxLength: 1000 },
      target: {
        description: '可选目标区间；null 表示不判定。',
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              minQ: { type: 'integer', minimum: -Q_LIMIT, maximum: Q_LIMIT },
              maxQ: { type: 'integer', minimum: -Q_LIMIT, maximum: Q_LIMIT },
            },
            required: ['minQ', 'maxQ'],
          },
          { type: 'null' },
        ],
      },
    },
  },
} as const

interface TermView {
  id: string
  symbol: string
  name: string
  nominalQ: number
  nominalMm: string
  lowerDeviationQ: number
  lowerDeviationMm: string
  upperDeviationQ: number
  upperDeviationMm: string
  sign: 1 | -1
  sourceNote: string
  source: string
}

function termView(term: DimensionTerm, source: string): TermView {
  return {
    id: term.id,
    symbol: term.symbol,
    name: term.name,
    nominalQ: term.nominalQ,
    nominalMm: mm(term.nominalQ),
    lowerDeviationQ: term.lowerDeviationQ,
    lowerDeviationMm: mm(term.lowerDeviationQ),
    upperDeviationQ: term.upperDeviationQ,
    upperDeviationMm: mm(term.upperDeviationQ),
    sign: term.sign,
    sourceNote: term.sourceNote,
    source,
  }
}

export function describeChain(input: {
  mode: 'parameters' | 'terms'
  chain: ChainDefinition
  formula: string | null
  termsSource: string
  parameters?: { innerDiameterQ: number; outerDiameterQ: number; lengthQ: number }
}): Record<string, unknown> {
  const result = calculateChain(input.chain)
  return {
    mode: input.mode,
    engineVersion: ENGINE_VERSION,
    formula: input.formula,
    terms: input.chain.terms.map((term) => termView(term, input.termsSource)),
    parameters: input.parameters ?? null,
    target:
      result.status === 'no-target' || input.chain.target === null
        ? null
        : {
            minQ: input.chain.target.minQ,
            minMm: mm(input.chain.target.minQ),
            maxQ: input.chain.target.maxQ,
            maxMm: mm(input.chain.target.maxQ),
            status: result.status,
            lowerMarginQ: result.lowerMarginQ,
            lowerMarginMm: result.lowerMarginQ === null ? null : mm(result.lowerMarginQ),
            upperMarginQ: result.upperMarginQ,
            upperMarginMm: result.upperMarginQ === null ? null : mm(result.upperMarginQ),
          },
    result: {
      nominalQ: result.nominalQ,
      nominalMm: mm(result.nominalQ),
      minQ: result.minQ,
      minMm: mm(result.minQ),
      maxQ: result.maxQ,
      maxMm: mm(result.maxQ),
      lowerDeviationQ: result.lowerDeviationQ,
      lowerDeviationMm: mm(result.lowerDeviationQ),
      upperDeviationQ: result.upperDeviationQ,
      upperDeviationMm: mm(result.upperDeviationQ),
      toleranceQ: result.toleranceQ,
      toleranceMm: mm(result.toleranceQ),
      targetStatus: result.status,
    },
    assumptions: input.chain.assumptions,
    provenance: MCP_PROVENANCE_NOTE,
    readOnly: true,
  }
}

function readTarget(raw: Record<string, unknown>): { minQ: number; maxQ: number } | null {
  const value = raw.target
  if (value === undefined || value === null) return null
  const target = asObject(value, 'target')
  const minQ = readInteger(target, 'minQ', { required: true, min: -Q_LIMIT, max: Q_LIMIT })!
  const maxQ = readInteger(target, 'maxQ', { required: true, min: -Q_LIMIT, max: Q_LIMIT })!
  if (minQ > maxQ) {
    throw new ToolInputError('INVALID_ARGUMENTS', 'target.minQ 不能大于 target.maxQ')
  }
  return { minQ, maxQ }
}

function readTerms(raw: unknown[]): DimensionTerm[] {
  return raw.map((item, index) => {
    const term = asObject(item, `terms[${index}]`)
    return {
      id: `t-${index + 1}`,
      symbol: readString(term, 'symbol', { required: true, maxLength: 32 })!,
      name: readString(term, 'name', { maxLength: 64 }) ?? '',
      nominalQ: readInteger(term, 'nominalQ', {
        required: true,
        min: -Q_LIMIT,
        max: Q_LIMIT,
      })!,
      lowerDeviationQ: readInteger(term, 'lowerDeviationQ', {
        required: true,
        min: -Q_LIMIT,
        max: Q_LIMIT,
      })!,
      upperDeviationQ: readInteger(term, 'upperDeviationQ', {
        required: true,
        min: -Q_LIMIT,
        max: Q_LIMIT,
      })!,
      sign: readEnum(term, 'sign', [1, -1] as const, { required: true })!,
      sourceNote: '',
      termRevision: 1,
    }
  })
}

export async function runCalcChain(rawArguments: unknown): Promise<Record<string, unknown>> {
  const args = asObject(rawArguments ?? {}, 'arguments')
  const hasParameters = args.parameters !== undefined && args.parameters !== null
  const hasTerms = args.terms !== undefined && args.terms !== null
  if (hasParameters === hasTerms) {
    throw new ToolInputError(
      'INVALID_ARGUMENTS',
      'parameters 与 terms 必须且只能提供一个',
    )
  }
  const formula = readString(args, 'formula', { maxLength: 200 })
  const assumptions = readString(args, 'assumptions', { maxLength: 1000 }) ?? ''
  const target = readTarget(args)

  if (hasParameters) {
    const parameters = asObject(args.parameters, 'parameters')
    const innerDiameterQ = readInteger(parameters, 'innerDiameterQ', {
      required: true,
      min: 1,
      max: Q_LIMIT,
    })!
    const outerDiameterQ = readInteger(parameters, 'outerDiameterQ', {
      required: true,
      min: 1,
      max: Q_LIMIT,
    })!
    const lengthQ = readInteger(parameters, 'lengthQ', {
      required: true,
      min: 1,
      max: Q_LIMIT,
    })!
    const computation = computeSpacerChain({ innerDiameterQ, outerDiameterQ, lengthQ })
    const chain: ChainDefinition = {
      terms: computation.chain.terms,
      target,
      assumptions,
    }
    return success(
      'calc_chain',
      describeChain({
        mode: 'parameters',
        chain,
        formula: formula ?? 'C = H − B1 − S − B2（主进程 chain-demo 模板）',
        termsSource: '用户输入（MCP 隔套参数）',
        parameters: { innerDiameterQ, outerDiameterQ, lengthQ },
      }),
    )
  }

  const terms = readTerms(readArray(args, 'terms', { required: true, minLength: 2 })!)
  const chain: ChainDefinition = { terms, target, assumptions }
  return success(
    'calc_chain',
    describeChain({
      mode: 'terms',
      chain,
      formula,
      termsSource: '用户输入（MCP 组成环数组）',
    }),
  )
}

