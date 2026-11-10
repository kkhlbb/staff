/**
 * V3.5 Beta：条款确认/更新操作（领域操作 1）用例。
 *
 * 覆盖：首版/更新版本化、单条限制、显式确认、上下限精度与逆序、来源归属/
 * 哈希/页码/选区、基准与活动条款 CAS、基线不满足可登记但不放行草稿。
 */
import { describe, expect, it } from 'vitest'
import type { ProjectFileSnapshot } from '../project-file/types'
import { createSpacerSnapshot } from '../project-file/__fixtures__/spacerProjectFile'
import { SAMPLE_PROJECT_ID } from '../project-file/__fixtures__/sampleProjectFile'
import { confirmOrUpdateRequirement, type ConfirmRequirementInput } from './confirm'
import {
  activeRequirement,
  createRequirementProject,
  REQUIREMENT_SOURCE,
  TASKBOOK_TEXT,
} from './__fixtures__/requirementFixture'

function baseInput(snapshot: ProjectFileSnapshot): ConfirmRequirementInput {
  return {
    snapshot,
    expectedBaseToken: 'base-1',
    currentBaseToken: 'base-1',
    expectedActiveRequirementRevisionId: null,
    requirementId: null,
    newRequirementId: 'req-1',
    newRevisionId: 'reqrev-1',
    newCheckId: 'check-base-1',
    newConfigRevisionId: 'rev-cfg-1',
    source: REQUIREMENT_SOURCE,
    confirmedText: TASKBOOK_TEXT,
    lowerText: '0.1000',
    upperText: '0.3000',
    chainRef: { projectId: SAMPLE_PROJECT_ID, kind: 'project-dimension-chain' },
    confirmed: true,
    changeReason: '',
    confirmedAt: '2026-11-09T09:00:00.000Z',
  }
}

function expectFailure(
  result: Awaited<ReturnType<typeof confirmOrUpdateRequirement>>,
  code: string,
): void {
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.code).toBe(code)
}

describe('V3.5 条款确认：首版与不可变版本', () => {
  it('首版记录完整来源/原文/上下限/绑定依据，并产生基线检查', async () => {
    const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    const result = await confirmOrUpdateRequirement(baseInput(snapshot))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { revision, baselineCheck, snapshot: candidate, fileRevision, event } = result.value

    expect(revision.requirementId).toBe('req-1')
    expect(revision.revisionId).toBe('reqrev-1')
    expect(revision.parentRevisionId).toBeNull()
    expect(revision.projectId).toBe(SAMPLE_PROJECT_ID)
    expect(revision.chainRef).toEqual({
      projectId: SAMPLE_PROJECT_ID,
      kind: 'project-dimension-chain',
    })
    expect(revision.source).toMatchObject({
      documentId: 'doc-1',
      revisionId: 'sr-1',
      blobKey: 'blob-1',
      page: 2,
      rectPdf: [10, 10, 110, 30],
      pageBoxPdf: [0, 0, 595, 842],
    })
    expect(revision.source.sha256).toBe(snapshot.revisions[0]!.sha256)
    expect(revision.confirmedText).toBe(TASKBOOK_TEXT)
    expect(revision.confirmedAgainstLatestRevisionId).toBe('sr-1')
    expect(revision.ruleType).toBe('closed-interval-mm')
    expect(revision.lowerQ).toBe(1000)
    expect(revision.upperQ).toBe(3000)
    expect(revision.changeReason).toBe('建立条款')
    expect(revision.bindingBasis.bindings).toEqual([
      {
        bindingId: 'binding:spacer-length',
        termId: 't-s',
        parameterId: 'param:spacer:length',
      },
    ])

    expect(baselineCheck.provenance).toBe('committed')
    expect(baselineCheck.status).toBe('satisfied')
    expect(baselineCheck.basis).toEqual({
      kind: 'project-revision',
      projectRevisionId: 'rev-cfg-1',
      parentRevisionId: 'rev-a1',
    })
    expect(baselineCheck.resultInterval).toEqual({ minQ: 1500, maxQ: 2500 })

    expect(candidate.project.activeRequirementRevisionId).toBe('reqrev-1')
    expect(candidate.project.requirementRevisions).toHaveLength(1)
    expect(candidate.project.currentRequirementCheck?.checkId).toBe('check-base-1')
    expect(candidate.project.currentRevisionId).toBe('rev-cfg-1')
    expect(fileRevision.evidence?.requirementRevisionId).toBe('reqrev-1')
    expect(fileRevision.evidence?.checkId).toBe('check-base-1')
    expect(event.type).toBe('requirement_confirmed')
    expect(event.lowerQ).toBe(1000)
    expect(event.checkStatus).toBe('satisfied')
    // 配置事务不写工程参数草稿。
    expect(candidate.project.parameters).toEqual(snapshot.project.parameters)
  })

  it('基线不满足可以登记证据，但状态保持不满足（不伪造通过）', async () => {
    const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    const result = await confirmOrUpdateRequirement({
      ...baseInput(snapshot),
      lowerText: '0.1000',
      upperText: '0.1001',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.baselineCheck.status).toBe('unsatisfied')
    expect(result.value.baselineCheck.reasonCodes).toContain('UPPER_VIOLATED')
    expect(result.value.snapshot.project.activeRequirementRevisionId).toBe('reqrev-1')
  })

  it('缺少显式确认动作即拒绝', async () => {
    const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    expectFailure(
      await confirmOrUpdateRequirement({ ...baseInput(snapshot), confirmed: false }),
      'CONFIRMATION_REQUIRED',
    )
  })
})

describe('V3.5 条款确认：输入契约（空/格式/精度/逆序）', () => {
  it('原因为空拒绝', async () => {
    const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    expectFailure(
      await confirmOrUpdateRequirement({ ...baseInput(snapshot), confirmedText: '   ' }),
      'INVALID_REQUIREMENT_INPUT',
    )
  })

  it('上下限为空/格式/超精度/逆序分别给出明确 reasonCodes', async () => {
    const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    const cases = [
      { lowerText: '', upperText: '0.3000', reason: 'empty' },
      { lowerText: '12mm', upperText: '0.3000', reason: 'format' },
      { lowerText: '0.10001', upperText: '0.3000', reason: 'precision' },
      { lowerText: '99999999', upperText: '0.3000', reason: 'range' },
      { lowerText: '0.3000', upperText: '0.1000', reason: 'reversed_bounds' },
    ]
    for (const item of cases) {
      const result = await confirmOrUpdateRequirement({
        ...baseInput(snapshot),
        lowerText: item.lowerText,
        upperText: item.upperText,
      })
      expect(result.ok, item.reason).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_REQUIREMENT_INPUT')
        expect(result.error.reasonCodes).toContain(item.reason)
      }
    }
  })

  it('链引用不是当前项目固定链时拒绝', async () => {
    const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    expectFailure(
      await confirmOrUpdateRequirement({
        ...baseInput(snapshot),
        chainRef: { projectId: 'other-project', kind: 'project-dimension-chain' },
      }),
      'INVALID_CHAIN_REF',
    )
  })
})

describe('V3.5 条款确认：来源、页码与选区', () => {
  it('文档/版本不存在或跨项目 → SOURCE_NOT_FOUND', async () => {
    const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    expectFailure(
      await confirmOrUpdateRequirement({
        ...baseInput(snapshot),
        source: { ...REQUIREMENT_SOURCE, documentId: 'doc-missing' },
      }),
      'SOURCE_NOT_FOUND',
    )
    expectFailure(
      await confirmOrUpdateRequirement({
        ...baseInput(snapshot),
        source: { ...REQUIREMENT_SOURCE, revisionId: 'sr-missing' },
      }),
      'SOURCE_NOT_FOUND',
    )
  })

  it('PDF 哈希与版本记录不一致 → HASH_MISMATCH', async () => {
    const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    const broken: ProjectFileSnapshot = {
      ...snapshot,
      blobs: snapshot.blobs.map((blob) => ({ ...blob, sha256: 'b'.repeat(64) })),
    }
    expectFailure(await confirmOrUpdateRequirement(baseInput(broken)), 'HASH_MISMATCH')
  })

  it('PDF 字节不可读 → SOURCE_UNREADABLE', async () => {
    const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    const broken: ProjectFileSnapshot = {
      ...snapshot,
      attachments: [],
      missingAttachments: [
        { revisionId: 'sr-1', documentId: 'doc-1', blobKey: 'blob-1', reason: 'declared-missing' },
      ],
    }
    expectFailure(await confirmOrUpdateRequirement(baseInput(broken)), 'SOURCE_UNREADABLE')
  })

  it('页码越界与非法选区分别拒绝', async () => {
    const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    expectFailure(
      await confirmOrUpdateRequirement({
        ...baseInput(snapshot),
        source: { ...REQUIREMENT_SOURCE, page: 3 },
      }),
      'PAGE_OUT_OF_RANGE',
    )
    expectFailure(
      await confirmOrUpdateRequirement({
        ...baseInput(snapshot),
        source: { ...REQUIREMENT_SOURCE, rectPdf: [500, 10, 700, 30] },
      }),
      'INVALID_REGION',
    )
  })

  it('基准或活动条款变化 → STALE_BASE / STALE_REQUIREMENT', async () => {
    const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    expectFailure(
      await confirmOrUpdateRequirement({ ...baseInput(snapshot), expectedBaseToken: 'old' }),
      'STALE_BASE',
    )
    const confirmed = await createRequirementProject()
    expectFailure(
      await confirmOrUpdateRequirement({
        ...baseInput(confirmed.snapshot),
        expectedBaseToken: 'base-1',
        currentBaseToken: 'base-1',
        expectedActiveRequirementRevisionId: null,
        requirementId: 'req-1',
        newRevisionId: 'reqrev-2',
      }),
      'STALE_REQUIREMENT',
    )
  })
})

describe('V3.5 条款更新：新建不可变版本、单条限制', () => {
  it('第二条活动条款被明确拒绝，不静默覆盖/并存', async () => {
    const project = await createRequirementProject()
    expectFailure(
      await confirmOrUpdateRequirement({
        ...baseInput(project.snapshot),
        expectedActiveRequirementRevisionId: 'reqrev-1',
        requirementId: null,
        newRequirementId: 'req-2',
        newRevisionId: 'reqrev-2',
        newConfigRevisionId: 'rev-cfg-2',
      }),
      'REQUIREMENT_LIMIT_EXCEEDED',
    )
  })

  it('更新生成新版本：parent 指向旧版，旧版原样保留；必须填原因', async () => {
    const project = await createRequirementProject()
    const snapshot = project.snapshot
    const updateBase: ConfirmRequirementInput = {
      ...baseInput(snapshot),
      expectedActiveRequirementRevisionId: 'reqrev-1',
      requirementId: 'req-1',
      newRevisionId: 'reqrev-2',
      newCheckId: 'check-base-2',
      newConfigRevisionId: 'rev-cfg-2',
      confirmedAt: '2026-11-09T12:00:00.000Z',
    }
    expectFailure(
      await confirmOrUpdateRequirement({ ...updateBase, changeReason: '   ' }),
      'INVALID_REQUIREMENT_INPUT',
    )

    const updated = await confirmOrUpdateRequirement({
      ...updateBase,
      upperText: '0.3100',
      changeReason: '客户更新任务书上限',
    })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    const { revision, snapshot: candidate } = updated.value
    expect(revision.revisionId).toBe('reqrev-2')
    expect(revision.parentRevisionId).toBe('reqrev-1')
    expect(revision.requirementId).toBe('req-1')
    expect(revision.upperQ).toBe(3100)
    expect(revision.changeReason).toBe('客户更新任务书上限')
    expect(candidate.project.requirementRevisions.map((item) => item.revisionId)).toEqual([
      'reqrev-1',
      'reqrev-2',
    ])
    // 旧版本字段完全不变。
    expect(candidate.project.requirementRevisions[0]).toEqual(
      snapshot.project.requirementRevisions[0],
    )
    // 旧条款仍指向旧 PDF 版本与旧选区。
    expect(candidate.project.requirementRevisions[0]!.source.revisionId).toBe('sr-1')
    expect(activeRequirement(candidate).revisionId).toBe('reqrev-2')
  })
})
