/**
 * MCP 工具的参数校验：显式、可复现、不悄悄补默认值。
 *
 * 只做传输层形状校验（类型/范围/必填）；工程判据仍由内核负责，避免在 MCP 里
 * 写第二份规则。任何不合法的输入都以 ToolInputError 抛出，由 server 转成
 * JSON-RPC 的 isError 结果，绝不返回半成品。
 */

export type ToolErrorCode = 'INVALID_ARGUMENTS' | 'NOT_FOUND' | 'IO_FAILED' | 'TOOL_FAILED'

export class ToolInputError extends Error {
  readonly code: ToolErrorCode
  readonly detail: string | null

  constructor(code: ToolErrorCode, message: string, detail: string | null = null) {
    super(message)
    this.name = 'ToolInputError'
    this.code = code
    this.detail = detail
  }
}

export function asObject(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ToolInputError('INVALID_ARGUMENTS', `${context} 必须是 JSON 对象`)
  }
  return value as Record<string, unknown>
}

export function readString(
  object: Record<string, unknown>,
  key: string,
  options: { required?: boolean; maxLength?: number; pattern?: RegExp } = {},
): string | null {
  const value = object[key]
  if (value === undefined || value === null) {
    if (options.required === true) {
      throw new ToolInputError('INVALID_ARGUMENTS', `缺少必填字段 ${key}`)
    }
    return null
  }
  if (typeof value !== 'string') {
    throw new ToolInputError('INVALID_ARGUMENTS', `${key} 必须是字符串`)
  }
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw new ToolInputError(
      'INVALID_ARGUMENTS',
      `${key} 超过最大长度 ${options.maxLength}`,
      `${value.length}`,
    )
  }
  if (options.pattern !== undefined && !options.pattern.test(value)) {
    throw new ToolInputError('INVALID_ARGUMENTS', `${key} 格式不合法`, value)
  }
  return value
}

export function readInteger(
  object: Record<string, unknown>,
  key: string,
  options: { required?: boolean; min?: number; max?: number } = {},
): number | null {
  const value = object[key]
  if (value === undefined || value === null) {
    if (options.required === true) {
      throw new ToolInputError('INVALID_ARGUMENTS', `缺少必填字段 ${key}`)
    }
    return null
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ToolInputError('INVALID_ARGUMENTS', `${key} 必须是安全整数（q）`, String(value))
  }
  if (options.min !== undefined && value < options.min) {
    throw new ToolInputError('INVALID_ARGUMENTS', `${key} 不能小于 ${options.min}`, String(value))
  }
  if (options.max !== undefined && value > options.max) {
    throw new ToolInputError('INVALID_ARGUMENTS', `${key} 不能大于 ${options.max}`, String(value))
  }
  return value
}

export function readEnum<T extends string | number>(
  object: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  options: { required?: boolean } = {},
): T | null {
  const value = object[key]
  if (value === undefined || value === null) {
    if (options.required === true) {
      throw new ToolInputError('INVALID_ARGUMENTS', `缺少必填字段 ${key}`)
    }
    return null
  }
  if (!allowed.includes(value as T)) {
    // 传输层容错：JSON schema 写的是字符串枚举，但有的客户端（如 MCP Inspector
    // 的 CLI）会把 "2000" 猜成数字 2000。只接受与枚举项逐字相等的字符串化结果，
    // 其它任何值照旧拒绝，不做业务推断。
    if (
      typeof value === 'number' &&
      allowed.every((item) => typeof item === 'string') &&
      (allowed as readonly string[]).includes(String(value))
    ) {
      return String(value) as T
    }
    throw new ToolInputError(
      'INVALID_ARGUMENTS',
      `${key} 只接受 ${allowed.join(' / ')}`,
      String(value),
    )
  }
  return value as T
}

export function readBoolean(
  object: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = object[key]
  if (value === undefined || value === null) return fallback
  if (typeof value === 'boolean') return value
  // 同上：容忍客户端把 true/false 当字符串发，只认这两个字面量。
  if (value === 'true') return true
  if (value === 'false') return false
  throw new ToolInputError('INVALID_ARGUMENTS', `${key} 必须是布尔值`)
}

export function readArray(
  object: Record<string, unknown>,
  key: string,
  options: { required?: boolean; minLength?: number } = {},
): unknown[] | null {
  const value = object[key]
  if (value === undefined || value === null) {
    if (options.required === true) {
      throw new ToolInputError('INVALID_ARGUMENTS', `缺少必填字段 ${key}`)
    }
    return null
  }
  if (!Array.isArray(value)) {
    throw new ToolInputError('INVALID_ARGUMENTS', `${key} 必须是数组`)
  }
  if (options.minLength !== undefined && value.length < options.minLength) {
    throw new ToolInputError('INVALID_ARGUMENTS', `${key} 至少需要 ${options.minLength} 项`)
  }
  return value
}

/** 只接受绝对路径；相对路径会让工具行为依赖启动目录，拒绝。 */
export function requireAbsolutePath(value: string, key: string): string {
  if (!value.startsWith('/')) {
    throw new ToolInputError('INVALID_ARGUMENTS', `${key} 必须是绝对路径`, value)
  }
  return value
}
