import { describe, expect, it } from 'vitest'
import { readZipEntries, writeZipEntries } from '../backup/zip'
import { sha256Hex } from '../sources/hash'
import { decodeProjectFile, encodeProjectFile } from './codec'
import { upgradeSnapshotToCurrent } from './upgrade'
import { createSpacerSnapshot } from './__fixtures__/spacerProjectFile'
import type { ProjectFileSnapshot } from './types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

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

describe('D-01 schema 6 持久化与旧版本读取', () => {
  it('schema6 往返：parameterRevision、参数绑定、版本证据逐字段保留', async () => {
    const snapshot = await createSpacerSnapshot({ length: '14.00', confirmed: true })
    const parameters = snapshot.project.parameters.map((parameter) =>
      parameter.key === 'length' ? { ...parameter, parameterRevision: 3 } : { ...parameter },
    )
    const withRevision: ProjectFileSnapshot = {
      ...snapshot,
      project: {
        ...snapshot.project,
        parameters,
      },
    }
    const encoded = await encodeProjectFile(withRevision)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    expect(encoded.value.manifest.project.projectSchemaVersion).toBe(11)

    const decoded = await decodeProjectFile(encoded.value.bytes)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    const project = decoded.value.snapshot.project
    expect(project.schemaVersion).toBe(11)
    expect(project.parameters.find((item) => item.key === 'length')!.parameterRevision).toBe(3)
    const binding = project.dimensionLinks.find((link) => link.kind === 'parameter-binding')
    expect(binding).toMatchObject({
      termId: 't-s',
      parameterId: 'param:spacer:length',
      syncField: 'nominal',
    })
    const confirmed = decoded.value.snapshot.events.find(
      (event) => event.type === 'parameter_binding_confirmed',
    )
    expect(confirmed?.drawingFingerprint).toBe(project.drawings[0]!.dataFingerprint)
  })

  it('读 schema5 文件：参数补 parameterRevision=1、无第二套确认、历史版本原样', async () => {
    const snapshot = await createSpacerSnapshot({ length: '12.00' })
    const encoded = await encodeProjectFile(snapshot)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return

    const bytes = await rebuildArchive(encoded.value.bytes, (parts) => {
      patchJson(parts, 'manifest.json', (manifest) => {
        ;(manifest.project as Record<string, unknown>).projectSchemaVersion = 5
      })
      patchJson(parts, 'project/project.json', (project) => {
        project.schemaVersion = 5
        project.dimensionLinks = []
        delete project.requirementRevisions
        delete project.activeRequirementRevisionId
        delete project.currentRequirementCheck
        delete project.extractionDrafts
        delete project.sourceKind
        delete project.actorId
        delete project.sessionSeq
        delete project.sessionLabel
        delete project.attestations
        project.parameters = (project.parameters as Record<string, unknown>[]).map((parameter) => {
          const { parameterRevision: _revision, ...rest } = parameter
          void _revision
          return rest
        })
      })
      patchJson(parts, 'revisions/rev-a1.json', (revision) => {
        const project = revision.project as Record<string, unknown>
        project.schemaVersion = 5
        project.dimensionLinks = []
        delete project.requirementRevisions
        delete project.activeRequirementRevisionId
        delete project.currentRequirementCheck
        delete project.extractionDrafts
        delete project.sourceKind
        delete project.actorId
        delete project.sessionSeq
        delete project.sessionLabel
        delete project.attestations
        project.parameters = (project.parameters as Record<string, unknown>[]).map((parameter) => {
          const { parameterRevision: _revision, ...rest } = parameter
          void _revision
          return rest
        })
      })
    })

    const decoded = await decodeProjectFile(bytes)
    expect(decoded.ok, decoded.ok ? '' : `${decoded.error.code}: ${decoded.error.message}`).toBe(true)
    if (!decoded.ok) return
    expect(decoded.value.manifest.project.projectSchemaVersion).toBe(5)
    expect(decoded.value.snapshot.project.schemaVersion).toBe(11)
    expect(decoded.value.snapshot.project.parameters.every((item) => item.parameterRevision === 1)).toBe(true)
    expect(decoded.value.snapshot.project.dimensionLinks).toEqual([])
    // 历史版本保持 schema5 原样，不被改写。
    expect(decoded.value.snapshot.fileRevisions[0]!.project.schemaVersion).toBe(5)

    // 首次保存显式升级：新增 schema11 版本，旧版仍是 5。
    const upgraded = upgradeSnapshotToCurrent(decoded.value.snapshot, { newRevisionId: () => 'rev-upgrade' })
    expect(upgraded.upgraded).toBe(true)
    expect(upgraded.snapshot.project.schemaVersion).toBe(11)
    expect(upgraded.snapshot.fileRevisions[0]!.project.schemaVersion).toBe(5)
    expect(upgraded.snapshot.fileRevisions.at(-1)!.project.schemaVersion).toBe(11)
    const reopened = await encodeProjectFile(upgraded.snapshot)
    expect(reopened.ok).toBe(true)
  })

  it('manifest 与 project.json 的 schema 不一致时拒绝，而不是猜', async () => {
    const snapshot = await createSpacerSnapshot()
    const encoded = await encodeProjectFile(snapshot)
    if (!encoded.ok) throw new Error('encode failed')
    const bytes = await rebuildArchive(encoded.value.bytes, (parts) => {
      patchJson(parts, 'manifest.json', (manifest) => {
        ;(manifest.project as Record<string, unknown>).projectSchemaVersion = 5
      })
    })
    const decoded = await decodeProjectFile(bytes)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.code).toBe('INVALID_MANIFEST')
  })

  it('悬空参数绑定与同环第二绑定的伪确认被拒绝', async () => {
    const snapshot = await createSpacerSnapshot()
    const broken = {
      ...snapshot,
      project: {
        ...snapshot.project,
        dimensionLinks: [
          ...snapshot.project.dimensionLinks,
          {
            kind: 'parameter-binding' as const,
            bindingId: 'binding-dup',
            termId: 't-s',
            partId: snapshot.project.parameters[0]!.partId,
            parameterId: snapshot.project.parameters[0]!.parameterId,
            syncField: 'nominal' as const,
            createdAt: '2026-11-09T09:00:00.000Z',
          },
        ],
      },
    }
    const encoded = await encodeProjectFile(broken)
    expect(encoded.ok).toBe(false)
    if (!encoded.ok) expect(encoded.error.code).toBe('INVALID_RECORD')

    const dangling = {
      ...snapshot,
      project: {
        ...snapshot.project,
        dimensionLinks: [
          {
            ...(snapshot.project.dimensionLinks[0] as unknown as Record<string, unknown>),
            parameterId: 'param:missing',
          },
        ],
      },
    }
    const encoded2 = await encodeProjectFile(dangling as never)
    expect(encoded2.ok).toBe(false)
    if (!encoded2.ok) expect(['MISSING_REFERENCE', 'INVALID_RECORD']).toContain(encoded2.error.code)
  })
})
