/**
 * V3.5：迁移前可恢复副本（真实临时目录 + 真实 FileStore/ProjectService）。
 *
 * 证明：副本覆盖 PDF、模型、图纸引用、历史与草稿；字节与原文一致；二次保存
 * 不重复备份；备份失败阻止升级且原文件不变；另存升级保留原文件并记录路径。
 */
import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../shared/contracts'
import type { ProjectOpenValue, ProjectSaveValue } from '../shared/contracts'
import { decodeProjectFile, encodeProjectFile } from '../../src/project-file/codec'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import { createModelSnapshot } from '../../src/project-file/__fixtures__/modelProjectFile'
import { createSpacerSnapshot } from '../../src/project-file/__fixtures__/spacerProjectFile'
import { chainToDraft } from '../../src/workspace/draft'
import { upgradeSnapshotToCurrent } from '../../src/project-file/upgrade'
import { nodeFileOps, type FileOps } from '../main/fileStore'
import { createHarness } from './helpers/a04'
import { downgradeToSchema6 } from './helpers/legacyArchive'

async function sha256File(targetPath: string): Promise<string> {
  return createHash('sha256').update(await fsp.readFile(targetPath)).digest('hex')
}

async function backupFiles(directory: string): Promise<string[]> {
  const entries = await fsp.readdir(directory)
  return entries.filter((name) => name.includes('.pre-v35.')).sort()
}

async function writeLegacy(
  directory: string,
  name: string,
  snapshot: ProjectFileSnapshot,
): Promise<{ target: string; bytes: Uint8Array }> {
  const encoded = await encodeProjectFile(snapshot)
  if (!encoded.ok) throw new Error(`encode failed: ${encoded.error.message}`)
  const bytes = await downgradeToSchema6(encoded.value.bytes)
  const target = path.join(directory, name)
  await fsp.writeFile(target, bytes)
  return { target, bytes }
}

describe('V3.5 迁移前副本：覆盖 PDF/模型/历史/草稿', () => {
  it('首次保存 schema6 文件：备份字节一致、模型与草稿可恢复、二次保存不重复', async () => {
    const { snapshot: modelSnapshot } = await createModelSnapshot()
    const draft = chainToDraft(modelSnapshot.project.dimensionChain)
    const snapshot: ProjectFileSnapshot = { ...modelSnapshot, draft }
    const harness = await createHarness({ newBackupSuffix: () => 'fixed' })
    try {
      const { target, bytes } = await writeLegacy(harness.directory, 'legacy-model.cunlian', snapshot)
      const beforeHash = createHash('sha256').update(bytes).digest('hex')
      const backupPath = `${target}.pre-v35.fixed.cunlian`

      harness.openQueue.push(target)
      const opened = await harness.invoke<ProjectOpenValue>(IPC_CHANNELS.projectOpen, {})
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      expect(opened.value.snapshot.project.schemaVersion).toBe(8)
      const session = harness.projectService.getSession(opened.value.sessionId)!
      expect(session.sourceProjectSchemaVersion).toBe(6)

      const saved = await harness.invoke<ProjectSaveValue>(IPC_CHANNELS.projectSave, {
        sessionId: opened.value.sessionId,
        editSeq: 0,
        expectedFingerprint: opened.value.fingerprint,
      })
      expect(saved.ok, saved.ok ? '' : `${saved.error.code}: ${saved.error.message}`).toBe(true)
      if (!saved.ok) return
      expect(saved.value.warnings.join(' ')).toContain('迁移前已创建可恢复副本')
      expect(saved.value.warnings.join(' ')).toContain(backupPath)

      // 副本是最终文件（非 .tmp），字节与迁移前完全一致。
      expect(path.extname(backupPath)).toBe('.cunlian')
      expect(await sha256File(backupPath)).toBe(beforeHash)

      const backup = await decodeProjectFile(new Uint8Array(await fsp.readFile(backupPath)))
      expect(backup.ok).toBe(true)
      if (!backup.ok) return
      const restored = backup.value.snapshot
      expect(backup.value.manifest.project.projectSchemaVersion).toBe(6)
      expect(restored.project.parts).toHaveLength(1)
      expect(restored.project.modelRevisions).toHaveLength(1)
      expect(restored.draft).toEqual(draft)
      expect(restored.documents).toEqual(modelSnapshot.documents)
      expect(restored.revisions).toEqual(modelSnapshot.revisions)
      expect(restored.events.length).toBe(modelSnapshot.events.length)
      expect(restored.analysisSnapshots.length).toBe(modelSnapshot.analysisSnapshots.length)
      expect(restored.fileRevisions.length).toBe(modelSnapshot.fileRevisions.length)
      const pdf = restored.attachments.find((item) => item.blobKey === 'blob-1')
      const model = restored.attachments.find((item) => item.blobKey !== 'blob-1')
      expect(pdf?.bytes.byteLength).toBeGreaterThan(0)
      expect(model?.bytes.byteLength).toBeGreaterThan(0)

      // 升级写盘：新版本为 8，旧历史仍是 6。
      const after = await decodeProjectFile(new Uint8Array(await fsp.readFile(target)))
      expect(after.ok).toBe(true)
      if (!after.ok) return
      expect(after.value.manifest.project.projectSchemaVersion).toBe(8)
      expect(after.value.snapshot.fileRevisions).toHaveLength(modelSnapshot.fileRevisions.length + 1)
      expect(after.value.snapshot.fileRevisions[0]?.project.schemaVersion).toBe(6)
      expect(after.value.snapshot.fileRevisions.at(-1)?.project.schemaVersion).toBe(8)

      // 二次保存不再创建副本。
      const second = await harness.invoke<ProjectSaveValue>(IPC_CHANNELS.projectSave, {
        sessionId: opened.value.sessionId,
        editSeq: 0,
        expectedFingerprint: saved.value.fingerprint,
      })
      expect(second.ok).toBe(true)
      if (second.ok) {
        expect(second.value.warnings.join(' ')).not.toContain('迁移前已创建可恢复副本')
      }
      expect(await backupFiles(harness.directory)).toEqual([path.basename(backupPath)])
    } finally {
      await harness.dispose()
    }
  })

  it('图纸引用与历史快照也包含在副本中', async () => {
    const snapshot = await createSpacerSnapshot({ length: '12.04', confirmed: true })
    expect(snapshot.project.drawings).toHaveLength(1)
    const harness = await createHarness({ newBackupSuffix: () => 'drawing' })
    try {
      const { target } = await writeLegacy(harness.directory, 'legacy-drawing.cunlian', snapshot)
      harness.openQueue.push(target)
      const opened = await harness.invoke<ProjectOpenValue>(IPC_CHANNELS.projectOpen, {})
      if (!opened.ok) throw new Error('open failed')
      const saved = await harness.invoke<ProjectSaveValue>(IPC_CHANNELS.projectSave, {
        sessionId: opened.value.sessionId,
        editSeq: 0,
        expectedFingerprint: opened.value.fingerprint,
      })
      expect(saved.ok).toBe(true)
      const backup = await decodeProjectFile(
        new Uint8Array(await fsp.readFile(`${target}.pre-v35.drawing.cunlian`)),
      )
      expect(backup.ok).toBe(true)
      if (!backup.ok) return
      expect(backup.value.snapshot.project.drawings).toEqual(snapshot.project.drawings)
      expect(backup.value.snapshot.events.length).toBe(snapshot.events.length)
      expect(backup.value.snapshot.analysisSnapshots).toEqual(snapshot.analysisSnapshots)
    } finally {
      await harness.dispose()
    }
  })
})

describe('V3.5 迁移屏障：备份失败阻止升级', () => {
  it('副本写入失败 → BACKUP_FAILED，原文件字节不变、无副本残留', async () => {
    const failing: FileOps = {
      ...nodeFileOps,
      async writeExclusive(targetPath, bytes) {
        if (targetPath.includes('.pre-v35.')) {
          const error = new Error('EACCES: denied') as NodeJS.ErrnoException
          error.code = 'EACCES'
          throw error
        }
        return nodeFileOps.writeExclusive(targetPath, bytes)
      },
    }
    const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    const harness = await createHarness({ fileOps: failing, newBackupSuffix: () => 'fail' })
    try {
      const { target } = await writeLegacy(harness.directory, 'legacy-fail.cunlian', snapshot)
      const before = await sha256File(target)
      harness.openQueue.push(target)
      const opened = await harness.invoke<ProjectOpenValue>(IPC_CHANNELS.projectOpen, {})
      if (!opened.ok) throw new Error('open failed')

      const saved = await harness.invoke<ProjectSaveValue>(IPC_CHANNELS.projectSave, {
        sessionId: opened.value.sessionId,
        editSeq: 0,
        expectedFingerprint: opened.value.fingerprint,
      })
      expect(saved.ok).toBe(false)
      if (!saved.ok) expect(saved.error.code).toBe('BACKUP_FAILED')
      expect(await sha256File(target)).toBe(before)
      expect(await backupFiles(harness.directory)).toEqual([])
      const session = harness.projectService.getSession(opened.value.sessionId)!
      expect(session.sourceProjectSchemaVersion).toBe(6)
    } finally {
      await harness.dispose()
    }
  })
})

describe('V3.5 另存升级与提交路径', () => {
  it('另存升级：原文件不覆盖、显式记录保留路径；新文件为 schema8', async () => {
    const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    const harness = await createHarness({ newBackupSuffix: () => 'saveas' })
    try {
      const { target } = await writeLegacy(harness.directory, 'legacy-source.cunlian', snapshot)
      const originalHash = await sha256File(target)
      harness.openQueue.push(target)
      const opened = await harness.invoke<ProjectOpenValue>(IPC_CHANNELS.projectOpen, {})
      if (!opened.ok) throw new Error('open failed')

      const copy = path.join(harness.directory, 'legacy-copy.cunlian')
      harness.saveTargetValue = copy
      const saved = await harness.invoke<ProjectSaveValue>(IPC_CHANNELS.projectSaveAs, {
        sessionId: opened.value.sessionId,
        editSeq: 0,
      })
      expect(saved.ok).toBe(true)
      if (!saved.ok) return
      expect(saved.value.warnings.join(' ')).toContain('另存升级')
      expect(saved.value.warnings.join(' ')).toContain(target)
      // 原文件不覆盖，且没有额外副本（原文件本身即恢复来源）。
      expect(await sha256File(target)).toBe(originalHash)
      expect(await backupFiles(harness.directory)).toEqual([])
      const decoded = await decodeProjectFile(new Uint8Array(await fsp.readFile(copy)))
      expect(decoded.ok).toBe(true)
      if (decoded.ok) {
        expect(decoded.value.manifest.project.projectSchemaVersion).toBe(8)
      }
    } finally {
      await harness.dispose()
    }
  })

  it('commitCandidate 覆盖旧 schema 文件前也创建副本', async () => {
    const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    const harness = await createHarness({ newBackupSuffix: () => 'commit' })
    try {
      const { target } = await writeLegacy(harness.directory, 'legacy-commit.cunlian', snapshot)
      const before = await sha256File(target)
      harness.openQueue.push(target)
      const opened = await harness.invoke<ProjectOpenValue>(IPC_CHANNELS.projectOpen, {})
      if (!opened.ok) throw new Error('open failed')
      const session = harness.projectService.getSession(opened.value.sessionId)!
      const upgraded = upgradeSnapshotToCurrent(session.snapshot, {
        newRevisionId: () => 'rev-commit-upgrade',
      })
      const committed = await harness.projectService.commitCandidate(opened.value.sessionId, {
        baseEditSeq: 0,
        candidate: upgraded.snapshot,
        guard: () => null,
      })
      expect(committed.ok, committed.ok ? '' : `${committed.error.code}: ${committed.error.message}`).toBe(
        true,
      )
      if (!committed.ok) return
      expect(committed.value.warnings.join(' ')).toContain('迁移前已创建可恢复副本')
      expect(await sha256File(`${target}.pre-v35.commit.cunlian`)).toBe(before)
    } finally {
      await harness.dispose()
    }
  })
})
