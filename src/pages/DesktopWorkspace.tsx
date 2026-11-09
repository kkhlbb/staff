import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { MenuAction } from '../../desktop/shared/contracts'
import './DesktopWorkspace.css'

const tabs = ['工程图', '3D', '来源 PDF', '尺寸链'] as const
const groups = ['零件', '工程图', '尺寸链', '来源资料', '版本历史'] as const
const descriptions: Record<string, string> = {
  零件: '尚未载入零件。模型与参数编辑为 B1/B2 批次未实现。',
  工程图: '尚无图纸。SVG 图纸与图纸 PDF 导出为 C 批次未实现。',
  尺寸链: '尚未载入尺寸链。本批次未实现桌面尺寸链编辑接入。',
  来源资料: '尚未载入来源资料。读取既有来源 PDF 与导出图纸 PDF 是不同操作。',
  版本历史: '尚未载入正式版本。本批次未实现版本历史浏览。',
}
const placeholders = [
  ['尚无工程图', 'C 批次未实现：SVG 图纸、参数标注与导出图纸 PDF。'],
  ['尚无 3D 模型', 'B1/B2 批次未实现：装配、爆炸视图与 STL 读取。'],
  ['尚无来源 PDF', '本批次未实现：读取既有来源 PDF。当前契约未提供 sourceRead。'],
  ['尚无尺寸链', '本批次未实现：桌面尺寸链编辑接入。计算仍由既有领域层负责。'],
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
  const [tab, setTab] = useState(0)
  const [selection, setSelection] = useState<string | null>(null)
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(() => !window.matchMedia?.('(max-width: 1100px)').matches)
  const [leftWidth, setLeftWidth] = useState(232)
  const [rightWidth, setRightWidth] = useState(312)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewHeight, setReviewHeight] = useState(200)
  const [notice, setNotice] = useState('未打开项目；当前为桌面工作台骨架，不含演示工程数据。')
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLButtonElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    const perform = (action: MenuAction) => {
      // TODO A-04: 契约尚无 openProject/saveProject/saveAs；不得猜测参数或伪造成功。
      const names: Record<MenuAction, string> = { new: '新建项目', open: '打开项目', save: '保存', saveAs: '另存为', importV2: '导入 V2 备份', close: '关闭' }
      setNotice(`${names[action]}未接通：当前工作台尚无项目会话，现有 window.cunlian 契约未提供对应项目操作。`)
    }
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey && !event.altKey && ['o', 's'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        perform(event.key.toLowerCase() === 'o' ? 'open' : event.shiftKey ? 'saveAs' : 'save')
      }
      if (event.key === 'Escape') { setExportOpen(false); exportRef.current?.focus() }
    }
    window.addEventListener('keydown', keydown)
    const api = window.cunlian
    const unsubscribe = api?.onMenuAction(({ action }) => perform(action))
    // 本骨架无编辑器或 session，屏障只回传 requestId，不声称任何编辑已保存。
    const unflush = api?.onEditorFlush(({ requestId }) => api.respondEditorFlush({ requestId }))
    return () => { window.removeEventListener('keydown', keydown); unsubscribe?.(); unflush?.() }
  }, [])

  function tabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const next = event.key === 'ArrowRight' ? (tab + 1) % tabs.length : event.key === 'ArrowLeft' ? (tab + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
    if (next !== null) { event.preventDefault(); setTab(next); tabRefs.current[next]?.focus() }
  }
  const style = { '--tree-width': `${leftOpen ? leftWidth : 0}px`, '--properties-width': `${rightOpen ? rightWidth : 0}px`, '--review-height': `${reviewHeight}px` } as CSSProperties
  return <main className="desktop-workspace" style={style} aria-label="寸链桌面工作台">
    <header className="desktop-workspace__titlebar">
      <h1>寸链 · 未打开项目</h1><span>Rev —</span><span className="desktop-workspace__pending">○ 尚无保存记录</span>
      <span className="desktop-workspace__batch">V3 · A 批次骨架</span>
    </header>
    <div className="desktop-workspace__toolbar" role="toolbar" aria-label="项目操作">
      <button aria-keyshortcuts="Meta+O" onClick={() => setNotice('打开项目未接通：window.cunlian 契约尚无 openProject。')}>打开项目</button>
      <button aria-keyshortcuts="Meta+S" onClick={() => setNotice('保存未接通：window.cunlian 契约尚无 saveProject；另存为（⇧⌘S）也未接通。')}>保存</button>
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
    <div className="desktop-workspace__notice" role="status">{notice}</div>
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
          <button aria-pressed={selection === group} onClick={() => setSelection(group)}>未载入{group}</button>
        </details>)}
      </aside>
      {leftOpen ? <Splitter label="项目树宽度" value={leftWidth} min={180} max={280} onChange={setLeftWidth} /> : <div />}
      <section className="desktop-workspace__center" aria-label="中央工作区">
        <div role="tablist" aria-label="工作视图" className="desktop-workspace__tabs">
          {tabs.map((name, index) => <button key={name} ref={node => { tabRefs.current[index] = node }} role="tab" id={`desktop-tab-${index}`} aria-controls={`desktop-panel-${index}`} aria-selected={tab === index} tabIndex={tab === index ? 0 : -1} onKeyDown={tabKey} onClick={() => setTab(index)}>{name}</button>)}
        </div>
        {tabs.map((name, index) => <div key={name} role="tabpanel" id={`desktop-panel-${index}`} aria-labelledby={`desktop-tab-${index}`} tabIndex={0} hidden={tab !== index} className="desktop-workspace__canvas">
          <div className="desktop-workspace__placeholder"><span className="desktop-workspace__pending">○ 本批次未实现</span><h2>{placeholders[index][0]}</h2><p>{placeholders[index][1]}</p><p>当前选择：{selection ?? '未选择对象'}</p><button disabled>{['生成 SVG 图纸', '载入 3D 模型', '读取既有来源 PDF', '编辑尺寸链'][index]}</button></div>
          <div className="desktop-workspace__view-status">{name}占位 · 未载入内容 · 不代表已复核</div>
        </div>)}
      </section>
      {rightOpen ? <Splitter label="属性栏宽度" value={rightWidth} min={240} max={340} reverse onChange={setRightWidth} /> : <div />}
      <aside id="desktop-properties" className="desktop-workspace__properties" aria-label="属性栏" hidden={!rightOpen}>
        <h2>属性 · {selection ?? '未选择'}</h2><p>{selection ? descriptions[selection] : '在项目树中选择一个类别，查看其载入状态。'}</p>
        <dl><dt>当前对象</dt><dd>{selection ?? '未选择对象'}</dd><dt>项目版本</dt><dd>未载入</dd><dt>来源核对</dt><dd>尚无可核对来源</dd></dl>
        <p className="desktop-workspace__pending">○ 尚无审查结论</p>
      </aside>
    </div>
    {reviewOpen && <Splitter label="复核区高度" value={reviewHeight} min={160} max={280} horizontal reverse onChange={setReviewHeight} />}
    <section className={`desktop-workspace__review${reviewOpen ? ' desktop-workspace__review--open' : ''}`} aria-label="复核与变更">
      <button className="desktop-workspace__review-toggle" aria-expanded={reviewOpen} aria-controls="desktop-review-content" onClick={() => setReviewOpen(!reviewOpen)}>{reviewOpen ? '▾' : '▸'} 复核与变更 <span>计算 未运行 · 来源 未载入 · 图纸 未生成</span></button>
      <div id="desktop-review-content" hidden={!reviewOpen} className="desktop-workspace__review-groups">
        <section><h3>变更</h3><p>尚无变更预览。C 批次未实现。</p></section>
        <section><h3>校核</h3><p>尚未运行计算，不代表满足或审查通过。</p></section>
        <section><h3>待办</h3><p>项目打开与保存接口待接通；尚无工程复核清单。</p></section>
      </div>
    </section>
  </main>
}
