import { constants, chmodSync, closeSync, fstatSync, mkdirSync, openSync, unlinkSync } from 'node:fs'
import net from 'node:net'
import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { listenM1WindowsPipe } from './m1WindowsPipe.ts'
import path from 'node:path'
import { nat, object, oneOf, q, text, type Infer } from '../../shared/project-agent/schema.ts'
import type { LocalM1Authority, M1ExternalScope, M1WriterConfirmation, M1WriterLease } from './m1LocalAuthority'
import { compliantToolNames, desktopGdtEnabled, gdtToolNames, isCompliantTool, isGdtTool } from './gdtTools.ts'
import type { M1StageChangeRequest } from './m1StageContracts'
import { checkM1Directory, checkM1Socket, isPrivateM1Node, M1_LOCAL_VERSION, M1_REQUEST_BYTES,
  isM1ClientName, M1_LOCAL_ERRORS, M1_LOCAL_OPERATIONS, nativeM1Check, optionalStat, readM1Frames, sameM1Peer } from './m1LocalTransport.ts'

const project = object({ projectId: text })
const writer = object({ projectId: text, expectedWriterEpoch: nat })
const stage = object({ projectId: text, change: (value): value is M1StageChangeRequest => {
  if (!value || typeof value !== 'object' || !('sources' in value)) return false
  const sources = value.sources
  return !!sources && typeof sources === 'object' && !Array.isArray(sources) &&
    Object.values(sources).every(object({ type: oneOf('userInput') }))
} })
const move = object({ projectId: text, baseRevision: text, expectedDraftRevision: text, idempotencyKey: text, deltaQ: q })
type MoveRightHole = Infer<typeof move>
const empty = object({})
const envelope = object({ id: nat, method: oneOf('hello', ...M1_LOCAL_OPERATIONS, ...gdtToolNames, ...compliantToolNames, 'export_simulation_report'), params: (value): value is object => !!value && typeof value === 'object' && !Array.isArray(value) })
const hello = object({ version: (value): value is 1 => value === M1_LOCAL_VERSION,
  clientName: isM1ClientName })

type ConfirmationTarget = Parameters<M1WriterConfirmation>[0]
interface EndpointPorts {
  socketPath: string
  peerHelper: string
  authority: LocalM1Authority
  selectWindow(projectId: string): number | null
  confirm(target: ConfirmationTarget, clientName: string, kind: 'read' | 'writer', signal: AbortSignal):
    ReturnType<M1WriterConfirmation>
  mountingPlateRevision?(scope: M1ExternalScope, lease: M1WriterLease): Promise<string | undefined>
  moveRightHoleX?(scope: M1ExternalScope, lease: M1WriterLease, request: MoveRightHole):
    Promise<{ revision: string; jobId: string }>
  diagnostic?(code: string): void
}
type Peer = {
  clientName: string | null
  ready: boolean
  abort: AbortController
  scope?: M1ExternalScope
  lease?: M1WriterLease
}

async function removeStaleSocket(socketPath: string) {
  const existing = checkM1Socket(socketPath)
  if (!existing) return
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    socket.setTimeout(750, () => socket.destroy(Error('LOCAL_ENDPOINT_BUSY')))
    socket.once('connect', () => {
      socket.destroy()
      reject(Error('LOCAL_ENDPOINT_BUSY'))
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED') resolve()
      else reject(error)
    })
  })
  const current = checkM1Socket(socketPath)
  if (!current || current.dev !== existing.dev || current.ino !== existing.ino) throw Error('UNSAFE_ENDPOINT')
  unlinkSync(socketPath)
}

async function listenM1DarwinPipe(socketPath: string, peerHelper: string, accept: (socket: Socket) => void,
  diagnostic?: (code: string) => void) {
  const directory = path.dirname(socketPath)
  if (!checkM1Directory(socketPath)) {
    try { mkdirSync(directory, { mode: 0o700 }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    if (!checkM1Directory(socketPath)) throw Error('UNSAFE_ENDPOINT')
  }
  const lock = path.join(directory, 'owner.lock')
  const lockFd = openSync(lock, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600)
  const connections = new Set<Socket>()
  const server = net.createServer(socket => {
    connections.add(socket)
    socket.once('close', () => connections.delete(socket))
    socket.on('error', () => socket.destroy())
    if (sameM1Peer(peerHelper, socket)) accept(socket)
    else socket.destroy()
  })
  try {
    const held = fstatSync(lockFd)
    const named = optionalStat(lock)
    if (!held.isFile() || held.nlink !== 1 || !isPrivateM1Node(held, 0o600) ||
      !named || named.dev !== held.dev || named.ino !== held.ino) throw Error('UNSAFE_ENDPOINT')
    if (!nativeM1Check(peerHelper, 'lock', lockFd)) throw Error('LOCAL_ENDPOINT_BUSY')
    await removeStaleSocket(socketPath)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      // libuv binds synchronously for a filesystem path. Restrict the socket from its creation.
      const previous = process.umask(0o177)
      try {
        server.listen(socketPath, () => {
          server.off('error', reject)
          resolve()
        })
      } finally {
        process.umask(previous)
      }
    })
    chmodSync(socketPath, 0o600)
    if (!checkM1Socket(socketPath)) throw Error('UNSAFE_ENDPOINT')
  } catch (error) {
    for (const socket of connections) socket.destroy()
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
    closeSync(lockFd)
    throw error
  }
  server.on('error', () => diagnostic?.('LOCAL_ENDPOINT_FAILED'))
  return async () => {
    try {
      await new Promise<void>(resolve => server.close(() => resolve()))
    } finally {
      closeSync(lockFd)
    }
  }
}

export async function startM1LocalEndpoint(ports: EndpointPorts) {
  const { socketPath, peerHelper, authority } = ports
  const peers = new Map<Duplex, Peer>()
  const pending = new Set<Promise<void>>()
  let stopping = false

  function track(job: Promise<void>) {
    pending.add(job)
    void job.then(() => pending.delete(job), () => {
      pending.delete(job)
      ports.diagnostic?.('LOCAL_REQUEST_FAILED')
    })
  }

  function disconnect(socket: Duplex, peer: Peer) {
    if (peer.abort.signal.aborted) return
    peers.delete(socket)
    peer.abort.abort()
    if (peer.scope) track(authority.revokeExternal(peer.scope).catch(() => ports.diagnostic?.('LOCAL_REVOKE_FAILED')))
    socket.destroy()
  }

  function confirmPeer(signal: AbortSignal, clientName: string, target: ConfirmationTarget, kind: 'read' | 'writer') {
    return new Promise<'approve' | 'deny' | 'cancel'>((resolve, reject) => {
      if (signal.aborted) { resolve('cancel'); return }
      const cancel = () => resolve('cancel')
      signal.addEventListener('abort', cancel, { once: true })
      void Promise.resolve().then(() => ports.confirm(target, clientName, kind, signal))
        .then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel))
    })
  }

  async function dispatch(peer: Peer, message: Infer<typeof envelope>) {
    const { method, params } = message
    if (peer.abort.signal.aborted) throw Error('AUTH_REQUIRED')
    if (method === 'hello') {
      if (peer.clientName || !hello(params)) throw Error('INVALID_REQUEST')
      peer.clientName = params.clientName
      return { version: M1_LOCAL_VERSION }
    }
    const clientName = peer.clientName
    if (!clientName) throw Error('INVALID_REQUEST')
    if (method === 'capabilities') {
      if (!empty(params)) throw Error('INVALID_REQUEST')
      peer.ready = true
      const operations = M1_LOCAL_OPERATIONS.filter(name => name !== 'moveRightHoleX' || ports.moveRightHoleX)
      return { protocol: M1_LOCAL_VERSION, operations, draftOperations: ['createSpacerDraft', 'resumeSpacerDraft'],
        ...(desktopGdtEnabled() && { gdtOperations: gdtToolNames, compliantOperations: [...compliantToolNames, 'export_simulation_report'] }) }
    }
    if (!peer.ready) throw Error('INVALID_REQUEST')
    if (method === 'authorizeProject') {
      if (!project(params) || params.projectId.length > 256) throw Error('INVALID_REQUEST')
      const windowId = ports.selectWindow(params.projectId)
      if (windowId === null) throw Error('AUTH_REQUIRED')
      if (peer.scope) {
        const previous = peer.scope
        peer.scope = undefined
        peer.lease = undefined
        await authority.revokeExternal(previous)
      }
      const scope = await authority.authorizeExternal(windowId, params.projectId, peer.abort.signal,
        (target, signal = peer.abort.signal) => confirmPeer(signal, clientName, target, 'read'))
      if (peer.abort.signal.aborted) {
        await authority.revokeExternal(scope)
        throw Error('AUTH_REQUIRED')
      }
      peer.scope = scope
      return { projectId: scope.projectId, authorized: true }
    }
    const scope = peer.scope
    if (method === 'export_simulation_report') {
      if (!desktopGdtEnabled()) throw Error('FEATURE_DISABLED')
      if (!scope) throw Error('AUTH_REQUIRED')
      return authority.exportSimulationReport(params, scope, () => peer.abort.signal.throwIfAborted())
    }
    if (isGdtTool(method)) {
      if (!desktopGdtEnabled()) throw Error('FEATURE_DISABLED')
      if (!scope || !('projectId' in params) || params.projectId !== scope.projectId) throw Error('AUTH_REQUIRED')
      if (!peer.lease) throw Error('WRITER_REVOKED')
      return authority.runGdtTool(peer.lease, method, params, { scope, signal: peer.abort.signal })
    }
    if (isCompliantTool(method)) {
      if (!desktopGdtEnabled()) throw Error('FEATURE_DISABLED')
      if (!scope || !('projectId' in params) || params.projectId !== scope.projectId) throw Error('AUTH_REQUIRED')
      if (!peer.lease) throw Error('WRITER_REVOKED')
      return authority.runCompliantTool(peer.lease, method, params, { scope, signal: peer.abort.signal })
    }
    const args = method === 'moveRightHoleX' ? (move(params) ? params : null) :
      method === 'stageChange' ? (stage(params) ? params : null) :
      method === 'acquireWriter' || method === 'takeOverWriter' ? (writer(params) ? params : null) :
      (project(params) ? params : null)
    if (!args) throw Error('INVALID_REQUEST')
    if (!scope || args.projectId !== scope.projectId) throw Error('AUTH_REQUIRED')
    if (method === 'getContext' || method === 'getExternalActivities') {
      const context = await authority.readExternalContext(scope, peer.lease)
      return method === 'getContext' ? context : { activities: context.activities, draftRevision: context.snapshot.draftRevision }
    }
    if (method === 'acquireWriter' || method === 'takeOverWriter') {
      if (!writer(params)) throw Error('INVALID_REQUEST')
      const request = { windowId: scope.windowId, sessionId: scope.sessionId, projectId: scope.projectId,
        expectedWriterEpoch: params.expectedWriterEpoch }
      const confirm: M1WriterConfirmation = (target, signal = peer.abort.signal) => confirmPeer(signal, clientName, target, 'writer')
      const lease = method === 'acquireWriter' ? await authority.acquireWriter(request, confirm, scope)
        : await authority.takeOverWriter(request, confirm, scope)
      if (peer.abort.signal.aborted) {
        await authority.revokeWriter(lease)
        throw Error('AUTH_REQUIRED')
      }
      peer.lease = lease
      return { writerEpoch: lease.writerEpoch, baseRevision: lease.baseRevision, draftRevision: lease.draftRevision }
    }
    const lease = peer.lease
    if (!lease) throw Error('WRITER_REVOKED')
    if (method === 'readWriterContext') {
      const mountingPlateDraftRevision = await ports.mountingPlateRevision?.(scope, lease)
      const context = await authority.readWriterContext(lease)
      return mountingPlateDraftRevision ? { ...context, mountingPlateDraftRevision } : context
    }
    if (method === 'moveRightHoleX' && move(params)) {
      if ([params.projectId, params.baseRevision, params.expectedDraftRevision, params.idempotencyKey]
        .some(value => value.length > 240) || params.deltaQ === 0) throw Error('INVALID_REQUEST')
      if (!ports.moveRightHoleX) throw Error('UNSUPPORTED_SCOPE')
      return ports.moveRightHoleX(scope, lease, params)
    }
    if (method === 'stageChange' && stage(params)) return authority.stageChange(lease, params.change)
    if (method === 'revokeWriter') {
      peer.lease = undefined
      await authority.revokeWriter(lease)
      return { revoked: true }
    }
    throw Error('INVALID_REQUEST')
  }

  function accept(socket: Duplex) {
    socket.on('error', () => socket.destroy())
    if (stopping || peers.size >= 16) {
      socket.destroy()
      return
    }
    const peer: Peer = { clientName: null, ready: false, abort: new AbortController() }
    peers.set(socket, peer)
    const handshakeDeadline = setTimeout(() => disconnect(socket, peer), 5_000)
    socket.once('close', () => clearTimeout(handshakeDeadline))
    socket.on('end', () => disconnect(socket, peer))
    socket.on('close', () => disconnect(socket, peer))
    let busy = false
    let id = -1
    readM1Frames(socket, M1_REQUEST_BYTES, value => {
      if (!envelope(value) || value.id <= id || busy) {
        disconnect(socket, peer)
        return
      }
      id = value.id
      busy = true
      const reply = (payload: object) => {
        if (!socket.destroyed && !peer.abort.signal.aborted) socket.write(JSON.stringify({ id, ...payload }) + '\n')
      }
      track(dispatch(peer, value).then(result => {
        if (peer.ready) clearTimeout(handshakeDeadline)
        reply({ ok: true, result })
      }, (error: unknown) => {
        const code = error instanceof Error && M1_LOCAL_ERRORS.has(error.message) ? error.message : 'STEP_FAILED'
        reply({ ok: false, code })
      }).finally(() => { busy = false }))
    })
  }
  const stopListening = process.platform === 'win32'
    ? await listenM1WindowsPipe(peerHelper, socketPath, accept, ports.diagnostic)
    : await listenM1DarwinPipe(socketPath, peerHelper, accept, ports.diagnostic)
  let closing: Promise<void> | undefined
  return {
    connections: () => [...peers.values()].flatMap(peer => peer.clientName ?
      [{ clientName: peer.clientName, state: peer.ready ? 'connected' as const : 'connecting' as const }] : []),
    async boundPeer(windowId: number, sessionId: string, projectId: string) {
      const candidates = [...peers.values()].filter(peer => peer.ready && !peer.abort.signal.aborted &&
        peer.scope?.windowId === windowId && peer.scope.sessionId === sessionId && peer.scope.projectId === projectId)
      const peer = candidates.length === 1 ? candidates[0] : undefined
      const scope = peer?.scope
      if (candidates.length > 1) throw Error('WRITER_HELD')
      if (!peer || !scope) {
        throw Error([...peers.values()].some(peer => peer.ready && !peer.abort.signal.aborted) ? 'AUTH_REQUIRED' : 'DISCONNECTED')
      }
      await authority.readExternalContext(scope, peer.lease)
      if (peer.scope !== scope || peer.abort.signal.aborted) throw Error('DISCONNECTED')
      return {
        scope, clientName: peer.clientName!,
        checkLive() {
          if (peer.scope !== scope || peer.abort.signal.aborted) throw Error('DISCONNECTED')
        },
        setLease(lease: M1WriterLease) {
          if (peer.scope !== scope || peer.abort.signal.aborted) throw Error('DISCONNECTED')
          peer.lease = lease
        },
      }
    },
    close: () => closing ??= (async () => {
      stopping = true
      for (const [socket, peer] of peers) disconnect(socket, peer)
      await stopListening()
      while (pending.size) await Promise.allSettled([...pending])
    })(),
  }
}
