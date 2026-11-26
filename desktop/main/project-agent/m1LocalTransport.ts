import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import type { Stats } from 'node:fs'
import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import path from 'node:path'

export const M1_BRIDGE_RESOURCE = 'cunlian-agent'
export const M1_LAUNCH_ARGUMENT = '--cunlian-local-agent'
export const M1_LOCAL_VERSION = 1
export const M1_REQUEST_BYTES = 128 * 1024

export const M1_LOCAL_OPERATIONS = ['capabilities', 'authorizeProject', 'getContext', 'getExternalActivities',
  'acquireWriter', 'takeOverWriter', 'stageChange', 'readWriterContext', 'revokeWriter', 'moveRightHoleX'] as const
export const M1_LOCAL_ERRORS = new Set(['AUTH_REQUIRED', 'WRITER_HELD', 'WRITER_REVOKED', 'INVALID_REQUEST', 'STALE_BASE',
  'DRAFT_NOT_EMPTY', 'INVALID_TRANSITION', 'REFERENCE_STALE', 'IDEMPOTENCY_CONFLICT', 'TASK_SCOPE_MISMATCH',
  'FEATURE_DISABLED', 'STALE_DRAFT', 'ASSEMBLY_REQUIRED', 'INVALID_GDT', 'SIMULATION_LIMIT',
  'INVALID_WHAT_IF', 'ASSEMBLY_OVERCONSTRAINED', 'NO_GDT_CONTROLS', 'SIMULATION_FAILED',
  'UNSUPPORTED_SCOPE', 'SAVE_FAILED', 'STEP_FAILED', 'REQUEST_COLLISION', 'STALE_SOURCE'])

export function isM1ClientName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 128 &&
    !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)
}

export function currentM1Uid() {
  if (!process.geteuid || process.geteuid() !== process.getuid?.() || process.geteuid() === 0) {
    throw Error('LOCAL_ENDPOINT_UNAVAILABLE')
  }
  return process.geteuid()
}

export function isM1WindowsAbsolute(value: string) {
  if (/[\0\r\n]/.test(value)) return false
  const normalized = value.replaceAll('/', '\\')
  return /^(?:\\\\\?\\)?[a-z]:\\/i.test(normalized) ||
    /^(?:\\\\\?\\UNC\\|\\\\)(?![?.]\\)[^\\]+\\[^\\]+(?:\\|$)/i.test(normalized)
}

const windowsPipePrefix = '\\\\.\\pipe\\cunlian-m1-'

export function isM1WindowsPipe(value: string) {
  return value.startsWith(windowsPipePrefix) && /^[a-f0-9]{64}$/.test(value.slice(windowsPipePrefix.length))
}

export function localM1WindowsPipe(canonicalExecutable: string, sid: string) {
  if (!isM1WindowsAbsolute(canonicalExecutable) || !/^S-1-(?:[0-9]+-)*[0-9]+$/.test(sid)) {
    throw Error('LOCAL_ENDPOINT_UNAVAILABLE')
  }
  const key = createHash('sha256').update(sid).update('\0')
    .update(windowsExecutableIdentity(canonicalExecutable)).digest('hex')
  return windowsPipePrefix + key
}

function windowsExecutableIdentity(executable: string) {
  // realpath supplies filesystem casing, including case-sensitive Windows directories.
  return path.win32.normalize(executable)
    .replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '')
    .replace(/^[a-z]:/i, drive => drive.toUpperCase())
}

export function localM1WindowsProfile(executable: string) {
  const canonical = realpathSync.native(executable)
  return createHash('sha256').update(windowsExecutableIdentity(canonical)).digest('hex').slice(0, 24)
}

export function localM1PeerHelper(resourcesPath: string, platform = process.platform) {
  return (platform === 'win32' ? path.win32 : path).join(resourcesPath, M1_BRIDGE_RESOURCE,
    platform === 'win32' ? 'm1-peer.exe' : 'm1-peer')
}

export function localM1Socket(executable: string, peerHelper?: string) {
  if (process.platform === 'win32') {
    if (!isM1WindowsAbsolute(executable) || !peerHelper || !isM1WindowsAbsolute(peerHelper)) {
      throw Error('LOCAL_ENDPOINT_UNAVAILABLE')
    }
    const sid = execFileSync(peerHelper, ['sid'], { encoding: 'utf8', timeout: 3_000, windowsHide: true }).trim()
    return localM1WindowsPipe(realpathSync.native(executable), sid)
  }
  if (process.platform !== 'darwin' || !path.isAbsolute(executable)) throw Error('LOCAL_ENDPOINT_UNAVAILABLE')
  const shared = lstatSync('/private/tmp')
  if (!shared.isDirectory() || shared.uid !== 0 || !(shared.mode & 0o1000)) throw Error('UNSAFE_ENDPOINT')
  const key = createHash('sha256').update(realpathSync(executable)).digest('hex').slice(0, 24)
  return `/private/tmp/cunlian-m1-${currentM1Uid()}-${key}/agent.sock`
}

export function optionalStat(target: string) {
  try {
    return lstatSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return null
  }
}

export function isPrivateM1Node(stat: Stats, mode: number) {
  return stat.uid === currentM1Uid() && (stat.mode & 0o7777) === mode
}

export function checkM1Directory(socketPath: string) {
  if (!path.isAbsolute(socketPath) || path.normalize(socketPath) !== socketPath ||
      socketPath.includes('\0') || Buffer.byteLength(socketPath) > 103) throw Error('UNSAFE_ENDPOINT')
  const dir = path.dirname(socketPath)
  const stat = optionalStat(dir)
  if (!stat) return false
  if (!stat.isDirectory() || !isPrivateM1Node(stat, 0o700) || realpathSync(dir) !== dir) throw Error('UNSAFE_ENDPOINT')
  return true
}

export function checkM1Socket(socketPath: string) {
  if (!checkM1Directory(socketPath)) return null
  const stat = optionalStat(socketPath)
  if (stat && (!stat.isSocket() || !isPrivateM1Node(stat, 0o600))) throw Error('UNSAFE_ENDPOINT')
  return stat
}

export function nativeM1Check(helper: string, operation: 'lock' | 'peer', fd: number) {
  if (!path.isAbsolute(helper) || !Number.isSafeInteger(fd) || fd < 0) return false
  return spawnSync(helper, [operation], {
    stdio: ['ignore', 'ignore', 'ignore', fd],
    env: {},
    timeout: 3_000,
  }).status === 0
}

export function sameM1Peer(helper: string, socket: Socket) {
  // Node exposes no public Unix peer-credential or connected socket fd API.
  const fd = (socket as Socket & { _handle?: { fd: number } })._handle?.fd
  return fd !== undefined && nativeM1Check(helper, 'peer', fd)
}

export function readM1Frames(socket: Duplex, maxBytes: number, receive: (value: unknown) => void) {
  let chunks: Buffer[] = []
  let size = 0
  socket.on('data', (data: Buffer) => {
    let start = 0
    while (start < data.length && !socket.destroyed) {
      const newline = data.indexOf(10, start)
      const end = newline < 0 ? data.length : newline
      size += end - start
      if (size > maxBytes) {
        socket.destroy()
        return
      }
      chunks.push(data.subarray(start, end))
      if (newline < 0) return
      let value: unknown
      try {
        value = JSON.parse(Buffer.concat(chunks, size).toString('utf8'))
      } catch {
        socket.destroy()
        return
      }
      chunks = []
      size = 0
      start = end + 1
      receive(value)
    }
  })
}
