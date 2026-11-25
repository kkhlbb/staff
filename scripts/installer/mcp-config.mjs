import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

const serverName = 'cunlian-local'

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

function writeJson(file, data) {
  const temp = path.join(path.dirname(file), randomUUID() + '.tmp')
  try {
    writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' })
    renameSync(temp, file)
  } finally {
    rmSync(temp, { force: true })
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function serverFor(executable) {
  const bridge = path.win32.join(path.win32.dirname(executable), 'resources', 'cunlian-agent', 'local-bridge.mjs')
  return {
    command: executable,
    args: [bridge, executable],
    env: { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '', ELECTRON_NO_ASAR: '' },
  }
}

export function configure(mode, executable, agentDir, profileDir) {
  const desired = serverFor(executable)
  const stateFile = path.join(agentDir, '.installer-mcp-owner.json')
  if (mode !== 'remove') {
    writeJson(path.join(agentDir, 'mcp-config.json'), { mcpServers: { [serverName]: desired } })
  }
  if (mode === 'local') return

  const userDir = path.join(profileDir, '.cunlian')
  const userFile = path.join(userDir, 'mcp-config.json')
  const previous = readJson(stateFile)
  if (mode === 'remove' && previous === undefined) return
  let existing
  try {
    existing = readJson(userFile)
  } catch (error) {
    if (mode !== 'remove' || !(error instanceof SyntaxError)) throw error
    // A config the user made unreadable as JSON cannot be identified as ours.
    rmSync(stateFile, { force: true })
    return
  }
  const config = existing === undefined ? {} : existing
  if (!isObject(config) || (Object.hasOwn(config, 'mcpServers') && !isObject(config.mcpServers))) {
    if (mode !== 'remove') throw Error('Invalid MCP configuration structure')
    rmSync(stateFile, { force: true })
    return
  }
  const servers = config.mcpServers ?? {}
  const hasServer = Object.hasOwn(servers, serverName)
  const ownsServer = hasServer && previous !== undefined && isDeepStrictEqual(servers[serverName], previous)
  if (mode === 'remove') {
    if (ownsServer) {
      delete servers[serverName]
      writeJson(userFile, config)
    }
    rmSync(stateFile, { force: true })
    return
  }
  if (hasServer && !ownsServer) return
  // A missing entry after an earlier install may be an intentional user deletion.
  if (!hasServer && previous !== undefined) return
  if (ownsServer && isDeepStrictEqual(previous, desired)) return
  mkdirSync(userDir, { recursive: true })
  config.mcpServers = servers
  servers[serverName] = desired
  writeJson(stateFile, desired)
  try {
    writeJson(userFile, config)
  } catch (error) {
    if (previous === undefined) rmSync(stateFile, { force: true })
    else writeJson(stateFile, previous)
    throw error
  }
}
