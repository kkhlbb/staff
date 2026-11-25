import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parse } from 'smol-toml'
import { afterEach, expect, it, vi } from 'vitest'
import { M1AgentRegistration } from '../main/project-agent/m1AgentRegistration'
import { getLocalAgentInstallInfo } from '../main/project-agent/m1LocalAgent'
import { listM1ModelApiModels } from '../main/project-agent/m1ModelList'

const cleanup: (() => unknown)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})
const guard = () => {}
const nodeInfo = getLocalAgentInstallInfo('/Applications/寸链.app/Contents/MacOS/寸链', '/Applications/寸链.app/Contents/Resources', 'darwin')
const winInfo = getLocalAgentInstallInfo('C:\\Apps\\寸链.exe', 'C:\\Apps\\resources', 'win32')
const agents = ['claude-code', 'codex', 'claude-desktop', 'cursor', 'windsurf'] as const

async function fixture(
  platform: 'darwin' | 'win32',
  runCli: (file: string, args: string[]) => Promise<unknown> = async () => {},
) {
  const home = await mkdtemp(path.join(tmpdir(), 'cunlian-clients-'))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  const appData = path.join(home, 'AppData')
  const bin = path.join(home, 'bin')
  const service = new M1AgentRegistration({ platform, home, env: { PATH: bin, APPDATA: appData }, runCli })
  const put = async (file: string, text: string) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, text, { mode: 0o700 })
  }
  return { home, appData, bin, service, put }
}

it.each(['darwin', 'win32'] as const)('detects and registers five clients on injected %s paths with backups and idempotence', async platform => {
  const f = await fixture(platform)
  const info = platform === 'win32' ? winInfo : nodeInfo
  const initial = (await f.service.detect()).agents
  expect(initial.map(agent => agent.id)).toEqual(agents)
  const configPaths = [
    path.join(f.home, '.claude.json'),
    path.join(f.home, '.codex', 'config.toml'),
    path.join(platform === 'win32' ? f.appData : path.join(f.home, 'Library', 'Application Support'),
      'Claude', 'claude_desktop_config.json'),
    path.join(f.home, '.cursor', 'mcp.json'),
    path.join(f.home, '.codeium', 'windsurf', 'mcp_config.json'),
  ]
  expect(initial.map(agent => agent.configPath)).toEqual(configPaths)
  const expectedServer = JSON.parse(info.mcpConfigJson).mcpServers['cunlian-local']
  for (const [i, agentId] of agents.entries()) {
    const file = configPaths[i]!
    const toml = agentId === 'codex'
    const legacy = toml ? 'large = 9223372036854775807\nfloat = 1.0\n[mcp_servers.old]\ncommand = "existing"\n'
      : '{"settings":{"keep":true},"mcpServers":{"old":{"command":"existing"}}}'
    await f.put(file, legacy)
    const registered = await f.service.register(agentId, info, guard)
    expect(registered).toMatchObject({ agentId, configured: true, method: 'config-file', configPath: file, requiresRestart: true })
    expect(path.dirname(registered.backupPath!)).toBe(path.dirname(file))
    expect(await readFile(registered.backupPath!, 'utf8')).toBe(legacy)
    const content = await readFile(file, 'utf8')
    if (toml) {
      expect(content).toContain('[mcp_servers.cunlian-local]')
      expect(content).toContain('float = 1.0')
      expect(parse(content, { integersAsBigInt: 'asNeeded' })).toMatchObject({
        large: 9223372036854775807n, mcp_servers: { old: { command: 'existing' }, 'cunlian-local': expectedServer },
      })
    } else {
      expect(JSON.parse(content)).toMatchObject({
        settings: { keep: true }, mcpServers: { old: { command: 'existing' }, 'cunlian-local': expectedServer },
      })
    }
    expect(await f.service.register(agentId, info, guard)).toMatchObject({ backupPath: null, requiresRestart: false })
    expect(await readFile(file, 'utf8')).toBe(content)
  }
  expect((await f.service.detect(info)).agents.every(agent => agent.detected && agent.configured)).toBe(true)
  expect((await f.service.detect({ ...info, mcpConfigJson: undefined, bridgeCommand: '/other-install' }))
    .agents.every(agent => agent.detected && !agent.configured)).toBe(true)
})

it.each(['darwin', 'win32'] as const)('detects %s client executables before config exists', async platform => {
  const f = await fixture(platform)
  const win = platform === 'win32'
  await f.put(path.join(f.bin, win ? 'codex.exe' : 'codex'), '')
  const local = path.join(f.home, 'AppData', 'Local')
  if (win) {
    await f.put(path.join(local, 'AnthropicClaude', 'Claude.exe'), '')
    await f.put(path.join(local, 'Programs', 'cursor', 'Cursor.exe'), '')
  } else {
    await mkdir(path.join(f.home, 'Applications', 'Claude.app'), { recursive: true })
    await mkdir(path.join(f.home, 'Applications', 'Cursor.app'), { recursive: true })
  }
  const { agents } = await f.service.detect(win ? winInfo : nodeInfo)
  for (const id of ['codex', 'claude-desktop', 'cursor']) {
    expect(agents.find(agent => agent.id === id)).toMatchObject({ detected: true, configured: false })
  }
})

it('uses the Claude Code CLI when available and falls back to atomic file registration when it fails', async () => {
  const run = vi.fn<(file: string, args: string[]) => Promise<unknown>>()
  const f = await fixture('darwin', run)
  const cli = path.join(f.bin, 'claude')
  const file = path.join(f.home, '.claude.json')
  await f.put(cli, '')
  expect((await f.service.detect(nodeInfo)).agents[0]).toMatchObject({ detected: true, configured: false, method: 'cli' })
  run.mockImplementationOnce(async () => f.put(file, nodeInfo.mcpConfigJson))
  expect(await f.service.register('claude-code', nodeInfo, guard)).toMatchObject({ method: 'cli', backupPath: null })
  expect(run).toHaveBeenCalledWith(cli, ['mcp', 'add', '--scope', 'user', 'cunlian-local', '--', nodeInfo.bridgeCommand])
  expect(await f.service.register('claude-code', nodeInfo, guard)).toMatchObject({ method: 'cli', backupPath: null })
  expect(run).toHaveBeenCalledTimes(1)

  await f.put(file, '{"mcpServers":{"cunlian-local":{"command":"old"}}}')
  run.mockRejectedValueOnce(Error('CLI not available'))
  const result = await f.service.register('claude-code', nodeInfo, guard)
  expect(result).toMatchObject({ method: 'config-file', configured: true })
  expect(await readFile(result.backupPath!, 'utf8')).toContain('"command":"old"')
  expect((await readdir(f.home)).filter(file => file.endsWith('.tmp'))).toEqual([])
})

it.each([
  ['cursor', '.cursor/mcp.json', '{'],
  ['windsurf', '.codeium/windsurf/mcp_config.json', '{"mcpServers":null}'],
  ['codex', '.codex/config.toml', '[mcp_servers\n'],
] as const)('rejects malformed %s configuration before any mutation', async (agentId, relative, raw) => {
  const f = await fixture('darwin')
  const file = path.join(f.home, relative)
  await f.put(file, raw)
  const row = (await f.service.detect(nodeInfo)).agents.find(agent => agent.id === agentId)
  expect(row).toMatchObject({ detected: true, configured: false, detail: expect.any(String) })
  await expect(f.service.register(agentId, nodeInfo, guard)).rejects.toThrow('INVALID_CONFIG_FILE')
  expect(await readFile(file, 'utf8')).toBe(raw)
  expect(await readdir(path.dirname(file))).toEqual([path.basename(file)])
})

const request = { projectId: 'project', scopeEpoch: 1, requestId: 'list', baseUrl: 'https://provider.example/v1', apiKey: 'private-test-key' }
const signal = new AbortController().signal

it('uses HTTPS GET /models with authentication and filters echoed credentials from model IDs', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: [
    { id: request.apiKey }, { id: 'model-one' }, { id: 'model-one' }, { id: 'model-two' },
  ] }))
  expect(await listM1ModelApiModels(request, signal, fetch))
    .toEqual({ models: ['model-one', 'model-two'], defaultModel: 'model-one' })
  expect(fetch).toHaveBeenCalledExactlyOnceWith('https://provider.example/v1/models',
    expect.objectContaining({ headers: { authorization: `Bearer ${request.apiKey}` }, redirect: 'error' }))
  await expect(listM1ModelApiModels({ ...request, apiKey: '' }, signal, fetch)).rejects.toThrow(/^INVALID_API_KEY$/)
  await expect(listM1ModelApiModels({ ...request, baseUrl: 'http://provider.example/v1' }, signal, fetch))
    .rejects.toThrow(/^INVALID_REQUEST$/)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each([401, 403])('sanitizes HTTP %s and network failures', async status => {
  const fetch = vi.fn<typeof globalThis.fetch>()
  fetch.mockResolvedValueOnce(new Response(request.apiKey, { status }))
  fetch.mockRejectedValueOnce(Error(`request with ${request.apiKey} failed`))
  await expect(listM1ModelApiModels(request, signal, fetch)).rejects.toThrow(/^AUTH_FAILED$/)
  await expect(listM1ModelApiModels(request, signal, fetch)).rejects.toThrow(/^DISCONNECTED$/)
})

it('lists through a loopback stub without an authorization header and rejects redirects', async () => {
  const seen: { url?: string; key?: string; method?: string }[] = []
  const server = createServer((req, res) => {
    seen.push({ url: req.url, key: req.headers.authorization, method: req.method })
    if (req.url === '/redirect/models') {
      res.writeHead(302, { location: '/target?secret=' + request.apiKey }).end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'local' }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>(resolve => {
    server.closeAllConnections()
    server.close(() => resolve())
  }))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw Error('No stub address')
  const origin = `http://127.0.0.1:${addr.port}`
  expect(await listM1ModelApiModels({ ...request, baseUrl: origin + '/v1/', apiKey: '' }, signal))
    .toEqual({ models: ['local'], defaultModel: 'local' })
  await expect(listM1ModelApiModels({ ...request, baseUrl: origin + '/redirect' }, signal))
    .rejects.toThrow(/^DISCONNECTED$/)
  expect(seen).toEqual([
    { url: '/v1/models', key: undefined, method: 'GET' },
    { url: '/redirect/models', key: `Bearer ${request.apiKey}`, method: 'GET' },
  ])
})
