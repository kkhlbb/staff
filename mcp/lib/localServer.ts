import { M1_LOCAL_ERRORS } from '../../desktop/main/project-agent/m1LocalTransport'
import type { LocalM1Client } from '../localClient'
import { createStdioServer } from '../stdio'
import type { ToolSpec } from '../tools/index'
import catalog from '../../cloud/contracts/mcp-gdt-tools.json' with { type: 'json' }
import { mcpLog } from './log'

const project = { projectId: { type: 'string' } }
const writer = { ...project, expectedWriterEpoch: { type: 'integer', minimum: 0 } }
const dimensions = {
  innerDiameterQ: { type: 'integer', minimum: 1 },
  outerDiameterQ: { type: 'integer', minimum: 1 },
  lengthQ: { type: 'integer', minimum: 1 },
}
const revision = { type: ['string', 'null'] }
const stage = {
  ...project,
  change: {
    type: 'object',
    properties: {
      baseRevision: revision,
      expectedDraftRevision: revision,
      idempotencyKey: { type: 'string' },
      operation: {
        type: 'object',
        properties: { type: { enum: ['createSpacerDraft', 'resumeSpacerDraft'] }, taskId: { type: 'string' }, ...dimensions },
        required: ['type'],
        additionalProperties: false,
      },
      sources: {
        type: 'object',
        properties: Object.fromEntries(Object.keys(dimensions).map(key => [key, {
          type: 'object', properties: { type: { const: 'userInput' } }, required: ['type'], additionalProperties: false,
        }])),
        additionalProperties: false,
      },
    },
    required: ['baseRevision', 'expectedDraftRevision', 'idempotencyKey', 'operation', 'sources'],
    additionalProperties: false,
  },
}

function toolsFor(client: LocalM1Client): ToolSpec[] {
  const define = (name: string, description: string, properties: Record<string, unknown>): ToolSpec => ({
    definition: { name, title: name, description,
      inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } },
    async run(args) {
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('INVALID_REQUEST')
      const result = await client.call(name, args)
      if (name !== 'capabilities') return result
      const { protocol, operations, draftOperations } = result
      return { protocol, operations, draftOperations }
    },
  })
  return [
    define('capabilities', '读取本地桥接支持的操作。', {}),
    define('authorizeProject', '按项目 ID 请求用户在寸链桌面确认读取已打开的项目。', project),
    define('getContext', '读取获准项目的草稿、写入状态和外部活动。', project),
    define('getExternalActivities', '读取获准项目的外部活动和草稿修订。', project),
    define('acquireWriter', '请求用户允许写入此项目的草稿。', writer),
    define('takeOverWriter', '请求用户接管此项目的草稿写入。', writer),
    define('readWriterContext', '读取当前写入权限对应的草稿和基准。', project),
    define('stageChange', '创建隔套草稿或补充同一任务缺少的尺寸。尺寸使用 q 整数单位。', stage),
    define('revokeWriter', '释放当前连接持有的写入权限。', project),
    define('moveRightHoleX', '沿 X 轴移动安装板右孔。从 readWriterContext 获取文件基准及安装板草稿修订；deltaQ 每单位为 0.0001 mm。', {
      ...project, baseRevision: { type: 'string' }, expectedDraftRevision: { type: 'string' },
      idempotencyKey: { type: 'string' }, deltaQ: { type: 'integer', not: { const: 0 } },
    }),
  ]
}

export function createLocalBridgeServer(client: LocalM1Client, version: () => Promise<string>) {
  return createStdioServer({
    name: 'cunlian-local',
    version,
    instructions: '打开寸链项目后，按项目 ID 申请读取权限。写入草稿需要在寸链确认。连接中断后重新申请项目权限。',
    tools: () => [
      ...toolsFor(client),
      ...catalog.tools.filter(tool => client.supports(tool.name)).map(tool => ({
        definition: { ...tool, title: tool.name },
        run: (args: unknown) => client.call(tool.name, args),
      })),
    ],
    toolError(error) {
      const code = error instanceof Error ? error.message : ''
      const safe = M1_LOCAL_ERRORS.has(code) || ['DESKTOP_TIMEOUT', 'DESKTOP_DISCONNECTED', 'UNSAFE_ENDPOINT',
        'UNTRUSTED_PEER', 'INCOMPATIBLE_BRIDGE', 'INITIALIZE_REQUIRED', 'BUSY'].includes(code) ? code : 'STEP_FAILED'
      return { code: safe, message: safe, detail: null }
    },
    initialize(params) {
      client.initialize((params as { clientInfo?: { name?: unknown } } | undefined)?.clientInfo?.name)
    },
    async prepareCall(name) {
      if (catalog.tools.some(tool => tool.name === name)) await client.ready()
    },
    async list() {
      await client.ready().catch(() => mcpLog('本地桌面端点未就绪'))
    },
  })
}
