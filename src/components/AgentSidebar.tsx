/**
 * V4.0 阶段 3：任务侧栏（§9）。
 *
 * 边界：
 * - 步骤与“最近工具结果”只显示工具名 + 结果码（回执）；模型的自然语言不进入
 *   步骤列表或结论位，避免把“模型说已保存”当成已保存。
 * - 只有主进程返回的预览摘要、授权回执与提交回执才驱动按钮状态与结论文案。
 * - 折叠状态由父组件持久化到 localStorage（随窗口保留）。
 * - 面板是覆盖式抽屉：960×640 下不改变中央画布列宽。
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { agentReadSources, readingSourceLabel } from '../sources/agentReadDisplay'
import type {
  AgentDraftValue,
  AgentPreviewSummary,
  AgentProviderStatusValue,
  AgentTaskView,
  IntentDraftView,
  LocateEvidenceValue,
} from '../../desktop/shared/contracts'
import { formatMm } from '../domain/units'
import { SPACER_PARAMETER_LABELS } from '../drawing/types'
import { REQUIREMENT_STATUS_LABEL, type RequirementCheckStatus } from '../requirements/types'
import { REQUIREMENT_REASON_TEXT } from '../requirements/check'
import {
  codeRemedy,
  codeTitle,
  receiptLabel,
  receiptTime,
  stepSentence,
  taskStateLabel,
  toolLabel,
} from './agentWording'

const parameterLabel = (key: string): string => SPACER_PARAMETER_LABELS[key as keyof typeof SPACER_PARAMETER_LABELS] ?? key

/** 意图候选的人话摘要：只显示用户给出的数值与原话，不推断。 */
function intentCandidateLine(candidate: IntentDraftView['candidates'][number]): string {
  const s = candidate.summary
  if (candidate.kind === 'ring') {
    return `组成环 ${s.symbol ?? '?'}：${s.nominal ?? '?'} mm（上 ${s.upperDeviation ?? '?'} / 下 ${s.lowerDeviation ?? '?'}）`
  }
  if (candidate.kind === 'interval') {
    return `条款区间：${s.lower ?? '?'} ～ ${s.upper ?? '?'} mm（${s.endpoints ?? '端点未确认'}）`
  }
  if (candidate.kind === 'formula') {
    return `装配式：${s.operands ?? '?'}`
  }
  return `隔套参数：内 ${s.innerDiameter ?? '?'} / 外 ${s.outerDiameter ?? '?'} / 长 ${s.length ?? '?'} mm`
}

const requirementStatusLabel = (status: string): string =>
  Object.hasOwn(REQUIREMENT_STATUS_LABEL, status)
    ? REQUIREMENT_STATUS_LABEL[status as RequirementCheckStatus]
    : '状态未知'

const requirementReasonText = (codes: string[]): string =>
  codes
    .map(code => (Object.hasOwn(REQUIREMENT_REASON_TEXT, code) ? REQUIREMENT_REASON_TEXT[code as keyof typeof REQUIREMENT_REASON_TEXT] : ''))
    .filter(text => text !== '')
    .join(' ')

export interface AgentSidebarProps {
  open: boolean
  onToggle: () => void
  projectName: string | null
  revisionId: string | null
  onLocate: (value: LocateEvidenceValue) => void
  /** 提交成功后把 main 侧的新快照重新挂回工作台（可选；测试可不提供）。 */
  onProjectChanged?: () => void | Promise<void>
}

/** 无任务书演示的默认原话：每个数值都要能在句子里逐字找到（工具会核）。 */
const INTENT_GOAL = '我要给 φ20 的轴配个隔套，外径 32，长 12.05；总长 52.25 偏差 0.02；两个轴承各 20 偏差 0.01；隔套 12.05 偏差 0.01；间隙 0.15 到 0.25'

const DEMOS: { scenario: 'normal' | 'ask' | 'failure'; label: string; hint: string }[] = [
  { scenario: 'normal', label: '正常改图（+0.04 mm）', hint: '会先改长度参数、再算一遍；算完要你点头才落盘' },
  { scenario: 'ask', label: '需要补充（锁定参数）', hint: '参数被锁定，工具会说清原因；侧栏不会当作完成' },
  { scenario: 'failure', label: '工具失败（非法数值）', hint: '数值不合法会写明怎么改；模型自己说“成功”不算数' },
]


export function AgentSidebar({ open, onToggle, projectName, revisionId, onLocate, onProjectChanged }: AgentSidebarProps): JSX.Element {
  const api = window.cunlian
  const installed = api?.agentStart !== undefined && api.agentTaskState !== undefined
  const [provider, setProvider] = useState<AgentProviderStatusValue | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [settingsNote, setSettingsNote] = useState<string | null>(null)
  const [testNote, setTestNote] = useState<string | null>(null)
  const [exportNote, setExportNote] = useState<string | null>(null)
  const [goal, setGoal] = useState('把隔套加厚 0.10 mm 并检查间隙')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [view, setView] = useState<AgentTaskView | null>(null)
  const [preview, setPreview] = useState<AgentPreviewSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [locateNote, setLocateNote] = useState<string | null>(null)
  const [commit, setCommit] = useState<{ ok: boolean; code: string | null; message: string } | null>(null)
  const [intent, setIntent] = useState<IntentDraftView | null>(null)
  const [intentName, setIntentName] = useState('φ20 轴隔套')
  const [actorId, setActorId] = useState('')
  const [sessionLabel, setSessionLabel] = useState('')
  const [intentGoal, setIntentGoal] = useState(INTENT_GOAL)
  const [intentNote, setIntentNote] = useState<string | null>(null)
  const [intentDraft, setIntentDraft] = useState<AgentDraftValue | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [intentCommit, setIntentCommit] = useState<{ ok: boolean; message: string } | null>(null)
  const taskIdRef = useRef<string | null>(null)
  useEffect(() => { taskIdRef.current = taskId }, [taskId])

  useEffect(() => {
    if (!installed || api?.agentProviderStatus === undefined) return
    void api.agentProviderStatus().then(result => {
      if (!result.ok) return
      setProvider(result.data)
      setBaseUrl(current => current === '' ? result.data.real.baseUrl ?? '' : current)
      setModel(current => current === '' ? result.data.real.model ?? '' : current)
    })
  }, [api, installed])

  const refreshIntent = useCallback(async (): Promise<void> => {
    if (api?.intentState === undefined) return
    const result = await api.intentState()
    if (result.ok) setIntent(result.data)
  }, [api])

  const refreshPreview = useCallback(async () => {
    if (api?.agentPreviewSummary === undefined) return
    const result = await api.agentPreviewSummary()
    if (result.ok) setPreview(result.data)
  }, [api])

  useEffect(() => {
    if (!open || api?.onAgentEvent === undefined) return undefined
    const off = api.onAgentEvent(payload => {
      if (taskIdRef.current !== null && payload.task.taskId !== taskIdRef.current) return
      setView(payload)
      if (payload.task.state === 'ready-to-commit' || payload.task.state === 'completed' || payload.task.state === 'failed') {
        void refreshPreview()
        // 无任务书工具的写入是任务内的步骤：任务结束后重读意图草稿。
        void refreshIntent()
      }
    })
    return off
  }, [api, open, refreshPreview, refreshIntent])

  // 事件可能早于订阅完成；任务未结束时用 task-state 轮询兜底，只读主进程记录。
  useEffect(() => {
    if (!open || taskId === null || api?.agentTaskState === undefined) return undefined
    let stopped = false
    const poll = async (): Promise<void> => {
      const result = await api.agentTaskState!({ taskId })
      if (!stopped && result.ok) {
        setView(result.data)
        if (['ready-to-commit', 'completed', 'failed', 'awaiting-input', 'cancelled'].includes(result.data.task.state)) {
          void refreshPreview()
          void refreshIntent()
        }
      }
    }
    void poll()
    const timer = setInterval(() => { void poll() }, 500)
    return () => { stopped = true; clearInterval(timer) }
  }, [api, open, taskId, refreshPreview, refreshIntent])

  const start = async (scenario: 'normal' | 'ask' | 'failure'): Promise<void> => {
    if (!installed || api?.agentStart === undefined) return
    setBusy(true); setNotice(null); setCommit(null); setPreview(null); setView(null); setTaskId(null)
    const result = await api.agentStart({ goal: goal.trim() === '' ? '把隔套加厚 0.10 mm 并检查间隙' : goal.trim(), demo: scenario })
    if (result.ok) {
      setTaskId(result.data.taskId)
      // 界面只说人话：内部模型 id 与任务实例号只进日志，不进界面。
      setNotice('已启动离线演示（本机假模型）')
    } else {
      setNotice(`启动没有成功：${result.message}`)
    }
    setBusy(false)
  }

  const cancel = async (): Promise<void> => {
    if (taskId === null || api?.agentCancel === undefined) return
    setBusy(true)
    const result = await api.agentCancel({ taskId })
    setNotice(result.ok ? '已请求取消；已进入执行的步骤会跑到真实边界' : `取消没有成功：${result.message}`)
    setBusy(false)
  }

  const resume = async (): Promise<void> => {
    if (taskId === null || api?.agentResume === undefined) return
    setBusy(true)
    const result = await api.agentResume({ taskId })
    setNotice(result.ok ? '已继续任务；先读取当前正式版本' : `继续没有成功：${result.message}`)
    setBusy(false)
  }

  const confirmAndCommit = async (): Promise<void> => {
    if (preview === null || api?.issueAgentApproval === undefined || api.commitApprovedDraft === undefined) return
    setBusy(true); setCommit(null)
    const issued = await api.issueAgentApproval({ previewId: preview.previewId })
    if (!issued.ok) {
      setCommit({ ok: false, code: issued.code, message: issued.message })
      setBusy(false)
      return
    }
    const committed = await api.commitApprovedDraft({
      approvalId: issued.data.approvalId,
      draftId: preview.draftId,
      previewFingerprint: preview.previewFingerprint,
    })
    if (committed.ok) {
      setCommit({ ok: true, code: null, message: `已提交（工具回执） · 版本 ${committed.data.revisionId}` })
      setPreview(null)
    } else {
      setCommit({ ok: false, code: committed.code, message: committed.message })
    }
    setBusy(false)
  }

  const locate = async (request: { requirementRevisionId?: string; checkId?: string; parameterId?: string }): Promise<void> => {
    if (api?.locateEvidence === undefined) return
    const result = await api.locateEvidence(request)
    if (!result.ok) { setLocateNote(`定位没有成功：${result.message}`); return }
    setLocateNote(result.data.kind === 'parameter'
      ? `已定位参数 ${parameterLabel(result.data.key)} · 绑定环 ${result.data.termIds.join('、') || '无'}`
      : `已定位 ${result.data.label} · 第 ${result.data.page} 页`)
    onLocate(result.data)
  }

  const startReal = async (): Promise<void> => {
    if (!installed || api?.agentStart === undefined) return
    setBusy(true); setNotice(null); setCommit(null); setPreview(null); setView(null); setTaskId(null); setExportNote(null)
    const result = await api.agentStart({ goal: goal.trim() === '' ? '把隔套加厚 0.10 mm 并检查间隙' : goal.trim(), demo: 'normal', mode: 'real' })
    if (result.ok) {
      setTaskId(result.data.taskId)
      setNotice(`已启动真实模型 · ${result.data.modelId}`)
    } else {
      setNotice(`启动没有成功：${result.message}`)
    }
    setBusy(false)
  }

  const saveProvider = async (): Promise<void> => {
    if (api?.saveAgentProvider === undefined) return
    setBusy(true); setSettingsNote(null); setTestNote(null)
    const result = await api.saveAgentProvider({
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      ...(apiKey === '' ? {} : { apiKey }),
    })
    if (result.ok) {
      setProvider(result.data)
      setApiKey('')
      setSettingsNote(result.data.real.configured ? '已保存：配置与密钥齐备（密钥存 Keychain，不落盘）' : '已保存配置，但仍缺密钥')
    } else {
      setSettingsNote(`保存没有成功：${result.message} 检查 base_url、模型 ID 与密钥后重试。`)
    }
    setBusy(false)
  }

  const testProvider = async (): Promise<void> => {
    if (api?.testAgentProvider === undefined) return
    setBusy(true); setTestNote(null)
    const result = await api.testAgentProvider()
    setTestNote(result.ok
      ? result.data.ok
        ? `连接成功 · ${result.data.model ?? '模型'} · ${result.data.latencyMs} ms（合成文本，未发送项目资料）`
        : `连接没有成功：${result.data.message} 检查 base_url、模型 ID 与密钥后重试。`
      : `测试请求没有成功：${result.message}`)
    setBusy(false)
  }

  const clearKey = async (): Promise<void> => {
    if (api?.clearAgentProviderKey === undefined) return
    setBusy(true); setSettingsNote(null); setTestNote(null)
    const result = await api.clearAgentProviderKey()
    if (result.ok) { setProvider(result.data); setSettingsNote('已从 Keychain 删除密钥') }
    else setSettingsNote(`清除没有成功：${result.message}`)
    setBusy(false)
  }

  const exportSaved = async (format: 'pdf' | 'svg'): Promise<void> => {
    if (api?.exportApprovedVersion === undefined) return
    setBusy(true); setExportNote(null)
    const result = await api.exportApprovedVersion({ format })
    setExportNote(result.ok
      ? `已导出 · ${result.data.fileName} · ${result.data.byteSize} B · ${result.data.sha256?.slice(0, 12)}…`
      : `导出没有完成：${result.message} 已保存版本还在，可以重试；反复失败请检查目标文件夹权限。`)
    setBusy(false)
  }

  useEffect(() => {
    if (api?.intentState === undefined) return undefined
    let alive = true
    void api.intentState().then(result => {
      if (alive && result.ok) setIntent(result.data)
    })
    return () => { alive = false }
  }, [api, open])


  const createIntent = async (): Promise<void> => {
    if (api?.intentCreateProject === undefined) return
    setBusy(true); setIntentNote(null); setIntentCommit(null)
    const result = await api.intentCreateProject({
      name: intentName.trim() === '' ? '无任务书项目' : intentName.trim(),
      actorId: actorId.trim(),
      ...(sessionLabel.trim() === '' ? {} : { sessionLabel: sessionLabel.trim() }),
    })
    if (result.ok) {
      setIntentNote(`已建立无任务书项目：责任人 ${result.data.actorId} · 第 ${result.data.sessionSeq} 次输入`)
      await refreshIntent()
    } else {
      setIntentNote(`建项没有成功：${result.message}`)
    }
    setBusy(false)
  }

  const startIntentDemo = async (): Promise<void> => {
    if (!installed || api?.agentStart === undefined) return
    if (actorId.trim() === '') { setIntentNote('先在“你的称呼”里填一个名字：出处要写清是谁说的'); return }
    setBusy(true); setIntentNote(null); setIntentCommit(null); setIntentDraft(null); setAcknowledged(false)
    const result = await api.agentStart({
      goal: intentGoal.trim() === '' ? INTENT_GOAL : intentGoal.trim(),
      demo: 'intent',
      intent: { actorId: actorId.trim(), ...(sessionLabel.trim() === '' ? {} : { sessionLabel: sessionLabel.trim() }) },
    })
    if (result.ok) {
      setTaskId(result.data.taskId)
      setIntentNote('已启动离线演示（本机假模型）：它只把你说过的数字写进草稿')
      await refreshIntent()
    } else {
      setIntentNote(`启动没有成功：${result.message}`)
    }
    setBusy(false)
  }

  const confirmIntentCandidate = async (candidateId: string, editRevision: number): Promise<void> => {
    if (api?.intentConfirmCandidate === undefined) return
    setBusy(true)
    const result = await api.intentConfirmCandidate({ candidateId, editRevision })
    if (result.ok) setIntent(result.data)
    else setIntentNote(`确认没有成功：${result.message}`)
    setBusy(false)
  }

  const applyIntent = async (): Promise<void> => {
    if (api?.intentApply === undefined) return
    setBusy(true); setIntentCommit(null)
    const result = await api.intentApply()
    setIntentNote(result.ok ? '已按你确认的数值生成工程草稿（还没有保存）' : `生成草稿没有成功：${result.message}`)
    setBusy(false)
  }

  const previewIntent = async (): Promise<void> => {
    if (api?.intentPreview === undefined) return
    setBusy(true); setIntentCommit(null)
    const result = await api.intentPreview()
    if (result.ok) {
      setIntentDraft(result.data)
      setIntentNote('已算完：请在下方核对结果与条款，再勾选确认')
      await refreshPreview()
    } else {
      setIntentNote(`算一遍没有成功：${result.message}`)
    }
    setBusy(false)
  }

  const commitIntent = async (): Promise<void> => {
    if (api?.intentIssueApproval === undefined || api.commitApprovedDraft === undefined) return
    if (!acknowledged) { setIntentCommit({ ok: false, message: '先勾选“这些尺寸由我提供，无原文件可核对”' }); return }
    if (intentPreviewValue === null) { setIntentCommit({ ok: false, message: '先算一遍，拿到预览回执再保存' }); return }
    setBusy(true); setIntentCommit(null)
    const issued = await api.intentIssueApproval({
      previewId: intentPreviewValue.previewId,
      userAttestationAcknowledged: true,
    })
    if (!issued.ok) {
      setIntentCommit({ ok: false, message: issued.message })
      setBusy(false)
      return
    }
    const committed = await api.commitApprovedDraft({
      approvalId: issued.data.approvalId,
      draftId: intentPreviewValue.draftId,
      previewFingerprint: intentPreviewValue.previewFingerprint,
    })
    setIntentCommit(committed.ok
      ? { ok: true, message: `已保存为新版本（工具回执） · ${committed.data.revisionId}` }
      : { ok: false, message: committed.message })
    if (committed.ok) {
      setAcknowledged(false)
      setIntentDraft(null)
      await onProjectChanged?.()
    }
    setBusy(false)
  }

  const toolSteps = (view?.steps ?? []).filter(step => step.kind === 'tool')
  const recent = toolSteps.slice(-3).reverse()
  const intentPreviewValue = intentDraft !== null && intentDraft.previewId !== undefined &&
    intentDraft.previewFingerprint !== undefined
    ? { previewId: intentDraft.previewId, previewFingerprint: intentDraft.previewFingerprint, draftId: intentDraft.draftId }
    : (preview !== null ? { previewId: preview.previewId, previewFingerprint: preview.previewFingerprint, draftId: preview.draftId } : null)
  const requirementBlocked = preview !== null && preview.requirement !== null && preview.requirement.status !== 'satisfied'
  const previewReasonText = preview === null || preview.requirement === null ? '' : requirementReasonText(preview.requirement.reasonCodes)
  const running = view !== null && !['completed', 'failed', 'cancelled', 'ready-to-commit'].includes(view.task.state)

  if (!open) {
    return <aside className="agent-sidebar agent-sidebar--collapsed" aria-label="Agent 任务侧栏">
      <button type="button" className="agent-sidebar__rail" aria-expanded={false} aria-controls="agent-sidebar-panel" onClick={onToggle}>
        <span aria-hidden="true">▸</span> 任务
      </button>
    </aside>
  }

  return <aside className="agent-sidebar" id="agent-sidebar-panel" aria-label="Agent 任务侧栏">
    <header className="agent-sidebar__header">
      <h2>Agent 任务</h2>
      <button type="button" aria-expanded={true} aria-controls="agent-sidebar-panel" onClick={onToggle}>收起</button>
    </header>

    <section className="agent-sidebar__section" aria-label="模型与项目">
      <dl>
        <div><dt>活动项目</dt><dd>{projectName ?? '未打开'}</dd></div>
        <div><dt>正式版本</dt><dd>{revisionId ?? '—'}</dd></div>
        <div><dt>真实模型</dt><dd data-testid="agent-provider-status">
          {provider === null ? '读取中…' : provider.real.configured ? provider.real.provider : '未配置'}
        </dd></div>
        <div><dt>密钥</dt><dd>{provider === null ? '—' : provider.real.keyPresent === true ? `已存 Keychain` : '未保存'}</dd></div>
        <div><dt>离线演示</dt><dd>{provider === null ? '读取中…' : provider.demo.label}</dd></div>
      </dl>
      {!installed && <p role="alert">当前 preload 未提供 Agent 任务接口；不提供假的执行入口。</p>}
      {api?.saveAgentProvider !== undefined && (
        <details className="agent-sidebar__settings">
          <summary>模型设置（OpenAI 兼容）</summary>
          <label>base_url
            <input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} aria-label="模型 base_url" placeholder="https://api.deepseek.com/v1" />
          </label>
          <label>模型 ID
            <input value={model} onChange={event => setModel(event.target.value)} aria-label="模型 ID" placeholder="deepseek-chat" />
          </label>
          <label>密钥（只写 Keychain）
            <input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} aria-label="模型密钥" autoComplete="off" placeholder="留空表示不修改" />
          </label>
          <p className="agent-sidebar__hint">发送范围：结构化参数、条款摘录与必要选区文字；不发送整份 PDF。密钥只存 macOS Keychain，不进项目文件、日志或证据。</p>
          <div className="agent-sidebar__actions">
            <button type="button" disabled={busy} onClick={() => void saveProvider()}>保存配置</button>
            <button type="button" disabled={busy} onClick={() => void testProvider()}>测试连接</button>
            <button type="button" disabled={busy} onClick={() => void clearKey()}>清除密钥</button>
          </div>
          {settingsNote !== null && <p role="status" className="agent-sidebar__hint">{settingsNote}</p>}
          {testNote !== null && <p role="status" className="agent-sidebar__hint" data-testid="agent-provider-test">{testNote}</p>}
        </details>
      )}
    </section>

    <section className="agent-sidebar__section" aria-label="无任务书建项">
      <h3>无任务书建项（对话）</h3>
      <p className="agent-sidebar__hint">
        客户只有一句话、没有任务书时用这里。数值必须由你说出来；条款区间只认你的原话，
        模型自己填的数、引用标准等级或推算默认值都会被主进程拒绝。
      </p>
      <label>项目名
        <input value={intentName} maxLength={80} onChange={event => setIntentName(event.target.value)} aria-label="无任务书项目名" />
      </label>
      <label>你的称呼（责任人，必填）
        <input value={actorId} maxLength={40} onChange={event => setActorId(event.target.value)} aria-label="责任人称呼" placeholder="例如 老王" />
      </label>
      <label>备注（可空）
        <input value={sessionLabel} maxLength={120} onChange={event => setSessionLabel(event.target.value)} aria-label="输入会话备注" placeholder="例如 2026-11-12 复检" />
      </label>
      <label>你要的零件（原话）
        <textarea value={intentGoal} maxLength={2000} rows={3} onChange={event => setIntentGoal(event.target.value)} aria-label="无任务书原话" />
      </label>
      <div className="agent-sidebar__actions">
        <button type="button" disabled={busy || !installed || actorId.trim() === ''} onClick={() => void createIntent()}>建立无任务书项目</button>
        <button type="button" disabled={busy || !installed || actorId.trim() === ''} title="假模型只把你说过的数字写进草稿；确认与提交仍由你完成" onClick={() => void startIntentDemo()}>对话建件（离线演示）</button>
      </div>
      {intentNote !== null && <p role="status" className="agent-sidebar__hint" data-testid="intent-note">{intentNote}</p>}
      {intent !== null && (
        <div className="agent-sidebar__intent" data-testid="intent-draft">
          <p className="agent-sidebar__muted">
            {intent.candidates.some((c) => agentReadSources(c.provenance ?? []).length > 0) ? '依据：外部读数，须对照来源逐条核对' : '依据：用户输入，无外部原文件'} · {intent.actorId ?? '未填责任人'} · 第 {intent.sessionSeq} 次输入
            {intent.sessionLabel === null ? '' : ` · ${intent.sessionLabel}`}
          </p>
          <p role="status" data-testid="intent-counts">
            待确认 {intent.pendingCount} · 已确认 {intent.confirmedCount}
            {intent.chainReady ? ' · 组成环与装配式齐' : ' · 还缺组成环或装配式'}
            {intent.hasInterval ? ' · 条款区间已给' : ' · 还没有条款区间'}
          </p>
          <ul className="agent-sidebar__steps">
            {intent.candidates.map(candidate => (
              <li key={candidate.candidateId} className="agent-sidebar__step">
                <span>
                  {intentCandidateLine(candidate)}
                  {agentReadSources(candidate.provenance ?? []).map((ref, index) => <span key={index} className="agent-sidebar__hint">读数未核对（来源：{readingSourceLabel(ref)}） · 原话「{ref.statement}」</span>)}
                  <span className="agent-sidebar__muted"> · 原话「{candidate.statement ?? '—'}」（第 {candidate.sessionSeq ?? '—'} 次）</span>
                </span>
                {candidate.status === 'confirmed'
                  ? <span className="agent-sidebar__ok">已确认</span>
                  : <button type="button" disabled={busy} onClick={() => void confirmIntentCandidate(candidate.candidateId, candidate.editRevision)}>确认这条</button>}
              </li>
            ))}
          </ul>
          <div className="agent-sidebar__actions">
            <button type="button" disabled={busy || intent.pendingCount > 0} onClick={() => void applyIntent()}>生成工程草稿</button>
            <button type="button" disabled={busy} onClick={() => void previewIntent()}>算一遍（重算条款）</button>
          </div>
          {intentDraft !== null && (
            <dl>
              <div><dt>结果区间</dt><dd>{formatMm(intentDraft.computation.result.minQ)} ～ {formatMm(intentDraft.computation.result.maxQ)} mm</dd></div>
              <div><dt>条款</dt><dd>{preview?.requirement === null || preview === null ? '待检查' : `${requirementStatusLabel(preview.requirement.status)}${previewReasonText === '' ? '' : ` · ${previewReasonText}`}`}</dd></div>
            </dl>
          )}
          <label className="agent-sidebar__ack">
            <input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} aria-label="这些尺寸由我提供" />
            {intent?.candidates.some((c) => agentReadSources(c.provenance ?? []).length > 0) ? '这些外部读数由我逐条核对并负责' : '这些尺寸由我提供，无原文件可核对'}
          </label>
          <div className="agent-sidebar__actions">
            <button type="button" className="agent-sidebar__primary" disabled={busy || !acknowledged} onClick={() => void commitIntent()}>确认并保存为新版本</button>
          </div>
          {intentCommit !== null && <p role={intentCommit.ok ? 'status' : 'alert'} data-testid="intent-commit-result" className={intentCommit.ok ? 'agent-sidebar__ok' : 'agent-sidebar__blocked'}>{intentCommit.message}</p>}
        </div>
      )}
    </section>

    <section className="agent-sidebar__section" aria-label="任务输入">
      <label>任务
        <input value={goal} maxLength={500} onChange={event => setGoal(event.target.value)} aria-label="Agent 任务输入" />
      </label>
      <p className="agent-sidebar__hint">
        {provider?.real.configured === true
          ? `真实模型已配置（${provider.real.provider}）；下面第一个按钮走真实供应商，其余只运行离线假模型。`
          : '真实模型未配置：先在“模型设置”填写 base_url、模型 ID 与密钥。所有结果以工具回执为准。'}
      </p>
      <div className="agent-sidebar__actions">
        <button type="button" className="agent-sidebar__primary" disabled={busy || !installed || provider?.real.configured !== true}
          title="真实模型只发工具调用；确认与提交仍由界面完成"
          onClick={() => void startReal()}>真实模型执行</button>
        {DEMOS.map(item => <button key={item.scenario} type="button" disabled={busy || !installed} title={item.hint}
          onClick={() => void start(item.scenario)}>{item.label}</button>)}
        {running && <button type="button" disabled={busy} onClick={() => void cancel()}>取消</button>}
        {view !== null && (view.task.state === 'failed' || view.task.state === 'awaiting-input') && <button type="button" disabled={busy} onClick={() => void resume()}>继续</button>}
      </div>
      {notice !== null && <p role="status" data-testid="agent-notice" className="agent-sidebar__hint">{notice}</p>}
      {api?.exportApprovedVersion !== undefined && (
        <div className="agent-sidebar__actions">
          <button type="button" disabled={busy || revisionId === null} onClick={() => void exportSaved('svg')}>导出已保存版本 SVG</button>
          <button type="button" disabled={busy || revisionId === null} onClick={() => void exportSaved('pdf')}>导出 PDF</button>
        </div>
      )}
      {exportNote !== null && <p role="status" className="agent-sidebar__hint" data-testid="agent-export-result">{exportNote}</p>}
    </section>

    <section className="agent-sidebar__section" aria-label="执行步骤">
      <h3>执行步骤</h3>
      {view === null ? <p className="agent-sidebar__hint">尚未运行任务。</p> : <>
        <p className="agent-sidebar__state" data-testid="agent-task-state" data-state={view.task.state}>
          {taskStateLabel(view.task.state)}{view.task.errorCode === null ? '' : ` · ${codeTitle(view.task.errorCode)}`}
        </p>
        {view.task.errorCode !== null && <p role="alert" className="agent-sidebar__blocked" data-testid="agent-task-why">
          没有做成：{view.task.errorMessage ?? '工具没有给出可用的结果。'} 怎么办：{codeRemedy(view.task.errorCode)}
        </p>}
        <ol className="agent-sidebar__steps">
          {view.steps.map(step => <li key={step.stepId} className={step.errorCode === null ? 'agent-sidebar__step' : 'agent-sidebar__step agent-sidebar__step--failed'}>
            <span>{stepSentence(step)}</span>
            <span className="agent-sidebar__muted">{step.durationMs} ms</span>
          </li>)}
        </ol>
      </>}
    </section>

    <section className="agent-sidebar__section" aria-label="模型回复">
      <h3>模型回复（自然语言，不是回执）</h3>
      {view === null || (view.assistantText ?? '') === ''
        ? <p className="agent-sidebar__hint">暂无模型文本；结论只看工具回执与下方预览。</p>
        : <p className="agent-sidebar__reply" data-testid="agent-model-text" style={{ whiteSpace: 'pre-wrap' }}>{view.assistantText}</p>}
    </section>

    <section className="agent-sidebar__section" aria-label="待答问题">
      <h3>待答问题</h3>
      {view === null || view.questions.length === 0
        ? <p className="agent-sidebar__hint">暂无待答问题。</p>
        : <ul className="agent-sidebar__questions">
          {view.questions.map((question, index) => <li key={`${question.code}-${index}`} role="alert">
            <strong data-testid="agent-question-reason">{codeTitle(question.code)}</strong>
            <span>{toolLabel(question.tool)}：{question.message}</span>
            <span className="agent-sidebar__muted">怎么办：{codeRemedy(question.code)}</span>
          </li>)}
        </ul>}
    </section>

    <section className="agent-sidebar__section" aria-label="最近工具结果">
      <h3>最近工具结果（回执）</h3>
      {recent.length === 0 ? <p className="agent-sidebar__hint">暂无工具回执。</p> : <ul className="agent-sidebar__steps">
        {recent.map(step => <li key={`recent-${step.stepId}`} className={step.errorCode === null ? 'agent-sidebar__step' : 'agent-sidebar__step agent-sidebar__step--failed'}>
          <span>{receiptLabel(step)}</span><span className="agent-sidebar__muted">{receiptTime(step.at)}</span>
        </li>)}
      </ul>}
    </section>

    <section className="agent-sidebar__section" aria-label="预览与确认">
      <h3>预览与确认</h3>
      {preview === null ? <p className="agent-sidebar__hint">还没有算过。算完并复核通过后，这里才会出现“确认保存”。</p> : <>
        <dl>
          <div><dt>结果区间</dt><dd>{formatMm(preview.result.minQ)} ～ {formatMm(preview.result.maxQ)} mm</dd></div>
          <div><dt>参数</dt><dd>{preview.parameters.map(parameter => `${parameterLabel(parameter.key)} ${formatMm(parameter.valueQ)}`).join(' · ')}</dd></div>
          <div><dt>预览指纹</dt><dd className="agent-sidebar__mono">{preview.previewFingerprint.slice(0, 16)}…</dd></div>
          <div><dt>有效期至</dt><dd>{new Date(preview.expiresAt).toLocaleTimeString('zh-CN')}</dd></div>
        </dl>
        {preview.requirement !== null && <div className={`agent-sidebar__requirement${requirementBlocked ? ' agent-sidebar__requirement--blocked' : ''}`}>
          <p>活动条款检查：<strong>{requirementStatusLabel(preview.requirement.status)}</strong>
            {previewReasonText === '' ? '' : ` · ${previewReasonText}`}
          </p>
          {preview.requirement.margins !== null && <p>裕量 下 {formatMm(preview.requirement.margins.lowerQ)} / 上 {formatMm(preview.requirement.margins.upperQ)} mm</p>}
        </div>}
        {preview.requirementProposalPending && <p className="agent-sidebar__hint">Agent 草稿含未确认的条款提案；它不参与本次提交门禁，正式判定仍以活动条款为准。</p>}
        <div className="agent-sidebar__actions">
          <button type="button" className="agent-sidebar__primary" disabled={busy || requirementBlocked} onClick={() => void confirmAndCommit()}>
            确认保存
          </button>
          {preview.requirement !== null && <button type="button" disabled={busy} onClick={() => void locate({ requirementRevisionId: preview.requirementRevisionId ?? undefined })}>定位条款来源</button>}
        </div>
        {requirementBlocked && <p role="alert" className="agent-sidebar__blocked">条款检查没通过（原因见上）；确认保存已禁用，提交也会被主进程拦截。</p>}
      </>}
      {commit !== null && <p role={commit.ok ? 'status' : 'alert'} data-testid="agent-commit-result" className={commit.ok ? 'agent-sidebar__ok' : 'agent-sidebar__blocked'}>
        {commit.ok ? commit.message : `保存没有完成：${commit.message} 怎么办：${codeRemedy(commit.code)}`}
      </p>}
      {locateNote !== null && <p role="status" className="agent-sidebar__hint">{locateNote}</p>}
    </section>
  </aside>
}
