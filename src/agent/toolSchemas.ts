/**
 * 模型可调用的 agent:* 工具参数 JSON Schema（阶段 2 的唯一模型侧门禁）。
 *
 * 只支持本仓库用到的 JSON Schema 子集：type/const/enum/minLength/maxLength/
 * minItems/maxItems/items/required/properties/additionalProperties/oneOf。
 * 校验消息只写字段路径和期望，不回显模型传入的值，避免把敏感内容带进日志。
 */
import type { AgentToolCommand, ToolSchema } from './types'

type JsonObject = Record<string, unknown>

const idSchema: JsonObject = { type: 'string', minLength: 1, maxLength: 240 }
const parameterSchema: JsonObject = { enum: ['innerDiameter', 'outerDiameter', 'length'] }

const context: JsonObject = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
}

const confirmed: JsonObject = {
  type: 'object',
  properties: { draftId: idSchema },
  required: ['draftId'],
  additionalProperties: false,
}

const apply: JsonObject = {
  type: 'object',
  properties: {
    planToken: idSchema,
    baseRevisionId: idSchema,
    candidateIds: { type: 'array', items: idSchema, minItems: 1, maxItems: 200 },
    mapping: {
      type: 'object',
      properties: {
        spacerPart: { const: 'builtin:shaft-demo:spacer' },
        ringSymbols: { type: 'array', items: idSchema, maxItems: 20 },
        formulaId: idSchema,
        requirement: { type: 'boolean' },
        linkLengthToSymbol: idSchema,
      },
      required: [],
      additionalProperties: false,
    },
  },
  required: ['planToken', 'baseRevisionId', 'candidateIds', 'mapping'],
  additionalProperties: false,
}

const stage: JsonObject = {
  type: 'object',
  properties: {
    toolMode: { const: 'agent' },
    draftId: idSchema,
    baseRevisionId: idSchema,
    parameter: parameterSchema,
    valueMm: { type: 'string', maxLength: 32 },
    deltaMm: { type: 'string', maxLength: 32 },
    lockedKeys: { type: 'array', items: parameterSchema, maxItems: 3 },
  },
  required: ['toolMode', 'draftId', 'baseRevisionId', 'parameter', 'lockedKeys'],
  additionalProperties: false,
  oneOf: [
    { type: 'object', required: ['valueMm'] },
    { type: 'object', required: ['deltaMm'] },
  ],
}

const preview: JsonObject = {
  type: 'object',
  properties: {
    toolMode: { const: 'agent' },
    draftId: idSchema,
    baseRevisionId: idSchema,
  },
  required: ['toolMode', 'draftId', 'baseRevisionId'],
  additionalProperties: false,
}

export const AGENT_TOOL_SCHEMAS: Record<AgentToolCommand, ToolSchema> = {
  context: { name: 'context', description: '读取当前项目、正式版本、工作草稿与条款状态。只读。', parameters: context },
  confirmed: { name: 'confirmed', description: '读取指定提取草稿的已确认候选与来源。只读。', parameters: confirmed },
  apply: { name: 'apply', description: '按用户已确认的候选建立工程草稿；模型只传映射意图。', parameters: apply },
  stage: { name: 'stage', description: '在现有工程草稿上修改一个参数并重新计算。', parameters: stage },
  preview: { name: 'preview', description: '重算草稿图纸、区间与条款检查，返回候选复核结果。', parameters: preview },
}

export type ToolValidation =
  | { ok: true; value: unknown }
  | { ok: false; code: 'INVALID_INPUT'; message: string }

function isPlainObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'object': return isPlainObject(value)
    case 'array': return Array.isArray(value)
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'null': return value === null
    default: return false
  }
}

function validateNode(schema: JsonObject, value: unknown, path: string, errors: string[]): void {
  if (errors.length >= 4) return
  const type = schema.type
  if (typeof type === 'string' && !matchesType(type, value)) {
    errors.push(`${path} 类型应为 ${type}`)
    return
  }
  if ('const' in schema && value !== schema.const) {
    errors.push(`${path} 取值不符合约定`)
    return
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path} 不在允许取值内`)
    return
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push(`${path} 长度不足`)
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(`${path} 超长`)
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path} 格式不符`)
  }
  if (Array.isArray(value) && schema.type === 'array') {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(`${path} 项数不足`)
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errors.push(`${path} 项数超限`)
    if (isPlainObject(schema.items)) value.forEach((item, index) => validateNode(schema.items as JsonObject, item, `${path}[${index}]`, errors))
  }
  if (isPlainObject(value) && schema.type === 'object') {
    const properties = isPlainObject(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required) ? schema.required : []
    for (const key of required) if (typeof key === 'string' && !(key in value)) errors.push(`${path}.${key} 缺失`)
    for (const [key, item] of Object.entries(value)) {
      const child = properties[key]
      if (isPlainObject(child)) validateNode(child, item, `${path}.${key}`, errors)
      else if (schema.additionalProperties === false) errors.push(`${path}.${key} 是未声明字段`)
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const matched = schema.oneOf.filter((branch) => {
      if (!isPlainObject(branch)) return false
      const branchErrors: string[] = []
      validateNode(branch, value, path, branchErrors)
      return branchErrors.length === 0
    })
    if (matched.length !== 1) errors.push(`${path} 必须且只能满足一个互斥分支`)
  }
}

export function validateToolArguments(name: string, value: unknown): ToolValidation {
  const schema = (AGENT_TOOL_SCHEMAS as Record<string, ToolSchema | undefined>)[name]
  if (schema === undefined) {
    return { ok: false, code: 'INVALID_INPUT', message: `未知工具：${name}` }
  }
  const errors: string[] = []
  validateNode(schema.parameters, value, name, errors)
  if (errors.length > 0) {
    return { ok: false, code: 'INVALID_INPUT', message: `工具参数校验失败：${errors.join('；')}` }
  }
  return { ok: true, value }
}

/** 供适配器构造 ModelRequest.tools；模型只能看到这五个命令。 */
export const MODEL_TOOL_SCHEMAS: ToolSchema[] = Object.values(AGENT_TOOL_SCHEMAS)
