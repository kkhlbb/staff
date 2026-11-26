#!/usr/bin/env node
/**
 * Build a Windows-Explorer-clean portable ZIP from a packaged `寸链-win32-x64` directory.
 *
 * Why not macOS `ditto -c -k`?
 * `ditto` omits the ZIP UTF-8 filename flag bit (0x800) and embeds AppleDouble `._*`
 * resource-fork files (including `._寸链.exe`), causing mojibake filenames and broken
 * double-click behavior on Windows Explorer.
 *
 * This script uses `7zz a -tzip -mcu=on` so every non-ASCII entry sets flag bit 0x800
 * (UTF-8), excludes macOS metadata (`._*`, `.DS_Store`, `__MACOSX`), and audits the
 * resulting ZIP central directory + AMD64 PE headers.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ZIP_UTF8_FLAG = 0x0800
const UNIX_SYMLINK_MODE = 0o120000
const UNIX_FILETYPE_MASK = 0o170000

/**
 * Parse ZIP central directory entries directly from a Buffer so we can verify
 * UTF-8 flag bit (0x800), absence of AppleDouble/macOS junk, and absence of symlinks.
 */
export function parseZipCentralDirectory(buffer) {
  // Locate End of Central Directory (EOCD) signature 0x06054b50 from end of buffer.
  const minEocd = 22
  const searchStart = Math.max(0, buffer.length - 65557)
  let eocdOffset = -1
  for (let i = buffer.length - minEocd; i >= searchStart; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  assert(eocdOffset >= 0, 'Invalid ZIP: End of Central Directory not found')
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10)
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16)
  const entries = []
  let offset = cdOffset
  for (let i = 0; i < totalEntries; i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, `Invalid central directory header at ${offset}`)
    const flags = buffer.readUInt16LE(offset + 8)
    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const externalAttr = buffer.readUInt32LE(offset + 38)
    const nameBytes = buffer.subarray(offset + 46, offset + 46 + nameLen)
    const name = nameBytes.toString('utf8')
    const hasNonAscii = nameBytes.some(byte => byte >= 0x80)
    const isUtf8 = (flags & ZIP_UTF8_FLAG) !== 0
    const unixMode = (externalAttr >>> 16) & UNIX_FILETYPE_MASK
    const isSymlink = unixMode === UNIX_SYMLINK_MODE
    entries.push({ name, flags, hasNonAscii, isUtf8, isSymlink })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/**
 * Audit parsed ZIP entries for Windows Explorer compatibility.
 * Returns a list of defect strings (empty array means clean).
 */
export function auditWindowsZipEntries(entries) {
  const issues = []
  for (const entry of entries) {
    if (entry.hasNonAscii && !entry.isUtf8) {
      issues.push(`NON_UTF8_FLAG: ${entry.name}`)
    }
    const base = path.posix.basename(entry.name)
    if (base.startsWith('._') || base === '.DS_Store' || entry.name.includes('__MACOSX/')) {
      issues.push(`MACOS_METADATA: ${entry.name}`)
    }
    if (entry.isSymlink) {
      issues.push(`SYMLINK: ${entry.name}`)
    }
  }
  return issues
}

const hashFile = async file => {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}

const peMachine = buffer => {
  assert.equal(buffer.readUInt16LE(0), 0x5a4d, 'Missing MZ header')
  const pe = buffer.readUInt32LE(0x3c)
  assert.equal(buffer.readUInt32LE(pe), 0x4550, 'Missing PE signature')
  return buffer.readUInt16LE(pe + 4)
}

async function main() {
  const [sourceArg, outputArg] = process.argv.slice(2)
  assert(sourceArg && outputArg, 'Usage: node scripts/build-win-zip.mjs SOURCE_DIR OUTPUT.zip')
  const sourceDir = path.resolve(sourceArg)
  const outputZip = path.resolve(outputArg)
  const info = await stat(sourceDir)
  assert(info.isDirectory(), `Source must be a directory: ${sourceDir}`)

  for (const rel of ['寸链.exe', 'resources/cunlian-agent/m1-peer.exe']) {
    const exePath = path.join(sourceDir, rel)
    const buf = await readFile(exePath)
    assert.equal(peMachine(buf), 0x8664, `Expected AMD64 PE binary: ${rel}`)
  }

  await mkdir(path.dirname(outputZip), { recursive: true })
  await rm(outputZip, { force: true })

  const parentDir = path.dirname(sourceDir)
  const folderName = path.basename(sourceDir)
  execFileSync(
    '7zz',
    [
      'a',
      '-tzip',
      '-mcu=on',
      '-mx=5',
      '-xr!._*',
      '-xr!.DS_Store',
      '-xr!__MACOSX',
      outputZip,
      folderName,
    ],
    { cwd: parentDir, stdio: 'inherit' },
  )

  const zipBuffer = await readFile(outputZip)
  const entries = parseZipCentralDirectory(zipBuffer)
  const issues = auditWindowsZipEntries(entries)
  assert.equal(issues.length, 0, `Windows ZIP audit failed:\n${issues.join('\n')}`)

  console.log(
    JSON.stringify(
      {
        output: outputZip,
        bytes: zipBuffer.length,
        sha256: await hashFile(outputZip),
        entries: entries.length,
        nonAsciiEntriesWithUtf8Flag: entries.filter(e => e.hasNonAscii && e.isUtf8).length,
        issues: 0,
      },
      null,
      2,
    ),
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
