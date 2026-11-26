#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = JSON.parse(await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
const appVersion = pkg.version
const expected = process.env.CUNLIAN_EXPECTED_ZIP_SHA256
const [zip, output] = process.argv.slice(2).map(file => path.resolve(file))
assert(zip && output, 'Usage: node scripts/build-win-installer.mjs INPUT.zip OUTPUT.exe')
assert.notEqual(zip, output)
const installer = fileURLToPath(new URL('./installer/', import.meta.url))
const hash = async file => {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}
const inputZipSha256 = await hash(zip)
if (expected) assert.equal(inputZipSha256, expected, 'Input ZIP SHA-256')
const temp = await mkdtemp(path.join(tmpdir(), 'cunlian-installer-'))
const run = (program, args, options = {}) => execFileSync(program, args, { encoding: 'utf8', ...options })
const ns = value => value.replaceAll('$', '$$').replaceAll('"', '$\\"')
const win = relative => ns(relative.replaceAll('/', '\\'))
const filesIn = async (root, relative = '') => {
  const files = []
  for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const name = path.posix.join(relative, entry.name)
    if (entry.isDirectory()) files.push(...await filesIn(root, name))
    else {
      assert(entry.isFile(), 'Unexpected archive entry: ' + name)
      files.push(name)
    }
  }
  return files
}
const machine = buffer => {
  assert.equal(buffer.readUInt16LE(0), 0x5a4d)
  const pe = buffer.readUInt32LE(0x3c)
  assert.equal(buffer.readUInt32LE(pe), 0x4550)
  return buffer.readUInt16LE(pe + 4)
}

try {
  const version = run('makensis', ['-VERSION']).trim()
  assert.match(version, /^v?3\./)
  console.log('macOS makensis', version)
  run('ditto', ['-x', '-k', zip, temp])
  const payload = path.join(temp, '寸链-win32-x64')
  const files = await filesIn(payload)
  const agent = 'resources/cunlian-agent/'
  const extras = ['mcp-config.mjs', 'run-mcp-config.mjs', 'mcp-config.json', '.installer-mcp-owner.json'].map(name => agent + name)
  const directories = new Set()
  for (const file of [...files, ...extras]) {
    for (let directory = path.posix.dirname(file); directory !== '.'; directory = path.posix.dirname(directory)) directories.add(directory)
  }
  const guards = [...files, ...extras, 'uninstall.exe'].map(file =>
    'IfFileExists "$INSTDIR\\' + win(file) + '" collision')
  const cleanup = [...files, ...extras].map(file => 'Delete "$INSTDIR\\' + win(file) + '"')
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) cleanup.push('RMDir "$INSTDIR\\' + win(directory) + '"')
  await writeFile(path.join(temp, 'guard.nsh'), guards.join('\n') + '\n')
  await writeFile(path.join(temp, 'cleanup.nsh'), cleanup.join('\n') + '\n')
  const setupPath = path.join(temp, `cunlian-v${appVersion}-windows-x64-setup.exe`)
  run('makensis', ['-INPUTCHARSET', 'UTF8', '-DPAYLOAD=' + ns(payload), '-DEXECUTABLE=' + ns(setupPath),
    '-DGENERATED=' + ns(temp), 'cunlian-win-x64.nsi'], { cwd: installer, stdio: 'inherit' })

  const listing = run('7zz', ['l', '-slt', setupPath])
  assert.match(listing, /Type = Nsis/i)
  assert.match(listing, /SubType = NSIS-3 Unicode/i)
  const extracted = path.join(temp, 'verify')
  run('7zz', ['x', '-y', '-o' + extracted, setupPath])
  const setup = await readFile(setupPath)
  const setupMachine = machine(setup)
  assert([0x14c, 0x8664].includes(setupMachine))
  for (const value of [appVersion, 'ProductVersion', 'FileVersion']) {
    assert(setup.includes(Buffer.from(value, 'utf16le')), 'Missing PE version metadata: ' + value)
  }
  for (const file of files) {
    assert.equal(await hash(path.join(extracted, file)), await hash(path.join(payload, file)), file)
  }
  for (const file of ['寸链.exe', agent + 'm1-peer.exe']) {
    assert.equal(machine(await readFile(path.join(extracted, file))), 0x8664)
  }
  for (const file of [agent + 'cunlian-mcp.cmd', agent + 'local-bridge.mjs',
    'resources/app.asar.unpacked/.vite/build/m2-worker/m2-geometry-worker.mjs',
    'resources/app.asar.unpacked/.vite/build/m2-worker/solverWorker.mjs',
    'resources/occt-unified/cunlian_occt.wasm']) {
    assert(files.includes(file), file)
  }
  for (const file of ['mcp-config.mjs', 'run-mcp-config.mjs']) {
    assert.equal(await hash(path.join(extracted, agent, file)), await hash(path.join(installer, file)))
  }
  const asar = await readFile(path.join(extracted, 'resources/app.asar'))
  const header = JSON.parse(asar.subarray(16, 16 + asar.readUInt32LE(12)).toString('utf8'))
  const build = header.files['.vite'].files.build.files
  const pdfWorker = Object.entries(build).find(([name]) => /^pdf\.worker.*\.mjs$/.test(name))
  assert(pdfWorker, 'Missing PDF worker in the app.asar runtime directory')
  const [pdfName, pdfEntry] = pdfWorker
  assert(pdfEntry.size > 0)
  const pdfStart = 8 + asar.readUInt32LE(4) + Number(pdfEntry.offset)
  const pdfBytes = pdfEntry.unpacked
    ? await readFile(path.join(extracted, 'resources/app.asar.unpacked/.vite/build', pdfName))
    : asar.subarray(pdfStart, pdfStart + pdfEntry.size)
  assert.equal(pdfBytes.length, pdfEntry.size)
  assert(pdfBytes.includes(Buffer.from('pdfjsWorker')))
  const pdfWorkerSha256 = createHash('sha256').update(pdfBytes).digest('hex')
  assert.equal(pdfWorkerSha256, pdfEntry.integrity.hash)
  await mkdir(path.dirname(output), { recursive: true })
  await copyFile(setupPath, output)
  console.log(JSON.stringify({
    output, bytes: setup.length, sha256: await hash(output), inputZipSha256,
    installerMachine: '0x' + setupMachine.toString(16), payloadMachine: 'AMD64',
    payloadFilesByteIdentical: files.length, pdfWorker: pdfName, pdfWorkerUnpacked: !!pdfEntry.unpacked,
    pdfWorkerSha256,
  }, null, 2))
} finally {
  await rm(temp, { recursive: true, force: true })
}
