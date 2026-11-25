import { spawn } from 'node:child_process'
import net from 'node:net'
import type { Socket } from 'node:net'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { checkM1Socket, isM1ClientName, M1_LAUNCH_ARGUMENT, M1_LOCAL_VERSION, readM1Frames, sameM1Peer } from '../desktop/main/project-agent/m1LocalTransport.ts'

type Launcher = (command: string, args: string[], signal: AbortSignal) => Promise<void>
export const launchLocalDesktop: Launcher = (command, args, signal) => new Promise((resolve, reject) => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ASAR
  delete env.NODE_OPTIONS
  signal.throwIfAborted()
  const child = spawn(command, args, { detached: true, stdio: 'ignore', env })
  child.on('error', reject)
  child.once('spawn', () => { child.unref(); resolve() })
})

function connect(socketPath: string, helper: string, signal: AbortSignal): Promise<Socket> {
  return new Promise((resolve, reject) => {
    if (!checkM1Socket(socketPath)) throw Object.assign(Error('ENOENT'), { code: 'ENOENT' })
    signal.throwIfAborted()
    const socket = net.createConnection({ path: socketPath })
    const cancel = () => socket.destroy(Error('DESKTOP_TIMEOUT'))
    signal.addEventListener('abort', cancel, { once: true })
    socket.once('close', () => signal.removeEventListener('abort', cancel))
    socket.once('error', reject)
    socket.once('connect', () => {
      signal.removeEventListener('abort', cancel)
      if (!sameM1Peer(helper, socket) || signal.aborted) {
        socket.destroy()
        reject(Error('UNTRUSTED_PEER'))
      } else {
        resolve(socket)
      }
    })
  })
}

interface ClientPorts {
  executable: string
  socketPath: string
  peerHelper: string
  startupTimeoutMs?: number
  launch?: Launcher
}

export class LocalM1Client {
  private readonly ports: ClientPorts
  private readonly lifetime = new AbortController()
  private socket?: Socket
  private connecting?: Promise<Socket>
  private pending?: { id: number; finish(error: Error | null, result?: Record<string, unknown>): void }
  private id = 0
  private clientName: string | null = null
  constructor(ports: ClientPorts) {
    if (!path.isAbsolute(ports.executable)) throw Error('LOCAL_ENDPOINT_UNAVAILABLE')
    this.ports = ports
  }

  initialize(name: unknown) {
    if (!isM1ClientName(name)) throw Error('INVALID_CLIENT_NAME')
    if (this.clientName !== null && this.clientName !== name) throw Error('INVALID_CLIENT_NAME')
    this.clientName = name
  }

  close() {
    this.lifetime.abort()
    this.socket?.destroy()
  }

  private async locate(signal: AbortSignal) {
    const { executable, socketPath, peerHelper, launch = launchLocalDesktop } = this.ports
    let launched = false
    while (!signal.aborted) {
      try {
        return await connect(socketPath, peerHelper, signal)
      } catch (error) {
        if (!['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        if (!launched) {
          launched = true
          await Promise.race([launch(executable, [M1_LAUNCH_ARGUMENT], signal),
            delay(this.ports.startupTimeoutMs ?? 10_000, undefined, { signal, ref: false }).then(() => { throw Error('DESKTOP_TIMEOUT') })])
        }
        await delay(80, undefined, { signal })
      }
    }
    throw Error('DESKTOP_TIMEOUT')
  }

  private async establish() {
    if (!this.clientName) throw Error('INITIALIZE_REQUIRED')
    const budget = this.ports.startupTimeoutMs ?? 10_000
    const deadline = performance.now() + budget
    const startup = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(budget)])
    let socket: Socket
    try { socket = await this.locate(startup) } catch (error) {
      if (startup.aborted) throw Error('DESKTOP_TIMEOUT', { cause: error })
      throw error
    }
    this.socket = socket
    socket.on('close', () => {
      if (this.socket !== socket) return
      this.socket = undefined
      this.pending?.finish(Error('DESKTOP_DISCONNECTED'))
    })
    readM1Frames(socket, 8 * 1024 * 1024, value => {
      const pending = this.pending
      const response = value as { id?: unknown; ok?: unknown; code?: unknown; result?: Record<string, unknown> } | null
      if (!pending || response?.id !== pending.id || typeof response.ok !== 'boolean' ||
        (response.ok && (!response.result || typeof response.result !== 'object' || Array.isArray(response.result)))) {
        socket.destroy()
        return
      }
      pending.finish(response.ok ? null : Error(typeof response.code === 'string' ? response.code : 'STEP_FAILED'), response.result)
    })
    try {
      const hello = await this.exchange(socket, 'hello', { version: M1_LOCAL_VERSION, clientName: this.clientName },
        deadline - performance.now())
      if (hello.version !== M1_LOCAL_VERSION) throw Error('INCOMPATIBLE_BRIDGE')
      const capabilities = await this.exchange(socket, 'capabilities', {}, deadline - performance.now())
      if (capabilities.protocol !== M1_LOCAL_VERSION) throw Error('INCOMPATIBLE_BRIDGE')
      return socket
    } catch (error) {
      socket.destroy()
      throw error
    }
  }

  private exchange(socket: Socket, method: string, params: unknown, timeoutMs: number): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (socket.destroyed || this.lifetime.signal.aborted) throw Error('DESKTOP_DISCONNECTED')
      if (this.pending) throw Error('BUSY')
      if (timeoutMs <= 0) throw Error('DESKTOP_TIMEOUT')
      const id = ++this.id
      const timer = setTimeout(() => {
        this.pending?.finish(Error('DESKTOP_TIMEOUT'))
        socket.destroy()
      }, timeoutMs)
      this.pending = { id, finish: (error, result) => {
        clearTimeout(timer)
        this.pending = undefined
        if (error || !result) reject(error ?? Error('STEP_FAILED'))
        else resolve(result)
      } }
      socket.write(JSON.stringify({ id, method, params }) + '\n')
    })
  }

  async ready() {
    if (this.connecting) return this.connecting
    if (this.socket && !this.socket.destroyed) return this.socket
    this.connecting = this.establish().finally(() => { this.connecting = undefined })
    return this.connecting
  }

  async call(method: string, params: unknown) {
    const socket = await this.ready()
    return this.exchange(socket, method, params, 120_000)
  }
}
