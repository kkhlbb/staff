// @vitest-environment node
/**
 * V4.0 阶段 4：context.recentRevisions 真实数据检查（无模型）。
 * 覆盖：提交后重开，上下文能给出已保存版本的新旧长度（含 valueMm）。
 */
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentToolService } from '../main/agentToolService'
import { toolMessageContent } from '../main/agentScheduler'
import { ApprovalStore } from '../main/approvalStore'
import { createRequirementProject } from '../../src/requirements/__fixtures__/requirementFixture'
import { IPC_CHANNELS, type ProjectOpenValue } from '../shared/contracts'
import { createHarness, type Harness } from './helpers/a04'

const cleanup: Harness[] = []
afterEach(async () => { for (const h of cleanup.splice(0)) await h.dispose() })

describe('V4.0 阶段4：context.recentRevisions', () => {
  it('提交 12.04 后重开：recentRevisions 给出 12.0000 → 12.0400 的已保存版本', async () => {
    const h = await createHarness({ debounceMs: 60_000 })
    cleanup.push(h)
    const project = await createRequirementProject()
    const opened = await h.openSample(project.snapshot)
    const session = h.projectService.getSession(opened.sessionId)!
    const service = new AgentToolService({
      controller: h.controller,
      projectService: h.projectService,
      recovery: h.recovery,
      rootDir: h.workspace,
      approvals: new ApprovalStore({ rootDir: h.workspace }),
    })
    const draft = await service.prepareDemoDraft(1)
    expect(draft.ok).toBe(true)
    if (!draft.ok) return
    const base = session.snapshot.project.currentRevisionId
    const staged = await service.run(1, 'stage', { toolMode: 'agent', draftId: draft.data.draftId, baseRevisionId: base, parameter: 'length', valueMm: '12.04', lockedKeys: ['innerDiameter', 'outerDiameter'] })
    expect(staged.ok, JSON.stringify(staged)).toBe(true)
    const previewed = await service.run(1, 'preview', { toolMode: 'agent', draftId: draft.data.draftId, baseRevisionId: base })
    expect(previewed.ok, JSON.stringify(previewed)).toBe(true)
    const preview = service.previewSummary(1)
    expect(preview.ok && preview.data !== null).toBe(true)
    if (!preview.ok || preview.data === null) return
    const issued = await service.issueApproval(1, preview.data.previewId)
    expect(issued.ok).toBe(true)
    if (!issued.ok) return
    const committed = await service.commitApprovedDraft(1, { approvalId: issued.data.approvalId, draftId: preview.data.draftId, previewFingerprint: preview.data.previewFingerprint })
    expect(committed.ok, JSON.stringify(committed)).toBe(true)

    // 重开：复制文件到持久位置，新 harness 打开。
    const copy = path.join(os.tmpdir(), `cunlian-recent-${Date.now()}.cunlian`)
    await fsp.copyFile(session.path!, copy)
    const h2 = await createHarness({ debounceMs: 60_000 })
    cleanup.push(h2)
    h2.openQueue.push(copy)
    const reopened = await h2.invoke<ProjectOpenValue>(IPC_CHANNELS.projectOpen, {}) as unknown as { ok: boolean; value: ProjectOpenValue }
    expect(reopened.ok).toBe(true)
    const service2 = new AgentToolService({ controller: h2.controller, projectService: h2.projectService, recovery: h2.recovery, rootDir: h2.workspace })
    const context = await service2.run(1, 'context', {})
    expect(context.ok, JSON.stringify(context)).toBe(true)
    if (!context.ok) return
    const value = context.data as { recentRevisions?: { revisionId: string; parameters: { key: string; valueQ: number; valueMm?: string }[] }[]; parameters: { key: string; valueMm?: string }[] }
    expect(value.recentRevisions).toBeDefined()
    const lengths = (value.recentRevisions ?? []).map((revision) => revision.parameters.find((parameter) => parameter.key === 'length')?.valueMm ?? null)
    expect(lengths).toContain('12.0000')
    expect(lengths[lengths.length - 1]).toBe('12.0400')
    expect(value.parameters.find((parameter) => parameter.key === 'length')?.valueMm).toBe('12.0400')
    // 上下文必须完整装进一次工具消息预算（否则模型只看到截断的前半段）。
    const budget = toolMessageContent('context', { ok: true, data: context.data, requestId: context.requestId, objectVersion: context.objectVersion })
    expect(JSON.parse(budget).truncated).toBeUndefined()
  }, 60_000)
})
