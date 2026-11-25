import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
export async function buildLocalAgent(arch, localAgentResource) {
  const arches = arch === 'universal' ? ['arm64', 'x86_64'] :
    arch === 'x64' ? ['x86_64'] : arch === 'arm64' ? ['arm64'] : null
  if (!arches || process.platform !== 'darwin') throw Error('The local agent resource requires a macOS build host')
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  await build({
    configFile: false,
    publicDir: false,
    root,
    define: { __CUNLIAN_PACKAGE_VERSION__: JSON.stringify(version) },
    build: {
      outDir: localAgentResource,
      emptyOutDir: true,
      target: 'es2023',
      ssr: 'mcp/localBridge.ts',
      rolldownOptions: { output: { entryFileNames: 'local-bridge.mjs' } },
    },
  })
  const command = path.join(localAgentResource, 'cunlian-mcp')
  copyFileSync(path.join(root, 'mcp/cunlian-mcp.sh'), command)
  chmodSync(command, 0o755)
  execFileSync('/usr/bin/clang', [...arches.flatMap(arch => ['-arch', arch]), '-Wall', '-Wextra', '-Werror',
    path.join(root, 'desktop/main/project-agent/native/m1-peer.c'), '-o', path.join(localAgentResource, 'm1-peer')],
  { stdio: 'inherit' })
}
