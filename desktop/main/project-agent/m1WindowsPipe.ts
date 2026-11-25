import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { Duplex } from 'node:stream'
import { isM1WindowsPipe, isM1WindowsAbsolute } from './m1LocalTransport.ts'

type Mode = 'listen-first' | 'listen' | 'connect'

function relay(helper: string, mode: Mode, pipe: string) {
  if (!isM1WindowsAbsolute(helper) || !isM1WindowsPipe(pipe)) throw Error('UNSAFE_ENDPOINT')
  const child = spawn(helper, [mode, pipe, String(process.pid)], { windowsHide: true, stdio: 'pipe' })
  const stream = Duplex.from({ readable: child.stdout, writable: child.stdin })
  stream.on('error', () => stream.destroy())
  stream.once('close', () => child.kill())
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()))
  const control = createInterface({ input: child.stderr })
  let ready: () => void = () => {}
  const listening = new Promise<void>(resolve => { ready = resolve })
  const connected = new Promise<Duplex>((resolve, reject) => {
    child.once('error', reject)
    void closed.then(() => reject(Error('LOCAL_ENDPOINT_UNAVAILABLE')))
    control.on('line', line => {
      if (line === 'READY') ready()
      else if (line === 'CONNECTED') resolve(stream)
      else {
        const code = line === 'MISSING' ? 'ENOENT' : line === 'BUSY' ? 'EBUSY' :
          line === 'RETRY' ? 'RETRY_PEER' : 'UNTRUSTED_PEER'
        reject(Object.assign(Error(code), { code }))
      }
    })
  })
  return { connected, listening, closed, destroy: () => { stream.destroy(); child.kill() } }
}

export async function connectM1WindowsPipe(helper: string, pipe: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const child = relay(helper, 'connect', pipe)
  const abort = () => child.destroy()
  signal.addEventListener('abort', abort, { once: true })
  try {
    const stream = await child.connected
    signal.throwIfAborted()
    return stream
  } catch (error) {
    child.destroy()
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

export async function listenM1WindowsPipe(helper: string, pipe: string, accept: (stream: Duplex) => void,
  diagnostic?: (code: string) => void) {
  const relays = new Set<ReturnType<typeof relay>>()
  let stopping = false

  function arm(mode: 'listen-first' | 'listen') {
    const child = relay(helper, mode, pipe)
    relays.add(child)
    void child.closed.then(() => relays.delete(child))
    void child.connected.then(stream => {
      if (stopping) { child.destroy(); return }
      // Start the next instance before exposing this connection to the protocol.
      arm('listen')
      accept(stream)
    }, (error: NodeJS.ErrnoException) => {
      if (!stopping && error.code === 'RETRY_PEER') arm('listen')
      else if (!stopping) diagnostic?.('LOCAL_ENDPOINT_FAILED')
    }).catch(() => {
      child.destroy()
      if (!stopping) diagnostic?.('LOCAL_ENDPOINT_FAILED')
    })
    return child
  }

  const first = arm('listen-first')
  try {
    await Promise.race([first.listening, first.connected])
  } catch (error) {
    stopping = true
    first.destroy()
    await first.closed
    throw error
  }
  return async () => {
    stopping = true
    const children = [...relays]
    for (const child of children) child.destroy()
    await Promise.all(children.map(child => child.closed))
  }
}
