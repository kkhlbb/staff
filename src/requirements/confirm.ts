/**
 * V3.5 Beta：条款确认/更新（领域操作 1，可独立调用）。
 *
 * 语义边界（任务卡 §2.1/§6.1）：
 * - 已确认条款不可变：任何原文/来源/选区/上下限变化都新建 revisionId；
 * - Beta 一条链最多一个活动 requirementId，试图绑第二条返回
 *   REQUIREMENT_LIMIT_EXCEEDED，不静默覆盖或并存；
 * - 原文必须由用户粘贴并显式确认，不能由数值输入反拼；
 * - 首次确认同时重算当前正式基线并登记基线检查（可为不满足/待确认），
 *   但绝不借此提交参数草稿。
 */
import type { ChainDefinition } from '../domain/types'
import { formatMm, tryParseMm } from '../domain/units'
import type { ChangeEvent } from '../history/events'
import type {
  ProjectFileRevision,
  ProjectFileRevisionEvidence,
  ProjectFileSnapshot,
} from '../project-file/types'
import { validateBindingRegion } from '../project-file/validation'
import { canonicalJson, stableFingerprint } from '../revisions/canonical'
import {
  buildBindingBasis,
  computeCandidateRequirementCheck,
  type RequirementCheckErrorCode,
} from './check'
import {
  isPdfRequirementSource,
  type PdfRequirementSource,
} from './types'
import type {
  RequirementCheck,
  RequirementChainRef,
  RequirementRevision,
} from './types'

export type RequirementErrorCode =
  | 'INVALID_REQUIREMENT_INPUT'
  | 'UNSUPPORTED_RULE'
  | 'INVALID_CHAIN_REF'
  | 'INVALID_REGION'
  | 'PAGE_OUT_OF_RANGE'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_UNREADABLE'
  | 'HASH_MISMATCH'
  | 'REQUIREMENT_LIMIT_EXCEEDED'
  | 'STALE_BASE'
  | 'STALE_REQUIREMENT'
  | 'CONFIRMATION_REQUIRED'
  | RequirementCheckErrorCode

export interface RequirementFailure<C extends string = RequirementErrorCode> {
  code: C
  message: string
  reasonCodes?: string[]
  detail?: string
}

export type RequirementResult<T, C extends string = RequirementErrorCode> =
  | { ok: true; value: T }
  | { ok: false; error: RequirementFailure<C> }

export interface ConfirmRequirementInput {
  /** 权威项目聚合（main 已校验字节与归属）。 */
  snapshot: ProjectFileSnapshot
  expectedBaseToken: string
  currentBaseToken: string
  expectedActiveRequirementRevisionId: string | null
  /** 更新既有条款时为原 requirementId；首版 null。 */
  requirementId: string | null
  /** 服务端分配的新身份（首版使用；更新时忽略）。 */
  newRequirementId: string
  newRevisionId: string
  newCheckId: string
  /** 配置版本候选的 ProjectFileRevision ID。 */
  newConfigRevisionId: string
  source: {
    documentId: string
    revisionId: string
    page: number
    rectPdf: readonly [number, number, number, number]
    pageBoxPdf: readonly [number, number, number, number]
  }
  confirmedText: string
  lowerText: string
  upperText: string
  chainRef: RequirementChainRef
  /** 显式确认动作；false 一律拒绝，不创建“未确认的已确认版本”。 */
  confirmed: boolean
  /** 更新时必填；首版留空记“建立条款”。 */
  changeReason: string
  confirmedAt: string
}

export interface ConfirmRequirementValue {
  revision: RequirementRevision
  baselineCheck: RequirementCheck
  /** 配置版本候选（含新条款、活动指针、基线检查；未写盘）。 */
  snapshot: ProjectFileSnapshot
  fileRevision: ProjectFileRevision
  event: ChangeEvent
}

function fail(
  code: RequirementErrorCode,
  message: string,
  extra: { reasonCodes?: string[]; detail?: string } = {},
): RequirementResult<never> {
  return { ok: false, error: { code, message, ...extra } }
}

function sourceManifestOf(snapshot: ProjectFileSnapshot): ProjectFileRevisionEvidence['sourceManifest'] {
  return {
    documents: snapshot.documents.map((document) => ({
      documentId: document.id,
      latestRevisionId: document.latestRevisionId,
    })),
    revisions: snapshot.revisions.map((revision) => ({
      revisionId: revision.id,
      documentId: revision.documentId,
      sha256: revision.sha256,
    })),
    bindings: snapshot.bindings.map((binding) => ({
      bindingId: binding.id,
      revisionId: binding.revisionId,
      reviewedTermRevision: binding.reviewedTermRevision,
    })),
    missingBlobKeys: snapshot.missingAttachments.map((item) => item.blobKey),
  }
}

/**
 * 校验并构造新的条款版本与基线检查；纯函数，不写磁盘、不改入参。
 */
export async function confirmOrUpdateRequirement(
  input: ConfirmRequirementInput,
): Promise<RequirementResult<ConfirmRequirementValue>> {
  const { snapshot } = input

  if (input.confirmed !== true) {
    return fail('CONFIRMATION_REQUIRED', '必须显式确认条款后才能创建版本；未确认表单只属于草稿。')
  }
  if (
    input.chainRef.kind !== 'project-dimension-chain' ||
    input.chainRef.projectId !== snapshot.project.id
  ) {
    return fail('INVALID_CHAIN_REF', '条款链引用必须是当前项目的固定轴向链。')
  }
  if (input.expectedBaseToken !== input.currentBaseToken) {
    return fail('STALE_BASE', '项目基准已变化，旧条款确认请求已拒绝。')
  }

  const activeId = snapshot.project.activeRequirementRevisionId
  const activeRevision =
    activeId === null
      ? null
      : (snapshot.project.requirementRevisions.find((item) => item.revisionId === activeId) ??
        null)
  const activeRequirementId = activeRevision?.requirementId ?? null
  if (input.expectedActiveRequirementRevisionId !== activeId) {
    return fail(
      'STALE_REQUIREMENT',
      '活动条款已变化，请重新打开条款后确认。',
      { detail: `expected=${String(input.expectedActiveRequirementRevisionId)}，current=${String(activeId)}` },
    )
  }
  if (activeId === null) {
    if (input.requirementId !== null) {
      return fail('STALE_REQUIREMENT', '要更新的条款不存在（项目当前没有活动条款）。')
    }
  } else if (input.requirementId === null || input.requirementId !== activeRequirementId) {
    // Beta 只允许一条活动条款；不允许新增第二条或静默改写既有条款身份。
    return fail(
      'REQUIREMENT_LIMIT_EXCEEDED',
      '当前尺寸链已有活动条款；Beta 只允许一条，更新请基于原条款新建版本。',
      { detail: `active=${activeId}，requirementId=${String(activeRequirementId)}` },
    )
  }

  // ---- 输入文本与上下限 ------------------------------------------------
  const confirmedText = input.confirmedText.trim()
  if (confirmedText === '') {
    return fail('INVALID_REQUIREMENT_INPUT', '请粘贴并确认任务书原文。', {
      reasonCodes: ['empty'],
    })
  }
  const lower = tryParseMm(input.lowerText)
  if (!lower.ok) {
    return fail('INVALID_REQUIREMENT_INPUT', `下限无效：${lower.message}`, {
      reasonCodes: [lower.code],
    })
  }
  const upper = tryParseMm(input.upperText)
  if (!upper.ok) {
    return fail('INVALID_REQUIREMENT_INPUT', `上限无效：${upper.message}`, {
      reasonCodes: [upper.code],
    })
  }
  if (lower.value > upper.value) {
    return fail('INVALID_REQUIREMENT_INPUT', '下限不能大于上限。', {
      reasonCodes: ['reversed_bounds'],
      detail: `${formatMm(lower.value)} > ${formatMm(upper.value)}`,
    })
  }

  const reason = input.changeReason.trim()
  if (activeId !== null && reason === '') {
    return fail('INVALID_REQUIREMENT_INPUT', '更新条款必须填写更新原因。', {
      reasonCodes: ['missing_change_reason'],
    })
  }

  // ---- 来源归属/字节/页码/选区 ----------------------------------------
  const document = snapshot.documents.find((item) => item.id === input.source.documentId)
  if (document === undefined || document.projectId !== snapshot.project.id) {
    return fail('SOURCE_NOT_FOUND', '条款引用的任务书文档不存在或不属于当前项目。')
  }
  const revision = snapshot.revisions.find((item) => item.id === input.source.revisionId)
  if (
    revision === undefined ||
    revision.projectId !== snapshot.project.id ||
    revision.documentId !== document.id
  ) {
    return fail('SOURCE_NOT_FOUND', '条款引用的任务书版本不存在或不属于该文档。')
  }
  const blob = snapshot.blobs.find((item) => item.blobKey === revision.blobKey)
  if (blob === undefined) {
    return fail('SOURCE_UNREADABLE', '条款引用的 PDF 缺少 blob 元数据，无法定位原文。')
  }
  if (blob.sha256 !== revision.sha256 || blob.byteSize !== revision.byteSize) {
    return fail('HASH_MISMATCH', 'PDF 字节大小或哈希与版本记录不一致。')
  }
  const missing = snapshot.missingAttachments.some(
    (item) => item.blobKey === revision.blobKey,
  )
  const readable = snapshot.attachments.some((item) => item.blobKey === revision.blobKey)
  if (missing || !readable) {
    return fail('SOURCE_UNREADABLE', '条款引用的 PDF 字节不可读，不能确认来源。')
  }
  if (!Number.isInteger(input.source.page) || input.source.page < 1 || input.source.page > revision.pageCount) {
    return fail('PAGE_OUT_OF_RANGE', '选择页码超出该 PDF 的页数。', {
      detail: `page=${String(input.source.page)}，pageCount=${revision.pageCount}`,
    })
  }
  const regionError = validateBindingRegion(input.source.pageBoxPdf, input.source.rectPdf)
  if (regionError !== null) {
    return fail('INVALID_REGION', `选区不合法：${regionError}`)
  }

  const source: PdfRequirementSource = {
    kind: 'pdf',
    documentId: document.id,
    revisionId: revision.id,
    sha256: revision.sha256,
    blobKey: revision.blobKey,
    page: input.source.page,
    rectPdf: [...input.source.rectPdf] as PdfRequirementSource['rectPdf'],
    pageBoxPdf: [...input.source.pageBoxPdf] as PdfRequirementSource['pageBoxPdf'],
  }

  const requirementId = activeRequirementId ?? input.newRequirementId
  const parentRevisionId = activeId
    ? (snapshot.project.requirementRevisions.find((item) => item.revisionId === activeId)
        ?.revisionId ?? null)
    : null
  const revisionRecord: RequirementRevision = {
    requirementId,
    revisionId: input.newRevisionId,
    parentRevisionId,
    projectId: snapshot.project.id,
    chainRef: { projectId: snapshot.project.id, kind: 'project-dimension-chain' },
    source,
    confirmedText,
    confirmedAt: input.confirmedAt,
    confirmedAgainstLatestRevisionId: document.latestRevisionId,
    ruleType: 'closed-interval-mm',
    lowerQ: lower.value,
    upperQ: upper.value,
    changeReason: activeId === null ? reason || '建立条款' : reason,
    bindingBasis: buildBindingBasis(snapshot),
  }

  const requirementRevisions = [...snapshot.project.requirementRevisions, revisionRecord]

  // ---- 基线检查（复用同一判定函数） -----------------------------------
  const baseline = await computeCandidateRequirementCheck({
    snapshot,
    requirementRevisions,
    activeRequirementRevisionId: revisionRecord.revisionId,
    pendingEdit: null,
    draft: null,
    baseRevisionId: input.newConfigRevisionId,
    baseGeneration: 0,
    acceptedSeq: 0,
    checkedAt: input.confirmedAt,
    checkId: input.newCheckId,
    inputIssue: null,
    basis: {
      kind: 'project-revision',
      projectRevisionId: input.newConfigRevisionId,
      parentRevisionId: snapshot.project.currentRevisionId,
    },
    provenance: 'committed',
  })
  if (!baseline.ok) {
    return fail(baseline.error.code, baseline.error.message, {
      detail: baseline.error.detail,
    })
  }

  const event: ChangeEvent = {
    id: `requirement_confirmed:${revisionRecord.revisionId}`,
    projectId: snapshot.project.id,
    type: 'requirement_confirmed',
    createdAt: input.confirmedAt,
    requirementId,
    requirementRevisionId: revisionRecord.revisionId,
    parentRevisionId: revisionRecord.parentRevisionId,
    lowerQ: revisionRecord.lowerQ,
    upperQ: revisionRecord.upperQ,
    confirmedTextDigest: stableFingerprint({ text: confirmedText }),
    sourceRevisionId: isPdfRequirementSource(revisionRecord.source)
      ? revisionRecord.source.revisionId
      : revisionRecord.source.attestation.fieldPath,
    sourceSha256: isPdfRequirementSource(revisionRecord.source)
      ? revisionRecord.source.sha256
      : stableFingerprint(revisionRecord.source.attestation),
    checkId: baseline.value.check.checkId,
    checkStatus: baseline.value.check.status,
    reason: revisionRecord.changeReason,
    message:
      revisionRecord.parentRevisionId === null
        ? '建立任务书条款（首版）。'
        : `更新任务书条款版本（原版本 ${revisionRecord.parentRevisionId}）。`,
  }

  const nextProject: ProjectFileSnapshot['project'] = {
    ...snapshot.project,
    currentRevisionId: input.newConfigRevisionId,
    requirementRevisions,
    activeRequirementRevisionId: revisionRecord.revisionId,
    currentRequirementCheck: baseline.value.check,
    updatedAt: input.confirmedAt,
  }
  const evidence: ProjectFileRevisionEvidence = {
    analysisSnapshotId: null,
    eventIds: [event.id],
    sourceManifest: sourceManifestOf(snapshot),
    restoredFromRevisionId: null,
    requirementRevisionId: revisionRecord.revisionId,
    checkId: baseline.value.check.checkId,
  }
  const fileRevision: ProjectFileRevision = {
    revisionId: input.newConfigRevisionId,
    parentId: snapshot.project.currentRevisionId,
    createdAt: input.confirmedAt,
    reason: revisionRecord.parentRevisionId === null ? '建立任务书条款' : '更新任务书条款',
    project: nextProject,
    evidence,
  }

  return {
    ok: true,
    value: {
      revision: revisionRecord,
      baselineCheck: baseline.value.check,
      snapshot: {
        ...snapshot,
        project: nextProject,
        events: [...snapshot.events, event],
        fileRevisions: [...snapshot.fileRevisions, fileRevision],
      },
      fileRevision,
      event,
    },
  }
}

/** 便于展示的条款摘要文本（不参与判定）。 */
export function describeRequirement(revision: RequirementRevision): string {
  return `任务书要求 ${formatMm(revision.lowerQ)}～${formatMm(revision.upperQ)} mm（闭区间）`
}

/** 稳定指纹：用于测试/证据比对，不参与判定与自引用哈希。 */
export function requirementTextDigest(revision: RequirementRevision): string {
  return stableFingerprint(canonicalJson({ text: revision.confirmedText }))
}

/** 临时链构造：仅供展示原项目 target 与条款区间的差异，不写回 chain.target。 */
export function requirementProbeChain(
  chain: ChainDefinition,
  revision: RequirementRevision,
): ChainDefinition {
  return {
    terms: chain.terms.map((term) => ({ ...term })),
    target: { minQ: revision.lowerQ, maxQ: revision.upperQ },
    assumptions: chain.assumptions,
  }
}
