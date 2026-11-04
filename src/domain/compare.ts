import { calculateChain } from './calculate'
import type { ChainDefinition, ChainResult, DimensionTerm, Q } from './types'

/**
 * 组成环字段对比结果。
 * 每个变化只描述一个字段，before/after 的类型随 field 收窄。
 */
export type TermFieldChange =
  | {
      termId: string
      field: 'symbol' | 'name' | 'sourceNote'
      before: string
      after: string
    }
  | {
      termId: string
      field: 'nominalQ' | 'lowerDeviationQ' | 'upperDeviationQ'
      before: Q
      after: Q
    }
  | {
      termId: string
      field: 'sign'
      before: 1 | -1
      after: 1 | -1
    }

/** 一个可空数值在两次定义中的取值差；任一侧为 null 时不计算差值。 */
export interface Delta {
  before: Q | null
  after: Q | null
  delta: Q | null
}

/**
 * 两次尺寸链定义的差异。
 *
 * - addedTermIds / removedTermIds 按 term id 匹配，数组顺序分别沿用 after / before 的组成环顺序。
 * - orderChanged 只比较两边共有环的相对顺序；增删环本身不算顺序改变。
 * - termChanges 只描述两边共有环的字段变化，按 after 的组成环顺序、字段固定顺序排列。
 * - 计算结果全部来自 calculateChain，compare 模块不另写公式。
 */
export interface Diff {
  addedTermIds: string[]
  removedTermIds: string[]
  orderChanged: boolean
  termChanges: TermFieldChange[]
  targetChanged: boolean
  minQ: Delta
  maxQ: Delta
  toleranceQ: Delta
  lowerMarginQ: Delta
  upperMarginQ: Delta
  statusBefore: ChainResult['status']
  statusAfter: ChainResult['status']
}

/** 逐字段比较两个共有环；字段顺序与文档第 6 节的 DimensionTerm 一致。 */
function compareTermFields(before: DimensionTerm, after: DimensionTerm): TermFieldChange[] {
  const changes: TermFieldChange[] = []
  const termId = before.id

  if (before.symbol !== after.symbol) {
    changes.push({ termId, field: 'symbol', before: before.symbol, after: after.symbol })
  }
  if (before.name !== after.name) {
    changes.push({ termId, field: 'name', before: before.name, after: after.name })
  }
  if (before.nominalQ !== after.nominalQ) {
    changes.push({ termId, field: 'nominalQ', before: before.nominalQ, after: after.nominalQ })
  }
  if (before.lowerDeviationQ !== after.lowerDeviationQ) {
    changes.push({
      termId,
      field: 'lowerDeviationQ',
      before: before.lowerDeviationQ,
      after: after.lowerDeviationQ,
    })
  }
  if (before.upperDeviationQ !== after.upperDeviationQ) {
    changes.push({
      termId,
      field: 'upperDeviationQ',
      before: before.upperDeviationQ,
      after: after.upperDeviationQ,
    })
  }
  if (before.sign !== after.sign) {
    changes.push({ termId, field: 'sign', before: before.sign, after: after.sign })
  }
  if (before.sourceNote !== after.sourceNote) {
    changes.push({
      termId,
      field: 'sourceNote',
      before: before.sourceNote,
      after: after.sourceNote,
    })
  }

  return changes
}

/** 目标区间按值比较；null 与对象之间互切视为改变。 */
function targetChanged(
  before: ChainDefinition['target'],
  after: ChainDefinition['target'],
): boolean {
  if (before === null || after === null) {
    return before !== after
  }
  return before.minQ !== after.minQ || before.maxQ !== after.maxQ
}

/** 仅做 after − before；任一侧为 null（例如未设置目标时的裕量）时 delta 为 null。 */
function makeDelta(before: Q | null, after: Q | null): Delta {
  return {
    before,
    after,
    delta: before === null || after === null ? null : after - before,
  }
}

/** 按 id 集合过滤出共有环，保留传入定义的原始顺序。 */
function commonTermIds(chain: ChainDefinition, otherIds: ReadonlySet<string>): string[] {
  return chain.terms.filter((term) => otherIds.has(term.id)).map((term) => term.id)
}

/**
 * 比较两份已通过校验的尺寸链定义。
 *
 * 纯函数：不修改输入，所有结果型数值（极值、公差、裕量、判定）只调用 calculateChain 获得。
 * 其余差异只做字段相等判断和 id/顺序匹配，不包含任何尺寸链公式。
 */
export function compareChains(before: ChainDefinition, after: ChainDefinition): Diff {
  const beforeResult = calculateChain(before)
  const afterResult = calculateChain(after)

  const beforeIds = new Set(before.terms.map((term) => term.id))
  const afterIds = new Set(after.terms.map((term) => term.id))

  const addedTermIds = after.terms
    .filter((term) => !beforeIds.has(term.id))
    .map((term) => term.id)
  const removedTermIds = before.terms
    .filter((term) => !afterIds.has(term.id))
    .map((term) => term.id)

  const commonIds = new Set(
    before.terms.filter((term) => afterIds.has(term.id)).map((term) => term.id),
  )
  const beforeCommonOrder = commonTermIds(before, commonIds)
  const afterCommonOrder = commonTermIds(after, commonIds)
  const orderChanged = beforeCommonOrder.some(
    (termId, index) => termId !== afterCommonOrder[index],
  )

  const beforeById = new Map(before.terms.map((term) => [term.id, term]))
  const termChanges = after.terms.flatMap((term) => {
    const beforeTerm = beforeById.get(term.id)
    return beforeTerm === undefined ? [] : compareTermFields(beforeTerm, term)
  })

  return {
    addedTermIds,
    removedTermIds,
    orderChanged,
    termChanges,
    targetChanged: targetChanged(before.target, after.target),
    minQ: makeDelta(beforeResult.minQ, afterResult.minQ),
    maxQ: makeDelta(beforeResult.maxQ, afterResult.maxQ),
    toleranceQ: makeDelta(beforeResult.toleranceQ, afterResult.toleranceQ),
    lowerMarginQ: makeDelta(beforeResult.lowerMarginQ, afterResult.lowerMarginQ),
    upperMarginQ: makeDelta(beforeResult.upperMarginQ, afterResult.upperMarginQ),
    statusBefore: beforeResult.status,
    statusAfter: afterResult.status,
  }
}
