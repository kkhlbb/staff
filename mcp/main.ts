/**
 * MCP stdio 服务器主体：JSON-RPC 2.0 帧 + 五个只读/计算工具。
 *
 * 边界（任务卡 §3）：
 * - 没有写项目/提交/保存的工具，也没有密钥与模型调用；
 * - 不联网；只读本地 PDF / 项目文件，`render_drawing` 只新增导出文件；
 * - stdout 只输出 JSON-RPC 帧，日志一律 stderr（见 lib/log.ts）。
 *
 * 传输按 MCP stdio 约定：一行一个 JSON 对象；请求逐个响应，通知不响应。
 */
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { ToolInputError } from './lib/args'
import { mcpLog } from './lib/log'
import { TOOLS, findTool } from './tools/index'

export const SERVER_NAME = 'cunlian'
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
export const DEFAULT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]
export const INSTRUCTIONS =
  '寸链确定性内核：读任务书、算尺寸链、判条款、出图、读项目。只读与计算，写入必须回桌面端点确认。'

interface JsonRpcRequest {
  jsonrpc?: unknown
  id?: string | number | null
  method?: unknown
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

async function packageVersion(): Promise<string> {
  try {
    const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8')
    const parsed = JSON.parse(raw) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function errorResponse(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

function toolErrorPayload(error: unknown): { code: string; message: string; detail: string | null } {
  if (error instanceof ToolInputError) {
    return { code: error.code, message: error.message, detail: error.detail }
  }
  if (error instanceof Error) {
    return { code: 'TOOL_FAILED', message: error.message, detail: null }
  }
  return { code: 'TOOL_FAILED', message: String(error), detail: null }
}

async function callTool(name: string, arguments_: unknown): Promise<Record<string, unknown>> {
  const tool = findTool(name)
  if (tool === null) {
    throw new ToolInputError(
      'INVALID_ARGUMENTS',
      `未知工具 ${name}；只有 ${TOOLS.map((item) => item.definition.name).join(', ')}`,
    )
  }
  mcpLog(`tools/call ${name}`)
  return tool.run(arguments_)
}

async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const isNotification = request.id === undefined || request.id === null
  const id = isNotification ? null : (request.id as string | number)
  const method = typeof request.method === 'string' ? request.method : ''

  if (isNotification) {
    // notifications/initialized、notifications/cancelled 等：按协议不响应。
    mcpLog(`notification ${method}`)
    return null
  }

  if (method === 'initialize') {
    const params = (request.params ?? {}) as { protocolVersion?: unknown }
    const requested =
      typeof params.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL_VERSION
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(
      requested as (typeof SUPPORTED_PROTOCOL_VERSIONS)[number],
    )
      ? requested
      : DEFAULT_PROTOCOL_VERSION
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: await packageVersion() },
        instructions: INSTRUCTIONS,
      },
    }
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} }
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: TOOLS.map((tool) => ({
          name: tool.definition.name,
          title: tool.definition.title,
          description: tool.definition.description,
          inputSchema: tool.definition.inputSchema,
        })),
      },
    }
  }

  if (method === 'tools/call') {
    const params = (request.params ?? {}) as { name?: unknown; arguments?: unknown }
    if (typeof params.name !== 'string' || params.name.trim() === '') {
      return errorResponse(id, -32602, 'tools/call 缺少 name', params)
    }
    try {
      const result = await callTool(params.name, params.arguments ?? {})
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
          isError: false,
        },
      }
    } catch (error) {
      const payload = toolErrorPayload(error)
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, tool: params.name, error: payload }) }],
          isError: true,
        },
      }
    }
  }

  return errorResponse(id, -32601, `不支持的方法：${method || '(空)'}`)
}

async function handleFrame(raw: string): Promise<string | null> {
  const text = raw.trim()
  if (text === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return JSON.stringify(
      errorResponse(null, -32700, `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`),
    )
  }
  if (Array.isArray(parsed)) {
    const responses: JsonRpcResponse[] = []
    for (const item of parsed) {
      const response = await handleRequest(item as JsonRpcRequest)
      if (response !== null) responses.push(response)
    }
    return responses.length === 0 ? null : JSON.stringify(responses)
  }
  const response = await handleRequest(parsed as JsonRpcRequest)
  return response === null ? null : JSON.stringify(response)
}

export interface ServerIo {
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
}

/** 启动 stdio 服务器；返回的 Promise 在输入流结束后 resolve。 */
export async function startServer(io: ServerIo = { input: process.stdin, output: process.stdout }): Promise<void> {
  const lines = createInterface({ input: io.input, crlfDelay: Infinity })
  for await (const line of lines) {
    if (line.trim() === '') continue
    const frame = await handleFrame(line)
    if (frame !== null) {
      io.output.write(`${frame}\n`)
    }
  }
}

export { handleFrame }
