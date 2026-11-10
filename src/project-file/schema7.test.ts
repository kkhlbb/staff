/**
 * V3.5：项目 schema 7 迁移矩阵与条款持久化。
 *
 * 覆盖：3/4/5/6 读入默认“无 Beta 条款”、旧历史原样、7 正常读写、8 拒绝、
 * 条款证据严格校验、单条款限制与悬空活动指针拒绝。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readZipEntries, writeZipEntries } from '../backup/zip'
import { sha256Hex } from '../sources/hash'
import { decodeProjectFile, encodeProjectFile } from './codec'
import { upgradeSnapshotToCurrent } from './upgrade'
import { createSampleSnapshot } from './__fixtures__/sampleProjectFile'
import { createSpacerSnapshot } from './__fixtures__/spacerProjectFile'
import type { ProjectFileSnapshot } from './types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const B1_FIXTURE = fileURLToPath(new URL('./__fixtures__/b1-project-v1.cunlian', import.meta.url))

async function readParts(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const zip = await readZipEntries(bytes)
  if (!zip.ok) throw new Error(`不是合法 ZIP：${zip.error.message}`)
  return zip.value
}

async function rebuildArchive(
  bytes: Uint8Array,
  mutate: (parts: Map<string, Uint8Array>) => void,
): Promise<Uint8Array> {
  const parts = await readParts(bytes)
  mutate(parts)
  const manifestBytes = parts.get('manifest.json')
  if (manifestBytes === undefined) throw new Error('缺少 manifest')
  const manifest = JSON.parse(decoder.decode(manifestBytes)) as {
    entries: { path: string; role: string }[]
    payloadBytes: number
  }
  const roleByPath = new Map(manifest.entries.map((entry) => [entry.path, entry.role]))
  const entries: { path: string; role: string; byteSize: number; sha256: string }[] = []
  let payloadBytes = 0
  for (const [path, value] of parts) {
    if (path === 'manifest.json') continue
    entries.push({
      path,
      role: roleByPath.get(path) ?? 'history',
      byteSize: value.byteLength,
      sha256: await sha256Hex(value),
    })
    payloadBytes += value.byteLength
  }
  entries.sort((left, right) => (left.path < right.path ? -1 : 1))
  parts.set(
    'manifest.json',
    encoder.encode(`${JSON.stringify({ ...manifest, entries, payloadBytes }, null, 2)}\n`),
  )
  const written = await writeZipEntries([...parts].map(([path, value]) => ({ path, bytes: value })))
  if (!written.ok) throw new Error(`重写失败：${written.error.message}`)
  return written.value
}

function patchJson(
  parts: Map<string, Uint8Array>,
  path: string,
  patch: (value: Record<string, unknown>) => void,
): void {
  const bytes = parts.get(path)
  if (bytes === undefined) throw new Error(`缺失条目 ${path}`)
  const value = JSON.parse(decoder.decode(bytes)) as Record<string, unknown>
  patch(value)
  parts.set(path, encoder.encode(`${JSON.stringify(value, null, 2)}\n`))
}

function patchAllProjects(parts: Map<string, Uint8Array>, patch: (project: Record<string, unknown>) => void): void {
  patchJson(parts, 'project/project.json', patch)
  for (const path of [...parts.keys()]) {
    if (!path.startsWith('revisions/')) continue
    patchJson(parts, path, (revision) => patch(revision.project as Record<string, unknown>))
  }
}

function setManifestSchema(parts: Map<string, Uint8Array>, schema: number): void {
  patchJson(parts, 'manifest.json', (manifest) => {
    ;(manifest.project as Record<string, unknown>).projectSchemaVersion = schema
  })
}

/** 把当前 schema7 容器降级为旧 schema（并删除旧格式不允许的新字段）。 */
async function downgradeTo(schema: 4 | 5 | 6, bytes: Uint8Array): Promise<Uint8Array> {
  return rebuildArchive(bytes, (parts) => {
    patchAllProjects(parts, (project) => {
      project.schemaVersion = schema
      delete project.requirementRevisions
      delete project.activeRequirementRevisionId
      delete project.currentRequirementCheck
      if (schema <= 5) {
        project.dimensionLinks = []
        project.parameters = (project.parameters as Record<string, unknown>[]).map(
          (parameter) => {
            const { parameterRevision: _revision, ...rest } = parameter
            void _revision
            return rest
          },
        )
      }
      if (schema <= 4) {
        project.parameters = []
        project.drawings = []
      }
    })
    if (schema <= 4) {
      patchJson(parts, 'manifest.json', (manifest) => {
        ;(manifest.counts as Record<string, unknown>).drawings = 0
      })
    }
    setManifestSchema(parts, schema)
  })
}

describe('V3.5 schema7 迁移矩阵：旧 3/4/5/6 默认无条款', () => {
  it('schema3（真实 B1 产物）读入：工作形状 7、无条款、旧历史 3 原样', async () => {
    const decoded = await decodeProjectFile(new Uint8Array(readFileSync(B1_FIXTURE)))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    const project = decoded.value.snapshot.project
    expect(decoded.value.manifest.project.projectSchemaVersion).toBe(3)
    expect(project.schemaVersion).toBe(7)
    expect(project.requirementRevisions).toEqual([])
    expect(project.activeRequirementRevisionId).toBeNull()
    expect(project.currentRequirementCheck).toBeNull()
    expect(decoded.value.snapshot.fileRevisions[0]?.project.schemaVersion).toBe(3)
    // PDF 字节未变。
    expect(decoded.value.snapshot.attachments[0]?.bytes.byteLength).toBe(1126)
  })

  for (const schema of [4, 5, 6] as const) {
    it(`schema${schema} 读入：工作形状 7、默认无条款、旧历史保持 ${schema}`, async () => {
      const base = await createSpacerSnapshot({ length: '12.00', confirmed: true })
      const encoded = await encodeProjectFile(base)
      if (!encoded.ok) throw new Error('encode failed')
      const bytes = await downgradeTo(schema, encoded.value.bytes)

      const decoded = await decodeProjectFile(bytes)
      expect(decoded.ok, decoded.ok ? '' : `${decoded.error.code}: ${decoded.error.message}`).toBe(
        true,
      )
      if (!decoded.ok) return
      const project = decoded.value.snapshot.project
      expect(decoded.value.manifest.project.projectSchemaVersion).toBe(schema)
      expect(project.schemaVersion).toBe(7)
      expect(project.requirementRevisions).toEqual([])
      expect(project.activeRequirementRevisionId).toBeNull()
      expect(project.currentRequirementCheck).toBeNull()
      expect(decoded.value.snapshot.fileRevisions[0]?.project.schemaVersion).toBe(schema)
      // 既有数值/PDF 不因迁移改变。
      expect(project.dimensionChain.terms.map((term) => term.nominalQ)).toEqual([
        522000, 200000, 120000, 200000,
      ])
      expect(decoded.value.snapshot.attachments[0]?.bytes.byteLength).toBeGreaterThan(0)

      // 首次保存：追加 schema7 版本，旧历史原样。
      const upgraded = upgradeSnapshotToCurrent(decoded.value.snapshot, {
        newRevisionId: () => `rev-upgrade-${schema}`,
      })
      expect(upgraded.upgraded).toBe(true)
      expect(upgraded.snapshot.fileRevisions[0]?.project.schemaVersion).toBe(schema)
      expect(upgraded.snapshot.fileRevisions.at(-1)?.project.schemaVersion).toBe(7)
      const reopened = await encodeProjectFile(upgraded.snapshot)
      expect(reopened.ok, reopened.ok ? '' : reopened.error.message).toBe(true)
    })
  }

  it('schema7 正常读写：条款版本/活动指针/检查逐字段保留', async () => {
    const { createRequirementProject } = await import('../requirements/__fixtures__/requirementFixture')
    const project = await createRequirementProject()
    const encoded = await encodeProjectFile(project.snapshot)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    expect(encoded.value.manifest.project.projectSchemaVersion).toBe(7)

    const decoded = await decodeProjectFile(encoded.value.bytes)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    const decodedProject = decoded.value.snapshot.project
    expect(decodedProject.requirementRevisions).toEqual(project.snapshot.project.requirementRevisions)
    expect(decodedProject.activeRequirementRevisionId).toBe('reqrev-1')
    expect(decodedProject.currentRequirementCheck).toEqual(
      project.snapshot.project.currentRequirementCheck,
    )
    expect(decoded.value.manifest.counts.projectRevisions).toBe(2)
  })
})

describe('V3.5 schema7 严格校验', () => {
  it('schema8 明确拒绝（UNSUPPORTED_VERSION），不猜', async () => {
    const base = await createSampleSnapshot()
    const encoded = await encodeProjectFile(base)
    if (!encoded.ok) throw new Error('encode failed')
    const bytes = await rebuildArchive(encoded.value.bytes, (parts) => {
      setManifestSchema(parts, 8)
      patchJson(parts, 'project/project.json', (project) => {
        project.schemaVersion = 8
      })
    })
    const decoded = await decodeProjectFile(bytes)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.code).toBe('UNSUPPORTED_VERSION')
  })

  it('schema6 记录混入 Beta 条款字段时拒绝（不把新证据塞进旧快照）', async () => {
    const base = await createSampleSnapshot()
    const encoded = await encodeProjectFile(base)
    if (!encoded.ok) throw new Error('encode failed')
    const bytes = await rebuildArchive(encoded.value.bytes, (parts) => {
      setManifestSchema(parts, 6)
      patchAllProjects(parts, (project) => {
        project.schemaVersion = 6
        project.requirementRevisions = []
      })
    })
    const decoded = await decodeProjectFile(bytes)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.code).toBe('INVALID_RECORD')
  })

  it('两个 requirementId 并存时拒绝（Beta 只允许一条）', async () => {
    const { createRequirementProject } = await import('../requirements/__fixtures__/requirementFixture')
    const project = await createRequirementProject()
    const requirement = project.snapshot.project.requirementRevisions[0]!
    const broken: ProjectFileSnapshot = {
      ...project.snapshot,
      project: {
        ...project.snapshot.project,
        requirementRevisions: [
          requirement,
          { ...requirement, revisionId: 'reqrev-x', requirementId: 'req-2' },
        ],
      },
    }
    const encoded = await encodeProjectFile(broken)
    expect(encoded.ok).toBe(false)
    if (!encoded.ok) expect(encoded.error.code).toBe('INVALID_RECORD')
  })

  it('活动条款指针悬空时拒绝（MISSING_REFERENCE）', async () => {
    const { createRequirementProject } = await import('../requirements/__fixtures__/requirementFixture')
    const project = await createRequirementProject()
    const broken: ProjectFileSnapshot = {
      ...project.snapshot,
      project: { ...project.snapshot.project, activeRequirementRevisionId: 'reqrev-missing' },
    }
    const encoded = await encodeProjectFile(broken)
    expect(encoded.ok).toBe(false)
    if (!encoded.ok) expect(encoded.error.code).toBe('MISSING_REFERENCE')
  })

  it('当前检查引用不存在的条款版本时拒绝', async () => {
    const { createRequirementProject } = await import('../requirements/__fixtures__/requirementFixture')
    const project = await createRequirementProject()
    const check = project.snapshot.project.currentRequirementCheck!
    const broken: ProjectFileSnapshot = {
      ...project.snapshot,
      project: {
        ...project.snapshot.project,
        currentRequirementCheck: {
          ...check,
          requirementRevisionId: 'reqrev-missing',
          evidenceRef: { ...check.evidenceRef!, requirementRevisionId: 'reqrev-missing' },
        },
      },
    }
    const encoded = await encodeProjectFile(broken)
    expect(encoded.ok).toBe(false)
    if (!encoded.ok) expect(encoded.error.code).toBe('MISSING_REFERENCE')
  })
})
