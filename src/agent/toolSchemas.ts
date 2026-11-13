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

const exportParams: JsonObject = {
  type: 'object',
  properties: { format: { enum: ['pdf', 'svg'] } },
  required: ['format'],
  additionalProperties: false,
}

const mmText: JsonObject = { type: 'string', minLength: 1, maxLength: 32 }
const statementSchema: JsonObject = { type: 'string', minLength: 1, maxLength: 4000 }

/** ADR-001 第 3 步：无任务书入口。name/partType 之外的身份由 main 绑定，模型无法提供。 */
const createProject: JsonObject = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    partType: { enum: ['spacer'] },
  },
  required: ['name', 'partType'],
  additionalProperties: false,
}

const setChain: JsonObject = {
  type: 'object',
  properties: {
    statement: statementSchema,
    rings: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        properties: {
          symbol: { type: 'string', minLength: 1, maxLength: 20 },
          nominalMm: mmText,
          upperDeviationMm: mmText,
          lowerDeviationMm: mmText,
        },
        required: ['symbol', 'nominalMm', 'upperDeviationMm', 'lowerDeviationMm'],
        additionalProperties: false,
      },
    },
    formula: { type: 'string', minLength: 1, maxLength: 200 },
  },
  required: ['statement', 'rings'],
  additionalProperties: false,
}

const setRequirement: JsonObject = {
  type: 'object',
  properties: {
    statement: statementSchema,
    lowerMm: mmText,
    upperMm: mmText,
    lowerInclusive: { type: 'boolean' },
    upperInclusive: { type: 'boolean' },
  },
  required: ['statement', 'lowerMm', 'upperMm', 'lowerInclusive', 'upperInclusive'],
  additionalProperties: false,
}

const setBinding: JsonObject = {
  type: 'object',
  properties: {
    statement: statementSchema,
    parameters: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          parameter: parameterSchema,
          mm: mmText,
          symbol: { type: 'string', minLength: 1, maxLength: 20 },
        },
        required: ['parameter', 'mm'],
        additionalProperties: false,
      },
    },
  },
  required: ['statement', 'parameters'],
  additionalProperties: false,
}

export const AGENT_TOOL_SCHEMAS: Record<AgentToolCommand, ToolSchema> = {
  ingest_readings: {
    name: 'ingest_readings',
    description: '仅桌面端：接收用户对照文件报出的读数，不自行识图或 OCR。DeepSeek 不支持图像输入。statement 必须逐字来自用户，数值单位 q（1 mm=10000 q）。只产读数未核对候选，必须逐条确认，禁止批量确认。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        projectId: idSchema, draftId: idSchema, statement: statementSchema,
        source: { oneOf: [
          { type: 'object', additionalProperties: false, properties: { kind: { const: 'pdf-page' }, revisionId: idSchema,
            sha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' }, page: { type: 'integer' } }, required: ['kind', 'revisionId', 'sha256', 'page'] },
          { type: 'object', additionalProperties: false, properties: { kind: { const: 'image' }, imageId: idSchema,
            sha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' } }, required: ['kind', 'imageId', 'sha256'] },
        ] },
        readings: { type: 'array', minItems: 1, maxItems: 20, items: {
          type: 'object', additionalProperties: false, properties: { kind: { const: 'dimension' }, symbol: idSchema,
            nominalQ: { type: 'integer' }, upperDeviationQ: { type: 'integer' }, lowerDeviationQ: { type: 'integer' }, unit: { const: 'mm' } },
          required: ['kind', 'symbol', 'nominalQ', 'upperDeviationQ', 'lowerDeviationQ', 'unit'],
        } },
      }, required: ['source', 'statement', 'readings'],
    },
  },
  createProject: {
    name: 'createProject',
    description: '把当前空白项目建立为无任务书项目（零件由用户在对话里给出，没有任务书 PDF）。责任人自述由界面绑定，不要自己编造。只建立项目与空草稿，不写任何数值。',
    parameters: createProject,
  },
  setChain: {
    name: 'setChain',
    description: '把用户说出的组成环写入意图草稿（只产草稿，不提交）。statement 必须是用户原话逐字；rings 的每个数值都必须出现在用户原话里，编造或推算会被拒绝。formula 例如 "H - B1 - S - B2"。',
    parameters: setChain,
  },
  setRequirement: {
    name: 'setRequirement',
    description: '把用户明确给出的条款区间写入意图草稿。lowerMm/upperMm 必须出现在用户原话里；不允许引用 GB/T 5847 等级、标准默认值或自行推算，否则返回 REQUIREMENT_MUST_BE_USER_GIVEN。',
    parameters: setRequirement,
  },
  setBinding: {
    name: 'setBinding',
    description: '写入隔套参数（内径/外径/长度）与可选的“参数 ↔ 组成环”绑定意图。参数值必须来自用户原话；绑定要求参数值等于该环基本尺寸，否则拒绝。只产草稿。',
    parameters: setBinding,
  },
  context: { name: 'context', description: '读取当前项目、正式版本、工作草稿、最近版本参数与条款状态。只读。', parameters: context },
  confirmed: { name: 'confirmed', description: '读取提取草稿的已确认候选（紧凑视图：candidateId、kind、summary、原文摘录）与冲突问题。只读。', parameters: confirmed },
  apply: {
    name: 'apply',
    description: '按用户已确认的候选建立工程草稿。mapping.formulaId 取 kind="formula" 候选的 candidateId；mapping.ringSymbols 是组成环符号顺序；linkLengthToSymbol 指隔套长度绑定的环。返回新建草稿的 draftId，后续 stage/preview 必须使用它。',
    parameters: apply,
  },
  stage: { name: 'stage', description: '在现有工程草稿上修改一个参数并重新计算。parameter 只接受 innerDiameter/outerDiameter/length；锁定参数不得修改。', parameters: stage },
  preview: { name: 'preview', description: '重算草稿图纸、区间与条款检查，返回候选复核结果（区间、裕量、条款状态）。', parameters: preview },
  export: {
    name: 'export',
    description: '把当前已保存版本经系统对话框导出为 PDF 或 SVG；返回真实文件名、大小与哈希，取消返回 CANCELLED。',
    parameters: exportParams,
  },
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
