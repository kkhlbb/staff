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
import type {
  AgentPreviewSummary,
  AgentProviderStatusValue,
  AgentTaskView,
  LocateEvidenceValue,
} from '../../desktop/shared/contracts'
import { formatMm } from '../domain/units'
import { SPACER_PARAMETER_LABELS } from '../drawing/types'

const parameterLabel = (key: string): string => SPACER_PARAMETER_LABELS[key as keyof typeof SPACER_PARAMETER_LABELS] ?? key

export interface AgentSidebarProps {
  open: boolean
  onToggle: () => void
  projectName: string | null
  revisionId: string | null
  onLocate: (value: LocateEvidenceValue) => void
}

const DEMOS: { scenario: 'normal' | 'ask' | 'failure'; label: string; hint: string }[] = [
  { scenario: 'normal', label: '正常改图（+0.04 mm）', hint: 'stage → preview；预览后需人工确认' },
  { scenario: 'ask', label: '需要补充（锁定参数）', hint: '工具返回 CONSTRAINT_VIOLATED，侧栏不当作完成' },
  { scenario: 'failure', label: '工具失败（非法数值）', hint: '工具返回 INVALID_INPUT，模型自述不算回执' },
]

function receiptOf(step: AgentTaskView['steps'][number]): string {
  if (step.kind === 'model') return 'model'
  const tool = typeof step.inputSummary.tool === 'string' ? step.inputSummary.tool : 'tool'
  return step.errorCode === null ? `${tool} · ok` : `${tool} · ${step.errorCode}`
}

function shortRef(value: string | null): string {
  if (value === null) return '—'
  return value.length <= 28 ? value : `${value.slice(0, 25)}…`
}

function statusLabel(view: AgentTaskView): string {
  return `${view.task.state}${view.task.errorCode === null ? '' : ` · ${view.task.errorCode}`}`
}

export function AgentSidebar({ open, onToggle, projectName, revisionId, onLocate }: AgentSidebarProps): JSX.Element {
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
      if (payload.task.state === 'ready-to-commit' || payload.task.state === 'completed' || payload.task.state === 'failed') void refreshPreview()
    })
    return off
  }, [api, open, refreshPreview])

  // 事件可能早于订阅完成；任务未结束时用 task-state 轮询兜底，只读主进程记录。
  useEffect(() => {
    if (!open || taskId === null || api?.agentTaskState === undefined) return undefined
    let stopped = false
    const poll = async (): Promise<void> => {
      const result = await api.agentTaskState!({ taskId })
      if (!stopped && result.ok) {
        setView(result.data)
        if (['ready-to-commit', 'completed', 'failed', 'awaiting-input', 'cancelled'].includes(result.data.task.state)) void refreshPreview()
      }
    }
    void poll()
    const timer = setInterval(() => { void poll() }, 500)
    return () => { stopped = true; clearInterval(timer) }
  }, [api, open, taskId, refreshPreview])

  const start = async (scenario: 'normal' | 'ask' | 'failure'): Promise<void> => {
    if (!installed || api?.agentStart === undefined) return
    setBusy(true); setNotice(null); setCommit(null); setPreview(null); setView(null); setTaskId(null)
    const result = await api.agentStart({ goal: goal.trim() === '' ? '把隔套加厚 0.10 mm 并检查间隙' : goal.trim(), demo: scenario })
    if (result.ok) {
      setTaskId(result.data.taskId)
      setNotice(`已启动离线演示 · ${result.data.modelId} · ${result.data.taskId.slice(0, 8)}`)
    } else {
      setNotice(`启动失败 · ${result.code}：${result.message}`)
    }
    setBusy(false)
  }

  const cancel = async (): Promise<void> => {
    if (taskId === null || api?.agentCancel === undefined) return
    setBusy(true)
    const result = await api.agentCancel({ taskId })
    setNotice(result.ok ? '已请求取消；已进入执行的步骤会跑到真实边界' : `取消失败 · ${result.code}：${result.message}`)
    setBusy(false)
  }

  const resume = async (): Promise<void> => {
    if (taskId === null || api?.agentResume === undefined) return
    setBusy(true)
    const result = await api.agentResume({ taskId })
    setNotice(result.ok ? '已继续任务；先读取当前正式版本' : `继续失败 · ${result.code}：${result.message}`)
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
    if (!result.ok) { setLocateNote(`定位失败 · ${result.code}：${result.message}`); return }
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
      setNotice(`启动失败 · ${result.code}：${result.message}`)
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
      setSettingsNote(`保存失败 · ${result.code}：${result.message}`)
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
        : `连接失败 · ${result.data.code}：${result.data.message}`
      : `测试请求失败 · ${result.code}：${result.message}`)
    setBusy(false)
  }

  const clearKey = async (): Promise<void> => {
    if (api?.clearAgentProviderKey === undefined) return
    setBusy(true); setSettingsNote(null); setTestNote(null)
    const result = await api.clearAgentProviderKey()
    if (result.ok) { setProvider(result.data); setSettingsNote('已从 Keychain 删除密钥') }
    else setSettingsNote(`清除失败 · ${result.code}：${result.message}`)
    setBusy(false)
  }

  const exportSaved = async (format: 'pdf' | 'svg'): Promise<void> => {
    if (api?.exportApprovedVersion === undefined) return
    setBusy(true); setExportNote(null)
    const result = await api.exportApprovedVersion({ format })
    setExportNote(result.ok
      ? `已导出 · ${result.data.fileName} · ${result.data.byteSize} B · ${result.data.sha256?.slice(0, 12)}…`
      : `导出未完成 · ${result.code}：${result.message}`)
    setBusy(false)
  }

  const toolSteps = (view?.steps ?? []).filter(step => step.kind === 'tool')
  const recent = toolSteps.slice(-3).reverse()
  const requirementBlocked = preview !== null && preview.requirement !== null && preview.requirement.status !== 'satisfied'
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
      {notice !== null && <p role="status" className="agent-sidebar__hint">{notice}</p>}
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
        <p className="agent-sidebar__state" data-testid="agent-task-state">
          {statusLabel(view)}{view.task.errorMessage === null ? '' : ` · ${view.task.errorMessage}`}
        </p>
        <ol className="agent-sidebar__steps">
          {view.steps.map(step => <li key={step.stepId} className={step.errorCode === null ? 'agent-sidebar__step' : 'agent-sidebar__step agent-sidebar__step--failed'}>
            <span>{step.kind === 'model' ? 'model' : receiptOf(step)}</span>
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
            <strong data-testid="agent-question-code">{question.code}</strong>
            <span>{question.tool} · {question.message}</span>
          </li>)}
        </ul>}
    </section>

    <section className="agent-sidebar__section" aria-label="最近工具结果">
      <h3>最近工具结果（回执）</h3>
      {recent.length === 0 ? <p className="agent-sidebar__hint">暂无工具回执。</p> : <ul className="agent-sidebar__steps">
        {recent.map(step => <li key={`recent-${step.stepId}`} className={step.errorCode === null ? 'agent-sidebar__step' : 'agent-sidebar__step agent-sidebar__step--failed'}>
          <span>{receiptOf(step)}</span><span className="agent-sidebar__muted">{shortRef(step.outputRef)}</span>
        </li>)}
      </ul>}
    </section>

    <section className="agent-sidebar__section" aria-label="预览与确认">
      <h3>预览与确认</h3>
      {preview === null ? <p className="agent-sidebar__hint">尚无主进程预览。工具 preview 成功后这里才出现“确认保存”。</p> : <>
        <dl>
          <div><dt>结果区间</dt><dd>{formatMm(preview.result.minQ)} ～ {formatMm(preview.result.maxQ)} mm</dd></div>
          <div><dt>参数</dt><dd>{preview.parameters.map(parameter => `${parameterLabel(parameter.key)} ${formatMm(parameter.valueQ)}`).join(' · ')}</dd></div>
          <div><dt>预览指纹</dt><dd className="agent-sidebar__mono">{preview.previewFingerprint.slice(0, 16)}…</dd></div>
          <div><dt>有效期至</dt><dd>{new Date(preview.expiresAt).toLocaleTimeString('zh-CN')}</dd></div>
        </dl>
        {preview.requirement !== null && <div className={`agent-sidebar__requirement${requirementBlocked ? ' agent-sidebar__requirement--blocked' : ''}`}>
          <p>活动条款检查：<strong>{preview.requirement.status}</strong> · {preview.requirement.reasonCodes.join('、')}</p>
          {preview.requirement.margins !== null && <p>裕量 下 {formatMm(preview.requirement.margins.lowerQ)} / 上 {formatMm(preview.requirement.margins.upperQ)} mm</p>}
        </div>}
        {preview.requirementProposalPending && <p className="agent-sidebar__hint">Agent 草稿含未确认的条款提案；它不参与本次提交门禁，正式判定仍以活动条款为准。</p>}
        <div className="agent-sidebar__actions">
          <button type="button" className="agent-sidebar__primary" disabled={busy || requirementBlocked} onClick={() => void confirmAndCommit()}>
            确认保存
          </button>
          {preview.requirement !== null && <button type="button" disabled={busy} onClick={() => void locate({ requirementRevisionId: preview.requirementRevisionId ?? undefined })}>定位条款来源</button>}
        </div>
        {requirementBlocked && <p role="alert" className="agent-sidebar__blocked">条款检查不是 satisfied；确认保存已禁用，提交也会被主进程拦截。</p>}
      </>}
      {commit !== null && <p role={commit.ok ? 'status' : 'alert'} data-testid="agent-commit-result" className={commit.ok ? 'agent-sidebar__ok' : 'agent-sidebar__blocked'}>
        {commit.ok ? commit.message : `提交失败 · ${commit.code}：${commit.message}`}
      </p>}
      {locateNote !== null && <p role="status" className="agent-sidebar__hint">{locateNote}</p>}
    </section>
  </aside>
}
