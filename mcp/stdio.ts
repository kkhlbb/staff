import { createInterface } from 'node:readline'
import { ToolInputError } from './lib/args'
import { mcpLog } from './lib/log'
import type { ToolSpec } from './tools/index'

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
export const DEFAULT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]

interface ServerOptions {
  name: string
  version(): Promise<string>
  instructions: string
  tools: readonly ToolSpec[] | (() => readonly ToolSpec[])
  initialize?(params: unknown): void
  list?(): Promise<void>
  prepareCall?(name: string): Promise<void>
  toolError?(error: unknown): ReturnType<typeof toolErrorPayload>
}

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

function availableTools(options: ServerOptions) {
  return typeof options.tools === 'function' ? options.tools() : options.tools
}

async function callTool(options: ServerOptions, name: string, arguments_: unknown): Promise<Record<string, unknown>> {
  await options.prepareCall?.(name)
  const tool = availableTools(options).find(candidate => candidate.definition.name === name)
  if (tool === undefined) {
    throw new ToolInputError(
      'INVALID_ARGUMENTS',
      `未知工具 ${name}；只有 ${availableTools(options).map((item) => item.definition.name).join(', ')}`,
    )
  }
  mcpLog(`tools/call ${name}`)
  return tool.run(arguments_)
}

async function handleRequest(options: ServerOptions, request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    return errorResponse(null, -32600, '无效 JSON-RPC 请求')
  }
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
    try {
      options.initialize?.(request.params)
    } catch (error) {
      return errorResponse(id, -32602, error instanceof Error ? error.message : 'INVALID_REQUEST')
    }
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: options.name, version: await options.version() },
        instructions: options.instructions,
      },
    }
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} }
  }

  if (method === 'tools/list') {
    await options.list?.()
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: availableTools(options).map((tool) => ({
          name: tool.definition.name,
          title: tool.definition.title,
          description: tool.definition.description,
          inputSchema: tool.definition.inputSchema,
          ...(tool.definition.outputSchema && { outputSchema: tool.definition.outputSchema }),
          ...(tool.definition.annotations && { annotations: tool.definition.annotations }),
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
      const result = await callTool(options, params.name, params.arguments ?? {})
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
      const payload = (options.toolError ?? toolErrorPayload)(error)
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

async function handleFrame(options: ServerOptions, raw: string): Promise<string | null> {
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
      const response = await handleRequest(options, item as JsonRpcRequest)
      if (response !== null) responses.push(response)
    }
    return responses.length === 0 ? null : JSON.stringify(responses)
  }
  const response = await handleRequest(options, parsed as JsonRpcRequest)
  return response === null ? null : JSON.stringify(response)
}

export interface ServerIo {
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
}

/** 启动 stdio 服务器；返回的 Promise 在输入流结束后 resolve。 */
async function startServer(options: ServerOptions, io: ServerIo = { input: process.stdin, output: process.stdout }): Promise<void> {
  const lines = createInterface({ input: io.input, crlfDelay: Infinity })
  for await (const line of lines) {
    if (line.trim() === '') continue
    const frame = await handleFrame(options, line)
    if (frame !== null) {
      io.output.write(`${frame}\n`)
    }
  }
}

export function createStdioServer(options: ServerOptions) {
  return {
    handleFrame: (raw: string) => handleFrame(options, raw),
    startServer: (io?: ServerIo) => startServer(options, io),
  }
}
