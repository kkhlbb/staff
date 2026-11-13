import { z } from 'zod'
import { isProvenanceCompleteness, type EvidenceRef } from '../document-extraction/types'
import { MAX_ABS_Q, type ChainDefinition, type DimensionTerm, type Q } from './types'

export type ValidationError = {
  path: (string | number)[]
  code: string
  message: string
}

export type ValidationResult =
  | { ok: true; value: ChainDefinition }
  | { ok: false; errors: ValidationError[] }

type Path = ValidationError['path']

const objectSchema = z.record(z.string(), z.unknown())
const stringSchema = z.string()
const numberSchema = z.number()
const signSchema = z.union([z.literal(1), z.literal(-1)])

function termLabel(index: number): string {
  return `第 ${index + 1} 个组成环`
}

/**
 * 校验未知输入并转换为 ChainDefinition。
 * 这里只用 Zod 做对象/字符串/数字/布尔值等原始类型判断，业务约束逐项检查并汇总，
 * 因此不会因为第一个字段错误而跳过后续环、目标区间等其它可发现的错误。
 * 本函数不计算任何尺寸链结果。
 */
export function validateChain(input: unknown): ValidationResult {
  const errors: ValidationError[] = []

  const addError = (path: Path, code: string, message: string): void => {
    errors.push({ path, code, message })
  }

  const chainResult = objectSchema.safeParse(input)
  if (!chainResult.success) {
    return {
      ok: false,
      errors: [{ path: [], code: 'chain_type', message: '尺寸链必须是对象' }],
    }
  }
  const chain = chainResult.data

  const readQ = (value: unknown, path: Path, label: string): Q | undefined => {
    const parsed = numberSchema.safeParse(value)
    if (!parsed.success) {
      addError(path, 'q_not_number', `${label}必须是有限数字`)
      return undefined
    }
    if (!Number.isSafeInteger(parsed.data)) {
      addError(path, 'q_not_safe_integer', `${label}必须是安全整数（单位 0.0001 mm）`)
      return undefined
    }
    if (Math.abs(parsed.data) > MAX_ABS_Q) {
      addError(path, 'q_out_of_range', `${label}绝对值不能超过 ${MAX_ABS_Q} q（1,000,000 mm）`)
      return undefined
    }
    return parsed.data
  }

  const readRequiredString = (
    value: unknown,
    path: Path,
    typeCode: string,
    requiredCode: string,
    label: string,
  ): string | undefined => {
    const parsed = stringSchema.safeParse(value)
    if (!parsed.success) {
      addError(path, typeCode, `${label}必须是字符串`)
      return undefined
    }
    if (parsed.data.trim() === '') {
      addError(path, requiredCode, `${label}不能为空`)
      return undefined
    }
    return parsed.data
  }

  const terms: DimensionTerm[] = []
  const firstIdIndex = new Map<string, number>()
  const firstSymbolIndex = new Map<string, number>()

  if (!Array.isArray(chain.terms)) {
    addError(['terms'], 'terms_type', '组成环必须是 2 到 20 个的数组')
  } else {
    if (chain.terms.length < 2 || chain.terms.length > 20) {
      addError(
        ['terms'],
        'terms_count',
        `组成环数量必须为 2 到 20 个，当前为 ${chain.terms.length} 个`,
      )
    }

    for (let index = 0; index < chain.terms.length; index += 1) {
      const rawTerm = chain.terms[index]
      const label = termLabel(index)
      const termResult = objectSchema.safeParse(rawTerm)
      if (!termResult.success) {
        addError(['terms', index], 'term_type', `${label}必须是对象`)
        continue
      }
      const term = termResult.data

      const id = readRequiredString(
        term.id,
        ['terms', index, 'id'],
        'id_type',
        'id_required',
        `${label}的 id`,
      )
      const symbol = readRequiredString(
        term.symbol,
        ['terms', index, 'symbol'],
        'symbol_type',
        'symbol_required',
        `${label}的代号`,
      )
      const name = readRequiredString(
        term.name,
        ['terms', index, 'name'],
        'name_type',
        'name_required',
        `${label}的名称`,
      )

      const sourceNoteResult = stringSchema.safeParse(term.sourceNote)
      if (!sourceNoteResult.success) {
        addError(['terms', index, 'sourceNote'], 'source_note_type', `${label}的来源备注必须是字符串`)
      }
      const sourceNote = sourceNoteResult.success ? sourceNoteResult.data : ''

      const nominalQ = readQ(term.nominalQ, ['terms', index, 'nominalQ'], `${label}的基本尺寸`)
      const lowerDeviationQ = readQ(
        term.lowerDeviationQ,
        ['terms', index, 'lowerDeviationQ'],
        `${label}的下偏差`,
      )
      const upperDeviationQ = readQ(
        term.upperDeviationQ,
        ['terms', index, 'upperDeviationQ'],
        `${label}的上偏差`,
      )

      const signResult = signSchema.safeParse(term.sign)
      if (!signResult.success) {
        addError(['terms', index, 'sign'], 'sign_invalid', `${label}的方向系数只能是 1 或 -1`)
      }

      // 环修订号必须是从 1 开始的正安全整数；缺失或非法时拒绝整条链，
      // 不能静默补 1，否则来源核对凭据可能把未知历史误当“第 1 版”。
      const termRevisionResult = numberSchema.safeParse(term.termRevision)
      if (
        !termRevisionResult.success ||
        !Number.isSafeInteger(termRevisionResult.data) ||
        termRevisionResult.data < 1
      ) {
        addError(
          ['terms', index, 'termRevision'],
          'term_revision_invalid',
          `${label}的修订号必须是大于等于 1 的安全整数`,
        )
      }

      if (nominalQ !== undefined && nominalQ <= 0) {
        addError(['terms', index, 'nominalQ'], 'nominal_not_positive', `${label}的基本尺寸必须大于 0`)
      }

      if (
        lowerDeviationQ !== undefined &&
        upperDeviationQ !== undefined &&
        lowerDeviationQ > upperDeviationQ
      ) {
        addError(
          ['terms', index, 'upperDeviationQ'],
          'deviation_order',
          `${label}的上偏差不能小于下偏差`,
        )
      }

      if (nominalQ !== undefined && lowerDeviationQ !== undefined && nominalQ + lowerDeviationQ < 0) {
        addError(
          ['terms', index, 'lowerDeviationQ'],
          'lower_limit_negative',
          `${label}的基本尺寸加下偏差不能小于 0（下极限尺寸不能为负）`,
        )
      }

      if (id !== undefined) {
        const key = id.trim()
        const firstIndex = firstIdIndex.get(key)
        if (firstIndex === undefined) {
          firstIdIndex.set(key, index)
        } else {
          addError(
            ['terms', index, 'id'],
            'duplicate_id',
            `${label}的 id "${key}" 重复（与第 ${firstIndex + 1} 个组成环重复）`,
          )
        }
      }

      if (symbol !== undefined) {
        const key = symbol.trim()
        const firstIndex = firstSymbolIndex.get(key)
        if (firstIndex === undefined) {
          firstSymbolIndex.set(key, index)
        } else {
          addError(
            ['terms', index, 'symbol'],
            'duplicate_symbol',
            `${label}的代号 "${key}" 重复（与第 ${firstIndex + 1} 个组成环重复）`,
          )
        }
      }

      // 仅当 errors 为空时才会返回 value；这些占位值不会作为合法结果泄漏。
      const provenance = term.provenance === undefined ? undefined : z.array(z.custom<EvidenceRef>((ref) => {
        try { return isProvenanceCompleteness(ref as EvidenceRef) } catch { return false }
      })).min(1).max(64).safeParse(term.provenance)
      if (provenance !== undefined && !provenance.success) addError(['terms', index, 'provenance'], 'provenance_invalid', '组成环出处不完整')
      terms.push({
        ...(provenance?.success ? { provenance: provenance.data } : {}),
        id: id ?? '',
        symbol: symbol ?? '',
        name: name ?? '',
        nominalQ: nominalQ ?? 0,
        lowerDeviationQ: lowerDeviationQ ?? 0,
        upperDeviationQ: upperDeviationQ ?? 0,
        sign: signResult.success ? signResult.data : 1,
        sourceNote,
        termRevision: termRevisionResult.success ? termRevisionResult.data : 1,
      })
    }
  }

  let target: ChainDefinition['target'] = null
  if (chain.target !== null) {
    const targetResult = objectSchema.safeParse(chain.target)
    if (!targetResult.success) {
      addError(['target'], 'target_type', '目标区间必须为 null 或包含 minQ、maxQ 的对象')
    } else {
      const targetInput = targetResult.data
      const minQ = readQ(targetInput.minQ, ['target', 'minQ'], '目标下限')
      const maxQ = readQ(targetInput.maxQ, ['target', 'maxQ'], '目标上限')
      if (minQ !== undefined && maxQ !== undefined && minQ > maxQ) {
        addError(['target', 'maxQ'], 'target_order', '目标上限不能小于目标下限')
      }
      target = { minQ: minQ ?? 0, maxQ: maxQ ?? 0 }
    }
  }

  const assumptionsResult = stringSchema.safeParse(chain.assumptions)
  if (!assumptionsResult.success) {
    addError(['assumptions'], 'assumptions_type', '假设说明必须是字符串')
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: {
      terms,
      target,
      assumptions: assumptionsResult.success ? assumptionsResult.data : '',
    },
  }
}
