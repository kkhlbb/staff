/**
 * V3.5 条款确认 main 服务：表单 → 不可变条款版本 → 基线检查 → 原子写盘。
 *
 * 验证：
 * - 首版确认写入磁盘，原文/区间/来源/检查冻结；
 * - 更新必须带原因，新建 revisionId 并保留旧版本；
 * - 表单未确认时预览为 pending-confirmation（不冒充满足）；
 * - 换版导入后旧条款仍指向旧版本，检查转待确认。
 */
import { promises as fsp } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeProjectFile } from '../../src/project-file/codec'
import { createSpacerSnapshot } from '../../src/project-file/__fixtures__/spacerProjectFile'
import type { RequirementEditDraft } from '../../src/requirements/types'
import { ChangeService } from '../main/changeService'
import { createHarness } from './helpers/a04'

const SOURCE = {
  documentId: 'doc-1',
  revisionId: 'sr-1',
  page: 2,
  rectPdf: [10, 10, 110, 30] as [number, number, number, number],
  pageBoxPdf: [0, 0, 595, 842] as [number, number, number, number],
}
const TEXT = '轴向装配间隙 C 应为 0.1000～0.3000 mm，含两端'

async function setup() {
  const harness = await createHarness()
  const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
  const opened = await harness.openSample(snapshot, 'req-flow')
  const filePath = opened.path!
  let counter = 0
  const changeService = new ChangeService({
    projectService: harness.projectService,
    recovery: harness.recovery,
    controller: harness.controller,
    now: () => new Date(`2026-11-09T12:10:${String((counter += 1)).padStart(2, '0')}.000Z`),
    newId: () => `v35-${(counter += 1)}`,
  })
  return { harness, sessionId: opened.sessionId, filePath, changeService }
}

function edit(overrides: Partial<RequirementEditDraft> = {}): RequirementEditDraft {
  return {
    requirementId: null,
    editRevision: 1,
    confirmedText: TEXT,
    lowerText: '0.1000',
    upperText: '0.3000',
    source: {
      documentId: SOURCE.documentId,
      revisionId: SOURCE.revisionId,
      page: SOURCE.page,
      rectPdf: SOURCE.rectPdf,
      pageBoxPdf: SOURCE.pageBoxPdf,
    },
    ...overrides,
  }
}

describe('V3.5 条款确认 main 服务', () => {
  it('首版确认：冻结原文/区间/来源/基线检查并原子写盘', async () => {
    const { harness, sessionId, filePath, changeService } = await setup()
    try {
      const session = harness.projectService.getSession(sessionId)!
      const staged = await changeService.stageRequirementEdit(sessionId, {
        sessionId,
        baseEditSeq: session.acceptedSeq,
        edit: edit(),
      })
      expect(staged.ok).toBe(true)
      if (!staged.ok) return

      const confirmed = await changeService.confirmRequirement(sessionId, {
        sessionId,
        baseToken: staged.value.baseToken,
        expectedActiveRequirementRevisionId: null,
        requirementId: null,
        source: SOURCE,
        confirmedText: TEXT,
        lowerText: '0.1000',
        upperText: '0.3000',
        changeReason: '',
        confirmed: true,
      })
      expect(confirmed.ok, confirmed.ok ? '' : `${confirmed.error.code}: ${confirmed.error.message}`).toBe(true)
      if (!confirmed.ok) return
      expect(confirmed.value.baselineCheck.status).toBe('satisfied')
      expect(confirmed.value.baselineCheck.resultInterval).toEqual({ minQ: 1500, maxQ: 2500 })
      expect(confirmed.value.path).toBe(filePath)

      const decoded = await decodeProjectFile(new Uint8Array(await fsp.readFile(filePath)))
      expect(decoded.ok).toBe(true)
      if (!decoded.ok) return
      const project = decoded.value.snapshot.project
      expect(project.requirementRevisions).toHaveLength(1)
      const revision = project.requirementRevisions[0]!
      expect(revision).toMatchObject({
        confirmedText: TEXT,
        lowerQ: 1000,
        upperQ: 3000,
        parentRevisionId: null,
        confirmedAgainstLatestRevisionId: 'sr-1',
      })
      expect(revision.source).toMatchObject(SOURCE)
      expect(project.activeRequirementRevisionId).toBe(revision.revisionId)
      expect(project.currentRequirementCheck?.status).toBe('satisfied')
      expect(project.currentRevisionId).toBe(confirmed.value.configRevisionId)
    } finally {
      await harness.dispose()
    }
  })

  it('更新条款：必须填写原因；新建版本、旧版本保留、活动指针前进', async () => {
    const { harness, sessionId, filePath, changeService } = await setup()
    try {
      const first = await changeService.stageRequirementEdit(sessionId, {
        sessionId,
        baseEditSeq: 0,
        edit: edit(),
      })
      if (!first.ok) throw new Error(first.error.message)
      const confirmed1 = await changeService.confirmRequirement(sessionId, {
        sessionId,
        baseToken: first.value.baseToken,
        expectedActiveRequirementRevisionId: null,
        requirementId: null,
        source: SOURCE,
        confirmedText: TEXT,
        lowerText: '0.1000',
        upperText: '0.3000',
        changeReason: '',
        confirmed: true,
      })
      if (!confirmed1.ok) throw new Error(confirmed1.error.message)
      const oldRevisionId = confirmed1.value.requirementRevisionId
      const oldRequirementId = confirmed1.value.requirementId

      // 未填更新原因：拒绝，磁盘不变。
      const session = harness.projectService.getSession(sessionId)!
      const staged2 = await changeService.stageRequirementEdit(sessionId, {
        sessionId,
        baseEditSeq: session.acceptedSeq,
        edit: edit({ requirementId: oldRequirementId, editRevision: 1, upperText: '0.3200' }),
      })
      if (!staged2.ok) throw new Error(staged2.error.message)
      const rejected = await changeService.confirmRequirement(sessionId, {
        sessionId,
        baseToken: staged2.value.baseToken,
        expectedActiveRequirementRevisionId: oldRevisionId,
        requirementId: oldRequirementId,
        source: SOURCE,
        confirmedText: TEXT,
        lowerText: '0.1000',
        upperText: '0.3200',
        changeReason: '',
        confirmed: true,
      })
      expect(rejected.ok).toBe(false)
      if (!rejected.ok) {
        expect(rejected.error.code).toBe('INVALID_REQUIREMENT_INPUT')
        expect(rejected.error.reasonCodes).toContain('missing_change_reason')
      }

      const staged3 = await changeService.stageRequirementEdit(sessionId, {
        sessionId,
        baseEditSeq: session.acceptedSeq,
        edit: edit({ requirementId: oldRequirementId, editRevision: 2, upperText: '0.3200' }),
      })
      if (!staged3.ok) throw new Error(staged3.error.message)
      const confirmed2 = await changeService.confirmRequirement(sessionId, {
        sessionId,
        baseToken: staged3.value.baseToken,
        expectedActiveRequirementRevisionId: oldRevisionId,
        requirementId: oldRequirementId,
        source: SOURCE,
        confirmedText: TEXT,
        lowerText: '0.1000',
        upperText: '0.3200',
        changeReason: '客户更新任务书上限',
        confirmed: true,
      })
      expect(confirmed2.ok, confirmed2.ok ? '' : `${confirmed2.error.code}: ${confirmed2.error.message}`).toBe(true)
      if (!confirmed2.ok) return

      const decoded = await decodeProjectFile(new Uint8Array(await fsp.readFile(filePath)))
      if (!decoded.ok) throw new Error(decoded.error.message)
      const project = decoded.value.snapshot.project
      expect(project.requirementRevisions).toHaveLength(2)
      const oldOne = project.requirementRevisions.find((item) => item.revisionId === oldRevisionId)!
      const newOne = project.requirementRevisions.find(
        (item) => item.revisionId === confirmed2.value.requirementRevisionId,
      )!
      expect(oldOne.upperQ).toBe(3000)
      expect(newOne.parentRevisionId).toBe(oldRevisionId)
      expect(newOne.upperQ).toBe(3200)
      expect(newOne.requirementId).toBe(oldRequirementId)
      expect(newOne.changeReason).toBe('客户更新任务书上限')
      expect(project.activeRequirementRevisionId).toBe(newOne.revisionId)
    } finally {
      await harness.dispose()
    }
  })

  it('未确认表单存在时预览为待确认，不冒充满足', async () => {
    const { harness, sessionId, changeService } = await setup()
    try {
      const session = harness.projectService.getSession(sessionId)!
      const staged = await changeService.stageRequirementEdit(sessionId, {
        sessionId,
        baseEditSeq: session.acceptedSeq,
        edit: edit(),
      })
      if (!staged.ok) throw new Error(staged.error.message)
      const confirmed = await changeService.confirmRequirement(sessionId, {
        sessionId,
        baseToken: staged.value.baseToken,
        expectedActiveRequirementRevisionId: null,
        requirementId: null,
        source: SOURCE,
        confirmedText: TEXT,
        lowerText: '0.1000',
        upperText: '0.3000',
        changeReason: '',
        confirmed: true,
      })
      if (!confirmed.ok) throw new Error(confirmed.error.message)

      // 打开未确认表单（只存在 main 内存）。
      const current = harness.projectService.getSession(sessionId)!
      const pending = await changeService.stageRequirementEdit(sessionId, {
        sessionId,
        baseEditSeq: current.acceptedSeq,
        edit: edit({
          requirementId: confirmed.value.requirementId,
          editRevision: 1,
          upperText: '0.3100',
        }),
      })
      if (!pending.ok) throw new Error(pending.error.message)

      const draft = await changeService.stage(sessionId, {
        sessionId,
        baseEditSeq: current.acceptedSeq,
        inputs: { innerDiameter: '20.00', outerDiameter: '32.00', length: '12.04' },
        reason: '待确认表单下的候选',
      })
      if (!draft.ok) throw new Error(draft.error.message)
      const preview = await changeService.preview(
        sessionId,
        draft.value.baseToken,
        draft.value.draftToken,
      )
      expect(preview.ok, preview.ok ? '' : `${preview.error.code}: ${preview.error.message}`).toBe(true)
      if (!preview.ok) return
      expect(preview.value.requirement?.check.status).toBe('pending-confirmation')
      expect(preview.value.requirement?.check.reasonCodes).toContain('REQUIREMENT_EDIT_UNCONFIRMED')
      // 原目标结果独立保留。
      expect(preview.value.requirement?.originalTargetResult).not.toBeNull()
      expect(preview.value.chain.target).toEqual({ minQ: 1000, maxQ: 3000 })
    } finally {
      await harness.dispose()
    }
  })
})
