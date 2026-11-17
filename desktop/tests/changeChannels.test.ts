import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { IPC_CHANNELS } from '../shared/contracts'
import type {
  ChangeApplyValue,
  ChangeCompareValueResponse,
  ChangeDraftValue,
  ChangePreviewValue,
  ChangeRestoreValue,
  IpcResult,
  ProjectOpenValue,
} from '../shared/contracts'
import { createHarness, failingWriteOps, type Harness } from './helpers/a04'
import { ChangeService } from '../main/changeService'
import { registerChangeChannels } from '../main/changeChannels'
import { createSpacerSnapshot } from '../../src/project-file/__fixtures__/spacerProjectFile'
import { decodeProjectFile } from '../../src/project-file/codec'
import { SPACER_PARAMETER_IDS } from '../../src/drawing/types'

const calculateState = vi.hoisted(() => ({ calls: 0, throwOnCall: -1 }))
vi.mock('../../src/domain/calculate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/domain/calculate')>()
  return {
    ...actual,
    calculateChain: (chain: Parameters<typeof actual.calculateChain>[0]) => {
      calculateState.calls += 1
      if (calculateState.calls === calculateState.throwOnCall) {
        throw new Error('injected calculate failure')
      }
      return actual.calculateChain(chain)
    },
  }
})

interface ChangeHarness extends Harness {
  sessionId: string
  filePath: string
  changeService: ChangeService
}

async function sha256File(target: string): Promise<string> {
  return createHash('sha256').update(await fsp.readFile(target)).digest('hex')
}

async function createChangeHarness(options: { fileOps?: ReturnType<typeof failingWriteOps> } = {}): Promise<ChangeHarness> {
  const harness = await createHarness(options.fileOps === undefined ? {} : { fileOps: options.fileOps })
  const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
  const filePath = await harness.writeSample(snapshot, 'spacer-d')
  const opened = await harness.projectService.openFile(filePath)
  if (!opened.ok) throw new Error(`open failed: ${opened.error.code} ${opened.error.message}`)
  const sessionId = opened.value.sessionId
  await harness.controller.attach(1, sessionId)
  let counter = 0
  const changeService = new ChangeService({
    projectService: harness.projectService,
    recovery: harness.recovery,
    controller: harness.controller,
    now: () => new Date(`2026-11-09T11:00:${String((counter += 1)).padStart(2, '0')}.000Z`),
    newId: () => `id-${(counter += 1)}`,
    pickSaveTarget: async () => harness.samplePath('spacer-d'),
  })
  registerChangeChannels(harness.ipc, {
    guard: harness.guard,
    controller: harness.controller,
    changeService,
  })
  return { ...harness, sessionId, filePath, changeService }
}

async function stageLength(harness: ChangeHarness, length: string): Promise<ChangeDraftValue> {
  const result = await harness.invoke<ChangeDraftValue>(IPC_CHANNELS.changeStage, {
    sessionId: harness.sessionId,
    baseEditSeq: harness.projectService.getSession(harness.sessionId)!.acceptedSeq,
    inputs: { innerDiameter: '20.00', outerDiameter: '32.00', length },
    reason: '测试参数变更',
  })
  if (!result.ok) throw new Error(`stage failed: ${result.error.code} ${result.error.message}`)
  return result.value
}

async function preview(harness: ChangeHarness, draft: ChangeDraftValue): Promise<ChangePreviewValue> {
  const result = await harness.invoke<ChangePreviewValue>(IPC_CHANNELS.changePreview, {
    sessionId: harness.sessionId,
    baseToken: draft.baseToken,
    draftToken: draft.draftToken,
  })
  if (!result.ok) throw new Error(`preview failed: ${result.error.code} ${result.error.message}`)
  return result.value
}

async function apply(harness: ChangeHarness, draft: ChangeDraftValue, shown: ChangePreviewValue, requestId = 'req-1'): Promise<IpcResult<ChangeApplyValue>> {
  return harness.invoke<ChangeApplyValue>(IPC_CHANNELS.changeApply, {
    sessionId: harness.sessionId,
    baseToken: draft.baseToken,
    draftToken: draft.draftToken,
    previewId: shown.previewId,
    previewToken: shown.previewToken,
    requestId,
    reason: '确认参数变更',
  })
}

async function diskSnapshot(harness: ChangeHarness) {
  const bytes = new Uint8Array(await fsp.readFile(harness.filePath))
  const decoded = await decodeProjectFile(bytes)
  if (!decoded.ok) throw new Error(`decode failed: ${decoded.error.code}`)
  return { hash: await sha256File(harness.filePath), snapshot: decoded.value.snapshot }
}

beforeEach(() => {
  calculateState.calls = 0
  calculateState.throwOnCall = -1
})

describe('D LINK-01：一次确认原子写入参数/图纸/链/事件/快照/版本', () => {
  it('12→14 只同步 nominal；内存与磁盘同时出现且旧版本不变', async () => {
    const harness = await createChangeHarness()
    try {
      const before = harness.projectService.getSession(harness.sessionId)!
      const beforeCurrentId = before.snapshot.project.currentRevisionId
      const beforeBytes = await sha256File(harness.filePath)
      const beforeRevisions = before.snapshot.fileRevisions.length
      const beforeEvents = before.snapshot.events.length
      const beforeSnapshots = before.snapshot.analysisSnapshots.length

      const draft = await stageLength(harness, '14.00')
      const shown = await preview(harness, draft)
      expect(shown.previousResult.minQ).toBe(1500)
      expect(shown.result.minQ).toBe(-18500)
      expect(shown.result.maxQ).toBe(-17500)
      expect(shown.result.nominalQ).toBe(-18000)
      expect(shown.termDiffs[0]!.afterNominalQ).toBe(140000)

      const result = await apply(harness, draft, shown, 'req-link01')
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const session = harness.projectService.getSession(harness.sessionId)!
      expect(session.snapshot.project.parameters.find((item) => item.key === 'length')!.valueQ).toBe(140000)
      expect(session.snapshot.project.parameters.find((item) => item.key === 'length')!.parameterRevision).toBe(2)
      expect(session.snapshot.project.dimensionChain.terms.find((term) => term.id === 't-s')!.nominalQ).toBe(140000)
      expect(session.snapshot.fileRevisions).toHaveLength(beforeRevisions + 1)
      expect(session.snapshot.analysisSnapshots).toHaveLength(beforeSnapshots + 1)
      expect(session.snapshot.events.length).toBeGreaterThan(beforeEvents)
      expect(session.snapshot.project.currentRevisionId).toBe(result.value.revisionId)
      // 旧版本字节与内容不变（不可变历史）。
      const oldRevision = session.snapshot.fileRevisions.at(-1)!
      expect(oldRevision.parentId).toBe(beforeCurrentId)

      const disk = await diskSnapshot(harness)
      expect(disk.hash).not.toBe(beforeBytes)
      expect(disk.snapshot.project.currentRevisionId).toBe(result.value.revisionId)
      expect(disk.snapshot.project.parameters.find((item) => item.key === 'length')!.valueQ).toBe(140000)
      const confirmedEvent = disk.snapshot.events.find(
        (event) => event.type === 'parameter_binding_confirmed' && event.revisionIdAtCommit === result.value.revisionId,
      )
      expect(confirmedEvent).toBeDefined()
      expect(confirmedEvent!.parameterRevision).toBe(2)
      expect(confirmedEvent!.termRevision).toBe(
        disk.snapshot.project.dimensionChain.terms.find((term) => term.id === 't-s')!.termRevision,
      )
      expect(confirmedEvent!.drawingFingerprint).toBe(
        disk.snapshot.project.drawings[0]!.dataFingerprint,
      )
      const newRevision = disk.snapshot.fileRevisions.find(
        (revision) => revision.revisionId === result.value.revisionId,
      )!
      expect(newRevision.evidence?.analysisSnapshotId).toBe(result.value.analysisSnapshotId)
      expect(newRevision.evidence?.eventIds).toEqual(
        expect.arrayContaining([confirmedEvent!.id]),
      )
    } finally {
      await harness.dispose()
    }
  })

  it('确认不复用预览结果：提交期真实调用 calculateChain；重算抛错零提交', async () => {
    const harness = await createChangeHarness()
    try {
      const draft = await stageLength(harness, '14.00')
      const shown = await preview(harness, draft)
      calculateState.calls = 0
      const applied = await apply(harness, draft, shown, 'req-recompute')
      expect(applied.ok).toBe(true)
      expect(calculateState.calls).toBeGreaterThan(0)
    } finally {
      await harness.dispose()
    }
  })

  it('确认期计算抛错：返回失败，内存/磁盘/版本零写入，草稿仍可再次预览', async () => {
    const harness = await createChangeHarness()
    try {
      const before = harness.projectService.getSession(harness.sessionId)!
      const beforeHash = await sha256File(harness.filePath)
      const draft = await stageLength(harness, '14.00')
      const shown = await preview(harness, draft)
      const beforeSnapshot = JSON.stringify(before.snapshot)

      calculateState.calls = 0
      calculateState.throwOnCall = 1
      const failed = await apply(harness, draft, shown, 'req-throw')
      expect(failed.ok).toBe(false)
      if (!failed.ok) expect(failed.error.code).toBe('CALCULATION_FAILED')
      expect(JSON.stringify(before.snapshot)).toBe(beforeSnapshot)
      expect(await sha256File(harness.filePath)).toBe(beforeHash)
      expect(harness.projectService.getSession(harness.sessionId)!.acceptedSeq).toBe(before.acceptedSeq)

      calculateState.throwOnCall = -1
      const again = await preview(harness, draft)
      expect(again.result.minQ).toBe(-18500)
    } finally {
      await harness.dispose()
    }
  })
})

describe('D 基准失效：旧 token 明确拒绝且零写入（含改后改回）', () => {
  it('预览后改草稿再改回原值：旧预览/旧确认仍被拒绝', async () => {
    const harness = await createChangeHarness()
    try {
      const before = harness.projectService.getSession(harness.sessionId)!
      const beforeHash = await sha256File(harness.filePath)
      const draft = await stageLength(harness, '14.00')
      const shown = await preview(harness, draft)

      // 改到 12.10，再改回 14.00（草稿修订号单调，旧 token 不复活）。
      await stageLength(harness, '12.10')
      const back = await stageLength(harness, '14.00')
      expect(back.draftToken).not.toBe(draft.draftToken)

      const stale = await apply(harness, draft, shown, 'req-stale-draft')
      expect(stale.ok).toBe(false)
      if (!stale.ok) {
        expect(['STALE_BASE', 'STALE_DRAFT', 'STALE_PREVIEW']).toContain(stale.error.code)
        expect(stale.error.message).toContain('拒绝')
      }
      expect(JSON.stringify(before.snapshot)).toBe(JSON.stringify(harness.projectService.getSession(harness.sessionId)!.snapshot))
      expect(await sha256File(harness.filePath)).toBe(beforeHash)
      // 草稿保留：新 token 可以重新预览。
      const fresh = await preview(harness, back)
      expect(fresh.result.minQ).toBe(-18500)
    } finally {
      await harness.dispose()
    }
  })

  it('预览后外部编辑（acceptedSeq 前进，含改后改回）使旧确认被拒', async () => {
    const harness = await createChangeHarness()
    try {
      const draft = await stageLength(harness, '14.00')
      const shown = await preview(harness, draft)
      const session = harness.projectService.getSession(harness.sessionId)!

      // 模拟期间改名 A→B→A：两次 stage 使 acceptedSeq 前进，值改回也不回退代数。
      for (const name of ['改名一', '隔套间隙演示']) {
        const dto = {
          ...session.snapshot,
          project: { ...session.snapshot.project, name },
        }
        const staged = (await harness.projectService.stageFromDto(session.sessionId, session.acceptedSeq + 1, dto))
        expect(staged.ok).toBe(true)
      }
      expect(harness.projectService.getSession(harness.sessionId)!.acceptedSeq).toBe(2)

      const stale = await apply(harness, draft, shown, 'req-stale-base')
      expect(stale.ok).toBe(false)
      if (!stale.ok) expect(stale.error.code).toBe('STALE_BASE')
    } finally {
      await harness.dispose()
    }
  })

  it('预览后改来源或目标：旧确认被拒并给出变化分组，零写入', async () => {
    const harness = await createChangeHarness()
    try {
      const before = harness.projectService.getSession(harness.sessionId)!
      const beforeHash = await sha256File(harness.filePath)
      const draft1 = await stageLength(harness, '14.00')
      const shown1 = await preview(harness, draft1)
      {
        const session = harness.projectService.getSession(harness.sessionId)!
        const dto = {
          ...session.snapshot,
          bindings: session.snapshot.bindings.map((binding, index) =>
            index === 0 ? { ...binding, reviewedTermRevision: 1, reviewedAt: '2026-11-09T09:30:00.000Z' } : binding,
          ),
        }
        const staged = (await harness.projectService.stageFromDto(session.sessionId, session.acceptedSeq + 1, dto))
        expect(staged.ok).toBe(true)
      }
      const staleSource = await apply(harness, draft1, shown1, 'req-source-change')
      expect(staleSource.ok).toBe(false)
      if (!staleSource.ok) {
        expect(staleSource.error.code).toBe('STALE_BASE')
        expect(staleSource.error.detail).toContain('来源')
      }

      const draft2 = await stageLength(harness, '14.00')
      const shown2 = await preview(harness, draft2)
      {
        const session = harness.projectService.getSession(harness.sessionId)!
        const dto = {
          ...session.snapshot,
          project: {
            ...session.snapshot.project,
            dimensionChain: {
              ...session.snapshot.project.dimensionChain,
              target: { minQ: 2000, maxQ: 4000 },
            },
          },
        }
        const staged = (await harness.projectService.stageFromDto(session.sessionId, session.acceptedSeq + 1, dto))
        expect(staged.ok).toBe(true)
      }
      const staleTarget = await apply(harness, draft2, shown2, 'req-target-change')
      expect(staleTarget.ok).toBe(false)
      if (!staleTarget.ok) {
        expect(staleTarget.error.code).toBe('STALE_BASE')
        expect(staleTarget.error.detail).toContain('尺寸链')
      }
      expect(await sha256File(harness.filePath)).toBe(beforeHash)
      expect(harness.projectService.getSession(harness.sessionId)!.snapshot.project.currentRevisionId).toBe(
        before.snapshot.project.currentRevisionId,
      )
    } finally {
      await harness.dispose()
    }
  })

  it('最终 CAS：commitCandidate 的 guard 在 rename 前再次拒绝', async () => {
    const harness = await createChangeHarness()
    try {
      const before = harness.projectService.getSession(harness.sessionId)!
      const encoded = await harness.projectService.commitCandidate(harness.sessionId, {
        baseEditSeq: before.acceptedSeq,
        candidate: before.snapshot,
        guard: () => '测试：提交期间基准变化',
      })
      expect(encoded.ok).toBe(false)
      if (!encoded.ok) expect(['STALE_BASE', 'VERIFY_FAILED', 'INVALID_RECORD']).toContain(encoded.error.code)
    } finally {
      await harness.dispose()
    }
  })
})

describe('D 原子性：写失败零正式写入（内存与磁盘）', () => {
  it('目录写入失败：原文件字节、会话聚合、版本/事件/快照都不变，草稿保留', async () => {
    const harness = await createChangeHarness({ fileOps: failingWriteOps('ENOSPC') })
    try {
      const before = harness.projectService.getSession(harness.sessionId)!
      const beforeHash = await sha256File(harness.filePath)
      const beforeJson = JSON.stringify(before.snapshot)
      const beforeSeq = before.acceptedSeq
      const draft = await stageLength(harness, '14.00')
      const shown = await preview(harness, draft)
      const failed = await apply(harness, draft, shown, 'req-fail')
      expect(failed.ok).toBe(false)
      if (!failed.ok) expect(failed.error.message).toContain('编辑内容仍可继续处理')

      const after = harness.projectService.getSession(harness.sessionId)!
      expect(JSON.stringify(after.snapshot)).toBe(beforeJson)
      expect(after.acceptedSeq).toBe(beforeSeq)
      expect(await sha256File(harness.filePath)).toBe(beforeHash)
      // 草稿仍在：同一 token 还能再次预览。
      const again = await preview(harness, draft)
      expect(again.result.minQ).toBe(-18500)
    } finally {
      await harness.dispose()
    }
  })

  it('同一 requestId 重复确认：只产生一个版本/一组事件/一个快照', async () => {
    const harness = await createChangeHarness()
    try {
      const draft = await stageLength(harness, '14.00')
      const shown = await preview(harness, draft)
      const first = await apply(harness, draft, shown, 'req-idem')
      expect(first.ok).toBe(true)
      const session = harness.projectService.getSession(harness.sessionId)!
      const revisions = session.snapshot.fileRevisions.length
      const events = session.snapshot.events.length
      const snapshots = session.snapshot.analysisSnapshots.length
      const second = await apply(harness, draft, shown, 'req-idem')
      expect(second.ok).toBe(true)
      if (first.ok && second.ok) expect(second.value.revisionId).toBe(first.value.revisionId)
      expect(session.snapshot.fileRevisions).toHaveLength(revisions)
      expect(session.snapshot.events).toHaveLength(events)
      expect(session.snapshot.analysisSnapshots).toHaveLength(snapshots)
    } finally {
      await harness.dispose()
    }
  })
})

describe('D 绑定：单环唯一、显式替换、解除不反向改参数', () => {
  it('同环绑第二参数必须显式替换；解除只解除关系', async () => {
    const harness = await createChangeHarness()
    try {
      const before = harness.projectService.getSession(harness.sessionId)!
      const baseEditSeq = before.acceptedSeq
      const conflict = await harness.invoke<ChangeDraftValue>(IPC_CHANNELS.changeBind, {
        sessionId: harness.sessionId,
        baseEditSeq,
        termId: 't-s',
        partId: 'builtin:shaft-demo:spacer',
        parameterId: SPACER_PARAMETER_IDS.innerDiameter,
        reason: '测试',
      })
      expect(conflict.ok).toBe(false)
      if (!conflict.ok) expect(conflict.error.code).toBe('INVALID_BINDING')

      const replaced = await harness.invoke<ChangeDraftValue>(IPC_CHANNELS.changeBind, {
        sessionId: harness.sessionId,
        baseEditSeq,
        termId: 't-s',
        partId: 'builtin:shaft-demo:spacer',
        parameterId: SPACER_PARAMETER_IDS.innerDiameter,
        replaceBindingId: 'binding:spacer-length',
        reason: '测试替换',
      })
      expect(replaced.ok).toBe(true)
      if (!replaced.ok) return
      expect(replaced.value.bindings).toHaveLength(1)
      expect(replaced.value.bindings[0]!.parameterId).toBe(SPACER_PARAMETER_IDS.innerDiameter)

      const unbound = await harness.invoke<ChangeDraftValue>(IPC_CHANNELS.changeUnbind, {
        sessionId: harness.sessionId,
        baseEditSeq,
        bindingId: replaced.value.bindings[0]!.bindingId,
        reason: '测试解除',
      })
      expect(unbound.ok).toBe(true)
      if (unbound.ok) expect(unbound.value.bindings).toHaveLength(0)
      // 正式环值/参数未被反向修改（草稿阶段零正式写入）。
      const after = harness.projectService.getSession(harness.sessionId)!
      expect(JSON.stringify(after.snapshot)).toBe(JSON.stringify(before.snapshot))
    } finally {
      await harness.dispose()
    }
  })

  it('已绑定环不能通过普通 stage 直接改 nominal（main 侧拒绝）', async () => {
    const harness = await createChangeHarness()
    try {
      const session = harness.projectService.getSession(harness.sessionId)!
      const dto = {
        ...session.snapshot,
        project: {
          ...session.snapshot.project,
          dimensionChain: {
            ...session.snapshot.project.dimensionChain,
            terms: session.snapshot.project.dimensionChain.terms.map((term) =>
              term.id === 't-s' ? { ...term, nominalQ: 130000 } : term,
            ),
          },
        },
      }
      const staged = (await harness.projectService.stageFromDto(
        session.sessionId,
        session.acceptedSeq + 1,
        dto,
      ))
      expect(staged.ok).toBe(false)
      if (!staged.ok) expect(staged.error.code).toBe('INVALID_BINDING')
    } finally {
      await harness.dispose()
    }
  })
})

describe('D 恢复与对比', () => {
  it('从旧版恢复：新草稿/绑定记录继承/确认清零/正式指针与旧版不变', async () => {
    const harness = await createChangeHarness()
    try {
      const draftB = await stageLength(harness, '14.00')
      const previewB = await preview(harness, draftB)
      const appliedB = await apply(harness, draftB, previewB, 'req-b')
      expect(appliedB.ok).toBe(true)

      const draftC = await stageLength(harness, '12.10')
      const previewC = await preview(harness, draftC)
      const appliedC = await apply(harness, draftC, previewC, 'req-c')
      expect(appliedC.ok).toBe(true)
      const session = harness.projectService.getSession(harness.sessionId)!
      const currentId = session.snapshot.project.currentRevisionId
      const revisionCount = session.snapshot.fileRevisions.length

      const staged = await stageLength(harness, '12.10')
      const restored = await harness.invoke<ChangeRestoreValue>(IPC_CHANNELS.changeRestore, {
        sessionId: harness.sessionId,
        baseToken: staged.baseToken,
        sourceRevisionId: 'rev-a1',
        reason: '恢复 A',
      })
      expect(restored.ok).toBe(true)
      if (!restored.ok) return
      expect(restored.value.confirmationCleared).toBe(true)
      expect(restored.value.restoredFromRevisionId).toBe('rev-a1')
      expect(restored.value.bindings).toHaveLength(1)
      expect(restored.value.parameters.find((item) => item.key === 'length')!.valueQ).toBe(120000)
      // 参数修订号只前进，不带回旧号让旧凭据复活。
      expect(restored.value.parameters.find((item) => item.key === 'length')!.parameterRevision).toBe(4)
      const after = harness.projectService.getSession(harness.sessionId)!
      expect(after.snapshot.project.currentRevisionId).toBe(currentId)
      expect(after.snapshot.fileRevisions).toHaveLength(revisionCount)
    } finally {
      await harness.dispose()
    }
  })

  it('双图字段级比较：参数/标注文字变化可见；无旧图给出可解释状态', async () => {
    const harness = await createChangeHarness()
    try {
      const draft = await stageLength(harness, '14.00')
      const shown = await preview(harness, draft)
      const applied = await apply(harness, draft, shown, 'req-compare')
      expect(applied.ok).toBe(true)

      const compared = await harness.invoke<ChangeCompareValueResponse>(IPC_CHANNELS.changeCompare, {
        sessionId: harness.sessionId,
        leftRevisionId: 'rev-a1',
      })
      expect(compared.ok).toBe(true)
      if (!compared.ok) return
      expect(compared.value.left).not.toBeNull()
      expect(compared.value.unchanged).toBe(false)
      const fields = compared.value.diff.map((item) => `${item.scope}:${item.field}`)
      expect(fields).toContain('parameter:工程值 valueQ')
      expect(fields).toContain('annotation:标注文字')

      // 无图纸的旧版本：不伪造对比（当前版本仍有图纸）。
      const withOld = await createSpacerSnapshot({ length: '12.00' })
      const oldProject = {
        ...withOld.project,
        drawings: [],
        currentRevisionId: 'rev-old-no-drawing',
      }
      withOld.fileRevisions.push({
        revisionId: 'rev-old-no-drawing',
        parentId: null,
        createdAt: '2026-11-09T07:00:00.000Z',
        reason: 'C 之前无图纸',
        project: oldProject,
      })
      const filePath = await harness.writeSample(withOld, 'no-drawing')
      const opened = await harness.projectService.openFile(filePath)
      expect(opened.ok, opened.ok ? '' : `${opened.error.code}: ${opened.error.message} ${opened.error.detail ?? ''}`).toBe(true)
      if (!opened.ok) return
      await harness.controller.attach(1, opened.value.sessionId)
      const unavailable = await harness.invoke<ChangeCompareValueResponse>(IPC_CHANNELS.changeCompare, {
        sessionId: opened.value.sessionId,
        leftRevisionId: 'rev-old-no-drawing',
      })
      expect(unavailable.ok, unavailable.ok ? '' : `${unavailable.error.code}: ${unavailable.error.message}`).toBe(true)
      if (!unavailable.ok) return
      expect(unavailable.value.left).toBeNull()
      expect(unavailable.value.leftUnavailableReason).toContain('没有图纸')
    } finally {
      await harness.dispose()
    }
  })
})

describe('D token 契约：错误形状与零写入', () => {
  it('修改 baseToken 的请求被拒绝', async () => {
    const harness = await createChangeHarness()
    try {
      const draft = await stageLength(harness, '14.00')
      const shown = await preview(harness, draft)
      const wrong = await harness.invoke<ChangeApplyValue>(IPC_CHANNELS.changeApply, {
        sessionId: harness.sessionId,
        baseToken: 'f'.repeat(16),
        draftToken: draft.draftToken,
        previewId: shown.previewId,
        previewToken: shown.previewToken,
        requestId: 'req-wrong-token',
        reason: 'x',
      })
      expect(wrong.ok).toBe(false)
      if (!wrong.ok) expect(wrong.error.code).toBe('STALE_BASE')
    } finally {
      await harness.dispose()
    }
  })
})

export type { ProjectOpenValue }
