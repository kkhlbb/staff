import { fc, test as propTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { MAX_ABS_Q } from './types'
import { formatMm, parseMm, tryParseMm, UnitParseError, type UnitErrorCode } from './units'

describe('parseMm：合法输入', () => {
  const cases: [string, number][] = [
    ['0', 0],
    ['0.0001', 1],
    ['100.0000', 1_000_000],
    ['59.8', 598_000],
    ['-0.02', -200],
    ['+0.05', 500],
    ['  20  ', 200_000],
    ['007.5', 75_000],
    ['1000000', 10_000_000_000],
    ['-1000000.0000', -10_000_000_000],
  ]
  it.each(cases)('%j → %d', (input, expected) => {
    expect(parseMm(input)).toBe(expected)
  })

  it.each(['-0', '-0.0000', '+0'])('%j 得到 +0 而不是 -0', (input) => {
    expect(Object.is(parseMm(input), 0)).toBe(true)
  })
})

describe('parseMm：非法输入', () => {
  const cases: [string, UnitErrorCode][] = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['1.', 'format'],
    ['.5', 'format'],
    ['1e3', 'format'],
    ['1,000', 'format'],
    ['abc', 'format'],
    ['1 000', 'format'],
    ['--1', 'format'],
    ['+-1', 'format'],
    ['NaN', 'format'],
    ['Infinity', 'format'],
    ['0x10', 'format'],
    ['0.00001', 'precision'],
    ['1.23456', 'precision'],
    ['1.00000', 'precision'],
    ['1000000.0001', 'range'],
    ['99999999', 'range'],
    ['-1000001', 'range'],
    ['123456789012345678901234567890', 'range'],
  ]
  it.each(cases)('%j → %s', (input, code) => {
    const result = tryParseMm(input)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(code)
      expect(result.message.length).toBeGreaterThan(0)
    }
    try {
      parseMm(input)
      expect.unreachable('parseMm 应该抛错')
    } catch (error) {
      expect(error).toBeInstanceOf(UnitParseError)
      expect((error as UnitParseError).code).toBe(code)
      expect((error as UnitParseError).input).toBe(input)
    }
  })

  it('超精度不截断：0.00009 不会被当成 0', () => {
    expect(tryParseMm('0.00009')).toMatchObject({ ok: false, code: 'precision' })
  })
})

describe('formatMm', () => {
  const cases: [number, string, string][] = [
    [0, '0.000', '+0.000'],
    [120500, '12.050', '+12.050'],
    [501, '0.0501', '+0.0501'],
    [-501, '-0.0501', '-0.0501'],
    [522000, '52.200', '+52.200'],
    [1, '0.0001', '+0.0001'],
    [-1, '-0.0001', '-0.0001'],
    [-500, '-0.050', '-0.050'],
    [1900, '0.190', '+0.190'],
    [1_000_000, '100.000', '+100.000'],
    [10_000_000_000, '1000000.000', '+1000000.000'],
    [-10_000_000_000, '-1000000.000', '-1000000.000'],
  ]
  it.each(cases)('%d → %j / %j', (value, plain, signed) => {
    expect(formatMm(value)).toBe(plain)
    expect(formatMm(value, { signed: true })).toBe(signed)
  })

  it.each([0.5, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY])('非安全整数 %d 抛 RangeError', (value) => {
    expect(() => formatMm(value)).toThrow(RangeError)
  })
})

describe('性质', () => {
  propTest.prop([fc.integer({ min: -MAX_ABS_Q, max: MAX_ABS_Q })])('formatMm 后再 parseMm 回到原值', (q) => {
    expect(parseMm(formatMm(q))).toBe(q)
    expect(parseMm(formatMm(q, { signed: true }))).toBe(q)
  })

  propTest.prop([
    fc.constantFrom('', '+', '-'),
    fc.integer({ min: 0, max: 999_999 }),
    fc.string({ unit: fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), maxLength: 4 }),
  ])('与 BigInt 独立计算的结果一致', (sign, intPart, frac) => {
    const input = frac === '' ? `${sign}${intPart}` : `${sign}${intPart}.${frac}`
    const magnitude = BigInt(intPart) * 10000n + BigInt(frac.padEnd(4, '0'))
    const expected = Number(sign === '-' ? -magnitude : magnitude)
    expect(parseMm(input)).toBe(expected === 0 ? 0 : expected)
  })
})

describe('浮点陷阱回归', () => {
  it('0.1 + 0.2 === 0.3（整数单位下）', () => {
    expect(parseMm('0.1') + parseMm('0.2')).toBe(parseMm('0.3'))
  })

  it('文档案例 A 中的数精确转换', () => {
    expect(parseMm('59.85')).toBe(598_500)
    expect(parseMm('19.98')).toBe(199_800)
    expect(parseMm('100.1')).toBe(1_001_000)
    expect(parseMm('-0.05')).toBe(-500)
  })
})
