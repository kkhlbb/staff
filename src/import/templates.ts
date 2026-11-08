import type { StorageError, StorageResult } from '../storage/projects'
import {
  MAPPING_TEMPLATE_STORE_NAME,
  requestResult,
  transactionDone,
  withDatabase,
} from '../storage/db'
import {
  emptyMapping,
  type ColumnMapping,
} from './mapColumns'
import { headerRow, type RawTable } from './parseTable'

/**
 * 映射模板只保存“如何解释表格”的结构信息：表头开关、列名/列位置、字段映射、
 * 显式常量与单位。绝不保存客户数据行。
 */
export interface MappingTemplate {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  /** 首版仅支持 mm；保存它是为了明确模板含义。 */
  unit: 'mm'
  hasHeader: boolean
  /** 有表头时为 trim 后的表头序列；无表头时为空数组。 */
  headerSignature: string[]
  columnCount: number
  mapping: ColumnMapping
}

export interface SaveMappingTemplateInput {
  name: string
  table: RawTable
  mapping: ColumnMapping
}

export type TemplateApplyResult =
  | { ok: true; mapping: ColumnMapping }
  | { ok: false; reason: string; mapping: ColumnMapping }

function failure(code: string, message: string): StorageResult<never> {
  return { ok: false, error: { code, message, details: [] } }
}

function storageFailure(error: unknown, message: string): StorageResult<never> {
  const detail = error instanceof Error ? error.message : String(error)
  const storageError: StorageError = {
    code: 'storage_failure',
    message: `${message}：${detail}`,
    details: [],
  }
  return { ok: false, error: storageError }
}

function newTemplateId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  return `template-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function cloneMapping(mapping: ColumnMapping): ColumnMapping {
  return {
    ...mapping,
    directionValues: { ...mapping.directionValues },
  }
}

function headerSignature(table: RawTable, hasHeader: boolean): string[] {
  if (!hasHeader) {
    return []
  }
  const header = headerRow(table, true)
  return header === null ? [] : header.cells.map((cell) => cell.trim())
}

/**
 * 模板结构检查：表头设置、表头文本顺序和列数都必须与保存时一致。
 * 改列顺序、缺列或多列都会判定不匹配，要求用户重新映射。
 */
export function templateStructureMismatch(
  table: RawTable,
  template: MappingTemplate,
): string | null {
  if (template.hasHeader) {
    const header = headerRow(table, true)
    if (header === null) {
      return '模板要求有表头，但当前表格没有表头行'
    }
    if (table.rows.length < 2) {
      return '模板要求有表头，但表头之后没有数据行'
    }
    const current = header.cells.map((cell) => cell.trim())
    if (current.length !== template.headerSignature.length) {
      return `列数不一致：模板保存时 ${template.headerSignature.length} 列，当前 ${current.length} 列`
    }
    for (let index = 0; index < current.length; index += 1) {
      if (current[index] !== template.headerSignature[index]) {
        return `第 ${index + 1} 列表头不一致：模板为「${template.headerSignature[index]}」，当前为「${current[index]}」`
      }
    }
    if (table.columnCount !== template.columnCount) {
      return `列数不一致：模板保存时 ${template.columnCount} 列，当前 ${table.columnCount} 列`
    }
    return null
  }

  if (table.columnCount !== template.columnCount) {
    return `列数不一致：模板保存时 ${template.columnCount} 列，当前 ${table.columnCount} 列`
  }
  return null
}

/**
 * 套用模板。结构不匹配时不返回模板映射，而是回到空白映射（保留模板的表头开关），
 * 强制用户重新选择列；模板永远不会绕过逐行校验。
 */
export function applyMappingTemplate(
  table: RawTable,
  template: MappingTemplate,
): TemplateApplyResult {
  const mismatch = templateStructureMismatch(table, template)
  if (mismatch !== null) {
    return {
      ok: false,
      reason: `${mismatch}。列结构已变化，请重新映射。`,
      mapping: emptyMapping(template.hasHeader),
    }
  }
  return {
    ok: true,
    mapping: {
      ...cloneMapping(template.mapping),
      hasHeader: template.hasHeader,
    },
  }
}

function isMappingTemplate(value: unknown): value is MappingTemplate {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.hasHeader === 'boolean' &&
    typeof record.columnCount === 'number' &&
    Array.isArray(record.headerSignature) &&
    typeof record.mapping === 'object' &&
    record.mapping !== null
  )
}

/** 读取全部模板，按更新时间倒序。 */
export async function listMappingTemplates(): Promise<StorageResult<MappingTemplate[]>> {
  try {
    const templates = await withDatabase(async (db) => {
      const transaction = db.transaction(MAPPING_TEMPLATE_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction.objectStore(MAPPING_TEMPLATE_STORE_NAME).getAll(),
      )
      await done
      return value.filter(isMappingTemplate)
    })
    templates.sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
    )
    return { ok: true, value: templates }
  } catch (error) {
    return storageFailure(error, '读取映射模板失败')
  }
}

/**
 * 保存模板。保存动作只写 mappingTemplates store，不读取也不写入任何项目数据行。
 */
export async function saveMappingTemplate(
  input: SaveMappingTemplateInput,
): Promise<StorageResult<MappingTemplate>> {
  const name = input.name.trim()
  if (name === '') {
    return failure('invalid_template_name', '模板名称不能为空')
  }

  // 方向值属于具体数据的解释，不写进模板；再次套用后仍需在“单位与方向”步骤确认。
  const mapping = { ...cloneMapping(input.mapping), directionValues: {} }
  const now = nowIso()
  const template: MappingTemplate = {
    id: newTemplateId(),
    name,
    createdAt: now,
    updatedAt: now,
    unit: 'mm',
    hasHeader: mapping.hasHeader,
    headerSignature: headerSignature(input.table, mapping.hasHeader),
    columnCount: input.table.columnCount,
    mapping,
  }

  try {
    await withDatabase(async (db) => {
      const transaction = db.transaction(MAPPING_TEMPLATE_STORE_NAME, 'readwrite')
      const done = transactionDone(transaction)
      try {
        transaction.objectStore(MAPPING_TEMPLATE_STORE_NAME).add(template)
        await done
      } catch (error) {
        await done.catch(() => undefined)
        throw error
      }
    })
    return { ok: true, value: template }
  } catch (error) {
    return storageFailure(error, '保存映射模板失败')
  }
}

export async function deleteMappingTemplate(
  id: string,
): Promise<StorageResult<boolean>> {
  try {
    const existed = await withDatabase(async (db) => {
      const transaction = db.transaction(MAPPING_TEMPLATE_STORE_NAME, 'readwrite')
      const done = transactionDone(transaction)
      try {
        const store = transaction.objectStore(MAPPING_TEMPLATE_STORE_NAME)
        const existing = await requestResult(store.get(id))
        store.delete(id)
        await done
        return existing !== undefined
      } catch (error) {
        await done.catch(() => undefined)
        throw error
      }
    })
    return { ok: true, value: existed }
  } catch (error) {
    return storageFailure(error, '删除映射模板失败')
  }
}
