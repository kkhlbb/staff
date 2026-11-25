import { createHash, randomUUID } from 'node:crypto'
import { constants, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runGeometryProbe } from './probe.mjs'

const require = createRequire(import.meta.url)
const version = '1.2.1'
const integrity = 'sha512-nFWkL5+24JiN1sv5fLGhdQr3FKCOLR3PIBkeZJcLm37p4eraEtD7Jueo8dP2BoqClJwb9hTSkf2QMli3GVqhpg=='
const manifestName = 'geometry-assets.json'
const kernelDir = 'replicad-opencascadejs'
const vendorHashes = {
  'package.json': '082bf561981d3c676e16ed48b9851f1a1c3d940ec4b7ce12ee2bce25f168a551',
  LICENSE: '20c17d8b8c48a600800dfd14f95d5cb9ff47066a9641ddeab48dc54aec96e331',
  'dist/replicad_single.cjs': 'e13327f9a883a467eabf1eee8635c7b3687be96dd100acb6bff8a68759b7dfff',
  'dist/replicad_single.js': '465b68c209b416396857fad30a6e33e7f5407907373cfe240c194af6d80c4a1d',
  'dist/replicad_single.wasm': 'a9335919fa64bfeaee3e241d3139ad134022682429c6688e20d8ca12093d33d9',
}
const vendorFiles = Object.keys(vendorHashes).map((name) => kernelDir + '/' + name)
const expectedFiles = [...vendorFiles, 'fixture.json', 'worker.mjs']
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const localPath = (name) => fileURLToPath(new URL(name, import.meta.url))

function readAsset(directory, name) {
  // Check parent directories as well so the staged set cannot resolve via symlinks.
  const parts = name.split('/')
  let path = directory
  if (!lstatSync(path).isDirectory()) throw new Error('Invalid geometry resource directory')
  for (const part of parts.slice(0, -1)) {
    path = join(path, part)
    if (!lstatSync(path).isDirectory()) throw new Error('Invalid geometry asset directory: ' + name)
  }
  path = join(path, parts.at(-1))
  if (!lstatSync(path).isFile()) throw new Error('Invalid geometry asset file: ' + name)
  return readFileSync(path, { flag: constants.O_RDONLY | constants.O_NOFOLLOW })
}

function checkVendor(name, bytes) {
  if (digest(bytes) !== vendorHashes[name]) throw new Error('Unexpected Replicad SHA-256: ' + name)
}

export async function prepareGeometryResources(parent) {
  const lock = JSON.parse(readFileSync(localPath('../../../package-lock.json')))
  const locked = lock.packages['node_modules/' + kernelDir]
  if (locked?.version !== version || locked.integrity !== integrity) {
    throw new Error('Unexpected Replicad lock entry')
  }
  const source = dirname(require.resolve('replicad-opencascadejs/package.json'))
  const assets = new Map()
  for (const name of Object.keys(vendorHashes)) {
    const bytes = readAsset(source, name)
    checkVendor(name, bytes)
    assets.set(kernelDir + '/' + name, bytes)
  }
  const { build } = await import('vite')
  const result = await build({
    configFile: false, envFile: false, publicDir: false, logLevel: 'error',
    build: {
      ssr: localPath('worker.mjs'), target: 'esnext', write: false,
      minify: false, reportCompressedSize: false,
      rolldownOptions: { output: { entryFileNames: 'worker.mjs' } },
    },
  })
  const [worker] = result.output ?? []
  if (result.output?.length !== 1 || worker.type !== 'chunk' || worker.fileName !== 'worker.mjs') {
    throw new Error('Expected one standalone geometry worker module')
  }
  assets.set('fixture.json', readFileSync(localPath('fixture.json')))
  assets.set('worker.mjs', Buffer.from(worker.code))

  const directory = mkdtempSync(join(realpathSync(parent), 'geometry-prototype-'))
  for (const [name, bytes] of assets) {
    const path = join(directory, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes, { flag: 'wx' })
  }
  const sha256 = Object.fromEntries([...assets].map(([name, bytes]) => [name, digest(bytes)]))
  const manifest = JSON.stringify({ package: kernelDir, version, sha256 }, null, 2) + '\n'
  writeFileSync(join(directory, manifestName), manifest, { flag: 'wx' })
  return {
    directory,
    manifestSha256: digest(manifest),
    scope: 'development staging only',
    upstreamNotice: {
      package: kernelDir, version, declaredLicense: locked.license, stagedLicense: kernelDir + '/LICENSE',
      distributionReview: 'pending corresponding source, replacement or relinking, notices and SBOM',
    },
  }
}

function verifyInventory(directory, names) {
  const entries = readdirSync(directory, { withFileTypes: true })
  const groups = new Map()
  for (const name of names) {
    const [head, ...tail] = name.split('/')
    if (!groups.has(head)) groups.set(head, [])
    if (tail.length) groups.get(head).push(tail.join('/'))
  }
  if (entries.length !== groups.size) throw new Error('Unexpected geometry resource inventory: ' + directory)
  for (const entry of entries) {
    const children = groups.get(entry.name)
    if (children === undefined) throw new Error('Unexpected geometry resource: ' + entry.name)
    if (children.length) {
      if (!entry.isDirectory()) throw new Error('Invalid geometry asset directory: ' + entry.name)
      verifyInventory(join(directory, entry.name), children)
    } else if (!entry.isFile()) {
      throw new Error('Invalid geometry asset file: ' + entry.name)
    }
  }
}

export function verifyGeometryResources(directory, trustedManifestSha256) {
  // This digest must come from the build receipt held separately from staged assets.
  const bytes = readAsset(directory, manifestName)
  if (digest(bytes) !== trustedManifestSha256) throw new Error('Geometry manifest SHA-256 mismatch')
  const manifest = JSON.parse(bytes)
  if (manifest?.package !== kernelDir || manifest.version !== version ||
      Object.keys(manifest).length !== 3 || !manifest.sha256 || Array.isArray(manifest.sha256) ||
      Object.keys(manifest.sha256).length !== expectedFiles.length ||
      !expectedFiles.every((name) => Object.hasOwn(manifest.sha256, name) &&
        typeof manifest.sha256[name] === 'string' && /^[a-f0-9]{64}$/.test(manifest.sha256[name]))) {
    throw new Error('Unexpected geometry asset manifest')
  }
  for (const name of expectedFiles) {
    const asset = readAsset(directory, name)
    if (digest(asset) !== manifest.sha256[name]) throw new Error('Geometry asset SHA-256 mismatch: ' + name)
    if (name.startsWith(kernelDir + '/')) checkVendor(name.slice(kernelDir.length + 1), asset)
  }
  verifyInventory(directory, [manifestName, ...expectedFiles])
  return manifest.sha256['fixture.json']
}

export async function smokeGeometryWorker(directory, trustedManifestSha256, options) {
  const inputFingerprint = verifyGeometryResources(directory, trustedManifestSha256)
  return runGeometryProbe(join(realpathSync(directory), 'worker.mjs'), {
    jobId: randomUUID(), attempt: 1, inputFingerprint,
  }, options)
}
