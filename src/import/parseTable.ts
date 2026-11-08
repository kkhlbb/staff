import { parse as parseCsv, type ParseResult } from 'papaparse'

/** 单次导入原文上限：1 MB（UTF-8 字节）。 */
export const MAX_IMPORT_BYTES = 1024 * 1024
/** 单次解析后最多 200 行（含被忽略的完全空白行，不含文件末尾换行产生的空行）。 */
export const MAX_IMPORT_ROWS = 200
/** 最终提交的组成环上限与领域校验保持一致。 */
export const MAX_IMPORT_TERMS = 20

export type TableDelimiter = ',' | '\t'

export interface TableRow {
  /** 数据在原文中的行号（从 1 开始，只用于定位）。 */
  rowNumber: number
  cells: string[]
}

export interface RawTable {
  /** 已去掉完全空白行，保留原始行号。 */
  rows: TableRow[]
  columnCount: number
  delimiter: TableDelimiter
  /** 被忽略的完全空白行数（不含文件末尾换行产生的空行）。 */
  blankRows: number
}

export type ParseTableResult =
  | { ok: true; table: RawTable }
  | { ok: false; error: { code: string; message: string } }

function parseFailure(code: string, message: string): ParseTableResult {
  return { ok: false, error: { code, message } }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function isBlankRow(cells: string[]): boolean {
  return cells.every((cell) => cell.trim() === '')
}

/**
 * 用未加引号的第一个换行之前的行判断分隔符。
 *
 * 只统计引号外的制表符和逗号，因此 `"备注,含逗号"` 不会被误判为 CSV。
 * 同时出现时制表符优先：从 Excel 复制的数据通常是 TSV，单元格里可能带逗号。
 */
export function detectDelimiter(text: string): TableDelimiter | null {
  let quoted = false
  let tabs = 0
  let commas = 0

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (quoted) {
      continue
    }
    if (char === '\n' || char === '\r') {
      break
    }
    if (char === '\t') {
      tabs += 1
    } else if (char === ',') {
      commas += 1
    }
  }

  if (tabs === 0 && commas === 0) {
    return null
  }
  return tabs >= commas ? '\t' : ','
}

/**
 * 解析粘贴文本或 UTF-8 文件内容。
 *
 * 使用 Papa Parse 处理 RFC 4180 风格的引号、转义引号和引号内换行；
 * dynamicTyping 关闭，所有单元格保持原文，数值转换只由领域层的 tryParseMm 完成。
 */
export function parseTableText(input: string): ParseTableResult {
  // 规范是「原文 ≤ 1 MB」，因此按未去 BOM 的原始输入计算字节数；BOM 也算原文的一部分。
  const byteLength = new TextEncoder().encode(input).byteLength
  if (byteLength > MAX_IMPORT_BYTES) {
    return parseFailure(
      'file_too_large',
      `表格原文不能超过 1 MB，当前为 ${byteLength} 字节`,
    )
  }
  const text = stripBom(input)
  if (text.trim() === '') {
    return parseFailure('empty_input', '请粘贴表格文本或选择 CSV/TSV 文件')
  }

  const delimiter = detectDelimiter(text)
  if (delimiter === null) {
    return parseFailure(
      'missing_delimiter',
      '没有识别到列分隔符。请粘贴 Excel 制表符文本，或包含逗号的 CSV。',
    )
  }

  let parsed: ParseResult<string[]>
  try {
    parsed = parseCsv<string[]>(text, {
      delimiter,
      header: false,
      skipEmptyLines: false,
      dynamicTyping: false,
      quoteChar: '"',
      escapeChar: '"',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return parseFailure('parse_failed', `表格解析失败：${message}`)
  }

  if (parsed.errors.length > 0) {
    const first = parsed.errors[0]
    return parseFailure(
      'parse_failed',
      `表格格式有误：${first.message}${first.row === undefined ? '' : `（第 ${first.row + 1} 行）`}`,
    )
  }

  // Papaparse 会为末尾换行额外生成一个空行；它不是用户输入的空白行。
  // 但如果文件末尾有多余空行（例如连续两个换行），除这一个合成行外仍计入 blankRows。
  const parsedRows = parsed.data.map((cells, index) => ({
    rowNumber: index + 1,
    cells,
  }))
  if (
    /(?:\r\n|\n|\r)$/.test(text) &&
    parsedRows.length > 0 &&
    isBlankRow(parsedRows[parsedRows.length - 1].cells)
  ) {
    parsedRows.pop()
  }

  if (parsedRows.length > MAX_IMPORT_ROWS) {
    return parseFailure(
      'too_many_rows',
      `最多解析 ${MAX_IMPORT_ROWS} 行，当前为 ${parsedRows.length} 行`,
    )
  }
  if (parsedRows.length === 0) {
    return parseFailure('empty_input', '表格没有有效内容')
  }

  let blankRows = 0
  const rows: TableRow[] = []
  for (const row of parsedRows) {
    if (isBlankRow(row.cells)) {
      blankRows += 1
      continue
    }
    rows.push(row)
  }

  if (rows.length === 0) {
    return parseFailure('empty_input', '表格只有空白行，没有可导入的数据')
  }

  const columnCount = rows.reduce((max, row) => Math.max(max, row.cells.length), 0)
  if (columnCount < 2) {
    return parseFailure(
      'missing_columns',
      '只识别到 1 列。尺寸表至少需要代号、基本尺寸、下偏差、上偏差和方向等多列。',
    )
  }

  return {
    ok: true,
    table: {
      rows,
      columnCount,
      delimiter,
      blankRows,
    },
  }
}

/** 有表头时返回表头行，否则返回 null。 */
export function headerRow(table: RawTable, hasHeader: boolean): TableRow | null {
  return hasHeader ? (table.rows[0] ?? null) : null
}

/** 有表头时去掉表头，返回真正的数据行。 */
export function dataRows(table: RawTable, hasHeader: boolean): TableRow[] {
  return hasHeader ? table.rows.slice(1) : table.rows.slice()
}

/** 列显示名：有表头用表头文本，无表头用“第 N 列”。 */
export function columnLabel(
  table: RawTable,
  hasHeader: boolean,
  columnIndex: number,
): string {
  const header = headerRow(table, hasHeader)
  const name = header?.cells[columnIndex]?.trim() ?? ''
  return name === '' ? `第 ${columnIndex + 1} 列` : `${name}（第 ${columnIndex + 1} 列）`
}

/** 所有列的显示名，供映射下拉框使用。 */
export function columnLabels(table: RawTable, hasHeader: boolean): string[] {
  return Array.from({ length: table.columnCount }, (_, index) =>
    columnLabel(table, hasHeader, index),
  )
}
