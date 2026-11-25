/**
 * MCP 传输层：用真实子进程 `node mcp/server.mjs` 跑标准 stdio 帧。
 *
 * 覆盖：initialize / tools/list / tools/call / 通知无响应 / 未知方法 / 未知工具 /
 * 坏 JSON / stdout 纯净度（每个字节都是 JSON-RPC 行）。
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { fixture, face, model, part, pose } from '../../src/core/solver/test/fixture'
import { createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile'
import { encodeProjectFile } from '../../src/project-file/codec'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

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
  it('initialize → tools/list → 六个工具；通知不回帧；stdout 只有 JSON-RPC', async () => {
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
      'analyze_assembly_3d',
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

  it('五个旧工具都可通过原 stdio 命令调用并返回兼容数据', async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'cunlian-stdio-'))
    try {
      const calls = {
        read_taskbook: { pdfPath: path.join(ROOT, 'docs/evidence/V3.5/fixtures/taskbook-2p.pdf'), pageFrom: 1, pageTo: 2 },
        calc_chain: { parameters: { innerDiameterQ: 200000, outerDiameterQ: 320000, lengthQ: 120000 } },
        check_requirement: { cQ: 1500, lowerQ: 1000, upperQ: 3000 },
        render_drawing: { parameters: { innerDiameter: '20.00', outerDiameter: '32.00', length: '12.00' },
          format: 'svg', outputDir },
        describe_project: { path: path.join(ROOT, 'docs/evidence/v40-stage4/fixtures/a40-1204.cunlian') },
      }
      const { frames } = await runFrames([initialize, ...Object.entries(calls).map(([name, args], index) => ({
        jsonrpc: '2.0', id: index + 2, method: 'tools/call', params: { name, arguments: args },
      }))])
      const results = frames.slice(1).map(frame => {
        const result = frame.result as { isError: boolean; content: { text: string }[]; structuredContent: Record<string, unknown> }
        expect(result.isError).toBe(false)
        expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent)
        expect(result.structuredContent.readOnly).toBe(true)
        return result.structuredContent
      })
      expect(results).toHaveLength(5)
      expect(results[0]).toMatchObject({ pageCount: 2 })
      expect(results[1]).toMatchObject({ result: { minQ: expect.any(Number) } })
      expect(results[2]).toMatchObject({ status: 'satisfied' })
      expect((await stat(results[3].filePath as string)).size).toBe(results[3].byteSize)
      expect(results[4]).toMatchObject({ project: { id: 'project-a' } })
    } finally {
      await rm(outputDir, { recursive: true, force: true })
    }
  })

  it('solves, simulates and returns review-only mate drafts over real stdio', async () => {
    const input = fixture()
    const assembly = model([part('a'), part('b')], [
      face('a-face', 'a', [0, 0, 0], [0, 0, 1]), face('b-face', 'b', [0, 0, 0], [0, 0, -1]),
    ])
    const { frames } = await runFrames([initialize, ...[
      { operation: 'solve', assembly: input.assembly },
      { operation: 'simulate', ...input, samples: 10_000 },
      { operation: 'suggest-mates', assembly, candidates: { coplanar: [['b-face', 'a-face']], coaxial: [] } },
      { operation: 'solve', assembly, path: '/unused.cunlian' },
    ].map((args, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call',
      params: { name: 'analyze_assembly_3d', arguments: args } }))])
    const [solve, simulate, suggest, invalid] = [2, 3, 4, 5].map(id => frames.find(frame => frame.id === id)?.result)
    expect(solve).toMatchObject({ isError: false, structuredContent: { readOnly: true, result: {
      status: 'underconstrained', parts: expect.arrayContaining([{ partId: 'cover', nominalTransform: expect.any(Array) }]),
    } } })
    expect(simulate).toMatchObject({ isError: false, structuredContent: { result: { samples: 10_000,
      measurements: expect.arrayContaining([expect.objectContaining({ measurementId: 'gap', kind: 'gap' })]),
    } } })
    expect(suggest).toMatchObject({ isError: false, structuredContent: { readOnly: true, requiresConfirmation: true,
      drafts: [{ status: 'draft', mate: { kind: 'face-contact', featureIds: ['a-face', 'b-face'] },
        topologyEvidenceRefs: [{ featureId: 'a-face', partId: 'a' }, { featureId: 'b-face', partId: 'b' }] }],
    } })
    expect(invalid).toMatchObject({ isError: true })
  })

  it('loads a Schema 11 assembly from a real project path without persisting drafts', async () => {
    const snapshot = await createSampleSnapshot()
    const plate = (id: string) => ({ id, displayName: id, color: '#808080', nominalTransform: pose(),
      kind: 'parametric-primitive' as const, baseKind: 'plate' as const,
      sizeQ: { lengthQ: 30000, widthQ: 40000, thicknessQ: 50000 }, modifiers: [] })
    const assembly3d = model([plate('a'), plate('b')], [
      face('a-face', 'a', [0, 0, 0], [0, 0, 1]), face('b-face', 'b', [0, 0, 0], [0, 0, -1]),
    ])
    const encoded = await encodeProjectFile({ ...snapshot, project: { ...snapshot.project, assembly3d } })
    if (!encoded.ok) throw Error(JSON.stringify(encoded.error))
    const directory = await mkdtemp(path.join(tmpdir(), 'cunlian-3d-'))
    try {
      const project = path.join(directory, 'assembly.cunlian')
      await writeFile(project, encoded.value.bytes)
      const { frames } = await runFrames([initialize, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
        name: 'analyze_assembly_3d', arguments: { operation: 'suggest-mates', path: project },
      } }])
      expect(frames.find(frame => frame.id === 2)?.result).toMatchObject({ isError: false, structuredContent: {
        readOnly: true, requiresConfirmation: true, drafts: [{ mate: { kind: 'face-contact' } }],
      } })
      expect(await readFile(project)).toEqual(Buffer.from(encoded.value.bytes))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
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
