/**
 * V3.6：任务书 PDF 提取审阅面板。
 *
 * 只做展示与显式动作请求：
 * - 候选逐条显示类型/原文/页/选区/原因码，并明确区分待确认、阻塞、已确认、已拒绝；
 * - 确认必须逐条点击，没有默认勾选，也不提供“全部确认”（任务卡 §4.2）；
 * - 拒绝必须填理由；批量操作只支持批量拒绝；
 * - 未确认/阻塞候选永远不会被展示成已应用，也不会影响尺寸链计算（计算不读候选）；
 * - 界面如实显示 extractorVersion、样本覆盖限制与“不做 OCR/DOCX”。
 */
import { useMemo, useState } from 'react'
import type {
  ExtractionCancelValue,
  ExtractionDecideValue,
  ExtractionRunValue,
  IpcResult,
  SnapshotDto,
} from '../../desktop/shared/contracts'
import {
  EXTRACTOR_VERSION,
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
  const [draftId, setDraftId] = useState<string | null>(drafts[0]?.draftId ?? null)
  const [running, setRunning] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Record<string, true>>({})
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [editing, setEditing] = useState<{ candidateId: string; field: EditableField; text: string } | null>(null)
  const [locate, setLocate] = useState<
    { revisionId: string; page: number; rectPdf: readonly [number, number, number, number]; pageBoxPdf: readonly [number, number, number, number]; label: string } | null
  >(null)

  // 会话/草稿变化后保持选择可用：选中的草稿不存在时派生为第一份（不写状态，
  // 避免 effect 里同步 setState）。
  const effectiveDraftId =
    draftId !== null && drafts.some((draft) => draft.draftId === draftId)
      ? draftId
      : (drafts[0]?.draftId ?? null)

  const revision = revisions.find((item) => item.id === revisionId) ?? null
  const sourceDocument = revision === null ? null : snapshot.documents.find((item) => item.id === revision.documentId) ?? null
  const outdated = revision !== null && sourceDocument !== null && sourceDocument.latestRevisionId !== revision.id
  const draft: ExtractionDraft | null = drafts.find((item) => item.draftId === effectiveDraftId) ?? null
  const counts = useMemo(() => {
    const base = { pending: 0, blocked: 0, confirmed: 0, rejected: 0, stale: 0 }
    for (const candidate of draft?.candidates ?? []) base[candidate.status] += 1
    return base
  }, [draft])
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
        规则版本 <code>{draft?.extractorVersion ?? EXTRACTOR_VERSION}</code>；本功能只做<strong>带文本层 PDF</strong>，
        不做 OCR、DOCX、图片识别或联网识别。样本覆盖：<strong>只验证过 1 份自造样例</strong>
        （TB-2026-1110，2 页）；真实外部任务书、复杂表格/分栏/字体编码尚未验证。
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
          {outdated && (
            <p role="alert" className="extraction-review__warning">
              当前选择的是旧版本（latest 为 {sourceDocument?.latestRevisionId}）。提取只读这个确切版本，不会自动改用 latest。
            </p>
          )}
        </section>
      )}

      {message !== '' && <p role="status" className="extraction-review__message">{message}</p>}
      {error !== '' && <p role="alert" className="extraction-review__error">{error}</p>}

      {drafts.length > 0 && (
        <section aria-label="提取草稿">
          <div className="extraction-review__drafts">
            {drafts.map((item) => (
              <button
                key={item.draftId}
                type="button"
                aria-pressed={item.draftId === effectiveDraftId}
                onClick={() => setDraftId(item.draftId)}
              >
                草稿 {item.draftId.slice(0, 14)} · 第 {item.pageRange.from}–{item.pageRange.to} 页 · {item.extractorVersion}
              </button>
            ))}
          </div>
          {draft !== null && (
            <>
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
              <div className="extraction-review__batch">
                <span>已选 {selectedIds.length} 项</span>
                <button type="button" onClick={() => void rejectSelected()} disabled={busy || selectedIds.length === 0}>
                  批量拒绝选中项
                </button>
                <span className="extraction-review__hint">不提供批量确认：每条必须单独核对原文后确认。</span>
              </div>
              <ul className="extraction-review__candidates" aria-label="提取候选列表">
                {draft.candidates.map((candidate) => {
                  const evidence = evidenceOf(candidate)
                  const firstEvidence = evidence[0]
                  const canAct = !busy && candidate.status !== 'confirmed' && candidate.status !== 'rejected' && candidate.status !== 'stale'
                  const occurrence = candidate.occurrence ?? null
                  const groupMembers = candidate.kind === 'ring' && candidate.groupId !== null
                    ? draft.candidates.filter((item) => item.kind === 'ring' && item.groupId === candidate.groupId)
                    : []
                  const confirmedSibling = groupMembers.length > 1
                    ? groupMembers.find((item) => item.candidateId !== candidate.candidateId && item.status === 'confirmed')
                    : undefined
                  const groupConflict = confirmedSibling !== undefined
                  return (
                    <li
                      key={candidate.candidateId}
                      data-status={candidate.status}
                      className={`extraction-review__candidate extraction-review__candidate--${candidate.status}`}
                    >
                      <div className="extraction-review__candidate-head">
                        <input
                          type="checkbox"
                          aria-label={`选择候选 ${candidate.candidateId}`}
                          checked={selected[candidate.candidateId] === true}
                          disabled={candidate.status === 'confirmed' || candidate.status === 'rejected'}
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
                        const decision = [...draft.decisions]
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
                            candidate.status === 'blocked'
                              ? '阻塞候选必须先解决原因码，不能确认'
                              : groupConflict
                                ? `同一符号已确认第 ${confirmedSibling?.occurrence?.index ?? '?'} 处；同一符号只能确认一处，请先撤销该确认`
                                : undefined
                          }
                          onClick={() => void decide(candidate, 'confirm')}
                        >
                          确认
                        </button>
                        {candidate.status === 'confirmed' && (
                          <button
                            type="button"
                            disabled={busy}
                            title="撤销后该候选回到待确认，同一符号其它处恢复可选"
                            onClick={() => void decide(candidate, 'revoke')}
                          >
                            撤销确认
                          </button>
                        )}
                        <button type="button" disabled={!canAct} onClick={() => { setRejecting(candidate.candidateId); setRejectReason('') }}>
                          拒绝…
                        </button>
                        {numericFields(candidate).length > 0 && (
                          <button
                            type="button"
                            disabled={!canAct}
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
                })}
              </ul>
            </>
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
