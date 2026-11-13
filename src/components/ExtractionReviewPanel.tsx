/**
 * V3.6：任务书 PDF 提取审阅面板。
 *
 * 只做展示与显式动作请求：
 * - 候选逐条显示类型/原文/页/选区/原因码，并明确区分待确认、阻塞、已确认、已拒绝；
 * - 确认必须逐条点击，没有默认勾选，也不提供“全部确认”（任务卡 §4.2）；
 * - 拒绝必须填理由；批量操作只支持批量拒绝；
 * - 未确认/阻塞候选永远不会被展示成已应用，也不会影响尺寸链计算（计算不读候选）；
 * - 界面如实显示 extractorVersion、样本覆盖限制与“不做 OCR/DOCX”。
 *
 * 多草稿（同一 PDF 版本 + 同一页范围有多个规则版本）：
 * - 默认显示 extractorVersion 最高的草稿，顶部明确写出当前显示哪个草稿（版本 + 草稿 id）；
 * - 其余草稿折叠成一行，可展开查看候选（只读）或显式删除；删除必须二次确认。
 */
import { Fragment, useMemo, useState } from 'react'
import type {
  ExtractionAttestUnitsValue,
  ExtractionBatchValue,
  ExtractionCancelValue,
  ExtractionDecideValue,
  ExtractionDeleteDraftValue,
  ExtractionRunValue,
  IpcResult,
  SnapshotDto,
} from '../../desktop/shared/contracts'
import {
  EXTRACTOR_VERSION,
  activeConfirmedDecisionCount,
  activeUnitAttestation,
  activeUnitBatches,
  batchConfirmCandidateIds,
  batchUnitCandidateIds,
  canDeleteDraft,
  compareExtractorVersions,
  extractorVersionLabel,
  groupConfirmCandidates,
  groupExtractionDrafts,
  type EditableField,
  type ExtractionCandidate,
  type ExtractionDraft,
  type QuantityValue,
} from '../document-extraction'
import type { SourceRevision } from '../sources/types'
import { PdfViewer } from './PdfViewer'
import './ExtractionReviewPanel.css'

export interface ExtractionRunOutcome {
  requestId: string
  result: IpcResult<ExtractionRunValue>
}

export interface ExtractionReviewActions {
  onRun: (request: {
    revisionId: string
    pageFrom: number
    pageTo: number
    requestId: string
  }) => Promise<ExtractionRunOutcome | null>
  onDecide: (request: {
    draftId: string
    candidateId: string
    editRevision: number
    action: 'confirm' | 'reject' | 'edit' | 'revoke'
    confirmed?: true
    reason?: string
    field?: EditableField
    text?: string
  }) => Promise<ExtractionDecideValue | null>
  onCancel: (requestId: string) => Promise<ExtractionCancelValue | null>
  /** 删除一份被取代的旧规则版本草稿；返回 null 表示失败（错误由外层提示）。 */
  onDeleteDraft: (request: { draftId: string }) => Promise<ExtractionDeleteDraftValue | null>
  /**
   * L2 批量动作。缺省表示当前环境未装配（旧测试/非桌面环境）：界面不渲染任何批量按钮，
   * 绝不给出“看起来能批量、点了没反应”的假按钮。
   *
   * 返回值是完整 IpcResult：整批拒绝的原因（main 生成的 message）要原样显示在面板里。
   */
  onConfirmBatch?: (request: {
    draftId: string
    candidateIds: string[]
  }) => Promise<IpcResult<ExtractionBatchValue> | null>
  onAttestUnits?: (request: {
    draftId: string
    candidateIds: string[]
    statement: string
  }) => Promise<IpcResult<ExtractionAttestUnitsValue> | null>
  onRevokeUnits?: (request: {
    draftId: string
    batchId?: string
    candidateId?: string
  }) => Promise<IpcResult<ExtractionBatchValue> | null>
}

export interface ExtractionReviewPanelProps {
  snapshot: SnapshotDto
  busy: boolean
  actions: ExtractionReviewActions
  /** 定位预览的字节读取；测试或非桌面环境可省略（只显示选区摘要）。 */
  readBytes?: (revision: SourceRevision) => Promise<Uint8Array>
}

const KIND_LABEL: Record<ExtractionCandidate['kind'], string> = {
  ring: '组成环',
  interval: '目标区间',
  formula: '公式',
  'part-dimension': '部件尺寸',
}

const STATUS_LABEL: Record<ExtractionCandidate['status'], string> = {
  pending: '待确认',
  blocked: '阻塞',
  confirmed: '已确认',
  rejected: '已拒绝',
  stale: '已失效',
}

const FIELD_LABEL: Record<string, string> = {
  nominal: '基本尺寸',
  upperDeviation: '上偏差',
  lowerDeviation: '下偏差',
  lower: '下限',
  upper: '上限',
  innerDiameter: '内径',
  outerDiameter: '外径',
  length: '长度',
}

function formatRect(rect: readonly number[]): string {
  return `[${rect.map((value) => Number(value.toFixed(2))).join(', ')}]`
}

function candidateTitle(candidate: ExtractionCandidate): string {
  if (candidate.kind === 'ring') {
    return `${candidate.data.symbol ?? '?'}${candidate.data.name ? ` · ${candidate.data.name}` : ''}`
  }
  if (candidate.kind === 'interval') return candidate.data.outputSymbol ?? '区间'
  if (candidate.kind === 'formula') return candidate.data.outputSymbol ?? '公式'
  return candidate.data.partName ?? '部件尺寸'
}

function numericFields(candidate: ExtractionCandidate): { field: string; value: QuantityValue }[] {
  const push = (
    field: string,
    value: QuantityValue | null,
    out: { field: string; value: QuantityValue }[],
  ): void => {
    if (value !== null) out.push({ field, value })
  }
  const out: { field: string; value: QuantityValue }[] = []
  if (candidate.kind === 'ring') {
    push('nominal', candidate.data.nominal, out)
    push('upperDeviation', candidate.data.upperDeviation, out)
    push('lowerDeviation', candidate.data.lowerDeviation, out)
  } else if (candidate.kind === 'interval') {
    push('lower', candidate.data.lower, out)
    push('upper', candidate.data.upper, out)
  } else if (candidate.kind === 'part-dimension') {
    push('innerDiameter', candidate.data.innerDiameter, out)
    push('outerDiameter', candidate.data.outerDiameter, out)
    push('length', candidate.data.length, out)
  }
  return out
}

function evidenceOf(candidate: ExtractionCandidate) {
  const all = [
    ...candidate.evidence,
    ...numericFields(candidate).flatMap((item) => item.value.evidence),
  ]
  const seen = new Set<string>()
  const out: typeof all = []
  for (const evidence of all) {
    const key = `${evidence.revisionId}#${evidence.page}#${evidence.rectPdf.join(',')}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(evidence)
  }
  return out
}

function nextRequestId(): string {
  const random = globalThis.crypto?.randomUUID
  return random !== undefined ? random.call(globalThis.crypto) : `extract-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function ExtractionReviewPanel({
  snapshot,
  busy,
  actions,
  readBytes,
}: ExtractionReviewPanelProps) {
  const revisions = snapshot.revisions
  const drafts = snapshot.project.extractionDrafts
  const [revisionId, setRevisionId] = useState(revisions[0]?.id ?? '')
  const [pageFrom, setPageFrom] = useState('1')
  const [pageTo, setPageTo] = useState(String(revisions[0]?.pageCount ?? 2))
  const [draftId, setDraftId] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Record<string, true>>({})
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [editing, setEditing] = useState<{ candidateId: string; field: EditableField; text: string } | null>(null)
  const [expandedDraftIds, setExpandedDraftIds] = useState<Record<string, true>>({})
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [locate, setLocate] = useState<
    { revisionId: string; page: number; rectPdf: readonly [number, number, number, number]; pageBoxPdf: readonly [number, number, number, number]; label: string } | null
  >(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, true>>({})
  const [unitFormOpen, setUnitFormOpen] = useState(false)
  const [unitStatement, setUnitStatement] = useState('')
  const [batchRunning, setBatchRunning] = useState<string | null>(null)

  // 同一 PDF 版本 + 同一页范围为一组；组内默认显示版本最高的草稿，其余折叠成旧草稿行。
  const scopes = useMemo(() => groupExtractionDrafts(drafts), [drafts])
  // 用户显式切换过的草稿必须仍存在且仍属于某个作用域；否则回落到第一个作用域的当前草稿。
  // 不写 effect 里同步 setState：这里只派生，不产生额外渲染。
  const selectedScope =
    scopes.find((scope) => scope.drafts.some((item) => item.draftId === draftId)) ?? scopes[0] ?? null
  const draft: ExtractionDraft | null = selectedScope?.current ?? null

  const revision = revisions.find((item) => item.id === revisionId) ?? null
  const sourceDocument = revision === null ? null : snapshot.documents.find((item) => item.id === revision.documentId) ?? null
  const outdated = revision !== null && sourceDocument !== null && sourceDocument.latestRevisionId !== revision.id
  const counts = useMemo(() => {
    const base = { pending: 0, blocked: 0, confirmed: 0, rejected: 0, stale: 0 }
    for (const candidate of draft?.candidates ?? []) base[candidate.status] += 1
    return base
  }, [draft])
  const grouping = useMemo(
    () => (draft === null ? null : groupConfirmCandidates(draft.candidates)),
    [draft],
  )
  const unitBatches = useMemo(
    () => (draft === null ? [] : activeUnitBatches(draft)),
    [draft],
  )
  /**
   * “仅差单位”批量补单位的目标集合：两个仅差单位组（单值 + 同符号多处）的全部成员。
   * 公式/数值/单位不支持与可确认组永远不在集合里。
   */
  const unitOnlyIds = useMemo(() => {
    if (grouping === null) return []
    return grouping.groups
      .filter((group) => group.capability === 'attest-unit')
      .flatMap((group) => [...batchUnitCandidateIds(group)])
  }, [grouping])
  const selectedIds = Object.keys(selected).filter((id) => draft?.candidates.some((candidate) => candidate.candidateId === id))

  async function run(): Promise<void> {
    if (running !== null) return
    setError('')
    setMessage('')
    const from = Number(pageFrom)
    const to = Number(pageTo)
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from) {
      setError('页范围无效：必须是 1-based 整数，且上限不小于下限。')
      return
    }
    const requestId = nextRequestId()
    setRunning(requestId)
    try {
      const outcome = await actions.onRun({ revisionId, pageFrom: from, pageTo: to, requestId })
      if (outcome === null) {
        setError('当前没有可写入的项目会话。')
        return
      }
      const result = outcome.result
      if (!result.ok) {
        setError(`${result.error.code}：${result.error.message}`)
        return
      }
      setMessage(
        result.value.unchanged
          ? `同一 PDF 版本/页范围/规则已提取过：候选 ${result.value.candidateCount} 条未变化，未产生重复候选。`
          : `提取完成：候选 ${result.value.candidateCount} 条（本次新增 ${result.value.addedCandidateCount} 条），全部待人工确认。`,
      )
    } finally {
      setRunning(null)
    }
  }

  async function decide(
    candidate: ExtractionCandidate,
    action: 'confirm' | 'reject' | 'edit' | 'revoke',
    extra: { reason?: string; field?: EditableField; text?: string } = {},
  ): Promise<void> {
    if (draft === null) return
    setError('')
    setMessage('')
    const result = await actions.onDecide({
      draftId: draft.draftId,
      candidateId: candidate.candidateId,
      editRevision: candidate.editRevision,
      action,
      ...(action === 'confirm' ? { confirmed: true as const } : {}),
      ...(action === 'reject' ? { reason: extra.reason } : {}),
      ...(action === 'edit' ? { field: extra.field, text: extra.text } : {}),
    })
    if (result === null) {
      setError('决定未写入：请检查错误提示或项目会话。')
      return
    }
    setMessage(
      action === 'confirm'
        ? `已确认候选 ${candidate.candidateId}（仅记录决定，不自动写入尺寸链/条款）。`
        : action === 'reject'
          ? `已拒绝候选 ${candidate.candidateId}；不会复活，也不进入项目。`
          : action === 'revoke'
            ? `已撤销候选 ${candidate.candidateId} 的确认；该候选回到待确认，同一符号其它处恢复可选。`
            : `已保存人工修改；该候选回到待确认，需要重新确认。`,
    )
    setRejecting(null)
    setRejectReason('')
    setEditing(null)
  }

  async function rejectSelected(): Promise<void> {
    if (draft === null || selectedIds.length === 0) return
    const reason = rejectReason.trim() === '' ? '批量拒绝' : rejectReason.trim()
    setError('')
    setMessage('')
    for (const candidateId of selectedIds) {
      const candidate = draft.candidates.find((item) => item.candidateId === candidateId)
      if (candidate === undefined) continue
      const result = await actions.onDecide({
        draftId: draft.draftId,
        candidateId,
        editRevision: candidate.editRevision,
        action: 'reject',
        reason,
      })
      if (result === null) {
        setError('批量拒绝中断：请检查错误提示。')
        return
      }
    }
    setSelected({})
    setMessage(`已批量拒绝 ${selectedIds.length} 条候选（逐条记录理由）。`)
  }

  /**
   * 批量确认：一次请求，main 逐条写决定。
   * 拒绝时把 main 的 message 原样显示（含“哪几条/哪个互斥组”），快照不动。
   */
  async function confirmBatch(ids: readonly string[], key: string): Promise<void> {
    if (draft === null || actions.onConfirmBatch === undefined || batchRunning !== null) return
    if (ids.length === 0) return
    setError('')
    setMessage('')
    setBatchRunning(key)
    try {
      const result = await actions.onConfirmBatch({ draftId: draft.draftId, candidateIds: [...ids] })
      if (result === null) {
        setError('批量确认未执行：请检查错误提示或项目会话。')
        return
      }
      if (!result.ok) {
        setError(`${result.error.code}：${result.error.message}`)
        return
      }
      setSelected({})
      setMessage(
        `已批量确认 ${result.value.decisions.length} 条：每条各有一条决定（未合并），决定仍可逐条撤销。`,
      )
    } finally {
      setBatchRunning(null)
    }
  }

  /** 批量补单位：user-attestation 的 statement 逐字来自输入框；任一条不合格整批拒绝。 */
  async function attestUnits(): Promise<void> {
    if (
      draft === null ||
      actions.onAttestUnits === undefined ||
      batchRunning !== null ||
      unitStatement.trim() === ''
    ) {
      return
    }
    setError('')
    setMessage('')
    setBatchRunning('attest-units')
    try {
      const result = await actions.onAttestUnits({
        draftId: draft.draftId,
        candidateIds: [...unitOnlyIds],
        statement: unitStatement,
      })
      if (result === null) {
        setError('批量补单位未执行：请检查错误提示或项目会话。')
        return
      }
      if (!result.ok) {
        setError(`${result.error.code}：${result.error.message}`)
        return
      }
      setUnitFormOpen(false)
      setUnitStatement('')
      setMessage(
        `已为 ${result.value.decisions.length} 条“仅差单位”候选补上 ${result.value.unitText}（逐条记 user-attestation，声明原话逐字保存）；补完仍是待确认，需要再确认。`,
      )
    } finally {
      setBatchRunning(null)
    }
  }

  /** 撤销补单位：整批（batchId）或逐条（candidateId）。 */
  async function revokeUnits(selector: { batchId?: string; candidateId?: string }): Promise<void> {
    if (draft === null || actions.onRevokeUnits === undefined || batchRunning !== null) return
    setError('')
    setMessage('')
    setBatchRunning(selector.batchId ?? selector.candidateId ?? 'revoke')
    try {
      const result = await actions.onRevokeUnits({ draftId: draft.draftId, ...selector })
      if (result === null) {
        setError('撤销补单位未执行：请检查错误提示或项目会话。')
        return
      }
      if (!result.ok) {
        setError(`${result.error.code}：${result.error.message}`)
        return
      }
      setMessage(
        `已撤销 ${result.value.decisions.length} 条补单位：单位回到未定，候选回到阻塞；出处只标撤销、原话保留。`,
      )
    } finally {
      setBatchRunning(null)
    }
  }

  /** 删除旧草稿：二次确认框里的按钮才会走到这里；失败零写入由 main 保证。 */
  async function deleteOldDraft(target: ExtractionDraft): Promise<void> {
    if (deleting !== null) return
    setError('')
    setMessage('')
    setDeleting(target.draftId)
    try {
      const result = await actions.onDeleteDraft({ draftId: target.draftId })
      if (result === null) {
        setError('删除未执行：请检查错误提示或项目会话。')
        return
      }
      setConfirmDeleteId(null)
      setExpandedDraftIds((current) => {
        const next = { ...current }
        delete next[target.draftId]
        return next
      })
      setSelected({})
      setMessage(
        `已删除旧草稿 ${target.draftId}（${target.extractorVersion}）：只删了这一份草稿，来源 PDF、条款、绑定与图纸未改动；保存项目后写入文件。`,
      )
    } finally {
      setDeleting(null)
    }
  }

  /**
   * 一行候选。`readOnlyReason` 非 null 时是旧规则版本草稿：取值/出处仍可看，
   * 确认/撤销/拒绝/编辑与批量选择一律禁用，只有定位到 PDF 选区可用。
   */
  function renderCandidate(
    candidate: ExtractionCandidate,
    owner: ExtractionDraft,
    readOnlyReason: string | null,
  ) {
    const readOnly = readOnlyReason !== null
    const evidence = evidenceOf(candidate)
    const firstEvidence = evidence[0]
    const canAct = !readOnly && !busy && candidate.status !== 'confirmed' && candidate.status !== 'rejected' && candidate.status !== 'stale'
    const occurrence = candidate.occurrence ?? null
    const groupMembers = candidate.kind === 'ring' && candidate.groupId !== null
      ? owner.candidates.filter((item) => item.kind === 'ring' && item.groupId === candidate.groupId)
      : []
    const confirmedSibling = groupMembers.length > 1
      ? groupMembers.find((item) => item.candidateId !== candidate.candidateId && item.status === 'confirmed')
      : undefined
    const groupConflict = confirmedSibling !== undefined
    const activeUnit = activeUnitAttestation(owner, { candidateId: candidate.candidateId })
    return (
      <li
        key={candidate.candidateId}
        data-status={candidate.status}
        data-readonly={readOnly ? 'true' : undefined}
        className={`extraction-review__candidate extraction-review__candidate--${candidate.status}`}
      >
        <div className="extraction-review__candidate-head">
          <input
            type="checkbox"
            aria-label={`选择候选 ${candidate.candidateId}`}
            checked={selected[candidate.candidateId] === true}
            disabled={readOnly || candidate.status === 'confirmed' || candidate.status === 'rejected'}
            onChange={(event) => {
              setSelected((current) => {
                const next = { ...current }
                if (event.target.checked) next[candidate.candidateId] = true
                else delete next[candidate.candidateId]
                return next
              })
            }}
          />
          <strong>{KIND_LABEL[candidate.kind]} · {candidateTitle(candidate)}</strong>
          <span className={`extraction-review__badge extraction-review__badge--${candidate.status}`}>
            {STATUS_LABEL[candidate.status]}
          </span>
          {occurrence !== null && occurrence.total > 1 && (
            <span className="extraction-review__occurrence">
              同一符号第 {occurrence.index}/{occurrence.total} 处
            </span>
          )}
          <span className="extraction-review__confidence">置信 {candidate.confidence}</span>
        </div>
        {readOnly && (
          <p className="extraction-review__readonly" role="note">{readOnlyReason}</p>
        )}
        {occurrence !== null && occurrence.total > 1 && (
          <p className="extraction-review__group-hint">
            同一符号只能确认一处；
            {confirmedSibling === undefined
              ? '确认一处后其余处不可再确认，需要先撤销。'
              : `已确认第 ${confirmedSibling.occurrence?.index ?? '?'}/${confirmedSibling.occurrence?.total ?? '?'} 处，需先撤销该确认才能选此处。`}
          </p>
        )}
        <p className="extraction-review__raw">原文：{candidate.rawText}</p>
        <p className="extraction-review__evidence">
          第 {candidate.page} 页
          {firstEvidence !== undefined
            ? ` · 选区 PDF 点 ${formatRect(firstEvidence.rectPdf)} · 页框 ${formatRect(firstEvidence.pageBoxPdf)} · 片段「${firstEvidence.textSnippet}」· item ${firstEvidence.textItemIndexes.join(',')}`
            : ' · 无选区出处'}
        </p>
        <p className="extraction-review__values">
          {numericFields(candidate).length === 0
            ? '无数值字段（仅保留原文与结构）'
            : numericFields(candidate)
                .map(({ field, value }) => `${FIELD_LABEL[field] ?? field}=${value.text}${value.unitText ? ` ${value.unitText}` : ''}${value.unit === null ? '（单位未确认）' : ''}`)
                .join(' · ')}
        </p>
        {candidate.reasonCodes.length > 0 && (
          <p className="extraction-review__reasons">原因码：{candidate.reasonCodes.join('、')}</p>
        )}
        {(() => {
          const decision = [...owner.decisions]
            .filter(
              (item) =>
                item.candidateId === candidate.candidateId &&
                item.invalidatedByEditRevision === null,
            )
            .at(-1)
          if (decision === undefined) return null
          const actionLabel =
            decision.action === 'confirm'
              ? '确认'
              : decision.action === 'reject'
                ? '拒绝'
                : decision.action === 'revoke'
                  ? '撤销确认'
                  : decision.action === 'attest-unit'
                    ? '补单位（用户声明）'
                    : '人工修改'
          return (
            <p className="extraction-review__decision">
              决定：{actionLabel} · {decision.actor} · {decision.decidedAt}
              {decision.reason === null ? '' : ` · 理由：${decision.reason}`}
            </p>
          )
        })()}
        <div className="extraction-review__actions">
          <button
            type="button"
            disabled={firstEvidence === undefined}
            onClick={() => {
              if (firstEvidence === undefined) return
              setLocate({
                revisionId: firstEvidence.revisionId,
                page: firstEvidence.page,
                rectPdf: firstEvidence.rectPdf,
                pageBoxPdf: firstEvidence.pageBoxPdf,
                label: candidateTitle(candidate),
              })
            }}
          >
            定位到 PDF 选区
          </button>
          <button
            type="button"
            disabled={!canAct || candidate.status === 'blocked' || groupConflict}
            title={
              readOnly
                ? readOnlyReason ?? undefined
                : candidate.status === 'blocked'
                  ? '阻塞候选必须先解决原因码，不能确认'
                  : groupConflict
                    ? `同一符号已确认第 ${confirmedSibling?.occurrence?.index ?? '?'} 处；同一符号只能确认一处，请先撤销该确认`
                    : undefined
            }
            onClick={() => void decide(candidate, 'confirm')}
          >
            确认
          </button>
          {!readOnly && candidate.status === 'confirmed' && (
            <button
              type="button"
              disabled={busy}
              title="撤销后该候选回到待确认，同一符号其它处恢复可选"
              onClick={() => void decide(candidate, 'revoke')}
            >
              撤销确认
            </button>
          )}
          {!readOnly && activeUnit !== null && actions.onRevokeUnits !== undefined && (
            <button
              type="button"
              disabled={busy || batchRunning !== null || candidate.status === 'confirmed'}
              title={
                candidate.status === 'confirmed'
                  ? '该候选已确认，撤销补单位会破坏确认依据；请先撤销确认'
                  : `撤销这一条补单位（声明「${activeUnit.reason ?? ''}」）；出处只标撤销、原话保留`
              }
              onClick={() => void revokeUnits({ candidateId: candidate.candidateId })}
            >
              撤销补单位
            </button>
          )}
          <button
            type="button"
            disabled={!canAct}
            title={readOnly ? readOnlyReason ?? undefined : undefined}
            onClick={() => { setRejecting(candidate.candidateId); setRejectReason('') }}
          >
            拒绝…
          </button>
          {numericFields(candidate).length > 0 && (
            <button
              type="button"
              disabled={!canAct}
              title={readOnly ? readOnlyReason ?? undefined : undefined}
              onClick={() => {
                const first = numericFields(candidate)[0]
                if (first === undefined) return
                setEditing({ candidateId: candidate.candidateId, field: first.field as EditableField, text: first.value.text })
              }}
            >
              编辑…
            </button>
          )}
        </div>
        {rejecting === candidate.candidateId && (
          <div className="extraction-review__inline" role="group" aria-label="拒绝理由">
            <input
              aria-label="拒绝理由"
              value={rejectReason}
              placeholder="必须填写拒绝理由"
              onChange={(event) => setRejectReason(event.target.value)}
            />
            <button
              type="button"
              disabled={rejectReason.trim() === ''}
              onClick={() => void decide(candidate, 'reject', { reason: rejectReason.trim() })}
            >
              确认拒绝
            </button>
            <button type="button" onClick={() => setRejecting(null)}>取消</button>
          </div>
        )}
        {editing?.candidateId === candidate.candidateId && (
          <div className="extraction-review__inline" role="group" aria-label="编辑候选">
            <select
              aria-label="编辑字段"
              value={editing.field}
              onChange={(event) => setEditing({ ...editing, field: event.target.value as EditableField })}
            >
              {numericFields(candidate).map(({ field }) => (
                <option key={field} value={field}>{FIELD_LABEL[field] ?? field}</option>
              ))}
            </select>
            <input
              aria-label="编辑数值"
              value={editing.text}
              onChange={(event) => setEditing({ ...editing, text: event.target.value })}
            />
            <button
              type="button"
              onClick={() => void decide(candidate, 'edit', { field: editing.field, text: editing.text })}
            >
              保存修改
            </button>
            <button type="button" onClick={() => setEditing(null)}>取消</button>
            <span className="extraction-review__hint">只接受 mm，且改后写法必须出现在该字段原文片段里；否则请拒绝后走人工录入。</span>
          </div>
        )}
      </li>
    )
  }

  const locateRevision = locate === null
    ? null
    : revisions.find((item) => item.id === locate.revisionId) ?? null
  const locateHighlight = locate === null || locateRevision === null
    ? null
    : {
        id: `extraction:${locate.revisionId}:${locate.page}:${locate.rectPdf.join(',')}`,
        projectId: snapshot.project.id,
        termId: '__extraction__',
        revisionId: locate.revisionId,
        documentId: locateRevision.documentId,
        page: locate.page,
        rectPdf: locate.rectPdf as [number, number, number, number],
        pageBoxPdf: locate.pageBoxPdf as [number, number, number, number],
        note: `提取候选选区 · ${locate.label}`,
        createdAt: '',
        reviewedTermRevision: null,
        reviewedAt: null,
        historicalAcceptance: null,
      }

  return (
    <div className="extraction-review">
      <h2>任务书提取（待人工确认）</h2>
      <p className="extraction-review__truth">
        本功能只做<strong>带文本层 PDF</strong>，
        不做 OCR、DOCX、图片识别或联网识别。样本覆盖：<strong>只验证过 1 份自造样例</strong>
        （TB-2026-1110，2 页）；真实外部任务书、复杂表格/分栏/字体编码尚未验证。
        当前规则版本见下方「当前显示」。
      </p>
      <p className="extraction-review__truth">
        提取结果只是隔离草稿：候选<strong>未确认前不参与任何计算</strong>，不写项目 target、不建条款版本、
        不改绑定、不自动提交。确认/拒绝决定随项目文件保存（schema 8），关闭重开仍可追溯。
      </p>

      {revisions.length === 0 ? (
        <p role="status">项目中还没有来源 PDF。请先在「来源 PDF」页导入带文本层的任务书。</p>
      ) : (
        <section aria-label="提取范围">
          <label>
            来源版本
            <select
              aria-label="提取来源版本"
              value={revisionId}
              disabled={busy || running !== null}
              onChange={(event) => {
                const next = revisions.find((item) => item.id === event.target.value)
                setRevisionId(event.target.value)
                if (next !== null && next !== undefined) setPageTo(String(next.pageCount))
              }}
            >
              {revisions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.fileName} · {item.id} · {item.pageCount} 页
                </option>
              ))}
            </select>
          </label>
          <label>
            起始页
            <input
              aria-label="提取起始页"
              inputMode="numeric"
              value={pageFrom}
              disabled={busy || running !== null}
              onChange={(event) => setPageFrom(event.target.value)}
            />
          </label>
          <label>
            结束页
            <input
              aria-label="提取结束页"
              inputMode="numeric"
              value={pageTo}
              disabled={busy || running !== null}
              onChange={(event) => setPageTo(event.target.value)}
            />
          </label>
          <button type="button" onClick={() => void run()} disabled={busy || running !== null}>
            {running === null ? '提取候选' : '提取中…'}
          </button>
          {running !== null && (
            <button
              type="button"
              onClick={() => {
                void actions.onCancel(running)
                setRunning(null)
                setMessage('已请求取消；main 会在当前页之后停止，未完成的提取不写入。')
              }}
            >
              取消提取
            </button>
          )}
          <span className="extraction-review__hint">
            新提取使用规则版本 <code>{EXTRACTOR_VERSION}</code>。
          </span>
          {outdated && (
            <p role="alert" className="extraction-review__warning">
              当前选择的是旧版本（latest 为 {sourceDocument?.latestRevisionId}）。提取只读这个确切版本，不会自动改用 latest。
            </p>
          )}
        </section>
      )}

      {message !== '' && <p role="status" className="extraction-review__message">{message}</p>}
      {error !== '' && <p role="alert" className="extraction-review__error">{error}</p>}

      {scopes.length > 0 && selectedScope !== null && draft !== null && (
        <section aria-label="提取草稿">
          {scopes.length > 1 && (
            <div className="extraction-review__drafts">
              {scopes.map((scope) => (
                <button
                  key={scope.key}
                  type="button"
                  aria-pressed={scope.key === selectedScope.key}
                  onClick={() => setDraftId(scope.current.draftId)}
                >
                  草稿 {scope.current.draftId.slice(0, 14)} · {extractorVersionLabel(scope.current.extractorVersion)} · 第 {scope.current.pageRange.from}–{scope.current.pageRange.to} 页
                </button>
              ))}
            </div>
          )}
          <p className="extraction-review__current" data-testid="extraction-current-draft">
            当前显示：<code>{draft.extractorVersion}</code> · 草稿 <code>{draft.draftId}</code> · 第 {draft.pageRange.from}–{draft.pageRange.to} 页
            {selectedScope.superseded.length > 0
              ? `（该范围另有 ${selectedScope.superseded.length} 份旧草稿已折叠，只读）`
              : ''}
          </p>
          <p className="extraction-review__meta">
            确切 PDF 版本 <code>{draft.sourceIdentity.revisionId}</code> · SHA-256{' '}
            <code>{draft.sourceIdentity.sha256.slice(0, 12)}…</code> · 页范围 {draft.pageRange.from}–{draft.pageRange.to}
          </p>
          <p className="extraction-review__counts">
            待确认 {counts.pending} · 阻塞 {counts.blocked} · 已确认 {counts.confirmed} · 已拒绝 {counts.rejected}
            {counts.stale > 0 ? ` · 已失效 ${counts.stale}` : ''}
          </p>
          {draft.issues.length > 0 && (
            <ul className="extraction-review__issues" aria-label="提取问题">
              {draft.issues.map((issue) => (
                <li key={issue.issueId} data-severity={issue.severity}>
                  {issue.code}：{issue.message}
                  {issue.page === null ? '' : `（第 ${issue.page} 页）`}
                </li>
              ))}
            </ul>
          )}
          {grouping !== null && (
            <section className="extraction-review__groups" aria-label="按原因码分组">
              <p className="extraction-review__groups-title">
                按原因码分组（组内按页/位置固定顺序，两次打开一致）
              </p>
              <p className="extraction-review__groups-line" data-testid="group-summary-confirmable">
                可确认 {grouping.counts.pending}：
                单值 {grouping.counts.confirmableSingle}（可批量确认）·
                同符号多处 {grouping.counts.confirmableMulti}（
                {grouping.pendingIndividualDecisions} 组，只能人工选一处）
              </p>
              <p className="extraction-review__groups-line" data-testid="group-summary-units">
                仅差单位 {grouping.counts.unitOnlySingle + grouping.counts.unitOnlyMulti}：
                单值 {grouping.counts.unitOnlySingle} · 同符号多处 {grouping.counts.unitOnlyMulti}
                {actions.onAttestUnits !== undefined && unitOnlyIds.length > 0 && (
                  <>
                    {' '}
                    <button
                      type="button"
                      disabled={busy || batchRunning !== null}
                      onClick={() => {
                        setUnitFormOpen((current) => !current)
                        setError('')
                        setMessage('')
                      }}
                    >
                      批量补单位（{unitOnlyIds.length} 条）…
                    </button>
                  </>
                )}
              </p>
              {unitFormOpen && actions.onAttestUnits !== undefined && (
                <div className="extraction-review__inline" role="group" aria-label="批量补单位">
                  <input
                    aria-label="单位声明"
                    value={unitStatement}
                    placeholder="例：本表单位 mm"
                    onChange={(event) => setUnitStatement(event.target.value)}
                  />
                  <button
                    type="button"
                    disabled={unitStatement.trim() === '' || batchRunning !== null || busy}
                    onClick={() => void attestUnits()}
                  >
                    确认补单位（{unitOnlyIds.length} 条）
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUnitFormOpen(false)
                      setUnitStatement('')
                    }}
                  >
                    取消
                  </button>
                  <span className="extraction-review__hint">
                    只补「仅差单位」两组；声明原话逐字存入 user-attestation。任一条不是“仅差单位”会整批拒绝并指出是哪几条。
                    公式/数值/单位不支持三类不在批量范围内。
                  </span>
                </div>
              )}
              <p className="extraction-review__groups-line" data-testid="group-summary-blocked">
                阻塞其余 {grouping.counts.blocked - grouping.counts.unitOnlySingle - grouping.counts.unitOnlyMulti}：
                {grouping.counts.blockedByCode
                  .map((item) => `${item.code} ${item.count}`)
                  .join(' · ')}
                （公式不支持 / 数值不支持 / 单位不支持只能补原文或放弃，不提供批量动作）
              </p>
              {unitBatches.length > 0 && (
                <div className="extraction-review__unit-batches" role="group" aria-label="补单位批次">
                  {unitBatches.map((batch) => (
                    <div key={batch.batchId} className="extraction-review__unit-batch">
                      <span>
                        补单位批次 {batch.batchId.slice(0, 18)}… · {batch.candidateIds.length} 条 · 声明「
                        {batch.statement}」
                      </span>
                      {actions.onRevokeUnits !== undefined && (
                        <button
                          type="button"
                          disabled={busy || batchRunning !== null}
                          onClick={() => void revokeUnits({ batchId: batch.batchId })}
                        >
                          整批撤销
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          <div className="extraction-review__batch">
            <span>已选 {selectedIds.length} 项</span>
            {actions.onConfirmBatch !== undefined && (
              <button
                type="button"
                onClick={() => void confirmBatch(selectedIds, 'confirm-selected')}
                disabled={busy || batchRunning !== null || selectedIds.length === 0}
              >
                批量确认选中项
              </button>
            )}
            <button type="button" onClick={() => void rejectSelected()} disabled={busy || selectedIds.length === 0}>
              批量拒绝选中项
            </button>
            <span className="extraction-review__hint">
              批量确认逐条写决定；选中任何“同符号多处赋值”的候选会被整批拒绝（0 条写入）。
              阻塞候选不能批量确认，只能补原文或放弃。
            </span>
          </div>
          <ul className="extraction-review__candidates" aria-label="提取候选列表">
            {grouping === null
              ? draft.candidates.map((candidate) => renderCandidate(candidate, draft, null))
              : grouping.groups.map((group) => {
                  const collapsed = collapsedGroups[group.key] === true
                  const batchIds = batchConfirmCandidateIds(group)
                  return (
                    <Fragment key={group.key}>
                      <li role="presentation" className="extraction-review__group-head">
                        <button
                          type="button"
                          aria-expanded={!collapsed}
                          aria-label={`${collapsed ? '展开' : '折叠'} ${group.title}`}
                          onClick={() =>
                            setCollapsedGroups((current) => {
                              const next = { ...current }
                              if (collapsed) delete next[group.key]
                              else next[group.key] = true
                              return next
                            })
                          }
                        >
                          {collapsed ? '▸' : '▾'} {group.title}
                        </button>
                        {group.capability === 'confirm' && actions.onConfirmBatch !== undefined && (
                          <button
                            type="button"
                            disabled={busy || batchRunning !== null || batchIds.length === 0}
                            onClick={() => void confirmBatch(batchIds, `group:${group.key}`)}
                          >
                            本组全部确认（{batchIds.length} 条）
                          </button>
                        )}
                        <span className="extraction-review__group-hint">{group.hint}</span>
                      </li>
                      {!collapsed &&
                        group.candidates.map((candidate) => renderCandidate(candidate, draft, null))}
                    </Fragment>
                  )
                })}
          </ul>

          {selectedScope.superseded.length > 0 && (
            <section aria-label="旧规则版本草稿" className="extraction-review__superseded">
              <h3>旧草稿（折叠，只读）</h3>
              {selectedScope.superseded.map((old) => {
                const expanded = expandedDraftIds[old.draftId] === true
                const confirmedCount = activeConfirmedDecisionCount(old)
                const deletable = canDeleteDraft(old, drafts)
                const older = compareExtractorVersions(old.extractorVersion, draft.extractorVersion) < 0
                const readOnlyReason = older
                  ? `旧规则版本，请在新版（${draft.extractorVersion}）上复核后确认：此处只读，确认/编辑/拒绝均不可用。`
                  : `非当前草稿（同版本重复），请在新版（${draft.extractorVersion}）上复核后确认：此处只读，确认/编辑/拒绝均不可用。`
                return (
                  <div key={old.draftId} className="extraction-review__superseded-row">
                    <p className="extraction-review__superseded-headline">
                      {older
                        ? `旧规则版本（${old.extractorVersion}）· 共 ${old.candidates.length} 条候选${confirmedCount > 0 ? `（已确认 ${confirmedCount}）` : ''}${confirmedCount > 0 ? '' : ' '}· 已被 ${extractorVersionLabel(draft.extractorVersion)} 取代`
                        : `同版本重复草稿（${old.extractorVersion}）· 共 ${old.candidates.length} 条候选${confirmedCount > 0 ? `（已确认 ${confirmedCount}）` : ''}${confirmedCount > 0 ? '' : ' '}· 未删除，仅供对照`}
                    </p>
                    <div className="extraction-review__actions">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setExpandedDraftIds((current) => {
                          const next = { ...current }
                          if (expanded) delete next[old.draftId]
                          else next[old.draftId] = true
                          return next
                        })}
                      >
                        {expanded ? '收起旧草稿候选' : '展开查看旧草稿候选'}
                      </button>
                      {deletable && (
                        <button
                          type="button"
                          disabled={busy || deleting !== null}
                          onClick={() => setConfirmDeleteId(old.draftId)}
                        >
                          删除该旧草稿…
                        </button>
                      )}
                    </div>
                    {confirmDeleteId === old.draftId && (
                      <div className="extraction-review__inline" role="group" aria-label="删除旧草稿确认">
                        <p role="alert">
                          {confirmedCount > 0
                            ? `该草稿有 ${confirmedCount} 条已确认决定，删除后不可恢复；`
                            : '该草稿无已确认决定；'}
                          只删除该草稿的候选与决定，来源 PDF、条款、绑定与图纸不受影响。
                        </p>
                        <button
                          type="button"
                          disabled={busy || deleting === old.draftId}
                          onClick={() => void deleteOldDraft(old)}
                        >
                          确认删除
                        </button>
                        <button type="button" onClick={() => setConfirmDeleteId(null)}>取消</button>
                      </div>
                    )}
                    {expanded && (
                      <ul
                        className="extraction-review__candidates"
                        aria-label={`旧草稿候选列表 ${old.draftId}`}
                      >
                        {old.candidates.map((candidate) => renderCandidate(candidate, old, readOnlyReason))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </section>
          )}
        </section>
      )}

      {locate !== null && (
        <section aria-label="PDF 选区定位" className="extraction-review__locate">
          <p data-testid="extraction-locate-summary">
            已定位 {locate.label} · 来源 PDF {locate.revisionId} 第 {locate.page} 页 · 选区 PDF 点 {formatRect(locate.rectPdf)}
          </p>
          {locateRevision !== null && readBytes !== undefined ? (
            <PdfViewer
              readOnly
              revision={locateRevision}
              bindings={locateHighlight === null ? [] : [locateHighlight]}
              selectedTermId="__extraction__"
              page={locate.page}
              zoom={1}
              rotation={0}
              onPageChange={() => undefined}
              onZoomChange={() => undefined}
              onRotationChange={() => undefined}
              loadBytes={readBytes}
              onSaveBinding={async () => ({ ok: false, message: '提取定位为只读' })}
            />
          ) : (
            <p role="status">定位只显示坐标摘要（当前环境未提供 PDF 渲染）。</p>
          )}
        </section>
      )}
    </div>
  )
}
