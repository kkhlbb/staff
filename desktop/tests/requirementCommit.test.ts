/**
 * V3.5：main 提交路径集成——apply 重算条款检查并与预览比对。
 *
 * 这是 MUT-B35-RECOMPUTE 的行为层证明：即使 token 全部有效，提交阶段仍从
 * 当前草稿重算；预览后条款基准变化会拒绝为 STALE_BASE，越界则
 * REQUIREMENT_NOT_SATISFIED，磁盘正式版本不前进。
 */
import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeProjectFile } from '../../src/project-file/codec'
import { createRequirementProject } from '../../src/requirements/__fixtures__/requirementFixture'
import { ChangeService } from '../main/changeService'
import { createHarness } from './helpers/a04'

async function sha256File(target: string): Promise<string> {
  return createHash('sha256').update(await fsp.readFile(target)).digest('hex')
}

async function setup() {
  const harness = await createHarness()
  const project = await createRequirementProject()
  const filePath = await harness.writeSample(project.snapshot, 'req-project')
  const opened = await harness.projectService.openFile(filePath)
  if (!opened.ok) throw new Error(`open failed: ${opened.error.code} ${opened.error.message}`)
  expect(opened.value.snapshot.project.activeRequirementRevisionId).toBe('reqrev-1')
  let counter = 0
  const changeService = new ChangeService({
    projectService: harness.projectService,
    recovery: harness.recovery,
    controller: harness.controller,
    now: () => new Date(`2026-11-09T12:00:${String((counter += 1)).padStart(2, '0')}.000Z`),
    newId: () => `beta-${(counter += 1)}`,
  })
  return {
    harness,
    sessionId: opened.value.sessionId,
    filePath,
    changeService,
  }
}

async function stage(
  harness: { projectService: { getSession: (id: string) => { acceptedSeq: number } | null } },
  service: ChangeService,
  sessionId: string,
  length: string,
) {
  const session = harness.projectService.getSession(sessionId)!
  const staged = await service.stage(sessionId, {
    sessionId,
    baseEditSeq: session.acceptedSeq,
    inputs: { innerDiameter: '20.00', outerDiameter: '32.00', length },
    reason: 'Beta 集成测试',
  })
  if (!staged.ok) throw new Error(`stage failed: ${staged.error.code} ${staged.error.message}`)
  return staged.value
}

describe('V3.5 main 提交路径：条款门禁与重算', () => {
  it('12.04 预览后提交成功，磁盘冻结 satisfied 检查', async () => {
    const { harness, sessionId, filePath, changeService } = await setup()
    try {
      const draft = await stage(harness, changeService, sessionId, '12.04')
      const shown = await changeService.preview(sessionId, draft.baseToken, draft.draftToken)
      expect(shown.ok).toBe(true)
      if (!shown.ok) return

      const applied = await changeService.apply({
        sessionId,
        baseToken: draft.baseToken,
        draftToken: draft.draftToken,
        previewId: shown.value.previewId,
        previewToken: shown.value.previewToken,
        requestId: 'req-ok',
        reason: '确认 12.04',
      })
      expect(applied.ok, applied.ok ? '' : `${applied.error.code}: ${applied.error.message}`).toBe(
        true,
      )
      if (!applied.ok) return
      expect(applied.value.warnings.join(' ')).not.toContain('迁移前')

      const decoded = await decodeProjectFile(new Uint8Array(await fsp.readFile(filePath)))
      expect(decoded.ok).toBe(true)
      if (!decoded.ok) return
      expect(decoded.value.snapshot.project.currentRequirementCheck).toMatchObject({
        status: 'satisfied',
        requirementRevisionId: 'reqrev-1',
        resultInterval: { minQ: 1100, maxQ: 2100 },
      })
      expect(decoded.value.snapshot.project.dimensionChain.target).toEqual({
        minQ: 1000,
        maxQ: 3000,
      })
    } finally {
      await harness.dispose()
    }
  })

  it('12.10 被 Beta 门禁拒绝：REQUIREMENT_NOT_SATISFIED，磁盘正式版本不变', async () => {
    const { harness, sessionId, filePath, changeService } = await setup()
    try {
      const beforeHash = await sha256File(filePath)
      const draft = await stage(harness, changeService, sessionId, '12.10')
      const shown = await changeService.preview(sessionId, draft.baseToken, draft.draftToken)
      expect(shown.ok).toBe(true)
      if (!shown.ok) return

      const applied = await changeService.apply({
        sessionId,
        baseToken: draft.baseToken,
        draftToken: draft.draftToken,
        previewId: shown.value.previewId,
        previewToken: shown.value.previewToken,
        requestId: 'req-out',
        reason: '尝试越界提交',
      })
      expect(applied.ok).toBe(false)
      if (!applied.ok) {
        expect(applied.error.code).toBe('REQUIREMENT_NOT_SATISFIED')
        expect(applied.error.reasonCodes).toContain('LOWER_VIOLATED')
      }
      expect(await sha256File(filePath)).toBe(beforeHash)
      // 草稿仍在，可继续修正。
      const session = harness.projectService.getSession(sessionId)!
      expect(session.acceptedSeq).toBe(session.savedSeq)
    } finally {
      await harness.dispose()
    }
  })

  it('预览后条款版本变化 → STALE_BASE（条款已纳入基准摘要）', async () => {
    const { harness, sessionId, filePath, changeService } = await setup()
    try {
      const draft = await stage(harness, changeService, sessionId, '12.04')
      const shown = await changeService.preview(sessionId, draft.baseToken, draft.draftToken)
      expect(shown.ok).toBe(true)
      if (!shown.ok) return

      // 直接修改 main 权威聚合的活动条款区间，模拟条款向导在预览后确认新版。
      const session = harness.projectService.getSession(sessionId)!
      const active = session.snapshot.project.activeRequirementRevisionId!
      session.snapshot = {
        ...session.snapshot,
        project: {
          ...session.snapshot.project,
          requirementRevisions: session.snapshot.project.requirementRevisions.map((revision) =>
            revision.revisionId === active
              ? { ...revision, upperQ: revision.upperQ + 100 }
              : revision,
          ),
        },
      }

      const applied = await changeService.apply({
        sessionId,
        baseToken: draft.baseToken,
        draftToken: draft.draftToken,
        previewId: shown.value.previewId,
        previewToken: shown.value.previewToken,
        requestId: 'req-stale',
        reason: '旧预览提交',
      })
      expect(applied.ok).toBe(false)
      if (!applied.ok) {
        expect(applied.error.code).toBe('STALE_BASE')
        expect(applied.error.detail ?? '').toContain('任务书条款')
      }
      const decoded = await decodeProjectFile(new Uint8Array(await fsp.readFile(filePath)))
      expect(decoded.ok).toBe(true)
      if (!decoded.ok) return
      expect(decoded.value.snapshot.project.activeRequirementRevisionId).toBe('reqrev-1')
    } finally {
      await harness.dispose()
    }
  })
})
