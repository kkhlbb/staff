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

async function manifestFor(
  entries,
  projectList,
  countOverrides,
  missingAttachments = [],
) {
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
    missingAttachments,
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

// 4. 路径穿越变体：每个变体独立成包，避免首个条目被拒绝后短路，后面的
//    变体从未被真正执行。反斜杠用字符码拼出，避免源码转义歧义。
const backslash = String.fromCharCode(92)
const traversalVariants = [
  ['malicious-traversal-relative.cunlian.zip', '../evil.txt'],
  ['malicious-traversal-absolute.cunlian.zip', '/tmp/evil.txt'],
  ['malicious-traversal-backslash.cunlian.zip', `..${backslash}evil.txt`],
  ['malicious-traversal-encoded.cunlian.zip', 'projects/%2e%2e/evil.json'],
]
for (const [fileName, evilName] of traversalVariants) {
  rawZip(fileName, [
    { name: 'manifest.json', data: json({ format: 'cunlian-backup' }) },
    { name: evilName, data: encoder.encode('evil') },
  ])
}

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

// 8. 跨项目附件引用：revision 属于 fixture-project，但 Blob 元数据属于
//    fixture-other-project。恢复必须拒绝，而不是把别的项目附件接到本版本上。
{
  const otherProject = {
    ...project,
    id: 'fixture-other-project',
    name: '另一个夹具项目',
  }
  const blobBytes = encoder.encode('%PDF-1.4 cross project')
  const blobSha = await sha256(blobBytes)
  const document = {
    id: 'doc-cross',
    projectId: project.id,
    title: '跨项目附件夹具',
    latestRevisionId: 'rev-cross',
  }
  const revision = {
    id: 'rev-cross',
    projectId: project.id,
    documentId: document.id,
    fileName: 'cross.pdf',
    sha256: blobSha,
    byteSize: blobBytes.byteLength,
    pageCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    blobKey: 'blob-cross',
  }
  const blobMeta = {
    blobKey: revision.blobKey,
    projectId: otherProject.id,
    sha256: blobSha,
    byteSize: blobBytes.byteLength,
  }
  const files = [
    projectEntry,
    ['projects/fixture-other-project.json', json(otherProject)],
    ['sourceDocuments/doc-cross.json', json(document)],
    ['sourceRevisions/rev-cross.json', json(revision)],
    ['sourceBlobs/blob-cross.json', json(blobMeta)],
    ['sourceFiles/blob-cross.bin', blobBytes],
  ]
  const manifest = await manifestFor(
    files,
    [...projectSummary, { id: otherProject.id, name: otherProject.name, updatedAt: otherProject.updatedAt }],
    { projects: 2, documents: 1, revisions: 1, blobs: 1 },
  )
  await writeZip('invalid-cross-project-blob.cunlian.zip', [
    ['manifest.json', json(manifest)],
    ...files,
  ])
}

// 9. 快照结构坏包：完整结构与必要一致性校验必须在写库前拒绝。
{
  const definition = chain
  const result = {
    nominalQ: 800000,
    minQ: 800000,
    maxQ: 1001200,
    lowerDeviationQ: 0,
    upperDeviationQ: 201200,
    toleranceQ: 201200,
    status: 'no-target',
    lowerMarginQ: null,
    upperMarginQ: null,
    contributions: [
      { termId: 'h', toleranceQ: 1000 },
      { termId: 'b1', toleranceQ: 200 },
    ],
  }
  const draft = {
    terms: [
      {
        id: 'h',
        symbol: 'H',
        name: '机架',
        nominal: '100.0000',
        lower: '0.0000',
        upper: '0.1000',
        sign: 1,
        sourceNote: '',
        termRevision: 1,
      },
      {
        id: 'b1',
        symbol: 'B1',
        name: '轴承 1',
        nominal: '20.0000',
        lower: '-0.0200',
        upper: '0.0000',
        sign: -1,
        sourceNote: '',
        termRevision: 1,
      },
    ],
    targetMin: '',
    targetMax: '',
    assumptions: '',
    relationRevision: 0,
  }
  const finding = {
    ruleId: 'INPUT_VALID',
    ruleVersion: '1.0.0',
    scope: 'chain',
    subject: { kind: 'chain', id: 'chain', label: '当前尺寸链' },
    status: 'passed',
    basis: '夹具输入通过校验。',
    action: null,
    severity: 'blocking',
    needsAction: false,
    target: { kind: 'chain' },
  }
  const baseSnapshot = {
    id: 'snapshot-fixture',
    projectId: project.id,
    projectName: project.name,
    createdAt: '2026-01-01T00:00:00.000Z',
    engineVersion: 'fixture-engine',
    reviewRulesVersion: '1.0.0',
    inputFingerprint: 'fixture-fingerprint',
    definition,
    draft,
    result,
    review: {
      rulesVersion: '1.0.0',
      findings: [finding],
      calculation: { status: 'no-target', label: '未设置目标，未判定', satisfied: null },
      reviewComplete: true,
      pending: [],
      canCreateReport: true,
      hasAnyBinding: false,
      byStatus: {
        passed: 1,
        failed: 0,
        unchecked: 0,
        'needs-human': 0,
        'not-applicable': 0,
      },
      groups: [],
    },
    sourceManifest: {
      bindings: [],
      documents: [],
      revisions: [],
      unboundTermIds: ['h', 'b1'],
      availability: 'complete',
    },
    baseline: null,
    comparison: null,
    status: 'complete',
    pendingCount: 0,
  }

  const writeSnapshotFixture = async (fileName, mutate) => {
    const snapshot = structuredClone(baseSnapshot)
    mutate(snapshot)
    const files = [
      projectEntry,
      ['snapshots/snapshot-fixture.json', json(snapshot)],
    ]
    const manifest = await manifestFor(files, projectSummary, {
      projects: 1,
      snapshots: 1,
    })
    await writeZip(fileName, [['manifest.json', json(manifest)], ...files])
  }

  // review 缺 calculation；findings/pending 元素必须按领域类型完整校验。
  await writeSnapshotFixture('invalid-snapshot-review.cunlian.zip', (snapshot) => {
    delete snapshot.review.calculation
    snapshot.review.findings = [{ ruleId: 'INPUT_VALID' }]
    snapshot.review.pending = [{ arbitrary: true }]
  })
  // sourceManifest.bindings 元素不完整。
  await writeSnapshotFixture('invalid-snapshot-binding.cunlian.zip', (snapshot) => {
    snapshot.sourceManifest.bindings = [{ bindingId: 123 }]
  })
  // sourceManifest.documents / revisions 元素不完整。
  await writeSnapshotFixture('invalid-snapshot-documents.cunlian.zip', (snapshot) => {
    snapshot.sourceManifest.documents = [{ id: 42 }]
    snapshot.sourceManifest.revisions = [{ id: 'rev-x' }]
  })
  // 结构完整但内部不一致：byStatus 与实际 findings 不符，必须按一致性拒绝。
  await writeSnapshotFixture('invalid-snapshot-inconsistent.cunlian.zip', (snapshot) => {
    snapshot.review.byStatus.passed = 99
  })
  // 没有基线却带冻结对比结果：F3-B 的兼容只放行“有基线、无对比”的旧快照，
  // 反向不一致必须继续拒绝，避免把兼容写成不校验。
  await writeSnapshotFixture('invalid-snapshot-comparison.cunlian.zip', (snapshot) => {
    const delta = (value) => ({ before: value, after: value, delta: 0 })
    snapshot.baseline = null
    snapshot.comparison = {
      baselineResult: structuredClone(result),
      diff: {
        addedTermIds: [],
        removedTermIds: [],
        orderChanged: false,
        termChanges: [],
        targetChanged: false,
        minQ: delta(result.minQ),
        maxQ: delta(result.maxQ),
        toleranceQ: delta(result.toleranceQ),
        lowerMarginQ: delta(null),
        upperMarginQ: delta(null),
        statusBefore: 'no-target',
        statusAfter: 'no-target',
      },
    }
  })
  // 冻结指针必须落在冻结清单之内：快照文档的 latestRevisionId 指向清单外版本，
  // 与“当前文档已升级”不同，属于坏结构，必须拒绝。
  {
    const blobBytes = encoder.encode('%PDF-1.4 snapshot pointer')
    const blobSha = await sha256(blobBytes)
    const document = {
      id: 'doc-snapshot',
      projectId: project.id,
      title: '快照来源',
      latestRevisionId: 'rev-snapshot',
    }
    const revision = {
      id: 'rev-snapshot',
      projectId: project.id,
      documentId: document.id,
      fileName: 'snapshot.pdf',
      sha256: blobSha,
      byteSize: blobBytes.byteLength,
      pageCount: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      blobKey: 'blob-snapshot',
    }
    const snapshot = structuredClone(baseSnapshot)
    snapshot.sourceManifest = {
      bindings: [],
      documents: [{ ...document, latestRevisionId: 'rev-outside-manifest' }],
      revisions: [revision],
      unboundTermIds: ['h', 'b1'],
      availability: 'complete',
    }
    const files = [
      projectEntry,
      ['sourceDocuments/doc-snapshot.json', json(document)],
      ['sourceRevisions/rev-snapshot.json', json(revision)],
      [
        'sourceBlobs/blob-snapshot.json',
        json({
          blobKey: revision.blobKey,
          projectId: project.id,
          sha256: blobSha,
          byteSize: blobBytes.byteLength,
        }),
      ],
      ['sourceFiles/blob-snapshot.bin', blobBytes],
      ['snapshots/snapshot-fixture.json', json(snapshot)],
    ]
    const manifest = await manifestFor(files, projectSummary, {
      projects: 1,
      documents: 1,
      revisions: 1,
      blobs: 1,
      snapshots: 1,
    })
    await writeZip('invalid-snapshot-pointer.cunlian.zip', [
      ['manifest.json', json(manifest)],
      ...files,
    ])
  }
}

console.log(`fixtures written to ${outDir}`)
