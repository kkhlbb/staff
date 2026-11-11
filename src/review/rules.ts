/**
 * 统一审查规则（V2.2 第一组，规格 §6.1）。
 *
 * 八条规则、五种状态只在这里判定一次：工作台审查侧栏、快照报告与项目列表
 * 必须消费同一份结果，不能在组件里另写一套“已确认/未确认”。
 *
 * 关键契约：
 * - “计算满足”与“审查完成”是两个独立结论；来源缺失不改变 calculateChain 的数值。
 * - 没有绑定不能用空数组 every() 宣称来源审查完成：逐环、逐绑定分别产出结果。
 * - 前置输入非法时，下游项明确标为“不适用”并附依据，绝不默认通过。
 * - 历史来源接受只解决 SOURCE_CURRENT，不代替 SOURCE_VALUE_REVIEWED。
 * - 本模块是纯函数：不读存储、不写事件、不依赖 React。
 */
import { formatMm } from '../domain/units'
import { ENGINE_VERSION } from '../domain/calculate'
import type { ChainDefinition, ChainResult } from '../domain/types'
import type { SourceBinding } from '../sources/bindings'
import type { SourceDocument, SourceRevision } from '../sources/types'
import type { CellErrors } from '../workspace/draft'

/** 规则版本：每条结果都携带；快照与报告记录同一版本。 */
export const REVIEW_RULES_VERSION = '1.0.0'

export type ReviewRuleId =
  | 'INPUT_VALID'
  | 'SOURCE_PRESENT'
  | 'SOURCE_AVAILABLE'
  | 'SOURCE_CURRENT'
  | 'SOURCE_VALUE_REVIEWED'
  | 'RELATION_CONFIRMED'
  | 'CALC_VALID'
  | 'TARGET_WITHIN'

export const REVIEW_RULE_IDS: readonly ReviewRuleId[] = [
  'INPUT_VALID',
  'CALC_VALID',
  'RELATION_CONFIRMED',
  'TARGET_WITHIN',
  'SOURCE_PRESENT',
  'SOURCE_AVAILABLE',
  'SOURCE_CURRENT',
  'SOURCE_VALUE_REVIEWED',
]

export const REVIEW_RULE_LABEL: Record<ReviewRuleId, string> = {
  INPUT_VALID: '输入有效',
  SOURCE_PRESENT: '来源存在',
  SOURCE_AVAILABLE: '来源可读',
  SOURCE_CURRENT: '来源版本状态',
  SOURCE_VALUE_REVIEWED: '来源数值已核对',
  RELATION_CONFIRMED: '尺寸关系已确认',
  CALC_VALID: '计算有效',
  TARGET_WITHIN: '目标区间判定',
}

/** 规格限定的五种状态，不允许扩展。 */
export type ReviewStatus =
  | 'passed'
  | 'failed'
  | 'unchecked'
  | 'needs-human'
  | 'not-applicable'

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  passed: '通过',
  failed: '未通过',
  unchecked: '未检查',
  'needs-human': '待人工确认',
  'not-applicable': '不适用',
}

export type ReviewScope = 'chain' | 'term' | 'binding'

export type ReviewSeverity = 'blocking' | 'warning' | 'info'

export const REVIEW_SEVERITY_LABEL: Record<ReviewSeverity, string> = {
  blocking: '必须处理',
  warning: '建议处理',
  info: '结论',
}

/** 点击定位的目标：链级项定位到错误单元格/目标/关系入口，绑定项定位到确切版本与页。 */
export type ReviewTarget =
  | { kind: 'chain' }
  | { kind: 'relation' }
  | { kind: 'target' }
  | {
      kind: 'term'
      termId: string
      field?: 'nominal' | 'lower' | 'upper' | 'symbol' | 'name' | 'sourceNote'
    }
  | {
      kind: 'binding'
      bindingId: string
      termId: string
      documentId: string
      revisionId: string
      page: number
    }

export interface ReviewSubject {
  kind: 'chain' | 'term' | 'binding' | 'target'
  /** 链级为 'chain'，逐环为 termId，逐绑定为 bindingId。 */
  id: string
  label: string
  termId?: string
  bindingId?: string
  documentId?: string
  revisionId?: string
  page?: number
}

export interface ReviewFinding {
  ruleId: ReviewRuleId
  ruleVersion: string
  scope: ReviewScope
  subject: ReviewSubject
  status: ReviewStatus
  /** 规则版本之外的判定依据（实际数据，不是泛泛说明）。 */
  basis: string
  /** 面向用户的具体处理动作；结论明确时为 null。 */
  action: string | null
  severity: ReviewSeverity
  /** 是否仍需要用户动作；审查完成 = 没有 needsAction 的项。 */
  needsAction: boolean
  target: ReviewTarget
}

export interface CalculationOutcome {
  status: ChainResult['status'] | 'no-result'
  label: string
  /** null 表示没有目标或没有有效计算，不能当成满足/不满足。 */
  satisfied: boolean | null
}

export interface ReviewSummary {
  rulesVersion: string
  findings: ReviewFinding[]
  /** 计算满足：只来自 calculateChain 的结果。 */
  calculation: CalculationOutcome
  /** 审查完成：所有应适用规则均已有结论且无待人工动作。 */
  reviewComplete: boolean
  /** 仍需用户处理的项（失败/待人工/未检查），按严重程度与对象排序。 */
  pending: ReviewFinding[]
  /** 当前是否存在有效计算（非法草稿阻止创建快照/报告）。 */
  canCreateReport: boolean
  hasAnyBinding: boolean
  byStatus: Record<ReviewStatus, number>
  /** 待处理项按严重程度分组，供侧栏展示。 */
  groups: { severity: ReviewSeverity; label: string; findings: ReviewFinding[] }[]
}

export interface ReviewTermInput {
  id: string
  symbol: string
  name: string
  termRevision: number
}

export interface ReviewInput {
  /** 当前草稿成功转换后的链；输入非法时为 null。 */
  chain: ChainDefinition | null
  /** 当前草稿的单元格错误，用于 INPUT_VALID 的依据与定位。 */
  cellErrors?: CellErrors
  /** 与 chain 对应的计算结果；chain 为 null 时为 null。 */
  result: ChainResult | null
  /** 关系确认派生结果（relation.ts）。 */
  relationConfirmed: boolean
  /** 曾经确认、但凭据已失效；与“从未确认”区分展示。 */
  relationReviewStale: boolean
  /** 当前关系修订号，用于依据文本。 */
  relationRevision: number
  /** 当前草稿中的组成环（非法草稿也保留，用于来源证据判定）。 */
  terms: readonly ReviewTermInput[]
  bindings: readonly SourceBinding[]
  documents: readonly SourceDocument[]
  revisions: readonly SourceRevision[]
  /** 本机确实存在 Blob 的 blobKey 集合，不能只凭元数据判定“可读”。 */
  availableBlobKeys: ReadonlySet<string>
  /** 计算引擎版本；默认取当前引擎常量。 */
  engineVersion?: string
}

const STATUS_ORDER: Record<ReviewStatus, number> = {
  failed: 0,
  'needs-human': 1,
  unchecked: 2,
  'not-applicable': 3,
  passed: 4,
}

const SEVERITY_ORDER: Record<ReviewSeverity, number> = {
  blocking: 0,
  warning: 1,
  info: 2,
}

const SCOPE_ORDER: Record<ReviewScope, number> = {
  chain: 0,
  term: 1,
  binding: 2,
}

function termLabel(term: ReviewTermInput): string {
  const symbol = term.symbol.trim()
  if (symbol !== '') {
    return symbol
  }
  const name = term.name.trim()
  return name !== '' ? name : term.id
}

function chainSubject(): ReviewSubject {
  return { kind: 'chain', id: 'chain', label: '当前尺寸链' }
}

function termSubject(term: ReviewTermInput): ReviewSubject {
  return { kind: 'term', id: term.id, label: `组成环 ${termLabel(term)}`, termId: term.id }
}

function bindingSubject(
  binding: SourceBinding,
  term: ReviewTermInput | undefined,
  revision: SourceRevision | undefined,
  document: SourceDocument | undefined,
): ReviewSubject {
  const termPart = term === undefined ? binding.termId : termLabel(term)
  const filePart = revision?.fileName ?? '版本记录缺失'
  const documentPart = document?.title ?? binding.documentId
  return {
    kind: 'binding',
    id: binding.id,
    label: `组成环 ${termPart} · ${documentPart} 第 ${binding.page} 页 · ${filePart}`,
    termId: binding.termId,
    bindingId: binding.id,
    documentId: binding.documentId,
    revisionId: binding.revisionId,
    page: binding.page,
  }
}

function bindingTarget(binding: SourceBinding): ReviewTarget {
  return {
    kind: 'binding',
    bindingId: binding.id,
    termId: binding.termId,
    documentId: binding.documentId,
    revisionId: binding.revisionId,
    page: binding.page,
  }
}

function truncateId(value: string): string {
  return value.length > 8 ? `${value.slice(0, 8)}…` : value
}

function parseCellTarget(key: string): { target: ReviewTarget; label: string } {
  if (key === 'target.min' || key === 'target.max') {
    return {
      target: { kind: 'target' },
      label: key === 'target.min' ? '目标下限' : '目标上限',
    }
  }
  const dot = key.lastIndexOf('.')
  if (dot <= 0) {
    return { target: { kind: 'chain' }, label: key }
  }
  const termId = key.slice(0, dot)
  const field = key.slice(dot + 1)
  const fieldLabel: Record<string, string> = {
    nominal: '基本尺寸',
    lower: '下偏差',
    upper: '上偏差',
    symbol: '代号',
    name: '名称',
    sourceNote: '来源说明',
  }
  return {
    target: { kind: 'term', termId },
    label: `${termId} 的${fieldLabel[field] ?? field}`,
  }
}

interface FindingDraft {
  ruleId: ReviewRuleId
  scope: ReviewScope
  subject: ReviewSubject
  status: ReviewStatus
  basis: string
  action: string | null
  severity: ReviewSeverity
  /** 默认：passed 不需要动作；其它状态需要，除非规则显式说这是结论。 */
  needsAction?: boolean
  target: ReviewTarget
}

function makeFinding(draft: FindingDraft): ReviewFinding {
  return {
    ruleId: draft.ruleId,
    ruleVersion: REVIEW_RULES_VERSION,
    scope: draft.scope,
    subject: draft.subject,
    status: draft.status,
    basis: draft.basis,
    action: draft.action,
    severity: draft.severity,
    needsAction:
      draft.needsAction ?? (draft.status !== 'passed' && draft.status !== 'failed'),
    target: draft.target,
  }
}

function formatRange(minQ: number, maxQ: number): string {
  return `[${formatMm(minQ)}, ${formatMm(maxQ)}] mm`
}

function compareFindings(left: ReviewFinding, right: ReviewFinding): number {
  return (
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
    STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
    SCOPE_ORDER[left.scope] - SCOPE_ORDER[right.scope] ||
    left.subject.label.localeCompare(right.subject.label, 'zh-CN')
  )
}

/**
 * 逐规则判定。返回的 findings 顺序固定为规则表顺序；
 * pending / groups 再按严重程度排。
 */
export function evaluateReviewChecklist(input: ReviewInput): ReviewSummary {
  const engineVersion = input.engineVersion ?? ENGINE_VERSION
  const findings: ReviewFinding[] = []
  const cellErrors = input.cellErrors ?? {}
  const cellEntries = Object.entries(cellErrors)

  // 1. INPUT_VALID（链级）
  if (input.chain !== null) {
    findings.push(
      makeFinding({
        ruleId: 'INPUT_VALID',
        scope: 'chain',
        subject: chainSubject(),
        status: 'passed',
        basis: `当前输入通过业务校验，共 ${input.chain.terms.length} 个组成环。`,
        action: null,
        severity: 'blocking',
        target: { kind: 'chain' },
      }),
    )
  } else {
    const first = cellEntries[0]
    const located = first === undefined ? null : parseCellTarget(first[0])
    findings.push(
      makeFinding({
        ruleId: 'INPUT_VALID',
        scope: 'chain',
        subject: chainSubject(),
        status: 'failed',
        basis:
          first === undefined
            ? '当前输入未通过业务校验。'
            : `当前输入有 ${cellEntries.length} 处校验错误；首个错误在${located?.label ?? first[0]}：${first[1]}`,
        action: '修正标记的输入单元格后重新检查。',
        severity: 'blocking',
        needsAction: true,
        target: located?.target ?? { kind: 'chain' },
      }),
    )
  }

  // 2. CALC_VALID（链级）
  if (input.chain === null) {
    findings.push(
      makeFinding({
        ruleId: 'CALC_VALID',
        scope: 'chain',
        subject: chainSubject(),
        status: 'not-applicable',
        basis: '当前输入未通过校验，计算内核没有执行，无法检查计算结果。',
        action: '先修正输入。',
        severity: 'blocking',
        needsAction: true,
        target: { kind: 'chain' },
      }),
    )
  } else if (input.result === null) {
    findings.push(
      makeFinding({
        ruleId: 'CALC_VALID',
        scope: 'chain',
        subject: chainSubject(),
        status: 'failed',
        basis: '当前输入合法，但没有得到计算内核的结果。',
        action: '重新计算后再检查。',
        severity: 'blocking',
        needsAction: true,
        target: { kind: 'chain' },
      }),
    )
  } else {
    findings.push(
      makeFinding({
        ruleId: 'CALC_VALID',
        scope: 'chain',
        subject: chainSubject(),
        status: 'passed',
        basis: `已由计算引擎 ${engineVersion} 完成一维极值法计算。`,
        action: null,
        severity: 'blocking',
        target: { kind: 'chain' },
      }),
    )
  }

  // 3. RELATION_CONFIRMED（链级）
  if (input.chain === null) {
    findings.push(
      makeFinding({
        ruleId: 'RELATION_CONFIRMED',
        scope: 'chain',
        subject: chainSubject(),
        status: 'not-applicable',
        basis: '当前输入未通过校验，没有可核对的关系指纹。',
        action: '先修正输入。',
        severity: 'blocking',
        needsAction: true,
        target: { kind: 'chain' },
      }),
    )
  } else if (input.relationConfirmed) {
    findings.push(
      makeFinding({
        ruleId: 'RELATION_CONFIRMED',
        scope: 'chain',
        subject: chainSubject(),
        status: 'passed',
        basis: `当前关系指纹与确认凭据一致（关系修订 ${input.relationRevision}）。`,
        action: null,
        severity: 'blocking',
        target: { kind: 'relation' },
      }),
    )
  } else if (input.relationReviewStale) {
    findings.push(
      makeFinding({
        ruleId: 'RELATION_CONFIRMED',
        scope: 'chain',
        subject: chainSubject(),
        status: 'failed',
        basis:
          '此前确认过，但后续修改使凭据失效；即使改回原值也不会自动恢复确认。',
        action: '重新核对尺寸关系与作用方向，然后显式确认。',
        severity: 'blocking',
        needsAction: true,
        target: { kind: 'relation' },
      }),
    )
  } else {
    findings.push(
      makeFinding({
        ruleId: 'RELATION_CONFIRMED',
        scope: 'chain',
        subject: chainSubject(),
        status: 'needs-human',
        basis: '尚无当前尺寸关系与作用方向的显式确认凭据。',
        action: '核对尺寸关系与作用方向后，在结果卡显式确认。',
        severity: 'blocking',
        needsAction: true,
        target: { kind: 'relation' },
      }),
    )
  }

  // 4. TARGET_WITHIN（链级）
  if (input.chain === null) {
    findings.push(
      makeFinding({
        ruleId: 'TARGET_WITHIN',
        scope: 'chain',
        subject: chainSubject(),
        status: 'not-applicable',
        basis: '当前输入未通过校验，无法进行目标区间判定。',
        action: '先修正输入。',
        severity: 'info',
        needsAction: true,
        target: { kind: 'chain' },
      }),
    )
  } else if (input.chain.target === null) {
    findings.push(
      makeFinding({
        ruleId: 'TARGET_WITHIN',
        scope: 'chain',
        subject: chainSubject(),
        status: 'unchecked',
        basis: '未设置目标区间；按规格这不是自动通过。',
        action: '如需目标判定，请填写目标上下限。',
        severity: 'info',
        needsAction: true,
        target: { kind: 'target' },
      }),
    )
  } else if (input.result === null) {
    findings.push(
      makeFinding({
        ruleId: 'TARGET_WITHIN',
        scope: 'chain',
        subject: chainSubject(),
        status: 'unchecked',
        basis: '目标已设置，但没有可用的计算结果。',
        action: '重新计算后再判定。',
        severity: 'info',
        needsAction: true,
        target: { kind: 'target' },
      }),
    )
  } else if (input.result.status === 'within') {
    findings.push(
      makeFinding({
        ruleId: 'TARGET_WITHIN',
        scope: 'chain',
        subject: chainSubject(),
        status: 'passed',
        basis: `结果区间 ${formatRange(input.result.minQ, input.result.maxQ)} 落在目标区间 ${formatRange(input.chain.target.minQ, input.chain.target.maxQ)} 内。`,
        action: null,
        severity: 'info',
        target: { kind: 'target' },
      }),
    )
  } else if (input.result.status === 'outside') {
    findings.push(
      makeFinding({
        ruleId: 'TARGET_WITHIN',
        scope: 'chain',
        subject: chainSubject(),
        status: 'failed',
        basis: `结果区间 ${formatRange(input.result.minQ, input.result.maxQ)} 超出目标区间 ${formatRange(input.chain.target.minQ, input.chain.target.maxQ)}。这是计算结论，不是待补充的人工凭据。`,
        action: '调整组成环或目标后重新判定。',
        severity: 'info',
        // 目标不满足是已经完成的工程判定，不阻塞“审查完成”。
        needsAction: false,
        target: { kind: 'target' },
      }),
    )
  } else {
    findings.push(
      makeFinding({
        ruleId: 'TARGET_WITHIN',
        scope: 'chain',
        subject: chainSubject(),
        status: 'unchecked',
        basis: '计算结果没有目标判定状态。',
        action: '重新计算后再判定。',
        severity: 'info',
        needsAction: true,
        target: { kind: 'target' },
      }),
    )
  }

  // 5. SOURCE_PRESENT（逐环）：没有绑定时是“未检查”，不是数学错误。
  for (const term of input.terms) {
    const count = input.bindings.filter((binding) => binding.termId === term.id).length
    findings.push(
      makeFinding({
        ruleId: 'SOURCE_PRESENT',
        scope: 'term',
        subject: termSubject(term),
        status: count === 0 ? 'unchecked' : 'passed',
        basis:
          count === 0
            ? '该组成环没有任何来源绑定；不影响数学结果，但证据不完整。'
            : `已绑定 ${count} 处来源区域。`,
        action: count === 0 ? '为该环绑定来源区域，或说明为何不需要来源。' : null,
        severity: 'warning',
        needsAction: count === 0,
        target: { kind: 'term', termId: term.id },
      }),
    )
  }

  // 6-8. 逐绑定规则：独立计算，互不遮盖。
  for (const binding of input.bindings) {
    const term = input.terms.find((candidate) => candidate.id === binding.termId)
    const document = input.documents.find(
      (candidate) => candidate.id === binding.documentId,
    )
    const revision = input.revisions.find(
      (candidate) => candidate.id === binding.revisionId,
    )
    const subject = bindingSubject(binding, term, revision, document)
    const target = bindingTarget(binding)

    // SOURCE_AVAILABLE
    if (revision === undefined) {
      findings.push(
        makeFinding({
          ruleId: 'SOURCE_AVAILABLE',
          scope: 'binding',
          subject,
          status: 'failed',
          basis: `绑定引用的版本 ${truncateId(binding.revisionId)} 在来源版本记录中不存在。`,
          action: '重新绑定来源，或解除这条绑定。',
          severity: 'blocking',
          needsAction: true,
          target,
        }),
      )
    } else if (!input.availableBlobKeys.has(revision.blobKey)) {
      findings.push(
        makeFinding({
          ruleId: 'SOURCE_AVAILABLE',
          scope: 'binding',
          subject,
          status: 'failed',
          basis: `版本「${revision.fileName}」的元数据存在，但附件不在本机（可能来自不含附件的 JSON 备份或已清理的浏览器数据）。`,
          action: '重新导入该版本 PDF，或解除这条绑定。',
          severity: 'blocking',
          needsAction: true,
          target,
        }),
      )
    } else {
      findings.push(
        makeFinding({
          ruleId: 'SOURCE_AVAILABLE',
          scope: 'binding',
          subject,
          status: 'passed',
          basis: `版本「${revision.fileName}」的附件可读取（${revision.pageCount} 页）。`,
          action: null,
          severity: 'blocking',
          target,
        }),
      )
    }

    // SOURCE_CURRENT
    if (document === undefined) {
      findings.push(
        makeFinding({
          ruleId: 'SOURCE_CURRENT',
          scope: 'binding',
          subject,
          status: 'failed',
          basis: '绑定所属的来源文档记录不存在，无法判断版本状态。',
          action: '重新绑定来源，或解除这条绑定。',
          severity: 'blocking',
          needsAction: true,
          target,
        }),
      )
    } else if (binding.revisionId === document.latestRevisionId) {
      findings.push(
        makeFinding({
          ruleId: 'SOURCE_CURRENT',
          scope: 'binding',
          subject,
          status: 'passed',
          basis: `绑定指向文档「${document.title}」的当前最新版本 ${truncateId(binding.revisionId)}。`,
          action: null,
          severity: 'blocking',
          target,
        }),
      )
    } else {
      const acceptance = binding.historicalAcceptance ?? null
      const acceptedForLatest =
        acceptance !== null && acceptance.latestRevisionId === document.latestRevisionId
      if (acceptedForLatest) {
        findings.push(
          makeFinding({
            ruleId: 'SOURCE_CURRENT',
            scope: 'binding',
            subject,
            status: 'passed',
            basis:
              `使用历史来源（已说明）：绑定仍指向旧版本 ${truncateId(binding.revisionId)}，` +
              `文档最新版本为 ${truncateId(document.latestRevisionId)}；` +
              `理由「${acceptance.reason}」，适用范围「${acceptance.scope}」。`,
            action: null,
            severity: 'blocking',
            target,
          }),
        )
      } else {
        const previous = acceptance === null ? '' : `此前接受的是 ${truncateId(acceptance.latestRevisionId)}，之后又导入了更新版本；`
        findings.push(
          makeFinding({
            ruleId: 'SOURCE_CURRENT',
            scope: 'binding',
            subject,
            status: 'needs-human',
            basis:
              `文档「${document.title}」已导入更新版本 ${truncateId(document.latestRevisionId)}，` +
              `当前绑定仍指向旧版本 ${truncateId(binding.revisionId)}。${previous}` +
              '版本事件不等于已识别内容变化。',
            action:
              '逐绑定处理：迁移到新版并重新框选核对；或继续用旧版（必填理由与适用范围）；或解除绑定。',
            severity: 'blocking',
            needsAction: true,
            target,
          }),
        )
      }
    }

    // SOURCE_VALUE_REVIEWED
    if (term === undefined) {
      findings.push(
        makeFinding({
          ruleId: 'SOURCE_VALUE_REVIEWED',
          scope: 'binding',
          subject,
          status: 'failed',
          basis: '绑定所属的组成环已不存在。',
          action: '解除这条绑定，或恢复对应组成环。',
          severity: 'warning',
          needsAction: true,
          target,
        }),
      )
    } else if (binding.reviewedTermRevision === null) {
      findings.push(
        makeFinding({
          ruleId: 'SOURCE_VALUE_REVIEWED',
          scope: 'binding',
          subject,
          status: 'needs-human',
          basis: `该来源区域尚未与本环当前修订 ${term.termRevision} 显式核对。`,
          action: '对照来源区域核对本环数值后，标记“已核对”。',
          severity: 'warning',
          needsAction: true,
          target,
        }),
      )
    } else if (binding.reviewedTermRevision !== term.termRevision) {
      findings.push(
        makeFinding({
          ruleId: 'SOURCE_VALUE_REVIEWED',
          scope: 'binding',
          subject,
          status: 'needs-human',
          basis: `核对时本环修订为 ${binding.reviewedTermRevision}，当前为 ${term.termRevision}；数值或方向已变化，旧核对不成立。`,
          action: '重新对照来源区域核对本环数值。',
          severity: 'warning',
          needsAction: true,
          target,
        }),
      )
    } else {
      findings.push(
        makeFinding({
          ruleId: 'SOURCE_VALUE_REVIEWED',
          scope: 'binding',
          subject,
          status: 'passed',
          basis: `已按本环当前修订 ${term.termRevision} 核对来源区域。`,
          action: null,
          severity: 'warning',
          target,
        }),
      )
    }
  }

  const pending = findings.filter((finding) => finding.needsAction).sort(compareFindings)
  const reviewComplete = pending.length === 0
  const byStatus: Record<ReviewStatus, number> = {
    passed: 0,
    failed: 0,
    unchecked: 0,
    'needs-human': 0,
    'not-applicable': 0,
  }
  for (const finding of findings) {
    byStatus[finding.status] += 1
  }

  const groups = (['blocking', 'warning', 'info'] as const)
    .map((severity) => ({
      severity,
      label: REVIEW_SEVERITY_LABEL[severity],
      findings: pending.filter((finding) => finding.severity === severity),
    }))
    .filter((group) => group.findings.length > 0)

  const calculation: CalculationOutcome =
    input.result === null
      ? { status: 'no-result', label: '暂无计算结果', satisfied: null }
      : input.result.status === 'within'
        ? { status: 'within', label: '计算满足', satisfied: true }
        : input.result.status === 'outside'
          ? { status: 'outside', label: '计算不满足', satisfied: false }
          : { status: 'no-target', label: '未设置目标，未判定', satisfied: null }

  return {
    rulesVersion: REVIEW_RULES_VERSION,
    findings,
    calculation,
    reviewComplete,
    pending,
    canCreateReport: input.chain !== null && input.result !== null,
    hasAnyBinding: input.bindings.length > 0,
    byStatus,
    groups,
  }
}

/** 只取出某条规则的结果；测试与侧栏分组使用。 */
export function findingsForRule(
  summary: ReviewSummary,
  ruleId: ReviewRuleId,
): ReviewFinding[] {
  return summary.findings.filter((finding) => finding.ruleId === ruleId)
}
