// @vitest-environment node
/**
 * L2 确认效率：main 侧批量确认 / 批量补单位 / 撤销补单位（IPC 全链路）。
 *
 * 草稿走真实 `buildExtractionDraft`：注入合成文本层（表头带 mm 的 2 条单值 +
 * 同符号 T 三处不同取值 + 不支持公式 + 无单位表格的 U），不手写候选。
 * 断言重点：逐条决定、整批拒绝 0 写入、账本留档、撤销不抹出处。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  ExtractionAttestUnitsValue,
  ExtractionBatchValue,
  ExtractionRunValue,
} from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/contracts'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import type { RawPdfTextPage } from '../../src/document-extraction'
import { sha256Hex } from '../../src/sources/hash'
import { ExtractionService } from '../main/extractionService'
import { registerExtractionChannels } from '../main/extractionChannels'
import { createHarness, type Harness } from './helpers/a04'

const FIXTURE = path.join(process.cwd(), 'src/document-extraction/__fixtures__/taskbook-TB-2026-1110.pdf')

const line = (text: string, y: number) => ({
  str: text,
  transform: [1, 0, 0, 1, 16, y] as const,
  width: text.length * 6,
  height: 12,
})

/** 两页合成文本层：见文件头。 */
function syntheticPages(): RawPdfTextPage[] {
  return [
    {
      page: 1,
      view: [0, 0, 612, 792],
      items: [
        line('位号 名称 基本尺寸(mm) 上偏差 下偏差', 700),
        line('A 总长 52.20 +0.02 -0.02', 684),
        line('B 段长 20.00 +0.01 -0.01', 668),
        line('T = 10.00 mm', 652),
        line('T = 11.00 mm', 636),
        line('T = 12.00 mm', 620),
        line('C = A × B', 604),
      ],
    },
    {
      page: 2,
      view: [0, 0, 612, 792],
      items: [
        line('位号 名称 基本尺寸 上偏差 下偏差', 700),
        line('U 缺单位 30.00 +0.01 -0.01', 684),
      ],
    },
  ]
}

async function snapshotWithInjectedPdf(): Promise<ProjectFileSnapshot> {
  const bytes = new Uint8Array(readFileSync(FIXTURE))
  const sha256 = await sha256Hex(bytes)
  const base = (await import('../../src/project-file/__fixtures__/sampleProjectFile')).createSampleSnapshot
  const snapshot = await base()
  const createdAt = '2026-11-12T08:00:00.000Z'
  return {
    ...snapshot,
    project: { ...snapshot.project, extractionDrafts: [] },
    revisions: [
      {
        ...snapshot.revisions[0]!,
        fileName: 'taskbook-synthetic.pdf',
        sha256,
        byteSize: bytes.byteLength,
        pageCount: 2,
        createdAt,
      },
    ],
    blobs: [{ ...snapshot.blobs[0]!, sha256, byteSize: bytes.byteLength }],
    attachments: [{ blobKey: snapshot.blobs[0]!.blobKey, bytes }],
  }
}

async function withService(harness: Harness): Promise<ExtractionService> {
  const service = new ExtractionService({
    controller: harness.controller,
    projectService: harness.projectService,
    recovery: harness.recovery,
    extractText: async () => syntheticPages(),
  })
  registerExtractionChannels(harness.ipc, {
    guard: harness.guard,
    controller: harness.controller,
    service,
  })
  return service
}

interface Opened {
  sessionId: string
  draftId: string
  snapshot: ProjectFileSnapshot
  seq: number
}

async function openAndExtract(harness: Harness): Promise<Opened> {
  await withService(harness)
  const open = await harness.openSample(await snapshotWithInjectedPdf())
  const run = await harness.invoke<ExtractionRunValue>(IPC_CHANNELS.extractionRun, {
    sessionId: open.sessionId,
    baseEditSeq: 0,
    revisionId: 'sr-1',
    pageFrom: 1,
    pageTo: 2,
    requestId: 'req-l2',
  })
  if (!run.ok) throw new Error(`${run.error.code}: ${run.error.message}`)
  const session = harness.projectService.getSession(open.sessionId)
  if (session === null) throw new Error('会话丢失')
  return {
    sessionId: open.sessionId,
    draftId: run.value.draftId,
    snapshot: session.snapshot,
    seq: run.value.acceptedSeq,
  }
}

function candidatesOf(snapshot: ProjectFileSnapshot, draftId: string) {
  const draft = snapshot.project.extractionDrafts.find((item) => item.draftId === draftId)
  if (draft === undefined) throw new Error('找不到草稿')
  return { draft, list: draft.candidates }
}

function idOf(snapshot: ProjectFileSnapshot, draftId: string, symbol: string): string {
  const { list } = candidatesOf(snapshot, draftId)
  const found = list.find(
    (candidate) => candidate.kind === 'ring' && candidate.data.symbol === symbol,
  )
  if (found === undefined) throw new Error(`找不到符号 ${symbol}`)
  return found.candidateId
}

function idsOf(snapshot: ProjectFileSnapshot, draftId: string, symbol: string): string[] {
  const { list } = candidatesOf(snapshot, draftId)
  return list
    .filter((candidate) => candidate.kind === 'ring' && candidate.data.symbol === symbol)
    .map((candidate) => candidate.candidateId)
}

describe('L2 main：批量确认 / 批量补单位 / 撤销补单位', () => {
  it('单值组批量确认：逐条写决定、推进一次编辑序号、快照可保存', async () => {
    const harness = await createHarness()
    try {
      const opened = await openAndExtract(harness)
      const a = idOf(opened.snapshot, opened.draftId, 'A')
      const b = idOf(opened.snapshot, opened.draftId, 'B')
      const run = await harness.invoke<ExtractionBatchValue>(
        IPC_CHANNELS.extractionConfirmBatch,
        { sessionId: opened.sessionId, baseEditSeq: opened.seq, draftId: opened.draftId, candidateIds: [a, b] },
      )
      expect(run.ok, run.ok ? '' : `${run.error.code}: ${run.error.message}`).toBe(true)
      if (!run.ok) return
      expect(run.value.decisions).toHaveLength(2)
      expect(run.value.decisions.map((item) => item.status)).toEqual(['confirmed', 'confirmed'])
      expect(new Set(run.value.decisions.map((item) => item.decisionId)).size).toBe(2)
      expect(run.value.acceptedSeq).toBe(opened.seq + 1)
      const session = harness.projectService.getSession(opened.sessionId)!
      const { list, draft } = candidatesOf(session.snapshot, opened.draftId)
      expect(list.filter((candidate) => candidate.status === 'confirmed')).toHaveLength(2)
      const confirms = draft.decisions.filter((decision) => decision.action === 'confirm')
      expect(confirms).toHaveLength(2)
      expect(confirms.every((decision) => decision.provenance !== undefined)).toBe(true)
      // 决定随项目文件编码：批量写入的草稿必须能通过 schema 自校验。
      expect(run.value.snapshot.project.extractionDrafts).toHaveLength(1)
    } finally {
      await harness.dispose()
    }
  })

  it('含同符号多处赋值 → 整批拒绝（0 写入），message 指出该组', async () => {
    const harness = await createHarness()
    try {
      const opened = await openAndExtract(harness)
      const t = idsOf(opened.snapshot, opened.draftId, 'T')
      expect(t).toHaveLength(3)
      const before = JSON.stringify(harness.projectService.getSession(opened.sessionId)!.snapshot)
      const run = await harness.invoke<ExtractionBatchValue>(
        IPC_CHANNELS.extractionConfirmBatch,
        {
          sessionId: opened.sessionId,
          baseEditSeq: opened.seq,
          draftId: opened.draftId,
          candidateIds: [idOf(opened.snapshot, opened.draftId, 'A'), ...t],
        },
      )
      expect(run.ok).toBe(false)
      if (run.ok) return
      expect(run.error.code).toBe('EXTRACTION_GROUP_CONFLICT')
      expect(run.error.message).toContain('同一符号多处赋值只能确认一处')
      expect(run.error.message).toContain('整批未执行（0 条写入）')
      const after = harness.projectService.getSession(opened.sessionId)!
      expect(JSON.stringify(after.snapshot)).toBe(before)
      expect(after.acceptedSeq).toBe(opened.seq)
    } finally {
      await harness.dispose()
    }
  })

  it('批量补单位：逐条 user-attestation、statement 逐字、账本留档、补完仍待确认', async () => {
    const harness = await createHarness()
    try {
      const opened = await openAndExtract(harness)
      const u = idOf(opened.snapshot, opened.draftId, 'U')
      const statement = '本表单位 mm（2026-11-12 复核）'
      const run = await harness.invoke<ExtractionAttestUnitsValue>(
        IPC_CHANNELS.extractionAttestUnits,
        {
          sessionId: opened.sessionId,
          baseEditSeq: opened.seq,
          draftId: opened.draftId,
          candidateIds: [u],
          statement,
        },
      )
      expect(run.ok, run.ok ? '' : `${run.error.code}: ${run.error.message}`).toBe(true)
      if (!run.ok) return
      expect(run.value.unitText).toBe('mm')
      expect(run.value.decisions[0]?.status).toBe('pending')
      const session = harness.projectService.getSession(opened.sessionId)!
      const { list, draft } = candidatesOf(session.snapshot, opened.draftId)
      const candidate = list.find((item) => item.candidateId === u)
      expect(candidate?.status).toBe('pending')
      expect(candidate?.reasonCodes).toEqual([])
      if (candidate?.kind === 'ring') {
        expect(candidate.data.nominal?.unit).toBe('mm')
        expect(candidate.data.nominal?.valueQ).toBe(300000)
        const attestation = candidate.data.nominal?.provenance?.find(
          (ref) => ref.kind === 'user-attestation',
        )
        expect(attestation).toMatchObject({ statement, sessionSeq: 1, actorId: 'local-operator' })
      }
      const decision = draft.decisions.find((item) => item.action === 'attest-unit')
      expect(decision).toMatchObject({ reason: statement, batchId: run.value.batchId })
      // 账本：同一个语句逐字留档，会话序号推进。
      expect(session.snapshot.project.attestations).toHaveLength(1)
      expect(session.snapshot.project.attestations[0]?.statement).toBe(statement)
      expect(session.snapshot.project.sessionSeq).toBe(1)
      // 补单位不是确认。
      expect(list.filter((item) => item.status === 'confirmed')).toHaveLength(0)
    } finally {
      await harness.dispose()
    }
  })

  it('批量补单位混入非“仅差单位” → 整批拒绝并指出是哪一条，0 写入', async () => {
    const harness = await createHarness()
    try {
      const opened = await openAndExtract(harness)
      const a = idOf(opened.snapshot, opened.draftId, 'A')
      const u = idOf(opened.snapshot, opened.draftId, 'U')
      const before = JSON.stringify(harness.projectService.getSession(opened.sessionId)!.snapshot)
      const run = await harness.invoke<ExtractionAttestUnitsValue>(
        IPC_CHANNELS.extractionAttestUnits,
        {
          sessionId: opened.sessionId,
          baseEditSeq: opened.seq,
          draftId: opened.draftId,
          candidateIds: [u, a],
          statement: '本表单位 mm',
        },
      )
      expect(run.ok).toBe(false)
      if (run.ok) return
      expect(run.error.code).toBe('EXTRACTION_BATCH_REJECTED')
      expect(run.error.message).toContain(a)
      expect(run.error.message).toContain('整批未执行')
      const after = harness.projectService.getSession(opened.sessionId)!
      expect(JSON.stringify(after.snapshot)).toBe(before)
    } finally {
      await harness.dispose()
    }
  })

  it('声明不合格（没有单位/不是 mm）→ 明确错误码，0 写入', async () => {
    const harness = await createHarness()
    try {
      const opened = await openAndExtract(harness)
      const u = idOf(opened.snapshot, opened.draftId, 'U')
      for (const statement of ['照表抄', '本表单位 inch']) {
        const run = await harness.invoke<ExtractionAttestUnitsValue>(
          IPC_CHANNELS.extractionAttestUnits,
          {
            sessionId: opened.sessionId,
            baseEditSeq: opened.seq,
            draftId: opened.draftId,
            candidateIds: [u],
            statement,
          },
        )
        expect(run.ok).toBe(false)
        if (run.ok) continue
        expect(run.error.code).toBe('EXTRACTION_UNIT_STATEMENT_INVALID')
      }
      expect(harness.projectService.getSession(opened.sessionId)!.acceptedSeq).toBe(opened.seq)
    } finally {
      await harness.dispose()
    }
  })

  it('撤销补单位：整批撤销回到阻塞，出处只标撤销；已确认的候选拒绝撤销', async () => {
    const harness = await createHarness()
    try {
      const opened = await openAndExtract(harness)
      const u = idOf(opened.snapshot, opened.draftId, 'U')
      const attested = await harness.invoke<ExtractionAttestUnitsValue>(
        IPC_CHANNELS.extractionAttestUnits,
        {
          sessionId: opened.sessionId,
          baseEditSeq: opened.seq,
          draftId: opened.draftId,
          candidateIds: [u],
          statement: '本表单位 mm',
        },
      )
      expect(attested.ok).toBe(true)
      if (!attested.ok) return
      const session = harness.projectService.getSession(opened.sessionId)!
      const candidate = candidatesOf(session.snapshot, opened.draftId).list.find(
        (item) => item.candidateId === u,
      )
      const revoke = await harness.invoke<ExtractionBatchValue>(IPC_CHANNELS.extractionRevokeUnits, {
        sessionId: opened.sessionId,
        baseEditSeq: attested.value.acceptedSeq,
        draftId: opened.draftId,
        batchId: attested.value.batchId,
      })
      expect(revoke.ok, revoke.ok ? '' : `${revoke.error.code}: ${revoke.error.message} [${revoke.error.detail ?? ''}]`).toBe(true)
      if (!revoke.ok) return
      const next = harness.projectService.getSession(opened.sessionId)!
      const { list } = candidatesOf(next.snapshot, opened.draftId)
      const reverted = list.find((item) => item.candidateId === u)
      expect(reverted?.status).toBe('blocked')
      expect(reverted?.reasonCodes).toEqual(['UNKNOWN_UNIT'])
      if (reverted?.kind === 'ring') {
        expect(reverted.data.nominal?.unit).toBeNull()
        const attestation = reverted.data.nominal?.provenance?.find(
          (ref) => ref.kind === 'user-attestation',
        )
        // 出处不删除：原话仍在，只追加撤销留痕。
        expect(attestation).toMatchObject({ statement: '本表单位 mm' })
        expect((attestation as { revokedAt?: string | null }).revokedAt).toBeTruthy()
      }
      expect(next.snapshot.project.attestations[0]?.revokedAt).toBeTruthy()
      expect(candidate).toBeDefined()
    } finally {
      await harness.dispose()
    }
  })

  it('通道层：batchId 与 candidateId 必须二选一；空声明被 schema 拒绝', async () => {
    const harness = await createHarness()
    try {
      const opened = await openAndExtract(harness)
      const both = await harness.invoke<ExtractionBatchValue>(IPC_CHANNELS.extractionRevokeUnits, {
        sessionId: opened.sessionId,
        baseEditSeq: opened.seq,
        draftId: opened.draftId,
        batchId: 'unit-batch-x',
        candidateId: idOf(opened.snapshot, opened.draftId, 'U'),
      })
      expect(both.ok).toBe(false)
      if (both.ok) return
      expect(both.error.code).toBe('INVALID_REQUEST')
      const empty = await harness.invoke<ExtractionAttestUnitsValue>(
        IPC_CHANNELS.extractionAttestUnits,
        {
          sessionId: opened.sessionId,
          baseEditSeq: opened.seq,
          draftId: opened.draftId,
          candidateIds: [idOf(opened.snapshot, opened.draftId, 'U')],
          statement: '',
        },
      )
      expect(empty.ok).toBe(false)
      if (empty.ok) return
      expect(empty.error.code).toBe('INVALID_REQUEST')
    } finally {
      await harness.dispose()
    }
  })
})
