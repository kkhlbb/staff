import {
  columnLabel,
  dataRows,
  headerRow,
  type RawTable,
  type TableRow,
} from './parseTable'

export type ImportField =
  | 'symbol'
  | 'nominal'
  | 'lower'
  | 'upper'
  | 'sign'
  | 'name'
  | 'sourceNote'

export type DirectionValue = 1 | -1
export type DirectionValueMap = Record<string, DirectionValue>

export interface ColumnMapping {
  hasHeader: boolean
  symbolColumn: number | null
  nominalColumn: number | null
  lowerColumn: number | null
  upperColumn: number | null
  signColumn: number | null
  nameMode: 'symbol' | 'column'
  nameColumn: number | null
  sourceNoteColumn: number | null
  /** 用户显式选择“该列使用常量 0”，不允许把缺失偏差默认成 0。 */
  lowerConstantZero: boolean
  upperConstantZero: boolean
  /** 方向单元格原文（trim 后）到 +1/-1 的显式映射。 */
  directionValues: DirectionValueMap
}

export interface MappingIssue {
  field: ImportField | 'columns'
  message: string
}

export const FIELD_LABELS: Record<ImportField, string> = {
  symbol: '代号',
  nominal: '基本尺寸',
  lower: '下偏差',
  upper: '上偏差',
  sign: '方向',
  name: '名称',
  sourceNote: '来源备注',
}

const FIELD_ALIASES: Record<ImportField, string[]> = {
  symbol: ['代号', '符号', '编号', '图号', 'symbol', 'code', 'ref', 'reference'],
  nominal: [
    '基本尺寸',
    '公称尺寸',
    '名义尺寸',
    '基本尺寸mm',
    '尺寸',
    'nominal',
    'size',
    'nominal size',
  ],
  lower: ['下偏差', '下偏', 'ei', 'lower', 'lower deviation', 'lower dev'],
  upper: ['上偏差', '上偏', 'es', 'upper', 'upper deviation', 'upper dev'],
  sign: ['方向', '环向', '增减性', 'sign', 'direction'],
  name: ['名称', '零件名称', '零件', '说明', 'name', 'description'],
  sourceNote: ['来源备注', '来源', '备注', 'note', 'source', 'remark', 'comment'],
}

const LIMIT_COLUMN_PATTERN = /极限尺寸|最大尺寸|最小尺寸|上限尺寸|下限尺寸/

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_\-（）()[\]{}]/g, '')
    .replace(/(?:mm|毫米)$/i, '')
}

export function emptyMapping(hasHeader: boolean): ColumnMapping {
  return {
    hasHeader,
    symbolColumn: null,
    nominalColumn: null,
    lowerColumn: null,
    upperColumn: null,
    signColumn: null,
    nameMode: 'symbol',
    nameColumn: null,
    sourceNoteColumn: null,
    lowerConstantZero: false,
    upperConstantZero: false,
    directionValues: {},
  }
}

/** 检测像“下极限尺寸”的列，仅用于提示，绝不自动映射到偏差。 */
export function findLimitColumns(table: RawTable, hasHeader: boolean): string[] {
  if (!hasHeader) {
    return []
  }
  const header = headerRow(table, true)
  if (header === null) {
    return []
  }
  const labels: string[] = []
  for (let index = 0; index < header.cells.length; index += 1) {
    const name = header.cells[index]?.trim() ?? ''
    if (name !== '' && LIMIT_COLUMN_PATTERN.test(name)) {
      labels.push(name)
    }
  }
  return labels
}

/**
 * 根据表头给出自动映射候选。
 *
 * 只有唯一且完全匹配的别名才自动选中；含“极限尺寸”的列永远不映射到偏差。
 * 这些候选只是建议，界面必须展示并由用户在映射步骤确认。
 */
export function suggestMapping(table: RawTable, hasHeader: boolean): ColumnMapping {
  const mapping = emptyMapping(hasHeader)
  if (!hasHeader) {
    return mapping
  }
  const header = headerRow(table, true)
  if (header === null) {
    return mapping
  }

  const normalized = header.cells.map(normalizeHeader)
  const findUnique = (aliases: string[]): number | null => {
    const candidates: number[] = []
    for (let index = 0; index < normalized.length; index += 1) {
      if (aliases.includes(normalized[index])) {
        candidates.push(index)
      }
    }
    return candidates.length === 1 ? candidates[0] : null
  }

  mapping.symbolColumn = findUnique(FIELD_ALIASES.symbol.map(normalizeHeader))
  mapping.nominalColumn = findUnique(FIELD_ALIASES.nominal.map(normalizeHeader))
  mapping.lowerColumn = findUnique(FIELD_ALIASES.lower.map(normalizeHeader))
  mapping.upperColumn = findUnique(FIELD_ALIASES.upper.map(normalizeHeader))
  mapping.signColumn = findUnique(FIELD_ALIASES.sign.map(normalizeHeader))
  const nameColumn = findUnique(FIELD_ALIASES.name.map(normalizeHeader))
  if (nameColumn !== null) {
    mapping.nameMode = 'column'
    mapping.nameColumn = nameColumn
  }
  mapping.sourceNoteColumn = findUnique(
    FIELD_ALIASES.sourceNote.map(normalizeHeader),
  )

  return mapping
}

/** 当前映射实际占用的列；常量 0 与“统一用代号”不占用列。 */
export function usedColumns(mapping: ColumnMapping): number[] {
  const columns = [
    mapping.symbolColumn,
    mapping.nominalColumn,
    mapping.lowerConstantZero ? null : mapping.lowerColumn,
    mapping.upperConstantZero ? null : mapping.upperColumn,
    mapping.signColumn,
    mapping.nameMode === 'column' ? mapping.nameColumn : null,
    mapping.sourceNoteColumn,
  ]
  return columns.filter((column): column is number => column !== null)
}

function isColumnIndex(value: number | null, columnCount: number): boolean {
  return (
    value === null ||
    (Number.isInteger(value) && value >= 0 && value < columnCount)
  )
}

interface HeaderConflict {
  /** 冲突列的表头原文（去重后），保留用户看到的写法。 */
  names: string[]
  /** 所有命中该字段别名的列下标（从 0 开始）。 */
  columns: number[]
}

/**
 * 找出某个必填字段在表头中命中多次同义列的情况。
 *
 * 命中可以是完全相同的列名（两列都叫“基本尺寸”），也可以是不同别名
 * （“基本尺寸”和“公称尺寸”）；只在字段尚未映射时用于解释“为什么无法自动
 * 确定”，用户手动选定其中一列后不再视为歧义。比较使用与 suggestMapping
 * 相同的 normalizeHeader 规则。
 */
function headerConflict(
  table: RawTable,
  hasHeader: boolean,
  field: ImportField,
): HeaderConflict | null {
  if (!hasHeader) {
    return null
  }
  const header = headerRow(table, true)
  if (header === null) {
    return null
  }

  const aliases = new Set(FIELD_ALIASES[field].map(normalizeHeader))
  const columns: number[] = []
  for (let index = 0; index < header.cells.length; index += 1) {
    const name = header.cells[index]?.trim() ?? ''
    if (name !== '' && aliases.has(normalizeHeader(name))) {
      columns.push(index)
    }
  }
  if (columns.length <= 1) {
    return null
  }

  return {
    names: [...new Set(columns.map((index) => (header.cells[index] ?? '').trim()))],
    columns,
  }
}

/**
 * 校验列映射本身。逐行数值校验在 validateImport.ts，模板结构校验在 templates.ts。
 * 有未解决的映射问题时不能进入预览或提交。
 */
export function validateMapping(
  table: RawTable,
  mapping: ColumnMapping,
): MappingIssue[] {
  const issues: MappingIssue[] = []
  const add = (field: ImportField | 'columns', message: string): void => {
    issues.push({ field, message })
  }

  if (mapping.hasHeader && table.rows.length < 2) {
    add('columns', '表头之后没有数据行，请选择“无表头”或补充数据')
  }

  const required: Array<[ImportField, number | null]> = [
    ['symbol', mapping.symbolColumn],
    ['nominal', mapping.nominalColumn],
  ]
  if (!mapping.lowerConstantZero) {
    required.push(['lower', mapping.lowerColumn])
  }
  if (!mapping.upperConstantZero) {
    required.push(['upper', mapping.upperColumn])
  }
  required.push(['sign', mapping.signColumn])

  for (const [field, column] of required) {
    if (column !== null) {
      continue
    }

    const conflict = headerConflict(table, mapping.hasHeader, field)
    if (conflict !== null) {
      const names = conflict.names.map((name) => `「${name}」`).join('、')
      const columns = conflict.columns.map((index) => index + 1).join('、')
      add(
        field,
        `表头歧义：${FIELD_LABELS[field]}同义列${names}出现 ${conflict.columns.length} 次（第 ${columns} 列），无法自动确定，请手动选择一列`,
      )
      continue
    }

    add(
      field,
      `${FIELD_LABELS[field]}必须映射到一列${
        field === 'lower' || field === 'upper' ? '，或显式选择“该列使用常量 0”' : ''
      }`,
    )
  }

  if (mapping.nameMode === 'column' && mapping.nameColumn === null) {
    add('name', '选择“名称来自某列”时必须指定名称列')
  }

  const allColumns: Array<[ImportField | 'columns', number | null]> = [
    ['symbol', mapping.symbolColumn],
    ['nominal', mapping.nominalColumn],
    ['lower', mapping.lowerConstantZero ? null : mapping.lowerColumn],
    ['upper', mapping.upperConstantZero ? null : mapping.upperColumn],
    ['sign', mapping.signColumn],
    ['name', mapping.nameMode === 'column' ? mapping.nameColumn : null],
    ['sourceNote', mapping.sourceNoteColumn],
  ]
  const seen = new Map<number, ImportField | 'columns'>()
  for (const [field, column] of allColumns) {
    if (column === null) {
      continue
    }
    if (!isColumnIndex(column, table.columnCount)) {
      add(field, `${FIELD_LABELS[field as ImportField] ?? '列'}超出表格列范围`)
      continue
    }
    const previous = seen.get(column)
    if (previous !== undefined) {
      add(
        field,
        `同一列不能同时映射到「${previous === 'columns' ? '多个字段' : FIELD_LABELS[previous as ImportField]}」和「${FIELD_LABELS[field as ImportField] ?? '该字段'}」`,
      )
    } else {
      seen.set(column, field)
    }
  }

  return issues
}

function cell(row: TableRow, column: number | null): string {
  return column === null ? '' : (row.cells[column] ?? '')
}

/**
 * 方向列的 distinct 原文（trim 后，忽略空单元格）。
 * 单位与含义确认步骤必须为每一个值显式选择 +1/-1。
 */
export function directionTokens(table: RawTable, mapping: ColumnMapping): string[] {
  const tokens: string[] = []
  const seen = new Set<string>()
  for (const row of dataRows(table, mapping.hasHeader)) {
    const token = cell(row, mapping.signColumn).trim()
    if (token === '' || seen.has(token)) {
      continue
    }
    seen.add(token)
    tokens.push(token)
  }
  return tokens
}

const DIRECTION_CANDIDATES: Record<string, DirectionValue> = {
  '+1': 1,
  '1': 1,
  '+': 1,
  '+1.0': 1,
  正: 1,
  正环: 1,
  增环: 1,
  增加: 1,
  增加封闭环: 1,
  '增加封闭环(+)': 1,
  加: 1,
  '-1': -1,
  '−1': -1,
  '-': -1,
  '−': -1,
  '-1.0': -1,
  负: -1,
  负环: -1,
  减环: -1,
  减小: -1,
  减小封闭环: -1,
  '减小封闭环(−)': -1,
  减: -1,
}

function normalizeDirectionToken(token: string): string {
  return token
    .trim()
    .toLowerCase()
    .replace(/\s/g, '')
    .replace(/＋/g, '+')
    .replace(/[－−]/g, '-')
    .replace(/[０-９]/g, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
    )
}

/** 只给出显式候选；未知返回 null，绝不默认 +1。 */
export function candidateDirectionValue(token: string): DirectionValue | null {
  return DIRECTION_CANDIDATES[normalizeDirectionToken(token)] ?? null
}

export function mappingColumnSummary(
  table: RawTable,
  mapping: ColumnMapping,
): string {
  const parts: string[] = []
  const describe = (field: ImportField, column: number | null): void => {
    if (column !== null) {
      parts.push(`${FIELD_LABELS[field]}←${columnLabel(table, mapping.hasHeader, column)}`)
    }
  }
  describe('symbol', mapping.symbolColumn)
  describe('nominal', mapping.nominalColumn)
  if (mapping.lowerConstantZero) {
    parts.push('下偏差←常量 0')
  } else {
    describe('lower', mapping.lowerColumn)
  }
  if (mapping.upperConstantZero) {
    parts.push('上偏差←常量 0')
  } else {
    describe('upper', mapping.upperColumn)
  }
  describe('sign', mapping.signColumn)
  if (mapping.nameMode === 'column') {
    describe('name', mapping.nameColumn)
  } else {
    parts.push('名称←代号')
  }
  describe('sourceNote', mapping.sourceNoteColumn)
  return parts.join('；')
}
