import { promises as fsp } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../shared/contracts'
import type { ProjectOpenValue, ProjectSaveValue } from '../shared/contracts'
import { decodeProjectFile } from '../../src/project-file/codec'
import { createHarness } from './helpers/a04'

const B1_FIXTURE = fileURLToPath(
  new URL('../../src/project-file/__fixtures__/b1-project-v1.cunlian', import.meta.url),
)

async function sha256File(targetPath: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(await fsp.readFile(targetPath)).digest('hex')
}

describe('B2-02 首次保存显式升级（真实 B1 产物）', () => {
  it('打开不写盘；保存升级为格式 2 并保留旧 schema3 历史；二次保存不重复升级', async () => {
    const harness = await createHarness()
    try {
      const target = harness.samplePath('b1-project')
      await fsp.copyFile(B1_FIXTURE, target)
      const before = await sha256File(target)

      harness.openQueue.push(target)
      const opened = await harness.invoke<ProjectOpenValue>(IPC_CHANNELS.projectOpen, {})
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      expect(opened.value.snapshot.project.sourceFormatVersion).toBe(1)
      expect(opened.value.snapshot.project.schemaVersion).toBe(11)
      expect(opened.value.snapshot.project.modelRevisions).toEqual([])
      expect(opened.value.snapshot.project.dimensionChain.terms.map((term) => term.nominalQ)).toEqual([
        522000, 200000, 120000, 200000,
      ])
      // 打开只读：磁盘字节不变，也不产生 dirty。
      expect(await sha256File(target)).toBe(before)
      expect(opened.value.editSeq).toBe(0)
      const session = harness.projectService.getSession(opened.value.sessionId)!
      expect(session.acceptedSeq).toBe(session.savedSeq)

      const saved = await harness.invoke<ProjectSaveValue>(IPC_CHANNELS.projectSave, {
        sessionId: opened.value.sessionId,
        editSeq: 0,
        expectedFingerprint: opened.value.fingerprint,
      })
      expect(saved.ok).toBe(true)
      if (!saved.ok) return
      expect(saved.value.warnings.join(' ')).toContain('已升级为项目文件格式 2')
      expect(saved.value.warnings.join(' ')).toContain('不能打开')

      const after = await decodeProjectFile(new Uint8Array(await fsp.readFile(target)))
      expect(after.ok).toBe(true)
      if (!after.ok) return
      expect(after.value.manifest.formatVersion).toBe(2)
      expect(after.value.manifest.project.projectSchemaVersion).toBe(11)
      expect(after.value.snapshot.project.sourceFormatVersion).toBe(2)
      expect(after.value.snapshot.fileRevisions).toHaveLength(2)
      // 旧版本保留 schema3 原样。
      expect(after.value.snapshot.fileRevisions[0]?.project.schemaVersion).toBe(3)
      const newest = after.value.snapshot.fileRevisions[1]!
      expect(newest.project.schemaVersion).toBe(11)
      expect(newest.parentId).toBe('rev-a1')
      expect(newest.revisionId).toBe(after.value.snapshot.project.currentRevisionId)
      expect(after.value.snapshot.project.dimensionChain.terms.map((term) => term.nominalQ)).toEqual([
        522000, 200000, 120000, 200000,
      ])
      // PDF 字节与哈希仍在。
      expect(
        after.value.snapshot.attachments.find((item) => item.blobKey === 'blob-1')?.bytes.byteLength,
      ).toBe(1126)
      expect(after.value.manifest.counts.models).toBe(0)

      // 第二次保存不再追加升级版本。
      const second = await harness.invoke<ProjectSaveValue>(IPC_CHANNELS.projectSave, {
        sessionId: opened.value.sessionId,
        editSeq: 0,
        expectedFingerprint: saved.value.fingerprint,
      })
      expect(second.ok).toBe(true)
      if (second.ok) {
        expect(second.value.warnings.join(' ')).not.toContain('已升级为项目文件格式 2')
      }
      const third = await decodeProjectFile(new Uint8Array(await fsp.readFile(target)))
      expect(third.ok).toBe(true)
      if (third.ok) {
        expect(third.value.snapshot.fileRevisions).toHaveLength(2)
        expect(third.value.snapshot.project.sourceFormatVersion).toBe(2)
      }
    } finally {
      await harness.dispose()
    }
  })

  it('另存为写新文件不覆盖原 B1 文件；新文件为格式 2', async () => {
    const harness = await createHarness()
    try {
      const target = harness.samplePath('b1-source')
      await fsp.copyFile(B1_FIXTURE, target)
      const originalHash = await sha256File(target)
      harness.openQueue.push(target)
      const opened = await harness.invoke<ProjectOpenValue>(IPC_CHANNELS.projectOpen, {})
      if (!opened.ok) throw new Error('open failed')
      const copy = harness.samplePath('b1-copy')
      harness.saveTargetValue = copy
      const saved = await harness.invoke<ProjectSaveValue>(IPC_CHANNELS.projectSaveAs, {
        sessionId: opened.value.sessionId,
        editSeq: 0,
      })
      expect(saved.ok).toBe(true)
      expect(await sha256File(target)).toBe(originalHash)
      const decoded = await decodeProjectFile(new Uint8Array(await fsp.readFile(copy)))
      expect(decoded.ok).toBe(true)
      if (decoded.ok) {
        expect(decoded.value.manifest.formatVersion).toBe(2)
        expect(decoded.value.snapshot.project.sourceFormatVersion).toBe(2)
      }
    } finally {
      await harness.dispose()
    }
  })

  it('stageDraft 不能伪造模型/关联，也不能把已升级项目退回格式 1', async () => {
    const harness = await createHarness()
    try {
      const target = harness.samplePath('b1-stage')
      await fsp.copyFile(B1_FIXTURE, target)
      harness.openQueue.push(target)
      const opened = await harness.invoke<ProjectOpenValue>(IPC_CHANNELS.projectOpen, {})
      if (!opened.ok) throw new Error('open failed')
      const dto = opened.value.snapshot
      const forged = {
        ...dto,
        project: {
          ...dto.project,
          sourceFormatVersion: 1 as const,
          parts: [
            {
              partId: 'part-forged',
              kind: 'imported-mesh' as const,
              name: '伪造部件',
              currentModelRevisionId: 'model-forged',
              origin: 'stl-import' as const,
            },
          ],
          modelRevisions: [
            {
              modelRevisionId: 'model-forged',
              partId: 'part-forged',
              kind: 'stl' as const,
              parentModelRevisionId: null,
              createdAt: '2026-11-09T10:00:00.000Z',
              reason: 'forged',
              fileName: 'forged.stl',
              blobKey: 'blob-forged',
              attachmentSha256: 'a'.repeat(64),
              byteSize: 1,
              encoding: 'binary' as const,
              triangleCount: 1,
              bounds: { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] },
              unitNote: '',
            },
          ],
        },
      }
      const staged = await harness.invoke(IPC_CHANNELS.projectStage, {
        sessionId: opened.value.sessionId,
        editSeq: 1,
        snapshot: forged,
      })
      expect(staged.ok).toBe(true)
      const session = harness.projectService.getSession(opened.value.sessionId)!
      // 权威模型数组来自 main：伪造内容被丢弃，来源格式仍是 1（待保存时升级）。
      expect(session.snapshot.project.parts).toEqual([])
      expect(session.snapshot.project.modelRevisions).toEqual([])
      expect(session.snapshot.project.sourceFormatVersion).toBe(1)
    } finally {
      await harness.dispose()
    }
  })
})
