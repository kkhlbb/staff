import '../../mcp/register-ts.mjs'
import { createServer } from 'node:http'
import { readFile, realpath } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { configFrom } from './config.mjs'
import { routes, validate, HttpError } from './contracts.mjs'
import { createEngine } from './engine.mjs'
import { createMcp } from './mcp.mjs'
import { createProjects, equal } from './projects.mjs'
import { binary, createRest } from './rest.mjs'
import { VolumeStorageAdapter } from './storage.mjs'
import { startWebhooks } from './webhooks.mjs'

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(payload))
}

async function read(req, limit, signal) {
  const chunks = []
  let size = 0
  if (Number(req.headers['content-length']) > limit) throw new HttpError(413, 'BODY_TOO_LARGE')
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    signal.throwIfAborted()
    size += chunk.length
    if (size > limit) throw new HttpError(413, 'BODY_TOO_LARGE')
    chunks.push(chunk)
  }
  signal.throwIfAborted()
  return Buffer.concat(chunks)
}

async function readJson(req, signal, optional = false) {
  const bytes = await read(req, 1024 * 1024, signal)
  if (!bytes.length && optional) return {}
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'JSON_REQUIRED')
  }
  try { return JSON.parse(bytes) } catch { throw new HttpError(400, 'INVALID_JSON') }
}

async function multipart(req, limit, signal) {
  const type = req.headers['content-type']
  if (!/^multipart\/form-data;/i.test(type ?? '')) throw new HttpError(415, 'MULTIPART_REQUIRED')
  const bytes = await read(req, limit, signal)
  let parts
  try { parts = await new Response(bytes, { headers: { 'content-type': type } }).formData() } catch {
    throw new HttpError(400, 'INVALID_MULTIPART')
  }
  const values = Object.create(null)
  for (const [key, value] of parts) {
    if (Object.hasOwn(values, key)) throw new HttpError(400, 'DUPLICATE_MULTIPART_FIELD')
    values[key] = typeof value === 'string' ? value : Buffer.from(await value.arrayBuffer())
  }
  return values
}

function authenticate(req, config) {
  const authorization = req.headers.authorization
  const apiKey = req.headers['x-api-key']
  const bearer = /^Bearer ([^\s,]+)$/i.exec(authorization ?? '')?.[1]
  if ((authorization && !bearer) || (bearer && apiKey && !equal(bearer, apiKey))) {
    throw new HttpError(401, 'UNAUTHORIZED')
  }
  const identity = config.principals.find(principal => equal(principal.key, bearer ?? apiKey))
  if (!identity) throw new HttpError(401, 'UNAUTHORIZED')
  return identity
}

function origin(req, config) {
  const peer = req.socket.remoteAddress
  const trusted = config.proxies.has(peer)
  const scheme = trusted && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
  const expected = config.origin ?? (scheme + '://' + req.headers.host)
  if (req.headers.origin && req.headers.origin !== expected) throw new HttpError(403, 'ORIGIN_FORBIDDEN')
  return trusted ? req.headers['x-real-ip'] ?? peer : peer
}

function parameters(route, url) {
  const captures = route.pattern.exec(url.pathname).slice(1)
  const params = Object.create(null)
  const query = Object.create(null)
  try { route.keys.forEach((key, index) => { params[key] = decodeURIComponent(captures[index]) }) } catch {
    throw new HttpError(400, 'INVALID_PATH')
  }
  for (const { name, in: location, schema, required } of route.operation.parameters ?? []) {
    if (location === 'path') validate(params[name], schema)
    else if (location === 'query') {
      const values = url.searchParams.getAll(name)
      if (!values.length && !required) continue
      if (values.length !== 1 || (schema.type === 'integer' && !/^\d+$/.test(values[0]))) throw new HttpError(400, 'INVALID_QUERY')
      query[name] = validate(schema.type === 'integer' ? Number(values[0]) : values[0], schema)
    }
  }
  return { params, query }
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.wasm': 'application/wasm', '.woff2': 'font/woff2' }

async function staticFile(path, config) {
  const root = await realpath(config.web)
  const target = path === '/' || /^\/review\/[^/]+\/[^/]+\/?$/.test(path) ? '/index.html' : path
  try {
    const file = await realpath(resolve(root, '.' + decodeURIComponent(target)))
    if (!file.startsWith(root + sep)) throw new HttpError(404, 'NOT_FOUND')
    return binary(await readFile(file), mime[extname(file)] ?? 'application/octet-stream')
  } catch (error) {
    if (error instanceof URIError || ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) throw new HttpError(404, 'NOT_FOUND')
    throw error
  }
}

export async function createCloudServer(
  config = configFrom(),
  log = row => console.log(JSON.stringify(row)),
  storage = new VolumeStorageAdapter(config.root),
) {
  await storage.init()
  const engine = createEngine(config.timeoutMs)
  try {
    const probe = await engine.plate({ projectId: 'health-probe', draftRevision: 'health-probe' }, AbortSignal.timeout(config.timeoutMs))
    if (!probe.mesh) throw Error('Geometry startup probe failed')
  } catch (error) {
    await engine.close()
    throw error
  }
  const projects = createProjects(storage, engine, config)
  const rest = createRest(projects, engine, config)
  const mcp = createMcp(projects, config)
  const stopHooks = startWebhooks(storage, config, log)
  const server = createServer({ requestTimeout: config.timeoutMs, headersTimeout: Math.min(10000, config.timeoutMs) }, async (req, res) => {
    const started = performance.now()
    const requestId = randomUUID()
    const controller = new AbortController()
    const signal = controller.signal
    let routeLabel = 'static'
    let actor
    let projectId
    let client
    let failure
    const timer = setTimeout(() => {
      controller.abort(new HttpError(504, 'REQUEST_TIMEOUT'))
      if (!res.headersSent && !res.destroyed) {
        failure = 'REQUEST_TIMEOUT'
        res.setHeader('connection', 'close')
        json(res, 504, { ok: false, error: { code: failure, message: failure } })
      }
    }, config.timeoutMs)
    res.once('close', () => {
      clearTimeout(timer)
      controller.abort(new HttpError(499, 'CLIENT_CLOSED'))
      log({ type: 'request', requestId, method: req.method, route: routeLabel, actor, projectId, client,
        status: res.writableFinished ? res.statusCode : 499, error: failure, elapsedMs: Math.round(performance.now() - started) })
    })
    res.setHeader('x-request-id', requestId)
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('cache-control', 'no-store')
    try {
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw new HttpError(400, 'INVALID_PATH')
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/healthz' && req.method === 'GET') {
        routeLabel = '/healthz'
        return json(res, 200, { status: 'ok' })
      }
      client = origin(req, config)
      const route = routes.find(item => item.method === req.method.toLowerCase() && item.pattern.test(url.pathname))
      const protectedPath = /^\/(api|mcp|sse|messages|exports)(\/|$)/.test(url.pathname)
      const principal = protectedPath ? authenticate(req, config) : null
      actor = principal?.name
      let output
      if (['/mcp', '/sse', '/messages'].includes(url.pathname)) {
        routeLabel = url.pathname
        await mcp.handle(req, res, url, principal, signal, readJson, json)
        if (res.headersSent) clearTimeout(timer)
        return
      }
      if (route && principal) {
        routeLabel = route.path
        const { params, query } = parameters(route, url)
        projectId = params.projectId
        const content = route.operation.requestBody?.content
        let body
        if (content) {
          const schema = (content['application/json'] ?? content['multipart/form-data']).schema
          body = validate(content['application/json'] ? await readJson(req, signal, route.path.endsWith('/geometry'))
            : await multipart(req, config.maxUpload, signal), schema)
        }
        output = await rest({ route, params, query, body, principal, signal, req, res })
        signal.throwIfAborted()
        if (!(output?.bytes && output?.headers)) {
          const status = route.operation.responses['201'] ? 201 : 200
          return json(res, status, { ok: true, value: output })
        }
      } else if (url.pathname.startsWith('/exports/') && req.method === 'GET') {
        routeLabel = '/exports/{id}/{file}'
        const file = mcp.exportFile(url.pathname, principal)
        output = binary(await readFile(file), file.endsWith('.svg') ? 'image/svg+xml' : 'application/dxf')
      } else {
        if (protectedPath || !['GET', 'HEAD'].includes(req.method)) throw new HttpError(404, 'NOT_FOUND')
        output = await staticFile(url.pathname, config)
      }
      signal.throwIfAborted()
      res.writeHead(200, output.headers).end(req.method === 'HEAD' ? undefined : output.bytes)
    } catch (error) {
      if (res.writableEnded || res.destroyed) return
      const problem = signal.aborted ? signal.reason : error
      const status = problem.status ?? (problem.code === 'ENOENT' ? 404 : 500)
      failure = problem.status ? problem.code : status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR'
      if (status === 500) log({ type: 'internal_error', requestId, code: problem.code ?? problem.name })
      if (status === 401) res.setHeader('www-authenticate', 'Bearer')
      if (status === 413) res.setHeader('connection', 'close')
      json(res, status, { ok: false, error: { code: failure, message: problem.status ? problem.message : failure } })
    }
  })
  return {
    server, storage,
    async close() {
      stopHooks()
      if (server.listening) {
        const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        server.closeAllConnections()
        await closed
      }
      await engine.close()
    },
  }
}

export async function main() {
  if (!process.argv[1] || new URL('./index.mjs', import.meta.url).href !== pathToFileURL(resolve(process.argv[1])).href) return
  const config = configFrom()
  const service = await createCloudServer(config)
  service.server.listen(config.port, config.host, () => console.log(JSON.stringify({ type: 'listening', port: config.port })))
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void service.close())
}
