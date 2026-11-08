// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { deleteProjectDatabase } from '../test/projectDb'
import { suggestMapping } from './mapColumns'
import { parseTableText } from './parseTable'
import {
  applyMappingTemplate,
  deleteMappingTemplate,
  listMappingTemplates,
  saveMappingTemplate,
} from './templates'

beforeEach(async () => {
  await deleteProjectDatabase()
})

function tableOf(text: string) {
  const parsed = parseTableText(text)
  if (!parsed.ok) {
    throw new Error(parsed.error.message)
  }
  return parsed.table
}

const HEADER = '代号\t名称\t基本尺寸\t下偏差\t上偏差\t方向\t来源备注'
const DATA = ['H\t机架\t100.0000\t0.0000\t0.1000\t+1\t图纸 A'].join('\n')

function sourceTable() {
  return tableOf(`${HEADER}\n${DATA}`)
}

describe('映射模板：保存与结构检查', () => {
  it('只保存列结构、映射与常量，不保存任何数据行', async () => {
    const table = sourceTable()
    const mapping = suggestMapping(table, true)
    const saved = await saveMappingTemplate({
      name: ' 尺寸表模板 ',
      table,
      mapping,
    })

    expect(saved.ok).toBe(true)
    if (!saved.ok) {
      return
    }
    expect(saved.value.name).toBe('尺寸表模板')
    expect(saved.value.hasHeader).toBe(true)
    expect(saved.value.unit).toBe('mm')
    expect(saved.value.headerSignature).toEqual([
      '代号',
      '名称',
      '基本尺寸',
      '下偏差',
      '上偏差',
      '方向',
      '来源备注',
    ])
    expect(saved.value.columnCount).toBe(7)
    expect('rows' in saved.value).toBe(false)
    expect('dataRows' in saved.value).toBe(false)
    expect(JSON.stringify(saved.value)).not.toContain('100.0000')
    expect(JSON.stringify(saved.value)).not.toContain('图纸 A')
  })

  it('结构完全一致时可以套用模板', async () => {
    const table = sourceTable()
    const mapping = suggestMapping(table, true)
    const saved = await saveMappingTemplate({ name: '模板一', table, mapping })
    if (!saved.ok) {
      throw new Error(saved.error.message)
    }

    const applied = applyMappingTemplate(sourceTable(), saved.value)
    expect(applied.ok).toBe(true)
    if (applied.ok) {
      expect(applied.mapping.symbolColumn).toBe(0)
      expect(applied.mapping.lowerColumn).toBe(3)
      expect(applied.mapping.signColumn).toBe(5)
    }

    const listed = await listMappingTemplates()
    expect(listed.ok).toBe(true)
    if (listed.ok) {
      expect(listed.value).toHaveLength(1)
      expect(listed.value[0].name).toBe('模板一')
    }
  })

  it('列顺序变化后模板不匹配，并清空映射要求重映射', async () => {
    const table = sourceTable()
    const mapping = suggestMapping(table, true)
    const saved = await saveMappingTemplate({ name: '模板二', table, mapping })
    if (!saved.ok) {
      throw new Error(saved.error.message)
    }

    const reordered = tableOf(
      [
        '基本尺寸\t代号\t名称\t下偏差\t上偏差\t方向\t来源备注',
        '100.0000\tH\t机架\t0.0000\t0.1000\t+1\t图纸 A',
      ].join('\n'),
    )
    const applied = applyMappingTemplate(reordered, saved.value)
    expect(applied.ok).toBe(false)
    if (!applied.ok) {
      expect(applied.reason).toContain('表头不一致')
      expect(applied.mapping.symbolColumn).toBeNull()
      expect(applied.mapping.nominalColumn).toBeNull()
    }
  })

  it('缺列或多列都要求重新映射', async () => {
    const table = sourceTable()
    const mapping = suggestMapping(table, true)
    const saved = await saveMappingTemplate({ name: '模板三', table, mapping })
    if (!saved.ok) {
      throw new Error(saved.error.message)
    }

    const missing = tableOf('代号\t名称\t基本尺寸\t下偏差\t上偏差\t方向\nH\t机架\t100\t0\t0.1\t+1')
    const missingApplied = applyMappingTemplate(missing, saved.value)
    expect(missingApplied.ok).toBe(false)

    const extra = tableOf(
      '代号\t名称\t基本尺寸\t下偏差\t上偏差\t方向\t来源备注\t备注2\nH\t机架\t100\t0\t0.1\t+1\tA\tB',
    )
    const extraApplied = applyMappingTemplate(extra, saved.value)
    expect(extraApplied.ok).toBe(false)
  })

  it('无表头模板按列数检查，列数变化后要求重映射', async () => {
    const table = tableOf('H\t100\t0\t0.1\t+1\nB1\t20\t0\t0\t-1')
    const mapping = {
      ...suggestMapping(table, false),
      symbolColumn: 0,
      nominalColumn: 1,
      lowerColumn: 2,
      upperColumn: 3,
      signColumn: 4,
      directionValues: { '+1': 1 as const, '-1': -1 as const },
    }
    const saved = await saveMappingTemplate({ name: '无表头模板', table, mapping })
    if (!saved.ok) {
      throw new Error(saved.error.message)
    }

    expect(applyMappingTemplate(table, saved.value).ok).toBe(true)
    const changed = tableOf('H\t100\t0\t0.1\t+1\t附注\nB1\t20\t0\t0\t-1\t附注')
    const applied = applyMappingTemplate(changed, saved.value)
    expect(applied.ok).toBe(false)
    if (!applied.ok) {
      expect(applied.reason).toContain('列数不一致')
    }
  })

  it('拒绝空模板名，并能删除模板', async () => {
    const table = sourceTable()
    const invalid = await saveMappingTemplate({
      name: '  ',
      table,
      mapping: suggestMapping(table, true),
    })
    expect(invalid.ok).toBe(false)

    const saved = await saveMappingTemplate({
      name: '可删除模板',
      table,
      mapping: suggestMapping(table, true),
    })
    if (!saved.ok) {
      throw new Error(saved.error.message)
    }
    const deleted = await deleteMappingTemplate(saved.value.id)
    expect(deleted.ok).toBe(true)
    const listed = await listMappingTemplates()
    expect(listed.ok).toBe(true)
    if (listed.ok) {
      expect(listed.value).toHaveLength(0)
    }
  })
})
