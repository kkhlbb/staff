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

describe('V4.0 阶段3：任务侧栏渲染契约', () => {
  it('S3-09 工具失败：显示失败码，不显示“已完成/已保存”，无预览时没有确认按钮', async () => {
    window.cunlian = apiWith({ preview: null })
    render(<AgentSidebar open onToggle={() => undefined} projectName="隔套间隙演示" revisionId="rev-a1" onLocate={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: /工具失败/ }))
    await waitFor(() => expect(screen.getByTestId('agent-task-state').textContent).toContain('failed · INVALID_INPUT'))
    await waitFor(() => expect(screen.getByTestId('agent-question-code').textContent).toBe('INVALID_INPUT'))
    expect(screen.getAllByText(/stage · INVALID_INPUT/).length).toBeGreaterThan(0)
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
    await waitFor(() => expect(screen.getByTestId('agent-question-code').textContent).toBe('CONSTRAINT_VIOLATED'))
    expect(screen.getByTestId('agent-task-state').textContent).toContain('failed · CONSTRAINT_VIOLATED')
    expect(screen.getAllByText(/stage · CONSTRAINT_VIOLATED/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/已保存/)).not.toBeInTheDocument()
    expect(screen.queryByText(/已完成/)).not.toBeInTheDocument()
    // 模型步骤只显示代号，不渲染模型自述。
    expect(screen.getByText('model')).toBeInTheDocument()
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
    await waitFor(() => expect(screen.getByTestId('agent-commit-result').textContent).toContain('已提交（工具回执） · 版本 rev-a77'))
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
})
