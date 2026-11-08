import { describe, expect, it } from 'vitest'
import {
  candidateDirectionValue,
  directionTokens,
  suggestMapping,
  type ColumnMapping,
} from './mapColumns'
import { MAX_IMPORT_TERMS, parseTableText } from './parseTable'
import { importCellKey, validateImport } from './validateImport'

function tableOf(text: string) {
  const parsed = parseTableText(text)
  if (!parsed.ok) {
    throw new Error(parsed.error.message)
  }
  return parsed.table
}

function mappingFor(table: ReturnType<typeof tableOf>, hasHeader = true): ColumnMapping {
  const mapping = suggestMapping(table, hasHeader)
  const directionValues: ColumnMapping['directionValues'] = {}
  for (const token of directionTokens(table, mapping)) {
    const candidate = candidateDirectionValue(token)
    if (candidate !== null) {
      directionValues[token] = candidate
    }
  }
  return { ...mapping, directionValues }
}

const CAL_TSV = [
  '代号\t名称\t基本尺寸\t下偏差\t上偏差\t方向\t来源备注',
  'H\t机架\t100.0000\t0.0000\t0.1000\t+1\t图纸 A',
  'B1\t轴承 1\t20.0000\t-0.0200\t0.0000\t-1\t图纸 B',
  'S\t隔套\t59.8000\t-0.0500\t0.0500\t-1\t图纸 C',
  'B2\t轴承 2\t20.0000\t-0.0200\t0.0000\t-1\t图纸 D',
].join('\n')

describe('validateImport：CAL-01 四行', () => {
  it('四行全部有效，字段与原文一致', () => {
    const table = tableOf(CAL_TSV)
    const result = validateImport(table, mappingFor(table))

    expect(result.rows).toHaveLength(4)
    expect(result.validTerms).toHaveLength(4)
    expect(result.cellErrors).toEqual({})
    expect(result.globalErrors).toEqual([])
    expect(result.validTerms[0]).toMatchObject({
      symbol: 'H',
      name: '机架',
      nominal: '100.0000',
      lower: '0.0000',
      upper: '0.1000',
      sign: 1,
      sourceNote: '图纸 A',
    })
    expect(result.validTerms[3]).toMatchObject({
      symbol: 'B2',
      sign: -1,
    })
  })
})

describe('validateImport：组成环上限', () => {
  function termsTsv(count: number): string {
    const lines = ['代号\t基本尺寸\t下偏差\t上偏差\t方向']
    for (let index = 0; index < count; index += 1) {
      lines.push(`S${index}\t100.0000\t0.0000\t0.1000\t+1`)
    }
    return lines.join('\n')
  }

  it(`恰好 ${MAX_IMPORT_TERMS} 行时不产生超过组成环上限的全局错误`, () => {
    const table = tableOf(termsTsv(MAX_IMPORT_TERMS))
    const result = validateImport(table, mappingFor(table))

    expect(result.rows).toHaveLength(MAX_IMPORT_TERMS)
    expect(result.globalErrors.some((message) => message.includes('组成环最多'))).toBe(
      false,
    )
  })

  it(`${MAX_IMPORT_TERMS + 1} 行时超过 ${MAX_IMPORT_TERMS} 项组成环上限并产生全局错误`, () => {
    const table = tableOf(termsTsv(MAX_IMPORT_TERMS + 1))
    const result = validateImport(table, mappingFor(table))

    expect(result.rows).toHaveLength(MAX_IMPORT_TERMS + 1)
    expect(result.globalErrors).toContain(
      `组成环最多 ${MAX_IMPORT_TERMS} 项，当前为 ${MAX_IMPORT_TERMS + 1} 项`,
    )
  })
})

describe('validateImport：CSV 引号、逗号与空白行', () => {
  it('备注中的引号和逗号不串列，空白行计入忽略数', () => {
    const table = tableOf(
      [
        '代号,名称,基本尺寸,下偏差,上偏差,方向,来源备注',
        'H,机架,100.0000,0.0000,0.1000,+1,"含""引号""和,逗号"',
        '',
        'B1,轴承,20.0000,-0.0200,0.0000,-1,"第一行',
        '第二行"',
      ].join('\n'),
    )
    const result = validateImport(table, mappingFor(table))

    expect(result.ignoredBlankRows).toBe(1)
    expect(result.validTerms).toHaveLength(2)
    expect(result.validTerms[0].sourceNote).toBe('含"引号"和,逗号')
    expect(result.validTerms[1].sourceNote).toContain('第二行')
  })
})

describe('validateImport：错误必须定位到具体单元格', () => {
  it('缺方向、重复代号、非法偏差、超过 4 位小数都不能提交', () => {
    const table = tableOf(
      [
        '代号\t基本尺寸\t下偏差\t上偏差\t方向',
        'H\t100.0000\t0.0000\t0.1000\t+1',
        'H\t20.0000\t0.0000\t0.0000\t-1',
        'B1\t20.0000\tabc\t0.0000\t-1',
        'B2\t20.0000\t0.0000\t0.12345\t-1',
        'S\t59.8000\t-0.0500\t0.0500\t',
      ].join('\n'),
    )
    const result = validateImport(table, mappingFor(table))

    // 第 1 行是表头；数据从第 2 行开始。
    expect(result.cellErrors[importCellKey(3, 'symbol')]).toContain('与第 2 行重复')
    expect(result.cellErrors[importCellKey(4, 'lower')]).toContain('格式不正确')
    expect(result.cellErrors[importCellKey(5, 'upper')]).toContain('最多 4 位小数')
    expect(result.cellErrors[importCellKey(6, 'sign')]).toContain('方向不能为空')

    expect(result.validTerms.map((term) => term.symbol)).toEqual(['H'])
    expect(result.rows.filter((row) => row.term !== null)).toHaveLength(1)
  })

  it('方向值未显式映射时不得默认按正环处理', () => {
    const table = tableOf(
      ['代号\t基本尺寸\t下偏差\t上偏差\t方向', 'H\t100\t0\t0.1\t外环'].join('\n'),
    )
    const mapping = { ...mappingFor(table), directionValues: {} }
    const result = validateImport(table, mapping)
    expect(result.cellErrors[importCellKey(2, 'sign')]).toContain('尚未映射')
  })

  it('偏差缺失不默认 0，空单元格按字段报错', () => {
    const table = tableOf(
      ['代号\t基本尺寸\t下偏差\t上偏差\t方向', 'H\t100\t\t0.1\t+1'].join('\n'),
    )
    const result = validateImport(table, mappingFor(table))
    expect(result.cellErrors[importCellKey(2, 'lower')]).toContain('不能为空')
    expect(result.rows[0].parsed.lower).toBeUndefined()
  })

  it('对称公差、逗号小数、千分位和公式文本都不自动转换', () => {
    const table = tableOf(
      [
        '代号\t基本尺寸\t下偏差\t上偏差\t方向',
        'H\t100\t±0.1\t±0.1\t+1',
        'B1\t1,000.0000\t0\t0.1\t-1',
        'B2\t20\t0\t=1+2\t-1',
      ].join('\n'),
    )
    const result = validateImport(table, mappingFor(table))
    expect(result.cellErrors[importCellKey(2, 'lower')]).toContain('格式不正确')
    expect(result.cellErrors[importCellKey(3, 'nominal')]).toContain('格式不正确')
    expect(result.cellErrors[importCellKey(4, 'upper')]).toContain('格式不正确')
  })

  it('数值前后空白不静默 trim', () => {
    const table = tableOf(
      ['代号\t基本尺寸\t下偏差\t上偏差\t方向', 'H\t 100.0000\t0\t0.1\t+1'].join('\n'),
    )
    const result = validateImport(table, mappingFor(table))
    expect(result.cellErrors[importCellKey(2, 'nominal')]).toContain('不会自动改写')
  })

  it('代号 trim 并展示转换记录', () => {
    const table = tableOf(
      ['代号\t基本尺寸\t下偏差\t上偏差\t方向', '  H  \t100\t0\t0.1\t+1'].join('\n'),
    )
    const result = validateImport(table, mappingFor(table))
    expect(result.validTerms[0].symbol).toBe('H')
    expect(result.rows[0].warnings.join('')).toContain('代号已去除前后空白')
  })

  it('部分空白行按字段报错，完全空白行忽略并计数', () => {
    const table = tableOf(
      [
        '代号\t基本尺寸\t下偏差\t上偏差\t方向',
        'H\t100\t0\t0.1\t+1',
        '',
        'B1\t20\t0\t\t-1',
      ].join('\n'),
    )
    const result = validateImport(table, mappingFor(table))
    expect(result.ignoredBlankRows).toBe(1)
    expect(result.cellErrors[importCellKey(4, 'upper')]).toContain('不能为空')
  })

  it('名称列空白时报错，并提示可统一用代号', () => {
    const table = tableOf(
      [
        '代号\t名称\t基本尺寸\t下偏差\t上偏差\t方向',
        'H\t\t100\t0\t0.1\t+1',
      ].join('\n'),
    )
    const result = validateImport(table, mappingFor(table))
    expect(result.cellErrors[importCellKey(2, 'name')]).toContain('统一用代号')
  })
})

describe('validateImport：方向以用户确认映射为准', () => {
  it("原文方向为 '1' 但确认映射为 -1 时必须按 -1 导入", () => {
    const table = tableOf(
      ['代号\t基本尺寸\t下偏差\t上偏差\t方向', 'L\t10.0000\t0.0000\t0.1000\t1'].join(
        '\n',
      ),
    )
    const mapping: ColumnMapping = {
      ...mappingFor(table),
      directionValues: { '1': -1 },
    }
    const result = validateImport(table, mapping)

    expect(result.cellErrors).toEqual({})
    expect(result.validTerms).toHaveLength(1)
    expect(result.validTerms[0].sign).toBe(-1)
    expect(result.rows[0].values.sign).toBe('-1')
  })

  it('预览中的用户编辑值可以直接覆盖已确认映射', () => {
    const table = tableOf(
      ['代号\t基本尺寸\t下偏差\t上偏差\t方向', 'L\t10.0000\t0.0000\t0.1000\t1'].join(
        '\n',
      ),
    )
    const mapping: ColumnMapping = {
      ...mappingFor(table),
      directionValues: { '1': -1 },
    }
    const result = validateImport(table, mapping, {
      [importCellKey(2, 'sign')]: '1',
    })

    expect(result.cellErrors).toEqual({})
    expect(result.validTerms[0].sign).toBe(1)
    expect(result.rows[0].values.sign).toBe('1')
  })
})

describe('validateImport：单行导入与原文行号定位', () => {
  it('单行数据不再被“至少 2 行”的全局错误拦住', () => {
    const table = tableOf(
      ['代号\t基本尺寸\t下偏差\t上偏差\t方向', 'L\t10.0000\t0.0000\t0.1000\t+1'].join(
        '\n',
      ),
    )
    const result = validateImport(table, mappingFor(table))

    expect(result.rows).toHaveLength(1)
    expect(result.validTerms).toHaveLength(1)
    expect(result.globalErrors).toEqual([])
  })

  it('多行来源备注之后的非法数值定位到原文物理行号', () => {
    const table = tableOf(
      [
        '代号,名称,基本尺寸,下偏差,上偏差,方向,来源备注',
        'H,机架,100.0000,0.0000,0.1000,+1,"第一行',
        '第二行"',
        'B1,轴承,20.0000,abc,0.0000,-1,备注',
      ].join('\n'),
    )
    const result = validateImport(table, mappingFor(table))

    // 第 2 条记录跨原文第 2–3 行，因此下一条记录从第 4 行开始。
    expect(result.cellErrors[importCellKey(4, 'lower')]).toContain('格式不正确')
    expect(result.cellErrors[importCellKey(3, 'lower')]).toBeUndefined()
  })
})

describe('validateImport：显式常量与极限尺寸提示', () => {
  it('仅在用户显式选择后用常量 0 补齐缺失偏差', () => {
    const table = tableOf(
      ['代号\t基本尺寸\t方向', 'H\t100\t+1', 'B1\t20\t-1'].join('\n'),
    )
    const mapping: ColumnMapping = {
      ...mappingFor(table, false),
      symbolColumn: 0,
      nominalColumn: 1,
      signColumn: 2,
      lowerColumn: null,
      upperColumn: null,
      lowerConstantZero: true,
      upperConstantZero: true,
      directionValues: { '+1': 1, '-1': -1 },
    }
    const result = validateImport(table, mapping)
    expect(result.validTerms).toHaveLength(2)
    expect(result.validTerms[0].lower).toBe('0.0000')
    expect(result.validTerms[0].upper).toBe('0.0000')
  })

  it('检测到极限尺寸列时给出提示，但不映射到偏差', () => {
    const table = tableOf(
      [
        '代号,基本尺寸,下偏差,上偏差,方向,下极限尺寸',
        'H,100.0000,0.0000,0.1000,+1,99.9000',
      ].join('\n'),
    )
    const mapping = mappingFor(table)
    const result = validateImport(table, mapping)
    expect(mapping.lowerColumn).toBe(2)
    expect(result.limitColumns).toEqual(['下极限尺寸'])
  })
})
