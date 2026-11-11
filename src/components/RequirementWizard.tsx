import { MmInput } from './MmInput'
/**
 * V3.5：任务书条款向导（复核区入口）。
 *
 * 固定顺序：选 PDF 确切版本 → 页码 → 框选 → 粘贴原文 → 上下限 mm → 当前唯一
 * 轴向链 → 对比原项目 target → 显式确认。界面只收集用户确认的输入；判定与
 * 版本化由 main 的 requirement:confirm 完成。未确认表单会登记到 main，使当前
 * 检查显示“待确认”，但不写入正式条款。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SnapshotDto } from '../../desktop/shared/contracts'
import type { RequirementRevision } from '../requirements/types'
import type { SourceRevision } from '../sources/types'
import { formatMm, tryParseMm } from '../domain/units'
import { PdfViewer } from './PdfViewer'
import { calculateChain } from '../domain/calculate'
import { draftToChain } from '../workspace/draft'
import './RequirementWizard.css'

export interface RequirementWizardProps {
  snapshot: SnapshotDto
  sessionId: string
  /** 当前活动条款（更新时预填）。 */
  active: RequirementRevision | null
  /** 当前预览中的条款检查（可选，用于展示两组结果）。 */
  previewRequirement:
    | import('../../desktop/shared/contracts').RequirementPreviewValue
    | null
  onStageEdit: (
    edit: import('../requirements/types').RequirementEditDraft | null,
  ) => Promise<unknown>
  onConfirm: (input: {
    baseToken: string
    expectedActiveRequirementRevisionId: string | null
    requirementId: string | null
    source: {
      documentId: string
      revisionId: string
      page: number
      rectPdf: [number, number, number, number]
      pageBoxPdf: [number, number, number, number]
    }
    confirmedText: string
    lowerText: string
    upperText: string
    changeReason: string
  }) => Promise<{ ok: boolean } | null>
  onClose: () => void
}

type Rect = [number, number, number, number]

function defaultDocument(snapshot: SnapshotDto): { documentId: string; revisionId: string } | null {
  const document = snapshot.documents.find((item) => item.latestRevisionId !== '')
  if (document === undefined) return null
  return { documentId: document.id, revisionId: document.latestRevisionId }
}

export function RequirementWizard(props: RequirementWizardProps) {
  const { snapshot, active } = props
  const documents = snapshot.documents
  const initial = useMemo(() => {
    if (active !== null) {
      return {
        documentId: active.source.documentId,
        revisionId: active.source.revisionId,
        page: active.source.page,
        rect: [...active.source.rectPdf] as Rect,
        pageBox: [...active.source.pageBoxPdf] as Rect,
        text: active.confirmedText,
        lower: formatMm(active.lowerQ).replace(/\.?0+$/, ''),
        upper: formatMm(active.upperQ).replace(/\.?0+$/, ''),
      }
    }
    const fallback = defaultDocument(snapshot)
    return {
      documentId: fallback?.documentId ?? '',
      revisionId: fallback?.revisionId ?? '',
      page: 1,
      rect: null as Rect | null,
      pageBox: null as Rect | null,
      text: '',
      lower: '',
      upper: '',
    }
  }, [active, snapshot])

  const [documentId, setDocumentId] = useState(initial.documentId)
  const [revisionId, setRevisionId] = useState(initial.revisionId)
  const [page, setPage] = useState(initial.page)
  const [rect, setRect] = useState<Rect | null>(initial.rect)
  const [pageBox, setPageBox] = useState<Rect | null>(initial.pageBox)
  const [text, setText] = useState(initial.text)
  const [lower, setLower] = useState(initial.lower)
  const [upper, setUpper] = useState(initial.upper)
  const [changeReason, setChangeReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [baseToken, setBaseToken] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [selectionHint, setSelectionHint] = useState('')

  const editRevision = useRef(0)
  const stageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  const latest = useRef({ documentId, revisionId, page, rect, pageBox, text, lower, upper })
  useEffect(() => {
    latest.current = { documentId, revisionId, page, rect, pageBox, text, lower, upper }
  }, [documentId, revisionId, page, rect, pageBox, text, lower, upper])

  const revisionsOfDocument = snapshot.revisions.filter(
    (item) => item.documentId === documentId,
  )
  const revision = snapshot.revisions.find((item) => item.id === revisionId) ?? null
  const document = snapshot.documents.find((item) => item.id === documentId) ?? null
  const needsNewVersion =
    active !== null &&
    document !== null &&
    document.latestRevisionId !== active.confirmedAgainstLatestRevisionId

  function scheduleStage(): void {
    if (stageTimer.current !== null) clearTimeout(stageTimer.current)
    stageTimer.current = setTimeout(() => {
      stageTimer.current = null
      const current = latest.current
      editRevision.current += 1
      void props
        .onStageEdit({
          requirementId: active?.requirementId ?? null,
          editRevision: editRevision.current,
          confirmedText: current.text,
          lowerText: current.lower,
          upperText: current.upper,
          source: {
            documentId: current.documentId === '' ? null : current.documentId,
            revisionId: current.revisionId === '' ? null : current.revisionId,
            page: current.rect === null ? null : current.page,
            rectPdf: current.rect,
            pageBoxPdf: current.pageBox,
          },
        })
        .then((result) => {
          if (!mounted.current) return
          const value = result as { ok?: boolean; value?: { baseToken?: string } } | null
          if (value?.ok === true && value.value?.baseToken !== undefined) {
            setBaseToken(value.value.baseToken)
          }
        })
    }, 250)
  }

  useEffect(() => () => {
    mounted.current = false
    if (stageTimer.current !== null) clearTimeout(stageTimer.current)
  }, [])

  const lowerParsed = tryParseMm(lower)
  const upperParsed = tryParseMm(upper)
  const boundsOk =
    lowerParsed.ok && upperParsed.ok && lowerParsed.value <= upperParsed.value
  const target = snapshot.project.dimensionChain.target
  const draftChain = snapshot.draft ? draftToChain(snapshot.draft) : null
  const targetResult =
    draftChain !== null && draftChain.ok ? calculateChain(draftChain.chain) : null

  const canConfirm =
    baseToken !== null &&
    revision !== null &&
    rect !== null &&
    pageBox !== null &&
    text.trim() !== '' &&
    boundsOk &&
    confirmed &&
    (active === null || changeReason.trim() !== '')

  function reloadForDocument(nextDocumentId: string): void {
    const nextDocument = snapshot.documents.find((item) => item.id === nextDocumentId)
    setDocumentId(nextDocumentId)
    setRevisionId(nextDocument?.latestRevisionId ?? '')
    setRect(null)
    setPageBox(null)
    setPage(1)
    setSelectionHint('')
    scheduleStage()
  }

  async function loadBytes(sourceRevision: SourceRevision): Promise<Uint8Array> {
    if (!window.cunlian) throw new Error('window.cunlian 不可用')
    const result = await window.cunlian.readAttachment({
      sessionId: props.sessionId,
      revisionId: sourceRevision.id,
    })
    if (!result.ok) throw new Error(`附件不可用 · ${result.error.code}：${result.error.message}`)
    return result.value.bytes
  }

  async function submit(): Promise<void> {
    if (!canConfirm || baseToken === null || revision === null || rect === null || pageBox === null) {
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const result = await props.onConfirm({
        baseToken,
        expectedActiveRequirementRevisionId:
          snapshot.project.activeRequirementRevisionId,
        requirementId: active?.requirementId ?? null,
        source: {
          documentId: revision.documentId,
          revisionId: revision.id,
          page,
          rectPdf: rect,
          pageBoxPdf: pageBox,
        },
        confirmedText: text,
        lowerText: lower,
        upperText: upper,
        changeReason,
      })
      if (result?.ok === true) {
        props.onClose()
      } else {
        setMessage('确认失败：main 已拒绝；表单与项目未写入。')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="requirement-wizard__backdrop" role="dialog" aria-modal="true" aria-label="绑定任务书要求">
      <div className="requirement-wizard">
        <header className="requirement-wizard__header">
          <h2>{active === null ? '绑定任务书要求' : '更新任务书条款（新建版本）'}</h2>
          <button type="button" onClick={props.onClose} aria-label="取消条款编辑">关闭</button>
        </header>
        <p className="requirement-wizard__hint">
          条款区间是本次 Beta 检查的唯一判定依据；原项目目标继续保存并独立展示，
          两者互不覆盖。未确认表单只存在草稿，不写正式条款。
        </p>
        {needsNewVersion && (
          <p className="requirement-wizard__warning" role="status">
            任务书 PDF 已换版：旧条款仍指向旧版本，需重新框选并确认新版。
          </p>
        )}
        {documents.length === 0 ? (
          <p role="alert">当前项目没有 PDF。请先在工具栏「导入资料」导入任务书。</p>
        ) : (
          <>
            <section className="requirement-wizard__row">
              <label>
                任务书文档
                <select
                  aria-label="任务书文档"
                  value={documentId}
                  onChange={(event) => reloadForDocument(event.target.value)}
                >
                  {documents.map((item) => (
                    <option key={item.id} value={item.id}>{item.title}</option>
                  ))}
                </select>
              </label>
              <label>
                确切版本（不跟随同名最新版）
                <select
                  aria-label="任务书版本"
                  value={revisionId}
                  onChange={(event) => {
                    setRevisionId(event.target.value)
                    setRect(null)
                    setPageBox(null)
                    setSelectionHint('')
                    scheduleStage()
                  }}
                >
                  {revisionsOfDocument.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.fileName} · {item.id} · {item.pageCount} 页 · {item.sha256.slice(0, 12)}…
                    </option>
                  ))}
                </select>
              </label>
              <label>
                页码
                <input
                  aria-label="条款页码"
                  type="number"
                  min={1}
                  max={revision?.pageCount ?? 1}
                  value={page}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    if (Number.isInteger(next) && next >= 1 && next <= (revision?.pageCount ?? 1)) {
                      setPage(next)
                      setRect(null)
                      setPageBox(null)
                      setSelectionHint('')
                      scheduleStage()
                    }
                  }}
                />
              </label>
            </section>

            {revision === null ? (
              <p role="alert">所选版本不存在，请重新选择。</p>
            ) : (
              <div className="requirement-wizard__pdf">
                <PdfViewer
                  revision={revision}
                  bindings={[]}
                  selectedTermId="__requirement__"
                  page={page}
                  zoom={zoom}
                  rotation={rotation}
                  onPageChange={(next) => { setPage(next); setRect(null); setPageBox(null); setSelectionHint(''); scheduleStage() }}
                  onZoomChange={setZoom}
                  onRotationChange={setRotation}
                  loadBytes={loadBytes}
                  saveButtonLabel="使用此选区"
                  saveSuccessMessage="已记录选区（PDF 坐标，缩放/旋转后仍指向同一块内容）。"
                  onSaveBinding={async (input) => {
                    setPage(input.page)
                    setRect([...input.rectPdf] as Rect)
                    setPageBox([...input.pageBoxPdf] as Rect)
                    setSelectionHint(
                      `已选第 ${input.page} 页区域 [${input.rectPdf.map((value) => value.toFixed(1)).join(', ')}]（PDF 点）`,
                    )
                    scheduleStage()
                    return { ok: true }
                  }}
                />
              </div>
            )}

            <section className="requirement-wizard__row">
              <label className="requirement-wizard__text">
                粘贴原文（明确确认，不由数值反拼）
                <textarea
                  aria-label="条款原文"
                  value={text}
                  rows={3}
                  onChange={(event) => { setText(event.target.value); scheduleStage() }}
                />
              </label>
              <label>
                下限（mm）
                <MmInput aria-label="条款下限" value={lower} inputMode="decimal" onChange={(event) => { setLower(event.target.value); scheduleStage() }} />
              </label>
              <label>
                上限（mm）
                <MmInput aria-label="条款上限" value={upper} inputMode="decimal" onChange={(event) => { setUpper(event.target.value); scheduleStage() }} />
              </label>
            </section>

            <section className="requirement-wizard__compare" aria-label="两组范围对比">
              <h3>两组范围并列（互不覆盖）</h3>
              <dl>
                <div>
                  <dt>原项目目标</dt>
                  <dd>
                    {target === null
                      ? '未设置（仍保存为空）'
                      : `${formatMm(target.minQ)} ～ ${formatMm(target.maxQ)} mm`}
                    {targetResult ? ` · 当前草稿结果 ${formatMm(targetResult.minQ)} ～ ${formatMm(targetResult.maxQ)} mm（${targetResult.status}）` : ''}
                  </dd>
                </div>
                <div>
                  <dt>任务书要求</dt>
                  <dd>
                    {boundsOk
                      ? `${formatMm(lowerParsed.value)} ～ ${formatMm(upperParsed.value)} mm（闭区间，本条检查唯一依据）`
                      : '上下限未填、格式/精度无效或下限大于上限'}
                  </dd>
                </div>
                {target !== null && lowerParsed.ok && upperParsed.ok && (
                  <div>
                    <dt>范围差异</dt>
                    <dd>
                      下界 {diffText(lowerParsed.value - target.minQ)}；上界 {diffText(upperParsed.value - target.maxQ)}。
                      原目标不会自动同步为任务书要求。
                    </dd>
                  </div>
                )}
              </dl>
              <p>
                当前链：{snapshot.project.dimensionChain.terms.map((term) => term.symbol).join(' / ') || '（空链）'}
                （项目唯一轴向链；不另选临时链）
              </p>
            </section>

            {props.previewRequirement && (
              <section className="requirement-wizard__result" aria-label="当前预览判定">
                <h3>当前预览</h3>
                <p>原目标独立结果：{props.previewRequirement.originalTargetResult?.status ?? '不可用'}</p>
                <p>
                  条款检查：{props.previewRequirement.check.status}
                  {props.previewRequirement.check.resultInterval
                    ? ` · ${formatMm(props.previewRequirement.check.resultInterval.minQ)} ～ ${formatMm(props.previewRequirement.check.resultInterval.maxQ)} mm`
                    : ''}
                </p>
              </section>
            )}

            {selectionHint !== '' && <p role="status">{selectionHint}</p>}
            {active !== null && (
              <label className="requirement-wizard__reason">
                更新原因（修改原文/来源/选区/上下限都必须新建版本）
                <input value={changeReason} onChange={(event) => setChangeReason(event.target.value)} maxLength={500} />
              </label>
            )}
            <label className="requirement-wizard__confirm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              我已核对原文、页码、选区与上下限，确认生成不可变条款版本
            </label>
            {message !== '' && <p role="alert">{message}</p>}
            <div className="requirement-wizard__actions">
              <button type="button" onClick={props.onClose} disabled={busy}>取消</button>
              <button type="button" className="requirement-wizard__primary" disabled={!canConfirm || busy} onClick={() => void submit()}>
                {busy ? '确认中…' : active === null ? '确认并保存条款' : '确认新版本'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function diffText(valueQ: number): string {
  const sign = valueQ > 0 ? '+' : ''
  return `${sign}${formatMm(valueQ)} mm`
}
