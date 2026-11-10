import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useDesktopSession } from '../workspace/useDesktopSession'
import { useBuiltinAssemblyView } from '../workspace/useBuiltinAssemblyView'
import { useImportedModel } from '../workspace/useImportedModel'
import type { PendingImport } from '../workspace/useImportedModel'
import { calculateChain } from '../domain/calculate'
import { formatMm } from '../domain/units'
import { draftToChain } from '../workspace/draft'
import { SessionDialogs } from '../components/SessionDialogs'
import { DesktopChainView, DesktopSourceView, DesktopHistoryView } from '../components/DesktopSessionViews'
import { ThreeViewport } from '../components/ThreeViewport'
import { ModelViewport } from '../components/ModelViewport'
import { DEMO_PARTS, demoPart, isBuiltinPartId, partPropertyRows, qToMm } from '../parts/shaftDemo'
import { SpacerDrawingPanel } from '../components/SpacerDrawingPanel'
import { ChangeWorkbench } from '../components/ChangeWorkbench'
import { RequirementWizard } from '../components/RequirementWizard'
import { RequirementStatusPanel } from '../components/RequirementStatusPanel'
import { RequirementRevisionHistory } from '../components/RequirementRevisionHistory'
import { ExtractionReviewPanel } from '../components/ExtractionReviewPanel'
import {
  listRequirementRevisionHistory,
  resolveRequirementRevisionSource,
} from '../requirements/history'
import { rebuildDrawingFromProject } from '../drawing/rebuildDrawing'
import { dimensionText, resolveDimension } from '../drawing/formatDimension'
import { formatParameterValue } from '../drawing/formatDimension'
import {
  SPACER_PARAMETER_LABELS,
} from '../drawing/types'
import type { ProjectFileVisualReferenceLink } from '../project-file/types'
import { isVisualReferenceLink } from '../project-file/types'
import { REQUIREMENT_STATUS_LABEL } from '../requirements/types'
import './Workspace.css'
import './DesktopWorkspace.css'

const tabs = ['工程图', '3D', '来源 PDF', '尺寸链', '历史报告', '任务书提取'] as const
const groups = ['零件', '工程图', '尺寸链', '来源资料', '版本历史'] as const

/** 只调整布局，不维护工程数据或计算状态。 */
function Splitter({ label, value, min, max, onChange, horizontal = false, reverse = false }: {
  label: string; value: number; min: number; max: number; onChange: (value: number) => void
  horizontal?: boolean; reverse?: boolean
}) {
  const drag = useRef<{ start: number; value: number } | null>(null)
  const clamp = (next: number) => onChange(Math.max(min, Math.min(max, next)))
  return <div className={`desktop-workspace__splitter${horizontal ? ' desktop-workspace__splitter--horizontal' : ''}`}
    role="separator" tabIndex={0} aria-label={label} aria-orientation={horizontal ? 'horizontal' : 'vertical'}
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
    onKeyDown={event => {
      const delta = event.key === (horizontal ? 'ArrowDown' : 'ArrowRight') ? 8
        : event.key === (horizontal ? 'ArrowUp' : 'ArrowLeft') ? -8 : 0
      if (delta || event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        clamp(event.key === 'Home' ? min : event.key === 'End' ? max : value + delta * (reverse ? -1 : 1))
      }
    }}
    onPointerDown={event => {
      drag.current = { start: horizontal ? event.clientY : event.clientX, value }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={event => {
      if (drag.current) clamp(drag.current.value + ((horizontal ? event.clientY : event.clientX) - drag.current.start) * (reverse ? -1 : 1))
    }}
    onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} />
}

export function DesktopWorkspace() {
  const session = useDesktopSession()
  const snapshot = session.state?.snapshot
  const project = snapshot?.project
  const activeRequirement =
    project?.requirementRevisions.find(
      (item) => item.revisionId === project.activeRequirementRevisionId,
    ) ?? null
  const requirementHistory = snapshot == null
    ? []
    : listRequirementRevisionHistory(snapshot)
  const requirementSource = activeRequirement === null || snapshot == null
    ? null
    : resolveRequirementRevisionSource(snapshot, activeRequirement.revisionId).location
  function locateRequirementRevision(revisionId: string): void {
    if (snapshot == null) return
    const resolved = resolveRequirementRevisionSource(snapshot, revisionId)
    if (resolved.location === null) {
      setLocateError(resolved.issue?.message ?? `条款版本 ${revisionId} 无法定位来源。`)
      return
    }
    locateNonce.current += 1
    setLocateError(null)
    setLocate({ ...resolved.location, locateNonce: locateNonce.current })
    setTab(2)
  }
  function locateRequirement(): void {
    if (activeRequirement === null) return
    locateRequirementRevision(activeRequirement.revisionId)
  }
  const drawingRebuilt = useMemo(
    () => (project ? rebuildDrawingFromProject(project) : null),
    [project],
  )
  const committedDrawing = drawingRebuilt?.ok ? drawingRebuilt.data : null
  /**
   * 合法草稿的自动预览成功后，main 返回按候选参数重建的 DrawingData。
   * 图纸区/属性/项目树显示候选画面（明确标“未提交”），但正式图纸记录、
   * 导出与提交仍只走 project 的权威数据；非法输入时保留上次有效候选画面。
   */
  const candidateDrawing = session.change.preview?.drawing.right ?? null
  const effectiveDrawing = candidateDrawing ?? committedDrawing
  const sessionId = session.state?.sessionId ?? null
  const [tab, setTab] = useState(0)
  // 选择归属当前会话：换会话即派生为 null，不靠 effect 清理（也不会串场）。
  const [selectionState, setSelectionState] = useState<{ sessionId: string | null; value: string | null }>({ sessionId: null, value: null })
  const selection = selectionState.sessionId === sessionId ? selectionState.value : null
  const setSelection = (value: string | null) => setSelectionState({ sessionId, value })
  const demo = useBuiltinAssemblyView(sessionId)
  const model = useImportedModel({
    sessionId,
    acceptedSeq: session.state?.acceptedSeq ?? 0,
    snapshot: snapshot ?? null,
    apply: session.applyModelMutation,
  })
  const [linkDialog, setLinkDialog] = useState<
    | { kind: 'bind'; termId: string; granularity: 'model' | 'part' }
    | { kind: 'confirm'; link: ProjectFileVisualReferenceLink }
    | null
  >(null)
  const [leftOpen, setLeftOpen] = useState(() => !window.matchMedia?.('(max-width: 600px)').matches)
  const [rightOpen, setRightOpen] = useState(() => !window.matchMedia?.('(max-width: 1100px)').matches)
  const [leftWidth, setLeftWidth] = useState(232)
  const [rightWidth, setRightWidth] = useState(312)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewHeight, setReviewHeight] = useState(200)
  const [requirementOpen, setRequirementOpen] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)
  // V3.6：提取定位只读读取确切版本字节；不接受本地路径或任意 blobKey。
  const readExtractionBytes = async (revision: import('../sources/types').SourceRevision): Promise<Uint8Array> => {
    if (sessionId === null || window.cunlian === undefined) throw new Error('window.cunlian 不可用')
    const result = await window.cunlian.readAttachment({ sessionId, revisionId: revision.id })
    if (!result.ok) throw new Error(`附件不可用 · ${result.error.code}：${result.error.message}`)
    return result.value.bytes
  }
  const [locate, setLocate] = useState<import('../components/DesktopSessionViews').RequirementSourceLocation | null>(null)
  const locateNonce = useRef(0)

  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLButtonElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && exportOpen) { setExportOpen(false); exportRef.current?.focus() }
    }
    window.addEventListener('keydown', keydown)
    return () => { window.removeEventListener('keydown', keydown) }
  }, [exportOpen])

  /**
   * 启动页轴系示例入口：先建可另存的尺寸链会话，成功后才开启 3D 侧车。
   * 3D 只在示例开启时挂载（动态 import three）；之后切标签保持挂载、只暂停渲染。
   */
  async function openShaftDemo() {
    const created = await session.create('轴系示例（B1）· 示意装配', 'chain-demo')
    if (!created) return
    demo.activate(created)
    setTab(1)
  }

  function tabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const next = event.key === 'ArrowRight' ? (tab + 1) % tabs.length : event.key === 'ArrowLeft' ? (tab + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
    if (next !== null) { event.preventDefault(); setTab(next); tabRefs.current[next]?.focus() }
  }
  const style = { '--tree-width': `${leftOpen ? leftWidth : 0}px`, '--properties-width': `${rightOpen ? rightWidth : 0}px`, '--review-height': `${reviewHeight}px` } as CSSProperties
  const parsed = snapshot?.draft ? draftToChain(snapshot.draft) : project ? { ok: true as const, chain: project.dimensionChain } : null
  const result = parsed?.ok ? calculateChain(parsed.chain) : null
  const calculation = result ? ({ within: '满足目标（非审查结论）', outside: '超出目标', 'no-target': '未设目标' }[result.status]) : '输入无效，未计算'
  const sourceState = snapshot ? `${snapshot.documents.length} 份资料 · ${snapshot.bindings.length} 个绑定 · 未审查附件可读性` : '未载入'
  const spacerParameters = session.change.draft?.parameters ?? project?.parameters ?? []
  const spacerByKey = new Map(spacerParameters.map(parameter => [parameter.key, parameter]))
  const spacerMm = spacerByKey.size === 3
    ? {
        innerRadius: qToMm(spacerByKey.get('innerDiameter')!.valueQ) / 2,
        outerRadius: qToMm(spacerByKey.get('outerDiameter')!.valueQ) / 2,
        length: qToMm(spacerByKey.get('length')!.valueQ),
      }
    : undefined
  const modelParts = project?.parts ?? []
  const currentModelRevision = project?.modelRevisions.find(
    (item) => item.modelRevisionId === model.revisionId,
  ) ?? null
  const entries: Record<string, { id: string; label: string; properties: [string, string][] }[]> = {
    零件: [
      ...modelParts.map(part => {
        const rev = project?.modelRevisions.find(item => item.modelRevisionId === part.currentModelRevisionId)
        return {
          id: part.partId,
          label: part.name,
          properties: [
            ['类型', part.kind === 'imported-mesh' ? '导入模型（整体网格）' : '内置示意部件（只读）'],
            ['当前模型版本', part.currentModelRevisionId ?? '无'],
            ['文件名', rev?.fileName ?? '—'],
            ['编码 / 面数', rev ? `${rev.encoding === 'binary' ? '二进制' : 'ASCII'} · ${rev.triangleCount.toLocaleString('en-US')} 面` : '—'],
            ['单位备注', rev?.unitNote ?? '未注明（STL 无标准单位）'],
            ['关联尺寸链', '仅供外形资料来源；不改变尺寸链数值、不自动同步'],
          ] as [string, string][],
        }
      }),
      ...(demo.active ? DEMO_PARTS.map(part => ({ id: part.id, label: part.name, properties: partPropertyRows(part.id, demo.explodeT) })) : []),
    ],
    工程图: [
      ...(project?.drawings ?? []).map(record => ({
        id: `drawing:${record.drawingId}`,
        label: `隔套工程图 · ${record.scale.numerator}:${record.scale.denominator}`,
        properties: [
          ['状态', '待复核草稿（未复核、未批准）'],
          ['模板', `${record.templateId} v${record.templateVersion}`],
          ['纸张', 'A4 横向 297×210 mm'],
          ['比例', `${record.scale.numerator}:${record.scale.denominator}`],
          ['图纸指纹', record.dataFingerprint],
          ['参数引用', record.parameterIds.join('、')],
        ] as [string, string][],
      })),
      ...(effectiveDrawing?.parameterSnapshot ?? []).map(parameter => ({
        id: `param:${parameter.parameterId}`,
        label: `${SPACER_PARAMETER_LABELS[parameter.key]} · ${formatParameterValue(parameter.valueQ, parameter.inputDecimals) ?? '数据不一致'}`,
        properties: [
          ['q', String(parameter.valueQ)],
          ['输入小数位', String(parameter.inputDecimals)],
          ['显示', formatParameterValue(parameter.valueQ, parameter.inputDecimals) ?? '数据不一致'],
          ['来源备注', parameter.sourceNote ?? '无'],
          ['绑定标注', effectiveDrawing?.annotations.filter(item => item.parameterId === parameter.parameterId).map(item => item.kind === 'diameter' ? '直径' : '长度').join('、') || '无'],
        ] as [string, string][],
      })),
      ...(effectiveDrawing?.annotations ?? []).map(annotation => {
        const resolved = resolveDimension(annotation.parameterId, effectiveDrawing!.parameterSnapshot)
        const text = resolved.ok ? dimensionText(resolved.value, annotation.kind) : '解析失败'
        return {
          id: `annotation:${annotation.annotationId}`,
          label: `标注 · ${text}`,
          properties: [
            ['类型', annotation.kind === 'diameter' ? '直径' : '长度'],
            ['绑定参数', annotation.parameterId],
            ['显示值', text],
            ['视图', annotation.viewId],
          ] as [string, string][],
        }
      }),
    ],
    尺寸链: project ? [{ id: 'chain', label: '当前尺寸链', properties: [['组成环', String(project.dimensionChain.terms.length)], ['计算预览', calculation]] }, ...project.dimensionChain.terms.map(term => ({ id: `term:${term.id}`, label: `${term.symbol} · ${term.name}`, properties: [['基本尺寸', `${formatMm(term.nominalQ)} mm`], ['下偏差', `${formatMm(term.lowerDeviationQ)} mm`], ['上偏差', `${formatMm(term.upperDeviationQ)} mm`], ['方向', term.sign === 1 ? '增环' : '减环'], ['来源备注', term.sourceNote || '无']] as [string, string][] }))] : [],
    来源资料: snapshot?.documents.map(doc => { const rev = snapshot.revisions.find(rev => rev.id === doc.latestRevisionId); return { id: `source:${doc.id}`, label: doc.title, properties: [['当前版本', doc.latestRevisionId], ['文件名', rev?.fileName ?? '缺失版本'], ['页数', String(rev?.pageCount ?? '未知')], ['附件状态', snapshot.missingAttachments.some(item => item.documentId === doc.id) ? '声明缺失' : '有元数据，未读取附件']] } }) ?? [],
    版本历史: snapshot?.fileRevisions.map(rev => ({ id: `rev:${rev.revisionId}`, label: `Rev ${rev.revisionId}`, properties: [['创建时间', rev.createdAt], ['原因', rev.reason], ['父版本', rev.parentId ?? '无'], ['项目 schema', String(rev.project.schemaVersion)]] })) ?? [],
  }
  const selected = Object.values(entries).flat().find(item => item.id === selection)
  const selectedPart = isBuiltinPartId(selection) && demo.active ? demoPart(selection) : null
  const selectedModelPart = modelParts.find(part => part.partId === selection) ?? null
  const selectedParameterId = selection?.startsWith('param:') ? selection.slice('param:'.length) : null
  const selectedAnnotationId = selection?.startsWith('annotation:') ? selection.slice('annotation:'.length) : null
  const annotationParameterId = selectedAnnotationId === null
    ? null
    : effectiveDrawing?.annotations.find(item => item.annotationId === selectedAnnotationId)?.parameterId ?? null
  const activeParameterId = selectedParameterId ?? annotationParameterId
  const selectedTermId = selection?.startsWith('term:') ? selection.slice('term:'.length) : null
  const termLinks = selectedTermId && project ? project.dimensionLinks.filter(isVisualReferenceLink).filter((link) => link.termId === selectedTermId) : []
  const linkTargetName = (link: ProjectFileVisualReferenceLink): string =>
    project?.parts.find(part => part.partId === link.target.partId)?.name ?? link.target.partId
  const saveState = session.state?.lastError && ['PERMISSION_DENIED', 'NO_SPACE', 'WRITE_FAILED', 'VERIFY_FAILED', 'RENAME_FAILED', 'EXTERNAL_MODIFIED', 'SAVE_FAILED'].includes(session.state.lastError.code) ? '保存失败，编辑内容仍可继续处理' : !session.state?.path ? '未保存草稿' : session.state.saveStateKnown === false ? '已恢复会话 · 正式保存状态未知' : session.state.dirty ? '有未保存修改' : '已保存'
  const dialogs = <SessionDialogs session={session} />
  if (!project) return <main className="desktop-workspace" aria-label="寸链启动页">
    <header className="desktop-workspace__titlebar"><h1>寸链</h1><span className="desktop-workspace__batch">V3.5 · Beta</span></header>
    <section className="desktop-workspace__start">
      <h2>打开项目，继续设计</h2><p>轴系轴向公差链分析</p>
      <div className="desktop-workspace__start-actions">
        <button disabled={session.busy} onClick={() => session.action('new')}>新建项目…</button>
        <button disabled={session.busy} aria-keyshortcuts="Meta+O" onClick={() => session.action('open')}>打开项目…</button>
        <button disabled={session.busy} onClick={() => void session.create('尺寸链示例（A）', 'chain-demo')}>打开内置示例 · 尺寸链示例（A）</button>
        <button disabled={session.busy} onClick={() => void openShaftDemo()}>打开轴系示例 · 示意装配（B1）</button>
        <button disabled={session.busy} onClick={() => session.action('importV2')}>导入 V2 备份…</button>
      </div>
      {session.recovery.length > 0 && <section className="desktop-workspace__recovery"><h3>有尚未保存的恢复草稿</h3>{session.recovery.map(item => <div key={item.recoveryId}><span>{item.name} · {item.savedAt}</span>{item.error ? <p role="alert">{item.error}</p> : <button disabled={session.busy} onClick={() => void session.restore(item.recoveryId)}>恢复为未保存副本</button>}</div>)}</section>}
      <h3>最近项目</h3>
      {!session.recent.length && <p>暂无最近项目</p>}
      <ul className="desktop-workspace__recent">{session.recent.map(item => <li key={item.recentId}><div><strong>{item.name}</strong><p>{item.rev ? `Rev ${item.rev}` : 'Rev 不可用'} · 上次打开 {item.lastOpenedAt}</p><p>{item.path}</p></div><button disabled={session.busy} onClick={() => void session.openRecent(item)}>{item.missing ? '重新定位' : '打开'}</button></li>)}</ul>
      <p role="status">{session.notice || (window.cunlian ? '文件操作由桌面应用处理。' : 'window.cunlian 不可用，请在桌面应用中执行文件操作。')}</p>
    </section>{dialogs}
  </main>
  return <main className="desktop-workspace" style={style} aria-label="寸链桌面工作台">
    <header className="desktop-workspace__titlebar">
      <h1>寸链 · {project.name}</h1><span>Rev {project.currentRevisionId}</span><span className="desktop-workspace__pending">{saveState}</span>
      <span className="desktop-workspace__batch">V3.5 · Beta</span>
    </header>
    <div className="desktop-workspace__toolbar" role="toolbar" aria-label="项目操作">
      <button disabled={session.busy} onClick={() => session.action('new')}>新建项目</button>
      <button disabled={session.busy} aria-keyshortcuts="Meta+O" onClick={() => session.action('open')}>打开项目</button>
      <button disabled={session.busy} aria-keyshortcuts="Meta+S" onClick={() => session.action('save')}>保存</button>
      <button disabled={session.busy} aria-keyshortcuts="Meta+Shift+S" onClick={() => session.action('saveAs')}>另存为…</button>
      <button disabled={session.busy} onClick={() => session.action('importV2')}>导入 V2 备份…</button>
      <button disabled={session.busy} onClick={() => session.action('close')}>关闭窗口</button>
      <button disabled={session.busy || snapshot === undefined} onClick={() => void session.importSource(null)}>导入资料</button>
      <span id="desktop-import-reason" className="desktop-workspace__toolbar-note">PDF 由主进程读取字节、SHA-256、页数与附件；失败不写入</span>
      <button disabled={model.busy || session.busy} onClick={() => void model.beginImport(false)}>导入模型…</button>
      {model.partId && <button disabled={model.busy || session.busy} onClick={() => void model.beginImport(true)}>替换模型…</button>}
      <div className="desktop-workspace__toolbar-end">
        <button disabled title="请在工程图页建立参数草稿">预览变更</button>
        <button ref={exportRef} aria-expanded={exportOpen} aria-controls="desktop-export" onClick={() => setExportOpen(!exportOpen)}>导出 PDF ▾</button>
        {exportOpen && <div id="desktop-export" className="desktop-workspace__export">
          <strong>图纸导出在“工程图”页</strong>
          <p>SVG 与 PDF 都由同一份图纸数据生成；导出文件不会自动回灌为项目附件。</p>
        </div>}
      </div>
    </div>
    <div className="desktop-workspace__notice" role="status">{session.notice || (session.state?.lastError ? `${session.state.lastError.code}：${session.state.lastError.message}` : session.state?.warnings.join('；')) || '当前会话已载入；绑定来源不等于审查通过。'}{session.state?.recoveryWarning && <span>{session.state.recoveryWarning}</span>}</div>
    {model.error && <div className="desktop-workspace__model-error" role="alert">
      <strong>模型导入失败：{model.error.code}</strong>
      <span>{model.error.message}{model.error.detail ? `（${model.error.detail}）` : ''}</span>
      <span>旧视图、当前版本与关联未改变，项目未写入。</span>
      <button type="button" onClick={model.clearError}>知道了</button>
    </div>}
    {model.pending && <ModelImportDialog
      pending={model.pending}
      defaultPartName={
        (model.pending.replacePartId
          ? project.parts.find(part => part.partId === model.pending!.replacePartId)?.name
          : undefined) ?? model.pending.fileName.replace(/\.stl$/i, '')
      }
      busy={model.busy}
      onCancel={() => void model.cancelPending()}
      onCommit={(partName, unitNote) => void model.commitPending(partName, unitNote)}
    />}
    {linkDialog && project && <div className="desktop-workspace__model-dialog" role="dialog" aria-modal="true" aria-label="确认外形资料来源关联">
      <h2>{linkDialog.kind === 'bind' ? '关联外形资料来源' : '核对新版外形资料来源'}</h2>
      {linkDialog.kind === 'bind' ? <p>
        组成环 <strong>{project.dimensionChain.terms.find(term => term.id === linkDialog.termId)?.symbol ?? linkDialog.termId}</strong>
        {' '}↔ {linkDialog.granularity === 'model' ? '整体模型' : '已登记部件'}「{selectedModelPart?.name ?? modelParts.find(part => part.partId === model.partId)?.name ?? '—'}」
        {linkDialog.granularity === 'model' && model.revisionId ? `（版本 ${model.revisionId}）` : ''}。
      </p> : <p>
        {linkTargetName(linkDialog.link)}：旧版 {linkDialog.link.target.modelRevisionId ?? '无版本'} → 当前新版 {model.revisionId ?? '—'}。
        确认后只更新外形资料来源定位；不会改尺寸链数值。
      </p>}
      <p className="desktop-workspace__pending">该关联只表示外形资料来源：不改变尺寸链数值、不自动同步，也不是 D 批次参数联动。</p>
      <div className="desktop-workspace__model-dialog-actions">
        <button type="button" onClick={() => setLinkDialog(null)}>取消</button>
        <button type="button" className="desktop-workspace__primary" disabled={model.busy || model.partId === null} onClick={() => {
          const dialog = linkDialog
          void (async () => {
            const ok = dialog.kind === 'bind'
              ? await model.bindLink({ termId: dialog.termId, granularity: dialog.granularity, partId: model.partId!, modelRevisionId: model.revisionId })
              : await model.confirmLink({ linkId: dialog.link.linkId, termId: dialog.link.termId, partId: dialog.link.target.partId, modelRevisionId: model.revisionId })
            if (ok) setLinkDialog(null)
          })()
        }}>{linkDialog.kind === 'bind' ? '确认关联（不改变数值）' : '确认采用新版'}</button>
      </div>
    </div>}
    <nav className="desktop-workspace__layout-tools" aria-label="工作区布局">
      <button aria-expanded={leftOpen} aria-controls="desktop-tree" onClick={() => setLeftOpen(!leftOpen)}>{leftOpen ? '收起' : '展开'}项目树</button>
      <span>选择对象后查看属性</span>
      <button aria-expanded={rightOpen} aria-controls="desktop-properties" onClick={() => setRightOpen(!rightOpen)}>{rightOpen ? '收起' : '展开'}属性栏</button>
    </nav>
    <div className="desktop-workspace__body">
      <aside id="desktop-tree" className="desktop-workspace__tree" aria-label="项目树" hidden={!leftOpen}>
        <h2>项目树</h2>
        {groups.map(group => <details key={group} open>
          <summary>{group}</summary>
          {entries[group].length ? entries[group].map(item => <button key={item.id} aria-pressed={selected?.id === item.id} onClick={() => { setSelection(item.id); if (group === '尺寸链') setTab(3); if (group === '版本历史') setTab(4) }}>{item.label}</button>) : <p>{group === '零件' ? '尚未打开轴系示例 · B1' : group === '工程图' ? '暂无工程图' : `暂无${group}`}</p>}
        </details>)}
      </aside>
      {leftOpen ? <Splitter label="项目树宽度" value={leftWidth} min={180} max={280} onChange={setLeftWidth} /> : <div />}
      <section className="desktop-workspace__center" aria-label="中央工作区">
        <div role="tablist" aria-label="工作视图" className="desktop-workspace__tabs">
          {tabs.map((name, index) => <button key={name} ref={node => { tabRefs.current[index] = node }} role="tab" id={`desktop-tab-${index}`} aria-controls={`desktop-panel-${index}`} aria-selected={tab === index} tabIndex={tab === index ? 0 : -1} onKeyDown={tabKey} onClick={() => setTab(index)}>{name}</button>)}
        </div>
        {tabs.map((name, index) => <div key={name} role="tabpanel" id={`desktop-panel-${index}`} aria-labelledby={`desktop-tab-${index}`} tabIndex={0} hidden={tab !== index} className="desktop-workspace__canvas">
          {index === 0 && <div className="desktop-workspace__drawing-tab">
            <ChangeWorkbench
              key={`${session.state?.sessionId ?? 'none'}:${project.currentRevisionId}`}
              snapshot={snapshot!}
              events={snapshot!.events}
              sessionId={sessionId}
              change={session.change}
              onStage={session.stageChange}
              onPreview={session.previewChange}
              onAutoPreview={session.autoPreviewChange}
              onApply={session.applyChange}
              onBind={session.bindParameter}
              onUnbind={session.unbindParameter}
              onRestore={session.restoreRevisionDraft}
              onLocateRequirement={locateRequirement}
            />
            <SpacerDrawingPanel
              sessionId={sessionId}
              acceptedSeq={session.state?.acceptedSeq ?? 0}
              project={project}
              draftPreview={{
                drawing: candidateDrawing,
                staleReason: session.change.staleReason,
                autoState: session.change.autoState,
              }}
              selectedParameterId={activeParameterId}
              selectedAnnotationId={selectedAnnotationId}
              onSelectParameter={parameterId => setSelection(parameterId === null ? null : `param:${parameterId}`)}
              onSelectAnnotation={annotationId => setSelection(`annotation:${annotationId}`)}
              applySnapshot={session.applyDrawingMutation}
            />
          </div>}
          {index === 1 && (model.revisionId !== null ? (
            model.geometry
              ? <ModelViewport
                  geometry={model.geometry}
                  selected={selection !== null && selection === model.partId}
                  onSelect={value => setSelection(value ? model.partId : null)}
                  active={tab === 1}
                  view={model.view}
                  onViewChange={model.setView}
                />
              : <div className="desktop-workspace__placeholder">
                  <span className="desktop-workspace__pending">○ {model.loading ? '正在载入模型' : '模型几何不可用'}</span>
                  <h2>{currentModelRevision?.fileName ?? '当前模型版本'}</h2>
                  {model.loading
                    ? <p>正在读取已保存的模型字节并做严格校验…</p>
                    : <p>{model.error ? `${model.error.code}：${model.error.message}${model.error.detail ? `（${model.error.detail}）` : ''}` : '当前模型版本没有可显示几何。'}</p>}
                  <p>旧视图（若有）与项目数据保留；替换会创建新的不可变版本，旧版本可回查。</p>
                  <button type="button" disabled={model.busy} onClick={() => void model.beginImport(true)}>替换模型…</button>
                </div>
          ) : demo.active
            ? <ThreeViewport selectedPartId={selectedPart?.id ?? null} onSelectPart={partId => setSelection(partId)} explodeT={demo.explodeT} onExplodeTChange={demo.setExplodeT} active={tab === 1} viewState={demo.view} onViewStateChange={demo.setView} spacerMm={spacerMm} />
            : <div className="desktop-workspace__placeholder">
              <span className="desktop-workspace__pending">○ 尚无 3D 视图</span>
              <h2>导入 STL 或查看内置轴系示例</h2>
              <p>可导入二进制/ASCII STL（≤10 MiB、≤200,000 面）。导入是整体网格：旋转/缩放/平移只改相机，不提供部件爆炸；单位只作为备注，不缩放顶点、不改 q。</p>
              <p>内置轴系示例是只读示意装配（5 个部件）；示例与当前项目尺寸链未关联，几何固定，不随尺寸编辑变化。</p>
              <div className="desktop-workspace__model-dialog-actions">
                <button type="button" disabled={model.busy} onClick={() => void model.beginImport(false)}>导入 STL 模型…</button>
                <button type="button" onClick={() => demo.activate()}>查看内置轴系示例</button>
              </div>
            </div>)}
          {index > 1 && tab === index && snapshot && (index === 2 ? <DesktopSourceView key={`${session.state!.sessionId}:${locate?.locateNonce ?? 'none'}`} snapshot={snapshot} sessionId={session.state!.sessionId!} requirementSource={requirementSource} locate={locate} onImportVersion={(documentId) => void session.importSource(documentId)} /> : index === 3 ? <DesktopChainView snapshot={snapshot} edit={session.edit} disabled={session.busy} /> : index === 4 ? <DesktopHistoryView snapshot={snapshot} requirementHistory={requirementHistory} onLocateRequirement={locateRequirementRevision} /> : <ExtractionReviewPanel
            snapshot={snapshot}
            busy={session.busy}
            readBytes={readExtractionBytes}
            actions={{
              onRun: (request) => session.runExtraction(request),
              onDecide: (request) => session.decideExtraction(request),
              onCancel: (requestId) => session.cancelExtraction(requestId),
            }}
          />)}
        </div>)}
      </section>
      {rightOpen ? <Splitter label="属性栏宽度" value={rightWidth} min={240} max={340} reverse onChange={setRightWidth} /> : <div />}
      <aside id="desktop-properties" className="desktop-workspace__properties" aria-label="属性栏" hidden={!rightOpen}>
        <h2>属性 · {selected?.label ?? '未选择'}</h2><p>选择项目树中的对象查看会话快照。</p>
        <dl><dt>项目版本</dt><dd>{project.currentRevisionId}</dd>{selected?.properties.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
        {selectedPart && <section className="desktop-workspace__part-note" aria-label="示例部件只读说明">
          <p className="desktop-workspace__pending">未关联尺寸链 · 示例几何（B1 只读）</p>
          <button type="button" onClick={() => setTab(0)}>在工程图页编辑参数</button>
          <p>隔套三参数编辑与图纸标注在“工程图”页；参数联动草稿/预览/确认同页。</p>
        </section>}
        {selectedModelPart && <section className="desktop-workspace__part-note" aria-label="导入模型只读说明">
          <p className="desktop-workspace__pending">整体网格 · 外形资料来源；不改变尺寸链数值、不自动同步</p>
          <button type="button" disabled={model.busy} onClick={() => void model.beginImport(false)}>导入第二个模型…</button>
          <button type="button" disabled={model.busy || !model.revisionId} onClick={() => void model.beginImport(true)}>替换当前模型…</button>
          <p>替换会创建新的不可变 ModelRevision，旧版本字节与历史引用保留；受影响的已确认关联转为“待核对”。</p>
        </section>}
        {selectedTermId && project && <section className="desktop-workspace__part-note" aria-label="外形资料来源关联">
          <h3>外形资料来源</h3>
          {termLinks.length === 0 && <p>尚无关联。关联只表示外形资料来源，不改变尺寸链数值、不自动同步。</p>}
          {termLinks.map(link => {
            const targetName = linkTargetName(link)
            const current = model.revisionId
            const stale = link.reviewStatus === 'pending' || (link.target.modelRevisionId !== null && link.target.modelRevisionId !== current)
            return <div key={link.linkId} className="desktop-workspace__link-row">
              <p>
                {link.target.granularity === 'model' ? '整体模型' : '已登记部件'}「{targetName}」
                {link.target.modelRevisionId ? ` · 版本 ${link.target.modelRevisionId}` : ''}
                {' · '}
                {link.reviewStatus === 'confirmed' && !stale ? '已核对' : `待核对${link.reason === 'model-replaced' ? '（模型已替换）' : ''}`}
              </p>
              {stale && link.reviewStatus === 'pending' && current && <p>旧版 {link.target.modelRevisionId ?? '无'} → 当前新版 {current}</p>}
              {link.reviewStatus === 'pending' && <button type="button" disabled={model.busy || !current} onClick={() => setLinkDialog({ kind: 'confirm', link })}>核对新版…</button>}
            </div>
          })}
          {model.partId && model.revisionId && <>
            <button type="button" disabled={model.busy} onClick={() => setLinkDialog({ kind: 'bind', termId: selectedTermId, granularity: 'model' })}>关联整体模型…</button>
            <button type="button" disabled={model.busy} onClick={() => setLinkDialog({ kind: 'bind', termId: selectedTermId, granularity: 'part' })}>关联部件（记录版本）…</button>
          </>}
          {!model.partId && <p>先导入或打开含模型的部件后才能建立关联。</p>}
          <p className="desktop-workspace__pending">参数联动（改尺寸→改模型）属于 D 批次，不在本关联内。</p>
        </section>}
        {activeParameterId && effectiveDrawing && (() => {
          const parameter = effectiveDrawing.parameterSnapshot.find(item => item.parameterId === activeParameterId)
          if (!parameter) return <section className="desktop-workspace__part-note"><p>该参数不在当前图纸快照中。</p></section>
          const bound = effectiveDrawing.annotations.filter(item => item.parameterId === parameter.parameterId)
          return <section className="desktop-workspace__part-note" aria-label="图纸参数详情">
            <h3>{SPACER_PARAMETER_LABELS[parameter.key]} · 图纸参数</h3>
            <p>q = {parameter.valueQ} · 输入 {parameter.inputDecimals} 位小数</p>
            <p>显示：<strong>{formatParameterValue(parameter.valueQ, parameter.inputDecimals) ?? '数据不一致'}</strong>（标注数字来自此参数，不读几何/像素）</p>
            <p>来源备注：{parameter.sourceNote ?? '无'}</p>
            <button type="button" onClick={() => setTab(0)}>定位参数输入</button>
            <h3>绑定标注</h3>
            {bound.length === 0 && <p>无绑定标注。</p>}
            {bound.map(annotation => <button key={annotation.annotationId} type="button" onClick={() => setSelection(`annotation:${annotation.annotationId}`)}>
              定位标注 · {annotation.kind === 'diameter' ? '直径' : '长度'} · {annotation.annotationId}
            </button>)}
            <p className="desktop-workspace__pending">修改参数只生成图纸草稿，不改尺寸链 S，也不提升复核状态。</p>
          </section>
        })()}
        <p className="desktop-workspace__pending">○ 尚无审查结论</p>
      </aside>
    </div>
    {reviewOpen && <Splitter label="复核区高度" value={reviewHeight} min={160} max={280} horizontal reverse onChange={setReviewHeight} />}
    <section className={`desktop-workspace__review${reviewOpen ? ' desktop-workspace__review--open' : ''}`} aria-label="复核与变更">
      <button className="desktop-workspace__review-toggle" aria-expanded={reviewOpen} aria-controls="desktop-review-content" onClick={() => setReviewOpen(!reviewOpen)}>{reviewOpen ? '▾' : '▸'} 复核与变更 <span>计算 {calculation} · 来源 {sourceState} · 图纸 {project.drawings.length > 0 ? '待复核草稿' : '未生成'}</span></button>
      <div id="desktop-review-content" hidden={!reviewOpen} className="desktop-workspace__review-groups">
        <section><h3>变更</h3>{session.change.preview ? <><p>预览 {session.change.preview.drawing.record.revisionId}：受影响环 {session.change.preview.affectedTermIds.length} 个；旧结果 {formatMm(session.change.preview.previousResult.minQ)} ～ {formatMm(session.change.preview.previousResult.maxQ)} mm → 新结果 {formatMm(session.change.preview.result.minQ)} ～ {formatMm(session.change.preview.result.maxQ)} mm。</p><p>受影响环不是错误；确认前可在“工程图”页查看逐环 diff。</p></> : <p>尚无变更预览。</p>}{session.change.staleReason && <p role="alert">预览已过期：{session.change.staleReason}</p>}</section>
        <section><h3>校核</h3><p>{calculation}</p>{result && <p>极限范围 {formatMm(result.minQ)} 至 {formatMm(result.maxQ)} mm</p>}{parsed && !parsed.ok && Object.entries(parsed.cellErrors).map(([field, message]) => <p key={field}>{field}：{message}</p>)}</section>
        <section aria-label="任务书要求">
          <h3>任务书要求（唯一判定依据）</h3>
          {activeRequirement === null ? <p>尚未绑定任务书要求。原项目目标仍在独立展示与计算。</p> : <>
            <p>活动条款 {activeRequirement.requirementId} · 版本 {activeRequirement.revisionId} · {formatMm(activeRequirement.lowerQ)} ～ {formatMm(activeRequirement.upperQ)} mm（闭区间）</p>
            <p>来源 {activeRequirement.source.revisionId} 第 {activeRequirement.source.page} 页 · SHA-256 {activeRequirement.source.sha256.slice(0, 12)}…</p>
            {project.currentRequirementCheck && <p>当前正式检查（冻结）：{REQUIREMENT_STATUS_LABEL[project.currentRequirementCheck.status]} · {project.currentRequirementCheck.reasonCodes.join('、')}</p>}
          </>}
          <div className="desktop-workspace__model-dialog-actions">
            <button type="button" disabled={session.busy || snapshot === undefined} onClick={() => setRequirementOpen(true)}>{activeRequirement === null ? '绑定任务书要求…' : '更新条款（新建版本）…'}</button>
            <button type="button" disabled={activeRequirement === null} onClick={locateRequirement}>定位任务书</button>
            {snapshot.documents.length === 0 && <button type="button" disabled={session.busy} onClick={() => void session.importSource(null)}>先导入任务书 PDF…</button>}
          </div>
          {locateError && <p role="alert" data-testid="requirement-locate-error-global">{locateError}</p>}
          {session.change.preview?.requirement?.revision && (
            <RequirementStatusPanel
              requirement={session.change.preview.requirement}
              target={project.dimensionChain.target}
              targetResult={session.change.preview.result}
              onLocate={locateRequirement}
              locateDisabled={session.busy}
            />
          )}
        </section>
        <RequirementRevisionHistory
          items={requirementHistory}
          onLocate={locateRequirementRevision}
          locateDisabled={session.busy || snapshot === undefined}
        />
        <section><h3>待办</h3><p>来源 {sourceState}。尚无桌面审查结论。</p></section>
      </div>
    </section>
    {requirementOpen && snapshot && sessionId && <RequirementWizard
      snapshot={snapshot}
      sessionId={sessionId}
      active={activeRequirement}
      previewRequirement={session.change.preview?.requirement ?? null}
      onStageEdit={session.stageRequirementEdit}
      onConfirm={session.confirmRequirement}
      onClose={() => { void session.stageRequirementEdit(null); setRequirementOpen(false) }}
    />}
    {dialogs}
  </main>
}

/** 导入确认：默认值由候选决定；用 key 让同一组件在换候选时重置表单。 */
function ModelImportDialog(props: {
  pending: PendingImport
  defaultPartName: string
  busy: boolean
  onCancel: () => void
  onCommit: (partName: string, unitNote: string) => void
}) {
  const { pending } = props
  return <form
    key={pending.candidateToken}
    className="desktop-workspace__model-dialog"
    role="dialog"
    aria-modal="true"
    aria-label="确认导入模型"
    onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      const partName = String(data.get('partName') ?? '').trim()
      const unitNote = String(data.get('unitNote') ?? '').trim()
      if (partName !== '') props.onCommit(partName, unitNote)
    }}
  >
    <h2>确认导入模型</h2>
    <p>{pending.fileName} · {pending.byteSize} 字节 · {pending.geometry.triangleCount.toLocaleString('en-US')} 面 · {pending.geometry.encoding === 'binary' ? '二进制' : 'ASCII'}</p>
    <label>部件名称<input name="partName" defaultValue={props.defaultPartName} required maxLength={200} /></label>
    <label>单位备注<input name="unitNote" defaultValue="未注明（STL 无标准单位）" maxLength={200} /></label>
    <p className="desktop-workspace__pending">单位只是用户备注：STL 无标准单位，不缩放原顶点、不修改 q。外形资料来源关联不改变尺寸链数值、不自动同步。</p>
    <div className="desktop-workspace__model-dialog-actions">
      <button type="button" onClick={props.onCancel} disabled={props.busy}>取消（释放候选）</button>
      <button type="submit" className="desktop-workspace__primary" disabled={props.busy}>导入为不可变版本</button>
    </div>
  </form>
}
