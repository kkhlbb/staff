/**
 * V3.5 补缺：条款版本历史与“按版本定位来源 PDF”的纯派生逻辑。
 *
 * 只读既有 `project.requirementRevisions` 与其 `source`：
 * - 每个版本冻结自己的 PDF revisionId / 页码 / 选区，不能拿活动版本顶替；
 * - 来源 PDF 元数据、blob 元数据或附件声明缺失时给出明确原因；
 * - 不写项目、不改活动条款、不触发任何保存。
 */
import type { ProjectFileSnapshot } from '../project-file/types'
import type { PdfPageBox, PdfRect } from '../sources/pdfCoordinates'
import type { RequirementRevision } from './types'

/** 只依赖快照中与定位有关的字段；SnapshotDto（无附件字节）也满足。 */
export type RequirementHistorySnapshot = Pick<
  ProjectFileSnapshot,
  'project' | 'revisions' | 'blobs' | 'missingAttachments'
>

export type RequirementSourceIssueCode =
  | 'REVISION_MISSING'
  | 'SOURCE_REVISION_MISSING'
  | 'SOURCE_BLOB_MISSING'
  | 'SOURCE_DECLARED_MISSING'
  | 'SOURCE_HASH_MISMATCH'
  | 'SOURCE_PAGE_OUT_OF_RANGE'

export interface RequirementSourceIssue {
  code: RequirementSourceIssueCode
  /** 面向用户的明确原因；包含条款版本与来源身份，便于核对。 */
  message: string
}

/** 传给来源 PDF 页的定位目标；issue 非空时只显示原因，不打开 PDF。 */
export interface RequirementSourceLocation {
  requirementRevisionId: string
  revisionId: string
  page: number
  rectPdf: PdfRect
  pageBoxPdf: PdfPageBox
  /** 用于来源页显示，不参与项目数据。 */
  label: string
  sourceFileName: string | null
  issue: RequirementSourceIssue | null
  /** 同一目标重复点击时强制来源页重新挂载；不显示、不持久化。 */
  locateNonce?: number
}

export interface RequirementRevisionHistoryEntry {
  revisionId: string
  requirementId: string
  parentRevisionId: string | null
  confirmedAt: string
  lowerQ: number
  upperQ: number
  sourceRevisionId: string
  sourcePage: number
  sourceRectPdf: PdfRect
  sourceFileName: string | null
  isActive: boolean
  issue: RequirementSourceIssue | null
}

export interface ResolvedRequirementRevisionSource {
  /** 按传入 revisionId 找到的版本；找不到时为 null。 */
  revision: RequirementRevision | null
  location: RequirementSourceLocation | null
  issue: RequirementSourceIssue | null
}

function issue(
  code: RequirementSourceIssueCode,
  message: string,
): RequirementSourceIssue {
  return { code, message }
}

function inspectSource(
  snapshot: RequirementHistorySnapshot,
  revision: RequirementRevision,
): RequirementSourceIssue | null {
  const sourceRevision = snapshot.revisions.find(
    (item) => item.id === revision.source.revisionId,
  )
  if (sourceRevision === undefined) {
    return issue(
      'SOURCE_REVISION_MISSING',
      `条款版本 ${revision.revisionId} 引用的来源 PDF 版本 ${revision.source.revisionId} 不在项目文件中（可能已删除），无法定位。`,
    )
  }

  const declaredMissing = snapshot.missingAttachments.find(
    (item) =>
      item.revisionId === sourceRevision.id ||
      item.blobKey === revision.source.blobKey,
  )
  if (declaredMissing !== undefined) {
    return issue(
      'SOURCE_DECLARED_MISSING',
      `条款版本 ${revision.revisionId} 引用的来源 ${sourceRevision.id} 已声明缺失（${declaredMissing.reason}），无法打开 PDF。`,
    )
  }

  const blob = snapshot.blobs.find(
    (item) => item.blobKey === revision.source.blobKey,
  )
  if (blob === undefined) {
    return issue(
      'SOURCE_BLOB_MISSING',
      `条款版本 ${revision.revisionId} 引用的来源附件 ${revision.source.blobKey} 不在项目文件中（可能已删除），无法打开 PDF。`,
    )
  }

  if (
    sourceRevision.sha256 !== revision.source.sha256 ||
    blob.sha256 !== revision.source.sha256
  ) {
    return issue(
      'SOURCE_HASH_MISMATCH',
      `条款版本 ${revision.revisionId} 引用的来源 ${sourceRevision.id} 哈希与确认时不一致，不能打开可能已替换的 PDF。`,
    )
  }

  if (
    !Number.isInteger(revision.source.page) ||
    revision.source.page < 1 ||
    revision.source.page > sourceRevision.pageCount
  ) {
    return issue(
      'SOURCE_PAGE_OUT_OF_RANGE',
      `条款版本 ${revision.revisionId} 保存的第 ${revision.source.page} 页超出 ${sourceRevision.id} 的页数（${sourceRevision.pageCount} 页），无法定位选区。`,
    )
  }

  return null
}

/**
 * 按**传入的 revisionId**取该版本的来源；历史版本不会被活动版本替换。
 */
export function resolveRequirementRevisionSource(
  snapshot: RequirementHistorySnapshot,
  revisionId: string,
): ResolvedRequirementRevisionSource {
  const revision =
    snapshot.project.requirementRevisions.find(
      (item) => item.revisionId === revisionId,
    ) ?? null
  if (revision === null) {
    return {
      revision: null,
      location: null,
      issue: issue(
        'REVISION_MISSING',
        `条款版本 ${revisionId} 不在项目文件中（可能已删除），无法定位来源 PDF。`,
      ),
    }
  }

  const sourceIssue = inspectSource(snapshot, revision)
  const sourceRevision = snapshot.revisions.find(
    (item) => item.id === revision.source.revisionId,
  )
  return {
    revision,
    issue: sourceIssue,
    location: {
      requirementRevisionId: revision.revisionId,
      revisionId: revision.source.revisionId,
      page: revision.source.page,
      rectPdf: revision.source.rectPdf,
      pageBoxPdf: revision.source.pageBoxPdf,
      label: `条款 ${revision.revisionId}`,
      sourceFileName: sourceRevision?.fileName ?? null,
      issue: sourceIssue,
    },
  }
}

/**
 * 列出该项目全部条款版本（含旧版本）；活动标记只作显示，不改变来源解析。
 *
 * 每条来源字段都通过 `resolveRequirementRevisionSource(snapshot, 本条 revisionId)`
 * 派生，避免界面直接读活动指针而把历史版本错误地指向当前条款。
 */
export function listRequirementRevisionHistory(
  snapshot: RequirementHistorySnapshot,
): RequirementRevisionHistoryEntry[] {
  return snapshot.project.requirementRevisions.map((stored) => {
    const resolved = resolveRequirementRevisionSource(
      snapshot,
      stored.revisionId,
    )
    const effective = resolved.revision ?? stored
    const sourceRevision = snapshot.revisions.find(
      (item) => item.id === effective.source.revisionId,
    )
    return {
      revisionId: stored.revisionId,
      requirementId: stored.requirementId,
      parentRevisionId: stored.parentRevisionId,
      confirmedAt: stored.confirmedAt,
      lowerQ: stored.lowerQ,
      upperQ: stored.upperQ,
      sourceRevisionId: effective.source.revisionId,
      sourcePage: effective.source.page,
      sourceRectPdf: effective.source.rectPdf,
      sourceFileName: sourceRevision?.fileName ?? null,
      isActive:
        stored.revisionId ===
        snapshot.project.activeRequirementRevisionId,
      issue: resolved.issue,
    }
  })
}
