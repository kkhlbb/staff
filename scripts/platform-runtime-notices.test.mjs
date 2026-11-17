import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { copyPlatformRuntimeNotices } from './platform-runtime-notices.mjs'
const base = path.resolve('node_modules/.cache/notice-tests')
mkdirSync(base, { recursive: true })
for (const platform of ['win32', 'darwin']) {
  test(`copies target originals: ${platform}`, () => {
    const output = mkdtempSync(path.join(base, 'target-'))
    for (const name of ['LICENSE', 'LICENSES.chromium.html']) writeFileSync(path.join(output, name), `${platform}-${name}`)
    copyPlatformRuntimeNotices(output, platform, platform === 'darwin' ? 'arm64' : 'x64')
    const resources = platform === 'darwin' ? '寸链.app/Contents/Resources' : 'resources'
    for (const name of ['LICENSE', 'LICENSES.chromium.html']) assert.equal(readFileSync(path.join(output, resources, 'platform-runtime-notices', name), 'utf8'), `${platform}-${name}`)
  })
}
test('missing target original refuses fallback', () => {
  assert.throws(() => copyPlatformRuntimeNotices(mkdtempSync(path.join(base, 'missing-')), 'win32', 'x64'), /ENOENT/)
})
test('empty target original refuses fallback', () => {
  const output = mkdtempSync(path.join(base, 'empty-'))
  writeFileSync(path.join(output, 'LICENSE'), '')
  assert.throws(() => copyPlatformRuntimeNotices(output, 'win32', 'x64'), /EMPTY_PLATFORM_NOTICE/)
})
