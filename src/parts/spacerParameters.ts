/**
 * 隔套三参数：输入解析、q 真值与显示有效位（V3-C-01）。
 *
 * 数值真值永远是整数 q（Q_PER_MM=10000），inputDecimals 只记录“输入小数位数
 * （含尾零）”，用于显示；两者分开存。12.1000 与 12.10 都是 q=121000，但它们
 * 的显示元数据分别是 4 位和 2 位——不得据字符串差异产生工程值变化。
 */
import { MAX_ABS_Q, type Q } from '../domain/types'
import { tryParseMm } from '../domain/units'
import {
  SPACER_PARAMETER_IDS,
  SPACER_PARAMETER_KEYS,
  SPACER_PART_ID,
  type ParameterSnapshotItem,
  type SpacerParameterKey,
} from '../drawing/types'

export interface SpacerParameterTexts {
  innerDiameter: string
  outerDiameter: string
  length: string
}

export type SpacerParameterErrorCode =
  | 'EMPTY'
  | 'FORMAT'
  | 'PRECISION'
  | 'RANGE'
  | 'RELATION'

export interface SpacerParameterError {
  ok: false
  code: 'INVALID_PARAMETER'
  field: SpacerParameterKey
  reason: SpacerParameterErrorCode
  message: string
}

export type SpacerParameterResult =
  | { ok: true; parameters: ParameterSnapshotItem[] }
  | SpacerParameterError

const DECIMAL_PATTERN = /^([+-])?(\d+)(?:\.(\d+))?$/

/** 输入小数位数（含尾零）；格式不合法或超四位返回 null，由解析器给原因。 */
export function decimalsOfInput(text: string): number | null {
  const match = DECIMAL_PATTERN.exec(text.trim())
  if (match === null) return null
  const fraction = match[3] ?? ''
  return fraction.length <= 4 ? fraction.length : null
}

function parseOne(
  key: SpacerParameterKey,
  text: string,
  sourceNote: string | undefined,
): { ok: true; value: Q; decimals: number } | SpacerParameterError {
  const parsed = tryParseMm(text)
  if (!parsed.ok) {
    const map: Record<string, SpacerParameterErrorCode> = {
      empty: 'EMPTY',
      format: 'FORMAT',
      precision: 'PRECISION',
      range: 'RANGE',
    }
    return {
      ok: false,
      code: 'INVALID_PARAMETER',
      field: key,
      reason: map[parsed.code] ?? 'FORMAT',
      message: parsed.message,
    }
  }
  const decimals = decimalsOfInput(text)
  if (decimals === null) {
    return {
      ok: false,
      code: 'INVALID_PARAMETER',
      field: key,
      reason: 'FORMAT',
      message: '无法确定输入小数位数',
    }
  }
  const item: ParameterSnapshotItem = {
    parameterId: SPACER_PARAMETER_IDS[key],
    partId: SPACER_PART_ID,
    key,
    valueQ: parsed.value,
    inputDecimals: decimals,
    reviewStatus: 'draft',
  }
  if (sourceNote !== undefined && sourceNote.trim() !== '') {
    item.sourceNote = sourceNote.trim()
  }
  return { ok: true, value: parsed.value, decimals }
}

/**
 * 解析并校验三个参数：正数、外径>内径、长度>0、不超过 MAX_ABS_Q、≤4 位小数。
 * 不静默四舍五入，不做单位换算，不修改尺寸链。
 */
export function parseSpacerParameters(
  texts: SpacerParameterTexts,
  sourceNotes: Partial<Record<SpacerParameterKey, string>> = {},
): SpacerParameterResult {
  const parsed: Partial<Record<SpacerParameterKey, { valueQ: Q; decimals: number }>> = {}
  for (const key of SPACER_PARAMETER_KEYS) {
    const text = texts[key]
    if (typeof text !== 'string') {
      return {
        ok: false,
        code: 'INVALID_PARAMETER',
        field: key,
        reason: 'FORMAT',
        message: '参数必须是十进制字符串',
      }
    }
    const one = parseOne(key, text, sourceNotes[key])
    if (!('ok' in one) || one.ok !== true) {
      return one as SpacerParameterError
    }
    if (one.value <= 0) {
      return {
        ok: false,
        code: 'INVALID_PARAMETER',
        field: key,
        reason: 'RANGE',
        message: '参数必须大于 0',
      }
    }
    if (one.value > MAX_ABS_Q) {
      return {
        ok: false,
        code: 'INVALID_PARAMETER',
        field: key,
        reason: 'RANGE',
        message: '参数超出允许范围',
      }
    }
    parsed[key] = { valueQ: one.value, decimals: one.decimals }
  }

  const inner = parsed.innerDiameter as { valueQ: Q; decimals: number }
  const outer = parsed.outerDiameter as { valueQ: Q; decimals: number }
  if (outer.valueQ <= inner.valueQ) {
    return {
      ok: false,
      code: 'INVALID_PARAMETER',
      field: 'outerDiameter',
      reason: 'RELATION',
      message: '外径必须大于内径',
    }
  }

  return {
    ok: true,
    parameters: SPACER_PARAMETER_KEYS.map((key) => {
      const value = parsed[key] as { valueQ: Q; decimals: number }
      const item: ParameterSnapshotItem = {
        parameterId: SPACER_PARAMETER_IDS[key],
        partId: SPACER_PART_ID,
        key,
        valueQ: value.valueQ,
        inputDecimals: value.decimals,
        reviewStatus: 'draft',
      }
      const note = sourceNotes[key]
      if (note !== undefined && note.trim() !== '') item.sourceNote = note.trim()
      return item
    }),
  }
}

export interface PersistedSpacerParameter {
  parameterId: string
  partId: string
  key: SpacerParameterKey
  valueQ: number
  inputDecimals: number
  reviewStatus: 'draft' | 'pending' | 'confirmed'
  sourceNote?: string
}

/**
 * 校验已保存参数能不能作为图纸真值使用。任何不一致都拒绝，不用默认值补齐。
 */
export function validateSpacerParameterSnapshot(
  items: readonly PersistedSpacerParameter[],
): { ok: true; parameters: ParameterSnapshotItem[] } | { ok: false; message: string } {
  if (items.length !== SPACER_PARAMETER_KEYS.length) {
    return { ok: false, message: '隔套参数必须恰好包含内径、外径、长度三项' }
  }
  const byKey = new Map<SpacerParameterKey, PersistedSpacerParameter>()
  for (const item of items) {
    if (!SPACER_PARAMETER_KEYS.includes(item.key)) {
      return { ok: false, message: `未知参数键：${String(item.key)}` }
    }
    if (byKey.has(item.key)) {
      return { ok: false, message: `参数键重复：${item.key}` }
    }
    if (item.parameterId !== SPACER_PARAMETER_IDS[item.key]) {
      return { ok: false, message: `参数 ID 与键不一致：${item.key}` }
    }
    if (item.partId !== SPACER_PART_ID) {
      return { ok: false, message: `参数不属于隔套部件：${String(item.partId)}` }
    }
    if (!Number.isSafeInteger(item.valueQ) || item.valueQ <= 0 || item.valueQ > MAX_ABS_Q) {
      return { ok: false, message: `参数 q 不合法：${item.key}` }
    }
    if (
      !Number.isInteger(item.inputDecimals) ||
      item.inputDecimals < 0 ||
      item.inputDecimals > 4
    ) {
      return { ok: false, message: `输入小数位数不合法：${item.key}` }
    }
    byKey.set(item.key, item)
  }
  const inner = byKey.get('innerDiameter')
  const outer = byKey.get('outerDiameter')
  if (inner === undefined || outer === undefined || byKey.get('length') === undefined) {
    return { ok: false, message: '缺少隔套参数' }
  }
  if (outer.valueQ <= inner.valueQ) {
    return { ok: false, message: '外径必须大于内径' }
  }
  return {
    ok: true,
    parameters: SPACER_PARAMETER_KEYS.map((key) => {
      const item = byKey.get(key) as PersistedSpacerParameter
      const result: ParameterSnapshotItem = {
        parameterId: item.parameterId,
        partId: item.partId,
        key: item.key,
        valueQ: item.valueQ,
        inputDecimals: item.inputDecimals,
        reviewStatus: item.reviewStatus,
      }
      if (item.sourceNote !== undefined && item.sourceNote !== '') {
        result.sourceNote = item.sourceNote
      }
      return result
    }),
  }
}

export const DEFAULT_SPACER_TEXTS: SpacerParameterTexts = {
  innerDiameter: '20.00',
  outerDiameter: '32.00',
  length: '12.00',
}
