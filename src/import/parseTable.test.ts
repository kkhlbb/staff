import { describe, expect, it } from 'vitest'
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  detectDelimiter,
  parseTableText,
} from './parseTable'

function parseOk(text: string) {
  const result = parseTableText(text)
  if (!result.ok) {
    throw new Error(`expected parse ok, got ${result.error.code}: ${result.error.message}`)
  }
  return result.table
}

describe('parseTableText：CSV / TSV 解析', () => {
  it('正确处理引号、转义引号、逗号和引号内换行', () => {
    const csv = [
      '代号,名称,备注',
      'H,机架,"含""引号""和,逗号"',
      'B1,轴承,"第一行',
      '第二行"',
    ].join('\r\n')

    const table = parseOk(csv)

    expect(table.delimiter).toBe(',')
    expect(table.rows).toHaveLength(3)
    expect(table.rows[1].cells).toEqual(['H', '机架', '含"引号"和,逗号'])
    expect(table.rows[2].cells[2]).toBe('第一行\r\n第二行')
  })

  it('识别 Excel 制表符文本，并忽略完全空白行、统计其数量', () => {
    const tsv = [
      '代号\t基本尺寸\t备注',
      'H\t100.0000\t"含,逗号的备注"',
      '\t\t',
      'B1\t20.0000\t普通',
      '',
    ].join('\n')

    const table = parseOk(tsv)

    expect(table.delimiter).toBe('\t')
    expect(table.blankRows).toBe(1)
    expect(table.rows.map((row) => row.rowNumber)).toEqual([1, 2, 4])
    expect(table.rows[1].cells).toEqual(['H', '100.0000', '含,逗号的备注'])
  })

  it('去掉 UTF-8 BOM，且不把文件末尾换行计为空白行', () => {
    const table = parseOk('\ufeffa,b\r\n1,2\r\n')
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0].cells).toEqual(['a', 'b'])
    expect(table.blankRows).toBe(0)
  })

  it('文件末尾真正的空白行仍计入忽略数', () => {
    const table = parseOk('a,b\n1,2\n\n')
    expect(table.rows).toHaveLength(2)
    expect(table.blankRows).toBe(1)
  })

  it('只检测引号外的分隔符', () => {
    expect(detectDelimiter('"a,b"\tc\n1\t2')).toBe('\t')
    expect(detectDelimiter('"a\tb",c\n1,2')).toBe(',')
    expect(detectDelimiter('single-column\n1')).toBeNull()
  })

  it('拒绝超过 1 MB 的原文', () => {
    const result = parseTableText('a,b\n' + 'x'.repeat(MAX_IMPORT_BYTES))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('file_too_large')
    }
  })

  it('恰好 1 MB 通过，超过 1 字节拒绝', () => {
    // 200 行、2 列，用最后一行的单元格补齐到精确的 1 MB。
    const lines = ['a,b']
    for (let index = 0; index < MAX_IMPORT_ROWS - 2; index += 1) {
      lines.push('1,2')
    }
    const prefix = `${lines.join('\n')}\n1,`
    const text = prefix + 'x'.repeat(MAX_IMPORT_BYTES - prefix.length)

    expect(new TextEncoder().encode(text).byteLength).toBe(MAX_IMPORT_BYTES)
    expect(parseOk(text).rows).toHaveLength(MAX_IMPORT_ROWS)

    const result = parseTableText(`${text}x`)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('file_too_large')
    }
  })

  it('按原始输入计字节：带 BOM 时超出 3 字节也拒绝', () => {
    // 构造去 BOM 后恰好 1 MB、且能通过其他校验的内容。
    const lines = ['a,b']
    for (let index = 0; index < MAX_IMPORT_ROWS - 2; index += 1) {
      lines.push('1,2')
    }
    const prefix = `${lines.join('\n')}\n1,`
    const body = prefix + 'x'.repeat(MAX_IMPORT_BYTES - prefix.length)
    expect(new TextEncoder().encode(body).byteLength).toBe(MAX_IMPORT_BYTES)

    // 无 BOM 时恰好 1 MB 仍通过。
    expect(parseOk(body).rows).toHaveLength(MAX_IMPORT_ROWS)

    // 加上 UTF-8 BOM 后原始字节数为 MAX + 3，去 BOM 后仍恰为 MAX。
    const withBom = `\ufeff${body}`
    expect(new TextEncoder().encode(withBom).byteLength).toBe(MAX_IMPORT_BYTES + 3)

    const result = parseTableText(withBom)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('file_too_large')
      expect(result.error.message).toContain(`${MAX_IMPORT_BYTES + 3} 字节`)
    }
  })

  it(`恰好 ${MAX_IMPORT_ROWS} 行必须通过`, () => {
    const lines: string[] = []
    for (let index = 0; index < MAX_IMPORT_ROWS; index += 1) {
      lines.push(`${index},${index}`)
    }

    const table = parseOk(lines.join('\n'))
    expect(table.rows).toHaveLength(MAX_IMPORT_ROWS)
  })

  it(`拒绝 ${MAX_IMPORT_ROWS + 1} 行（超过 ${MAX_IMPORT_ROWS} 行上限）`, () => {
    const lines: string[] = []
    for (let index = 0; index < MAX_IMPORT_ROWS + 1; index += 1) {
      lines.push(`${index},${index}`)
    }

    const result = parseTableText(lines.join('\n'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('too_many_rows')
      expect(result.error.message).toContain(`${MAX_IMPORT_ROWS + 1} 行`)
    }
  })

  it('未闭合引号作为解析错误拒绝提交', () => {
    const result = parseTableText('a,b\n"未闭合,1\n')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('parse_failed')
      expect(result.error.message).toContain('unterminated')
    }
  })

  it('拒绝没有分隔符的输入', () => {
    const noDelimiter = parseTableText('单列文本\n1\n2')
    expect(noDelimiter.ok).toBe(false)
    if (!noDelimiter.ok) {
      expect(noDelimiter.error.code).toBe('missing_delimiter')
    }
  })

  it('完全空白的输入被拒绝', () => {
    const result = parseTableText('  \n\t\n')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('empty_input')
    }
  })
})
