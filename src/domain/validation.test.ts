import { describe, expect, it } from 'vitest'
import { MAX_ABS_Q, type ChainDefinition, type DimensionTerm } from './types'
import { parseMm, tryParseMm } from './units'
import {
  validateChain,
  type ValidationError,
  type ValidationResult,
} from './validation'

const mm = parseMm

function makeTerm(overrides: Partial<DimensionTerm> = {}): DimensionTerm {
  return {
    id: 'id-1',
    symbol: 'H',
    name: '机架',
    nominalQ: mm('100'),
    lowerDeviationQ: 0,
    upperDeviationQ: mm('0.1'),
    sign: 1,
    sourceNote: '',
    termRevision: 1,
    ...overrides,
  }
}

function makeChain(overrides: Partial<ChainDefinition> = {}): ChainDefinition {
  return {
    terms: [
      makeTerm(),
      makeTerm({
        id: 'id-2',
        symbol: 'B1',
        name: '轴承',
        nominalQ: mm('20'),
        lowerDeviationQ: mm('-0.02'),
        upperDeviationQ: 0,
        sign: -1,
        sourceNote: '图纸 A-01',
        termRevision: 1,
      }),
    ],
    target: { minQ: mm('0.1'), maxQ: mm('0.3') },
    assumptions: '按一维尺寸链计算',
    ...overrides,
  }
}

function makeTerms(count: number): DimensionTerm[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `id-${index + 1}`,
    symbol: `S${index + 1}`,
    name: `组成环 ${index + 1}`,
    nominalQ: mm('1'),
    lowerDeviationQ: 0,
    upperDeviationQ: mm('0.01'),
    sign: (index % 2 === 0 ? 1 : -1) as 1 | -1,
    sourceNote: '',
    termRevision: 1,
  }))
}

/** 替换第 index 个环的字段；返回 unknown 以便测试非法字段类型。 */
function replaceTerm(index: number, overrides: Record<string, unknown>): unknown {
  const chain = makeChain()
  return {
    ...chain,
    terms: chain.terms.map((term, termIndex) =>
      termIndex === index ? { ...term, ...overrides } : term,
    ),
  }
}

function withoutField<T extends object>(value: T, field: keyof T): Record<string, unknown> {
  const copy = { ...value } as Record<string, unknown>
  Reflect.deleteProperty(copy, field)
  return copy
}

function expectValid(input: unknown): ChainDefinition {
  const result = validateChain(input)
  if (!result.ok) {
    throw new Error(`预期校验通过，实际错误：${JSON.stringify(result.errors)}`)
  }
  return result.value
}

function errorsOf(input: unknown): ValidationError[] {
  const result = validateChain(input)
  if (result.ok) {
    throw new Error('预期校验失败，实际通过')
  }
  return result.errors
}

function findError(
  errors: ValidationError[],
  path: (string | number)[],
  code: string,
): ValidationError | undefined {
  return errors.find(
    (error) =>
      error.code === code &&
      error.path.length === path.length &&
      error.path.every((segment, index) => segment === path[index]),
  )
}

function expectError(input: unknown, path: (string | number)[], code: string): void {
  const result: ValidationResult = validateChain(input)
  expect(result.ok).toBe(false)
  if (result.ok) {
    return
  }
  const matched = findError(result.errors, path, code)
  expect(matched).toBeDefined()
  expect(matched?.message.length).toBeGreaterThan(0)
}

describe('合法尺寸链', () => {
  it('2 个组成环通过校验', () => {
    const chain = makeChain({ terms: makeTerms(2), target: null })
    expect(expectValid(chain).terms).toHaveLength(2)
  })

  it('20 个组成环通过校验', () => {
    const chain = makeChain({ terms: makeTerms(20), target: null })
    expect(expectValid(chain).terms).toHaveLength(20)
  })

  it('target 为 null 合法', () => {
    const chain = makeChain({ target: null })
    expect(expectValid(chain).target).toBeNull()
  })

  it('EI 和 ES 同为正合法', () => {
    const chain = replaceTerm(0, {
      lowerDeviationQ: mm('0.01'),
      upperDeviationQ: mm('0.02'),
    })
    expectValid(chain)
  })

  it('EI 和 ES 同为负合法', () => {
    const chain = replaceTerm(0, {
      lowerDeviationQ: mm('-0.02'),
      upperDeviationQ: mm('-0.01'),
    })
    expectValid(chain)
  })

  it('MAX_ABS_Q 边界值合法', () => {
    const chain = replaceTerm(0, {
      nominalQ: MAX_ABS_Q,
      lowerDeviationQ: 0,
      upperDeviationQ: 0,
    })
    expectValid(chain)
  })
})

describe('组成环数量', () => {
  it('1 个被拒，path 指到 terms', () => {
    expectError(makeChain({ terms: makeTerms(1) }), ['terms'], 'terms_count')
  })

  it('21 个被拒，path 指到 terms', () => {
    expectError(makeChain({ terms: makeTerms(21) }), ['terms'], 'terms_count')
  })

  it('terms 不是数组被拒', () => {
    expectError({ ...makeChain(), terms: 'not-an-array' }, ['terms'], 'terms_type')
  })
})

describe('组成环字段', () => {
  it.each([0, 2, '1', null])('sign 为 %j 被拒', (sign) => {
    expectError(replaceTerm(0, { sign }), ['terms', 0, 'sign'], 'sign_invalid')
  })

  it('名称只有空白被拒', () => {
    expectError(replaceTerm(0, { name: '   ' }), ['terms', 0, 'name'], 'name_required')
  })

  it('id 为空被拒', () => {
    expectError(replaceTerm(0, { id: '' }), ['terms', 0, 'id'], 'id_required')
  })

  it('代号只有空白被拒', () => {
    expectError(replaceTerm(0, { symbol: ' \t ' }), ['terms', 0, 'symbol'], 'symbol_required')
  })

  it('sourceNote 不是字符串被拒，但空字符串合法', () => {
    expectError(replaceTerm(0, { sourceNote: 42 }), ['terms', 0, 'sourceNote'], 'source_note_type')
    expectValid(replaceTerm(0, { sourceNote: '' }))
  })

  it('组成环不是对象被拒', () => {
    expectError({ ...makeChain(), terms: [makeTerm(), null] }, ['terms', 1], 'term_type')
  })
})

describe('数值字段', () => {
  it.each([
    ['undefined', undefined, 'q_not_number'],
    ['空字符串', '', 'q_not_number'],
    ['非数字字符串', 'abc', 'q_not_number'],
    ['数字字符串', '20', 'q_not_number'],
    ['NaN', Number.NaN, 'q_not_number'],
    ['Infinity', Number.POSITIVE_INFINITY, 'q_not_number'],
    ['null', null, 'q_not_number'],
    ['小数 q', 0.5, 'q_not_safe_integer'],
    ['非整数 q', 1.2, 'q_not_safe_integer'],
  ])('nominalQ 为 %s 被拒', (_name, nominalQ, code) => {
    expectError(replaceTerm(0, { nominalQ }), ['terms', 0, 'nominalQ'], code)
  })

  it.each([MAX_ABS_Q + 1, -MAX_ABS_Q - 1])('nominalQ 超出 MAX_ABS_Q：%d 被拒', (nominalQ) => {
    expectError(replaceTerm(0, { nominalQ }), ['terms', 0, 'nominalQ'], 'q_out_of_range')
  })

  it.each([0, -1])('nominalQ 为 %d 被拒', (nominalQ) => {
    expectError(replaceTerm(0, { nominalQ }), ['terms', 0, 'nominalQ'], 'nominal_not_positive')
  })

  it('上偏差小于下偏差被拒，path 指到 upperDeviationQ', () => {
    expectError(
      replaceTerm(0, { lowerDeviationQ: 1, upperDeviationQ: 0 }),
      ['terms', 0, 'upperDeviationQ'],
      'deviation_order',
    )
  })

  it('基本尺寸加下偏差小于 0 被拒', () => {
    expectError(
      replaceTerm(0, { nominalQ: 1, lowerDeviationQ: -2, upperDeviationQ: 0 }),
      ['terms', 0, 'lowerDeviationQ'],
      'lower_limit_negative',
    )
  })

  it('下偏差、上偏差相等合法', () => {
    expectValid(replaceTerm(0, { lowerDeviationQ: 0, upperDeviationQ: 0 }))
  })

  it('目标区间字段同样要求安全整数', () => {
    expectError(
      { ...makeChain(), target: { minQ: '0.1', maxQ: mm('0.3') } },
      ['target', 'minQ'],
      'q_not_number',
    )
    expectError(
      { ...makeChain(), target: { minQ: 0.5, maxQ: mm('0.3') } },
      ['target', 'minQ'],
      'q_not_safe_integer',
    )
    expectError(
      { ...makeChain(), target: { minQ: 0, maxQ: MAX_ABS_Q + 1 } },
      ['target', 'maxQ'],
      'q_out_of_range',
    )
  })
})

describe('重复字段', () => {
  it('重复代号（symbol）被拒，并指到后出现的环', () => {
    const chain = makeChain({
      terms: [
        makeTerm(),
        makeTerm({ id: 'id-2', symbol: 'H', name: '重复代号', sign: -1 }),
      ],
    })
    expectError(chain, ['terms', 1, 'symbol'], 'duplicate_symbol')
  })

  it('重复 id 被拒，并指到后出现的环', () => {
    const chain = makeChain({
      terms: [
        makeTerm(),
        makeTerm({ id: 'id-1', symbol: 'B1', name: '重复 id', sign: -1 }),
      ],
    })
    expectError(chain, ['terms', 1, 'id'], 'duplicate_id')
  })
})

describe('目标区间与其它字段', () => {
  it('目标下限大于上限被拒', () => {
    expectError(
      { ...makeChain(), target: { minQ: 10, maxQ: 5 } },
      ['target', 'maxQ'],
      'target_order',
    )
  })

  it('目标下限等于上限合法', () => {
    expectValid({ ...makeChain(), target: { minQ: 5, maxQ: 5 } })
  })

  it('target 缺失被拒', () => {
    expectError(withoutField(makeChain(), 'target'), ['target'], 'target_type')
  })

  it('assumptions 不是字符串被拒，但空字符串合法', () => {
    expectError({ ...makeChain(), assumptions: 1 }, ['assumptions'], 'assumptions_type')
    expectValid({ ...makeChain(), assumptions: '' })
  })

  it('termRevision 缺失、0 或非整数被拒', () => {
    const chain = makeChain()
    const withRevision = (revision: unknown) => ({
      ...chain,
      terms: [{ ...chain.terms[0], termRevision: revision }, chain.terms[1]],
    })
    expectError(withRevision(0), ['terms', 0, 'termRevision'], 'term_revision_invalid')
    expectError(withRevision(1.5), ['terms', 0, 'termRevision'], 'term_revision_invalid')
    expectError(withRevision(undefined), ['terms', 0, 'termRevision'], 'term_revision_invalid')
  })

  it('输入不是对象时返回 chain_type', () => {
    expectError(null, [], 'chain_type')
    expectError([], [], 'chain_type')
  })
})

describe('一次返回所有错误', () => {
  it('多个环、多个字段的错误同时返回', () => {
    const input = {
      terms: [
        {
          ...makeTerm(),
          id: '',
          name: '',
          sign: 0,
          nominalQ: 'not-a-number',
          lowerDeviationQ: 0.5,
          upperDeviationQ: undefined,
          sourceNote: 1,
          termRevision: 0,
        },
        makeTerm({ id: 'id-2', symbol: 'H', name: '重复代号', sign: -1 }),
      ],
      target: { minQ: 10, maxQ: 5 },
      assumptions: 1,
    }
    const errors = errorsOf(input)
    const expected: [(string | number)[], string][] = [
      [['terms', 0, 'id'], 'id_required'],
      [['terms', 0, 'name'], 'name_required'],
      [['terms', 0, 'sign'], 'sign_invalid'],
      [['terms', 0, 'nominalQ'], 'q_not_number'],
      [['terms', 0, 'lowerDeviationQ'], 'q_not_safe_integer'],
      [['terms', 0, 'upperDeviationQ'], 'q_not_number'],
      [['terms', 0, 'sourceNote'], 'source_note_type'],
      [['terms', 1, 'symbol'], 'duplicate_symbol'],
      [['target', 'maxQ'], 'target_order'],
      [['assumptions'], 'assumptions_type'],
      [['terms', 0, 'termRevision'], 'term_revision_invalid'],
    ]
    for (const [path, code] of expected) {
      expect(findError(errors, path, code)).toBeDefined()
    }
    expect(errors.length).toBe(expected.length)
  })
})

describe('精度联动', () => {
  // 字符串级的“超过 4 位小数”在进入领域层之前由 units.tryParseMm 拦截；
  // 领域层只能看到整数 q，因此这里用 0.5 模拟非整数 q 作为第二道防线。
  it('字符串级超精度由 units.tryParseMm 拦截', () => {
    expect(tryParseMm('1.00001')).toMatchObject({ ok: false, code: 'precision' })
  })

  it('领域层非整数 q 被拒', () => {
    expectError(replaceTerm(0, { nominalQ: 0.5 }), ['terms', 0, 'nominalQ'], 'q_not_safe_integer')
  })
})

describe('文档第 8 节案例', () => {
  const caseA: ChainDefinition = makeChain({
    terms: [
      makeTerm({
        id: 'H',
        symbol: 'H',
        name: '机架',
        nominalQ: mm('100.0000'),
        lowerDeviationQ: mm('0.0000'),
        upperDeviationQ: mm('0.1000'),
        sign: 1,
      }),
      makeTerm({
        id: 'B1',
        symbol: 'B1',
        name: '轴承 1',
        nominalQ: mm('20.0000'),
        lowerDeviationQ: mm('-0.0200'),
        upperDeviationQ: mm('0.0000'),
        sign: -1,
      }),
      makeTerm({
        id: 'S',
        symbol: 'S',
        name: '隔套',
        nominalQ: mm('59.8000'),
        lowerDeviationQ: mm('-0.0500'),
        upperDeviationQ: mm('0.0500'),
        sign: -1,
      }),
      makeTerm({
        id: 'B2',
        symbol: 'B2',
        name: '轴承 2',
        nominalQ: mm('20.0000'),
        lowerDeviationQ: mm('-0.0200'),
        upperDeviationQ: mm('0.0000'),
        sign: -1,
      }),
    ],
    target: { minQ: mm('0.1000'), maxQ: mm('0.3000') },
    assumptions: '案例 A：不满足目标的轴向间隙',
  })

  const caseB: ChainDefinition = makeChain({
    terms: [
      makeTerm({
        id: 'H',
        symbol: 'H',
        name: '机架',
        nominalQ: mm('100.0000'),
        lowerDeviationQ: mm('0.0000'),
        upperDeviationQ: mm('0.0300'),
        sign: 1,
      }),
      makeTerm({
        id: 'B1',
        symbol: 'B1',
        name: '轴承 1',
        nominalQ: mm('20.0000'),
        lowerDeviationQ: mm('-0.0200'),
        upperDeviationQ: mm('0.0000'),
        sign: -1,
      }),
      makeTerm({
        id: 'S',
        symbol: 'S',
        name: '隔套',
        nominalQ: mm('59.8000'),
        lowerDeviationQ: mm('-0.0200'),
        upperDeviationQ: mm('0.0200'),
        sign: -1,
      }),
      makeTerm({
        id: 'B2',
        symbol: 'B2',
        name: '轴承 2',
        nominalQ: mm('20.0000'),
        lowerDeviationQ: mm('-0.0200'),
        upperDeviationQ: mm('0.0000'),
        sign: -1,
      }),
    ],
    target: { minQ: mm('0.1000'), maxQ: mm('0.3000') },
    assumptions: '案例 B：修改后的满足方案',
  })

  const caseC: ChainDefinition = makeChain({
    terms: [
      makeTerm({
        id: 'P',
        symbol: 'P',
        name: '正项',
        nominalQ: mm('10.0000'),
        lowerDeviationQ: mm('-0.1000'),
        upperDeviationQ: 0,
        sign: 1,
      }),
      makeTerm({
        id: 'Q',
        symbol: 'Q',
        name: '负项',
        nominalQ: mm('10.0500'),
        lowerDeviationQ: 0,
        upperDeviationQ: mm('0.0500'),
        sign: -1,
      }),
    ],
    target: { minQ: mm('-0.2000'), maxQ: mm('-0.0500') },
    assumptions: '案例 C：负间隙和边界',
  })

  it('案例 A 通过校验且数值保持为 q', () => {
    const value = expectValid(caseA)
    expect(value).toEqual(caseA)
    expect(value.terms.map((term) => term.nominalQ)).toEqual([
      mm('100.0000'),
      mm('20.0000'),
      mm('59.8000'),
      mm('20.0000'),
    ])
  })

  it('案例 B 通过校验', () => {
    expect(expectValid(caseB)).toEqual(caseB)
  })

  it('案例 C 通过校验（负数目标区间）', () => {
    expect(expectValid(caseC)).toEqual(caseC)
  })
})
