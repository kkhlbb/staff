import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_TIMESTAMP_URL,
  buildSigningInvocation,
  buildVersionInfo,
  formatMakensisDefines,
  resolveSigningConfig,
} from './build-win-installer.mjs'

test('buildVersionInfo derives 4-part PE version and full metadata', () => {
  const info = buildVersionInfo('1.0.0')
  assert.equal(info.appVersion, '1.0.0')
  assert.equal(info.viVersion, '1.0.0.0')
  assert.equal(info.productName, '寸链')
  assert.equal(info.companyName, '寸链 (Cunlian)')
  assert.equal(info.fileDescription, '寸链 Windows x64 安装程序')
  assert.equal(info.originalFilename, 'cunlian-v1.0.0-windows-x64-setup.exe')
  assert.equal(info.internalName, 'cunlian-setup')
  assert.match(info.legalCopyright, /MIT License/)

  const prerelease = buildVersionInfo('2.3.4-beta.1', { originalFilename: 'custom-setup.exe' })
  assert.equal(prerelease.viVersion, '2.3.4.0')
  assert.equal(prerelease.appVersion, '2.3.4-beta.1')
  assert.equal(prerelease.originalFilename, 'custom-setup.exe')

  const fourPart = buildVersionInfo('1.2.3.45')
  assert.equal(fourPart.viVersion, '1.2.3.45')

  assert.throws(() => buildVersionInfo('not-a-version'), /Invalid application version/)
})

test('formatMakensisDefines emits UTF-8 charset and all PE version defines', () => {
  const info = buildVersionInfo('1.0.0')
  const args = formatMakensisDefines(info, {
    payload: '/tmp/payload$1',
    executable: '/tmp/out/setup.exe',
    generated: '/tmp/gen',
  })
  assert.equal(args[0], '-INPUTCHARSET')
  assert.equal(args[1], 'UTF8')
  assert(args.includes('-DPAYLOAD=/tmp/payload$$1'))
  assert(args.includes('-DEXECUTABLE=/tmp/out/setup.exe'))
  assert(args.includes('-DGENERATED=/tmp/gen'))
  assert(args.includes('-DAPP_VERSION=1.0.0'))
  assert(args.includes('-DVI_VERSION=1.0.0.0'))
  assert(args.includes('-DPRODUCT_NAME=寸链'))
  assert(args.includes('-DCOMPANY_NAME=寸链 (Cunlian)'))
  assert(args.includes('-DFILE_DESCRIPTION=寸链 Windows x64 安装程序'))
  assert(args.includes('-DORIGINAL_FILENAME=cunlian-v1.0.0-windows-x64-setup.exe'))
  assert(args.includes('-DINTERNAL_NAME=cunlian-setup'))
})

test('resolveSigningConfig returns disabled config when no credentials are set', () => {
  const config = resolveSigningConfig({}, 'darwin')
  assert.equal(config.enabled, false)
  assert.equal(config.mode, 'none')
  assert.equal(config.timestampUrl, DEFAULT_TIMESTAMP_URL)
})

test('resolveSigningConfig rejects partial PFX configuration', () => {
  assert.throws(
    () => resolveSigningConfig({ WIN_SIGN_PFX_PATH: '/path/to/cert.pfx' }, 'darwin'),
    /WIN_SIGN_PFX_PASSWORD/,
  )
  assert.throws(
    () => resolveSigningConfig({ WIN_SIGN_PFX_PASSWORD: 'secret' }, 'win32'),
    /WIN_SIGN_PFX_PATH/,
  )
})

test('PFX signing uses osslsigncode with RFC 3161 SHA-256 timestamping on macOS/Linux', () => {
  const config = resolveSigningConfig(
    {
      WIN_SIGN_PFX_PATH: '/certs/cunlian.pfx',
      WIN_SIGN_PFX_PASSWORD: 'test-password',
      WIN_SIGN_URL: 'https://example.invalid/cunlian',
    },
    'darwin',
  )
  assert.equal(config.enabled, true)
  assert.equal(config.mode, 'osslsigncode')
  assert.equal(config.tool, 'osslsigncode')

  const invocation = buildSigningInvocation(config, '/tmp/payload/寸链.exe', {
    description: '寸链',
  })
  assert.equal(invocation.program, 'osslsigncode')
  assert.equal(invocation.outputPath, '/tmp/payload/寸链.exe.signed')
  assert.deepEqual(invocation.args, [
    'sign',
    '-pkcs12', '/certs/cunlian.pfx',
    '-pass', 'test-password',
    '-h', 'sha256',
    '-ts', DEFAULT_TIMESTAMP_URL,
    '-n', '寸链',
    '-i', 'https://example.invalid/cunlian',
    '-in', '/tmp/payload/寸链.exe',
    '-out', '/tmp/payload/寸链.exe.signed',
  ])
})

test('PFX signing uses signtool with RFC 3161 SHA-256 timestamping on Windows', () => {
  const config = resolveSigningConfig(
    {
      WIN_SIGN_PFX_PATH: 'C:\\certs\\cunlian.pfx',
      WIN_SIGN_PFX_PASSWORD: 'test-password',
      WIN_SIGN_TIMESTAMP_URL: 'http://timestamp.sectigo.com',
      WIN_SIGN_TOOL: 'C:\\Program Files\\Windows Kits\\10\\bin\\signtool.exe',
    },
    'win32',
  )
  assert.equal(config.enabled, true)
  assert.equal(config.mode, 'signtool')

  const invocation = buildSigningInvocation(config, 'C:\\temp\\cunlian-v1.0.0-windows-x64-setup.exe', {
    description: '寸链 Windows x64 安装程序',
  })
  assert.equal(invocation.program, 'C:\\Program Files\\Windows Kits\\10\\bin\\signtool.exe')
  assert.equal(invocation.outputPath, null)
  assert.deepEqual(invocation.args, [
    'sign',
    '/fd', 'SHA256',
    '/f', 'C:\\certs\\cunlian.pfx',
    '/p', 'test-password',
    '/tr', 'http://timestamp.sectigo.com',
    '/td', 'SHA256',
    '/d', '寸链 Windows x64 安装程序',
    'C:\\temp\\cunlian-v1.0.0-windows-x64-setup.exe',
  ])
})

test('WIN_SIGN_COMMAND takes precedence and safely passes target path via env', () => {
  const unixConfig = resolveSigningConfig(
    {
      WIN_SIGN_COMMAND: 'my-signer --tsa {timestampUrl} --file {file}',
      WIN_SIGN_PFX_PATH: '/ignored.pfx',
      WIN_SIGN_PFX_PASSWORD: 'ignored',
    },
    'linux',
  )
  assert.equal(unixConfig.mode, 'custom')
  const unixInv = buildSigningInvocation(unixConfig, '/tmp/dir with space/寸链.exe', {
    description: '寸链',
  })
  assert.equal(unixInv.program, '/bin/sh')
  assert.deepEqual(unixInv.args, [
    '-c',
    `my-signer --tsa ${DEFAULT_TIMESTAMP_URL} --file "$WIN_SIGN_TARGET_FILE"`,
  ])
  assert.equal(unixInv.env.WIN_SIGN_TARGET_FILE, '/tmp/dir with space/寸链.exe')
  assert.equal(unixInv.outputPath, null)

  const winConfig = resolveSigningConfig(
    { WIN_SIGN_COMMAND: 'trusted-signing-cli sign' },
    'win32',
  )
  const winInv = buildSigningInvocation(winConfig, 'C:\\build\\setup.exe', { description: 'Setup' })
  assert.equal(winInv.program, 'cmd.exe')
  assert.deepEqual(winInv.args, ['/d', '/s', '/c', 'trusted-signing-cli sign "%WIN_SIGN_TARGET_FILE%"'])
  assert.equal(winInv.env.WIN_SIGN_TARGET_FILE, 'C:\\build\\setup.exe')
})
