// @vitest-environment node
/**
 * V3.6 第 2 阶段：main 侧提取 / 逐条决定 / 失败零写入 / 取消 / 跨重开幂等。
 *
 * 用真实 1110 两页任务书 PDF（仓库内夹具）走真实 pdfjs legacy 文本层；
 * 只注入“取消”场景的慢提取器，不伪造 PDF 文本。
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  ExtractionDecideValue,
  ExtractionDeleteDraftValue,
  ExtractionRunValue,
  ProjectOpenValue,
  ProjectSaveValue,
  ProjectStageValue,
} from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/contracts'
import { decodeProjectFile, toSnapshotDto } from '../../src/project-file/codec'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import { sha256Hex } from '../../src/sources/hash'
import { EXTRACTOR_VERSION, selectDefaultDraft, type ExtractionCandidate } from '../../src/document-extraction'
import { PdfTextExtractionError } from '../main/pdfTextExtract'
import { ExtractionService } from '../main/extractionService'
import { registerExtractionChannels } from '../main/extractionChannels'
import { createHarness, makeEvent, type Harness } from './helpers/a04'

const FIXTURE = path.join(
  process.cwd(),
  'src/document-extraction/__fixtures__/taskbook-TB-2026-1110.pdf',
)

interface Fixture {
  bytes: Uint8Array
  sha256: string
}

function loadFixture(): Fixture {
  const bytes = new Uint8Array(readFileSync(FIXTURE))
  return { bytes, sha256: '' }
}

async function fixture(): Promise<Fixture> {
  const value = loadFixture()
  value.sha256 = await sha256Hex(value.bytes)
  return value
}

/** 采样项目 + 真实 1110 PDF；可选追加第二个版本（相同字节、不同 revision）。 */
async function snapshotWithPdf(options: {
  secondRevision?: boolean
  pdfName?: string
} = {}): Promise<ProjectFileSnapshot> {
  const pdf = options.pdfName === undefined
    ? await fixture()
    : {
        bytes: new Uint8Array(
          readFileSync(
            path.join(process.cwd(), 'src/document-extraction/__fixtures__', options.pdfName),
          ),
        ),
        sha256: '',
      }
  if (pdf.sha256 === '') pdf.sha256 = await sha256Hex(pdf.bytes)
  const base = (await import('../../src/project-file/__fixtures__/sampleProjectFile')).createSampleSnapshot
  const snapshot = await base()
  const createdAt = '2026-11-10T08:00:00.000Z'
  const revisions = [
    {
      ...snapshot.revisions[0]!,
      fileName: options.pdfName ?? 'taskbook-TB-2026-1110.pdf',
      sha256: pdf.sha256,
      byteSize: pdf.bytes.byteLength,
      pageCount: 2,
      createdAt,
    },
  ]
  const blobs = [
    {
      ...snapshot.blobs[0]!,
      sha256: pdf.sha256,
      byteSize: pdf.bytes.byteLength,
    },
  ]
  const attachments = [{ blobKey: snapshot.blobs[0]!.blobKey, bytes: pdf.bytes }]
  let documents = snapshot.documents
  if (options.secondRevision === true) {
    revisions.push({
      ...revisions[0]!,
      id: 'sr-2',
      createdAt,
    })
    documents = snapshot.documents.map((document) => ({ ...document, latestRevisionId: 'sr-2' }))
  }
  return {
    ...snapshot,
    project: { ...snapshot.project, extractionDrafts: [] },
    documents,
    revisions,
    blobs,
    attachments,
  }
}

async function withExtraction(
  harness: Harness,
  options: {
    extractText?: ConstructorParameters<typeof ExtractionService>[0]['extractText']
    extractorVersion?: string
    recovery?: ConstructorParameters<typeof ExtractionService>[0]['recovery']
  } = {},
): Promise<ExtractionService> {
  const service = new ExtractionService({
    controller: harness.controller,
    projectService: harness.projectService,
    recovery: options.recovery ?? harness.recovery,
    ...(options.extractText === undefined ? {} : { extractText: options.extractText }),
    ...(options.extractorVersion === undefined ? {} : { extractorVersion: options.extractorVersion }),
  })
  registerExtractionChannels(harness.ipc, {
    guard: harness.guard,
    controller: harness.controller,
    service,
  })
  return service
}

async function openWithPdf(
  harness: Harness,
  options: { secondRevision?: boolean; pdfName?: string } = {},
): Promise<{ open: ProjectOpenValue; service: ExtractionService }> {
  const service = await withExtraction(harness)
  const open = await harness.openSample(await snapshotWithPdf(options))
  return { open, service }
}

function candidateOf(
  value: ExtractionRunValue,
  predicate: (candidate: ExtractionCandidate) => boolean,
): ExtractionCandidate {
  const draft = value.snapshot.project.extractionDrafts.find(
    (item) => item.draftId === value.draftId,
  )
  const found = draft?.candidates.find(predicate)
  if (found === undefined) throw new Error('找不到候选')
  return found
}

function ring(value: ExtractionRunValue, symbol: string): ExtractionCandidate {
  const found = candidateOf(
    value,
    (candidate) => candidate.kind === 'ring' && candidate.data.symbol === symbol,
  )
  return found
}

function draftOf(value: ExtractionRunValue) {
  const draft = value.snapshot.project.extractionDrafts.find(
    (item) => item.draftId === value.draftId,
  )
  if (draft === undefined) throw new Error('找不到草稿')
  return draft
}

describe('V3.6 main：从确切 PDF 版本提取', () => {
  it('1110 [1,2]：7 个候选、逐条出处、只写隔离草稿，不动链/目标/绑定/条款', async () => {
    const harness = await createHarness()
    try {
      const { open } = await openWithPdf(harness)
      const before = harness.projectService.getSession(open.sessionId)!.snapshot
      expect(before.project.schemaVersion).toBe(8)
      expect(before.project.extractionDrafts).toEqual([])

      const run = await harness.invoke<ExtractionRunValue>(IPC_CHANNELS.extractionRun, {
        sessionId: open.sessionId,
        baseEditSeq: 0,
        revisionId: 'sr-1',
        pageFrom: 1,
        pageTo: 2,
        requestId: 'req-1110',
      })
      expect(run.ok, run.ok ? '' : `${run.error.code}: ${run.error.message}`).toBe(true)
      if (!run.ok) return
      const value = run.value
      expect(value.unchanged).toBe(false)
      expect(value.addedCandidateCount).toBe(7)
      expect(value.candidateCount).toBe(7)
      expect(value.extractorVersion).toBe(EXTRACTOR_VERSION)
      expect(value.acceptedSeq).toBe(1)

      const draft = draftOf(value)
      expect(draft.sourceIdentity).toMatchObject({
        documentId: 'doc-1',
        revisionId: 'sr-1',
        sha256: (await fixture()).sha256,
        blobKey: 'blob-1',
        pageCount: 2,
      })
      expect(draft.pageRange).toEqual({ from: 1, to: 2 })
      expect(draft.candidates.every((candidate) => candidate.status === 'pending')).toBe(true)
      // 每个有值字段都带完整出处（page/rectPdf/pageBoxPdf/textSnippet/textItemIndexes）。
      const h = ring(value, 'H')
      const nominal = h.kind === 'ring' ? h.data.nominal : null
      expect(nominal?.text).toBe('52.20')
      expect(nominal?.evidence[0]).toMatchObject({
        revisionId: 'sr-1',
        page: 1,
      })
      expect(nominal?.evidence[0]?.textSnippet).toBe('52.20')
      expect(nominal?.evidence[0]?.textItemIndexes.length).toBeGreaterThan(0)

      // 不污染：尺寸链、目标、参数、绑定、条款、事件都没变。
      const after = harness.projectService.getSession(open.sessionId)!.snapshot
      expect(after.project.dimensionChain).toEqual(before.project.dimensionChain)
      expect(after.project.dimensionChain.target).toEqual(before.project.dimensionChain.target)
      expect(after.project.parameters).toEqual(before.project.parameters)
      expect(after.project.dimensionLinks).toEqual(before.project.dimensionLinks)
      expect(after.project.requirementRevisions).toEqual([])
      expect(after.project.activeRequirementRevisionId).toBeNull()
      expect(after.events).toEqual(before.events)
      expect(after.bindings).toEqual(before.bindings)
      expect(after.documents).toEqual(before.documents)

      // 只推进内存编辑序号并要求显式保存；没有自动落盘。
      expect(harness.projectService.getSession(open.sessionId)!.acceptedSeq).toBe(1)
      expect(value.snapshot.project.extractionDrafts).toHaveLength(1)
    } finally {
      await harness.dispose()
    }
  })

  it('只读确切 revision（不是 latest）：同字节第二个版本不混用确认', async () => {
    const harness = await createHarness()
    try {
      const { open } = await openWithPdf(harness, { secondRevision: true })
      const run = await harness.invoke<ExtractionRunValue>(IPC_CHANNELS.extractionRun, {
        sessionId: open.sessionId,
        baseEditSeq: 0,
        revisionId: 'sr-1',
        pageFrom: 1,
        pageTo: 2,
        requestId: 'req-old-rev',
      })
      expect(run.ok).toBe(true)
      if (!run.ok) return
      const draft = draftOf(run.value)
      expect(draft.sourceIdentity.revisionId).toBe('sr-1')
      expect(
        draft.candidates.every((candidate) =>
          candidate.evidence.every((evidence) => evidence.revisionId === 'sr-1'),
        ),
      ).toBe(true)
      // latest 是 sr-2，但草稿没有偷偷指向它。
      expect(
        run.value.snapshot.documents.find((document) => document.id === 'doc-1')?.latestRevisionId,
      ).toBe('sr-2')
    } finally {
      await harness.dispose()
    }
  })

  it('页范围越界 / 非法范围 / 未知版本：明确拒绝且零写入', async () => {
    const harness = await createHarness()
    try {
      const { open } = await openWithPdf(harness)
      const session = harness.projectService.getSession(open.sessionId)!
      const before = JSON.stringify(session.snapshot)
      const cases: [Record<string, unknown>, string][] = [
        [{ revisionId: 'sr-missing', pageFrom: 1, pageTo: 2 }, 'SOURCE_NOT_FOUND'],
        [{ revisionId: 'sr-1', pageFrom: 2, pageTo: 1 }, 'PAGE_OUT_OF_RANGE'],
        [{ revisionId: 'sr-1', pageFrom: 1, pageTo: 3 }, 'PAGE_OUT_OF_RANGE'],
        [{ revisionId: '../etc/passwd', pageFrom: 1, pageTo: 2 }, 'INVALID_REQUEST'],
      ]
      for (const [params, code] of cases) {
        const result = await harness.invoke(IPC_CHANNELS.extractionRun, {
          sessionId: open.sessionId,
          baseEditSeq: 0,
          requestId: `req-${code}`,
          ...params,
        })
        expect(result.ok, `${code} 应失败`).toBe(false)
        if (!result.ok) expect(result.error.code).toBe(code)
        expect(JSON.stringify(session.snapshot)).toBe(before)
        expect(session.acceptedSeq).toBe(0)
      }
    } finally {
      await harness.dispose()
    }
  })

  it('哈希不一致：拒绝，原会话不变', async () => {
    const harness = await createHarness()
    try {
      const { open } = await openWithPdf(harness)
      const session = harness.projectService.getSession(open.sessionId)!
      session.snapshot = {
        ...session.snapshot,
        attachments: [
          {
            blobKey: 'blob-1',
            bytes: new TextEncoder().encode('%PDF-1.7 被篡改的字节'),
          },
        ],
      }
      const before = JSON.stringify(session.snapshot)
      const run = await harness.invoke(IPC_CHANNELS.extractionRun, {
        sessionId: open.sessionId,
        baseEditSeq: 0,
        revisionId: 'sr-1',
        pageFrom: 1,
        pageTo: 2,
        requestId: 'req-tampered',
      })
      expect(run.ok).toBe(false)
      if (!run.ok) expect(run.error.code).toBe('HASH_MISMATCH')
      expect(JSON.stringify(session.snapshot)).toBe(before)
      expect(session.acceptedSeq).toBe(0)
    } finally {
      await harness.dispose()
    }
  })
})

describe('V3.6 main：取消与预算', () => {
  it('页循环中取消：EXTRACTION_CANCELLED，零写入；错误 requestId 不取消', async () => {
    const harness = await createHarness()
    try {
      // 用注入的慢提取器：每 10ms 检查取消标志，不读文件。
      let observed = false
      const service = await withExtraction(harness, {
        extractText: async (_bytes, _range, options) => {
          for (let attempt = 0; attempt < 500; attempt += 1) {
            if (options?.isCancelled?.() === true) {
              observed = true
              throw new PdfTextExtractionError('EXTRACTION_CANCELLED', '注入取消')
            }
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
          throw new PdfTextExtractionError('EXTRACTION_TIMEOUT', '注入超时')
        },
      })
      const open = await harness.openSample(await snapshotWithPdf())
      const runPromise = service.run(1, {
        sessionId: open.sessionId,
        baseEditSeq: 0,
        revisionId: 'sr-1',
        pageFrom: 1,
        pageTo: 2,
        requestId: 'req-cancel',
      })
      await new Promise((resolve) => setTimeout(resolve, 60))
      expect(service.cancel(1, { sessionId: open.sessionId, requestId: 'other' })).toEqual({
        ok: true,
        value: { cancelled: false },
      })
      expect(
        service.cancel(1, { sessionId: open.sessionId, requestId: 'req-cancel' }),
      ).toEqual({ ok: true, value: { cancelled: true } })
      const run = await runPromise
      expect(run.ok).toBe(false)
      if (!run.ok) expect(run.error.code).toBe('EXTRACTION_CANCELLED')
      expect(observed).toBe(true)
      const session = harness.projectService.getSession(open.sessionId)!
      expect(session.snapshot.project.extractionDrafts).toEqual([])
      expect(session.acceptedSeq).toBe(0)
    } finally {
      await harness.dispose()
    }
  })

  it('同一窗口并发的第二次提取返回 EXTRACTION_BUSY，不交错写快照', async () => {
    const harness = await createHarness()
    try {
      const gate: { release: null | (() => void) } = { release: null }
      const waiting = new Promise<void>((resolve) => {
        gate.release = resolve
      })
      const slow = await withExtraction(harness, {
        extractText: async () => {
          await waiting
          return []
        },
      })
      const open = await harness.openSample(await snapshotWithPdf())
      const first = slow.run(1, {
        sessionId: open.sessionId,
        baseEditSeq: 0,
        revisionId: 'sr-1',
        pageFrom: 1,
        pageTo: 2,
        requestId: 'req-first',
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
      const second = await slow.run(1, {
        sessionId: open.sessionId,
        baseEditSeq: 0,
        revisionId: 'sr-1',
        pageFrom: 1,
        pageTo: 2,
        requestId: 'req-second',
      })
      expect(second.ok).toBe(false)
      if (!second.ok) expect(second.error.code).toBe('EXTRACTION_BUSY')
      gate.release?.()
      const done = await first
      expect(done.ok).toBe(true)
      if (done.ok) expect(done.value.unchanged).toBe(false)
    } finally {
      await harness.dispose()
    }
  })
})

describe('V3.6 main：逐条决定、持久化与跨重开', () => {
  it('确认一项 + 拒绝一项：决定带 actor/时间/快照/出处，未确认项不出现在项目字段', async () => {
    const harness = await createHarness()
    try {
      const { open } = await openWithPdf(harness)
      const run = await harness.invoke<ExtractionRunValue>(IPC_CHANNELS.extractionRun, {
        sessionId: open.sessionId,
        baseEditSeq: 0,
        revisionId: 'sr-1',
        pageFrom: 1,
        pageTo: 2,
        requestId: 'req-decide',
      })
      if (!run.ok) throw new Error(run.error.message)
      const draftId = run.value.draftId
      const h = ring(run.value, 'H')
      const s = ring(run.value, 'S')
      const confirmed = await harness.invoke<ExtractionDecideValue>(
        IPC_CHANNELS.extractionDecide,
        {
          sessionId: open.sessionId,
          baseEditSeq: run.value.acceptedSeq,
          draftId,
          candidateId: h.candidateId,
          editRevision: h.editRevision,
          action: 'confirm',
          confirmed: true,
        },
      )
      expect(confirmed.ok, confirmed.ok ? '' : `${confirmed.error.code}: ${confirmed.error.message}`).toBe(true)
      if (!confirmed.ok) return
      expect(confirmed.value.status).toBe('confirmed')
      expect(confirmed.value.decisionId).not.toBeNull()

      const rejected = await harness.invoke<ExtractionDecideValue>(
        IPC_CHANNELS.extractionDecide,
        {
          sessionId: open.sessionId,
          baseEditSeq: confirmed.value.acceptedSeq,
          draftId,
          candidateId: s.candidateId,
          editRevision: s.editRevision,
          action: 'reject',
          reason: '隔套长度数值需人工核对',
        },
      )
      expect(rejected.ok).toBe(true)
      if (!rejected.ok) return
      expect(rejected.value.status).toBe('rejected')

      const draft = rejected.value.snapshot.project.extractionDrafts.find(
        (item) => item.draftId === draftId,
      )!
      const confirmDecision = draft.decisions.find(
        (decision) => decision.candidateId === h.candidateId && decision.action === 'confirm',
      )
      expect(confirmDecision).toMatchObject({ actor: 'local-operator', reason: null })
      expect(confirmDecision?.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(confirmDecision?.valueSnapshot).toContain('"field":"nominal"')
      expect(confirmDecision?.evidence.length).toBeGreaterThan(0)
      const rejectDecision = draft.decisions.find(
        (decision) => decision.candidateId === s.candidateId && decision.action === 'reject',
      )
      expect(rejectDecision?.reason).toBe('隔套长度数值需人工核对')

      // 拒绝后不能直接复活为确认。
      const revive = await harness.invoke(IPC_CHANNELS.extractionDecide, {
        sessionId: open.sessionId,
        baseEditSeq: rejected.value.acceptedSeq,
        draftId,
        candidateId: s.candidateId,
        editRevision: s.editRevision,
        action: 'confirm',
        confirmed: true,
      })
      expect(revive.ok).toBe(false)
      if (!revive.ok) expect(revive.error.code).toBe('EXTRACTION_CANDIDATE_REJECTED')

      // 未确认候选没有进入项目 target / 条款 / 参数 / 绑定 / 链。
      const snapshot = harness.projectService.getSession(open.sessionId)!.snapshot
      expect(snapshot.project.dimensionChain.target).toEqual({ minQ: 1000, maxQ: 3000 })
      expect(snapshot.project.requirementRevisions).toEqual([])
      expect(snapshot.project.activeRequirementRevisionId).toBeNull()
      expect(snapshot.project.parameters).toEqual([])
      expect(snapshot.project.dimensionLinks).toEqual([])
      expect(
        draft.candidates.filter((candidate) => candidate.status === 'pending').length,
      ).toBe(5)
    } finally {
      await harness.dispose()
    }
  })

  it('确认后显式保存 → 解码仍带候选/决定（schema8），关闭重开项目状态保留', async () => {
    const harness = await createHarness()
    let reopened: Harness | null = null
    try {
      const { open } = await openWithPdf(harness)
      const run = await harness.invoke<ExtractionRunValue>(IPC_CHANNELS.extractionRun, {
        sessionId: open.sessionId,
        baseEditSeq: 0,
        revisionId: 'sr-1',
        pageFrom: 1,
        pageTo: 2,
        requestId: 'req-save',
      })
      if (!run.ok) throw new Error(run.error.message)
      const h = ring(run.value, 'H')
      const confirmed = await harness.invoke<ExtractionDecideValue>(
        IPC_CHANNELS.extractionDecide,
        {
          sessionId: open.sessionId,
          baseEditSeq: run.value.acceptedSeq,
          draftId: run.value.draftId,
          candidateId: h.candidateId,
          editRevision: h.editRevision,
          action: 'confirm',
          confirmed: true,
        },
      )
      if (!confirmed.ok) throw new Error(confirmed.error.message)

      const session = harness.projectService.getSession(open.sessionId)!
      const saved = await harness.invoke<ProjectSaveValue>(IPC_CHANNELS.projectSave, {
        sessionId: open.sessionId,
        editSeq: confirmed.value.acceptedSeq,
        expectedFingerprint: session.fingerprint,
      })
      expect(saved.ok, saved.ok ? '' : `${saved.error.code}: ${saved.error.message}`).toBe(true)
      if (!saved.ok) return
      expect(session.path).toBe(saved.value.path)

      const decoded = await decodeProjectFile(new Uint8Array(readFileSync(saved.value.path)))
      expect(decoded.ok).toBe(true)
      if (!decoded.ok) return
      const persisted = decoded.value.snapshot.project.extractionDrafts
      expect(decoded.value.snapshot.project.schemaVersion).toBe(8)
      expect(decoded.value.manifest.project.projectSchemaVersion).toBe(8)
      expect(persisted).toHaveLength(1)
      expect(persisted[0]!.candidates).toHaveLength(7)
      expect(
        persisted[0]!.candidates.find((candidate) => candidate.candidateId === h.candidateId)
          ?.status,
      ).toBe('confirmed')
      expect(persisted[0]!.decisions[0]?.actor).toBe('local-operator')

      // 关闭重开：新 harness（新 ProjectService/新会话）打开同一文件。
      reopened = await createHarness()
      reopened.openQueue.push(saved.value.path)
      const again = await reopened.invoke<ProjectOpenValue>(IPC_CHANNELS.projectOpen, {})
      expect(again.ok).toBe(true)
      if (!again.ok) return
      const reopenedDraft = again.value.snapshot.project.extractionDrafts[0]!
      expect(reopenedDraft.candidates.map((candidate) => candidate.status)).toEqual(
        persisted[0]!.candidates.map((candidate) => candidate.status),
      )
      expect(reopenedDraft.decisions).toEqual(persisted[0]!.decisions)
      expect(reopenedDraft.sourceIdentity.revisionId).toBe('sr-1')

      // 跨重启幂等：同一 PDF 版本/页范围/规则再次提取，不产生重复候选。
      await withExtraction(reopened)
      const reextract = await reopened.invoke<ExtractionRunValue>(
        IPC_CHANNELS.extractionRun,
        {
          sessionId: again.value.sessionId,
          baseEditSeq: again.value.editSeq,
          revisionId: 'sr-1',
          pageFrom: 1,
          pageTo: 2,
          requestId: 'req-after-reopen',
        },
      )
      expect(reextract.ok).toBe(true)
      if (!reextract.ok) return
      expect(reextract.value.unchanged).toBe(true)
      expect(reextract.value.candidateCount).toBe(7)
      expect(reextract.value.acceptedSeq).toBe(again.value.editSeq)
      expect(reextract.value.snapshot.project.extractionDrafts).toHaveLength(1)
    } finally {
      await harness.dispose()
      if (reopened !== null) await reopened.dispose()
    }
  })

  it('同一版本/页范围/规则重提：候选数与草稿版本不变，acceptedSeq 不推进', async () => {
    const harness = await createHarness()
    try {
      const { open } = await openWithPdf(harness)
      const first = await harness.invoke<ExtractionRunValue>(IPC_CHANNELS.extractionRun, {
        sessionId: open.sessionId,
        baseEditSeq: 0,
        revisionId: 'sr-1',
        pageFrom: 1,
        pageTo: 2,
        requestId: 'req-idem-1',
      })
      if (!first.ok) throw new Error(first.error.message)
      const second = await harness.invoke<ExtractionRunValue>(IPC_CHANNELS.extractionRun, {
        sessionId: open.sessionId,
        baseEditSeq: first.value.acceptedSeq,
        revisionId: 'sr-1',
        pageFrom: 1,
        pageTo: 2,
        requestId: 'req-idem-2',
      })
      expect(second.ok).toBe(true)
      if (!second.ok) return
      expect(second.value.unchanged).toBe(true)
      expect(second.value.addedCandidateCount).toBe(0)
      expect(second.value.candidateCount).toBe(first.value.candidateCount)
      expect(second.value.draftId).toBe(first.value.draftId)
      expect(second.value.acceptedSeq).toBe(first.value.acceptedSeq)
      expect(second.value.snapshot.project.extractionDrafts).toHaveLength(1)
      expect(draftOf(second.value).draftRevision).toBe(draftOf(first.value).draftRevision)
    } finally {
      await harness.dispose()
    }
  })

  it('不同页范围各自独立草稿：旧范围的决定不被新范围覆盖（偏差见证据文档）', async () => {
    const harness = await createHarness()
    try {
      const { open } = await openWithPdf(harness)
      const pageTwo = await harness.invoke<ExtractionRunValue>(IPC_CHANNELS.extractionRun, {
        sessionId: open.sessionId,
        baseEditSeq: 0,
        revisionId: 'sr-1',
        pageFrom: 2,
        pageTo: 2,
        requestId: 'req-p2',
      })
      if (!pageTwo.ok) throw new Error(pageTwo.error.message)
      const formula = candidateOf(pageTwo.value, (candidate) => candidate.kind === 'formula')
      const judged = await harness.invoke<ExtractionDecideValue>(
        IPC_CHANNELS.extractionDecide,
        {
          sessionId: open.sessionId,
          baseEditSeq: pageTwo.value.acceptedSeq,
          draftId: pageTwo.value.draftId,
          candidateId: formula.candidateId,
          editRevision: formula.editRevision,
          action: 'reject',
          reason: '先核对公式方向',
        },
      )
      if (!judged.ok) throw new Error(judged.error.message)
      const all = await harness.invoke<ExtractionRunValue>(IPC_CHANNELS.extractionRun, {
        sessionId: open.sessionId,
        baseEditSeq: judged.value.acceptedSeq,
        revisionId: 'sr-1',
        pageFrom: 1,
        pageTo: 2,
        requestId: 'req-p12',
      })
      expect(all.ok).toBe(true)
      if (!all.ok) return
      const draft = draftOf(all.value)
      expect(draft.pageRange).toEqual({ from: 1, to: 2 })
      expect(draft.candidates).toHaveLength(7)
      expect(draft.candidates.some((candidate) => candidate.kind === 'part-dimension')).toBe(true)
      expect(all.value.addedCandidateCount).toBe(7)
      // [2,2] 的草稿仍是独立一份，其拒绝决定没有被新范围改写。
      const drafts = all.value.snapshot.project.extractionDrafts
      expect(drafts).toHaveLength(2)
      const pageTwoDraft = drafts.find((item) => item.draftId === pageTwo.value.draftId)!
      expect(pageTwoDraft.pageRange).toEqual({ from: 2, to: 2 })
      expect(pageTwoDraft.candidates.filter((candidate) => candidate.status === 'rejected')).toHaveLength(1)
      expect(pageTwoDraft.decisions[0]?.reason).toBe('先核对公式方向')
    } finally {
      await harness.dispose()
    }
  })
})

describe('V3.6 main：门禁', () => {
  it('stageDraft 不能伪造提取确认（main 保留权威草稿）', async () => {
    const harness = await createHarness()
    try {
      const { open } = await openWithPdf(harness)
      const run = await harness.invoke<ExtractionRunValue>(IPC_CHANNELS.extractionRun, {
        sessionId: open.sessionId,
        baseEditSeq: 0,
        revisionId: 'sr-1',
        pageFrom: 1,
        pageTo: 2,
        requestId: 'req-forge',
      })
      if (!run.ok) throw new Error(run.error.message)
      const session = harness.projectService.getSession(open.sessionId)!
      const forged = JSON.parse(JSON.stringify(toSnapshotDto(session.snapshot))) as {
        project: { extractionDrafts: { candidates: { status: string }[] }[] }
      }
      forged.project.extractionDrafts[0]!.candidates = forged.project.extractionDrafts[0]!.candidates.map(
        (candidate) => ({ ...candidate, status: 'confirmed' }),
      )
      const staged = await harness.invoke<ProjectStageValue>(IPC_CHANNELS.projectStage, {
        sessionId: open.sessionId,
        editSeq: run.value.acceptedSeq + 1,
        snapshot: forged,
      })
      expect(staged.ok).toBe(true)
      const after = harness.projectService.getSession(open.sessionId)!.snapshot
      expect(
        after.project.extractionDrafts[0]!.candidates.every(
          (candidate) => candidate.status === 'pending',
        ),
      ).toBe(true)
      expect(after.project.extractionDrafts[0]!.decisions).toEqual([])
    } finally {
      await harness.dispose()
    }
  })

  it('编辑只接受原文片段里确有的写法；凭空补值被拒绝且不改草稿', async () => {
    const harness = await createHarness()
    try {
      const { open } = await openWithPdf(harness)
      const run = await harness.invoke<ExtractionRunValue>(IPC_CHANNELS.extractionRun, {
        sessionId: open.sessionId,
        baseEditSeq: 0,
        revisionId: 'sr-1',
        pageFrom: 1,
        pageTo: 2,
        requestId: 'req-edit',
      })
      if (!run.ok) throw new Error(run.error.message)
      const h = ring(run.value, 'H')
      const before = JSON.stringify(
        harness.projectService.getSession(open.sessionId)!.snapshot,
      )
      const bad = await harness.invoke(IPC_CHANNELS.extractionDecide, {
        sessionId: open.sessionId,
        baseEditSeq: run.value.acceptedSeq,
        draftId: run.value.draftId,
        candidateId: h.candidateId,
        editRevision: h.editRevision,
        action: 'edit',
        field: 'nominal',
        text: '52.25',
      })
      expect(bad.ok).toBe(false)
      if (!bad.ok) expect(bad.error.code).toBe('EXTRACTION_EVIDENCE_REQUIRED')
      expect(
        JSON.stringify(harness.projectService.getSession(open.sessionId)!.snapshot),
      ).toBe(before)

      const good = await harness.invoke<ExtractionDecideValue>(IPC_CHANNELS.extractionDecide, {
        sessionId: open.sessionId,
        baseEditSeq: run.value.acceptedSeq,
        draftId: run.value.draftId,
        candidateId: h.candidateId,
        editRevision: h.editRevision,
        action: 'edit',
        field: 'nominal',
        text: '52.20',
        reason: '按原文重录',
      })
      expect(good.ok, good.ok ? '' : `${good.error.code}: ${good.error.message}`).toBe(true)
      if (!good.ok) return
      expect(good.value.status).toBe('pending')
      const edited = good.value.snapshot.project.extractionDrafts[0]!.candidates.find(
        (candidate) => candidate.candidateId === h.candidateId,
      )!
      expect(edited.editRevision).toBe(h.editRevision + 1)
      expect(
        good.value.snapshot.project.extractionDrafts[0]!.decisions.some(
          (decision) => decision.action === 'edit',
        ),
      ).toBe(true)
    } finally {
      await harness.dispose()
    }
  })
})

describe('V3.6 main：坏样例（无文本层）', () => {
  it('只有图像、无文本层：候选 0、NO_TEXT_LAYER，不猜测数值、不启动 OCR', async () => {
    const harness = await createHarness()
    try {
      const { open } = await openWithPdf(harness, { pdfName: 'bad-no-text-layer.pdf' })
      const run = await harness.invoke<ExtractionRunValue>(IPC_CHANNELS.extractionRun, {
        sessionId: open.sessionId,
        baseEditSeq: 0,
        revisionId: 'sr-1',
        pageFrom: 1,
        pageTo: 1,
        requestId: 'req-no-text',
      })
      expect(run.ok).toBe(true)
      if (!run.ok) return
      expect(run.value.candidateCount).toBe(0)
      const draft = draftOf(run.value)
      expect(draft.candidates).toEqual([])
      expect(draft.issues.map((issue) => issue.code)).toContain('NO_TEXT_LAYER')
      const noText = draft.issues.find((issue) => issue.code === 'NO_TEXT_LAYER')
      expect(noText?.severity).toBe('blocked')
      expect(noText?.page).toBe(1)
      const snapshot = harness.projectService.getSession(open.sessionId)!.snapshot
      expect(snapshot.project.dimensionChain.target).toEqual({ minQ: 1000, maxQ: 3000 })
      expect(snapshot.project.requirementRevisions).toEqual([])
    } finally {
      await harness.dispose()
    }
  })
})

describe('V3.6 main：通道层 sender / 参数门禁', () => {
  it('非白名单 sender、子框架、额外字段与错会话都被拒绝，且不触发提取', async () => {
    const harness = await createHarness()
    try {
      await withExtraction(harness)
      const open = await harness.openSample(await snapshotWithPdf())
      const request = {
        sessionId: open.sessionId,
        baseEditSeq: 0,
        revisionId: 'sr-1',
        pageFrom: 1,
        pageTo: 2,
        requestId: 'req-gate',
      }

      const foreign = await harness.ipc.invoke(
        IPC_CHANNELS.extractionRun,
        request,
        makeEvent({ webContentsId: 99 }),
      )
      expect(foreign.ok).toBe(false)
      if (!foreign.ok) expect(foreign.error.code).toBe('FORBIDDEN_SENDER')

      const subFrame = await harness.ipc.invoke(
        IPC_CHANNELS.extractionRun,
        request,
        makeEvent({ webContentsId: 1, subFrame: true }),
      )
      expect(subFrame.ok).toBe(false)
      if (!subFrame.ok) expect(subFrame.error.code).toBe('FORBIDDEN_SENDER')

      // 额外字段（如 renderer 自封 actor/sha256）被严格 schema 拒绝。
      const extra = await harness.invoke(IPC_CHANNELS.extractionRun, {
        ...request,
        actor: 'me',
        sha256: 'a'.repeat(64),
      })
      expect(extra.ok).toBe(false)
      if (!extra.ok) expect(extra.error.code).toBe('INVALID_REQUEST')

      // 参数里的 revisionId 不能是路径。
      const pathy = await harness.invoke(IPC_CHANNELS.extractionRun, {
        ...request,
        revisionId: '../secret',
      })
      expect(pathy.ok).toBe(false)
      if (!pathy.ok) expect(pathy.error.code).toBe('INVALID_REQUEST')

      // 其它会话 ID 不能冒用当前窗口的活动会话。
      const wrongSession = await harness.invoke(IPC_CHANNELS.extractionRun, {
        ...request,
        sessionId: 'session-other',
      })
      expect(wrongSession.ok).toBe(false)
      if (!wrongSession.ok) expect(wrongSession.error.code).toBe('STALE_SESSION')

      expect(
        harness.projectService.getSession(open.sessionId)!.snapshot.project.extractionDrafts,
      ).toEqual([])
    } finally {
      await harness.dispose()
    }
  })
})

/* ------------------------------------------------------------------ */
/* V3.6 多草稿：默认最新、旧草稿只读、删除只删这一份、失败零写入        */
/* ------------------------------------------------------------------ */

function digestOfFile(target: string): string {
  return createHash('sha256').update(readFileSync(target)).digest('hex')
}

interface TwoDraftState {
  oldDraftId: string
  newDraftId: string
  /** 旧草稿里已确认的候选（用于证明旧草稿确实带决定）。 */
  confirmedCandidateId: string
  acceptedSeq: number
}

/**
 * 造出“同一 PDF 版本 + 同一页范围、两个规则版本”的真实场景：
 * 先用 document-extractor-1 跑真实提取并确认一条候选，再用当前规则版本重跑。
 */
async function twoVersionDrafts(
  harness: Harness,
  open: ProjectOpenValue,
): Promise<TwoDraftState> {
  await withExtraction(harness, { extractorVersion: 'document-extractor-1' })
  const old = await harness.invoke<ExtractionRunValue>(IPC_CHANNELS.extractionRun, {
    sessionId: open.sessionId,
    baseEditSeq: 0,
    revisionId: 'sr-1',
    pageFrom: 1,
    pageTo: 2,
    requestId: 'req-old-rule',
  })
  if (!old.ok) throw new Error(`旧规则提取失败：${old.error.code} ${old.error.message}`)
  const oldDraft = old.value.snapshot.project.extractionDrafts[0]
  if (oldDraft === undefined) throw new Error('旧规则提取没有生成草稿')
  const target = oldDraft.candidates.find(
    (candidate) => candidate.kind === 'ring' && candidate.status === 'pending',
  )
  if (target === undefined) throw new Error('旧规则草稿没有可确认的组成环候选')
  const decided = await harness.invoke<ExtractionDecideValue>(IPC_CHANNELS.extractionDecide, {
    sessionId: open.sessionId,
    baseEditSeq: old.value.acceptedSeq,
    draftId: oldDraft.draftId,
    candidateId: target.candidateId,
    editRevision: target.editRevision,
    action: 'confirm',
    confirmed: true,
  })
  if (!decided.ok) {
    throw new Error(`旧规则草稿确认失败：${decided.error.code} ${decided.error.message}`)
  }

  await withExtraction(harness)
  const newer = await harness.invoke<ExtractionRunValue>(IPC_CHANNELS.extractionRun, {
    sessionId: open.sessionId,
    baseEditSeq: decided.value.acceptedSeq,
    revisionId: 'sr-1',
    pageFrom: 1,
    pageTo: 2,
    requestId: 'req-new-rule',
  })
  if (!newer.ok) throw new Error(`新规则提取失败：${newer.error.code} ${newer.error.message}`)
  const drafts = newer.value.snapshot.project.extractionDrafts
  const newDraft = drafts.find((draft) => draft.draftId !== oldDraft.draftId)
  if (newDraft === undefined || drafts.length !== 2) {
    throw new Error(`预期两份草稿，实际 ${drafts.length}`)
  }
  return {
    oldDraftId: oldDraft.draftId,
    newDraftId: newDraft.draftId,
    confirmedCandidateId: target.candidateId,
    acceptedSeq: newer.value.acceptedSeq,
  }
}

describe('V3.6 多草稿（main）', () => {
  it('旧规则版本草稿只读：main 拒绝在旧草稿上确认，快照不变', async () => {
    const harness = await createHarness()
    try {
      const { open } = await openWithPdf(harness)
      const state = await twoVersionDrafts(harness, open)
      const session = harness.projectService.getSession(open.sessionId)!
      const oldDraft = session.snapshot.project.extractionDrafts.find(
        (draft) => draft.draftId === state.oldDraftId,
      )!
      const other = oldDraft.candidates.find(
        (candidate) => candidate.status === 'pending' && candidate.candidateId !== state.confirmedCandidateId,
      )!
      const rejected = await harness.invoke<ExtractionDecideValue>(IPC_CHANNELS.extractionDecide, {
        sessionId: open.sessionId,
        baseEditSeq: session.acceptedSeq,
        draftId: state.oldDraftId,
        candidateId: other.candidateId,
        editRevision: other.editRevision,
        action: 'confirm',
        confirmed: true,
      })
      expect(rejected.ok).toBe(false)
      if (!rejected.ok) {
        expect(rejected.error.code).toBe('EXTRACTION_DRAFT_SUPERSEDED')
        expect(rejected.error.message).toContain('旧规则版本')
      }
      expect(session.snapshot.project.extractionDrafts).toHaveLength(2)
      expect(
        session.snapshot.project.extractionDrafts.find((draft) => draft.draftId === state.oldDraftId)!
          .candidates.find((candidate) => candidate.candidateId === other.candidateId)?.status,
      ).toBe('pending')
    } finally {
      await harness.dispose()
    }
  })

  it('删除旧草稿：只删它、其它数据完好，保存后重开默认仍是新草稿', async () => {
    const harness = await createHarness()
    try {
      const { open } = await openWithPdf(harness)
      const state = await twoVersionDrafts(harness, open)
      const session = harness.projectService.getSession(open.sessionId)!
      const before = session.snapshot

      const removed = await harness.invoke<ExtractionDeleteDraftValue>(
        IPC_CHANNELS.extractionDeleteDraft,
        {
          sessionId: open.sessionId,
          baseEditSeq: session.acceptedSeq,
          draftId: state.oldDraftId,
        },
      )
      expect(removed.ok, removed.ok ? '' : `${removed.error.code}: ${removed.error.message}`).toBe(true)
      if (!removed.ok) return
      expect(removed.value.draftId).toBe(state.oldDraftId)
      expect(removed.value.remainingDraftCount).toBe(1)

      const after = harness.projectService.getSession(open.sessionId)!.snapshot
      expect(after.project.extractionDrafts.map((draft) => draft.draftId)).toEqual([
        state.newDraftId,
      ])
      // 只删这一份草稿：来源 PDF、版本、绑定、条款、参数、图纸、事件、模型都不动。
      expect(after.documents).toEqual(before.documents)
      expect(after.revisions).toEqual(before.revisions)
      expect(after.blobs).toEqual(before.blobs)
      expect(after.bindings).toEqual(before.bindings)
      expect(after.events).toEqual(before.events)
      expect(after.fileRevisions).toEqual(before.fileRevisions)
      expect(after.project.dimensionChain).toEqual(before.project.dimensionChain)
      expect(after.project.dimensionLinks).toEqual(before.project.dimensionLinks)
      expect(after.project.parameters).toEqual(before.project.parameters)
      expect(after.project.drawings).toEqual(before.project.drawings)
      expect(after.project.requirementRevisions).toEqual(before.project.requirementRevisions)
      expect(after.project.parts).toEqual(before.project.parts)
      expect(after.project.modelRevisions).toEqual(before.project.modelRevisions)
      expect(after.project.currentRevisionId).toBe(before.project.currentRevisionId)
      expect(Number.isSafeInteger(removed.value.acceptedSeq)).toBe(true)

      // 显式保存 → 从磁盘字节解码：删除结果与默认选中都保持。
      const saved = await harness.invoke<ProjectSaveValue>(IPC_CHANNELS.projectSave, {
        sessionId: open.sessionId,
        editSeq: removed.value.acceptedSeq,
        expectedFingerprint: harness.projectService.getSession(open.sessionId)!.fingerprint,
      })
      expect(saved.ok, saved.ok ? '' : `${saved.error.code}: ${saved.error.message}`).toBe(true)
      if (!saved.ok) return
      const decoded = await decodeProjectFile(new Uint8Array(readFileSync(saved.value.path)))
      expect(decoded.ok, decoded.ok ? '' : `${decoded.error.code}: ${decoded.error.message}`).toBe(true)
      if (!decoded.ok) return
      expect(decoded.value.snapshot.project.extractionDrafts.map((draft) => draft.draftId)).toEqual([
        state.newDraftId,
      ])
      expect(selectDefaultDraft(decoded.value.snapshot.project.extractionDrafts)?.draftId).toBe(
        state.newDraftId,
      )
    } finally {
      await harness.dispose()
    }
  })

  it('最新规则版本草稿不许删：明确拒绝且零写入', async () => {
    const harness = await createHarness()
    try {
      const { open } = await openWithPdf(harness)
      const state = await twoVersionDrafts(harness, open)
      const session = harness.projectService.getSession(open.sessionId)!
      const seqBefore = session.acceptedSeq
      const newest = await harness.invoke<ExtractionDeleteDraftValue>(
        IPC_CHANNELS.extractionDeleteDraft,
        {
          sessionId: open.sessionId,
          baseEditSeq: seqBefore,
          draftId: state.newDraftId,
        },
      )
      expect(newest.ok).toBe(false)
      if (!newest.ok) {
        expect(newest.error.code).toBe('EXTRACTION_DRAFT_LATEST')
        expect(newest.error.message).toContain('不能删除')
      }
      expect(session.acceptedSeq).toBe(seqBefore)
      expect(session.snapshot.project.extractionDrafts).toHaveLength(2)
    } finally {
      await harness.dispose()
    }
  })

  it('删除失败注入（恢复草稿写入抛错）：项目文件字节不变、两份草稿都在', async () => {
    const harness = await createHarness()
    try {
      const { open } = await openWithPdf(harness)
      const state = await twoVersionDrafts(harness, open)
      const session = harness.projectService.getSession(open.sessionId)!
      const saved = await harness.invoke<ProjectSaveValue>(IPC_CHANNELS.projectSave, {
        sessionId: open.sessionId,
        editSeq: session.acceptedSeq,
        expectedFingerprint: session.fingerprint,
      })
      expect(saved.ok, saved.ok ? '' : `${saved.error.code}: ${saved.error.message}`).toBe(true)
      if (!saved.ok) return
      const digestBefore = digestOfFile(saved.value.path)
      const seqBefore = harness.projectService.getSession(open.sessionId)!.acceptedSeq

      // 注入：恢复草稿写入抛出，删除必须整体回退（不先改内存再补写）。
      const failingRecovery = {
        stage: async () => {
          throw new Error('injected stage failure')
        },
        stateOf: () => 'failed' as const,
      } as unknown as ConstructorParameters<typeof ExtractionService>[0]['recovery']
      await withExtraction(harness, { recovery: failingRecovery })

      const failed = await harness.invoke<ExtractionDeleteDraftValue>(
        IPC_CHANNELS.extractionDeleteDraft,
        {
          sessionId: open.sessionId,
          baseEditSeq: seqBefore,
          draftId: state.oldDraftId,
        },
      )
      expect(failed.ok).toBe(false)
      if (!failed.ok) {
        expect(failed.error.code).toBe('INTERNAL')
        expect(failed.error.message).toContain('已取消删除')
        expect(failed.error.detail).toContain('injected stage failure')
      }

      const after = harness.projectService.getSession(open.sessionId)!
      expect(after.acceptedSeq).toBe(seqBefore)
      expect(after.snapshot.project.extractionDrafts.map((draft) => draft.draftId).sort()).toEqual(
        [state.oldDraftId, state.newDraftId].sort(),
      )
      expect(digestOfFile(saved.value.path)).toBe(digestBefore)
      const onDisk = await decodeProjectFile(new Uint8Array(readFileSync(saved.value.path)))
      expect(onDisk.ok).toBe(true)
      if (onDisk.ok) {
        expect(onDisk.value.snapshot.project.extractionDrafts).toHaveLength(2)
      }
    } finally {
      await harness.dispose()
    }
  })

  it('删除不存在的草稿：NOT_FOUND 且零写入', async () => {
    const harness = await createHarness()
    try {
      const { open } = await openWithPdf(harness)
      const state = await twoVersionDrafts(harness, open)
      const session = harness.projectService.getSession(open.sessionId)!
      const result = await harness.invoke<ExtractionDeleteDraftValue>(
        IPC_CHANNELS.extractionDeleteDraft,
        { sessionId: open.sessionId, baseEditSeq: session.acceptedSeq, draftId: 'draft-missing' },
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
      expect(session.snapshot.project.extractionDrafts).toHaveLength(2)
      expect(session.acceptedSeq).toBe(state.acceptedSeq)
    } finally {
      await harness.dispose()
    }
  })
})

