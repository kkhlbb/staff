/**
 * V3.5 桌面 PDF 导入/换版通道（source:import）。
 *
 * 覆盖：
 * - 新建文档：main 自算哈希与页数，新增不可变 revision + 独立 blob + 附件字节；
 * - 同文档换版：旧 revision/旧 blob 保留，latest 前进，条款检查转待确认；
 * - 失败零写入：非法 PDF / 越界文件名不产生半截文档或附件；
 * - 不接受 renderer 传入路径/blobKey（schema 层面）。
 */
import { describe, expect, it } from 'vitest'
import { createRequirementProject } from '../../src/requirements/__fixtures__/requirementFixture'
import { computeCandidateRequirementCheck } from '../../src/requirements/check'
import { sha256Hex } from '../../src/sources/hash'
import { IPC_CHANNELS } from '../shared/contracts'
import { registerSourceChannels, type SourceChannelDeps } from '../main/sourceChannels'
import { inspectSourcePdf } from '../main/pdfSourceInspect'
import { createHarness } from './helpers/a04'
import { createTwoPageTaskbookPdf } from './helpers/taskbookPdf'

function memoryIo(files: Map<string, Uint8Array>): SourceChannelDeps['io'] {
  return {
    async kindOf(path) {
      return files.has(path) ? 'file' : 'missing'
    },
    async sizeOf(path) {
      return files.get(path)?.byteLength ?? null
    },
    async readUpTo(path, max) {
      const bytes = files.get(path)
      if (bytes === undefined) throw new Error('missing')
      return bytes.slice(0, Math.min(max, bytes.byteLength))
    },
  }
}

async function setup() {
  const harness = await createHarness()
  const project = await createRequirementProject()
  const opened = await harness.openSample(project.snapshot, 'req-source')
  const sessionId = opened.sessionId
  const files = new Map<string, Uint8Array>()
  const io = memoryIo(files)
  registerSourceChannels(harness.ipc, {
    guard: harness.guard,
    controller: harness.controller,
    projectService: harness.projectService,
    recovery: harness.recovery,
    pickSourcePath: async () => [...files.keys()][0] ?? null,
    io,
    inspectPdf: (bytes) => inspectSourcePdf(bytes),
    log: () => undefined,
  })
  return { harness, sessionId, files }
}

describe('V3.5 source:import：桌面 PDF 导入/换版', () => {
  it('导入两页任务书：固定哈希/页数/页框，新增独立 blob 与附件', async () => {
    const { harness, sessionId, files } = await setup()
    try {
      const bytes = createTwoPageTaskbookPdf()
      files.set('/memory/taskbook.pdf', bytes)
      const before = harness.projectService.getSession(sessionId)!
      const beforeSeq = before.acceptedSeq
      const result = await harness.invoke<import('../shared/contracts').SourceImportValue>(
        IPC_CHANNELS.sourceImport,
        { sessionId, baseEditSeq: before.acceptedSeq },
      )
      expect(result.ok, result.ok ? '' : `${result.error.code}: ${result.error.message}`).toBe(true)
      if (!result.ok) return
      expect(result.value.pageCount).toBe(2)
      expect(result.value.pages[1]?.pageBoxPdf).toEqual([100, 200, 795, 1042])
      expect(result.value.sha256).toBe(await sha256Hex(bytes))
      expect(result.value.snapshot.documents.some((doc) => doc.id === result.value.documentId)).toBe(true)
      const revision = result.value.snapshot.revisions.find(
        (item) => item.id === result.value.revisionId,
      )
      expect(revision).toMatchObject({ pageCount: 2, documentId: result.value.documentId })
      expect(result.value.snapshot.blobs.some((blob) => blob.blobKey === result.value.blobKey)).toBe(true)
      const session = harness.projectService.getSession(sessionId)!
      expect(session.snapshot.attachments.some((item) => item.blobKey === result.value.blobKey)).toBe(true)
      expect(session.acceptedSeq).toBe(beforeSeq + 1)
    } finally {
      await harness.dispose()
    }
  })

  it('同文档换版：旧 revision/blob 保留，latest 前进，条款转待确认', async () => {
    const { harness, sessionId, files } = await setup()
    try {
      const session = harness.projectService.getSession(sessionId)!
      const previousRevisionId = session.snapshot.revisions[0]!.id
      const previousBlobKey = session.snapshot.blobs[0]!.blobKey
      files.set('/memory/taskbook-v2.pdf', createTwoPageTaskbookPdf())
      // 同一文档换版：documentId 指向现有文档。
      const result = await harness.invoke<import('../shared/contracts').SourceImportValue>(
        IPC_CHANNELS.sourceImport,
        { sessionId, baseEditSeq: session.acceptedSeq, documentId: session.snapshot.documents[0]!.id },
      )
      expect(result.ok, result.ok ? '' : `${result.error.code}: ${result.error.message}`).toBe(true)
      if (!result.ok) return
      const after = harness.projectService.getSession(sessionId)!
      const document = after.snapshot.documents.find((doc) => doc.id === result.value.documentId)!
      expect(document.latestRevisionId).toBe(result.value.revisionId)
      expect(after.snapshot.revisions.some((item) => item.id === previousRevisionId)).toBe(true)
      expect(after.snapshot.blobs.some((item) => item.blobKey === previousBlobKey)).toBe(true)
      expect(result.value.blobKey).not.toBe(previousBlobKey)

      const check = await computeCandidateRequirementCheck({
        snapshot: after.snapshot,
        requirementRevisions: after.snapshot.project.requirementRevisions,
        activeRequirementRevisionId: after.snapshot.project.activeRequirementRevisionId,
        pendingEdit: null,
        draft: null,
        baseRevisionId: after.snapshot.project.currentRevisionId,
        baseGeneration: 0,
        acceptedSeq: after.acceptedSeq,
        checkedAt: '2026-11-09T12:00:00.000Z',
        checkId: 'check-after-replace',
        inputIssue: null,
      })
      expect(check.ok).toBe(true)
      if (!check.ok) return
      expect(check.value.check.status).toBe('pending-confirmation')
      expect(check.value.check.reasonCodes).toContain('SOURCE_VERSION_CHANGED')
    } finally {
      await harness.dispose()
    }
  })

  it('非法 PDF 失败零写入：快照、附件、acceptedSeq 全不变', async () => {
    const { harness, sessionId, files } = await setup()
    try {
      files.set('/memory/broken.pdf', new TextEncoder().encode('not a pdf'))
      const before = harness.projectService.getSession(sessionId)!
      const documents = before.snapshot.documents.length
      const revisions = before.snapshot.revisions.length
      const blobs = before.snapshot.blobs.length
      const attachments = before.snapshot.attachments.length
      const acceptedSeq = before.acceptedSeq
      const result = await harness.invoke(IPC_CHANNELS.sourceImport, {
        sessionId,
        baseEditSeq: acceptedSeq,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(['SOURCE_UNREADABLE', 'READ_FAILED']).toContain(result.error.code)
      }
      const after = harness.projectService.getSession(sessionId)!
      expect(after.snapshot.documents.length).toBe(documents)
      expect(after.snapshot.revisions.length).toBe(revisions)
      expect(after.snapshot.blobs.length).toBe(blobs)
      expect(after.snapshot.attachments.length).toBe(attachments)
      expect(after.acceptedSeq).toBe(acceptedSeq)
    } finally {
      await harness.dispose()
    }
  })

  it('documentId 不存在 → SOURCE_NOT_FOUND，不打开文件对话框', async () => {
    const { harness, sessionId } = await setup()
    try {
      const session = harness.projectService.getSession(sessionId)!
      const result = await harness.invoke(IPC_CHANNELS.sourceImport, {
        sessionId,
        baseEditSeq: session.acceptedSeq,
        documentId: 'doc-does-not-exist',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('SOURCE_NOT_FOUND')
    } finally {
      await harness.dispose()
    }
  })

  it('renderer 传路径字段被 strict schema 拒绝', async () => {
    const { harness, sessionId, files } = await setup()
    try {
      files.set('/memory/taskbook.pdf', createTwoPageTaskbookPdf())
      const result = await harness.invoke(IPC_CHANNELS.sourceImport, {
        sessionId,
        baseEditSeq: 0,
        path: '/etc/passwd',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_REQUEST')
        expect(result.error.detail ?? '').toContain('path')
      }
    } finally {
      await harness.dispose()
    }
  })
})
