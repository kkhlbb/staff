import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { auditWindowsZipEntries, parseZipCentralDirectory } from './build-win-zip.mjs'

test('auditWindowsZipEntries flags missing UTF-8 bit, AppleDouble, __MACOSX, and symlinks', () => {
  const issues = auditWindowsZipEntries([
    { name: '寸链-win32-x64/寸链.exe', flags: 0, hasNonAscii: true, isUtf8: false, isSymlink: false },
    { name: '寸链-win32-x64/._寸链.exe', flags: 0x0800, hasNonAscii: true, isUtf8: true, isSymlink: false },
    { name: '__MACOSX/寸链-win32-x64/._file', flags: 0x0800, hasNonAscii: true, isUtf8: true, isSymlink: false },
    { name: '寸链-win32-x64/.DS_Store', flags: 0x0800, hasNonAscii: true, isUtf8: true, isSymlink: false },
    { name: '寸链-win32-x64/link', flags: 0x0800, hasNonAscii: true, isUtf8: true, isSymlink: true },
  ])
  assert.equal(issues.length, 5)
  assert.match(issues[0], /^NON_UTF8_FLAG:/)
  assert.match(issues[1], /^MACOS_METADATA:/)
  assert.match(issues[2], /^MACOS_METADATA:/)
  assert.match(issues[3], /^MACOS_METADATA:/)
  assert.match(issues[4], /^SYMLINK:/)
})

test('7zz -mcu=on produces UTF-8 flagged ZIP passing parseZipCentralDirectory & audit', t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cunlian-win-zip-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const payload = path.join(dir, '寸链-win32-x64')
  mkdirSync(payload)
  writeFileSync(path.join(payload, '寸链.exe'), 'dummy')
  writeFileSync(path.join(payload, '._寸链.exe'), 'appledouble')
  writeFileSync(path.join(payload, '.DS_Store'), 'junk')
  const outZip = path.join(dir, 'out.zip')

  execFileSync(
    '7zz',
    ['a', '-tzip', '-mcu=on', '-xr!._*', '-xr!.DS_Store', '-xr!__MACOSX', outZip, '寸链-win32-x64'],
    { cwd: dir, stdio: 'ignore' },
  )
  const entries = parseZipCentralDirectory(readFileSync(outZip))
  assert.equal(auditWindowsZipEntries(entries).length, 0)
  const exeEntry = entries.find(e => e.name === '寸链-win32-x64/寸链.exe')
  assert(exeEntry, 'Expected UTF-8 寸链-win32-x64/寸链.exe entry')
  assert.equal(exeEntry.isUtf8, true)
})
