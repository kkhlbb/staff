/**
 * 测试辅助：把当前 schema8 容器降级为 schema6/5，用于真实“旧文件”迁移用例。
 * 只用于测试；不进入产品路径。
 */
import { readZipEntries, writeZipEntries } from '../../../src/backup/zip'
import { sha256Hex } from '../../../src/sources/hash'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export async function rewriteArchive(
  bytes: Uint8Array,
  mutate: (parts: Map<string, Uint8Array>) => void,
): Promise<Uint8Array> {
  const zip = await readZipEntries(bytes)
  if (!zip.ok) throw new Error(`不是合法 ZIP：${zip.error.message}`)
  const parts = zip.value
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
  const written = await writeZipEntries(
    [...parts].map(([path, value]) => ({ path, bytes: value })),
  )
  if (!written.ok) throw new Error(`重写失败：${written.error.message}`)
  return written.value
}

export function patchJson(
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

/** 当前产物 → schema6（D），去掉 Beta 条款字段。 */
export async function downgradeToSchema6(bytes: Uint8Array): Promise<Uint8Array> {
  return rewriteArchive(bytes, (parts) => {
    const strip = (project: Record<string, unknown>): void => {
      project.schemaVersion = 6
      delete project.requirementRevisions
      delete project.activeRequirementRevisionId
      delete project.currentRequirementCheck
      delete project.extractionDrafts
    }
    patchJson(parts, 'project/project.json', strip)
    for (const path of [...parts.keys()]) {
      if (path.startsWith('revisions/')) {
        patchJson(parts, path, (revision) => strip(revision.project as Record<string, unknown>))
      }
    }
    patchJson(parts, 'manifest.json', (manifest) => {
      ;(manifest.project as Record<string, unknown>).projectSchemaVersion = 6
    })
  })
}
