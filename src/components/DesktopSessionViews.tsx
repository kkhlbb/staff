import { MmInput } from './MmInput'
import { uiSourceVersionLabel, uiDiagnosticText } from './uiIdentity'
import { useCallback, useState } from 'react'
import type { SnapshotDto } from '../../desktop/shared/contracts'
import type { RequirementRevisionHistoryEntry, RequirementSourceLocation } from '../requirements/history'
import { calculateChain } from '../domain/calculate'
import { formatMm } from '../domain/units'
import { draftToChain, type WorkspaceAction } from '../workspace/draft'
import { officialDraft, resolveDraft } from '../workspace/draftSync'
import type { SourceRevision } from '../sources/types'
import { ChainExpression } from './ChainExpression'
import { PdfViewer } from './PdfViewer'
import { RequirementRevisionHistory } from './RequirementRevisionHistory'

const statusLabel = { within: '满足目标（非审查结论）', outside: '超出目标', 'no-target': '未设目标' }

export function DesktopChainView({ snapshot, edit, disabled }: {
  snapshot: SnapshotDto; edit: (action: WorkspaceAction) => void; disabled: boolean
}) {
  const resolved = resolveDraft(snapshot)
  const draft = resolved.draft
  const parsed = draftToChain(draft)
  const errors = parsed.ok ? {} : parsed.cellErrors
  const result = parsed.ok ? calculateChain(parsed.chain) : null
  return <div className="desktop-workspace__content">
    <h2>当前尺寸链</h2>
    {resolved.message && <section role="status" aria-label="草稿版本状态"><p>{resolved.message}</p>
      {resolved.kind === 'edited' && <>
        <button disabled={disabled} onClick={() => {
          if (window.confirm('按正式重算将替换当前草稿编辑；取消可保留我的编辑。')) edit({ type: 'replaceDraft', draft: officialDraft(snapshot.project.dimensionChain, snapshot.project.relationRevision) })
        }}>按正式重算</button>
        <button disabled={disabled} onClick={() => edit({ type: 'replaceDraft', draft: { ...draft, basisRelationRevision: resolved.basis } })}>保留我的编辑</button>
      </>}
    </section>}
    <p>当前会话快照 · 数值单位 mm · 编辑经 stageDraft 提交，不等于正式保存或审查完成。</p>
    <ChainExpression draft={draft} />
    <div className="desktop-workspace__table-scroll" role="region" aria-label="组成环表横向滚动区域" tabIndex={0}>
      <table aria-label="组成环表"><thead><tr>{['组成环', '基本尺寸', '下偏差', '上偏差', '方向'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{draft.terms.map((term, index) => <tr key={term.id}>
          <th scope="row">{term.symbol} · {term.name}</th>
          {(['nominal', 'lower', 'upper'] as const).map((field, column) => {
            const error = errors[`${term.id}.${field}`]
            const id = `desktop-term-${index}-${field}`
            return <td key={field}><MmInput aria-label={`第 ${index + 1} 行 ${term.symbol} ${['基本尺寸', '下偏差', '上偏差'][column]}`} inputMode="decimal" value={term[field]} disabled={disabled}
              aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
              onChange={event => edit({ type: 'updateField', termId: term.id, field, value: event.target.value })} />
              {error && <p id={`${id}-error`} className="desktop-workspace__error">{error}</p>}</td>
          })}
          <td><select aria-label={`第 ${index + 1} 行 ${term.symbol} 方向`} value={term.sign} disabled={disabled} onChange={event => edit({ type: 'updateField', termId: term.id, field: 'sign', value: event.target.value === '1' ? 1 : -1 })}><option value="1">增环 (+)</option><option value="-1">减环 (−)</option></select></td>
        </tr>)}</tbody></table>
    </div>
    {!draft.terms.length && <p>暂无组成环。增删环与绑定引用维护本批次未接入。</p>}
    <fieldset disabled={disabled} className="desktop-workspace__target"><legend>目标区间（mm，两项留空表示未设置）</legend>
      {(['min', 'max'] as const).map(side => {
        const key = side === 'min' ? 'targetMin' : 'targetMax'
        const error = errors[`target.${side}`]
        return <label key={side}>目标{side === 'min' ? '下限' : '上限'}<MmInput value={draft[key]} inputMode="decimal" aria-invalid={error ? true : undefined} aria-describedby={error ? `desktop-target-${side}-error` : undefined}
          onChange={event => edit({ type: 'setTarget', targetMin: draft.targetMin, targetMax: draft.targetMax, [key]: event.target.value })} />
          {error && <span id={`desktop-target-${side}-error`} className="desktop-workspace__error">{error}</span>}</label>
      })}
    </fieldset>
    <section aria-label="当前计算结果" className="desktop-workspace__result"><h3>计算结果 · 非审查结论</h3>
      {result ? <><p>{statusLabel[result.status]}</p><dl>
        <div><dt>封闭环基本尺寸</dt><dd>{formatMm(result.nominalQ)} mm</dd></div>
        <div><dt>极值范围</dt><dd>{formatMm(result.minQ)} 至 {formatMm(result.maxQ)} mm</dd></div>
        <div><dt>封闭环公差</dt><dd>{formatMm(result.toleranceQ)} mm</dd></div>
      </dl></> : <p role="alert">{draft.terms.length ? '输入无效，当前结果不可用；请修正表格或目标区间中标出的字段。' : '空链，尚无计算结果。'}</p>}
    </section>
    <p id="desktop-chain-write-reason">增删环、审查确认与新建分析快照本批次未接入；不会修改既有冻结历史。</p>
    <div className="desktop-workspace__actions">{['增加组成环', '删除组成环', '确认审查', '冻结分析快照'].map(label => <button key={label} disabled aria-describedby="desktop-chain-write-reason">{label}</button>)}</div>
  </div>
}

export type { RequirementSourceLocation } from '../requirements/history'

function formatRequirementRect(rect: readonly [number, number, number, number]): string {
  return `[${rect.map(value => Number(value.toFixed(3))).join(', ')}]`
}

export function DesktopSourceView({ snapshot, sessionId, requirementSource, locate, onImportVersion }: {
  snapshot: SnapshotDto
  sessionId: string
  /** 活动条款的来源；只用于来源页入口与默认高亮。 */
  requirementSource: RequirementSourceLocation | null
  /** 外部（复核区“定位任务书”或历史条款版本）请求打开的确切版本/页码/选区。 */
  locate: RequirementSourceLocation | null
  onImportVersion: (documentId: string) => void
}) {
  const [location, setLocation] = useState<{
    revisionId: string
    page: number
    termId: string | null
    requirementRevisionId: string | null
  }>({
    revisionId: locate?.revisionId ?? snapshot.revisions[0]?.id ?? '',
    page: locate?.page ?? 1,
    termId: locate === null ? null : '__requirement__',
    requirementRevisionId: locate?.requirementRevisionId ?? null,
  })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const revision = snapshot.revisions.find(item => item.id === location.revisionId)
  const missing = snapshot.missingAttachments.some(item => item.revisionId === revision?.id)
  const requirementCandidates = [requirementSource, locate].filter(
    (item): item is RequirementSourceLocation => item !== null,
  )
  const selectedRequirement =
    location.requirementRevisionId === null
      ? null
      : requirementCandidates.find(
          item => item.requirementRevisionId === location.requirementRevisionId,
        ) ?? null
  const requirementIssue = selectedRequirement?.issue ?? null
  // 手工浏览来源页时仍显示活动条款高亮；明确选中历史版本时只显示该版本。
  const highlightRequirement =
    selectedRequirement ?? (requirementSource?.issue === null ? requirementSource : null)
  const requirementBinding = highlightRequirement === null ? null : {
    id: `requirement-source:${highlightRequirement.requirementRevisionId}`,
    projectId: snapshot.project.id,
    termId: '__requirement__',
    revisionId: highlightRequirement.revisionId,
    documentId: snapshot.revisions.find(item => item.id === highlightRequirement.revisionId)?.documentId ?? '',
    page: highlightRequirement.page,
    rectPdf: highlightRequirement.rectPdf,
    pageBoxPdf: highlightRequirement.pageBoxPdf,
    note: '任务书条款选区',
    createdAt: '',
    reviewedTermRevision: null,
    reviewedAt: null,
    historicalAcceptance: null,
  }
  const loadBytes = useCallback(async (rev: SourceRevision) => {
    if (!window.cunlian) throw new Error('window.cunlian 不可用')
    const result = await window.cunlian.readAttachment({ sessionId, revisionId: rev.id })
    if (!result.ok) throw new Error(`附件不可用 · ${result.error.code}：${result.error.message}`)
    if (!result.value.bytes.byteLength) throw new Error('附件不可用：返回的 PDF 字节为空')
    return result.value.bytes
  }, [sessionId])
  return <div className="desktop-workspace__content"><h2>来源 PDF</h2>
    <p>读取当前会话内的确切附件版本；有绑定不代表来源已审查。</p>
    {snapshot.revisions.length === 0 && locate === null && requirementSource === null ? <p role="status">没有来源 PDF。资料导入本批次未实现。</p> : <>
      {snapshot.revisions.length === 0 && location.revisionId === '' ? null : <label>来源版本 <select aria-label="来源版本" value={location.revisionId} onChange={event => setLocation({ revisionId: event.target.value, page: 1, termId: null, requirementRevisionId: null })}>{revision === undefined && location.revisionId !== '' ? <option value={location.revisionId}>未命名版本（不在项目文件中）</option> : null}{snapshot.revisions.map(rev => <option key={rev.id} value={rev.id}>{rev.fileName} · {uiSourceVersionLabel(snapshot.revisions, rev.id)}</option>)}</select></label>}
      {snapshot.documents.map(doc => <button key={doc.id} type="button" onClick={() => onImportVersion(doc.id)}>导入「{doc.title}」新版…</button>)}
      <ul className="desktop-workspace__locations">{snapshot.bindings.map(binding => <li key={binding.id}><span>{snapshot.project.dimensionChain.terms.find(term => term.id === binding.termId)?.symbol ?? '未命名组成环'} · 第 {binding.page} 页 · {uiSourceVersionLabel(snapshot.revisions, binding.revisionId)} </span><button disabled={!snapshot.revisions.some(rev => rev.id === binding.revisionId)} onClick={() => { setLocation({ revisionId: binding.revisionId, page: binding.page, termId: binding.termId, requirementRevisionId: null }); setZoom(1); setRotation(0) }}>查看原图位置</button></li>)}
        {requirementSource && <li><span>任务书条款（活动）· 第 {requirementSource.page} 页 · {uiSourceVersionLabel(snapshot.revisions, requirementSource.revisionId)}</span><button onClick={() => { setLocation({ revisionId: requirementSource.revisionId, page: requirementSource.page, termId: '__requirement__', requirementRevisionId: requirementSource.requirementRevisionId }); setZoom(1); setRotation(0) }}>定位任务书</button></li>}
        {locate && locate.requirementRevisionId !== requirementSource?.requirementRevisionId && <li><span>任务书条款历史版本 · 第 {locate.page} 页 · {uiSourceVersionLabel(snapshot.revisions, locate.revisionId)}</span><button onClick={() => { setLocation({ revisionId: locate.revisionId, page: locate.page, termId: '__requirement__', requirementRevisionId: locate.requirementRevisionId }); setZoom(1); setRotation(0) }}>定位此历史版本</button></li>}
      </ul>
      {selectedRequirement !== null && <p data-testid="requirement-locate-summary">已定位任务书条款 · 来源 PDF {uiSourceVersionLabel(snapshot.revisions, selectedRequirement.revisionId)} 第 {selectedRequirement.page} 页 · 选区 PDF 点 {formatRequirementRect(selectedRequirement.rectPdf)}</p>}
      {requirementIssue !== null ? <p role="alert" data-testid="requirement-locate-error">来源缺失：{uiDiagnosticText(requirementIssue.message)}</p> : missing ? <p role="alert">附件不可用：此版本已声明缺失，无法显示原图。</p> : revision ? <PdfViewer readOnly revision={revision}
        bindings={[...snapshot.bindings, ...(requirementBinding ? [requirementBinding] : [])]}
        selectedTermId={location.termId} page={location.page} zoom={zoom} rotation={rotation}
        onPageChange={page => setLocation(current => ({ ...current, page }))} onZoomChange={setZoom} onRotationChange={setRotation} loadBytes={loadBytes}
        onSaveBinding={async () => ({ ok: false, message: '来源绑定写入本批次未接入' })} /> : <p role="alert">附件不可用：找不到来源版本元数据。</p>}
    </>}
  </div>
}

export function DesktopHistoryView({ snapshot, requirementHistory = [], onLocateRequirement }: {
  snapshot: SnapshotDto
  requirementHistory?: readonly RequirementRevisionHistoryEntry[]
  onLocateRequirement?: (revisionId: string) => void
}) {
  return <div className="desktop-workspace__content"><h2>历史报告</h2>
    <p className="desktop-workspace__pending">导入的历史记录/冻结结果，不代表当前已确认</p>
    {requirementHistory.length > 0 && onLocateRequirement && <RequirementRevisionHistory
      items={requirementHistory}
      sourceRevisions={snapshot.revisions}
      onLocate={onLocateRequirement}
      testIdPrefix="history-requirement"
    />}
    {!snapshot.analysisSnapshots.length && <p>暂无 AnalysisSnapshot。新建冻结快照本批次未接入。</p>}
    {snapshot.analysisSnapshots.map(item => <article key={item.id} className="desktop-workspace__history-item" aria-label={`历史报告 ${item.projectName} · ${item.createdAt}`}>
      <h3>{item.projectName} · 分析快照</h3><p>{item.createdAt} · 引擎 {item.engineVersion} · 规则 {item.reviewRulesVersion}</p>
      <ChainExpression draft={item.draft} />
      <dl><div><dt>冻结极值范围</dt><dd>{formatMm(item.result.minQ)} 至 {formatMm(item.result.maxQ)} mm</dd></div>
        <div><dt>冻结计算判定</dt><dd>{statusLabel[item.result.status]}</dd></div>
        <div><dt>冻结审查记录（非当前确认）</dt><dd>{item.status === 'complete' ? '当时已完成' : '当时待复核'} · 待办 {item.pendingCount}</dd></div>
        <div><dt>基线 comparison</dt><dd>{item.comparison ? `已冻结 · 基线极值 ${formatMm(item.comparison.baselineResult.minQ)} 至 ${formatMm(item.comparison.baselineResult.maxQ)} mm` : '未冻结'}</dd></div>
      </dl><p>只读展示 AnalysisSnapshot 原值，不以当前输入重新计算。</p>
    </article>)}
  </div>
}
