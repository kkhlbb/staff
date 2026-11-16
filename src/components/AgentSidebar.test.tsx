// @vitest-environment jsdom
/**
 * V4.0 阶段 3 UI 状态级验收：S3-09 / S3-10 / S3-11。
 *
 * 这里只验证渲染与交互契约；真实打包应用点击与 960×640 布局由
 * desktop/tests/e2e/v40stage3.mjs 截图取证。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentPreviewSummary,
  AgentTaskView,
  CunlianApi,
} from '../../desktop/shared/contracts'
import type { AgentStepRecord, AgentTaskRecord } from '../agent/types'
import {
  AGENT_PANEL_KEY,
  readAgentPanelOpen,
  writeAgentPanelOpen,
} from './agentPanel'
import { AgentSidebar } from './AgentSidebar'
import { expectNoUiInternalIds, UI_REVISION_ID, UI_HEX_ID } from '../test/uiIdGuard'
import { createSampleSnapshot } from '../project-file/__fixtures__/sampleProjectFile'

it('提交回执只从已提交历史取真实序号，不把 acceptedSeq 当版本号', async () => {
  const snapshot = await createSampleSnapshot()
  snapshot.fileRevisions.push({ ...snapshot.fileRevisions[0], revisionId: 'rev-a77' })
  snapshot.project.currentRevisionId = 'rev-a77'
  const api = apiWith()
  api.reattachSession = vi.fn<CunlianApi['reattachSession']>(async () => ({ ok: true, value: { sessionId: 'session-test', editSeq: 91, savedSeq: 91, snapshot, path: '/guard.cunlian', fingerprint: 'hash', recovery: 'pending' } }))
  window.cunlian = api
  const onProjectChanged = vi.fn()
  const { container } = render(<AgentSidebar open onToggle={() => undefined} projectName="守卫项目" revisionId={UI_REVISION_ID} revisionSequence={1} onLocate={() => undefined} onProjectChanged={onProjectChanged} />)
  expect(screen.getByText('第 1 版')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /正常改图/ }))
  fireEvent.click(await screen.findByRole('button', { name: '确认保存' }))
  expect(await screen.findByTestId('agent-commit-result')).toHaveTextContent('已提交（工具回执） · 第 2 版')
  expect(onProjectChanged).toHaveBeenCalledOnce()
  expectNoUiInternalIds(container)
})

it('UI-ID guard: Agent 侧栏失败/提问/提交回执不泄漏身份', async () => {
  const api = apiWith()
  vi.mocked(api.agentTaskState!).mockResolvedValue({ ok: true, data: view({ task: task({ taskId: UI_HEX_ID, errorMessage: `记录 ${UI_REVISION_ID} 参数锁定` }), questions: [{ code: 'INVALID_INPUT', tool: 'stage', message: `记录 ${UI_HEX_ID} 需补充` }] }), requestId: 'r', objectVersion: UI_REVISION_ID })
  vi.mocked(api.commitApprovedDraft!).mockResolvedValue({ ok: true, data: { revisionId: UI_REVISION_ID, acceptedSeq: 3, path: '/guard.cunlian', fingerprint: UI_HEX_ID, analysisSnapshotId: UI_HEX_ID, requirementStatus: null, warnings: [] }, requestId: 'r', objectVersion: UI_REVISION_ID })
  window.cunlian = api
  const { container } = render(<AgentSidebar open onToggle={() => undefined} projectName="守卫项目" revisionId={UI_REVISION_ID} onLocate={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: /正常改图/ }))
  await screen.findByTestId('agent-question-reason')
  expectNoUiInternalIds(container)
  fireEvent.click(await screen.findByRole('button', { name: '确认保存' }))
  await screen.findByTestId('agent-commit-result')
  expectNoUiInternalIds(container)
})

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

function task(overrides: Partial<AgentTaskRecord> = {}): AgentTaskRecord {
  return {
    taskId: 'task-1',
    projectId: 'project-a',
    baseRevisionId: 'rev-a1',
    goal: '把隔套加厚 0.10 mm 并检查间隙',
    modelId: 'fake-1',
    state: 'failed',
    budget: { maxToolCalls: 20, maxConsecutiveSameFailure: 2, requestTimeoutMs: 120_000 },
    createdAt: '2026-11-11T00:00:00.000Z',
    endedAt: '2026-11-11T00:00:01.000Z',
    writes: true,
    errorCode: 'INVALID_INPUT',
    errorMessage: '必须提供且仅提供 valueMm 或 deltaMm',
    transitions: [],
    cancelOutcome: null,
    ...overrides,
  }
}

function step(overrides: Partial<AgentStepRecord> & { tool?: string } = {}): AgentStepRecord {
  const { tool, ...rest } = overrides
  return {
    stepId: `step-${Math.random().toString(16).slice(2)}`,
    taskId: 'task-1',
    kind: 'tool',
    inputSummary: tool === undefined ? {} : { tool },
    outputRef: 'tool:req-1:INVALID_INPUT',
    errorCode: 'INVALID_INPUT',
    durationMs: 3,
    idempotencyKey: 'key',
    at: '2026-11-11T00:00:00.000Z',
    ...rest,
  }
}

function view(overrides: Partial<AgentTaskView> = {}): AgentTaskView {
  return {
    task: task(),
    steps: [
      { stepId: 'step-model-1', taskId: 'task-1', kind: 'model', inputSummary: {}, outputRef: 'reply:12:abc', errorCode: null, durationMs: 1, idempotencyKey: 'm1', at: '2026-11-11T00:00:00.000Z' },
      step({ tool: 'stage' }),
    ],
    questions: [{ code: 'INVALID_INPUT', tool: 'stage', message: '必须提供且仅提供 valueMm 或 deltaMm' }],
    ...overrides,
  }
}

const preview: AgentPreviewSummary = {
  previewId: 'preview-1',
  previewFingerprint: 'f'.repeat(64),
  draftId: 'draft-1',
  draftRevision: 2,
  baseRevisionId: 'rev-a1',
  requirementRevisionId: null,
  parameters: [
    { key: 'innerDiameter', valueQ: 200000, inputDecimals: 2 },
    { key: 'outerDiameter', valueQ: 320000, inputDecimals: 2 },
    { key: 'length', valueQ: 120400, inputDecimals: 2 },
  ],
  result: { minQ: 1100, maxQ: 2100, status: 'within' },
  requirement: null,
  requirementProposalPending: false,
  expiresAt: '2026-11-11T00:10:00.000Z',
}

function apiWith(options: {
  emit?: (payload: AgentTaskView) => void
  preview?: AgentPreviewSummary | null
  commitOk?: boolean
} = {}): CunlianApi {
  const api: Partial<CunlianApi> = {
    agentStart: vi.fn(async () => ({ ok: true as const, data: { taskId: 'task-1', demo: 'normal' as const, modelId: 'fake-1' }, requestId: 'r', objectVersion: 'rev-a1' })),
    agentCancel: vi.fn(async () => ({ ok: true as const, data: { cancelled: true }, requestId: 'r', objectVersion: 'rev-a1' })),
    agentResume: vi.fn(async () => ({ ok: true as const, data: { resumed: true }, requestId: 'r', objectVersion: 'rev-a1' })),
    agentTaskState: vi.fn(async () => ({ ok: true as const, data: view(), requestId: 'r', objectVersion: 'rev-a1' })),
    agentProviderStatus: vi.fn(async () => ({ ok: true as const, data: { real: { configured: false, provider: null }, demo: { available: true as const, modelId: 'fake-1' as const, label: '离线演示（假模型，不联网）' } }, requestId: 'r', objectVersion: 'n/a' })),
    agentPreviewSummary: vi.fn(async () => ({ ok: true as const, data: options.preview === undefined ? preview : options.preview, requestId: 'r', objectVersion: 'rev-a1' })),
    issueAgentApproval: vi.fn(async () => ({ ok: true as const, data: { approvalId: 'approval-1', expiresAt: '2026-11-11T00:10:00.000Z' }, requestId: 'r', objectVersion: 'rev-a1' })),
    commitApprovedDraft: vi.fn(async () => options.commitOk === false
      ? { ok: false as const, code: 'STALE_PREVIEW' as const, message: '提交重算结果与授权预览不一致', requestId: 'r', objectVersion: 'rev-a1' }
      : { ok: true as const, data: { revisionId: 'rev-a77', acceptedSeq: 3, path: '/tmp/p.cunlian', fingerprint: 'abc', analysisSnapshotId: 'snapshot-a-1', requirementStatus: null, warnings: [] }, requestId: 'r', objectVersion: 'rev-a77' }),
    onAgentEvent: vi.fn((listener: (payload: AgentTaskView) => void) => { options.emit = listener; return () => undefined }),
  }
  return api as CunlianApi
}


const intentDraft: import('../../desktop/shared/contracts').IntentDraftView = {
  projectId: 'project-intent',
  draftId: 'intent-draft-1',
  draftRevision: 3,
  sourceKind: 'user-intent',
  actorId: '老王',
  sessionSeq: 2,
  sessionLabel: '2026-11-12 复检',
  candidates: [
    {
      candidateId: 'intent-ring-1',
      kind: 'ring',
      status: 'pending',
      editRevision: 1,
      summary: { symbol: 'H', nominal: '52.25', upperDeviation: '0.02', lowerDeviation: '-0.02' },
      statement: '总长 52.25 偏差 0.02',
      sessionSeq: 1,
      sessionLabel: '2026-11-12 复检',
    },
  ],
  pendingCount: 1,
  confirmedCount: 0,
  hasInterval: false,
  hasFormula: true,
  bindings: [],
  chainReady: true,
}

describe('ADR-001 第 3 步：无任务书侧栏', () => {
  it('S13 fixed offline sample is read-only and distinct from the real goal input', () => {
    render(<AgentSidebar open onToggle={() => undefined} projectName="项目" revisionId="rev-a1" onLocate={() => undefined} />)
    expect(screen.getByRole('textbox', { name: '固定示例原话（只读）' })).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: '运行固定示例（离线演示）' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Agent 任务输入' })).not.toHaveAttribute('readonly')
  })
  it('离线演示提示只说人话：界面不出现内部模型 id 与任务实例号', async () => {
    const api = apiWith({ preview: null })
    vi.mocked(api.agentStart!).mockResolvedValue({
      ok: true,
      data: { taskId: '7e437681-aaaa-bbbb-cccc-000000000000', demo: 'normal', modelId: 'fake-1' },
      requestId: 'r',
      objectVersion: 'rev-a1',
    })
    window.cunlian = api
    render(<AgentSidebar open onToggle={() => undefined} projectName="隔套间隙演示" revisionId="rev-a1" onLocate={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: /正常改图/ }))
    const notice = await screen.findByTestId('agent-notice')
    expect(notice.textContent).toBe('已启动离线演示（本机假模型）')
    expect(document.body.textContent).not.toContain('fake-')
    expect(document.body.textContent).not.toContain('7e437681')
  })

  it('建项要填责任人；草稿逐条确认；未算过时不给保存', async () => {
    const api = apiWith({ preview: null })
    const intentState = vi.fn(async () => ({ ok: true as const, data: intentDraft, requestId: 'r', objectVersion: 'rev-a1' }))
    const intentConfirmCandidate = vi.fn(async () => ({ ok: true as const, data: { ...intentDraft, pendingCount: 0, confirmedCount: 1 }, requestId: 'r', objectVersion: 'rev-a1' }))
    const intentCreateProject = vi.fn(async () => ({
      ok: true as const,
      data: { projectId: 'project-intent', draftId: 'intent-draft-1', actorId: '老王', sessionSeq: 1, sessionLabel: null },
      requestId: 'r',
      objectVersion: 'rev-a1',
    }))
    const intentIssueApproval = vi.fn(async () => ({ ok: false as const, code: 'NOT_CONFIRMED' as const, message: '还没有预览', requestId: 'r', objectVersion: 'rev-a1' }))
    Object.assign(api, { intentState, intentConfirmCandidate, intentCreateProject, intentIssueApproval })
    window.cunlian = api
    render(<AgentSidebar open onToggle={() => undefined} projectName="无任务书项目" revisionId="rev-a1" onLocate={() => undefined} />)

    const create = screen.getByRole('button', { name: '建立无任务书项目' })
    expect(create).toBeDisabled()
    fireEvent.change(screen.getByLabelText('责任人称呼'), { target: { value: '老王' } })
    await waitFor(() => expect(create).toBeEnabled())
    fireEvent.click(create)
    await waitFor(() => expect(intentCreateProject).toHaveBeenCalledWith({ name: 'φ20 轴隔套', actorId: '老王' }))
    await screen.findByTestId('intent-note')
    expect(screen.getByTestId('intent-note').textContent).toContain('已建立无任务书项目：责任人 老王')

    // 草稿：只显示用户给出的数值与原话；每条单独确认。
    await screen.findByTestId('intent-draft')
    expect(screen.getByTestId('intent-counts').textContent).toContain('待确认 1')
    expect(screen.getByTestId('intent-draft').textContent).toContain('组成环 H：52.25 mm')
    fireEvent.click(screen.getByRole('button', { name: '确认这条' }))
    await waitFor(() => expect(intentConfirmCandidate).toHaveBeenCalledWith({ candidateId: 'intent-ring-1', editRevision: 1 }))

    // 没算过就没有预览回执：勾选后仍拒绝保存，并说明原因。
    const commitButton = screen.getByRole('button', { name: '确认并保存为新版本' })
    expect(commitButton).toBeDisabled()
    fireEvent.click(screen.getByLabelText('这些尺寸由我提供'))
    await waitFor(() => expect(commitButton).toBeEnabled())
    fireEvent.click(commitButton)
    expect(await screen.findByTestId('intent-commit-result')).toHaveTextContent('先算一遍')
  })
})

describe('V4.0 阶段3：任务侧栏渲染契约', () => {
  it('S3-09 工具失败：写明原因与怎么办，不显示“已完成/已保存”，无预览时没有确认按钮', async () => {
    window.cunlian = apiWith({ preview: null })
    render(<AgentSidebar open onToggle={() => undefined} projectName="隔套间隙演示" revisionId="rev-a1" onLocate={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: /工具失败/ }))
    await waitFor(() => expect(screen.getByTestId('agent-task-state').textContent).toContain('没有做成 · 数值或参数不合法'))
    await waitFor(() => expect(screen.getByTestId('agent-question-reason').textContent).toBe('数值或参数不合法'))
    expect(screen.getAllByText('改参数没成功').length).toBeGreaterThan(0)
    // 失败要写清“为什么失败 + 怎么办”，而不是只给一个错误码。
    expect(screen.getByTestId('agent-task-why').textContent).toContain('必须提供且仅提供 valueMm 或 deltaMm')
    expect(screen.getByTestId('agent-task-why').textContent).toContain('怎么办')
    expect(screen.queryByText(/已完成/)).not.toBeInTheDocument()
    expect(screen.queryByText(/已保存/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认保存' })).not.toBeInTheDocument()
  })

  it('S3-11 模型声称成功但工具失败：状态与按钮以回执为准', async () => {
    let emit: ((payload: AgentTaskView) => void) | null = null
    window.cunlian = apiWith({ emit: payload => { emit?.(payload) } })
    // 捕获订阅函数后主动推送“模型文本说已保存、但工具失败”的任务。
    const api = window.cunlian
    const originalSubscribe = api.onAgentEvent!
    api.onAgentEvent = vi.fn(listener => { emit = listener; return originalSubscribe(listener) })
    render(<AgentSidebar open onToggle={() => undefined} projectName="隔套间隙演示" revisionId="rev-a1" onLocate={() => undefined} />)
    await waitFor(() => expect(emit).not.toBeNull())
    emit!(view({
      task: task({ errorCode: 'CONSTRAINT_VIOLATED', errorMessage: '不能修改锁定参数' }),
      steps: [
        { stepId: 'step-model-2', taskId: 'task-1', kind: 'model', inputSummary: {}, outputRef: 'reply:9:def', errorCode: null, durationMs: 1, idempotencyKey: 'm2', at: '2026-11-11T00:00:01.000Z' },
        step({ tool: 'stage', errorCode: 'CONSTRAINT_VIOLATED', outputRef: 'tool:req-1:CONSTRAINT_VIOLATED' }),
      ],
      questions: [{ code: 'CONSTRAINT_VIOLATED', tool: 'stage', message: '不能修改锁定参数' }],
    }))
    await waitFor(() => expect(screen.getByTestId('agent-question-reason').textContent).toBe('这个参数被锁定'))
    expect(screen.getByTestId('agent-task-state').textContent).toContain('没有做成 · 这个参数被锁定')
    expect(screen.getAllByText('改参数没成功').length).toBeGreaterThan(0)
    expect(screen.queryByText(/已保存/)).not.toBeInTheDocument()
    expect(screen.queryByText(/已完成/)).not.toBeInTheDocument()
    // 模型步骤只说“模型想好了下一步”，不渲染模型自述，也不打印内部 kind。
    expect(screen.getByText('模型想好了下一步')).toBeInTheDocument()
  })

  it('S4-02 模型回复单独展示（标注非回执），不产生确认按钮或结论位', async () => {
    let emit: ((payload: AgentTaskView) => void) | null = null
    window.cunlian = apiWith({ emit: payload => { emit?.(payload) }, preview: null })
    const api = window.cunlian
    const originalSubscribe = api.onAgentEvent!
    api.onAgentEvent = vi.fn(listener => { emit = listener; return originalSubscribe(listener) })
    render(<AgentSidebar open onToggle={() => undefined} projectName="隔套间隙演示" revisionId="rev-a1" onLocate={() => undefined} />)
    await waitFor(() => expect(emit).not.toBeNull())
    emit!(view({
      task: task({ state: 'completed', errorCode: null, errorMessage: null }),
      steps: [step({ tool: 'stage', errorCode: null, outputRef: 'tool:req-1:rev-a2' })],
      questions: [],
      assistantText: '长度已改为 12.04 mm，区间 [0.1100,0.2100] mm；文件已保存。',
    }))
    await waitFor(() => expect(screen.getByTestId('agent-model-text').textContent).toContain('12.04'))
    expect(screen.getByText(/模型回复（自然语言，不是回执）/)).toBeInTheDocument()
    // 模型文本只展示，不生成“确认保存”，也不改变已送达的工具回执。
    expect(screen.queryByRole('button', { name: '确认保存' })).not.toBeInTheDocument()
    expect(screen.getAllByText('改了一个参数并重算').length).toBeGreaterThan(0)
  })

  it('S3-09/S3-01 提交回执成功才显示“已提交”，且显示真实版本号', async () => {
    let emit: ((payload: AgentTaskView) => void) | null = null
    window.cunlian = apiWith()
    const api = window.cunlian
    const originalSubscribe = api.onAgentEvent!
    api.onAgentEvent = vi.fn(listener => { emit = listener; return originalSubscribe(listener) })
    render(<AgentSidebar open onToggle={() => undefined} projectName="隔套间隙演示" revisionId="rev-a1" onLocate={() => undefined} />)
    await waitFor(() => expect(emit).not.toBeNull())
    emit!(view({
      task: task({ state: 'ready-to-commit', errorCode: null, errorMessage: null }),
      steps: [step({ tool: 'preview', errorCode: null, outputRef: 'tool:req-2:ok' })],
      questions: [],
    }))
    const confirm = await screen.findByRole('button', { name: '确认保存' })
    fireEvent.click(confirm)
    await waitFor(() => expect(screen.getByTestId('agent-commit-result').textContent).toContain('已提交（工具回执） · 未命名版本'))
    expect(api.issueAgentApproval).toHaveBeenCalledWith({ previewId: 'preview-1' })
    expect(api.commitApprovedDraft).toHaveBeenCalledWith({ approvalId: 'approval-1', draftId: 'draft-1', previewFingerprint: preview.previewFingerprint })
  })

  it('S3-10 折叠状态：可展开/收起并写入 localStorage，重新读取保持', () => {
    window.cunlian = apiWith()
    const onToggle = vi.fn()
    const { rerender } = render(<AgentSidebar open={false} onToggle={onToggle} projectName="隔套间隙演示" revisionId="rev-a1" onLocate={() => undefined} />)
    expect(screen.queryByRole('heading', { name: 'Agent 任务' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))
    expect(onToggle).toHaveBeenCalledTimes(1)
    writeAgentPanelOpen(false)
    expect(window.localStorage.getItem(AGENT_PANEL_KEY)).toBe('0')
    expect(readAgentPanelOpen()).toBe(false)
    writeAgentPanelOpen(true)
    expect(readAgentPanelOpen()).toBe(true)
    rerender(<AgentSidebar open onToggle={onToggle} projectName="隔套间隙演示" revisionId="rev-a1" onLocate={() => undefined} />)
    expect(screen.getByRole('heading', { name: 'Agent 任务' })).toBeInTheDocument()
  })

  it('守卫：侧栏文本不出现工具名 / 内部状态 / 错误码（改回内部名必须变红）', async () => {
    let emit: ((payload: AgentTaskView) => void) | null = null
    const blockedPreview: AgentPreviewSummary = {
      ...preview,
      requirementRevisionId: 'req-rev-1',
      requirement: { status: 'unsatisfied', reasonCodes: ['BOTH_VIOLATED'], resultInterval: null, margins: null },
    }
    window.cunlian = apiWith({ emit: payload => { emit?.(payload) }, preview: blockedPreview })
    const api = window.cunlian
    const originalSubscribe = api.onAgentEvent!
    api.onAgentEvent = vi.fn(listener => { emit = listener; return originalSubscribe(listener) })
    render(<AgentSidebar open onToggle={() => undefined} projectName="隔套间隙演示" revisionId="rev-a1" onLocate={() => undefined} />)
    await waitFor(() => expect(emit).not.toBeNull())
    emit!(view({
      task: task({ state: 'failed', errorCode: 'CHUNK_FAILED', errorMessage: '切块解析失败（第 3 批）' }),
      steps: [
        { stepId: 'step-model-guard', taskId: 'task-1', kind: 'model', inputSummary: {}, outputRef: 'reply:3:abc', errorCode: null, durationMs: 1, idempotencyKey: 'm-guard', at: '2026-11-11T00:00:00.000Z' },
        step({ tool: 'context', errorCode: null, outputRef: 'tool:req-0:ok' }),
        step({ tool: 'confirmed', errorCode: null, outputRef: 'tool:req-0:ok' }),
        step({ tool: 'apply', errorCode: null, outputRef: 'tool:req-0:ok' }),
        step({ tool: 'stage', errorCode: null, outputRef: 'tool:req-1:rev-a2' }),
        step({ tool: 'preview', errorCode: null, outputRef: 'tool:req-2:ok' }),
        step({ tool: 'export', errorCode: 'CHUNK_FAILED', outputRef: 'tool:req-9:CHUNK_FAILED' }),
      ],
      questions: [{ code: 'CHUNK_FAILED', tool: 'export', message: '导出端口没有装配' }],
    }))
    await waitFor(() => expect(screen.getByTestId('agent-task-state').textContent).toContain('没有做成 · 读任务书时出错'))
    const text = document.body.textContent ?? ''
    const banned = [
      'stage', 'preview', 'apply', 'confirmed', 'context', 'export', 'model',
      'CHUNK_FAILED', 'INVALID_INPUT', 'CONSTRAINT_VIOLATED',
      'satisfied', 'unsatisfied', 'failed', 'ready-to-commit', 'awaiting-input',
      'tool:req', ' · ok',
    ]
    for (const name of banned) {
      const pattern = /[^\x20-\x7e]/.test(name) || name.includes(':')
        ? new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        : new RegExp(`(^|[^A-Za-z])${name}([^A-Za-z]|$)`, 'i')
      expect(pattern.test(text), `侧栏文本不应出现内部名：${name}`).toBe(false)
    }
    // 守卫不是空跑：人话确实出现在侧栏里。
    expect(text).toContain('已读项目')
    expect(text).toContain('已算完，等你确认')
    expect(text).toContain('不满足要求')
    expect(text).toContain('怎么办')
  })
})
