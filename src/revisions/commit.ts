/**
 * 构造一次确认的完整候选（纯函数，不写磁盘/不碰会话）。
 *
 * 候选包含任务卡 §5.1 的全部不可拆分写集合：
 * 参数 + 图纸引用 + 尺寸链 + 绑定 + 确认/修改事件 + 冻结分析快照 + 新 Revision
 * + currentRevisionId。调用方（main）必须把候选整体交给一次原子保存；
 * 任何一步失败都不得发布其中一部分。
 */
import { calculateChain, ENGINE_VERSION } from '../domain/calculate'
import { compareChains } from '../domain/compare'
import type { ChainResult } from '../domain/types'
import type { ChangeEvent, ChangeEventType } from '../history/events'
import type {
  AnalysisSnapshot,
  SnapshotBindingEntry,
  SnapshotSourceManifest,
} from '../history/snapshots'
import { REVIEW_RULES_VERSION, evaluateReviewChecklist } from '../review/rules'
import { isRelationConfirmed } from '../workspace/relation'
import { chainToDraft } from '../workspace/draft'
import type {
  ProjectFileParameterBindingLink,
  ProjectFileRevision,
  ProjectFileRevisionEvidence,
  ProjectFileSnapshot,
} from '../project-file/types'
import { stableFingerprint } from './canonical'
import { nextRelationRevision } from './compute'
import type { ChangeComputation } from './types'

export interface CommitOptions {
  revisionId: string
  analysisSnapshotId: string
  createdAt: string
  reason: string
  /** 恢复旧版时指向来源版本；普通确认/绑定提交为 null。 */
  restoredFromRevisionId: string | null
  /** 恢复来源的旧版确认不继承：true 时即使值未变也不产生“有效确认”凭据。 */
  reauthenticateBindings: boolean
}

export interface CommitCandidate {
  snapshot: ProjectFileSnapshot
  revision: ProjectFileRevision
  analysisSnapshot: AnalysisSnapshot
  events: ChangeEvent[]
}

function eventId(type: ChangeEventType, revisionId: string, subject: string): string {
  return `${type}:${revisionId}:${subject}`
}

function bindingMap(links: readonly ProjectFileParameterBindingLink[]): Map<string, ProjectFileParameterBindingLink> {
  return new Map(links.map((link) => [link.bindingId, link]))
}

function buildEvents(
  base: ProjectFileSnapshot,
  computation: ChangeComputation,
  options: CommitOptions,
): ChangeEvent[] {
  const projectId = base.project.id
  const events: ChangeEvent[] = []
  const baseBindings = bindingMap(
    base.project.dimensionLinks.filter(
      (link): link is ProjectFileParameterBindingLink => link.kind === 'parameter-binding',
    ),
  )
  const nextBindings = bindingMap(computation.bindings)

  for (const row of computation.parameterDiffs) {
    if (!row.valueChanged && !row.displayChanged && !row.sourceNoteChanged) continue
    events.push({
      id: eventId('parameter_changed', options.revisionId, row.parameterId),
      projectId,
      type: 'parameter_changed',
      createdAt: options.createdAt,
      parameterId: row.parameterId,
      before: row.beforeQ === null ? '未记录' : String(row.beforeQ),
      after: String(row.afterQ),
      reason: options.reason,
      message: row.valueChanged
        ? `${row.key}：${row.beforeQ ?? '无'}q → ${row.afterQ}q`
        : `${row.key}：工程值未变，仅显示/来源元数据变化`,
      scope: 'nominal-only',
    })
  }

  for (const [bindingId, link] of nextBindings) {
    if (!baseBindings.has(bindingId)) {
      events.push({
        id: eventId('parameter_binding_added', options.revisionId, bindingId),
        projectId,
        type: 'parameter_binding_added',
        createdAt: options.createdAt,
        bindingId,
        termId: link.termId,
        parameterId: link.parameterId,
        reason: options.reason,
        scope: 'nominal-only',
        message: '参数绑定：只同步 nominal，不改偏差/方向/目标。',
      })
    }
  }
  for (const [bindingId, link] of baseBindings) {
    if (!nextBindings.has(bindingId)) {
      events.push({
        id: eventId('parameter_binding_removed', options.revisionId, bindingId),
        projectId,
        type: 'parameter_binding_removed',
        createdAt: options.createdAt,
        bindingId,
        termId: link.termId,
        parameterId: link.parameterId,
        reason: options.reason,
        message: '解除参数绑定：环现值/来源/历史保留，不反向改参数。',
      })
    }
  }

  for (const credential of computation.credentials) {
    events.push({
      id: eventId('parameter_binding_confirmed', options.revisionId, credential.bindingId),
      projectId,
      type: 'parameter_binding_confirmed',
      createdAt: options.createdAt,
      bindingId: credential.bindingId,
      parameterId: credential.parameterId,
      termId: credential.termId,
      parameterRevision: credential.parameterRevision,
      termRevision: credential.termRevision,
      drawingId: credential.drawingId,
      drawingFingerprint: credential.drawingFingerprint,
      sourceBasis: credential.sourceBasis,
      revisionIdAtCommit: options.revisionId,
      reason: options.reason,
      scope: 'nominal-only',
      message: `确认参数 ${credential.parameterId} 与环 ${credential.termId} 的 nominal 同步。`,
    })
  }

  events.push({
    id: eventId('project_revision_committed', options.revisionId, options.revisionId),
    projectId,
    type: 'project_revision_committed',
    createdAt: options.createdAt,
    reason: options.reason,
    revisionIdAtCommit: options.revisionId,
    message: options.restoredFromRevisionId === null
      ? '参数变更确认提交。'
      : `从版本 ${options.restoredFromRevisionId} 恢复生成新版本。`,
  })

  if (options.restoredFromRevisionId !== null) {
    events.push({
      id: eventId('project_restored_from_revision', options.revisionId, options.revisionId),
      projectId,
      type: 'project_restored_from_revision',
      createdAt: options.createdAt,
      before: options.restoredFromRevisionId,
      after: options.revisionId,
      reason: options.reason,
      message: '恢复生成新草稿/新版本；旧版确认不继承，按外部导入语义重新确认。',
    })
  }

  return events
}

function buildSourceManifest(
  base: ProjectFileSnapshot,
  reviewFindings: ReturnType<typeof evaluateReviewChecklist>['findings'],
  availableBlobKeys: ReadonlySet<string>,
): SnapshotSourceManifest {
  const termById = new Map(base.project.dimensionChain.terms.map((term) => [term.id, term]))
  const documentById = new Map(base.documents.map((document) => [document.id, document]))
  const revisionById = new Map(base.revisions.map((revision) => [revision.id, revision]))
  const termRevisionById = new Map(
    base.project.dimensionChain.terms.map((term) => [term.id, term.termRevision]),
  )
  const bindingEntries: SnapshotBindingEntry[] = base.bindings.map((binding) => {
    const statusOf = (ruleId: string) => {
      const finding = reviewFindings.find(
        (item) => item.ruleId === ruleId && item.subject.bindingId === binding.id,
      )
      return finding?.status ?? 'unchecked'
    }
    const document = documentById.get(binding.documentId) ?? null
    const revision = revisionById.get(binding.revisionId) ?? null
    const term = termById.get(binding.termId) ?? null
    return {
      bindingId: binding.id,
      termId: binding.termId,
      termLabel: term === null ? null : `${term.symbol} · ${term.name}`,
      termRevision: termRevisionById.get(binding.termId) ?? null,
      documentId: binding.documentId,
      documentTitle: document?.title ?? null,
      revisionId: binding.revisionId,
      fileName: revision?.fileName ?? null,
      revisionSha256: revision?.sha256 ?? null,
      revisionByteSize: revision?.byteSize ?? null,
      revisionPageCount: revision?.pageCount ?? null,
      page: binding.page,
      rectPdf: binding.rectPdf,
      pageBoxPdf: binding.pageBoxPdf,
      note: binding.note,
      reviewedTermRevision: binding.reviewedTermRevision,
      reviewedAt: binding.reviewedAt,
      historicalAcceptance: binding.historicalAcceptance,
      blobAvailable: availableBlobKeys.has(revision?.blobKey ?? ''),
      status: {
        available: statusOf('SOURCE_AVAILABLE'),
        current: statusOf('SOURCE_CURRENT'),
        valueReviewed: statusOf('SOURCE_VALUE_REVIEWED'),
      },
    }
  })
  const boundTermIds = new Set(base.bindings.map((binding) => binding.termId))
  return {
    documents: base.documents.map((document) => ({ ...document })),
    revisions: base.revisions.map((revision) => ({ ...revision })),
    bindings: bindingEntries,
    unboundTermIds: base.project.dimensionChain.terms
      .filter((term) => !boundTermIds.has(term.id))
      .map((term) => term.id),
    availability: bindingEntries.every((entry) => entry.blobAvailable) ? 'complete' : 'partial',
  }
}

export function buildCommitCandidate(
  base: ProjectFileSnapshot,
  computation: ChangeComputation,
  options: CommitOptions,
): CommitCandidate {
  const availableBlobKeys = new Set(base.attachments.map((item) => item.blobKey))
  const nextRevision = nextRelationRevision(base, computation)
  const relationConfirmed = isRelationConfirmed(computation.chain, {
    relationRevision: nextRevision,
    relationReview: base.project.relationReview,
  })
  const review = evaluateReviewChecklist({
    chain: computation.chain,
    result: computation.result,
    relationConfirmed,
    relationReviewStale: base.project.relationReview !== null && !relationConfirmed,
    relationRevision: nextRevision,
    terms: computation.chain.terms.map((term) => ({
      id: term.id,
      symbol: term.symbol,
      name: term.name,
      termRevision: term.termRevision,
    })),
    bindings: base.bindings,
    documents: base.documents,
    revisions: base.revisions,
    availableBlobKeys,
    engineVersion: base.project.engineVersion,
  })
  const sourceManifest = buildSourceManifest(base, review.findings, availableBlobKeys)
  const draft = chainToDraft(computation.chain)
  draft.relationRevision = nextRelationRevision(base, computation)

  const comparison =
    base.project.baseline === null
      ? null
      : {
          baselineResult: reviewBaseline(base.project.baseline.definition),
          diff: compareChains(base.project.baseline.definition, computation.chain),
        }

  const analysisSnapshot: AnalysisSnapshot = {
    id: options.analysisSnapshotId,
    projectId: base.project.id,
    projectName: base.project.name,
    createdAt: options.createdAt,
    engineVersion: ENGINE_VERSION,
    reviewRulesVersion: REVIEW_RULES_VERSION,
    inputFingerprint: stableFingerprint({
      chain: computation.chain,
      parameters: computation.parameters,
      bindings: computation.bindings,
      drawing: computation.drawing.record.dataFingerprint,
      sources: stableFingerprint({
        documents: base.documents,
        revisions: base.revisions,
        bindings: base.bindings,
      }),
    }),
    definition: computation.chain,
    draft,
    result: computation.result,
    review,
    sourceManifest,
    baseline: base.project.baseline,
    comparison,
    status: review.reviewComplete ? 'complete' : 'pending',
    pendingCount: review.pending.length,
  }

  const events = buildEvents(base, computation, options)

  const nextProject = {
    ...base.project,
    schemaVersion: 6 as const,
    currentRevisionId: options.revisionId,
    dimensionChain: computation.chain,
    relationRevision: nextRelationRevision(base, computation),
    parameters: computation.parameters.map((parameter) => ({ ...parameter })),
    drawings: [{ ...computation.drawing.record }],
    dimensionLinks: mergeBindings(base, computation.bindings),
    updatedAt: options.createdAt,
  }

  const evidence: ProjectFileRevisionEvidence = {
    analysisSnapshotId: analysisSnapshot.id,
    eventIds: events.map((event) => event.id),
    sourceManifest: {
      documents: base.documents.map((document) => ({
        documentId: document.id,
        latestRevisionId: document.latestRevisionId,
      })),
      revisions: base.revisions.map((revision) => ({
        revisionId: revision.id,
        documentId: revision.documentId,
        sha256: revision.sha256,
      })),
      bindings: base.bindings.map((binding) => ({
        bindingId: binding.id,
        revisionId: binding.revisionId,
        reviewedTermRevision: binding.reviewedTermRevision,
      })),
      missingBlobKeys: base.missingAttachments.map((item) => item.blobKey),
    },
    restoredFromRevisionId: options.restoredFromRevisionId,
  }

  const revision: ProjectFileRevision = {
    revisionId: options.revisionId,
    parentId: base.project.currentRevisionId,
    createdAt: options.createdAt,
    reason: options.reason,
    project: nextProject,
    evidence,
  }

  return {
    snapshot: {
      ...base,
      project: nextProject,
      events: [...base.events, ...events],
      analysisSnapshots: [...base.analysisSnapshots, analysisSnapshot],
      fileRevisions: [...base.fileRevisions, revision],
    },
    revision,
    analysisSnapshot,
    events,
  }
}

function mergeBindings(
  base: ProjectFileSnapshot,
  next: readonly ProjectFileParameterBindingLink[],
) {
  const visual = base.project.dimensionLinks.filter((link) => link.kind === 'visual-reference')
  return [...visual, ...next.map((link) => ({ ...link }))]
}

/** 基线结果只用既有 V2 计算函数；不在此重复公式。 */
function reviewBaseline(definition: import('../domain/types').ChainDefinition): ChainResult {
  return calculateChain(definition)
}
