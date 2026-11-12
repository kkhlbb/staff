// @vitest-environment node
/**
 * V4.0 阶段 4：OpenAI 兼容适配器契约测试（本地桩服务器，不联网、不读真实密钥）。
 *
 * 覆盖：SSE 结构流、tool_calls 配对、usage、超时、取消、网络层重试、4xx 不重试、
 * 错误码映射，以及“密钥不出现在请求体/事件/错误消息”的零泄漏断言。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { ModelEvent, ModelRequest } from '../../src/agent/types'
import { ModelAdapterError } from '../main/modelAdapter'
import { OpenAICompatibleAdapter, toWireMessages } from '../main/openaiCompatibleAdapter'

const SECRET = 'sk-test-DO-NOT-LEAK-9f8e7d6c5b4a'

interface Stub {
  server: Server
  url: string
  requests: { body: string; authorization: string | null; path: string }[]
  close: () => Promise<void>
}

const running: Stub[] = []
afterEach(async () => {
  for (const stub of running.splice(0)) await stub.close()
})

async function stub(handler: (req: IncomingMessage, res: ServerResponse, body: string, index: number) => void | Promise<void>): Promise<Stub> {
  const requests: Stub['requests'] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk.toString() })
    req.on('end', () => {
      requests.push({ body, authorization: (req.headers.authorization as string | undefined) ?? null, path: req.url ?? '' })
      void handler(req, res, body, requests.length - 1)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const item: Stub = {
    server,
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
  running.push(item)
  return item
}

function sse(res: ServerResponse, chunks: unknown[]): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  for (const chunk of chunks) res.write(`data: ${typeof chunk === 'string' ? chunk : JSON.stringify(chunk)}\n\n`)
  res.end('data: [DONE]\n\n')
}

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    taskId: 'task-1234-abcd',
    systemPrompt: '系统提示',
    messages: [{ role: 'user', content: '把长度改为 12.04 mm' }],
    tools: [{ name: 'stage', description: '改参数', parameters: { type: 'object', properties: {} } }],
    budget: { maxToolCalls: 20, maxConsecutiveSameFailure: 2, requestTimeoutMs: 5_000 },
    ...overrides,
  }
}

function adapter(url: string, extra: { timeoutMs?: number; maxRetries?: number; key?: string | null } = {}): OpenAICompatibleAdapter {
  return new OpenAICompatibleAdapter({
    getApiKey: async () => (extra.key === undefined ? SECRET : extra.key),
    settings: {
      baseUrl: url,
      model: 'deepseek-chat',
      ...(extra.timeoutMs === undefined ? {} : { timeoutMs: extra.timeoutMs }),
      ...(extra.maxRetries === undefined ? {} : { maxRetries: extra.maxRetries }),
    },
    sleep: async () => { /* 测试里跳过退避 */ },
  })
}

describe('V4.0 阶段4：OpenAI 兼容适配器', () => {
  it('SSE 流式返回文本与 tool_calls，并上报 usage；请求体只带 tools、不带密钥', async () => {
    const item = await stub((_req, res) => sse(res, [
      { model: 'deepseek-chat', choices: [{ delta: { content: '先改' } }] },
      { choices: [{ delta: { content: '长度。' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_abc', type: 'function', function: { name: 'stage', arguments: '{"parameter":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"length"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      { choices: [], usage: null },
      { choices: [], usage: { prompt_tokens: 120, completion_tokens: 18, total_tokens: 138 } },
    ]))
    const events: ModelEvent[] = []
    const reply = await adapter(item.url).streamEvents(request(), (event) => events.push(event))
    expect(reply.text).toBe('先改长度。')
    expect(reply.toolCalls).toEqual([{ id: 'call_abc', name: 'stage', argumentsJson: '{"parameter":"length"}' }])
    expect(reply.usage).toEqual({ promptTokens: 120, completionTokens: 18, totalTokens: 138 })
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['token', 'tool_call_start', 'tool_call_args_done', 'done']))

    const sent = JSON.parse(item.requests[0]!.body) as Record<string, unknown>
    expect(sent.model).toBe('deepseek-chat')
    expect(sent.stream).toBe(true)
    expect(Array.isArray(sent.tools)).toBe(true)
    expect(JSON.stringify(sent)).not.toContain(SECRET)
    expect(item.requests[0]!.authorization).toBe(`Bearer ${SECRET}`)
    expect(item.requests[0]!.path).toBe('/v1/chat/completions')
    expect(JSON.stringify(events)).not.toContain(SECRET)
  })

  it('非流式 JSON 回执同样解析 content/tool_calls', async () => {
    const item = await stub((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        model: 'deepseek-chat',
        choices: [{ message: { content: '完成', tool_calls: [{ id: 'call_x', type: 'function', function: { name: 'preview', arguments: '{}' } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }))
    })
    const events: ModelEvent[] = []
    const reply = await adapter(item.url).streamEvents(request(), (event) => events.push(event))
    expect(reply.text).toBe('完成')
    expect(reply.toolCalls[0]).toMatchObject({ id: 'call_x', name: 'preview' })
    expect(reply.usage?.totalTokens).toBe(15)
    expect(events.some((event) => event.type === 'done')).toBe(true)
  })

  it('401 映射为连接/认证错误，消息不含密钥且不重试', async () => {
    const item = await stub((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `invalid key ${SECRET}` } }))
    })
    const events: ModelEvent[] = []
    const error = await adapter(item.url).streamEvents(request(), (event) => events.push(event)).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ModelAdapterError)
    expect((error as ModelAdapterError).code).toBe('CONNECTION_FAILED')
    expect((error as ModelAdapterError).message).not.toContain(SECRET)
    expect((error as ModelAdapterError).message).toContain('<redacted>')
    expect(item.requests).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain(SECRET)
  })

  it('5xx 是网络层可重试错误：两次 500 后成功', async () => {
    const item = await stub((_req, res, _body, index) => {
      if (index < 2) {
        res.writeHead(503, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'overloaded' } }))
        return
      }
      sse(res, [{ choices: [{ delta: { content: 'OK' } }] }])
    })
    const reply = await adapter(item.url, { maxRetries: 2 }).streamEvents(request(), () => { /* 收集见其他用例 */ })
    expect(reply.text).toBe('OK')
    expect(item.requests).toHaveLength(3)
  })

  it('4xx 参数错误映射为 INVALID_INPUT 且不重试', async () => {
    const item = await stub((_req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'bad request' } }))
    })
    const error = await adapter(item.url, { maxRetries: 3 }).streamEvents(request(), () => { /* 无事件断言 */ }).catch((caught: unknown) => caught)
    expect((error as ModelAdapterError).code).toBe('INVALID_INPUT')
    expect(item.requests).toHaveLength(1)
  })

  it('连接失败按 maxRetries 重试后抛 CONNECTION_FAILED', async () => {
    const item = await stub(() => { /* 关闭前不响应 */ })
    await item.close()
    running.splice(running.indexOf(item), 1)
    const error = await adapter(item.url, { maxRetries: 2 }).streamEvents(request(), () => { /* 无 */ }).catch((caught: unknown) => caught)
    expect((error as ModelAdapterError).code).toBe('CONNECTION_FAILED')
  })

  it('超时抛 TIMEOUT，并在消息里报告毫秒上限', async () => {
    let pending: ServerResponse | null = null
    const item = await stub((_req, res) => { pending = res })
    const error = await adapter(item.url, { timeoutMs: 120, maxRetries: 0 }).streamEvents(request(), () => { /* 无 */ }).catch((caught: unknown) => caught)
    expect((error as ModelAdapterError).code).toBe('TIMEOUT')
    expect((error as ModelAdapterError).message).toContain('120')
    if (pending !== null) (pending as ServerResponse).end()
  })

  it('取消在途请求抛 CANCELLED，不再重试', async () => {
    const item = await stub((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '慢' } }] })}\n\n`)
      // 保持连接，等待取消。
    })
    const instance = adapter(item.url, { timeoutMs: 10_000 })
    const taskId = 'task-cancel-1'
    const error = await instance.streamEvents(request({ taskId }), (event) => {
      if (event.type === 'token') instance.cancel(taskId)
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ModelAdapterError)
    expect((error as ModelAdapterError).code).toBe('CANCELLED')
  })

  it('未配置密钥时不发请求，直接 CONNECTION_FAILED', async () => {
    const item = await stub(() => { /* 不应被调用 */ })
    const error = await adapter(item.url, { key: null }).streamEvents(request(), () => { /* 无 */ }).catch((caught: unknown) => caught)
    expect((error as ModelAdapterError).code).toBe('CONNECTION_FAILED')
    expect(item.requests).toHaveLength(0)
  })

  it('toWireMessages 把 assistant/tool 轮映射为 Openai 兼容结构', () => {
    const wire = toWireMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'stage', argumentsJson: '{"a":1}' }] },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'call_1', name: 'stage' },
    ])
    expect(wire[1]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'stage', arguments: '{"a":1}' } }],
    })
    expect(wire[2]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' })
  })

  it('连接测试只发合成文本：无 tools、无项目资料', async () => {
    const item = await stub((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ model: 'deepseek-chat', choices: [{ message: { content: 'OK' } }] }))
    })
    const result = await adapter(item.url).testConnection()
    expect(result).toMatchObject({ ok: true, model: 'deepseek-chat' })
    const sent = JSON.parse(item.requests[0]!.body) as Record<string, unknown>
    expect(sent.tools).toBeUndefined()
    expect(JSON.stringify(sent)).toContain('连接测试')
    expect(JSON.stringify(sent)).not.toContain(SECRET)
  })
})
