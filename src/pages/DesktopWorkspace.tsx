import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useDesktopSession } from '../workspace/useDesktopSession'
import { calculateChain } from '../domain/calculate'
import { formatMm } from '../domain/units'
import { draftToChain } from '../workspace/draft'
import { SessionDialogs } from '../components/SessionDialogs'
import { DesktopChainView, DesktopSourceView, DesktopHistoryView } from '../components/DesktopSessionViews'
import './Workspace.css'
import './DesktopWorkspace.css'

const tabs = ['工程图', '3D', '来源 PDF', '尺寸链', '历史报告'] as const
const groups = ['零件', '工程图', '尺寸链', '来源资料', '版本历史'] as const

const placeholders = [
  ['尚无工程图', 'C 批次未实现：SVG 图纸、参数标注与导出图纸 PDF。'],
  ['尚无 3D 模型', 'B1/B2 批次未实现：装配、爆炸视图与 STL 读取。'],

]

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
  const [tab, setTab] = useState(0)
  const [selection, setSelection] = useState<string | null>(null)
  const [leftOpen, setLeftOpen] = useState(() => !window.matchMedia?.('(max-width: 600px)').matches)
  const [rightOpen, setRightOpen] = useState(() => !window.matchMedia?.('(max-width: 1100px)').matches)
  const [leftWidth, setLeftWidth] = useState(232)
  const [rightWidth, setRightWidth] = useState(312)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewHeight, setReviewHeight] = useState(200)

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

  function tabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const next = event.key === 'ArrowRight' ? (tab + 1) % tabs.length : event.key === 'ArrowLeft' ? (tab + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
    if (next !== null) { event.preventDefault(); setTab(next); tabRefs.current[next]?.focus() }
  }
  const style = { '--tree-width': `${leftOpen ? leftWidth : 0}px`, '--properties-width': `${rightOpen ? rightWidth : 0}px`, '--review-height': `${reviewHeight}px` } as CSSProperties
  const parsed = snapshot?.draft ? draftToChain(snapshot.draft) : project ? { ok: true as const, chain: project.dimensionChain } : null
  const result = parsed?.ok ? calculateChain(parsed.chain) : null
  const calculation = result ? ({ within: '满足目标（非审查结论）', outside: '超出目标', 'no-target': '未设目标' }[result.status]) : '输入无效，未计算'
  const sourceState = snapshot ? `${snapshot.documents.length} 份资料 · ${snapshot.bindings.length} 个绑定 · 未审查附件可读性` : '未载入'
  const entries: Record<string, { id: string; label: string; properties: [string, string][] }[]> = {
    零件: [], 工程图: [],
    尺寸链: project ? [{ id: 'chain', label: '当前尺寸链', properties: [['组成环', String(project.dimensionChain.terms.length)], ['计算预览', calculation]] }, ...project.dimensionChain.terms.map(term => ({ id: `term:${term.id}`, label: `${term.symbol} · ${term.name}`, properties: [['基本尺寸', `${formatMm(term.nominalQ)} mm`], ['下偏差', `${formatMm(term.lowerDeviationQ)} mm`], ['上偏差', `${formatMm(term.upperDeviationQ)} mm`], ['方向', term.sign === 1 ? '增环' : '减环'], ['来源备注', term.sourceNote || '无']] as [string, string][] }))] : [],
    来源资料: snapshot?.documents.map(doc => { const rev = snapshot.revisions.find(rev => rev.id === doc.latestRevisionId); return { id: `source:${doc.id}`, label: doc.title, properties: [['当前版本', doc.latestRevisionId], ['文件名', rev?.fileName ?? '缺失版本'], ['页数', String(rev?.pageCount ?? '未知')], ['附件状态', snapshot.missingAttachments.some(item => item.documentId === doc.id) ? '声明缺失' : '有元数据，未读取附件']] } }) ?? [],
    版本历史: snapshot?.fileRevisions.map(rev => ({ id: `rev:${rev.revisionId}`, label: `Rev ${rev.revisionId}`, properties: [['创建时间', rev.createdAt], ['原因', rev.reason], ['父版本', rev.parentId ?? '无']] })) ?? [],
  }
  const selected = Object.values(entries).flat().find(item => item.id === selection)
  const saveState = session.state?.lastError && ['PERMISSION_DENIED', 'NO_SPACE', 'WRITE_FAILED', 'VERIFY_FAILED', 'RENAME_FAILED', 'EXTERNAL_MODIFIED', 'SAVE_FAILED'].includes(session.state.lastError.code) ? '保存失败，编辑内容仍可继续处理' : !session.state?.path ? '未保存草稿' : session.state.saveStateKnown === false ? '已恢复会话 · 正式保存状态未知' : session.state.dirty ? '有未保存修改' : '已保存'
  const dialogs = <SessionDialogs session={session} />
  if (!project) return <main className="desktop-workspace" aria-label="寸链启动页">
    <header className="desktop-workspace__titlebar"><h1>寸链</h1><span className="desktop-workspace__batch">V3 · A 批次</span></header>
    <section className="desktop-workspace__start">
      <h2>打开项目，继续设计</h2><p>轴系轴向公差链分析</p>
      <div className="desktop-workspace__start-actions">
        <button disabled={session.busy} onClick={() => session.action('new')}>新建项目…</button>
        <button disabled={session.busy} aria-keyshortcuts="Meta+O" onClick={() => session.action('open')}>打开项目…</button>
        <button disabled={session.busy} onClick={() => void session.create('尺寸链示例（A）', 'chain-demo')}>打开内置示例 · 尺寸链示例（A）</button>
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
      <span className="desktop-workspace__batch">V3 · A 批次</span>
    </header>
    <div className="desktop-workspace__toolbar" role="toolbar" aria-label="项目操作">
      <button disabled={session.busy} onClick={() => session.action('new')}>新建项目</button>
      <button disabled={session.busy} aria-keyshortcuts="Meta+O" onClick={() => session.action('open')}>打开项目</button>
      <button disabled={session.busy} aria-keyshortcuts="Meta+S" onClick={() => session.action('save')}>保存</button>
      <button disabled={session.busy} aria-keyshortcuts="Meta+Shift+S" onClick={() => session.action('saveAs')}>另存为…</button>
      <button disabled={session.busy} onClick={() => session.action('importV2')}>导入 V2 备份…</button>
      <button disabled={session.busy} onClick={() => session.action('close')}>关闭窗口</button>
      <button disabled aria-describedby="desktop-import-reason">导入资料</button>
      <span id="desktop-import-reason" className="desktop-workspace__toolbar-note">资料导入本批次未实现</span>
      <div className="desktop-workspace__toolbar-end">
        <button disabled title="C 批次未实现">预览变更</button>
        <button ref={exportRef} aria-expanded={exportOpen} aria-controls="desktop-export" onClick={() => setExportOpen(!exportOpen)}>导出 PDF ▾</button>
        {exportOpen && <div id="desktop-export" className="desktop-workspace__export">
          <strong>无图纸，无法导出</strong>
          <button disabled>导出图纸 PDF · C 批次未实现</button>
          <button disabled>导出 SVG · C 批次未实现</button>
          <p>不是读取既有来源 PDF。</p>
        </div>}
      </div>
    </div>
    <div className="desktop-workspace__notice" role="status">{session.notice || (session.state?.lastError ? `${session.state.lastError.code}：${session.state.lastError.message}` : session.state?.warnings.join('；')) || '当前会话已载入；绑定来源不等于审查通过。'}{session.state?.recoveryWarning && <span>{session.state.recoveryWarning}</span>}</div>
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
          {entries[group].length ? entries[group].map(item => <button key={item.id} aria-pressed={selected?.id === item.id} onClick={() => { setSelection(item.id); if (group === '尺寸链') setTab(3); if (group === '版本历史') setTab(4) }}>{item.label}</button>) : <p>{group === '零件' ? '暂无零件 · B1/B2' : group === '工程图' ? '暂无工程图 · C 批次' : `暂无${group}`}</p>}
        </details>)}
      </aside>
      {leftOpen ? <Splitter label="项目树宽度" value={leftWidth} min={180} max={280} onChange={setLeftWidth} /> : <div />}
      <section className="desktop-workspace__center" aria-label="中央工作区">
        <div role="tablist" aria-label="工作视图" className="desktop-workspace__tabs">
          {tabs.map((name, index) => <button key={name} ref={node => { tabRefs.current[index] = node }} role="tab" id={`desktop-tab-${index}`} aria-controls={`desktop-panel-${index}`} aria-selected={tab === index} tabIndex={tab === index ? 0 : -1} onKeyDown={tabKey} onClick={() => setTab(index)}>{name}</button>)}
        </div>
        {tabs.map((name, index) => <div key={name} role="tabpanel" id={`desktop-panel-${index}`} aria-labelledby={`desktop-tab-${index}`} tabIndex={0} hidden={tab !== index} className="desktop-workspace__canvas">
          {index < 2 ? <><div className="desktop-workspace__placeholder"><span className="desktop-workspace__pending">○ 本批次未实现</span><h2>{placeholders[index][0]}</h2><p>{placeholders[index][1]}</p><p>当前选择：{selected?.label ?? '未选择对象'}</p><button disabled>{['生成 SVG 图纸', '载入 3D 模型'][index]}</button></div><div className="desktop-workspace__view-status">{name}占位 · 未载入内容 · 不代表已复核</div></> : tab === index && snapshot && (index === 2 ? <DesktopSourceView key={session.state!.sessionId} snapshot={snapshot} sessionId={session.state!.sessionId!} /> : index === 3 ? <DesktopChainView snapshot={snapshot} edit={session.edit} disabled={session.busy} /> : <DesktopHistoryView snapshot={snapshot} />)}
        </div>)}
      </section>
      {rightOpen ? <Splitter label="属性栏宽度" value={rightWidth} min={240} max={340} reverse onChange={setRightWidth} /> : <div />}
      <aside id="desktop-properties" className="desktop-workspace__properties" aria-label="属性栏" hidden={!rightOpen}>
        <h2>属性 · {selected?.label ?? '未选择'}</h2><p>选择项目树中的对象查看会话快照。</p>
        <dl><dt>项目版本</dt><dd>{project.currentRevisionId}</dd>{selected?.properties.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
        <p className="desktop-workspace__pending">○ 尚无审查结论</p>
      </aside>
    </div>
    {reviewOpen && <Splitter label="复核区高度" value={reviewHeight} min={160} max={280} horizontal reverse onChange={setReviewHeight} />}
    <section className={`desktop-workspace__review${reviewOpen ? ' desktop-workspace__review--open' : ''}`} aria-label="复核与变更">
      <button className="desktop-workspace__review-toggle" aria-expanded={reviewOpen} aria-controls="desktop-review-content" onClick={() => setReviewOpen(!reviewOpen)}>{reviewOpen ? '▾' : '▸'} 复核与变更 <span>计算 {calculation} · 来源 {sourceState} · 图纸 未生成（C 批次）</span></button>
      <div id="desktop-review-content" hidden={!reviewOpen} className="desktop-workspace__review-groups">
        <section><h3>变更</h3><p>尚无变更预览。C 批次未实现。</p></section>
        <section><h3>校核</h3><p>{calculation}</p>{result && <p>极限范围 {formatMm(result.minQ)} 至 {formatMm(result.maxQ)} mm</p>}{parsed && !parsed.ok && Object.entries(parsed.cellErrors).map(([field, message]) => <p key={field}>{field}：{message}</p>)}</section>
        <section><h3>待办</h3><p>来源 {sourceState}。尚无桌面审查结论。</p></section>
      </div>
    </section>
    {dialogs}
  </main>
}
