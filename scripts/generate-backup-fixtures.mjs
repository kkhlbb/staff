/**
 * 生成 .cunlian.zip 恶意与正常测试夹具。
 *
 * 运行：node scripts/generate-backup-fixtures.mjs
 * 输出：src/backup/__fixtures__/*.cunlian.zip
 *
 * 这些是真实的 ZIP 文件（不是 mock）：正常夹具用 @zip.js/zip.js 写入；
 * 穿越/重复条目等“库可能拒绝写入”的结构用最小 ZIP 写入器直接构造，
 * 保证测试读取的是真实的字节流。生成后请用 `unzip -l` 复核条目名。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from '@zip.js/zip.js'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'src', 'backup', '__fixtures__')
mkdirSync(outDir, { recursive: true })

const sha256 = async (bytes) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

const encoder = new TextEncoder()
const json = (value) => encoder.encode(JSON.stringify(value, null, 2))

const NOTE =
  '本备份不包含全局映射模板（mappingTemplates）。映射模板属于本机全局设置，不随项目备份；恢复到新浏览器后需要重新建立或重新导入模板。'

const chain = {
  terms: [
    {
      id: 'h',
      symbol: 'H',
      name: '机架',
      nominalQ: 1000000,
      lowerDeviationQ: 0,
      upperDeviationQ: 1000,
      sign: 1,
      sourceNote: '',
      termRevision: 1,
    },
    {
      id: 'b1',
      symbol: 'B1',
      name: '轴承 1',
      nominalQ: 200000,
      lowerDeviationQ: -200,
      upperDeviationQ: 0,
      sign: -1,
      sourceNote: '',
      termRevision: 1,
    },
  ],
  target: null,
  assumptions: '',
}

const project = {
  schemaVersion: 2,
  engineVersion: 'fixture-engine',
  id: 'fixture-project',
  name: '夹具项目',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  working: chain,
  relationRevision: 0,
  relationReview: null,
  migration: null,
  baseline: null,
}

const counts = (overrides = {}) => ({
  projects: 0,
  drafts: 0,
  documents: 0,
  revisions: 0,
  blobs: 0,
  bindings: 0,
  events: 0,
  snapshots: 0,
  importSnapshots: 0,
  migrationBackups: 0,
  ...overrides,
})

async function manifestFor(entries, projectList, countOverrides) {
  const metas = []
  let total = 0
  for (const [path, bytes] of entries) {
    total += bytes.byteLength
    metas.push({
      path,
      sha256: await sha256(bytes),
      byteSize: bytes.byteLength,
    })
  }
  metas.sort((left, right) => left.path.localeCompare(right.path))
  return {
    format: 'cunlian-backup',
    formatVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    note: '测试夹具',
    app: { databaseVersion: 7, projectSchemaVersion: 2 },
    counts: counts(countOverrides),
    projects: projectList,
    excludes: {
      mappingTemplates: { included: false, count: 0, note: NOTE },
    },
    entries: metas,
    totalUncompressedBytes: total,
  }
}

async function writeZip(fileName, files) {
  const writer = new Uint8ArrayWriter()
  const zipWriter = new ZipWriter(writer, { useWebWorkers: false })
  for (const [path, bytes] of files) {
    await zipWriter.add(path, new Uint8ArrayReader(bytes), {
      level: 6,
      useWebWorkers: false,
    })
  }
  await zipWriter.close()
  writeFileSync(join(outDir, fileName), await writer.getData())
}

/* -------------------------------------------------------------------------- */
/* 最小 ZIP 写入器（store 方法），用于库本身拒绝写入的恶意结构。             */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const DOS_TIME = 0
const DOS_DATE = 0x21

function rawZip(fileName, entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data } of entries) {
    const nameBytes = encoder.encode(name)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBytes, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + data.length
  }

  const centralBytes = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  writeFileSync(
    join(outDir, fileName),
    Buffer.concat([...locals, centralBytes, end]),
  )
}

/* -------------------------------------------------------------------------- */

const projectEntry = ['projects/fixture-project.json', json(project)]
const projectSummary = [
  { id: project.id, name: project.name, updatedAt: project.updatedAt },
]

// 1. 合法的最小备份：只有项目，可用于恢复成功路径的预览。
{
  const files = [projectEntry]
  const manifest = await manifestFor(files, projectSummary, { projects: 1 })
  await writeZip('valid-minimal.cunlian.zip', [
    ['manifest.json', json(manifest)],
    ...files,
  ])
}

// 2. 哈希不符：manifest 中项目文件哈希被替换为 64 个 0。
{
  const files = [projectEntry]
  const manifest = await manifestFor(files, projectSummary, { projects: 1 })
  manifest.entries[0].sha256 = '0'.repeat(64)
  await writeZip('malicious-hash-mismatch.cunlian.zip', [
    ['manifest.json', json(manifest)],
    ...files,
  ])
}

// 3. 缺引用：绑定指向不存在的 revision。
{
  const blobBytes = encoder.encode('%PDF-1.4 fixture')
  const blobSha = await sha256(blobBytes)
  const document = {
    id: 'doc-fixture',
    projectId: project.id,
    title: '夹具 PDF',
    latestRevisionId: 'rev-fixture',
  }
  const revision = {
    id: 'rev-fixture',
    projectId: project.id,
    documentId: document.id,
    fileName: 'fixture.pdf',
    sha256: blobSha,
    byteSize: blobBytes.byteLength,
    pageCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    blobKey: 'blob-fixture',
  }
  const blobMeta = {
    blobKey: revision.blobKey,
    projectId: project.id,
    sha256: blobSha,
    byteSize: blobBytes.byteLength,
  }
  const binding = {
    id: 'binding-fixture',
    projectId: project.id,
    termId: 'h',
    revisionId: 'rev-missing',
    documentId: document.id,
    page: 1,
    rectPdf: [10, 10, 100, 50],
    pageBoxPdf: [0, 0, 600, 800],
    note: '指向不存在的版本',
    createdAt: '2026-01-01T00:00:00.000Z',
    reviewedTermRevision: null,
    reviewedAt: null,
    historicalAcceptance: null,
  }
  const files = [
    projectEntry,
    ['sourceDocuments/doc-fixture.json', json(document)],
    ['sourceRevisions/rev-fixture.json', json(revision)],
    ['sourceBlobs/blob-fixture.json', json(blobMeta)],
    ['sourceFiles/blob-fixture.bin', blobBytes],
    ['bindings/binding-fixture.json', json(binding)],
  ]
  const manifest = await manifestFor(files, projectSummary, {
    projects: 1,
    documents: 1,
    revisions: 1,
    blobs: 1,
    bindings: 1,
  })
  await writeZip('malicious-missing-reference.cunlian.zip', [
    ['manifest.json', json(manifest)],
    ...files,
  ])
}

// 4. 路径穿越变体（相对、绝对、反斜杠、编码穿越）。
rawZip('malicious-traversal.cunlian.zip', [
  { name: 'manifest.json', data: json({ format: 'cunlian-backup' }) },
  { name: '../evil.txt', data: encoder.encode('evil') },
  { name: '/tmp/evil.txt', data: encoder.encode('evil') },
  { name: '..\\evil.txt', data: encoder.encode('evil') },
  { name: 'projects/%2e%2e/evil.json', data: encoder.encode('evil') },
])

// 5. 重复条目：同一个 manifest.json 出现两次，内容不同。
rawZip('malicious-duplicate-entry.cunlian.zip', [
  { name: 'manifest.json', data: encoder.encode('{"one":1}') },
  { name: 'manifest.json', data: encoder.encode('{"two":2}') },
])

// 6. 超条目数：501 个条目。
{
  const files = Array.from({ length: 501 }, (_, index) => [
    `f/${index}.txt`,
    encoder.encode('x'),
  ])
  await writeZip('malicious-too-many-entries.cunlian.zip', files)
}

// 7. 超解压量：单个 151 MiB 的零字节条目（压缩后很小）。
{
  const big = new Uint8Array(151 * 1024 * 1024)
  await writeZip('malicious-too-large.cunlian.zip', [
    ['sourceFiles/big.bin', big],
  ])
}

console.log(`fixtures written to ${outDir}`)
