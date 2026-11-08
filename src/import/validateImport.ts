import { tryParseMm } from '../domain/units'
import type { Q } from '../domain/types'
import {
  FIELD_LABELS,
  findLimitColumns,
  type ColumnMapping,
  type ImportField,
} from './mapColumns'
import {
  MAX_IMPORT_TERMS,
  dataRows,
  type RawTable,
  type TableRow,
} from './parseTable'
import type { TermDraft } from '../workspace/draft'

export type ImportCellErrors = Record<string, string>
export type ImportEdits = Record<string, string>

export interface ImportTerm {
  /** 原文行号，用于生成不冲突的 term id 和回显。 */
  rowNumber: number
  symbol: string
  name: string
  nominal: string
  lower: string
  upper: string
  sign: 1 | -1
  sourceNote: string
}

export interface ImportPreviewRow {
  rowNumber: number
  sourceCells: string[]
  /** 映射列在原文中的值（常量列仍显示原文，便于核对）。 */
  rawValues: Record<ImportField, string>
  /** 用户修正后的实际值；数值不会自动改写。 */
  values: Record<ImportField, string>
  parsed: Partial<Record<'nominal' | 'lower' | 'upper', Q>>
  errors: Partial<Record<ImportField, string>>
  warnings: string[]
  term: ImportTerm | null
}

export interface ImportCellIssue {
  rowNumber: number
  field: ImportField
  message: string
}

export interface ImportValidationResult {
  rows: ImportPreviewRow[]
  validTerms: ImportTerm[]
  cellErrors: ImportCellErrors
  issues: ImportCellIssue[]
  globalErrors: string[]
  ignoredBlankRows: number
  limitColumns: string[]
}

export function importCellKey(rowNumber: number, field: ImportField): string {
  return `${rowNumber}.${field}`
}

function cell(row: TableRow, column: number | null): string {
  return column === null ? '' : (row.cells[column] ?? '')
}

function emptyValues(): Record<ImportField, string> {
  return {
    symbol: '',
    nominal: '',
    lower: '',
    upper: '',
    sign: '',
    name: '',
    sourceNote: '',
  }
}

function readEdited(
  edits: ImportEdits,
  rowNumber: number,
  field: ImportField,
  fallback: string,
): string {
  const edited = edits[importCellKey(rowNumber, field)]
  return edited === undefined ? fallback : edited
}

/**
 * 逐行校验映射后的表格。任何一行有未解决错误时 validTerms 不包含它，
 * 调用方必须据此禁止提交，不允许跳过错误行。
 *
 * 数值只调用领域层的 tryParseMm 做精确转换；不做对称公差展开、逗号小数、
 * 千分位或公式求值，也不自动 trim 数值（trim 会静默改写用户原文）。
 */
export function validateImport(
  table: RawTable,
  mapping: ColumnMapping,
  edits: ImportEdits = {},
): ImportValidationResult {
  const rows: ImportPreviewRow[] = []
  const issues: ImportCellIssue[] = []
  const cellErrors: ImportCellErrors = {}
  const validTerms: ImportTerm[] = []
  const globalErrors: string[] = []
  const sourceRows = dataRows(table, mapping.hasHeader)
  const limitColumns = findLimitColumns(table, mapping.hasHeader)

  const symbolRows = new Map<string, number>()

  for (const sourceRow of sourceRows) {
    const rawValues = emptyValues()
    rawValues.symbol = cell(sourceRow, mapping.symbolColumn)
    rawValues.nominal = cell(sourceRow, mapping.nominalColumn)
    rawValues.lower = cell(sourceRow, mapping.lowerColumn)
    rawValues.upper = cell(sourceRow, mapping.upperColumn)
    rawValues.sign = cell(sourceRow, mapping.signColumn)
    rawValues.name =
      mapping.nameMode === 'column' ? cell(sourceRow, mapping.nameColumn) : ''
    rawValues.sourceNote = cell(sourceRow, mapping.sourceNoteColumn)

    const errors: Partial<Record<ImportField, string>> = {}
    const warnings: string[] = []
    const parsed: ImportPreviewRow['parsed'] = {}
    const values = emptyValues()

    const addError = (field: ImportField, message: string): void => {
      errors[field] = message
      issues.push({ rowNumber: sourceRow.rowNumber, field, message })
    }

    // 代号允许 trim；记录转换供预览核对。
    const rawSymbol = readEdited(
      edits,
      sourceRow.rowNumber,
      'symbol',
      rawValues.symbol,
    )
    const symbol = rawSymbol.trim()
    values.symbol = symbol
    if (symbol === '') {
      addError('symbol', '代号不能为空')
    } else if (rawSymbol !== symbol) {
      warnings.push(`代号已去除前后空白：「${rawSymbol}」→「${symbol}」`)
    }

    if (symbol !== '') {
      const firstRow = symbolRows.get(symbol)
      if (firstRow === undefined) {
        symbolRows.set(symbol, sourceRow.rowNumber)
      } else {
        addError('symbol', `代号「${symbol}」与第 ${firstRow} 行重复`)
      }
    }

    const checkNumber = (
      field: 'nominal' | 'lower' | 'upper',
      fallback: string,
      constantZero: boolean,
    ): Q | undefined => {
      const raw = constantZero
        ? '0.0000'
        : readEdited(edits, sourceRow.rowNumber, field, fallback)
      values[field] = raw
      if (constantZero) {
        parsed[field] = 0
        return 0
      }
      if (raw.trim() === '') {
        addError(field, `${FIELD_LABELS[field]}不能为空`)
        return undefined
      }
      if (raw !== raw.trim()) {
        addError(
          field,
          `${FIELD_LABELS[field]}前后有空白，请修正后再导入（不会自动改写）`,
        )
        return undefined
      }
      const result = tryParseMm(raw)
      if (!result.ok) {
        addError(field, result.message)
        return undefined
      }
      parsed[field] = result.value
      return result.value
    }

    const nominalQ = checkNumber('nominal', rawValues.nominal, false)
    const lowerQ = checkNumber('lower', rawValues.lower, mapping.lowerConstantZero)
    const upperQ = checkNumber('upper', rawValues.upper, mapping.upperConstantZero)

    if (nominalQ !== undefined && nominalQ <= 0) {
      addError('nominal', '基本尺寸必须大于 0')
    }
    if (lowerQ !== undefined && upperQ !== undefined && lowerQ > upperQ) {
      addError('upper', '上偏差不能小于下偏差')
    }
    if (nominalQ !== undefined && lowerQ !== undefined && nominalQ + lowerQ < 0) {
      addError('lower', '基本尺寸加下偏差不能小于 0（下极限尺寸不能为负）')
    }

    const rawName = readEdited(
      edits,
      sourceRow.rowNumber,
      'name',
      rawValues.name,
    )
    if (mapping.nameMode === 'symbol') {
      values.name = symbol
    } else {
      values.name = rawName
      if (rawName.trim() === '') {
        addError('name', '名称不能为空；可改选“统一用代号”')
      }
    }

    const editedSign = edits[importCellKey(sourceRow.rowNumber, 'sign')]
    const rawSign = editedSign === undefined ? rawValues.sign : editedSign
    const signToken = rawSign.trim()
    let sign: 1 | -1 | undefined
    if (signToken === '') {
      values.sign = ''
      addError('sign', '方向不能为空，必须明确为 +1 或 -1')
    } else if (
      editedSign !== undefined &&
      (signToken === '1' || signToken === '-1')
    ) {
      // 只有预览里的用户编辑值才允许直接采用 ±1；原文必须走已确认映射。
      sign = signToken === '1' ? 1 : -1
      values.sign = signToken
    } else {
      // 原文方向（包括字面 '1' / '-1'）一律以用户在向导中确认的映射为准。
      const mapped = mapping.directionValues[signToken]
      if (mapped === undefined) {
        values.sign = signToken
        addError(
          'sign',
          `方向值「${signToken}」尚未映射为 +1 或 -1，不能默认按正环处理`,
        )
      } else {
        sign = mapped
        values.sign = String(mapped)
        if (rawSign !== signToken) {
          warnings.push(`方向已去除前后空白：「${rawSign}」→「${signToken}」`)
        }
      }
    }

    values.sourceNote = readEdited(
      edits,
      sourceRow.rowNumber,
      'sourceNote',
      rawValues.sourceNote,
    )

    if (Object.keys(errors).length > 0) {
      cellErrorsForRow(sourceRow.rowNumber, errors, cellErrors)
    }

    let term: ImportTerm | null = null
    if (
      Object.keys(errors).length === 0 &&
      sign !== undefined &&
      nominalQ !== undefined &&
      lowerQ !== undefined &&
      upperQ !== undefined
    ) {
      term = {
        rowNumber: sourceRow.rowNumber,
        symbol,
        name: values.name,
        nominal: values.nominal,
        lower: values.lower,
        upper: values.upper,
        sign,
        sourceNote: values.sourceNote,
      }
      validTerms.push(term)
    }

    rows.push({
      rowNumber: sourceRow.rowNumber,
      sourceCells: sourceRow.cells,
      rawValues,
      values,
      parsed,
      errors,
      warnings,
      term,
    })
  }

  if (rows.length === 0) {
    globalErrors.push('没有可导入的数据行')
  }
  if (rows.length > MAX_IMPORT_TERMS) {
    globalErrors.push(
      `组成环最多 ${MAX_IMPORT_TERMS} 项，当前为 ${rows.length} 项`,
    )
  }
  // 导入行数不等于最终链数量：单行追加到已有合法链是允许的，
  // 最终 2–20 项由 commit 的 draftToChain / validateChain 校验。
  if (validTerms.length !== rows.length) {
    // 保持提示明确：不要因为少量错误行而误以为可以只导入“有效的那几行”。
    globalErrors.push('存在未解决的错误行，不能只导入其余有效行')
  }

  return {
    rows,
    validTerms,
    cellErrors,
    issues,
    globalErrors,
    ignoredBlankRows: table.blankRows,
    limitColumns,
  }
}

function cellErrorsForRow(
  rowNumber: number,
  errors: Partial<Record<ImportField, string>>,
  target: ImportCellErrors,
): void {
  for (const [field, message] of Object.entries(errors)) {
    if (message !== undefined) {
      target[importCellKey(rowNumber, field as ImportField)] = message
    }
  }
}

/** 把预览行转成工作台草稿 term；id 基于原文行号，提交前还会按现有环去重。 */
export function termToDraftValues(
  term: ImportTerm,
): Omit<TermDraft, 'id' | 'termRevision'> {
  return {
    symbol: term.symbol,
    name: term.name,
    nominal: term.nominal,
    lower: term.lower,
    upper: term.upper,
    sign: term.sign,
    sourceNote: term.sourceNote,
  }
}
