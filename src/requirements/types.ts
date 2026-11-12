/**
 * V3.5 Beta：条款与条款检查的领域类型（纯数据，不依赖 Electron/React/IndexedDB）。
 *
 * 三条不可交换的边界：
 * 1. 条款区间是 Beta 检查的**唯一**判定依据；原项目 target 继续保存并独立计算，
 *    两者互不覆盖（本模块不读取 chain.target 作为通过依据）。
 * 2. 条款版本确认后不可变：任何字段变化都新建 revisionId，不原位覆盖。
 * 3. “是否通过”不是可写布尔：RequirementCheck 是一次输入的不可变证据，
 *    当前是否过期由指纹与当前对象派生（见 fingerprint.ts / check.ts）。
 */
import type { ProjectFileSpacerParameter } from '../project-file/types'
import type { UserAttestation } from '../document-extraction/types'
import type { PdfPageBox, PdfRect } from '../sources/pdfCoordinates'

/** 条款规则版本；参与检查指纹，规则语义变化必须提升。 */
export const REQUIREMENT_RULES_VERSION = 'requirement-rules-1'

export type RequirementRuleType = 'closed-interval-mm'

/** 四态；中文显示名见 REQUIREMENT_STATUS_LABEL。 */
export const REQUIREMENT_CHECK_STATUSES = [
  'satisfied',
  'unsatisfied',
  'pending-confirmation',
  'unchecked',
] as const

export type RequirementCheckStatus = (typeof REQUIREMENT_CHECK_STATUSES)[number]

export const REQUIREMENT_STATUS_LABEL: Record<RequirementCheckStatus, string> = {
  satisfied: '满足要求',
  unsatisfied: '不满足要求',
  'pending-confirmation': '待确认',
  unchecked: '未检查',
}

/** 明确原因码；状态不允许只有文案。 */
export const REQUIREMENT_REASON_CODES = [
  // 未检查
  'NO_REQUIREMENT',
  'UNSUPPORTED_RULE',
  'INVALID_INPUT',
  'INPUT_EMPTY',
  'INPUT_FORMAT',
  'INPUT_PRECISION',
  'INPUT_RANGE',
  'MISSING_BOUNDS',
  'CALCULATION_UNAVAILABLE',
  // 待确认
  'REQUIREMENT_EDIT_UNCONFIRMED',
  'SOURCE_VERSION_CHANGED',
  'SOURCE_UNREADABLE',
  'SOURCE_HASH_MISMATCH',
  'BINDING_UNREVIEWED',
  'BINDING_ADDED',
  'BINDING_REBOUND',
  'BINDING_TERM_REMOVED',
  // 数值结论
  'WITHIN_REQUIREMENT',
  'LOWER_VIOLATED',
  'UPPER_VIOLATED',
  'BOTH_VIOLATED',
] as const

export type RequirementReasonCode = (typeof REQUIREMENT_REASON_CODES)[number]

export interface RequirementChainRef {
  projectId: string
  kind: 'project-dimension-chain'
}

/** 条款引用的确切 PDF 版本与页内区域；不复用 termId 的组成环来源绑定。 */
export interface PdfRequirementSource {
  /** 缺省即 pdf（旧 schema 没有该字段）；显式写出便于与新来源区分。 */
  kind?: 'pdf'
  documentId: string
  revisionId: string
  sha256: string
  blobKey: string
  page: number
  rectPdf: PdfRect
  pageBoxPdf: PdfPageBox
}

/**
 * ADR-001 第 3 步：无任务书项目的条款来源 = 用户断言。
 *
 * 条款区间必须由用户原话给出；这里不伪造页码/选区，也没有 PDF 可核对。
 * 完整性、撤销与跨会话校验复用 `UserAttestation` 的既有判据。
 */
export interface AttestedRequirementSource {
  kind: 'user-attestation'
  attestation: UserAttestation
}

export type RequirementSourceRef = PdfRequirementSource | AttestedRequirementSource

/** 来源种类；缺省 `kind` 就是 pdf（schema ≤9 的记录）。 */
export function requirementSourceKind(source: RequirementSourceRef): 'pdf' | 'user-attestation' {
  return source.kind === 'user-attestation' ? 'user-attestation' : 'pdf'
}

export function isPdfRequirementSource(
  source: RequirementSourceRef,
): source is PdfRequirementSource {
  return requirementSourceKind(source) === 'pdf'
}

/** 确认时的参数/组成环/绑定身份摘要；不冻结长度值，不把数值当永久有效条件。 */
export interface RequirementBindingBasis {
  parameters: {
    parameterId: string
    key: ProjectFileSpacerParameter['key']
    valueQ: number
    parameterRevision: number
  }[]
  terms: {
    termId: string
    nominalQ: number
    termRevision: number
  }[]
  bindings: {
    bindingId: string
    termId: string
    parameterId: string
  }[]
  /** 以上三组身份的稳定指纹，用于快速比较（非密码学哈希）。 */
  digest: string
}

/** 确认后的不可变条款版本。 */
export interface RequirementRevision {
  requirementId: string
  revisionId: string
  /** 首版 null；更新指向同一条款的上一版。 */
  parentRevisionId: string | null
  projectId: string
  chainRef: RequirementChainRef
  source: RequirementSourceRef
  /** 用户粘贴并明确确认的原文；不允许由数值输入反拼。 */
  confirmedText: string
  confirmedAt: string
  /** 确认时该文档的最新版本；当前 latest 与它不同即派生“需核对新版”。 */
  confirmedAgainstLatestRevisionId: string
  ruleType: RequirementRuleType
  lowerQ: number
  upperQ: number
  changeReason: string
  bindingBasis: RequirementBindingBasis
}

/** 条款编辑中尚未确认的表单（只存在于草稿，不得写入正式条款）。 */
export interface RequirementEditDraft {
  /** 更新既有条款时为原 requirementId；首版为 null。 */
  requirementId: string | null
  /** 单调编辑代数；任何表单变化递增，使旧候选检查失效。 */
  editRevision: number
  confirmedText: string
  lowerText: string
  upperText: string
  source: {
    documentId: string | null
    revisionId: string | null
    page: number | null
    rectPdf: PdfRect | null
    pageBoxPdf: PdfPageBox | null
  }
}

/** 检查依据：草稿身份或正式 Revision 身份，二者不可混用。 */
export type RequirementCheckBasis =
  | {
      kind: 'draft'
      baseRevisionId: string
      draftId: string
      draftRevision: number
    }
  | {
      kind: 'project-revision'
      projectRevisionId: string
      parentRevisionId: string | null
    }

export interface RequirementCheckEvidenceRef {
  requirementId: string
  requirementRevisionId: string
  requirementRulesVersion: string
  source: RequirementSourceRef
  bindingBasisDigest: string
  /** 正式检查另引用同次提交的冻结证据；候选为 null。 */
  analysisSnapshotId: string | null
  projectRevisionId: string | null
  drawingFingerprint: string | null
}

/**
 * 一次输入产生的检查证据。
 *
 * 不含 `passed: boolean`：历史检查的原 status 永不改写，当前有效性由
 * `isRequirementCheckStale(check, currentFingerprint)` 派生。
 */
export interface RequirementCheck {
  checkId: string
  projectId: string
  /** 无条款时为 null（此时状态必为 unchecked）。 */
  requirementRevisionId: string | null
  chainRef: RequirementChainRef
  basis: RequirementCheckBasis
  engineVersion: string
  requirementRulesVersion: string
  inputFingerprint: string
  checkedAt: string
  status: RequirementCheckStatus
  reasonCodes: RequirementReasonCode[]
  /** 条款区间内的候选结果；unchecked 时为 null。 */
  resultInterval: { minQ: number; maxQ: number } | null
  /** 相对条款上下限的裕量，含负值；unchecked 时为 null。 */
  margins: { lowerQ: number; upperQ: number } | null
  evidenceRef: RequirementCheckEvidenceRef | null
  provenance: 'candidate' | 'committed'
}

/** 检查派生结果（给 UI/main 用；不是持久化的第二真源）。 */
export interface RequirementEvaluation {
  requirementRevisionId: string | null
  status: RequirementCheckStatus
  reasonCodes: RequirementReasonCode[]
  resultInterval: { minQ: number; maxQ: number } | null
  margins: { lowerQ: number; upperQ: number } | null
  /** 是否可继续原人工确认流程（仅数值 satisfied 可进；不是“已批准”）。 */
  eligibleForCommit: boolean
  /** 逐条中文说明（与 reasonCodes 同序）。 */
  reasons: string[]
}
