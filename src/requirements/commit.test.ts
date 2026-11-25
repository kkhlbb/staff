/**
 * V3.5 Beta：提交已重算的变更（领域操作 3）用例。
 *
 * 重点证明：提交从当前草稿重新 computeChange + 重算条款检查，与预览指纹/
 * 状态比对后才允许进入原人工确认流程；renderer 的结果不被采信。
 */
import { describe, expect, it, vi } from 'vitest'
import type { ProjectFileSnapshot } from '../project-file/types'
import { createSpacerSnapshot } from '../project-file/__fixtures__/spacerProjectFile'
import { computeCandidateRequirementCheck } from './check'
import { computeChange } from '../revisions/compute'
import { commitRecomputedChange, type CommitRecomputedChangeInput } from './commit'
import type { RequirementCheck } from './types'
import {
  activeRequirement,
  createRequirementProject,
  draftWithLength,
} from './__fixtures__/requirementFixture'

const CHECKED_AT = '2026-11-09T10:00:00.000Z'

async function checkFor(
  snapshot: ProjectFileSnapshot,
  draft: ReturnType<typeof draftWithLength>,
  overrides: { requirementRevisions?: ProjectFileSnapshot['project']['requirementRevisions'] } = {},
): Promise<RequirementCheck> {
  const result = await computeCandidateRequirementCheck({
    snapshot,
    requirementRevisions:
      overrides.requirementRevisions ?? snapshot.project.requirementRevisions,
    activeRequirementRevisionId: snapshot.project.activeRequirementRevisionId,
    pendingEdit: null,
    draft,
    baseRevisionId: snapshot.project.currentRevisionId,
    baseGeneration: 0,
    acceptedSeq: 1,
    checkedAt: CHECKED_AT,
    checkId: 'check-preview-1',
    inputIssue: null,
  })
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value.check
}

function commitInput(
  snapshot: ProjectFileSnapshot,
  draft: ReturnType<typeof draftWithLength>,
  previewCheck: RequirementCheck | null,
  overrides: Partial<CommitRecomputedChangeInput> = {},
): CommitRecomputedChangeInput {
  return {
    snapshot,
    draft,
    requirementRevisions: snapshot.project.requirementRevisions,
    activeRequirementRevisionId: snapshot.project.activeRequirementRevisionId,
    pendingEdit: null,
    previewCheck,
    baseRevisionId: snapshot.project.currentRevisionId,
    baseGeneration: 0,
    acceptedSeq: 1,
    checkedAt: CHECKED_AT,
    checkId: 'check-commit-1',
    revisionId: 'rev-commit-1',
    analysisSnapshotId: 'snapshot-commit-1',
    reason: '参数变更确认',
    restoredFromRevisionId: null,
    ...overrides,
  }
}

function upgradedSource(snapshot: ProjectFileSnapshot): ProjectFileSnapshot {
  const sourceRevision = snapshot.revisions[0]!
  return {
    ...snapshot,
    documents: snapshot.documents.map((document) => ({
      ...document,
      latestRevisionId: 'sr-2',
    })),
    revisions: [
      sourceRevision,
      { ...sourceRevision, id: 'sr-2', createdAt: '2026-11-09T11:00:00.000Z' },
    ],
  }
}

describe('V3.5 提交重算：只放行 satisfied，且用当前草稿重算', () => {
  it('S=12.04 满足：候选冻结条款版本/检查/证据引用', async () => {
    const project = await createRequirementProject()
    const draft = draftWithLength(project.snapshot, '12.04')
    const previewCheck = await checkFor(project.snapshot, draft)

    const result = await commitRecomputedChange(
      commitInput(project.snapshot, draft, previewCheck),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { candidate, check, requirementGate } = result.value
    expect(requirementGate).toBe(true)
    expect(check.status).toBe('satisfied')
    expect(check.provenance).toBe('committed')
    expect(candidate.snapshot.project.currentRequirementCheck).toMatchObject({
      status: 'satisfied',
      requirementRevisionId: 'reqrev-1',
      resultInterval: { minQ: 1100, maxQ: 2100 },
    })
    expect(candidate.snapshot.project.schemaVersion).toBe(11)
    expect(candidate.snapshot.project.activeRequirementRevisionId).toBe('reqrev-1')
    expect(candidate.snapshot.project.requirementRevisions[0]).toEqual(
      project.snapshot.project.requirementRevisions[0],
    )
    expect(candidate.revision.evidence?.requirementRevisionId).toBe('reqrev-1')
    expect(candidate.revision.evidence?.checkId).toBe('check-commit-1')
    expect(candidate.analysisSnapshot.id).toBe('snapshot-commit-1')
  })

  it('S=12.10 不满足：拒绝提交，不产生候选', async () => {
    const project = await createRequirementProject()
    const draft = draftWithLength(project.snapshot, '12.10')
    const previewCheck = await checkFor(project.snapshot, draft)
    expect(previewCheck.status).toBe('unsatisfied')

    const result = await commitRecomputedChange(
      commitInput(project.snapshot, draft, previewCheck),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('REQUIREMENT_NOT_SATISFIED')
      expect(result.error.reasonCodes).toContain('LOWER_VIOLATED')
    }
  })

  it('P35-T S=11.90：原目标满足但条款不满足，仍拒绝', async () => {
    const project = await createRequirementProject({
      target: { minQ: 2000, maxQ: 4000 },
    })
    const draft = draftWithLength(project.snapshot, '11.90')
    const previewCheck = await checkFor(project.snapshot, draft)
    expect(previewCheck.status).toBe('unsatisfied')

    const result = await commitRecomputedChange(
      commitInput(project.snapshot, draft, previewCheck),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('REQUIREMENT_NOT_SATISFIED')
    // 原目标未被改写。
    expect(project.snapshot.project.dimensionChain.target).toEqual({ minQ: 2000, maxQ: 4000 })
  })

  it('待确认（PDF 换版）→ REQUIREMENT_PENDING_CONFIRMATION', async () => {
    const project = await createRequirementProject()
    const changed = upgradedSource(project.snapshot)
    const draft = draftWithLength(changed, '12.04')
    const previewCheck = await checkFor(changed, draft)
    expect(previewCheck.status).toBe('pending-confirmation')

    const result = await commitRecomputedChange(commitInput(changed, draft, previewCheck))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('REQUIREMENT_PENDING_CONFIRMATION')
      expect(result.error.reasonCodes).toContain('SOURCE_VERSION_CHANGED')
    }
  })

  it('未检查（规则不支持）→ REQUIREMENT_UNCHECKED', async () => {
    const project = await createRequirementProject()
    const requirement = activeRequirement(project.snapshot)
    const unsupported = [
      {
        ...requirement,
        ruleType: 'strict-interval-mm' as unknown as typeof requirement.ruleType,
      },
    ]
    const snapshot = project.snapshot
    const draft = draftWithLength(snapshot, '12.04')
    const previewCheck = await checkFor(snapshot, draft, {
      requirementRevisions: unsupported as typeof snapshot.project.requirementRevisions,
    })
    expect(previewCheck.status).toBe('unchecked')

    const result = await commitRecomputedChange(
      commitInput(snapshot, draft, previewCheck, {
        requirementRevisions: unsupported as typeof snapshot.project.requirementRevisions,
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('REQUIREMENT_UNCHECKED')
      expect(result.error.reasonCodes).toContain('UNSUPPORTED_RULE')
    }
  })

  it('预览后来源换版：旧 satisfied 检查不能提交（STALE_REQUIREMENT）', async () => {
    const project = await createRequirementProject()
    const draft = draftWithLength(project.snapshot, '12.04')
    const previewCheck = await checkFor(project.snapshot, draft) // 换版前 satisfied
    const changed = upgradedSource(project.snapshot)

    const result = await commitRecomputedChange(
      commitInput(changed, draft, previewCheck, {
        draft: draftWithLength(changed, '12.04'),
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('STALE_REQUIREMENT')
  })

  it('伪造“已满足”预览（指纹不符）被拒绝，不采信 renderer 结果', async () => {
    const project = await createRequirementProject()
    const draft = draftWithLength(project.snapshot, '12.10')
    const genuine = await checkFor(project.snapshot, draft)
    const forged: RequirementCheck = {
      ...genuine,
      status: 'satisfied',
      reasonCodes: ['WITHIN_REQUIREMENT'],
      inputFingerprint: 'forged-fingerprint',
    }
    const result = await commitRecomputedChange(commitInput(project.snapshot, draft, forged))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('STALE_REQUIREMENT')
  })

  it('同一草稿身份但数值已变（预览与草稿不一致）→ 重算后拒绝', async () => {
    const project = await createRequirementProject()
    const previewCheck = await checkFor(
      project.snapshot,
      draftWithLength(project.snapshot, '12.04'),
    )
    // 草稿 ID/代数不变，但数值变成 12.10：模拟提交前草稿被替换。
    const diverged = draftWithLength(project.snapshot, '12.10')
    const result = await commitRecomputedChange(
      commitInput(project.snapshot, diverged, previewCheck),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('STALE_REQUIREMENT')
  })

  it('提交不采信 previewComputation：预览 12.04、草稿 12.10 → 拒绝', async () => {
    const project = await createRequirementProject()
    const previewDraft = draftWithLength(project.snapshot, '12.04')
    const previewComputation = computeChange(
      project.snapshot,
      { parameters: previewDraft.parameters, bindings: previewDraft.bindings },
      { revisionId: 'rev-commit-1', now: CHECKED_AT },
    )
    const previewCheck = await checkFor(project.snapshot, previewDraft)
    const commitDraft = draftWithLength(project.snapshot, '12.10')
    const result = await commitRecomputedChange(
      commitInput(project.snapshot, commitDraft, previewCheck, { previewComputation }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('STALE_PREVIEW')
  })

  it('提交路径确实第二次调用条款检查（依赖注入计数）', async () => {
    const project = await createRequirementProject()
    const draft = draftWithLength(project.snapshot, '12.04')
    const previewCheck = await checkFor(project.snapshot, draft)

    const spy = vi.fn(computeCandidateRequirementCheck)
    const result = await commitRecomputedChange(
      commitInput(project.snapshot, draft, previewCheck, {
        deps: { computeCheck: spy },
      }),
    )
    expect(result.ok).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![0]).toMatchObject({
      checkId: 'check-commit-1',
      basis: { kind: 'draft', draftId: draft.draftId, draftRevision: draft.draftRevision },
    })
  })

  it('无条款老项目不被 Beta 门禁锁住（沿用 D 重算/CAS 语义）', async () => {
    const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    const draft = draftWithLength(snapshot, '12.04')
    const result = await commitRecomputedChange(commitInput(snapshot, draft, null))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.requirementGate).toBe(false)
    expect(result.value.candidate.snapshot.project.currentRequirementCheck).toBeNull()
    expect(result.value.candidate.revision.evidence?.requirementRevisionId).toBeUndefined()
  })
})
