import type { ChainDefinition, DimensionTerm } from '../domain/types'
import { parseMm } from '../domain/units'

/**
 * 文档第 8 节的内置演示案例。
 *
 * 所有数值只来自 docs/MVP开发文档.md 第 8 节，不在 UI 或 fixture 里另编数值。
 * 每次创建都返回新的 ChainDefinition，避免演示项目之间共享可变对象。
 */
export type DemoCaseId = 'A' | 'B' | 'C'

export interface DemoCaseSummary {
  id: DemoCaseId
  name: string
}

/** 文档第 25 行原文；在打开演示案例处展示。 */
export const DEMO_DISCLAIMER =
  '该案例只是用于验证尺寸关系的简化模型，不代表任意实际轴承装配结构均适用。用户需要确认真实装配中的接触面、定位关系和作用方向。'

const DEMO_CASE_NAMES: Record<DemoCaseId, string> = {
  A: '演示案例 A：不满足目标的轴向间隙',
  B: '演示案例 B：修改后的满足方案',
  C: '演示案例 C：负间隙和边界',
}

export const DEMO_CASES: readonly DemoCaseSummary[] = (
  ['A', 'B', 'C'] as const
).map((id) => ({ id, name: DEMO_CASE_NAMES[id] }))

function term(
  id: string,
  symbol: string,
  name: string,
  nominal: string,
  lower: string,
  upper: string,
  sign: 1 | -1,
): DimensionTerm {
  return {
    id,
    symbol,
    name,
    nominalQ: parseMm(nominal),
    lowerDeviationQ: parseMm(lower),
    upperDeviationQ: parseMm(upper),
    sign,
    sourceNote: 'docs/MVP开发文档.md 第 8 节',
  }
}

/** 案例 A：不满足目标的轴向间隙。 */
function caseA(): ChainDefinition {
  return {
    terms: [
      term('demo-a-h', 'H', '机架', '100.0000', '0.0000', '0.1000', 1),
      term('demo-a-b1', 'B1', '轴承 1', '20.0000', '-0.0200', '0.0000', -1),
      term('demo-a-s', 'S', '隔套', '59.8000', '-0.0500', '0.0500', -1),
      term('demo-a-b2', 'B2', '轴承 2', '20.0000', '-0.0200', '0.0000', -1),
    ],
    target: { minQ: parseMm('0.1000'), maxQ: parseMm('0.3000') },
    assumptions: '内置演示案例 A，数值来自 docs/MVP开发文档.md 第 8 节。',
    relationConfirmed: true,
  }
}

/** 案例 B：从 A 修改 H 上偏差与 S 上下偏差后的满足方案。 */
function caseB(): ChainDefinition {
  return {
    terms: [
      term('demo-b-h', 'H', '机架', '100.0000', '0.0000', '0.0300', 1),
      term('demo-b-b1', 'B1', '轴承 1', '20.0000', '-0.0200', '0.0000', -1),
      term('demo-b-s', 'S', '隔套', '59.8000', '-0.0200', '0.0200', -1),
      term('demo-b-b2', 'B2', '轴承 2', '20.0000', '-0.0200', '0.0000', -1),
    ],
    target: { minQ: parseMm('0.1000'), maxQ: parseMm('0.3000') },
    assumptions: '内置演示案例 B，数值来自 docs/MVP开发文档.md 第 8 节。',
    relationConfirmed: true,
  }
}

/** 案例 C：负间隙，目标区间边界相等。 */
function caseC(): ChainDefinition {
  return {
    terms: [
      term('demo-c-p', 'P', '正环', '10.0000', '-0.1000', '0.0000', 1),
      term('demo-c-q', 'Q', '负环', '10.0500', '0.0000', '0.0500', -1),
    ],
    target: { minQ: parseMm('-0.2000'), maxQ: parseMm('-0.0500') },
    assumptions: '内置演示案例 C，数值来自 docs/MVP开发文档.md 第 8 节。',
    relationConfirmed: true,
  }
}

export function demoCaseName(id: DemoCaseId): string {
  return DEMO_CASE_NAMES[id]
}

export function createDemoChain(id: DemoCaseId): ChainDefinition {
  switch (id) {
    case 'A':
      return caseA()
    case 'B':
      return caseB()
    case 'C':
      return caseC()
  }
}
