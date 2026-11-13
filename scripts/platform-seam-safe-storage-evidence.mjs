#!/usr/bin/env node
/**
 * 平台防腐层证据（密钥部分）：在**真实 Electron 主进程**里跑 safeStorage。
 *
 * 为什么不用单测：`safeStorage` 只存在于 Electron 运行时，Node 里没有。这里把
 * `desktop/main/keychain.ts` 原样编译成 CJS，交给 Electron 主进程 require，
 * 用系统真实后端（macOS Keychain / Windows DPAPI）做加解密与迁移。
 *
 * 检查项（全部只输出布尔/计数，密钥与路径一律不进证据）：
 * 1. `isEncryptionAvailable()` 为真；
 * 2. 写入 → 读取还原；
 * 3. 密文文件里没有明文、权限 0600；
 * 4. 迁移：旧 Keychain 预置 → 首次读取成功 → 密文文件里有 → 删旧记录仍能读（含新实例）；
 * 5. 删除同时清掉旧记录，读回 null；
 * 6. 临时目录全树扫描不到明文。
 *
 * 用法：node scripts/platform-seam-safe-storage-evidence.mjs
 * 输出：docs/evidence/platform-seam/safeStorage.json（serializeEvidence）+ logs/ 日志
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const repoRoot = process.cwd()
const probeDir = path.join(repoRoot, 'out', 'platform-seam-probe')
const rawOut = path.join(probeDir, 'safestorage-raw.json')

await fsp.rm(probeDir, { recursive: true, force: true })
await fsp.mkdir(probeDir, { recursive: true })

// 1) 把真实源码编译成 CJS（只编译，不改源码）。
const tsc = spawnSync(
  path.join(repoRoot, 'node_modules', '.bin', 'tsc'),
  [
    'desktop/main/keychain.ts',
    'scripts/evidence-json.ts',
    '--outDir',
    probeDir,
    '--module',
    'commonjs',
    '--target',
    'es2022',
    '--moduleResolution',
    'node',
    '--skipLibCheck',
    '--esModuleInterop',
    '--types',
    'node',
  ],
  { encoding: 'utf8' },
)
if (tsc.status !== 0) {
  console.error('TYPE_COMPILE_FAILED')
  console.error(`${tsc.stdout}${tsc.stderr}`)
  process.exit(1)
}
for (const file of ['desktop/main/keychain.js', 'scripts/evidence-json.js']) {
  await fsp.rename(path.join(probeDir, file), path.join(probeDir, file.replace(/\.js$/u, '.cjs')))
}

// 2) Electron 主进程探针：只 require 编译产物，走产品同一份实现。
const probeMain = path.join(probeDir, 'probe-main.cjs')
await fsp.writeFile(
  probeMain,
  `const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { SafeStorageStore, MacKeychainStore } = require(${JSON.stringify(path.join(probeDir, 'desktop/main/keychain.cjs'))})

const SECRET = 'sk-platform-seam-electron-probe-0001'
const LEGACY_SERVICE = 'com.kkhlbb.cunlian.probe.' + process.pid
const ACCOUNT = 'openai-compatible-1'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cunlian-safestorage-'))
const filePath = path.join(dir, 'model-key-store.json')
const result = { platform: process.platform, electron: process.versions.electron, appName: app.getName() }

function scanForPlaintext(root) {
  const hits = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (fs.statSync(full).size < 1024 * 1024 && fs.readFileSync(full, 'utf8').includes(SECRET)) hits.push(entry.name)
    }
  }
  walk(root)
  return hits
}

async function main() {
  result.encryptionAvailable = safeStorage.isEncryptionAvailable()
  result.backend = process.platform === 'darwin' ? 'keychain' : process.platform === 'win32' ? 'dpapi' : 'unknown'

  const store = new SafeStorageStore({ filePath, safeStorage, legacy: null })
  await store.write(ACCOUNT, SECRET)
  result.roundTrip = (await store.read(ACCOUNT)) === SECRET
  const raw = fs.readFileSync(filePath, 'utf8')
  result.file = {
    bytes: Buffer.byteLength(raw),
    containsPlaintext: raw.includes(SECRET),
    entries: Object.keys(JSON.parse(raw).entries).length,
    mode: '0o' + (fs.statSync(filePath).mode & 0o777).toString(8),
  }

  // 迁移：旧 macOS Keychain 预置 → safeStorage 重存 → 删旧记录仍能读。
  const legacy = new MacKeychainStore(LEGACY_SERVICE)
  const migrateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cunlian-migrate-'))
  const migrateFile = path.join(migrateDir, 'model-key-store.json')
  result.migration = { preseeded: false, firstRead: false, storedInSafeStorage: false, legacyDeleted: false, readAfterLegacyDelete: false, readByNewInstance: false, plaintextInFile: null }
  if (process.platform === 'darwin') {
    await legacy.write(ACCOUNT, SECRET)
    result.migration.preseeded = (await legacy.read(ACCOUNT)) === SECRET
    const migrating = new SafeStorageStore({ filePath: migrateFile, safeStorage, legacy })
    result.migration.firstRead = (await migrating.read(ACCOUNT)) === SECRET
    const migrateRaw = fs.existsSync(migrateFile) ? fs.readFileSync(migrateFile, 'utf8') : ''
    result.migration.storedInSafeStorage = Object.keys(JSON.parse(migrateRaw || '{"entries":{}}').entries).includes(ACCOUNT)
    result.migration.plaintextInFile = migrateRaw.includes(SECRET) ? true : false
    await legacy.remove(ACCOUNT)
    result.migration.legacyDeleted = (await legacy.read(ACCOUNT)) === null
    result.migration.readAfterLegacyDelete = (await migrating.read(ACCOUNT)) === SECRET
    const reopened = new SafeStorageStore({ filePath: migrateFile, safeStorage, legacy })
    result.migration.readByNewInstance = (await reopened.read(ACCOUNT)) === SECRET
    await reopened.remove(ACCOUNT)
    result.migration.deleteClearedLegacy = (await legacy.read(ACCOUNT)) === null
    result.migration.readAfterRemove = (await reopened.read(ACCOUNT)) === null
  } else {
    // Windows 上没有 security 命令：旧版本本来就没法存密钥，没有可迁移的遗留记录。
    result.migration.skipped = 'no-legacy-keychain-on-this-platform'
  }

  result.plaintextHitsInTempDirs = scanForPlaintext(dir).concat(process.platform === 'darwin' ? scanForPlaintext(migrateDir) : [])
  await store.remove(ACCOUNT)
  result.afterRemove = (await store.read(ACCOUNT)) === null

  result.verdict =
    result.encryptionAvailable === true &&
    result.roundTrip === true &&
    result.file.containsPlaintext === false &&
    result.file.mode === '0o600' &&
    result.plaintextHitsInTempDirs.length === 0 &&
    result.afterRemove === true &&
    (process.platform !== 'darwin' ||
      (result.migration.preseeded && result.migration.firstRead && result.migration.storedInSafeStorage &&
        result.migration.plaintextInFile === false && result.migration.legacyDeleted &&
        result.migration.readAfterLegacyDelete && result.migration.readByNewInstance &&
        result.migration.deleteClearedLegacy && result.migration.readAfterRemove))
      ? 'pass'
      : 'fail'
  console.log('PROBE_RESULT=' + JSON.stringify(result))
  app.exit(result.verdict === 'pass' ? 0 : 1)
}

app.whenReady().then(main).catch((error) => {
  console.log('PROBE_ERROR=' + JSON.stringify({ name: error && error.name, message: error && String(error.message).slice(0, 200) }))
  app.exit(2)
})
`,
  'utf8',
)

// 3) 跑真实 Electron（本机 shell 带 ELECTRON_RUN_AS_NODE=1，必须去掉才是 GUI/主进程）。
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.ELECTRON_ENABLE_LOGGING = '0'
const run = spawnSync(path.join(repoRoot, 'node_modules', '.bin', 'electron'), [probeMain], {
  cwd: repoRoot,
  encoding: 'utf8',
  env,
  timeout: 180_000,
})
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
const logDir = path.join(repoRoot, 'docs', 'evidence', 'platform-seam', 'logs')
await fsp.mkdir(logDir, { recursive: true })
await fsp.writeFile(
  path.join(logDir, 'safeStorage-electron.log'),
  `# node scripts/platform-seam-safe-storage-evidence.mjs\n# exit=${run.status} signal=${run.signal ?? 'none'}\n${output}\n`,
)

const line = output.split('\n').find((item) => item.startsWith('PROBE_RESULT='))
if (line === undefined) {
  console.error('SAFE_STORAGE_PROBE_FAILED：Electron 探针没有产出结果（第一处输出如下）')
  console.error(output.slice(0, 2000))
  process.exit(1)
}
const result = JSON.parse(line.slice('PROBE_RESULT='.length))

// 4) 归一化落证据（机器路径不进 JSON）。
const requireCjs = createRequire(import.meta.url)
const { serializeEvidence } = requireCjs(path.join(probeDir, 'scripts/evidence-json.cjs'))
const report = {
  generator: 'platform-seam-safe-storage-1',
  note: '在真实 Electron 主进程里跑 desktop/main/keychain.ts（编译成 CJS 后 require），后端由系统提供',
  ...result,
  exit: run.status,
}
const evidenceDir = path.join(repoRoot, 'docs', 'evidence', 'platform-seam')
await fsp.writeFile(path.join(evidenceDir, 'safeStorage.json'), serializeEvidence(report))
await fsp.writeFile(rawOut, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))
process.exit(result.verdict === 'pass' ? 0 : 1)
