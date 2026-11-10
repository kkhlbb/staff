import { describe, expect, it } from 'vitest'
import { readZipEntries, writeZipEntries } from '../backup/zip'
import { sha256Hex } from '../sources/hash'
import { decodeProjectFile, encodeProjectFile } from './codec'
import { createSampleSnapshot, SAMPLE_PROJECT_ID } from './__fixtures__/sampleProjectFile'
import type { ProjectFileSnapshot } from './types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function readParts(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const zip = await readZipEntries(bytes)
  if (!zip.ok) {
    throw new Error(`测试夹具不是合法 ZIP：${zip.error.message}`)
  }
  return zip.value
}

/** 测试专用：改一个条目后按“声明与内容自洽”的方式重写 manifest/entries。 */
async function rebuildArchive(
  bytes: Uint8Array,
  mutate: (parts: Map<string, Uint8Array>) => void,
): Promise<Uint8Array> {
  const parts = await readParts(bytes)
  mutate(parts)
  const manifestBytes = parts.get('manifest.json')
  if (manifestBytes === undefined) {
    throw new Error('缺少 manifest')
  }
  const manifest = JSON.parse(decoder.decode(manifestBytes)) as {
    entries: { path: string; role: string }[]
    payloadBytes: number
  }
  const roleByPath = new Map(manifest.entries.map((entry) => [entry.path, entry.role]))

  const entries: { path: string; role: string; byteSize: number; sha256: string }[] = []
  let payloadBytes = 0
  for (const [path, value] of parts) {
    if (path === 'manifest.json') {
      continue
    }
    entries.push({
      path,
      role: roleByPath.get(path) ?? 'history',
      byteSize: value.byteLength,
      sha256: await sha256Hex(value),
    })
    payloadBytes += value.byteLength
  }
  entries.sort((left, right) => (left.path < right.path ? -1 : 1))
  const updated = { ...manifest, entries, payloadBytes }
  parts.set('manifest.json', encoder.encode(`${JSON.stringify(updated, null, 2)}\n`))

  const written = await writeZipEntries(
    [...parts].map(([path, value]) => ({ path, bytes: value })),
  )
  if (!written.ok) {
    throw new Error(`测试重写 ZIP 失败：${written.error.message}`)
  }
  return written.value
}

function patchJson(
  parts: Map<string, Uint8Array>,
  path: string,
  patch: (value: Record<string, unknown>) => void,
): void {
  const bytes = parts.get(path)
  if (bytes === undefined) {
    throw new Error(`缺失条目 ${path}`)
  }
  const value = JSON.parse(decoder.decode(bytes)) as Record<string, unknown>
  patch(value)
  parts.set(path, encoder.encode(`${JSON.stringify(value, null, 2)}\n`))
}

async function encodeSample(): Promise<Uint8Array> {
  const snapshot = await createSampleSnapshot()
  const encoded = await encodeProjectFile(snapshot)
  if (!encoded.ok) {
    throw new Error(`夹具编码失败：${encoded.error.message}`)
  }
  return encoded.value.bytes
}

describe('encodeProjectFile / decodeProjectFile 往返', () => {
  it('编码后解码保留工程输入、来源、历史与附件字节', async () => {
    const snapshot = await createSampleSnapshot()
    const encoded = await encodeProjectFile(snapshot)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return

    const decoded = await decodeProjectFile(encoded.value.bytes)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return

    const value = decoded.value.snapshot
    expect(value.project).toEqual(snapshot.project)
    expect(value.draft).toEqual(snapshot.draft)
    expect(value.documents).toEqual(snapshot.documents)
    expect(value.revisions).toEqual(snapshot.revisions)
    expect(value.bindings).toEqual(snapshot.bindings)
    expect(value.blobs).toEqual(snapshot.blobs)
    expect(value.events).toHaveLength(1)
    expect(value.analysisSnapshots[0]?.id).toBe('snap-1')
    expect(value.fileRevisions[0]?.revisionId).toBe('rev-a1')
    expect(value.attachments).toHaveLength(1)
    expect(Array.from(value.attachments[0]?.bytes ?? [])).toEqual(
      Array.from(snapshot.attachments[0]?.bytes ?? []),
    )

    const manifest = decoded.value.manifest
    expect(manifest.format).toBe('cunlian-project')
    expect(manifest.formatVersion).toBe(2)
    expect(manifest.project.projectSchemaVersion).toBe(8)
    expect(manifest.project.dimensionChainSchemaVersion).toBe(2)
    expect(manifest.project.id).toBe(SAMPLE_PROJECT_ID)
    expect(manifest.counts.documents).toBe(1)
    expect(manifest.counts.revisions).toBe(1)
    expect(manifest.counts.blobs).toBe(1)
    expect(manifest.counts.bindings).toBe(1)
    expect(manifest.counts.projectRevisions).toBe(1)
    expect(manifest.counts.models).toBe(0)
    expect(manifest.counts.drawings).toBe(0)
    expect(manifest.excludes.mappingTemplates.included).toBe(false)
    expect(manifest.payloadBytes).toBe(
      manifest.entries.reduce((total, entry) => total + entry.byteSize, 0),
    )
    expect(decoded.value.entryPaths).toEqual(
      [...decoded.value.entryPaths].sort((left, right) => (left < right ? -1 : 1)),
    )
    expect(decoded.value.entryPaths).toContain('attachments/blob-1.bin')
    expect(decoded.value.entryPaths).toContain('revisions/rev-a1.json')
    expect(decoded.value.entryPaths).not.toContain('manifest.json')
  })

  it('两次编码解出的聚合一致（内容稳定，不依赖 ZIP 时间戳）', async () => {
    const first = await encodeSample()
    const second = await encodeSample()
    const firstDecoded = await decodeProjectFile(first)
    const secondDecoded = await decodeProjectFile(second)
    expect(firstDecoded.ok && secondDecoded.ok).toBe(true)
    if (!firstDecoded.ok || !secondDecoded.ok) return
    expect(secondDecoded.value.manifest.counts).toEqual(firstDecoded.value.manifest.counts)
    expect(secondDecoded.value.manifest.payloadBytes).toBe(
      firstDecoded.value.manifest.payloadBytes,
    )
    expect(secondDecoded.value.snapshot.project).toEqual(firstDecoded.value.snapshot.project)
  })

  it('空字节与非 ZIP 字节被拒绝', async () => {
    const empty = await decodeProjectFile(new Uint8Array())
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.error.code).toBe('EMPTY_BACKUP')

    const garbage = await decodeProjectFile(encoder.encode('not a zip at all'))
    expect(garbage.ok).toBe(false)
    if (!garbage.ok) expect(garbage.error.code).toBe('INVALID_ZIP')
  })
})

describe('版本与清单拒绝', () => {
  it('formatVersion 更高时返回 UNSUPPORTED_VERSION', async () => {
    const bytes = await rebuildArchive(await encodeSample(), (parts) => {
      patchJson(parts, 'manifest.json', (manifest) => {
        manifest.formatVersion = 3
      })
    })
    const decoded = await decodeProjectFile(bytes)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.code).toBe('UNSUPPORTED_VERSION')
  })

  it('format 不是 cunlian-project 时返回 INVALID_MANIFEST', async () => {
    const bytes = await rebuildArchive(await encodeSample(), (parts) => {
      patchJson(parts, 'manifest.json', (manifest) => {
        manifest.format = 'cunlian-backup'
      })
    })
    const decoded = await decodeProjectFile(bytes)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.code).toBe('INVALID_MANIFEST')
  })

  it('projectSchemaVersion 更高时返回 UNSUPPORTED_VERSION', async () => {
    const bytes = await rebuildArchive(await encodeSample(), (parts) => {
      patchJson(parts, 'manifest.json', (manifest) => {
        const project = manifest.project as Record<string, unknown>
        // 8 已是当前版本；9 才是未来版本。
        project.projectSchemaVersion = 9
      })
    })
    const decoded = await decodeProjectFile(bytes)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.code).toBe('UNSUPPORTED_VERSION')
  })

  it('条目哈希被篡改时返回 HASH_MISMATCH', async () => {
    const parts = await readParts(await encodeSample())
    patchJson(parts, 'project/project.json', (project) => {
      project.name = '被篡改的名称'
    })
    const written = await writeZipEntries(
      [...parts].map(([path, value]) => ({ path, bytes: value })),
    )
    expect(written.ok).toBe(true)
    if (!written.ok) return
    const decoded = await decodeProjectFile(written.value)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.code).toBe('HASH_MISMATCH')
  })

  it('缺少附件条目时返回 MISSING_REFERENCE', async () => {
    const bytes = await rebuildArchive(await encodeSample(), (parts) => {
      parts.delete('attachments/blob-1.bin')
    })
    const decoded = await decodeProjectFile(bytes)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.code).toBe('MISSING_REFERENCE')
  })

  it('出现未授权条目时返回 UNSAFE_PATH', async () => {
    const bytes = await rebuildArchive(await encodeSample(), (parts) => {
      parts.set('evil/extra.json', encoder.encode('{}\n'))
    })
    const decoded = await decodeProjectFile(bytes)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.code).toBe('UNSAFE_PATH')
  })

  it('counts 与实际不符时返回 INVALID_MANIFEST', async () => {
    const bytes = await rebuildArchive(await encodeSample(), (parts) => {
      patchJson(parts, 'manifest.json', (manifest) => {
        const counts = manifest.counts as Record<string, number>
        counts.documents = 9
      })
    })
    const decoded = await decodeProjectFile(bytes)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.code).toBe('INVALID_MANIFEST')
  })

  it('附件字节被替换且清单同步更新时仍按附件哈希拒绝', async () => {
    const bytes = await rebuildArchive(await encodeSample(), (parts) => {
      parts.set('attachments/blob-1.bin', encoder.encode('%PDF-1.7 different bytes'))
    })
    const decoded = await decodeProjectFile(bytes)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.code).toBe('HASH_MISMATCH')
  })
})

describe('引用完整性拒绝', () => {
  it('currentRevisionId 指向不存在的文件版本', async () => {
    const bytes = await rebuildArchive(await encodeSample(), (parts) => {
      patchJson(parts, 'project/project.json', (project) => {
        project.currentRevisionId = 'rev-missing'
      })
    })
    const decoded = await decodeProjectFile(bytes)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.code).toBe('MISSING_REFERENCE')
  })

  it('绑定页码越界', async () => {
    const bytes = await rebuildArchive(await encodeSample(), (parts) => {
      patchJson(parts, 'sources/bindings.json', (value) => {
        const bindings = value as unknown as Record<string, unknown>[]
        const first = bindings[0]
        if (first !== undefined) first.page = 5
      })
    })
    const decoded = await decodeProjectFile(bytes)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.code).toBe('INVALID_RECORD')
  })

  it('绑定引用当前方案中不存在的组成环', async () => {
    const bytes = await rebuildArchive(await encodeSample(), (parts) => {
      patchJson(parts, 'sources/bindings.json', (value) => {
        const bindings = value as unknown as Record<string, unknown>[]
        const first = bindings[0]
        if (first !== undefined) first.termId = 'term-missing'
      })
    })
    const decoded = await decodeProjectFile(bytes)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.code).toBe('MISSING_REFERENCE')
  })

  it('版本元数据与 blob 元数据哈希不一致', async () => {
    const bytes = await rebuildArchive(await encodeSample(), (parts) => {
      patchJson(parts, 'sources/revisions.json', (value) => {
        const revisions = value as unknown as Record<string, unknown>[]
        const first = revisions[0]
        if (first !== undefined) first.sha256 = 'f'.repeat(64)
      })
    })
    const decoded = await decodeProjectFile(bytes)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.code).toBe('HASH_MISMATCH')
  })
})

describe('编码端自校验', () => {
  it('缺少附件字节且未声明缺失时拒绝编码', async () => {
    const snapshot = await createSampleSnapshot()
    const broken: ProjectFileSnapshot = { ...snapshot, attachments: [] }
    const encoded = await encodeProjectFile(broken)
    expect(encoded.ok).toBe(false)
    if (!encoded.ok) expect(encoded.error.code).toBe('MISSING_REFERENCE')
  })

  it('同一附件既提供字节又声明缺失时拒绝编码', async () => {
    const snapshot = await createSampleSnapshot()
    const broken: ProjectFileSnapshot = {
      ...snapshot,
      missingAttachments: [
        { revisionId: 'sr-1', documentId: 'doc-1', blobKey: 'blob-1', reason: 'legacy-json' },
      ],
    }
    const encoded = await encodeProjectFile(broken)
    expect(encoded.ok).toBe(false)
    if (!encoded.ok) expect(encoded.error.code).toBe('INVALID_RECORD')
  })
})
