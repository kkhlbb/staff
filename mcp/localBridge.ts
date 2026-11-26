import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { localM1Socket, isM1WindowsAbsolute } from '../desktop/main/project-agent/m1LocalTransport.ts'
import { LocalM1Client } from './localClient'
import { createLocalBridgeServer } from './lib/localServer'

declare const __CUNLIAN_PACKAGE_VERSION__: string

async function main() {
  const executable = process.argv[2]
  if (!executable || !(process.platform === 'win32' ? isM1WindowsAbsolute : path.isAbsolute)(executable)) throw Error('LOCAL_ENDPOINT_UNAVAILABLE')
  const peerHelper = fileURLToPath(new URL(process.platform === 'win32' ? './m1-peer.exe' : './m1-peer', import.meta.url))
  const client = new LocalM1Client({ executable, socketPath: localM1Socket(executable, peerHelper), peerHelper })
  const { startServer } = createLocalBridgeServer(client, async () => __CUNLIAN_PACKAGE_VERSION__)
  process.stdin.once('end', () => client.close())
  process.stdout.on('error', () => { client.close(); process.exitCode = 1; process.stdin.destroy() })
  try { await startServer() } finally { client.close() }
}

try {
  await main()
} catch {
  process.stderr.write('cunlian-local: 启动失败\n')
  process.exitCode = 1
}
