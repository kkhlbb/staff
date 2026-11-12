#!/usr/bin/env node
/**
 * MCP stdio 冒烟/证据脚本：用**真实子进程 + 标准 MCP 帧**跑五个工具。
 *
 * 用法：
 *   node scripts/mcp-smoke.mjs [--repeat 3] [--log <path>] [--out <dir>]
 *
 * 输出（stdout）是紧凑摘要：每个工具的 isError、关键字段、响应文本的 SHA-256。
 * `--repeat N` 会把同一批调用在**新进程**里重复 N 次，用于幂等对比；
 * `--log` 保存完整 JSON-RPC 帧（NDJSON），供证据归档。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const root = new URL('..', import.meta.url).pathname
const args = process.argv.slice(2)
function option(name, fallback) {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}
const repeat = Number(option('--repeat', '1'))
const logPath = option('--log', `${root}docs/evidence/mcp-entry/logs/stdio-frames.ndjson`)
const outDir = option('--out', `${root}docs/evidence/mcp-entry/artifacts`)

const calls = [
  {
    name: 'read_taskbook',
    arguments: {
      pdfPath: `${root}docs/evidence/V3.5/fixtures/taskbook-2p.pdf`,
      pageFrom: 1,
      pageTo: 2,
    },
  },
  {
    name: 'calc_chain',
    arguments: {
      parameters: { innerDiameterQ: 200000, outerDiameterQ: 320000, lengthQ: 120000 },
    },
  },
  {
    name: 'check_requirement',
    arguments: { cQ: 500, cMaxQ: 1500, lowerQ: 1000, upperQ: 3000 },
  },
  {
    name: 'render_drawing',
    arguments: {
      parameters: { innerDiameter: '20.00', outerDiameter: '32.00', length: '12.05' },
      format: 'dxf',
      dxfVersion: '2000',
      outputDir: outDir,
    },
  },
  {
    name: 'describe_project',
    arguments: { path: `${root}docs/evidence/v40-stage4/fixtures/a40-1204.cunlian` },
  },
]

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function runOnce(index) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['mcp/server.mjs'], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const frames = []
    const errors = []
    const pending = new Map()
    let expected = 0
    const rl = createInterface({ input: child.stdout })
    rl.on('line', (line) => {
      const frame = JSON.parse(line)
      frames.push({ direction: 'server->client', frame })
      if (frame.id !== undefined && pending.has(frame.id)) {
        const entry = pending.get(frame.id)
        pending.delete(frame.id)
        entry.resolve(frame)
      }
    })
    child.stderr.on('data', (chunk) => errors.push(chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`server exited ${code}: ${errors.join('')}`))
        return
      }
      resolve({ frames, stderr: errors.join('') })
    })
    let nextId = 0
    const request = (method, params) => {
      nextId += 1
      const id = nextId
      expected += 1
      const message = { jsonrpc: '2.0', id, method, params }
      frames.push({ direction: 'client->server', frame: message })
      const promise = new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }))
      child.stdin.write(`${JSON.stringify(message)}\n`)
      return promise
    }

    ;(async () => {
      await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'cunlian-mcp-smoke', version: '1' },
      })
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
      )
      const list = await request('tools/list', {})
      const toolNames = (list.result?.tools ?? []).map((tool) => tool.name)
      const results = []
      for (const call of calls) {
        const response = await request('tools/call', { name: call.name, arguments: call.arguments })
        const structured = response.result?.structuredContent ?? null
        const text = response.result?.content?.[0]?.text ?? ''
        results.push({
          run: index,
          tool: call.name,
          isError: response.result?.isError === true,
          textSha256: sha256(text),
          summary: summaryOf(call.name, structured),
          error: response.result?.isError === true ? JSON.parse(text).error : null,
        })
      }
      child.stdin.end()
      resolve({ frames, stderr: errors.join(''), toolNames, results, expected })
    })().catch(reject)
    void expected
  })
}

function summaryOf(tool, value) {
  if (value === null) return null
  if (tool === 'read_taskbook') {
    return {
      pageCount: value.pageCount,
      pageRange: value.pageRange,
      candidates: value.candidates?.length ?? null,
      blockers: value.blockers?.map((item) => item.code) ?? null,
      firstCandidate: value.candidates?.[0]?.kind ?? null,
    }
  }
  if (tool === 'calc_chain') {
    return {
      mode: value.mode,
      nominalQ: value.result?.nominalQ,
      minQ: value.result?.minQ,
      maxQ: value.result?.maxQ,
      toleranceQ: value.result?.toleranceQ,
    }
  }
  if (tool === 'check_requirement') {
    return { status: value.status, marginQ: value.margins?.marginQ, reasonCodes: value.reasonCodes }
  }
  if (tool === 'render_drawing') {
    return {
      filePath: value.filePath,
      byteSize: value.byteSize,
      sha256: value.sha256,
      unprovenanced: value.unprovenanced,
    }
  }
  if (tool === 'describe_project') {
    return {
      projectId: value.project?.id,
      currentRevisionId: value.formalVersion?.revisionId,
      parameters: value.parameters?.length,
      terms: value.terms?.length,
      requirement: value.requirement?.revisionId ?? null,
      provenance: value.provenance?.total,
    }
  }
  return null
}

const runs = []
for (let index = 1; index <= repeat; index += 1) {
  runs.push(await runOnce(index))
}
mkdirSync(`${root}docs/evidence/mcp-entry/logs`, { recursive: true })
writeFileSync(
  logPath,
  runs
    .flatMap((run) =>
      run.frames.map((item) =>
        JSON.stringify({
          direction: item.direction,
          frame: item.frame,
        }),
      ),
    )
    .join('\n') + '\n',
)
const toolNames = runs[0].toolNames ?? []
const results = runs.flatMap((run) => run.results)
const byTool = new Map()
for (const result of results) {
  if (!byTool.has(result.tool)) byTool.set(result.tool, [])
  byTool.get(result.tool).push(result.textSha256)
}
const idempotent = [...byTool.entries()].map(([tool, hashes]) => ({
  tool,
  runs: hashes.length,
  uniqueTextHashes: [...new Set(hashes)].length,
  byteIdentical: new Set(hashes).size === 1,
}))
process.stdout.write(
  `${JSON.stringify(
    {
      node: process.version,
      runs: repeat,
      toolNames,
      toolCount: toolNames.length,
      anyError: results.some((result) => result.isError),
      idempotency: idempotent,
      results,
    },
    null,
    2,
  )}\n`,
)
if (runs.some((run) => (run.stderr ?? '') !== '')) {
  process.stderr.write(runs.map((run) => run.stderr).join(''))
}
