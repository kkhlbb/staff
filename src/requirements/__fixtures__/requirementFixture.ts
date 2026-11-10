/**
 * V3.5 Beta 测试夹具：P35-A（条款 0.1000～0.3000）与可覆盖的原项目 target。
 *
 * 工程输入沿用既有 chain-demo（H=52.20±0.02，B1/B2=20.00±0.01，S=长度±0.01），
 * 不复制任何计算公式；条款通过真实的 confirmOrUpdateRequirement 建立，
 * 保证测试走与产品相同的校验/版本化路径。
 */
import type { ProjectFileSnapshot } from '../../project-file/types'
import { createSpacerSnapshot, spacerParameters } from '../../project-file/__fixtures__/spacerProjectFile'
import { SAMPLE_PROJECT_ID } from '../../project-file/__fixtures__/sampleProjectFile'
import { parameterBindingLinks } from '../../revisions/digest'
import type { RequirementDraftInput } from '../fingerprint'
import type { RequirementEditDraft, RequirementRevision } from '../types'
import { confirmOrUpdateRequirement, type ConfirmRequirementValue } from '../confirm'

export const TASKBOOK_TEXT = '轴向装配间隙 C 应为 0.1000～0.3000 mm，含两端'
export const REQUIREMENT_SOURCE = {
  documentId: 'doc-1',
  revisionId: 'sr-1',
  page: 2,
  rectPdf: [10, 10, 110, 30] as [number, number, number, number],
  pageBoxPdf: [0, 0, 595, 842] as [number, number, number, number],
}

export interface RequirementProjectOptions {
  length?: string
  lower?: string
  upper?: string
  /** 原项目 target；undefined 表示沿用示例的 0.1000～0.3000。 */
  target?: { minQ: number; maxQ: number } | null
  confirmedBinding?: boolean
}

export async function createRequirementProject(
  options: RequirementProjectOptions = {},
): Promise<ConfirmRequirementValue> {
  let snapshot = await createSpacerSnapshot({
    length: options.length ?? '12.00',
    confirmed: options.confirmedBinding ?? true,
  })
  if (options.target !== undefined) {
    snapshot = {
      ...snapshot,
      project: {
        ...snapshot.project,
        dimensionChain: {
          ...snapshot.project.dimensionChain,
          target: options.target,
        },
      },
    }
    snapshot = {
      ...snapshot,
      fileRevisions: snapshot.fileRevisions.map((revision) => ({
        ...revision,
        project: snapshot.project,
      })),
    }
  }
  const confirmed = await confirmOrUpdateRequirement({
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
    lowerText: options.lower ?? '0.1000',
    upperText: options.upper ?? '0.3000',
    chainRef: { projectId: SAMPLE_PROJECT_ID, kind: 'project-dimension-chain' },
    confirmed: true,
    changeReason: '',
    confirmedAt: '2026-11-09T09:00:00.000Z',
  })
  if (!confirmed.ok) {
    throw new Error(`建立条款失败：${confirmed.error.code}: ${confirmed.error.message}`)
  }
  return confirmed.value
}

/** 构造一个只改 S 长度的 D 草稿。 */
export function draftWithLength(
  snapshot: ProjectFileSnapshot,
  length: string,
  identity: { draftId?: string; draftRevision?: number } = {},
): RequirementDraftInput {
  const parameters = spacerParameters({ length }, 2)
  return {
    draftId: identity.draftId ?? 'draft-1',
    draftRevision: identity.draftRevision ?? 1,
    parameters,
    bindings: parameterBindingLinks(snapshot).map((link) => ({ ...link })),
  }
}

export function activeRequirement(snapshot: ProjectFileSnapshot): RequirementRevision {
  const id = snapshot.project.activeRequirementRevisionId
  const revision =
    id === null
      ? undefined
      : snapshot.project.requirementRevisions.find((item) => item.revisionId === id)
  if (revision === undefined) throw new Error('夹具缺少活动条款')
  return revision
}

export function pendingEditOf(revision: RequirementRevision): RequirementEditDraft {
  return {
    requirementId: revision.requirementId,
    editRevision: 1,
    confirmedText: revision.confirmedText,
    lowerText: '0.1100',
    upperText: '0.3100',
    source: {
      documentId: revision.source.documentId,
      revisionId: revision.source.revisionId,
      page: revision.source.page,
      rectPdf: revision.source.rectPdf,
      pageBoxPdf: revision.source.pageBoxPdf,
    },
  }
}
