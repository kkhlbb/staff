import { describe, expect, it } from 'vitest'
import { calculateChain } from '../domain/calculate'
import type { ChainDefinition } from '../domain/types'
import { parseMm } from '../domain/units'
import {
  draftToChain,
  emptyDraft,
  workspaceReducer,
  type CellErrors,
  type TermDraft,
  type WorkspaceAction,
  type WorkspaceDraft,
} from './draft'

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
    assumptions: '案例 A：不满足目标的轴向间隙',
    relationConfirmed: true,
  }
}

function caseBDraft(): WorkspaceDraft {
  const terms = caseATerms()
  terms[0] = { ...terms[0], upper: '0.0300' }
  terms[2] = { ...terms[2], lower: '-0.0200', upper: '0.0200' }
  return {
    ...caseADraft(),
    terms,
    assumptions: '案例 B：修改后的满足方案',
  }
}

/** 从空草稿逐步建出案例 A。 */
function buildCaseA(): WorkspaceDraft {
  let draft = emptyDraft
  for (const item of caseATerms()) {
    draft = workspaceReducer(draft, { type: 'addTerm', term: item })
  }
  draft = workspaceReducer(draft, {
    type: 'setTarget',
    targetMin: '0.1000',
    targetMax: '0.3000',
  })
  draft = workspaceReducer(draft, {
    type: 'setAssumptions',
    assumptions: '案例 A：不满足目标的轴向间隙',
  })
  return workspaceReducer(draft, { type: 'setConfirmed', confirmed: true })
}

function reduce(
  draft: WorkspaceDraft,
  ...actions: WorkspaceAction[]
): WorkspaceDraft {
  return actions.reduce(workspaceReducer, draft)
}

function expectConversionFailure(draft: WorkspaceDraft): CellErrors {
  const result = draftToChain(draft)
  if (result.ok) {
    throw new Error('预期草稿无效，实际转换成功')
  }
  return result.cellErrors
}

function expectConversionSuccess(draft: WorkspaceDraft): ChainDefinition {
  const result = draftToChain(draft)
  if (!result.ok) {
    throw new Error(`预期草稿有效，实际错误：${JSON.stringify(result.cellErrors)}`)
  }
  return result.chain
}

const q = parseMm

describe('emptyDraft', () => {
  it('空草稿没有组成环、没有目标且未确认', () => {
    expect(emptyDraft).toEqual({
      terms: [],
      targetMin: '',
      targetMax: '',
      assumptions: '',
      relationConfirmed: false,
    })
  })

  it('空草稿不能转换为尺寸链，且没有可定位的单元格错误', () => {
    expect(expectConversionFailure(emptyDraft)).toEqual({})
  })
})

describe('draftToChain：合法转换', () => {
  it('案例 A 转换为与文档一致的领域链', () => {
    const chain = expectConversionSuccess(caseADraft())

    expect(chain).toEqual({
      terms: [
        {
          id: 'H',
          symbol: 'H',
          name: '机架',
          nominalQ: q('100.0000'),
          lowerDeviationQ: q('0.0000'),
          upperDeviationQ: q('0.1000'),
          sign: 1,
          sourceNote: '',
        },
        {
          id: 'B1',
          symbol: 'B1',
          name: '轴承 1',
          nominalQ: q('20.0000'),
          lowerDeviationQ: q('-0.0200'),
          upperDeviationQ: q('0.0000'),
          sign: -1,
          sourceNote: '',
        },
        {
          id: 'S',
          symbol: 'S',
          name: '隔套',
          nominalQ: q('59.8000'),
          lowerDeviationQ: q('-0.0500'),
          upperDeviationQ: q('0.0500'),
          sign: -1,
          sourceNote: '',
        },
        {
          id: 'B2',
          symbol: 'B2',
          name: '轴承 2',
          nominalQ: q('20.0000'),
          lowerDeviationQ: q('-0.0200'),
          upperDeviationQ: q('0.0000'),
          sign: -1,
          sourceNote: '',
        },
      ],
      target: { minQ: q('0.1000'), maxQ: q('0.3000') },
      assumptions: '案例 A：不满足目标的轴向间隙',
      relationConfirmed: true,
    })

    const result = calculateChain(chain)
    expect(result.minQ).toBe(q('0.1500'))
    expect(result.maxQ).toBe(q('0.3900'))
    expect(result.status).toBe('outside')
  })

  it('案例 B 转换为与文档一致的领域链', () => {
    const chain = expectConversionSuccess(caseBDraft())

    expect(chain.terms.map((item) => item.upperDeviationQ)).toEqual([
      q('0.0300'),
      q('0.0000'),
      q('0.0200'),
      q('0.0000'),
    ])
    expect(chain.terms[2].lowerDeviationQ).toBe(q('-0.0200'))
    const result = calculateChain(chain)
    expect(result.minQ).toBe(q('0.1800'))
    expect(result.maxQ).toBe(q('0.2900'))
    expect(result.status).toBe('within')
  })

  it('目标上下限都为空时 target 为 null', () => {
    const chain = expectConversionSuccess({
      ...caseADraft(),
      targetMin: '',
      targetMax: '',
    })
    expect(chain.target).toBeNull()
    expect(calculateChain(chain).status).toBe('no-target')
  })

  it('只有空白的目标上下限也视为未设置目标', () => {
    const chain = expectConversionSuccess({
      ...caseADraft(),
      targetMin: '  ',
      targetMax: ' ',
    })
    expect(chain.target).toBeNull()
  })
})

describe('draftToChain：单元格错误定位', () => {
  it('空的数值输入定位到对应单元格，并保留 tryParseMm 的具体提示', () => {
    const draft = caseADraft()
    draft.terms[0] = { ...draft.terms[0], nominal: '' }

    const errors = expectConversionFailure(draft)
    expect(errors).toEqual({ 'H.nominal': '请输入数值' })
  })

  it('非数字和超过 4 位小数分别定位到对应单元格', () => {
    const draft = caseADraft()
    draft.terms[1] = { ...draft.terms[1], lower: 'abc' }
    draft.terms[2] = { ...draft.terms[2], upper: '0.00001' }

    const errors = expectConversionFailure(draft)
    expect(errors['B1.lower']).toContain('格式不正确')
    expect(errors['S.upper']).toContain('最多 4 位小数')
    expect(Object.keys(errors).sort()).toEqual(['B1.lower', 'S.upper'])
  })

  it('上偏差小于下偏差定位到 upper 单元格', () => {
    const draft = caseADraft()
    draft.terms[2] = { ...draft.terms[2], lower: '0.1000', upper: '0.0500' }

    const errors = expectConversionFailure(draft)
    expect(Object.keys(errors)).toEqual(['S.upper'])
    expect(errors['S.upper']).toContain('上偏差不能小于下偏差')
  })

  it('下极限尺寸为负定位到 lower 单元格', () => {
    const draft = caseADraft()
    draft.terms[1] = { ...draft.terms[1], nominal: '0.0100', lower: '-0.0200' }

    const errors = expectConversionFailure(draft)
    expect(Object.keys(errors)).toEqual(['B1.lower'])
    expect(errors['B1.lower']).toContain('下极限尺寸不能为负')
  })

  it('重复代号定位到后出现的组成环 symbol 单元格', () => {
    const draft = caseADraft()
    draft.terms[1] = { ...draft.terms[1], symbol: 'H' }

    const errors = expectConversionFailure(draft)
    expect(Object.keys(errors)).toEqual(['B1.symbol'])
    expect(errors['B1.symbol']).toContain('重复')
  })

  it('空名称和空代号分别定位到 name、symbol 单元格', () => {
    const draft = caseADraft()
    draft.terms[3] = { ...draft.terms[3], symbol: ' ', name: '' }

    const errors = expectConversionFailure(draft)
    expect(errors['B2.symbol']).toContain('代号不能为空')
    expect(errors['B2.name']).toContain('名称不能为空')
  })

  it('目标上限小于下限定位到 target.max', () => {
    const draft = { ...caseADraft(), targetMin: '0.4000', targetMax: '0.3000' }

    const errors = expectConversionFailure(draft)
    expect(Object.keys(errors)).toEqual(['target.max'])
    expect(errors['target.max']).toContain('目标上限不能小于目标下限')
  })

  it('只填写目标一侧时，空的一侧定位到 target.min / target.max', () => {
    const missingMin = expectConversionFailure({
      ...caseADraft(),
      targetMin: '',
      targetMax: '0.3000',
    })
    expect(missingMin).toEqual({ 'target.min': '请输入数值' })

    const missingMax = expectConversionFailure({
      ...caseADraft(),
      targetMin: '0.1000',
      targetMax: '',
    })
    expect(missingMax).toEqual({ 'target.max': '请输入数值' })
  })

  it('解析错误和领域校验错误合并返回，并各自定位到单元格', () => {
    const draft = caseADraft()
    draft.terms[0] = { ...draft.terms[0], nominal: 'abc' }
    draft.terms[1] = { ...draft.terms[1], symbol: 'H' }
    draft.terms[2] = { ...draft.terms[2], lower: '0.1000', upper: '0.0500' }
    draft.targetMin = '0.5000'
    draft.targetMax = '0.1000'

    const errors = expectConversionFailure(draft)
    expect(Object.keys(errors).sort()).toEqual([
      'B1.symbol',
      'H.nominal',
      'S.upper',
      'target.max',
    ])
  })
})

describe('workspaceReducer：建立案例 A 并修改为 B', () => {
  it('从空草稿逐步建出案例 A，再逐步改成案例 B', () => {
    const draftA = buildCaseA()
    expect(draftA).toEqual(caseADraft())
    expect(draftA.relationConfirmed).toBe(true)

    const draftB = reduce(
      draftA,
      { type: 'updateField', termId: 'H', field: 'upper', value: '0.0300' },
      { type: 'updateField', termId: 'S', field: 'lower', value: '-0.0200' },
      { type: 'updateField', termId: 'S', field: 'upper', value: '0.0200' },
      {
        type: 'setAssumptions',
        assumptions: '案例 B：修改后的满足方案',
      },
      { type: 'setConfirmed', confirmed: true },
    )

    expect(draftB).toEqual(caseBDraft())
    expect(draftB.relationConfirmed).toBe(true)
  })

  it('增删组成环不会修改原草稿', () => {
    const draft = caseADraft()
    const added = workspaceReducer(draft, {
      type: 'addTerm',
      term: term({ id: 'X', symbol: 'X', name: '新增' }),
    })
    expect(draft.terms).toHaveLength(4)
    expect(added.terms).toHaveLength(5)
    expect(added.terms[4].id).toBe('X')

    const removed = workspaceReducer(added, { type: 'removeTerm', termId: 'B1' })
    expect(added.terms).toHaveLength(5)
    expect(removed.terms.map((item) => item.id)).toEqual(['H', 'S', 'B2', 'X'])
  })

  it('删除不存在的组成环是空操作', () => {
    const draft = caseADraft()
    expect(workspaceReducer(draft, { type: 'removeTerm', termId: 'missing' })).toBe(
      draft,
    )
  })

  it('moveTerm 只调整顺序，不改变数值与确认状态', () => {
    const draft = caseADraft()
    const before = calculateChain(expectConversionSuccess(draft))

    const moved = workspaceReducer(draft, {
      type: 'moveTerm',
      termId: 'S',
      direction: 'up',
    })

    expect(moved.terms.map((item) => item.id)).toEqual(['H', 'S', 'B1', 'B2'])
    expect(moved.relationConfirmed).toBe(true)
    const after = calculateChain(expectConversionSuccess(moved))
    expect(after.nominalQ).toBe(before.nominalQ)
    expect(after.minQ).toBe(before.minQ)
    expect(after.maxQ).toBe(before.maxQ)
    expect(after.toleranceQ).toBe(before.toleranceQ)
  })

  it('边界移动和更新不存在的组成环都是空操作', () => {
    const draft = caseADraft()
    expect(
      workspaceReducer(draft, {
        type: 'moveTerm',
        termId: 'H',
        direction: 'up',
      }),
    ).toBe(draft)
    expect(
      workspaceReducer(draft, {
        type: 'moveTerm',
        termId: 'B2',
        direction: 'down',
      }),
    ).toBe(draft)
    expect(
      workspaceReducer(draft, {
        type: 'updateField',
        termId: 'missing',
        field: 'name',
        value: '不存在',
      }),
    ).toBe(draft)
  })
})

describe('workspaceReducer：清除关系确认', () => {
  it('addTerm 清除确认', () => {
    const next = workspaceReducer(caseADraft(), {
      type: 'addTerm',
      term: term({ id: 'X', symbol: 'X', name: '新增' }),
    })
    expect(next.relationConfirmed).toBe(false)
  })

  it('removeTerm 清除确认', () => {
    const next = workspaceReducer(caseADraft(), {
      type: 'removeTerm',
      termId: 'B1',
    })
    expect(next.relationConfirmed).toBe(false)
  })

  it('改 symbol 清除确认', () => {
    const next = workspaceReducer(caseADraft(), {
      type: 'updateField',
      termId: 'H',
      field: 'symbol',
      value: 'H2',
    })
    expect(next.relationConfirmed).toBe(false)
  })

  it('改 sign 清除确认', () => {
    const next = workspaceReducer(caseADraft(), {
      type: 'updateField',
      termId: 'H',
      field: 'sign',
      value: -1,
    })
    expect(next.relationConfirmed).toBe(false)
  })

  it.each([
    ['nominal', '110.0000'],
    ['lower', '-0.0100'],
    ['upper', '0.2000'],
  ] as const)('改组成环数值 %s 清除确认', (field, value) => {
    const next = workspaceReducer(caseADraft(), {
      type: 'updateField',
      termId: 'H',
      field,
      value,
    })
    expect(next.relationConfirmed).toBe(false)
  })
})

describe('workspaceReducer：不清除关系确认', () => {
  it('改 name 不清除确认', () => {
    const next = workspaceReducer(caseADraft(), {
      type: 'updateField',
      termId: 'H',
      field: 'name',
      value: '机架（改名）',
    })
    expect(next.terms[0].name).toBe('机架（改名）')
    expect(next.relationConfirmed).toBe(true)
  })

  it('改 sourceNote 不清除确认', () => {
    const next = workspaceReducer(caseADraft(), {
      type: 'updateField',
      termId: 'H',
      field: 'sourceNote',
      value: '图纸 A-01',
    })
    expect(next.terms[0].sourceNote).toBe('图纸 A-01')
    expect(next.relationConfirmed).toBe(true)
  })

  it('setAssumptions 不清除确认', () => {
    const next = workspaceReducer(caseADraft(), {
      type: 'setAssumptions',
      assumptions: '按一维尺寸链计算',
    })
    expect(next.assumptions).toBe('按一维尺寸链计算')
    expect(next.relationConfirmed).toBe(true)
  })

  it('setTarget 不清除确认', () => {
    const next = workspaceReducer(caseADraft(), {
      type: 'setTarget',
      targetMin: '0.2000',
      targetMax: '0.4000',
    })
    expect(next.targetMin).toBe('0.2000')
    expect(next.targetMax).toBe('0.4000')
    expect(next.relationConfirmed).toBe(true)
  })

  it('moveTerm 向上不清除确认', () => {
    const next = workspaceReducer(caseADraft(), {
      type: 'moveTerm',
      termId: 'B1',
      direction: 'up',
    })
    expect(next.terms.map((item) => item.id)).toEqual(['B1', 'H', 'S', 'B2'])
    expect(next.relationConfirmed).toBe(true)
  })

  it('moveTerm 向下不清除确认', () => {
    const next = workspaceReducer(caseADraft(), {
      type: 'moveTerm',
      termId: 'H',
      direction: 'down',
    })
    expect(next.terms.map((item) => item.id)).toEqual(['B1', 'H', 'S', 'B2'])
    expect(next.relationConfirmed).toBe(true)
  })

  it('值没有实际变化时是空操作，不改变确认状态', () => {
    const draft = caseADraft()
    expect(
      workspaceReducer(draft, {
        type: 'updateField',
        termId: 'H',
        field: 'symbol',
        value: 'H',
      }),
    ).toBe(draft)
    expect(
      workspaceReducer(draft, {
        type: 'setTarget',
        targetMin: draft.targetMin,
        targetMax: draft.targetMax,
      }),
    ).toBe(draft)
  })

  it('setConfirmed 可以重新设为 true', () => {
    const draft = { ...caseADraft(), relationConfirmed: false }
    const next = workspaceReducer(draft, {
      type: 'setConfirmed',
      confirmed: true,
    })
    expect(next.relationConfirmed).toBe(true)
  })
})
