/**
 * MCP 传输层：用真实子进程 `node mcp/server.mjs` 跑标准 stdio 帧。
 *
 * 覆盖：initialize / tools/list / tools/call / 通知无响应 / 未知方法 / 未知工具 /
 * 坏 JSON / stdout 纯净度（每个字节都是 JSON-RPC 行）。
 */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { describe, expect, it } from 'vitest'

const ROOT = new URL('../../', import.meta.url).pathname

interface Frame {
  jsonrpc?: unknown
  id?: unknown
  result?: unknown
  error?: { code?: number; message?: string }
}

async function runFrames(lines: unknown[]): Promise<{ frames: Frame[]; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ['mcp/server.mjs'], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  const frames: Frame[] = []
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', () => resolve())
  })
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk)
  })
  const reader = createInterface({ input: child.stdout })
  reader.on('line', (line) => {
    stdout += `${line}\n`
    frames.push(JSON.parse(line) as Frame)
  })
  for (const line of lines) {
    child.stdin.write(`${typeof line === 'string' ? line : JSON.stringify(line)}\n`)
  }
  child.stdin.end()
  await done
  return { frames, stdout, stderr }
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'vitest', version: '0' },
  },
}

describe('MCP stdio 协议', () => {
  it('initialize → tools/list → 五个工具；通知不回帧；stdout 只有 JSON-RPC', async () => {
    const { frames, stdout, stderr } = await runFrames([
      initialize,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ])
    expect(stderr).toBe('')
    const lines = stdout.trim().split('\n')
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      const frame = JSON.parse(line) as Frame
      expect(frame.jsonrpc).toBe('2.0')
    }
    const init = frames.find((frame) => frame.id === 1)
    expect(init?.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'cunlian' },
    })
    const list = frames.find((frame) => frame.id === 2)?.result as {
      tools: { name: string; inputSchema: { type: string }; description: string }[]
    }
    expect(list.tools.map((tool) => tool.name)).toEqual([
      'read_taskbook',
      'calc_chain',
      'check_requirement',
      'render_drawing',
      'describe_project',
    ])
    for (const tool of list.tools) {
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.description.length).toBeGreaterThan(10)
    }
  })

  it('tools/call 失败返回 isError；未知方法返回 -32601；坏 JSON 返回 -32700', async () => {
    const { frames } = await runFrames([
      initialize,
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } },
      { jsonrpc: '2.0', id: 4, method: 'resources/list' },
      '{not json',
    ])
    const unknownTool = frames.find((frame) => frame.id === 3)?.result as {
      isError: boolean
      content: { text: string }[]
    }
    expect(unknownTool.isError).toBe(true)
    expect(JSON.parse(unknownTool.content[0].text)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENTS' },
    })
    expect(frames.find((frame) => frame.id === 4)?.error?.code).toBe(-32601)
    const parseError = frames.find((frame) => frame.id === null && frame.error !== undefined)
    expect(parseError?.error?.code).toBe(-32700)
  })

  it('calc_chain / check_requirement 通过真实帧返回结构化结果', async () => {
    const { frames } = await runFrames([
      initialize,
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'calc_chain',
          arguments: {
            parameters: { innerDiameterQ: 200000, outerDiameterQ: 320000, lengthQ: 120500 },
          },
        },
      },
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'check_requirement',
          arguments: { cQ: 1000, cMaxQ: 2000, lowerQ: 1000, upperQ: 3000 },
        },
      },
    ])
    const calc = frames.find((frame) => frame.id === 5)?.result as {
      structuredContent: { result: { minQ: number; maxQ: number }; readOnly: boolean }
    }
    expect(calc.structuredContent.result.minQ).toBe(1000)
    expect(calc.structuredContent.result.maxQ).toBe(2000)
    expect(calc.structuredContent.readOnly).toBe(true)
    const check = frames.find((frame) => frame.id === 6)?.result as {
      structuredContent: { status: string; margins: { marginQ: number } }
    }
    expect(check.structuredContent.status).toBe('satisfied')
    expect(check.structuredContent.margins.marginQ).toBe(0)
  })
})
