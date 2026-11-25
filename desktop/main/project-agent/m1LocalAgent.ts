import path from 'node:path'
import type { LocalM1Authority } from './m1LocalAuthority'
import { isM1WindowsAbsolute, M1_BRIDGE_RESOURCE } from './m1LocalTransport'

const mcpServerName = 'cunlian-local'

export function getLocalAgentInstallInfo(executable: string, resourcesPath: string, platform = process.platform) {
  if (platform === 'win32') {
    const win = path.win32
    const installPath = win.dirname(win.normalize(executable))
    if (!isM1WindowsAbsolute(executable) || !isM1WindowsAbsolute(resourcesPath) ||
      win.basename(executable).toLowerCase() !== '寸链.exe' ||
      win.join(installPath, 'resources').toLowerCase() !== win.normalize(resourcesPath).replace(/\\$/, '').toLowerCase()) {
      throw Error('LOCAL_ENDPOINT_UNAVAILABLE')
    }
    const bridgeDir = win.join(resourcesPath, M1_BRIDGE_RESOURCE)
    const bridgeCommand = win.join(bridgeDir, 'cunlian-mcp.cmd')
    const bridgeArgs: string[] = []
    // MCP clients can spawn the PE directly. A .cmd file would require shell-specific quoting.
    const server = { command: win.normalize(executable),
      args: [win.join(bridgeDir, 'local-bridge.mjs'), win.normalize(executable)],
      env: { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '', ELECTRON_NO_ASAR: '' } }
    return { installPath, bridgeCommand, bridgeArgs, mcpServerName,
      mcpConfigJson: JSON.stringify({ mcpServers: { [mcpServerName]: server } }, null, 2) }
  }
  if (platform !== 'darwin' || !path.isAbsolute(executable) || !path.isAbsolute(resourcesPath) ||
    path.basename(path.dirname(executable)) !== 'MacOS' ||
    path.resolve(path.dirname(executable), '..', 'Resources') !== resourcesPath) {
    throw Error('LOCAL_ENDPOINT_UNAVAILABLE')
  }
  const installPath = path.resolve(executable, '../../..')
  const bridgeCommand = path.join(resourcesPath, M1_BRIDGE_RESOURCE, 'cunlian-mcp')
  const bridgeArgs: string[] = []
  return { installPath, bridgeCommand, bridgeArgs, mcpServerName,
    mcpConfigJson: JSON.stringify({ mcpServers: { [mcpServerName]: { command: bridgeCommand, args: bridgeArgs } } }, null, 2) }
}

// D passes the window identity from its guarded IPC path, never from the renderer payload.
export async function getExternalActivities(authority: LocalM1Authority, windowId: number,
  binding: { sessionId: string; projectId: string }, authorizationRef: string) {
  const caller = await authority.resolve({ webContentsId: windowId, isMainFrame: true, frameUrl: null }, binding)
  if (!caller || caller.authorizationRef !== authorizationRef) throw Error('AUTH_REQUIRED')
  const { activities, snapshot } = await authority.readContext(binding, caller)
  return { activities: activities.filter(activity => activity.source === 'external'), draftRevision: snapshot.draftRevision }
}
