import '../mcp/register-ts.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import net from 'node:net'

const apiKey = 'cloud-smoke-writer-secret'
const peerKey = 'cloud-smoke-secondary-secret'
const human = 'cloud-smoke-human-secret'
const root = await mkdtemp(join(tmpdir(), 'cunlian-cloud-smoke-'))
const reservation = net.createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
let child
try {
  child = spawn(process.execPath, ['cloud/server/index.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', CUNLIAN_DATA: root,
      FEATURE_3D_ASSEMBLY_M1: 'false', CUNLIAN_APPROVAL_SECRET: human,
      CUNLIAN_KEYS: JSON.stringify([
        { name: 'writer', key: apiKey, write: true, takeover: true },
        { name: 'peer', key: peerKey, write: true },
      ]) },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const lines = createInterface({ input: child.stdout })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Service startup timed out')), 35000)
    child.once('exit', code => { clearTimeout(timeout); reject(Error('Service stopped with code ' + code)) })
    lines.on('line', line => {
      if (line.includes('"type":"listening"')) {
        clearTimeout(timeout)
        resolve()
      }
      if (process.env.CUNLIAN_SMOKE_LOG) console.error(line)
    })
  })
  const { runScenario } = await import('../cloud/server/scenario.mjs')
  await runScenario({
    origin: 'http://127.0.0.1:' + port, apiKey, peerKey, human,
    taskbook: await readFile(new URL('../desktop/tests/fixtures/agent-refactor/mounting-plate-taskbook.pdf', import.meta.url)),
  })
  console.log('cloud smoke passed')
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
    await once(child, 'exit')
  }
  await rm(root, { recursive: true, force: true })
}
