import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile, rename } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import manifest from './manifest.json' with { type: 'json' }

const exec = promisify(execFile)
export const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export { manifest }

export function isMain(url) {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(url)
}

export function parseArgs(args) {
  const options = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help') options.help = true
    else if (arg === '--external') options.allowExternal = true
    else if (['--offline-dir', '--cache-dir'].includes(arg)) {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw Error('Missing path for ' + arg)
      options[arg === '--offline-dir' ? 'offlineDir' : 'cacheDir'] = resolve(value)
    } else throw Error('Unknown argument: ' + arg)
  }
  return options
}

async function verified(path, hash, bytes) {
  const content = await readFile(path)
  if (content.length !== bytes || sha256(content) !== hash) throw Error('SHA-256 or byte count mismatch: ' + path)
  return content
}

async function publish(path, bytes) {
  await mkdir(dirname(path), { recursive: true })
  const staging = await mkdtemp(join(dirname(path), '.staging-'))
  try {
    const tmp = join(staging, basename(path))
    await writeFile(tmp, bytes)
    await rename(tmp, path)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

export async function fetchExternal(options = {}) {
  const { offlineDir, allowExternal = false } = options
  const cacheDir = options.cacheDir ?? join(options.repoRoot ?? repoRoot, '.cache', 'benchmarks')
  let archive
  async function loadArchive() {
    const response = await fetch(manifest.nist.archiveUrl, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw Error('NIST archive HTTP ' + response.status)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (sha256(bytes) !== manifest.nist.archiveSha256) throw Error('NIST archive SHA-256 mismatch')
    const dir = await mkdtemp(join(cacheDir, 'nist-download-'))
    const path = join(dir, 'nist.zip')
    try {
      await writeFile(path, bytes)
    } catch (error) {
      await rm(dir, { recursive: true, force: true })
      throw error
    }
    return { path, dir }
  }

  await mkdir(cacheDir, { recursive: true })
  try {
    const results = []
    for (const asset of manifest.nist.assets) {
      const { id, file, member, sha256: hash, bytes } = asset
      const path = join(cacheDir, 'nist', file)
      const reasons = []
      const candidates = offlineDir
        ? [join(offlineDir, 'nist', file), join(offlineDir, file), join(offlineDir, member)]
        : [path]
      let ready = false
      for (const candidate of candidates) {
        try {
          const content = await verified(candidate, hash, bytes)
          if (resolve(candidate) !== resolve(path)) await publish(path, content)
          ready = true
          break
        } catch (error) {
          reasons.push(error.code === 'ENOENT' ? 'missing ' + candidate : error.message)
        }
      }
      if (!ready && !offlineDir && allowExternal) {
        try {
          const { path: zip } = await (archive ??= loadArchive())
          const { stdout } = await exec('unzip', ['-p', zip, member], { encoding: 'buffer', maxBuffer: bytes + 1024 })
          if (stdout.length !== bytes || sha256(stdout) !== hash) throw Error('NIST member SHA-256 mismatch: ' + member)
          await publish(path, stdout)
          ready = true
        } catch (error) {
          reasons.push(error.message)
        }
      }
      results.push(ready ? { id, status: 'READY', path } :
        { id, status: 'SKIPPED_EXTERNAL_ASSET', reason: reasons.join(' | ') })
    }
    return results
  } finally {
    if (archive) {
      const downloaded = await archive.catch(() => null)
      if (downloaded) await rm(downloaded.dir, { recursive: true, force: true })
    }
  }
}

export async function fetchFusion(options = {}) {
  const { offlineDir, allowExternal = false } = options
  const cacheDir = options.cacheDir ?? join(options.repoRoot ?? repoRoot, '.cache', 'benchmarks')
  if (!manifest.fusion360.assets.length) return [{
    id: 'FUSION360', status: 'SKIPPED_EXTERNAL_ASSET', reason: manifest.fusion360.reason,
  }]
  const results = []
  for (const asset of manifest.fusion360.assets) {
    try {
      const paths = {}
      for (const kind of ['step', 'truth']) {
        const { file, sha256: hash, bytes, url } = asset[kind]
        if (!file || basename(file) !== file || !/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(bytes) || bytes <= 0) {
          throw Error('Invalid pinned Fusion ' + kind + ' metadata')
        }
        const path = join(cacheDir, 'fusion360', file)
        paths[kind] = path
        const candidates = offlineDir ? [join(offlineDir, 'fusion360', file), join(offlineDir, file)] : [path]
        const failures = []
        let content
        for (const candidate of candidates) {
          try {
            content = await verified(candidate, hash, bytes)
            if (resolve(candidate) !== resolve(path)) await publish(path, content)
            break
          } catch (error) {
            content = undefined
            failures.push(error.message)
          }
        }
        if (!content && !offlineDir && allowExternal && url?.startsWith('https://')) {
          const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
          if (!response.ok) throw Error('Fusion asset HTTP ' + response.status + ': ' + file)
          content = Buffer.from(await response.arrayBuffer())
          if (content.length !== bytes || sha256(content) !== hash) throw Error('Fusion asset checksum mismatch: ' + file)
          await publish(path, content)
        }
        if (!content) throw Error(failures.join(' | '))
      }
      results.push({ id: asset.id, status: 'READY', paths, step: asset.step, truth: asset.truth })
    } catch (error) {
      results.push({ id: asset.id, status: 'SKIPPED_EXTERNAL_ASSET', reason: error.message })
    }
  }
  return results
}

if (isMain(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      console.log('Usage: node fetch-external.mjs [--offline-dir PATH] [--cache-dir PATH]\n' +
        'Downloads the pinned NIST archive via HTTPS and verifies each STEP. Offline mode reads only PATH.\n' +
        'Autodesk Fusion Gallery availability is reported separately.')
    } else {
      const fetchOptions = { ...options, allowExternal: !options.offlineDir }
      const [assets, fusion360] = await Promise.all([fetchExternal(fetchOptions), fetchFusion(fetchOptions)])
      console.log(JSON.stringify({ assets, fusion360 }, null, 2))
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
