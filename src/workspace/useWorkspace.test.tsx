// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { calculateChain } from '../domain/calculate'
import type { ChainDefinition } from '../domain/types'
import { parseMm } from '../domain/units'
import {
  draftToChain,
  type TermDraft,
  type WorkspaceAction,
  type WorkspaceDraft,
} from './draft'
import { useWorkspace, type UseWorkspaceResult } from './useWorkspace'

function term(overrides: Partial<TermDraft> = {}): TermDraft {
  return {
    id: 'H',
    symbol: 'H',
    name: '机架',
    nominal: '100.0000',
    lower: '0.0000',
    upper: '0.1000',
    sign: 1,
    sourceNote: '',
    termRevision: 1,
    ...overrides,
  }
}

function caseATerms(): TermDraft[] {
  return [
    term(),
    term({
      id: 'B1',
      symbol: 'B1',
      name: '轴承 1',
      nominal: '20.0000',
      lower: '-0.0200',
      upper: '0.0000',
      sign: -1,
    }),
    term({
      id: 'S',
      symbol: 'S',
      name: '隔套',
      nominal: '59.8000',
      lower: '-0.0500',
      upper: '0.0500',
      sign: -1,
    }),
    term({
      id: 'B2',
      symbol: 'B2',
      name: '轴承 2',
      nominal: '20.0000',
      lower: '-0.0200',
      upper: '0.0000',
      sign: -1,
    }),
  ]
}

function caseADraft(): WorkspaceDraft {
  return {
    terms: caseATerms(),
    targetMin: '0.1000',
    targetMax: '0.3000',
    relationRevision: 4,
    assumptions: '案例 A：不满足目标的轴向间隙',
  }
}

function dispatch(
  hook: { current: UseWorkspaceResult },
  action: WorkspaceAction,
): UseWorkspaceResult {
  act(() => {
    hook.current.dispatch(action)
  })
  return hook.current
}

/**
 * 每次 dispatch 后校验 hook 的派生状态：
 * 有效草稿的 chain / result 必须分别等于 draftToChain / calculateChain；
 * 无效草稿必须 stale 且错误定位与 draftToChain 一致。
 */
function dispatchAndCheck(
  hook: { current: UseWorkspaceResult },
  action: WorkspaceAction,
): UseWorkspaceResult {
  const state = dispatch(hook, action)
  const conversion = draftToChain(state.draft)

  if (conversion.ok) {
    expect(state.stale).toBe(false)
    expect(state.chain).toEqual(conversion.chain)
    expect(state.result).toEqual(calculateChain(conversion.chain))
    expect(state.cellErrors).toEqual({})
  } else {
    expect(state.stale).toBe(true)
    expect(state.chain).toBeNull()
    expect(state.cellErrors).toEqual(conversion.cellErrors)
  }

  return state
}

function buildCaseA(hook: { current: UseWorkspaceResult }): UseWorkspaceResult {
  for (const item of caseATerms()) {
    dispatchAndCheck(hook, { type: 'addTerm', term: item })
  }
  dispatchAndCheck(hook, {
    type: 'setTarget',
    targetMin: '0.1000',
    targetMax: '0.3000',
  })
  return dispatchAndCheck(hook, {
    type: 'setAssumptions',
    assumptions: '案例 A：不满足目标的轴向间隙',
  })
}

function chainOf(draft: WorkspaceDraft): ChainDefinition {
  const conversion = draftToChain(draft)
  if (!conversion.ok) {
    throw new Error(`预期草稿有效，实际错误：${JSON.stringify(conversion.cellErrors)}`)
  }
  return conversion.chain
}

const q = parseMm

describe('useWorkspace：初始状态', () => {
  it('空草稿没有结果且标记 stale，不把空输入当成有效结论', () => {
    const { result } = renderHook(() => useWorkspace())

    expect(result.current.draft.terms).toEqual([])
    expect(result.current.chain).toBeNull()
    expect(result.current.result).toBeNull()
    expect(result.current.cellErrors).toEqual({})
    expect(result.current.stale).toBe(true)
  })

  it('接受初始草稿并在首次渲染给出计算结果', () => {
    const { result } = renderHook(() => useWorkspace(caseADraft()))

    const conversion = draftToChain(result.current.draft)
    expect(conversion.ok).toBe(true)
    if (!conversion.ok) {
      return
    }
    expect(result.current.stale).toBe(false)
    expect(result.current.chain).toEqual(conversion.chain)
    expect(result.current.result).toEqual(calculateChain(conversion.chain))
    expect(result.current.result?.status).toBe('outside')
  })
})

describe('useWorkspace：从空草稿建立 A 再改成 B', () => {
  it('建立 A 的每一步，结果都等于对应 chain 的 calculateChain 输出', () => {
    const { result } = renderHook(() => useWorkspace())

    // 空草稿和只有一个组成环时无效，保留 null 结果并标记 stale。
    let state = dispatchAndCheck(result, {
      type: 'addTerm',
      term: caseATerms()[0],
    })
    expect(state.draft.terms).toHaveLength(1)
    expect(state.result).toBeNull()

    // 第二个组成环后成为可计算的两环链（尚未设置目标）。
    state = dispatchAndCheck(result, {
      type: 'addTerm',
      term: caseATerms()[1],
    })
    expect(state.result?.status).toBe('no-target')

    state = dispatchAndCheck(result, {
      type: 'addTerm',
      term: caseATerms()[2],
    })
    expect(state.stale).toBe(false)

    state = dispatchAndCheck(result, {
      type: 'addTerm',
      term: caseATerms()[3],
    })
    expect(state.draft.terms).toHaveLength(4)

    state = dispatchAndCheck(result, {
      type: 'setTarget',
      targetMin: '0.1000',
      targetMax: '0.3000',
    })
    expect(state.result).toEqual(calculateChain(chainOf(state.draft)))
    expect(state.result?.status).toBe('outside')

    state = dispatchAndCheck(result, {
      type: 'setAssumptions',
      assumptions: '案例 A：不满足目标的轴向间隙',
    })
    // 4 次 addTerm 各递增一次；确认状态不再属于草稿。
    expect(state.draft.relationRevision).toBe(4)
    expect(state.draft).toEqual(caseADraft())
    expect(state.result).toEqual(calculateChain(chainOf(state.draft)))
    expect(state.result?.minQ).toBe(q('0.1500'))
    expect(state.result?.maxQ).toBe(q('0.3900'))
    expect(state.result?.status).toBe('outside')
    expect(state.relationConfirmed).toBe(false)
  })

  it('修改到 B 的每一步结果都等于对应 chain 的 calculateChain 输出', () => {
    const { result } = renderHook(() => useWorkspace())
    buildCaseA(result)

    let state = dispatchAndCheck(result, {
      type: 'updateField',
      termId: 'H',
      field: 'upper',
      value: '0.0300',
    })
    expect(state.draft.relationRevision).toBeGreaterThan(4)
    expect(state.result?.maxQ).toBe(q('0.3200'))

    state = dispatchAndCheck(result, {
      type: 'updateField',
      termId: 'S',
      field: 'lower',
      value: '-0.0200',
    })
    expect(state.result?.minQ).toBe(q('0.1500'))
    expect(state.result?.maxQ).toBe(q('0.2900'))

    state = dispatchAndCheck(result, {
      type: 'updateField',
      termId: 'S',
      field: 'upper',
      value: '0.0200',
    })
    expect(state.result?.maxQ).toBe(q('0.2900'))

    state = dispatchAndCheck(result, {
      type: 'setAssumptions',
      assumptions: '案例 B：修改后的满足方案',
    })
    expect(state.result?.status).toBe('within')
    expect(state.result?.minQ).toBe(q('0.1800'))
    expect(state.result?.maxQ).toBe(q('0.2900'))
    expect(state.result?.toleranceQ).toBe(q('0.1100'))
  })
})

describe('useWorkspace：无效输入', () => {
  it('单元格错误定位到具体输入，并保留上一次有效结果且 stale', () => {
    const { result } = renderHook(() => useWorkspace(caseADraft()))
    const previousResult = result.current.result
    expect(previousResult).not.toBeNull()

    const invalid = dispatchAndCheck(result, {
      type: 'updateField',
      termId: 'H',
      field: 'nominal',
      value: '',
    })

    expect(invalid.cellErrors).toEqual({ 'H.nominal': '请输入数值' })
    expect(invalid.stale).toBe(true)
    expect(invalid.result).toBe(previousResult)

    const stillInvalid = dispatchAndCheck(result, {
      type: 'updateField',
      termId: 'S',
      field: 'upper',
      value: '0.00001',
    })
    expect(stillInvalid.cellErrors['H.nominal']).toBe('请输入数值')
    expect(stillInvalid.cellErrors['S.upper']).toContain('最多 4 位小数')
    expect(stillInvalid.stale).toBe(true)
    expect(stillInvalid.result).toBe(previousResult)

    dispatchAndCheck(result, {
      type: 'updateField',
      termId: 'H',
      field: 'nominal',
      value: '100.0000',
    })
    const fixed = dispatchAndCheck(result, {
      type: 'updateField',
      termId: 'S',
      field: 'upper',
      value: '0.0500',
    })
    expect(fixed.stale).toBe(false)
    expect(fixed.cellErrors).toEqual({})
    expect(fixed.result).not.toBe(previousResult)
    expect(fixed.result?.nominalQ).toBe(q('0.2000'))
  })

  it('目标区间错误定位到 target.min / target.max 且不覆盖上次结果', () => {
    const { result } = renderHook(() => useWorkspace(caseADraft()))
    const previousResult = result.current.result

    const invalid = dispatchAndCheck(result, {
      type: 'setTarget',
      targetMin: '0.5000',
      targetMax: '0.1000',
    })

    expect(invalid.cellErrors).toEqual({
      'target.max': '目标上限不能小于目标下限',
    })
    expect(invalid.stale).toBe(true)
    expect(invalid.chain).toBeNull()
    expect(invalid.result).toBe(previousResult)

    const cleared = dispatchAndCheck(result, {
      type: 'setTarget',
      targetMin: '',
      targetMax: '',
    })
    expect(cleared.stale).toBe(false)
    expect(cleared.cellErrors).toEqual({})
    expect(cleared.result?.status).toBe('no-target')
  })

  it('重复代号错误定位到后出现的组成环 symbol 单元格', () => {
    const { result } = renderHook(() => useWorkspace(caseADraft()))
    const previousResult = result.current.result

    const invalid = dispatchAndCheck(result, {
      type: 'updateField',
      termId: 'B1',
      field: 'symbol',
      value: 'H',
    })

    expect(Object.keys(invalid.cellErrors)).toEqual(['B1.symbol'])
    expect(invalid.cellErrors['B1.symbol']).toContain('重复')
    expect(invalid.stale).toBe(true)
    expect(invalid.result).toBe(previousResult)
  })
})
