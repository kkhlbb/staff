/**
 * 关系确认的派生判定（V2.1 第三组）。
 *
 * 持久化层只保存“确认凭据”（relationRevision + 指纹 + 时间）和“当前修订号”，
 * 不保存可写的 relationConfirmed 布尔。工作台、项目列表和报告都调用本模块，
 * 保证同一份数据只有一个结论。
 *
 * 规则（规格 §6.2 / 任务卡）：
 * - 指纹含环身份（id）、代号、基本尺寸、上下偏差、方向；不含名称、备注、目标、
 *   行顺序。
 * - relationRevision 在任何影响关系的操作（数值/方向/代号/增删环）时递增。
 * - 判定必须同时满足：凭据存在、修订号一致、指纹一致。因此：
 *   · 改目标 / 名称 / 备注 / 行顺序 → 保留确认；
 *   · 改后改回原值 → 修订号已递增，旧凭据不匹配，不自动恢复；
 *   · 草稿非法（数值解析失败）时由调用方传 null chain，直接判为未确认。
 */
import type { ChainDefinition, DimensionTerm, RelationReview } from '../domain/types'

export interface RelationState {
  relationRevision: number
  relationReview: RelationReview | null
}

/**
 * 稳定序列化：每个环编码为一段，排序后拼接以消除行顺序影响。
 * 使用 NUL/SOH 作为分隔符，避免任意外部字符串拼接出歧义。
 */
function canonicalTerm(term: DimensionTerm): string {
  return [
    term.id,
    term.symbol.trim(),
    String(term.nominalQ),
    String(term.lowerDeviationQ),
    String(term.upperDeviationQ),
    term.sign === 1 ? '+1' : '-1',
  ].join('\u0000')
}

/**
 * 非密码学指纹（FNV-1a 64 位，16 位十六进制）。
 *
 * 只用于判断“当前环数据是否仍是确认时核对过的那一份”，不承担防篡改或
 * 身份认证作用；界面与文档不得把它描述成签名或工程批准。
 */
export function relationFingerprint(terms: readonly DimensionTerm[]): string {
  const canonical = terms.map(canonicalTerm).sort().join('\u0001')
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= BigInt(canonical.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * prime)
  }
  return hash.toString(16).padStart(16, '0')
}

/** 关系确认是否仍然有效：凭据、修订号、指纹三者必须同时匹配。 */
export function isRelationConfirmed(
  chain: ChainDefinition | null,
  state: RelationState,
): boolean {
  if (chain === null) {
    return false
  }
  const review = state.relationReview
  if (review === null) {
    return false
  }
  if (review.relationRevision !== state.relationRevision) {
    return false
  }
  return review.fingerprint === relationFingerprint(chain.terms)
}

/**
 * 曾经确认过、但凭据已因后续编辑失效（与“从未确认”区分，界面据此提示
 * “输入已变更，请重新核对”）。
 */
export function isRelationReviewStale(
  chain: ChainDefinition | null,
  state: RelationState,
): boolean {
  if (state.relationReview === null) {
    return false
  }
  return !isRelationConfirmed(chain, state)
}

/** 生成新的确认凭据；调用方负责在同一事务中持久化。 */
export function createRelationReview(
  chain: ChainDefinition,
  relationRevision: number,
  confirmedAt: string,
): RelationReview {
  return {
    relationRevision,
    fingerprint: relationFingerprint(chain.terms),
    confirmedAt,
  }
}

/** 只影响关系确认、不影响来源数值核对的字段。 */
export function isRelationAffectingTermField(
  field: 'symbol' | 'name' | 'nominal' | 'lower' | 'upper' | 'sign' | 'sourceNote',
): boolean {
  return (
    field === 'symbol' ||
    field === 'nominal' ||
    field === 'lower' ||
    field === 'upper' ||
    field === 'sign'
  )
}

/** 递增该环修订号的字段：只有数值与方向（规格 §6.2）。 */
export function isTermRevisionBumpingField(
  field: 'symbol' | 'name' | 'nominal' | 'lower' | 'upper' | 'sign' | 'sourceNote',
): boolean {
  return field === 'nominal' || field === 'lower' || field === 'upper' || field === 'sign'
}
