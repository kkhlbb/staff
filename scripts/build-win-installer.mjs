#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_TIMESTAMP_URL = 'http://timestamp.digicert.com'

export const ns = value => String(value).replaceAll('$', () => '$$').replaceAll('"', () => '$\\"')
export const win = relative => ns(relative.replaceAll('/', '\\'))

/**
 * Derive PE VersionInfo fields from a SemVer app version string.
 */
export function buildVersionInfo(appVersion, { originalFilename } = {}) {
  const version = String(appVersion ?? '').trim()
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/)
  assert(match, `Invalid application version for PE VersionInfo: ${appVersion}`)
  const viVersion = `${match[1]}.${match[2]}.${match[3]}.${match[4] ?? '0'}`
  return {
    appVersion: version,
    viVersion,
    productName: '寸链',
    companyName: '寸链 (Cunlian)',
    fileDescription: '寸链 Windows x64 安装程序',
    legalCopyright: 'Copyright (c) 寸链 (MIT License)',
    originalFilename: originalFilename || `cunlian-v${version}-windows-x64-setup.exe`,
    internalName: 'cunlian-setup',
  }
}

/**
 * Format makensis -D defines for the NSIS script.
 */
export function formatMakensisDefines(versionInfo, { payload, executable, generated }) {
  return [
    '-INPUTCHARSET', 'UTF8',
    '-DPAYLOAD=' + ns(payload),
    '-DEXECUTABLE=' + ns(executable),
    '-DGENERATED=' + ns(generated),
    '-DAPP_VERSION=' + ns(versionInfo.appVersion),
    '-DVI_VERSION=' + ns(versionInfo.viVersion),
    '-DPRODUCT_NAME=' + ns(versionInfo.productName),
    '-DCOMPANY_NAME=' + ns(versionInfo.companyName),
    '-DFILE_DESCRIPTION=' + ns(versionInfo.fileDescription),
    '-DLEGAL_COPYRIGHT=' + ns(versionInfo.legalCopyright),
    '-DORIGINAL_FILENAME=' + ns(versionInfo.originalFilename),
    '-DINTERNAL_NAME=' + ns(versionInfo.internalName),
  ]
}

/**
 * Resolve optional Authenticode signing configuration from environment variables.
 *
 * Precedence:
 * 1. WIN_SIGN_COMMAND (custom signing command; supports {file} placeholder)
 * 2. WIN_SIGN_PFX_PATH + WIN_SIGN_PFX_PASSWORD (signtool on Windows, osslsigncode on macOS/Linux)
 * 3. None (unsigned build with non-fatal notice)
 */
export function resolveSigningConfig(env = process.env, platform = process.platform) {
  const customCommand = env.WIN_SIGN_COMMAND?.trim()
  const timestampUrl = env.WIN_SIGN_TIMESTAMP_URL?.trim() || DEFAULT_TIMESTAMP_URL
  const url = env.WIN_SIGN_URL?.trim() || ''

  if (customCommand) {
    return {
      enabled: true,
      mode: 'custom',
      command: customCommand,
      timestampUrl,
      url,
      platform,
    }
  }

  const pfxPath = env.WIN_SIGN_PFX_PATH?.trim() || ''
  const pfxPassword = env.WIN_SIGN_PFX_PASSWORD ?? ''
  if (pfxPath || pfxPassword) {
    assert(pfxPath, 'WIN_SIGN_PFX_PATH must be set when WIN_SIGN_PFX_PASSWORD is provided')
    assert(pfxPassword, 'WIN_SIGN_PFX_PASSWORD must be set when WIN_SIGN_PFX_PATH is provided')
    const isWin = platform === 'win32'
    return {
      enabled: true,
      mode: isWin ? 'signtool' : 'osslsigncode',
      tool: env.WIN_SIGN_TOOL?.trim() || (isWin ? 'signtool' : 'osslsigncode'),
      pfxPath,
      pfxPassword,
      timestampUrl,
      url,
      platform,
    }
  }

  return {
    enabled: false,
    mode: 'none',
    timestampUrl,
    url,
    platform,
  }
}

/**
 * Build the process invocation needed to Authenticode-sign a PE binary.
 * Returns { program, args, env, outputPath } where outputPath is non-null
 * when the signer writes to a separate file that must replace targetPath.
 */
export function buildSigningInvocation(config, targetPath, { description = '' } = {}) {
  assert(config?.enabled, 'Signing configuration is not enabled')
  assert(targetPath, 'targetPath is required for signing')

  if (config.mode === 'custom') {
    const isWin = config.platform === 'win32'
    const token = isWin ? '"%WIN_SIGN_TARGET_FILE%"' : '"$WIN_SIGN_TARGET_FILE"'
    const hasPlaceholder = config.command.includes('{file}')
    const expanded = (hasPlaceholder
      ? config.command.replaceAll('{file}', token)
      : `${config.command} ${token}`)
      .replaceAll('{timestampUrl}', config.timestampUrl)
      .replaceAll('{description}', description)
    return {
      program: isWin ? 'cmd.exe' : '/bin/sh',
      args: isWin ? ['/d', '/s', '/c', expanded] : ['-c', expanded],
      env: {
        WIN_SIGN_TARGET_FILE: targetPath,
        WIN_SIGN_TIMESTAMP_URL: config.timestampUrl,
        WIN_SIGN_DESCRIPTION: description,
      },
      outputPath: null,
    }
  }

  if (config.mode === 'signtool') {
    const args = [
      'sign',
      '/fd', 'SHA256',
      '/f', config.pfxPath,
      '/p', config.pfxPassword,
      '/tr', config.timestampUrl,
      '/td', 'SHA256',
    ]
    if (description) args.push('/d', description)
    if (config.url) args.push('/du', config.url)
    args.push(targetPath)
    return {
      program: config.tool,
      args,
      env: {},
      outputPath: null,
    }
  }

  if (config.mode === 'osslsigncode') {
    const outputPath = `${targetPath}.signed`
    const args = [
      'sign',
      '-pkcs12', config.pfxPath,
      '-pass', config.pfxPassword,
      '-h', 'sha256',
      '-ts', config.timestampUrl,
    ]
    if (description) args.push('-n', description)
    if (config.url) args.push('-i', config.url)
    args.push('-in', targetPath, '-out', outputPath)
    return {
      program: config.tool,
      args,
      env: {},
      outputPath,
    }
  }

  throw new Error(`Unsupported signing mode: ${config.mode}`)
}

async function signExecutable(config, targetPath, { description, run }) {
  const invocation = buildSigningInvocation(config, targetPath, { description })
  console.log(`[win-installer] Authenticode signing (${config.mode}): ${path.basename(targetPath)}`)
  run(invocation.program, invocation.args, {
    stdio: 'inherit',
    env: { ...process.env, ...invocation.env },
  })
  if (invocation.outputPath) {
    await rename(invocation.outputPath, targetPath)
  }
}

const hash = async file => {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}

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

async function main() {
  const pkg = JSON.parse(await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  const appVersion = pkg.version
  const expected = process.env.CUNLIAN_EXPECTED_ZIP_SHA256
  const [zip, output] = process.argv.slice(2).map(file => path.resolve(file))
  assert(zip && output, 'Usage: node scripts/build-win-installer.mjs INPUT.zip OUTPUT.exe')
  assert.notEqual(zip, output)

  const installer = fileURLToPath(new URL('./installer/', import.meta.url))
  const versionInfo = buildVersionInfo(appVersion, { originalFilename: path.basename(output) })
  const signingConfig = resolveSigningConfig(process.env, process.platform)
  if (!signingConfig.enabled) {
    console.log('[win-installer] Notice: Authenticode signing skipped (set WIN_SIGN_PFX_PATH + WIN_SIGN_PFX_PASSWORD or WIN_SIGN_COMMAND to enable). See docs/windows-code-signing.md.')
  }

  const inputZipSha256 = await hash(zip)
  if (expected) assert.equal(inputZipSha256, expected, 'Input ZIP SHA-256')
  const temp = await mkdtemp(path.join(tmpdir(), 'cunlian-installer-'))
  const run = (program, args, options = {}) => execFileSync(program, args, { encoding: 'utf8', ...options })

  try {
    const version = run('makensis', ['-VERSION']).trim()
    assert.match(version, /^v?3\./)
    console.log('makensis', version)
    if (process.platform === 'darwin') {
      run('ditto', ['-x', '-k', zip, temp])
    } else {
      run('7zz', ['x', '-y', '-o' + temp, zip])
    }
    const payload = path.join(temp, '寸链-win32-x64')
    if (signingConfig.enabled) {
      await signExecutable(signingConfig, path.join(payload, '寸链.exe'), {
        description: versionInfo.productName,
        run,
      })
    }

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
    const makensisArgs = [
      ...formatMakensisDefines(versionInfo, { payload, executable: setupPath, generated: temp }),
      'cunlian-win-x64.nsi',
    ]
    run('makensis', makensisArgs, { cwd: installer, stdio: 'inherit' })

    if (signingConfig.enabled) {
      await signExecutable(signingConfig, setupPath, {
        description: versionInfo.fileDescription,
        run,
      })
    }

    const listing = run('7zz', ['l', '-slt', setupPath])
    assert.match(listing, /Type = Nsis/i)
    assert.match(listing, /SubType = NSIS-3 Unicode/i)
    const extracted = path.join(temp, 'verify')
    run('7zz', ['x', '-y', '-o' + extracted, setupPath])
    const setup = await readFile(setupPath)
    const setupMachine = machine(setup)
    assert([0x14c, 0x8664].includes(setupMachine))
    for (const value of [
      versionInfo.appVersion,
      'ProductName',
      'CompanyName',
      'FileDescription',
      'FileVersion',
      'ProductVersion',
      'LegalCopyright',
      'OriginalFilename',
      'InternalName',
      versionInfo.originalFilename,
      versionInfo.internalName,
    ]) {
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
      output,
      bytes: setup.length,
      sha256: await hash(output),
      inputZipSha256,
      installerMachine: '0x' + setupMachine.toString(16),
      payloadMachine: 'AMD64',
      payloadFilesByteIdentical: files.length,
      pdfWorker: pdfName,
      pdfWorkerUnpacked: !!pdfEntry.unpacked,
      pdfWorkerSha256,
      signed: signingConfig.enabled,
      signingMode: signingConfig.mode,
      viVersion: versionInfo.viVersion,
    }, null, 2))
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
