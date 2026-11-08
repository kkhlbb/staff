import { describe, expect, it } from 'vitest'
import {
  candidateDirectionValue,
  directionTokens,
  emptyMapping,
  findLimitColumns,
  suggestMapping,
  validateMapping,
  type ColumnMapping,
} from './mapColumns'
import { parseTableText } from './parseTable'

function tableOf(text: string) {
  const parsed = parseTableText(text)
  if (!parsed.ok) {
    throw new Error(parsed.error.message)
  }
  return parsed.table
}

const CAL_HEADER =
  '代号\t名称\t基本尺寸\t下偏差\t上偏差\t方向\t来源备注'

function calTable() {
  return tableOf(
    [
      CAL_HEADER,
      'H\t机架\t100.0000\t0.0000\t0.1000\t+1\t图纸 A',
      'B1\t轴承1\t20.0000\t-0.0200\t0.0000\t-1\t图纸 B',
    ].join('\n'),
  )
}

describe('suggestMapping：自动候选', () => {
  it('只对唯一、完全匹配的表头给出候选，并保留来源备注', () => {
    const table = calTable()
    const mapping = suggestMapping(table, true)

    expect(mapping.symbolColumn).toBe(0)
    expect(mapping.nameMode).toBe('column')
    expect(mapping.nameColumn).toBe(1)
    expect(mapping.nominalColumn).toBe(2)
    expect(mapping.lowerColumn).toBe(3)
    expect(mapping.upperColumn).toBe(4)
    expect(mapping.signColumn).toBe(5)
    expect(mapping.sourceNoteColumn).toBe(6)
  })

  it('不把“下极限尺寸”自动映射到下偏差', () => {
    const table = tableOf(
      [
        '代号,基本尺寸,下极限尺寸,上偏差,方向',
        'H,100.0000,99.9000,0.1000,+1',
      ].join('\n'),
    )
    const mapping = suggestMapping(table, true)

    expect(mapping.lowerColumn).toBeNull()
    expect(findLimitColumns(table, true)).toEqual(['下极限尺寸'])
  })

  it('重名列不自动猜测', () => {
    const table = tableOf('代号,基本尺寸,基本尺寸,下偏差,上偏差,方向\nH,1,2,0,0,+1')
    const mapping = suggestMapping(table, true)
    expect(mapping.nominalColumn).toBeNull()
  })

  it('必填字段因多个同义表头无法自动确定时报告表头歧义', () => {
    const table = tableOf('代号,基本尺寸,基本尺寸,下偏差,上偏差,方向\nH,1,2,0,0,+1')
    const mapping = suggestMapping(table, true)

    const nominalIssues = validateMapping(table, mapping).filter(
      (issue) => issue.field === 'nominal',
    )
    expect(nominalIssues).toHaveLength(1)
    expect(nominalIssues[0].message).toContain('表头歧义')
    expect(nominalIssues[0].message).toContain('基本尺寸')
    expect(nominalIssues[0].message).toContain('出现 2 次')
    expect(nominalIssues[0].message).not.toContain('必须映射')

    // 用户手动选定其中一列后，歧义已被解决，不再报该错误。
    const resolved = validateMapping(table, { ...mapping, nominalColumn: 1 })
    expect(
      resolved.some(
        (issue) => issue.field === 'nominal' && issue.message.includes('表头歧义'),
      ),
    ).toBe(false)
  })

  it('同一字段命中多个不同同义表头时也报告表头歧义', () => {
    const table = tableOf(
      '代号,基本尺寸,公称尺寸,下偏差,上偏差,方向\nH,1,2,0,0,+1',
    )
    const mapping = suggestMapping(table, true)
    expect(mapping.nominalColumn).toBeNull()

    const nominalIssue = validateMapping(table, mapping).find(
      (issue) => issue.field === 'nominal',
    )
    expect(nominalIssue?.message).toContain('表头歧义')
    expect(nominalIssue?.message).toContain('基本尺寸')
    expect(nominalIssue?.message).toContain('公称尺寸')
    expect(nominalIssue?.message).toContain('出现 2 次')
  })

  it('无表头时不做位置猜测，由用户逐列选择', () => {
    const table = tableOf('H\t100.0000\t0.0000\t0.1000\t+1')
    const mapping = suggestMapping(table, false)
    expect(mapping.symbolColumn).toBeNull()
    expect(mapping.nominalColumn).toBeNull()
  })
})

describe('validateMapping：必填、重复列与常量 0', () => {
  it('必填列缺失时逐项报告', () => {
    const table = calTable()
    const issues = validateMapping(table, emptyMapping(true))
    expect(issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(['symbol', 'nominal', 'lower', 'upper', 'sign']),
    )
  })

  it('同一列不能映射到两个字段', () => {
    const table = calTable()
    const mapping: ColumnMapping = {
      ...suggestMapping(table, true),
      nominalColumn: 0,
    }
    const issues = validateMapping(table, mapping)
    expect(issues.some((issue) => issue.message.includes('同一列'))).toBe(true)
  })

  it('显式选择常量 0 后不再要求偏差列', () => {
    const table = tableOf('H\t100.0000\t+1\nB1\t20.0000\t-1')
    const mapping: ColumnMapping = {
      ...emptyMapping(false),
      symbolColumn: 0,
      nominalColumn: 1,
      signColumn: 2,
      lowerConstantZero: true,
      upperConstantZero: true,
    }
    expect(validateMapping(table, mapping)).toEqual([])
  })

  it('名称来自某列但未选列时报告错误', () => {
    const table = calTable()
    const mapping: ColumnMapping = {
      ...suggestMapping(table, true),
      nameMode: 'column',
      nameColumn: null,
    }
    expect(validateMapping(table, mapping).some((issue) => issue.field === 'name')).toBe(
      true,
    )
  })

  it('有表头但没有数据行时要求重新选择表头', () => {
    const table = tableOf('代号,基本尺寸,下偏差,上偏差,方向')
    const issues = validateMapping(table, emptyMapping(true))
    expect(issues.some((issue) => issue.message.includes('没有数据行'))).toBe(true)
  })
})

describe('directionTokens：方向含义', () => {
  it('返回 distinct 值，并只给出显式 +1/-1 候选', () => {
    const table = calTable()
    const mapping = suggestMapping(table, true)
    expect(directionTokens(table, mapping)).toEqual(['+1', '-1'])
    expect(candidateDirectionValue('+1')).toBe(1)
    expect(candidateDirectionValue('−1')).toBe(-1)
    expect(candidateDirectionValue('正环')).toBe(1)
    expect(candidateDirectionValue('未知方向')).toBeNull()
  })
})
