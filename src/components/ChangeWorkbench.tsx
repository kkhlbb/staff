/**
 * D：参数联动工作区（草稿 → 预览 → 确认）与独立复核分组。
 *
 * 界面只消费 main 返回的权威预览/快照；不自行计算 q、不生成图纸、不把
 * “待核”显示成“已批准”。坏消息分五类独立呈现，互不合并。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangePreviewValue, SnapshotDto } from '../../desktop/shared/contracts'
import type { ChangeEvent } from '../history/events'
import { SPACER_PARAMETER_IDS, SPACER_PARAMETER_LABELS, SPACER_PART_ID } from '../drawing/types'
import {
  parameterBindingWorkbenchRows,
  deriveReviewGroups,
} from '../revisions/status'
import { sourceBasisOf } from '../revisions/digest'
import { REQUIREMENT_STATUS_LABEL } from '../requirements/types'
import { DrawingCanvas } from './DrawingCanvas'
import { HistoricalStepExport } from './HistoricalStepExport'
import { RequirementStatusPanel } from './RequirementStatusPanel'
import type { ChangeUiState } from '../workspace/useDesktopSession'
import { formatMm } from '../domain/units'
import { formatQWithDecimals } from '../drawing/formatDimension'
import { MmInput } from './MmInput'
import './ChangeWorkbench.css'
import { uiDiagnosticText, uiFileVersionLabel, uiSourceVersionLabel, uiVersionLabel } from './uiIdentity'

export interface ChangeWorkbenchProps {
  snapshot: SnapshotDto
  events: readonly ChangeEvent[]
  sessionId: string | null
  baseEditSeq?: number
  exportDisabled?: boolean
  change: ChangeUiState
  onStage: (
    inputs: { innerDiameter: string; outerDiameter: string; length: string },
    notes: { innerDiameter?: string; outerDiameter?: string; length?: string },
  ) => Promise<unknown>
  onPreview: () => Promise<unknown>
  onApply: (reason: string) => Promise<unknown>
  /** V3.5：合法输入自动驱动草稿+预览（带请求序号，迟到响应不覆盖新草稿）。 */
  onAutoPreview: (
    inputs: { innerDiameter: string; outerDiameter: string; length: string },
    notes: { innerDiameter?: string; outerDiameter?: string; length?: string },
  ) => Promise<unknown>
  onBind: (termId: string, partId: string, parameterId: string) => Promise<unknown>
  onUnbind: (bindingId: string) => Promise<unknown>
  onRestore: (revisionId: string) => Promise<unknown>
  /** 复核区/工作台“定位任务书”。 */
  onLocateRequirement: () => void
}

function resultText(result: { nominalQ: number; minQ: number; maxQ: number; status: string }): string {
  return `${formatMm(result.nominalQ)} mm；范围 ${formatMm(result.minQ)} ～ ${formatMm(result.maxQ)} mm（${result.status}）`
}

export function ChangeWorkbench(props: ChangeWorkbenchProps) {
  const { snapshot, change } = props
  const project = snapshot.project
  const draftParameters = change.draft?.parameters ?? project.parameters
  const byKey = new Map(draftParameters.map((parameter) => [parameter.key, parameter]))
  // 只恢复编辑/提交原文的位数，不把显示规范写入 inputDecimals。
  // 非编辑文字统一由 MmInput → formatMm 生成。
  const [texts, setTexts] = useState(() => ({
    innerDiameter: byKey.get('innerDiameter') ? formatQWithDecimals(byKey.get('innerDiameter')!.valueQ, byKey.get('innerDiameter')!.inputDecimals) ?? '' : '20.00',
    outerDiameter: byKey.get('outerDiameter') ? formatQWithDecimals(byKey.get('outerDiameter')!.valueQ, byKey.get('outerDiameter')!.inputDecimals) ?? '' : '32.00',
    length: byKey.get('length') ? formatQWithDecimals(byKey.get('length')!.valueQ, byKey.get('length')!.inputDecimals) ?? '' : '12.00',
  }))
  const [notes, setNotes] = useState<{ innerDiameter?: string; outerDiameter?: string; length?: string }>({})
  const [reason, setReason] = useState('参数变更（只同步 nominal）')
  const [selectedTerm, setSelectedTerm] = useState(project.dimensionChain.terms[0]?.id ?? '')
  const [selectedParameter, setSelectedParameter] = useState(SPACER_PARAMETER_IDS.length)
  const [busy, setBusy] = useState(false)
  const touched = useRef(false)
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const propsRef = useRef(props)
  useEffect(() => { propsRef.current = props }, [props])

  // 合法输入自动驱动：用户改过输入后 400ms 防抖；序号与串行在会话层。
  useEffect(() => {
    if (!touched.current) return
    if (autoTimer.current !== null) clearTimeout(autoTimer.current)
    autoTimer.current = setTimeout(() => {
      autoTimer.current = null
      void propsRef.current.onAutoPreview(texts, notes)
    }, 400)
    return () => {
      if (autoTimer.current !== null) {
        clearTimeout(autoTimer.current)
        autoTimer.current = null
      }
    }
  }, [texts, notes])

  /**
   * 行列表 = 已确认快照 + 草稿绑定（草稿态标“待确认”，不当有效）。
   * 只读 change.draft，不把草稿写进 project。
   */
  const bindingRows = useMemo(
    () =>
      parameterBindingWorkbenchRows(
        project,
        props.events,
        (parameterId) => {
          const parameter = project.parameters.find((item) => item.parameterId === parameterId)
          return sourceBasisOf(snapshot, parameter?.sourceNote)
        },
        change.draft,
      ),
    [project, props.events, snapshot, change.draft],
  )
  const unlinked = bindingRows.length === 0
  const draftBindingCount = bindingRows.filter((row) => row.stage === 'draft').length
  const groups =
    change.preview?.groups ??
    deriveReviewGroups(project, {
      computation: null,
      availableBlobKeys: new Set(
        snapshot.blobs
          .filter((blob) => !snapshot.missingAttachments.some((missing) => missing.blobKey === blob.blobKey))
          .map((blob) => blob.blobKey),
      ),
      documents: snapshot.documents,
      revisions: snapshot.revisions,
      sourceBindings: snapshot.bindings,
    })

  async function run(work: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }

  /**
   * 「确认提交」当前为什么不能用。四种情况分开写：预览已作废、从未预览、
   * 条款门禁、正在处理。
   */
  const requirementRevision = change.preview?.requirement?.revision ?? null
  const requirementBlocker =
    requirementRevision !== null && change.preview !== null && change.preview.requirement !== null
      ? change.preview.requirement.check.status === 'satisfied'
        ? null
        : `条款检查为「${REQUIREMENT_STATUS_LABEL[change.preview.requirement.check.status]}」：` +
          `${uiDiagnosticText(change.preview.requirement.evaluation.reasons.join('；')) || '请先补齐条款证据'}；正式版本保持在上一次提交。`
      : null
  const confirmBlockedReason =
    change.staleReason !== null
      ? change.staleReason
      : change.preview === null
        ? '尚未预览：先点「预览变更」，预览成功后「确认提交」才可用。'
        : requirementBlocker !== null
          ? requirementBlocker
          : busy
            ? '正在处理，请稍候。'
            : null

  return (
    <section className="change-workbench" aria-label="参数联动">
      <header className="change-workbench__header">
        <h2>参数联动（只同步 nominal）</h2>
        <p className={unlinked ? 'change-workbench__unlinked' : undefined}>
          {unlinked
            ? '未关联尺寸链'
            : draftBindingCount === 0
              ? `已关联 ${bindingRows.length} 个组成环；偏差/方向/目标不随参数同步。`
              : `已关联 ${bindingRows.length} 个组成环（其中 ${draftBindingCount} 个草稿态待确认）；偏差/方向/目标不随参数同步。`}
        </p>
      </header>

      <form
        className="change-workbench__inputs"
        onSubmit={(event) => {
          event.preventDefault()
          void run(() => props.onStage(texts, notes))
        }}
      >
        {(['innerDiameter', 'outerDiameter', 'length'] as const).map((key) => (
          <label key={key}>
            {SPACER_PARAMETER_LABELS[key]}
            <MmInput
              inputMode="decimal"
              aria-label={`${SPACER_PARAMETER_LABELS[key]}（mm）`}
              value={texts[key]}
              onChange={(event) => { touched.current = true; setTexts({ ...texts, [key]: event.target.value }) }}
            />
            <input
              aria-label={`${SPACER_PARAMETER_LABELS[key]}来源备注`}
              placeholder="来源备注（可选）"
              value={notes[key] ?? ''}
              onChange={(event) => { touched.current = true; setNotes({ ...notes, [key]: event.target.value }) }}
            />
          </label>
        ))}
        <div className="change-workbench__actions">
          <button type="submit" disabled={busy}>建立/更新草稿</button>
          <button
            type="button"
            disabled={busy || change.draft === null}
            onClick={() => void run(() => props.onPreview())}
          >
            预览变更
          </button>
          <button
            type="button"
            disabled={
              busy ||
              change.preview === null ||
              change.staleReason !== null ||
              requirementBlocker !== null
            }
            title={confirmBlockedReason ?? undefined}
            aria-describedby="change-workbench-confirm-reason"
            onClick={() => void run(() => props.onApply(reason))}
          >
            确认提交（一次原子写入）
          </button>
        </div>
        {/* 灰按钮必须有可读原因：从未预览与“预览已作废”用两套文案，不合并。 */}
        <p id="change-workbench-confirm-reason" className="change-workbench__hint">
          {confirmBlockedReason ?? '预览有效：可以确认提交。'}
        </p>
        {change.autoState === 'pending' && (
          <p className="change-workbench__hint" role="status">自动预览中：{change.autoMessage || '正在按当前输入重新计算…'}</p>
        )}
        {change.autoState === 'invalid' && (
          <p className="change-workbench__error" role="alert">
            输入待修正，当前检查未完成。{change.autoMessage !== '' ? `（${change.autoMessage}）` : ''}
            上次有效几何保留，但旧通过资格已清除。
          </p>
        )}
        <label className="change-workbench__reason">
          变更理由
          <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
        </label>
      </form>

      <section className="change-workbench__bind" aria-label="参数绑定">
        <h3>参数绑定</h3>
        <div>
          <select aria-label="组成环" value={selectedTerm} onChange={(event) => setSelectedTerm(event.target.value)}>
            {project.dimensionChain.terms.map((term) => (
              <option key={term.id} value={term.id}>
                {term.symbol} · {term.name}
              </option>
            ))}
          </select>
          <select aria-label="隔套参数" value={selectedParameter} onChange={(event) => setSelectedParameter(event.target.value)}>
            {Object.entries(SPACER_PARAMETER_IDS).map(([key, id]) => (
              <option key={id} value={id}>
                {SPACER_PARAMETER_LABELS[key as keyof typeof SPACER_PARAMETER_LABELS]}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || selectedTerm === ''}
            onClick={() => void run(() => props.onBind(selectedTerm, SPACER_PART_ID, selectedParameter))}
          >
            绑定参数
          </button>
        </div>
        {bindingRows.length === 0 ? (
          <p>未关联尺寸链：尚无参数绑定（B2 外形资料关联不计入）。</p>
        ) : (
          <ul>
            {bindingRows.map((row) => (
              <li key={row.bindingId}>
                <strong>{row.termSymbol}</strong> ← {row.parameterLabel}（param q={row.parameterValueQ}，环 q={row.termNominalQ}）
                <span
                  className={
                    row.stage === 'draft'
                      ? 'change-workbench__draft'
                      : row.state === 'valid'
                        ? 'change-workbench__ok'
                        : 'change-workbench__pending'
                  }
                >
                  {row.stage === 'draft'
                    ? '草稿态待确认（尚未确认提交）'
                    : row.state === 'valid'
                      ? '已确认生效'
                      : `待核：${uiDiagnosticText(row.reasons.join('；'))}`}
                </span>
                <button type="button" disabled={busy} onClick={() => void run(() => props.onUnbind(row.bindingId))}>
                  解除绑定
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {change.notice !== '' && (
        <p className="change-workbench__notice" role="status">{uiDiagnosticText(change.notice)}</p>
      )}
      {change.staleReason !== null && (
        <div className="change-workbench__stale" role="alert">
          <strong>预览已过期</strong>
          <span>{change.staleReason}</span>
          <span>请重新预览；旧确认请求会被拒绝且不写入。</span>
        </div>
      )}
      {change.error !== null && (
        <div className="change-workbench__error" role="alert">
          <strong>{change.error.code}</strong>
          <span>{uiDiagnosticText(change.error.message)}</span>
          <span>未提交的编辑仍保留。</span>
        </div>
      )}

      {change.preview?.requirement?.revision && (
        <RequirementStatusPanel
          requirement={change.preview.requirement}
          target={project.dimensionChain.target}
          targetResult={change.preview.result}
          onLocate={props.onLocateRequirement}
          locateDisabled={props.sessionId === null}
        />
      )}

      {change.preview !== null && <PreviewBody preview={change.preview} snapshot={snapshot} />}

      <section className="change-workbench__history" aria-label="从旧版本恢复">
        <h3>从旧版本恢复（生成新草稿，需重新确认）</h3>
        <HistoricalStepExport snapshot={snapshot} sessionId={props.sessionId} baseEditSeq={props.baseEditSeq ?? 0} disabled={props.exportDisabled || props.baseEditSeq === undefined} />
        <ul>
          {snapshot.fileRevisions
            .slice()
            .reverse()
            .map((revision) => (
              <li key={revision.revisionId}>
                <span>{uiFileVersionLabel(snapshot.fileRevisions, revision.revisionId)} · {uiDiagnosticText(revision.reason)} · 父版本：{revision.parentId === null ? '无' : uiFileVersionLabel(snapshot.fileRevisions, revision.parentId)}</span>
                {revision.revisionId !== project.currentRevisionId && (
                  <button type="button" disabled={busy} onClick={() => void run(() => props.onRestore(revision.revisionId))}>
                    恢复为新草稿
                  </button>
                )}
              </li>
            ))}
        </ul>
      </section>

      <section className="change-workbench__groups" aria-label="复核与变更分组">
        <h3>复核与变更（五类独立）</h3>
        <section data-group="affected">
          <h4>受影响环</h4>
          {groups.affectedTerms.length === 0 ? <p>无受影响环。</p> : (
            <ul>
              {groups.affectedTerms.map((term) => (
                <li key={term.termId}>
                  {term.termSymbol}：{term.beforeNominalQ}q → {term.afterNominalQ}q
                  {term.changed ? '（数值变化）' : '（被引用，值未变）'}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section data-group="sources">
          <h4>需复核来源</h4>
          {groups.sourceReview.length === 0 ? <p>来源项无待办。</p> : (
            <ul>
              {groups.sourceReview.map((row, index) => (
                <li key={`${row.ruleId}-${index}`}>
                  {row.ruleId}：{uiDiagnosticText(row.reason)}
                  {row.revisionId ? `（${uiSourceVersionLabel(snapshot.revisions, row.revisionId)} 第 ${row.page ?? '?'} 页）` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section data-group="relation">
          <h4>关系待核</h4>
          <p>{groups.relation.label}。{groups.relation.detail}</p>
        </section>
        <section data-group="material">
          <h4>材料缺失</h4>
          {groups.materialMissing.length === 0 ? <p>技术字段齐全。</p> : (
            <ul>
              {groups.materialMissing.map((row) => <li key={row.field}>{row.label}待补充</li>)}
            </ul>
          )}
        </section>
        <section data-group="calculation">
          <h4>计算不满足</h4>
          <p>
            {groups.calculation.label}
            {groups.calculation.result
              ? `：${resultText(groups.calculation.result)}`
              : ''}
            {groups.calculation.shortfallQ !== null
              ? `；缺口 ${groups.calculation.shortfallQ}q（${formatMm(Math.abs(groups.calculation.shortfallQ))} mm）`
              : ''}
          </p>
          <p>{groups.drawing.label}</p>
        </section>
      </section>
    </section>
  )
}

function PreviewBody({ preview, snapshot }: { preview: ChangePreviewValue; snapshot: SnapshotDto }) {
  return (
    <section className="change-workbench__preview" aria-label="变更预览">
      <h3>预览：草稿 · {uiVersionLabel(snapshot.fileRevisions.length + 1)}</h3>
      <table>
        <caption>参数与受影响环（旧 → 新）</caption>
        <thead>
          <tr><th>对象</th><th>旧</th><th>新</th><th>说明</th></tr>
        </thead>
        <tbody>
          {preview.parameterDiffs.map((row) => (
            <tr key={row.parameterId}>
              <td>{SPACER_PARAMETER_LABELS[row.key]}</td>
              <td>{row.beforeQ ?? '—'}q / {row.beforeDecimals ?? '—'} 位</td>
              <td>{row.afterQ}q / {row.afterDecimals} 位</td>
              <td>{row.valueChanged ? '工程值变化' : '工程值未变，仅有显示/来源变化'}</td>
            </tr>
          ))}
          {preview.termDiffs.map((row) => (
            <tr key={row.bindingId}>
              <td>环 {row.termSymbol}</td>
              <td>{row.beforeNominalQ}q</td>
              <td>{row.afterNominalQ}q</td>
              <td>{row.changed ? '仅 nominal 同步' : '被引用，值未变'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>旧结果：{resultText(preview.previousResult)}</p>
      <p>新结果：{resultText(preview.result)}</p>
      <p>
        绑定标注：{preview.drawing.right.annotations.map((_, index) => `标注 ${index + 1}`).join('、') || '无'}
      </p>
      {preview.drawing.leftProblem !== null && (
        <p className="change-workbench__pending">旧图不能重建：{uiDiagnosticText(preview.drawing.leftProblem)}</p>
      )}
      <div className="change-workbench__compare" aria-label="双图并排">
        <figure>
          <figcaption>旧版本 {preview.drawing.left ? uiFileVersionLabel(snapshot.fileRevisions, preview.drawing.left.revisionId) : '不可用'} · {preview.drawing.left ? `${preview.drawing.left.scale.numerator}:${preview.drawing.left.scale.denominator}` : '—'}</figcaption>
          <DrawingCanvas
            data={preview.drawing.left}
            versionLabel={uiFileVersionLabel(snapshot.fileRevisions, preview.drawing.left?.revisionId)}
            selectedAnnotationId={null}
            onSelectAnnotation={() => undefined}
            zoom={0.3}
            emptyReason={preview.drawing.leftProblem ?? '无旧图'}
          />
        </figure>
        <figure>
          <figcaption>当前草稿 · {uiVersionLabel(snapshot.fileRevisions.length + 1)} · {preview.drawing.right.scale.numerator}:{preview.drawing.right.scale.denominator}</figcaption>
          <DrawingCanvas
            data={preview.drawing.right}
            versionLabel={uiVersionLabel(snapshot.fileRevisions.length + 1)}
            selectedAnnotationId={null}
            onSelectAnnotation={() => undefined}
            zoom={0.3}
          />
        </figure>
      </div>
      {preview.blockers.length > 0 && (
        <p className="change-workbench__error" role="alert">阻断：{uiDiagnosticText(preview.blockers.join('；'))}</p>
      )}
    </section>
  )
}
