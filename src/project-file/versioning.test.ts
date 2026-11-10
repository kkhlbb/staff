import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decodeProjectFile, encodeProjectFile } from './codec'
import { parseProjectVersioned } from './validation'
import { createModelSnapshot, MODEL_BLOB_KEY, MODEL_REVISION_ID } from './__fixtures__/modelProjectFile'
import { createSampleSnapshot } from './__fixtures__/sampleProjectFile'
import type { ProjectFileSnapshot } from './types'

const B1_FIXTURE = fileURLToPath(new URL('./__fixtures__/b1-project-v1.cunlian', import.meta.url))

async function readB1(): Promise<Uint8Array> {
  return new Uint8Array(readFileSync(B1_FIXTURE))
}

describe('B2-02 读时兼容 B1 文件（formatVersion 1 / schema 3）', () => {
  it('真实 B1 产物可打开：格式、数值、PDF 字节与历史快照保持', async () => {
    const decoded = await decodeProjectFile(await readB1())
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    const { manifest, snapshot } = decoded.value

    expect(manifest.formatVersion).toBe(1)
    expect(manifest.project.projectSchemaVersion).toBe(3)
    // 工作形状适配为当前 schema5，但记录来源格式供首次保存升级。
    expect(snapshot.project.schemaVersion).toBe(6)
    expect(snapshot.project.sourceFormatVersion).toBe(1)
    expect(snapshot.project.parts).toEqual([])
    expect(snapshot.project.modelRevisions).toEqual([])
    expect(snapshot.project.dimensionLinks).toEqual([])
    // 数值未因升级改变（q 原样）。
    expect(snapshot.project.dimensionChain.terms.map((term) => term.nominalQ)).toEqual([
      522000, 200000, 120000, 200000,
    ])
    expect(snapshot.project.name).toBe('隔套间隙演示')
    // 旧归档快照保留 schema3 原样，不被改写成新内容。
    expect(snapshot.fileRevisions[0]?.project.schemaVersion).toBe(3)
    // PDF 字节仍按原哈希可读。
    const pdf = snapshot.attachments.find((item) => item.blobKey === 'blob-1')
    expect(pdf?.bytes.byteLength).toBe(1126)
    expect(snapshot.blobs.find((item) => item.blobKey === 'blob-1')?.sha256).toBe(
      '27ba5645331bd095a3776219a8bd3a3287649d3a88052d2fbb53b9e976c38394',
    )
    expect(decoded.value.entryPaths).toContain('attachments/blob-1.bin')
  })

  it('B1 文件重新编码为 v2/schema5：旧历史仍为 schema3，数值与 PDF 不变', async () => {
    const decoded = await decodeProjectFile(await readB1())
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    const encoded = await encodeProjectFile(decoded.value.snapshot)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    expect(encoded.value.manifest.formatVersion).toBe(2)
    expect(encoded.value.manifest.project.projectSchemaVersion).toBe(6)
    expect(encoded.value.manifest.counts.models).toBe(0)

    const again = await decodeProjectFile(encoded.value.bytes)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.value.snapshot.project.sourceFormatVersion).toBe(1)
    expect(again.value.snapshot.project.dimensionChain).toEqual(
      decoded.value.snapshot.project.dimensionChain,
    )
    expect(again.value.snapshot.fileRevisions[0]?.project.schemaVersion).toBe(3)
    const pdf = again.value.snapshot.attachments.find((item) => item.blobKey === 'blob-1')
    expect(pdf?.bytes.byteLength).toBe(1126)
  })

  it('B1 严格规则仍生效：schema3 记录出现非空预留数组即拒绝', async () => {
    const decoded = await decodeProjectFile(await readB1())
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    const v1 = decoded.value.snapshot.fileRevisions[0]?.project
    expect(v1?.schemaVersion).toBe(3)
    const broken = { ...v1, parts: [{ partId: 'x' }] }
    const parsed = parseProjectVersioned(broken)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error.code).toBe('INVALID_RECORD')
  })

  it('未知 schemaVersion 明确拒绝，不静默 strip', async () => {
    const parsed = parseProjectVersioned({ schemaVersion: 9, id: 'x' })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error.code).toBe('UNSUPPORTED_VERSION')
  })
})

describe('B2-02 v2/schema5 模型与去重', () => {
  it('模型版本往返：部件、版本、可视关联、字节均可读', async () => {
    const { snapshot } = await createModelSnapshot()
    const encoded = await encodeProjectFile(snapshot)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    expect(encoded.value.manifest.counts.models).toBe(1)
    expect(encoded.value.manifest.attachments.filter((item) => item.kind === 'model')).toHaveLength(1)

    const decoded = await decodeProjectFile(encoded.value.bytes)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.value.snapshot.project.modelRevisions[0]).toEqual(
      snapshot.project.modelRevisions[0],
    )
    expect(decoded.value.snapshot.project.dimensionLinks[0]).toEqual(
      snapshot.project.dimensionLinks[0],
    )
    const stl = decoded.value.snapshot.attachments.find((item) => item.blobKey === MODEL_BLOB_KEY)
    expect(stl?.bytes.byteLength).toBe(134)
  })

  it('两个模型版本共享同一 blob 时只写一个附件条目，引用按版本枚举', async () => {
    const { snapshot, stlBytes } = await createModelSnapshot()
    const first = snapshot.project.modelRevisions[0]!
    const second = {
      ...first,
      modelRevisionId: 'model-2',
      parentModelRevisionId: MODEL_REVISION_ID,
      reason: '替换为相同字节',
    }
    const shared: ProjectFileSnapshot = {
      ...snapshot,
      project: {
        ...snapshot.project,
        parts: snapshot.project.parts.map((part) => ({
          ...part,
          currentModelRevisionId: 'model-2',
        })),
        modelRevisions: [first, second],
      },
      attachments: snapshot.attachments,
      blobs: snapshot.blobs,
    }
    expect(stlBytes.byteLength).toBe(134)
    const encoded = await encodeProjectFile(shared)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return

    const attachments = encoded.value.entryPaths.filter((path) =>
      path.startsWith('attachments/'),
    )
    // PDF blob 与共享的模型 blob 各一个条目；模型不会被写两次。
    expect(attachments.sort()).toEqual([
      'attachments/blob-1.bin',
      `attachments/${MODEL_BLOB_KEY}.bin`,
    ])
    const modelRefs = encoded.value.manifest.attachments.filter((item) => item.kind === 'model')
    expect(modelRefs.map((item) => item.revisionId).sort()).toEqual(['model-1', 'model-2'])
    expect(new Set(modelRefs.map((item) => item.blobKey))).toEqual(new Set([MODEL_BLOB_KEY]))

    const decoded = await decodeProjectFile(encoded.value.bytes)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.value.snapshot.project.modelRevisions).toHaveLength(2)
  })

  it('模型引用的字节缺失时拒绝（模型版本不允许缺附件声明）', async () => {
    const { snapshot } = await createModelSnapshot()
    const broken: ProjectFileSnapshot = {
      ...snapshot,
      attachments: snapshot.attachments.filter((item) => item.blobKey !== MODEL_BLOB_KEY),
    }
    const encoded = await encodeProjectFile(broken)
    expect(encoded.ok).toBe(false)
    if (!encoded.ok) expect(encoded.error.code).toBe('MISSING_REFERENCE')
  })

  it('关联指向其它部件的模型版本时拒绝', async () => {
    const { snapshot } = await createModelSnapshot()
    const broken: ProjectFileSnapshot = {
      ...snapshot,
      project: {
        ...snapshot.project,
        parts: [
          ...snapshot.project.parts,
          {
            partId: 'part-other',
            kind: 'builtin-demo' as const,
            name: '其它部件',
            currentModelRevisionId: null,
            origin: 'builtin' as const,
          },
        ],
        dimensionLinks: snapshot.project.dimensionLinks.map((link) => {
          if (link.kind !== 'visual-reference') throw new Error('样例只含外形关联')
          return { ...link, target: { ...link.target, partId: 'part-other' } }
        }),
      },
    }
    const encoded = await encodeProjectFile(broken)
    expect(encoded.ok).toBe(false)
    if (!encoded.ok) expect(encoded.error.code).toBe('MISSING_REFERENCE')
  })
})

describe('B2-02 容量与条目上限', () => {
  it('唯一 blob 总量超过 100 MiB 时保存前拒绝并给出字节数', async () => {
    const base = await createSampleSnapshot()
    const inflated: ProjectFileSnapshot = {
      ...base,
      // 只验证预算执行点：元数据已超限，不分配 100 MiB 字节；
      // 预算检查在附件哈希之前运行，因此不会读这些“字节”。
      blobs: Array.from({ length: 11 }, (_, index) => ({
        blobKey: `blob-big-${index}`,
        projectId: base.project.id,
        sha256: 'a'.repeat(64),
        byteSize: 10 * 1024 * 1024,
      })),
      attachments: [],
    }
    const encoded = await encodeProjectFile(inflated)
    expect(encoded.ok).toBe(false)
    if (!encoded.ok) {
      expect(encoded.error.code).toBe('PROJECT_ASSETS_TOO_LARGE')
      expect(encoded.error.message).toContain('100 MiB')
      expect(encoded.error.detail).toContain('115343360')
    }
  })

  it('条目数超过 500 时保存前拒绝', async () => {
    const base = await createSampleSnapshot()
    const many: ProjectFileSnapshot = {
      ...base,
      // 保留原当前版本 rev-a1，再追加 500 个历史版本：条目数超过 500。
      fileRevisions: [
        base.fileRevisions[0]!,
        ...Array.from({ length: 500 }, (_, index) => ({
          revisionId: `rev-extra-${index}`,
          parentId: index === 0 ? 'rev-a1' : `rev-extra-${index - 1}`,
          createdAt: base.project.createdAt,
          reason: 'entry-limit',
          project: base.fileRevisions[0]!.project,
        })),
      ],
    }
    const encoded = await encodeProjectFile(many)
    expect(encoded.ok).toBe(false)
    if (!encoded.ok) {
      expect(encoded.error.code).toBe('TOO_MANY_ENTRIES')
      expect(encoded.error.detail ?? encoded.error.message).toContain('500')
    }
  })
})
