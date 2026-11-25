import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, lstat, mkdir, open, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { isDeepStrictEqual, promisify } from 'node:util'
import { parse, stringify } from 'smol-toml'
import type {
  M1LocalAgentDetection, M1LocalAgentId, M1LocalAgentInstallInfo, M1LocalAgentRegistration,
} from '../../shared/project-agent/m1-workbench'

const serverName = 'cunlian-local'
const run = promisify(execFile)
type Server = { command: string; args: readonly string[]; env?: Record<string, string> }
type Locations = {
  platform: NodeJS.Platform
  home: string
  env: NodeJS.ProcessEnv
  runCli?: (file: string, args: string[]) => Promise<unknown>
}
type Agent = { id: M1LocalAgentId; name: string; configPath: string | null; cli?: string; detected: boolean }

function table(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' &&
      [null, Object.prototype].includes(Object.getPrototypeOf(value))) return value as Record<string, unknown>
  throw Error('INVALID_CONFIG_FILE')
}

async function exists(file: string | null, executable = false) {
  if (!file) return false
  try {
    await access(file, executable ? constants.X_OK : constants.F_OK)
    return !executable || (await stat(file)).isFile()
  } catch { return false }
}

function readServer(info: M1LocalAgentInstallInfo): Server {
  if (!info.mcpConfigJson) return { command: info.bridgeCommand, args: info.bridgeArgs ?? [] }
  return (JSON.parse(info.mcpConfigJson) as { mcpServers: Record<string, Server> }).mcpServers[serverName]!
}

async function readConfig(file: string, toml: boolean) {
  const metadata = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  const target = metadata?.isSymbolicLink() ? await realpath(file) : file
  const raw = metadata ? await readFile(target) : null
  const mode = metadata ? (await stat(target)).mode & 0o777 : 0o600
  try {
    const source = raw?.toString('utf8').replace(/^\uFEFF/u, '')
    const root = table(source === undefined ? {} : toml ? parse(source, { integersAsBigInt: true }) : JSON.parse(source))
    const key = toml ? 'mcp_servers' : 'mcpServers'
    const servers = Object.hasOwn(root, key) ? table(root[key]) : {}
    return { target, raw, root, key, servers, mode }
  } catch {
    throw Error('INVALID_CONFIG_FILE')
  }
}

function matches(value: unknown, server: Server) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  const env = (input: unknown) => input && typeof input === 'object' && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input)) : input ?? {}
  return entry.command === server.command && isDeepStrictEqual(entry.args ?? [], server.args) &&
    isDeepStrictEqual(env(entry.env), server.env ?? {}) &&
    !entry.url && entry.enabled !== false && (entry.type === undefined || entry.type === 'stdio')
}

export class M1AgentRegistration {
  private queue: Promise<unknown> = Promise.resolve()

  private readonly locations: Locations

  constructor(locations: Locations = { platform: process.platform, home: homedir(), env: process.env }) {
    this.locations = locations
  }

  private async agents(): Promise<Agent[]> {
    const { platform, home, env } = this.locations
    const win = platform === 'win32'
    // The injected paths are native to the filesystem running the service.
    const join = path.join
    const local = env.LOCALAPPDATA || join(home, 'AppData', 'Local')
    const roaming = env.APPDATA || join(home, 'AppData', 'Roaming')
    const dirs = (env.PATH ?? env.Path ?? '').split(win ? ';' : ':')
      .map(dir => dir.replace(/^"(.*)"$/u, '$1')).filter(dir => path.isAbsolute(dir))
    const cli = async (name: string) => {
      const file = win ? name + '.exe' : name
      const candidates = [...dirs, join(home, '.local', 'bin'), join(home, 'bin'),
        ...(win ? [join(roaming, 'npm'), join(local, 'Programs', name)] : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']),
      ].map(dir => join(dir, file))
      const found = await Promise.all(candidates.map(candidate => exists(candidate, true)))
      return candidates.find((_, index) => found[index])
    }
    const [claude, codex] = await Promise.all([cli('claude'), cli('codex')])
    const macApps = (name: string) => [join('/Applications', name + '.app'), join(home, 'Applications', name + '.app')]
    const agents = [
      { id: 'claude-code', name: 'Claude Code', cli: claude, configPath: join(home, '.claude.json'),
        apps: win ? [...dirs, join(roaming, 'npm')].map(dir => join(dir, 'claude.cmd')) : [] },
      { id: 'codex', name: 'Codex', cli: codex, configPath: join(home, '.codex', 'config.toml'),
        apps: win ? [...dirs, join(roaming, 'npm')].map(dir => join(dir, 'codex.cmd')) : [] },
      { id: 'claude-desktop', name: 'Claude Desktop',
        configPath: join(win ? roaming : join(home, 'Library', 'Application Support'), 'Claude', 'claude_desktop_config.json'),
        apps: win ? [join(local, 'AnthropicClaude', 'Claude.exe'), join(local, 'Programs', 'Claude', 'Claude.exe'),
          join(local, 'Microsoft', 'WindowsApps', 'Claude.exe')]
          : macApps('Claude') },
      { id: 'cursor', name: 'Cursor', configPath: join(home, '.cursor', 'mcp.json'),
        apps: win ? [join(local, 'Programs', 'cursor', 'Cursor.exe'),
          ...(env.ProgramFiles ? [join(env.ProgramFiles, 'Cursor', 'Cursor.exe')] : [])] : macApps('Cursor') },
      { id: 'windsurf', name: 'Windsurf', configPath: join(home, '.codeium', 'windsurf', 'mcp_config.json'), apps: [] },
    ] as const
    return Promise.all(agents.map(async ({ apps, ...agent }) => {
      const executable = 'cli' in agent ? agent.cli : undefined
      const configuredFiles = await Promise.all([agent.configPath, ...apps].map(file => exists(file)))
      return { ...agent, detected: Boolean(executable) || configuredFiles.some(Boolean) }
    }))
  }

  async detect(info?: M1LocalAgentInstallInfo): Promise<{ agents: M1LocalAgentDetection[] }> {
    const server = info && readServer(info)
    const agents = await Promise.all((await this.agents()).map(async ({ cli, ...agent }): Promise<M1LocalAgentDetection> => {
      const method = agent.id === 'claude-code' && cli ? 'cli' : 'config-file'
      const config = agent.configPath && await readConfig(agent.configPath, agent.id === 'codex').catch(() => null)
      return { ...agent, method, configured: Boolean(server && config && matches(config.servers[serverName], server)),
        ...(config ? {} : { detail: '无法读取客户端配置' }) }
    }))
    return { agents }
  }

  register(id: M1LocalAgentId, info: M1LocalAgentInstallInfo, guard: () => void): Promise<M1LocalAgentRegistration> {
    const pending = this.queue.then(() => this.write(id, readServer(info), guard))
    this.queue = pending.catch(() => {})
    return pending
  }

  private async write(agentId: M1LocalAgentId, server: Server, guard: () => void): Promise<M1LocalAgentRegistration> {
    const agent = (await this.agents()).find(agent => agent.id === agentId)!
    const configPath = agent.configPath!
    const toml = agentId === 'codex'
    const config = await readConfig(configPath, toml)
    const cli = agentId === 'claude-code' && agent.cli
    const result = (method: M1LocalAgentDetection['method'], backupPath: string | null, changed: boolean) => ({
      agentId, name: agent.name, configured: true as const, method, configPath, backupPath,
      message: changed ? '已注册寸链本地连接' : '寸链本地连接已配置',
      requiresRestart: changed && method === 'config-file',
    })
    guard()
    if (matches(config.servers[serverName], server)) return result(cli ? 'cli' : 'config-file', null, false)

    const parent = path.dirname(config.target)
    await mkdir(parent, { recursive: true, mode: 0o700 })
    const suffix = randomUUID()
    const backupPath = config.raw && path.join(path.dirname(configPath), `${path.basename(configPath)}.${suffix}.bak`)
    if (backupPath) await writeFile(backupPath, config.raw!, { flag: 'wx', mode: 0o600 })

    if (cli) {
      guard()
      const runCli = this.locations.runCli ?? ((file, args) =>
        run(file, args, { timeout: 10_000, maxBuffer: 128 * 1024, windowsHide: true, cwd: this.locations.home, env: this.locations.env }))
      // Windows uses the packaged PE directly, with the same environment as the generated MCP config.
      const env = server.env ? ['--env', ...Object.entries(server.env).map(([key, value]) => `${key}=${value}`)] : []
      await runCli(cli, ['mcp', 'add', ...env, '--scope', 'user', serverName, '--',
        server.command, ...server.args]).catch(() => {})
      const updated = await readConfig(configPath, toml)
      if (matches(updated.servers[serverName], server)) return result('cli', backupPath, true)
      if (!isDeepStrictEqual(config.raw, updated.raw)) throw Error('CONFIG_CHANGED')
    }

    config.root[config.key] = { ...config.servers, [serverName]: server }
    const content = toml ? stringify(config.root, { numbersAsFloat: true }) : JSON.stringify(config.root, null, 2) + '\n'
    const temp = path.join(parent, `.${path.basename(config.target)}.${suffix}.tmp`)
    const handle = await open(temp, 'wx', config.mode)
    try {
      try { await handle.writeFile(content) } finally { await handle.close() }
      const updated = await readConfig(configPath, toml)
      if (updated.target !== config.target || !isDeepStrictEqual(config.raw, updated.raw)) throw Error('CONFIG_CHANGED')
      guard()
      await rename(temp, config.target)
    } finally {
      await unlink(temp).catch(() => {})
    }
    return result('config-file', backupPath, true)
  }
}
