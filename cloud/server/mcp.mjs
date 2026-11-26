import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { findTool } from '../../mcp/tools/index.ts'
import { tools, validate, HttpError } from './contracts.mjs'
import { gdtTools } from '../../mcp/lib/gdt.ts'
import { compliantTools } from '../../mcp/lib/compliant.ts'
import reportCatalog from '../contracts/mcp-report-tools.json' with { type: 'json' }
import { digest } from './projects.mjs'

const operations = tools.slice(5).map(tool => tool.name)
const protocols = ['2025-06-18', '2025-03-26', '2024-11-05']
const enabled = (principal, tool) => !principal.tools || principal.tools.includes(tool.name)

export function createMcp(projects, config) {
  const available = config.feature3dAssemblyM1 ? [...tools, ...gdtTools, ...compliantTools, ...reportCatalog.tools] : tools
  const streams = new Map()
  const exportRoot = join(config.root, 'mcp-exports')

  async function fileTool(name, args, principal) {
    const path = args.pdfPath ?? args.path
    const match = /^\/api\/v1\/projects\/([a-z0-9-]+)\/(archive|attachments\/([a-z0-9-]+))$/i.exec(path)
    if (!match) throw new HttpError(403, 'INPUT_PATH_FORBIDDEN')
    const state = await projects.read(match[1], principal)
    const attachment = state.attachments[match[3]] ?? state.importedAttachments?.[match[3]]
    const source = name === 'describe_project' && match[2] === 'archive'
      ? state.archive : name === 'read_taskbook' && attachment?.ref.kind === 'pdf'
        ? attachment.bytes : null
    if (!source) throw new HttpError(404, 'INPUT_NOT_FOUND')
    const directory = await mkdtemp(join(tmpdir(), 'cunlian-input-'))
    const target = join(directory, name === 'describe_project' ? 'project.cunlian' : 'taskbook.pdf')
    try {
      await writeFile(target, Buffer.from(source, 'base64'), { mode: 0o600 })
      const result = await findTool(name).run({ ...args, [name === 'describe_project' ? 'path' : 'pdfPath']: target })
      return { ...result, file: { ...result.file, path } }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  async function toolCall(name, args, principal, signal) {
    const spec = available.find(tool => tool.name === name && enabled(principal, tool))
    if (!spec) throw new HttpError(403, 'TOOL_FORBIDDEN')
    validate(args, spec.inputSchema)
    const { projectId, change } = args
    switch (name) {
      case 'capabilities': return { protocol: 1, operations, draftOperations: ['createSpacerDraft', 'resumeSpacerDraft'] }
      case 'read_taskbook':
      case 'describe_project': return fileTool(name, args, principal)
      case 'calc_chain':
      case 'check_requirement': return findTool(name).run(args)
      case 'render_drawing': {
        if (args.outputDir !== '/exports') throw new HttpError(403, 'OUTPUT_PATH_FORBIDDEN')
        const directoryId = randomUUID()
        const root = join(exportRoot, digest(principal.name))
        await mkdir(root, { recursive: true, mode: 0o700 })
        const target = join(root, directoryId)
        try {
          const result = await findTool(name).run({ ...args, outputDir: target })
          signal.throwIfAborted()
          return { ...result, filePath: '/exports/' + directoryId + '/' + result.fileName }
        } catch (error) {
          await rm(target, { recursive: true, force: true })
          throw error
        }
      }
      case 'authorizeProject': return projects.authorize(projectId, principal, signal)
      case 'acquireWriter': return projects.lease(projectId, 'acquire', args, principal, signal)
      case 'takeOverWriter': return projects.lease(projectId, 'takeover', args, principal, signal)
      case 'revokeWriter': return projects.lease(projectId, 'revoke', args, principal, signal)
      case 'stage_datum':
      case 'stage_gdt': return projects.stageGdt(name, args, principal, signal)
      case 'analyze_gdt_stackup': return projects.analyzeGdt(args, principal, signal)
      case 'stage_physics': return projects.stagePhysics(args, principal, signal)
      case 'import_mic_matrix': return projects.importMicMatrix(args, principal, signal)
      case 'analyze_compliant_stackup': return projects.analyzeCompliant(args, principal, signal)
      case 'export_simulation_report': return projects.exportReport(args, principal, signal)
      case 'stageChange': return projects.stage(projectId, change, principal, signal)
      case 'moveRightHoleX': return projects.move(projectId, args, principal, signal)
      default: {
        const state = await projects.read(projectId, principal)
        const context = projects.context(state)
        if (name === 'readWriterContext') return context
        const activities = projects.activities(state)
        if (name === 'getExternalActivities') return { draftRevision: state.draftRevision, activities }
        const { baseRevision, mountingPlateDraftRevision: _revision, ...snapshot } = context
        return { baseRevision, activities, snapshot: { ...snapshot, projectId, connection: 'connected',
          authorization: { authorized: true, canWrite: principal.write === true && projects.holder(state) === principal.name },
          writer: { epoch: state.epoch, occupied: Boolean(projects.holder(state)) },
        } }
      }
    }
  }

  const sse = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' }
  const frame = (res, value) => res.write('event: message\ndata: ' + JSON.stringify(value) + '\n\n')

  return {
    exportFile(path, principal) {
      const match = /^\/exports\/([a-f0-9-]{36})\/([a-zA-Z0-9._-]+)$/.exec(path)
      if (!match || ['.', '..'].includes(match[2])) throw new HttpError(404, 'NOT_FOUND')
      return join(exportRoot, digest(principal.name), match[1], basename(match[2]))
    },
    async handle(req, res, url, principal, signal, readJson, json) {
      const version = req.headers['mcp-protocol-version']
      if (version && !protocols.includes(version)) throw new HttpError(400, 'UNSUPPORTED_PROTOCOL')
      if (req.method === 'GET' && url.pathname !== '/messages') {
        if (!req.headers.accept?.includes('text/event-stream')) throw new HttpError(406, 'SSE_REQUIRED')
        if (streams.size >= 64) throw new HttpError(503, 'MCP_STREAM_LIMIT')
        res.writeHead(200, sse)
        const session = randomUUID()
        streams.set(session, { owner: principal.name, res })
        res.write(url.pathname === '/sse' ? 'event: endpoint\ndata: /messages?sessionId=' + session + '\n\n' : ': connected\n\n')
        const keepalive = setInterval(() => res.write(': keepalive\n\n'), 15000)
        const lifetime = setTimeout(() => res.end(), 15 * 60 * 1000)
        res.once('close', () => {
          clearInterval(keepalive)
          clearTimeout(lifetime)
          streams.delete(session)
        })
        return
      }
      if (req.method !== 'POST' || url.pathname === '/sse') throw new HttpError(405, 'METHOD_NOT_ALLOWED')
      const legacy = url.pathname === '/messages'
      const stream = legacy ? streams.get(url.searchParams.get('sessionId')) : undefined
      if (legacy && (!stream || stream.owner !== principal.name)) throw new HttpError(404, 'SESSION_NOT_FOUND')
      const accepts = req.headers.accept ?? ''
      const wantsSse = accepts.includes('text/event-stream')
      if (!legacy && !wantsSse && !accepts.includes('application/json') && !accepts.includes('*/*')) {
        throw new HttpError(406, 'MCP_ACCEPT_REQUIRED')
      }
      let message
      const reply = (value, status = 200) => {
        const payload = { jsonrpc: '2.0', id: message?.id ?? null, ...value }
        if (legacy) {
          frame(stream.res, payload)
          res.writeHead(202).end()
        } else if (wantsSse && status === 200) {
          res.writeHead(200, sse)
          frame(res, payload)
          res.end()
        } else json(res, status, payload)
      }
      try { message = await readJson(req, signal) } catch (error) {
        if (error.status !== 400) throw error
        return reply({ error: { code: -32700, message: 'Parse error' } }, 400)
      }
      if (!message || message.jsonrpc !== '2.0' || (message.id !== undefined && typeof message.id !== 'string' && !Number.isFinite(message.id))) {
        return reply({ error: { code: -32600, message: 'Invalid Request' } }, 400)
      }
      if (message.method === undefined && message.id !== undefined
        && (Object.hasOwn(message, 'result') !== Object.hasOwn(message, 'error'))) {
        return res.writeHead(202).end()
      }
      if (typeof message.method !== 'string') return reply({ error: { code: -32600, message: 'Invalid Request' } }, 400)
      if (message.id === undefined) return res.writeHead(202).end()
      switch (message.method) {
        case 'initialize':
          return reply({ result: {
            protocolVersion: protocols.includes(message.params?.protocolVersion) ? message.params.protocolVersion : protocols[0],
            capabilities: { tools: {} }, serverInfo: { name: 'cunlian-cloud', version: '1.0.0' },
          } })
        case 'ping': return reply({ result: {} })
        case 'tools/list': return reply({ result: { tools: available.filter(tool => enabled(principal, tool)) } })
        case 'tools/call': {
          try {
            const result = await toolCall(message.params?.name, message.params?.arguments ?? {}, principal, signal)
            return reply({ result: { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result } })
          } catch (error) {
            if (signal.aborted) throw signal.reason
            return reply({ result: { isError: true, content: [{ type: 'text',
              text: JSON.stringify({ code: error.code ?? 'TOOL_FAILED', message: error.status || error.name === 'ToolInputError' ? error.message : 'Tool failed' }),
            }] } })
          }
        }
        default: return reply({ error: { code: -32601, message: 'Method not found' } })
      }
    },
  }
}
