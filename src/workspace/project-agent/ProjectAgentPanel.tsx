import './ProjectAgentPanel.css'
import { startProjectAgentStream } from '../../../desktop/shared/project-agent'
import {
  presentProjectAgent,
  type ArtifactSlot,
  type ProjectAgentPresentation,
  type ProjectAgentViewInput,
} from './presentation'

export type ProjectAgentPanelProps = ProjectAgentViewInput & {
  className?: string
  needsSnapshot?: boolean
}

type Tone = 'pass' | 'pending' | 'danger' | 'action' | 'muted'

const CHECK_STATUS: Record<string, { label: string; tone: Tone }> = {
  pass: { label: '通过', tone: 'pass' },
  fail: { label: '未通过', tone: 'danger' },
  executionFailed: { label: '执行失败', tone: 'danger' },
  needsClarification: { label: '需澄清', tone: 'pending' },
  uncovered: { label: '未覆盖', tone: 'pending' },
}

const LAYOUT_LABEL: Record<string, string> = {
  split: '分栏视图',
  model: '仅看模型',
  drawing: '仅看图纸',
}

function isSlot(value: unknown): value is ArtifactSlot {
  return typeof value === 'object' && value !== null && 'revisionLabel' in value && 'isFallback' in value
}

function readSlots(p: ProjectAgentPresentation): Array<{ kind: 'model' | 'drawing'; slot: ArtifactSlot }> {
  const obj: object = p
  if ('slots' in obj && Array.isArray(obj.slots)) {
    const list: Array<{ kind: 'model' | 'drawing'; slot: ArtifactSlot }> = []
    for (const item of obj.slots) {
      if (isSlot(item)) {
        const kind = 'kind' in item && item.kind === 'drawing' ? 'drawing' : 'model'
        list.push({ kind, slot: item })
      }
    }
    return list.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'model' ? -1 : 1))
  }
  const out: Array<{ kind: 'model' | 'drawing'; slot: ArtifactSlot }> = []
  if ('model' in obj && isSlot(obj.model)) out.push({ kind: 'model', slot: obj.model })
  if ('drawing' in obj && isSlot(obj.drawing)) out.push({ kind: 'drawing', slot: obj.drawing })
  if (out.length === 0) {
    if ('modelSlot' in obj && isSlot(obj.modelSlot)) out.push({ kind: 'model', slot: obj.modelSlot })
    if ('drawingSlot' in obj && isSlot(obj.drawingSlot)) out.push({ kind: 'drawing', slot: obj.drawingSlot })
  }
  return out
}

function isMissingSlot(slot: ArtifactSlot): boolean {
  const obj: object = slot
  if ('present' in obj && obj.present === false) return true
  if ('available' in obj && obj.available === false) return true
  if ('missing' in obj && obj.missing === true) return true
  if ('artifact' in obj && obj.artifact === null) return true
  if ('revision' in obj && obj.revision === null) return true
  return !slot.revisionLabel || /无|缺失|未生成|暂无/.test(slot.revisionLabel)
}

function statusTone(label: string, positive: string, negative: string): Tone {
  if (label === positive) return 'pass'
  if (label === negative) return 'danger'
  return 'pending'
}

function readChecks(snapshot: ProjectAgentViewInput['snapshot']) {
  const raw = snapshot.currentManifest?.checks ?? []
  return raw.map((item, idx) => {
    const obj: object = item
    const status = 'status' in obj && typeof obj.status === 'string' ? obj.status : 'uncovered'
    const required = 'required' in obj && typeof obj.required === 'boolean' ? obj.required : true
    const name =
      ('label' in obj && typeof obj.label === 'string' && obj.label) ||
      ('name' in obj && typeof obj.name === 'string' && obj.name) ||
      ('id' in obj && typeof obj.id === 'string' && obj.id) ||
      ('checkId' in obj && typeof obj.checkId === 'string' && obj.checkId) ||
      `检查项 ${idx + 1}`
    return { name, status, required }
  })
}

export function ProjectAgentPanel({ className, needsSnapshot, ...viewInput }: ProjectAgentPanelProps) {
  const presentation = presentProjectAgent(viewInput)
  const streamNeedsSnapshot = Boolean(needsSnapshot || startProjectAgentStream(viewInput.snapshot).needsSnapshot)
  const slots = readSlots(presentation)
  const pObj: object = presentation
  const rawLayout = 'layout' in pObj && typeof pObj.layout === 'string' ? pObj.layout : undefined
  const layoutKey = rawLayout ?? (presentation.sameRevisionReady && !viewInput.narrow ? 'split' : viewInput.selectedTab ?? 'model')
  const checks = readChecks(viewInput.snapshot)
  const requiredChecks = checks.filter((c) => c.required)
  const isSim = presentation.badge === '模拟'
  const isConnected = presentation.connectionLabel === '已连接'
  const connTone = statusTone(presentation.connectionLabel, '已连接', '未连接')
  const authTone = statusTone(presentation.authorizationLabel, '已授权', '未授权')

  return (
    <section aria-label="项目代理状态" className={className ? `pa-panel ${className}` : 'pa-panel'}>
      <div className="pa-header">
        <h2 className="pa-title">项目代理状态</h2>
        {isSim && <span className="pa-pill pa-tone-pending" aria-label="模拟数据标记">模拟</span>}
      </div>
      <p className="pa-muted">
        {isSim
          ? '当前为模拟样本数据，非实时项目代理服务。'
          : isConnected
            ? '当前为只读状态观察视图。'
            : '当前未接入实时项目代理服务。'}
      </p>
      <div className="pa-row">
        <div className="pa-card" aria-label={`连接：${presentation.connectionLabel}`}>
          <span className="pa-card-label">连接</span>
          <span className={`pa-pill pa-tone-${connTone}`}>{presentation.connectionLabel}</span>
        </div>
        <div className="pa-card" aria-label={`授权：${presentation.authorizationLabel}`}>
          <span className="pa-card-label">授权</span>
          <span className={`pa-pill pa-tone-${authTone}`}>{presentation.authorizationLabel}</span>
        </div>
        <div className="pa-card" aria-label={`视图布局：${LAYOUT_LABEL[layoutKey] ?? layoutKey}`}>
          <span className="pa-card-label">推荐布局</span>
          <span className={`pa-pill ${presentation.sameRevisionReady ? 'pa-tone-pass' : 'pa-tone-action'}`}>
            {LAYOUT_LABEL[layoutKey] ?? layoutKey} · {presentation.sameRevisionReady ? '同版就绪' : '未同版就绪'}
          </span>
        </div>
      </div>
      {streamNeedsSnapshot && (
        <div className="pa-notice" role="status" tabIndex={0} aria-label="需重新获取快照">
          <strong>需重新获取快照</strong>：事件序列中断或上下文已过期，请手动刷新快照后再观察。
        </div>
      )}
      <div className={viewInput.narrow ? 'pa-grid pa-grid-narrow' : 'pa-grid'}>
        {slots.map(({ kind, slot }) => {
          const title = kind === 'model' ? '模型' : '图纸'
          const missing = !slot.isFallback && isMissingSlot(slot)
          const stateLabel = slot.isFallback ? '旧正式版' : missing ? '暂无工件' : '当前版'
          const tone: Tone = slot.isFallback ? 'pending' : missing ? 'muted' : presentation.sameRevisionReady ? 'pass' : 'action'
          return (
            <div key={kind} className="pa-card" aria-label={`${title}修订：${slot.revisionLabel || '暂无工件'}，${stateLabel}`}>
              <span className="pa-card-label">{title}</span>
              <span className="pa-mono">{slot.revisionLabel || '暂无工件'}</span>
              <span className={`pa-pill pa-tone-${tone}`}>{stateLabel}</span>
            </div>
          )
        })}
      </div>
      <div>
        <span className="pa-card-label">必要检查</span>
        {requiredChecks.length === 0 ? (
          <p className="pa-muted">无必要检查结果</p>
        ) : (
          <ul className="pa-list">
            {checks.map((c, idx) => {
              const meta = CHECK_STATUS[c.status] ?? { label: c.status, tone: 'pending' as Tone }
              return (
                <li key={`${c.name}-${idx}`} className="pa-check">
                  <span>{c.name}</span>
                  <span className={`pa-pill pa-tone-${meta.tone}`}>{meta.label}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="pa-row">
        <button type="button" className="pa-btn" disabled aria-label={presentation.formalSaveNote || '正式保存不可用'}>
          {presentation.formalSaveNote || '正式保存不可用'}
        </button>
      </div>
    </section>
  )
}
