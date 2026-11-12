/** 工具共用的数值/摘要格式化：mm 文本一律来自内核 `formatMm`，不另写小数规则。 */

import { formatMm } from '../../src/domain/units'
import { sha256Hex } from '../../src/sources/hash'

export function mm(value: number): string {
  return formatMm(value)
}

export function sha256(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes)
}

export interface ToolSuccess {
  readonly ok: true
  readonly tool: string
  readonly [key: string]: unknown
}

export function success(tool: string, payload: Record<string, unknown>): ToolSuccess {
  return { ok: true, tool, ...payload }
}

/** 确定性 JSON：键顺序由对象字面量固定，数组保持插入顺序。 */
export function stableJson(value: unknown): string {
  return JSON.stringify(value)
}
