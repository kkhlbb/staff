// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProjectAgentM1Workbench } from './ProjectAgentM1Workbench'
import type {
  M1ChatSendResult,
  M1DraftTakeoverResult,
  M1ModelApiTestResult,
  M1WorkbenchBridge,
  M1WorkbenchBridgeResult,
  M1WorkbenchIncomingEvent,
} from './m1WorkbenchBridge'
import type { M2PreviewEvent, M2WorkbenchBridge } from './m2WorkbenchBridge'
import type {
  M3CommitApprovedDraftResult,
  M3ExternalProjectEvent,
  M3WorkbenchBridge,
} from './m3WorkbenchBridge'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const TEST_TASKBOOK_FIXTURES = [
  {
    refId: 'tb-plate-p1',
    documentName: '安装板任务书.pdf',
    page: 1,
    excerpt: '长方形安装板 80 × 50 × 8 mm，两只直径 10 mm 通孔中心 (20,25) 与 (60,25) mm。',
  },
  {
    refId: 'tb-plate-p2',
    documentName: '安装板任务书.pdf',
    page: 2,
    excerpt: '右孔至右端面剩余材料在全部允许变化下至少 13 mm；参考盖板间隙至少 1.5 mm。',
  },
] as const

const TEST_OBJECT_FIXTURES = [
  {
    objectId: 'obj-right-hole',
    breadcrumb: '安装板 › 右孔 › 圆柱面',
    featureRef: 'plate/right-hole/cylinder',
  },
  {
    objectId: 'obj-left-hole',
    breadcrumb: '安装板 › 左孔 › 圆柱面',
    featureRef: 'plate/left-hole/cylinder',
  },
] as const

describe('ProjectAgentM1Workbench (M1-FE-02)', () => {
  it('首次启动展示三路径（连接本地 Agent 推荐 / 使用模型 API / 跳过）并支持顶部随时重选', async () => {
    const user = userEvent.setup()
    render(<ProjectAgentM1Workbench bridge={{}} />)

    expect(screen.getByRole('button', { name: /连接本地 Agent/ })).toBeInTheDocument()
    expect(screen.getByText('推荐')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /使用模型 API/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '先跳过，直接体验工作台' })).toBeInTheDocument()

    // 点击底部轻量跳过链查看本地项目与示例并打开一个示例项目
    await user.click(screen.getByRole('button', { name: '先跳过，直接体验工作台' }))
    expect(screen.getByRole('region', { name: '本地项目与示例' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '打开项目 隔套兼容示例' }))

    // 向导收起，顶部栏更新项目名与版本
    expect(screen.queryByRole('region', { name: '首次启动与连接向导' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '隔套兼容示例' })).toBeInTheDocument()

    // 顶部连接胶囊 -> “切换连接”可随时重开向导
    await user.click(screen.getByTestId('connection-capsule-btn'))
    await user.click(screen.getByRole('button', { name: '切换连接' }))
    expect(screen.getByRole('region', { name: '首次启动与连接向导' })).toBeInTheDocument()
  })

  it('连接本地 Agent 面板支持复制安装位置配置与说明，并严格分离客户端连接状态与项目授权状态', async () => {
    const user = userEvent.setup()
    const copiedTexts: string[] = []
    const bridge: M1WorkbenchBridge = {
      getM1LocalAgentInstallInfo: async () => ({
        ok: true,
        value: {
          installPath: '/Applications/寸链 Desktop.app',
          bridgeCommand: '/Applications/寸链 Desktop.app/Contents/Resources/cunlian-mcp',
          bridgeArgs: ['--stdio'],
          mcpServerName: 'cunlian',
        },
      }),
      getM1ConnectionStatus: async () => ({
        ok: true,
        value: {
          connectionState: 'connected',
          source: 'local-agent',
          clientName: 'Claude Desktop',
          projectId: 'proj-plate-01',
          projectName: '安装板项目',
          baseRevision: 'v1',
          draftRevision: 'draft-2',
          authorizationState: 'unauthorized',
          writerEpoch: 1,
          writerOccupied: false,
          writerOwner: null,
        },
      }),
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        clipboardWriter={(text) => {
          copiedTexts.push(text)
        }}
      />,
    )

    // 读取到本机安装路径
    expect((await screen.findAllByText(/\/Applications\/寸链 Desktop\.app/)).length).toBeGreaterThan(0)

    // 复制连接说明与 MCP 配置片段
    await user.click(screen.getByText(/查看自然语言连接说明与安装路径/))
    await user.click(screen.getByRole('button', { name: '复制连接说明' }))
    expect(screen.getByText('已复制连接说明')).toBeInTheDocument()
    expect(copiedTexts[0]).toContain('连接寸链')

    await user.click(screen.getByRole('button', { name: '复制 MCP 配置' }))
    expect(screen.getByText('已复制 MCP 配置')).toBeInTheDocument()
    expect(copiedTexts[1]).toContain('mcpServers')
    expect(copiedTexts[1]).toContain('/Applications/寸链 Desktop.app/Contents/Resources/cunlian-mcp')

    // 检测连接状态后：客户端已连接 + 客户端名，但项目授权仍独立显示“未授权”
    await user.click(screen.getByRole('button', { name: '检测连接状态' }))
    const clientCard = screen.getByRole('region', { name: '客户端连接状态' })
    const authCard = screen.getByRole('region', { name: '项目授权状态' })

    expect(within(clientCard).getByText('已连接（Claude Desktop）')).toBeInTheDocument()
    expect(within(clientCard).getByText('Claude Desktop')).toBeInTheDocument()
    expect(within(authCard).getByText('未授权')).toBeInTheDocument()
  })

  it('窄接口缺失时明确展示“后端尚未接线/不可用”，且不伪造成功或解锁对话', async () => {
    const user = userEvent.setup()
    render(<ProjectAgentM1Workbench bridge={{}} />)

    // 本地 Agent 面板提示后端尚未接线/不可用
    expect(screen.getByText(/后端尚未接线\/不可用/)).toBeInTheDocument()

    // 切换到模型 API 面板测试连接，同样明确提示后端尚未接线/不可用，且内置对话仍锁定
    await user.click(screen.getByRole('button', { name: /使用模型 API/ }))
    expect(screen.getByText(/缺失方法：/)).toBeInTheDocument()

    await user.type(screen.getByLabelText('密钥'), 'sk-test-123')
    await user.click(screen.getByRole('button', { name: '测试连接' }))

    expect(screen.getByText(/后端尚未接线\/不可用（BACKEND_UNAVAILABLE）/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始建模' })).toBeDisabled()
  })

  it('模型 API 明确区分鉴权失败与缺少工具调用能力，展示待发送摘要，仅在真实工具往返成功后解锁内置对话', async () => {
    const user = userEvent.setup()
    const testMock = vi.fn()
    const bridge: M1WorkbenchBridge = {
      testM1ModelApiConnection: testMock,
      sendM1ChatMessage: async () => ({
        ok: true,
        value: { messageId: 'm-1', reply: 'ok' },
      }),
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        availableTaskbooks={TEST_TASKBOOK_FIXTURES}
        availableObjects={TEST_OBJECT_FIXTURES}
      />,
    )
    await user.click(screen.getByRole('button', { name: /使用模型 API/ }))

    // 展示本次需发送的文档片段与项目摘要
    const contextSummary = screen.getByRole('region', { name: '本次需发送的文档片段与项目摘要' })
    expect(within(contextSummary).getByText(/安装板项目/)).toBeInTheDocument()
    expect(within(contextSummary).getByText(/安装板任务书\.pdf · P1/)).toBeInTheDocument()

    await user.type(screen.getByLabelText('密钥'), 'sk-invalid')

    // 1. 鉴权失败
    testMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'AUTH_FAILED', message: 'API Key 无效' },
    })
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(await screen.findByText(/鉴权失败（AUTH_FAILED）/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始建模' })).toBeDisabled()

    // 2. 缺少工具调用能力
    testMock.mockResolvedValueOnce({
      ok: true,
      value: {
        availableModels: ['basic-text-v1'],
        selectedModel: 'basic-text-v1',
        toolCallSupported: false,
        toolRoundTripPassed: false,
      },
    })
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(await screen.findByText('缺少工具调用能力')).toBeInTheDocument()
    const resultRegion = screen.getByRole('region', { name: '模型 API 测试结果' })
    expect(within(resultRegion).getByText('basic-text-v1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始建模' })).toBeDisabled()

    // 3. 支持工具调用但真实往返未通过 -> 仍不得解锁
    testMock.mockResolvedValueOnce({
      ok: true,
      value: {
        availableModels: ['gpt-4.1'],
        selectedModel: 'gpt-4.1',
        toolCallSupported: true,
        toolRoundTripPassed: false,
      },
    })
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(await screen.findByText('工具往返测试未通过')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始建模' })).toBeDisabled()

    // 4. 真实工具往返通过 -> 解锁内置建模对话
    testMock.mockResolvedValueOnce({
      ok: true,
      value: {
        availableModels: ['gpt-4.1', 'gpt-4.1-mini'],
        selectedModel: 'gpt-4.1',
        toolCallSupported: true,
        toolRoundTripPassed: true,
        toolRoundTripName: 'describe_project',
        toolRoundTripLatencyMs: 142,
      },
    })
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(await screen.findByText('连接与真实工具往返通过')).toBeInTheDocument()
    expect(screen.getByText(/describe_project/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始建模' })).not.toBeDisabled()

    // 修改密钥后应重新锁定，防止沿用旧凭证状态
    await user.type(screen.getByLabelText('密钥'), 'x')
    expect(screen.getByRole('button', { name: '开始建模' })).toBeDisabled()
  })

  it('支持外置任务活动侧栏与内置对话侧栏切换及核心交互（复制选中对象引用、附加任务书/选中对象、停止与重试）', async () => {
    const user = userEvent.setup()
    const copied: string[] = []
    const cancelSpy = vi.fn(async () => ({ ok: true as const, value: { cancelled: true as const } }))
    const sendDeferred = createDeferred<M1WorkbenchBridgeResult<M1ChatSendResult>>()
    const sendSpy = vi
      .fn()
      .mockImplementationOnce(() => sendDeferred.promise)
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'NETWORK_ERROR', message: '上游超时' },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          messageId: 'msg-retry-ok',
          reply: '已将右孔向右移动 1 mm，边距范围 [13.75, 14.25] mm 通过。',
          draftRevision: 'draft-4',
          toolCalls: [
            { toolName: 'stageChange', status: 'succeeded', summary: '右孔 X +1 mm' },
          ],
        },
      })

    const bridge: M1WorkbenchBridge = {
      testM1ModelApiConnection: async () => ({
        ok: true,
        value: {
          availableModels: ['gpt-4.1'],
          selectedModel: 'gpt-4.1',
          toolCallSupported: true,
          toolRoundTripPassed: true,
          toolRoundTripName: 'describe_project',
        },
      }),
      sendM1ChatMessage: sendSpy,
      cancelM1ChatMessage: cancelSpy,
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        availableTaskbooks={TEST_TASKBOOK_FIXTURES}
        availableObjects={TEST_OBJECT_FIXTURES}
        clipboardWriter={(text) => {
          copied.push(text)
        }}
        initialActivities={[
          {
            taskId: 'task-ext-1',
            projectId: 'proj-plate-01',
            status: 'awaitingInput',
            title: '导入安装板任务书',
            lastStep: '检测到孔中心基准缺失',
            draftRevision: 'draft-2',
            question: {
              questionId: 'q-1',
              reason: 'missing',
              prompt: '请确认右孔中心距基准面。',
              sourceExcerpt: '安装板任务书.pdf P1',
            },
          },
        ]}
      />,
    )

    // 确认无手动参数表、尺寸滑块或坐标编辑器
    expect(document.querySelector('input[type="range"]')).toBeNull()

    // 外置任务活动侧栏：活动流、待回答问题、悬浮上下文条复制当前选中对象引用
    expect(screen.getByText('导入安装板任务书')).toBeInTheDocument()
    expect(screen.getByText('请确认右孔中心距基准面。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '复制到外部会话' }))
    expect(copied[0]).toBe('安装板 › 右孔 › 圆柱面 [plate/right-hole/cylinder]')
    expect(screen.getAllByText(/已复制到外部会话/).length).toBeGreaterThan(0)

    // 通过「更多 ⋯」菜单切换到内置对话：未通过测试前锁定
    await user.click(screen.getByTestId('more-menu-btn'))
    await user.click(screen.getByRole('menuitem', { name: /切换到内置模型对话/ }))
    expect(screen.getByText(/内置对话尚未解锁/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()

    // 前往配置并通过真实工具往返
    await user.click(screen.getByRole('button', { name: '前往配置模型 API' }))
    await user.type(screen.getByLabelText('密钥'), 'sk-valid')
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    await screen.findByText('连接与真实工具往返通过')
    await user.click(screen.getByRole('button', { name: '开始建模' }))

    // 通过「+ 引用」浮层附加第二份任务书引用并发送，随后点击“停止”
    await user.click(screen.getByTestId('attach-ref-btn'))
    await user.click(screen.getByRole('button', { name: /\+ 安装板任务书\.pdf · P2/ }))
    await user.click(screen.getByRole('button', { name: '关闭引用选择' }))
    await user.type(screen.getByLabelText('内置对话输入框'), '把右孔向右移 1 mm')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy.mock.calls[0][0].attachments).toEqual(['tb-plate-p1', 'tb-plate-p2'])
    expect(sendSpy.mock.calls[0][0].selectedObject).toBe('obj-right-hole')

    await user.click(screen.getByRole('button', { name: '停止' }))
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/已停止当前对话生成/)).toBeInTheDocument()

    // 停止后的迟到响应应被丢弃
    await act(async () => {
      sendDeferred.resolve({
        ok: true,
        value: { messageId: 'late-msg', reply: '迟到的旧回复不应出现' },
      })
    })
    expect(screen.queryByText('迟到的旧回复不应出现')).not.toBeInTheDocument()

    // 再次发送触发失败，展示“重试”按钮并重试成功
    await user.type(screen.getByLabelText('内置对话输入框'), '复核右孔边距')
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(await screen.findByText(/执行失败（NETWORK_ERROR）：上游超时/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(
      await screen.findByText('已将右孔向右移动 1 mm，边距范围 [13.75, 14.25] mm 通过。'),
    ).toBeInTheDocument()
  })

  it('断线时保留已有结果并展示三个操作，接管当前草稿后推进代际/scope 并丢弃先前客户端的迟到响应与事件', async () => {
    const user = userEvent.setup()
    let pushEvent: ((event: M1WorkbenchIncomingEvent) => void) | null = null
    const lateChatDeferred = createDeferred<M1WorkbenchBridgeResult<M1ChatSendResult>>()

    const bridge: M1WorkbenchBridge = {
      testM1ModelApiConnection: async () => ({
        ok: true,
        value: {
          availableModels: ['gpt-4.1'],
          selectedModel: 'gpt-4.1',
          toolCallSupported: true,
          toolRoundTripPassed: true,
          toolRoundTripName: 'describe_project',
        },
      }),
      sendM1ChatMessage: () => lateChatDeferred.promise,
      subscribeM1WorkbenchEvents: async (_req, listener) => {
        pushEvent = listener
        return { ok: true, value: { subscriptionId: 'sub-1' } }
      },
      takeoverM1Draft: async (req) => ({
        ok: true,
        value: {
          projectId: req.projectId,
          draftRevision: req.draftRevision,
          scopeEpoch: req.nextScopeEpoch,
          writerEpoch: 2,
          writerOwner: 'desktop-current',
          revokedPreviousWriter: true,
        },
      }),
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialConnectionSnapshot={{
          connectionState: 'connected',
          source: 'model-api',
          clientName: 'gpt-4.1',
          projectId: 'proj-plate-01',
          projectName: '安装板项目',
          baseRevision: 'v1',
          draftRevision: 'draft-5',
          authorizationState: 'authorized-writable',
          writerEpoch: 1,
          writerOccupied: true,
          writerOwner: 'previous-client',
        }}
        initialActivities={[
          {
            taskId: 'task-existing',
            projectId: 'proj-plate-01',
            status: 'succeeded',
            title: '已有安装板草稿结果',
            draftRevision: 'draft-5',
          },
        ]}
      />,
    )

    // 模拟先前客户端通过推送事件断线
    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        scopeEpoch: 1,
        writerEpoch: 1,
        sequence: 1,
        type: 'connection_changed',
        connectionState: 'disconnected',
        clientName: 'previous-client',
      })
    })

    // 显示“连接已断开”与项目版本、保留已有结果、提供三个明确操作
    const banner = screen.getByRole('alert', { name: '断线与接管状态' })
    expect(within(banner).getByText('连接已断开')).toBeInTheDocument()
    expect(within(banner).getByText('draft-5')).toBeInTheDocument()
    expect(within(banner).getByRole('button', { name: '重连' })).toBeInTheDocument()
    expect(within(banner).getByRole('button', { name: '切换连接' })).toBeInTheDocument()
    expect(within(banner).getByRole('button', { name: '接管当前草稿' })).toBeInTheDocument()
    expect(screen.getByText('已有安装板草稿结果')).toBeInTheDocument()

    // 点击“接管当前草稿”推进代际/scope 与 writerEpoch
    await user.click(within(banner).getByRole('button', { name: '接管当前草稿' }))
    expect(
      await screen.findByText(/已接管当前草稿（代际 #2 · 写入代际 #2）/),
    ).toBeInTheDocument()

    // 先前客户端（scopeEpoch=1, writerEpoch=1）的迟到事件试图覆盖草稿版本与活动 -> 必须被丢弃
    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        scopeEpoch: 1,
        writerEpoch: 1,
        sequence: 2,
        type: 'draft_updated',
        draftRevision: 'draft-stale-999',
      })
      pushEvent?.({
        projectId: 'proj-plate-01',
        scopeEpoch: 1,
        writerEpoch: 1,
        sequence: 3,
        type: 'activity_updated',
        activity: {
          taskId: 'task-stale',
          projectId: 'proj-plate-01',
          status: 'failed',
          title: '旧客户端迟到覆盖活动',
        },
      })
    })

    expect(screen.queryByText(/draft-stale-999/)).not.toBeInTheDocument()
    expect(screen.queryByText('旧客户端迟到覆盖活动')).not.toBeInTheDocument()
    expect(screen.getByText(/已丢弃来自旧代际\/先前客户端的迟到响应或事件/)).toBeInTheDocument()

    // 新代际（scopeEpoch=2, writerEpoch=2）事件仍可正常生效
    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        scopeEpoch: 2,
        writerEpoch: 2,
        sequence: 4,
        type: 'draft_updated',
        draftRevision: 'draft-6',
      })
    })
    expect(screen.getAllByText(/draft-6/).length).toBeGreaterThan(0)
  })

  it('F03：修改服务地址/模型名/密钥后立即撤销在途测试代际，旧测试成功迟到应答不得解锁当前表单，断线重连不得绕过门禁', async () => {
    const user = userEvent.setup()
    const testDeferred = createDeferred<M1WorkbenchBridgeResult<M1ModelApiTestResult>>()
    const reconnectMock = vi.fn(async () => ({
      ok: true as const,
      value: {
        connectionState: 'connected' as const,
        source: 'model-api' as const,
        clientName: 'gpt-4.1',
        projectId: 'proj-plate-01',
        projectName: '安装板项目',
        baseRevision: 'v1',
        draftRevision: 'draft-2',
        authorizationState: 'authorized-writable' as const,
        writerEpoch: 1,
        writerOccupied: true,
        writerOwner: 'desktop',
      },
    }))

    const bridge: M1WorkbenchBridge = {
      testM1ModelApiConnection: () => testDeferred.promise,
      reconnectM1Session: reconnectMock,
      sendM1ChatMessage: async () => ({ ok: true, value: { messageId: 'm1', reply: 'ok' } }),
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={true}
        initialConnectionSnapshot={{
          connectionState: 'disconnected',
          source: 'model-api',
          projectId: 'proj-plate-01',
          draftRevision: 'draft-2',
        }}
      />,
    )

    // 1. 断线重连后（尚未通过当前表单的工具往返测试）-> 内置对话依然保持锁定，不得绕过门禁
    const disconnectBanner = screen.getByRole('alert', { name: '断线与接管状态' })
    await user.click(within(disconnectBanner).getByRole('button', { name: '重连' }))
    expect(reconnectMock).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: /使用模型 API/ }))
    expect(screen.getByRole('button', { name: '开始建模' })).toBeDisabled()

    // 2. 发起测试连接（在途未返回），立即修改密钥 -> 递增测试代际并撤销原 requestId
    await user.type(screen.getByLabelText('密钥'), 'sk-old-key')
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(screen.getByRole('button', { name: /正在测试连接与工具往返/ })).toBeDisabled()

    await user.type(screen.getByLabelText('密钥'), '-edited')

    // 3. 旧请求的迟到成功应答到达 -> 必须被丢弃，不得解锁已修改的表单
    await act(async () => {
      testDeferred.resolve({
        ok: true,
        value: {
          availableModels: ['gpt-4.1'],
          selectedModel: 'gpt-4.1',
          toolCallSupported: true,
          toolRoundTripPassed: true,
          toolRoundTripName: 'describe_project',
        },
      })
    })
    expect(screen.getByRole('button', { name: '开始建模' })).toBeDisabled()
    expect(screen.queryByText('连接与真实工具往返通过')).not.toBeInTheDocument()
    expect(screen.getByText(/已丢弃来自旧代际\/先前客户端的迟到响应或事件/)).toBeInTheDocument()
  })

  it('F04：接管草稿后，缺失或旧代际的 M2 预览事件与 M3 同项目外部事件必须 fail-closed 拒绝，不得覆盖画布与状态', async () => {
    const user = userEvent.setup()
    let pushM2Event: ((event: M2PreviewEvent) => void) | null = null
    let pushM3Event: ((event: M3ExternalProjectEvent) => void) | null = null

    const bridge: M1WorkbenchBridge & M2WorkbenchBridge & M3WorkbenchBridge = {
      takeoverM1Draft: async (req) => ({
        ok: true,
        value: {
          projectId: req.projectId,
          draftRevision: 'draft-5',
          scopeEpoch: req.nextScopeEpoch,
          writerEpoch: 2,
          writerOwner: 'desktop-new',
          revokedPreviousWriter: true,
        },
      }),
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushM2Event = listener
        return { ok: true, value: { subscriptionId: 'sub-m2-f04' } }
      },
      subscribeM3ExternalProjectEvents: async (listener) => {
        pushM3Event = listener
        return { ok: true, value: { subscriptionId: 'sub-m3-f04' } }
      },
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialConnectionSnapshot={{
          connectionState: 'disconnected',
          source: 'local-agent',
          projectId: 'proj-plate-01',
          projectName: '安装板项目',
          baseRevision: 'v1',
          draftRevision: 'draft-5',
          authorizationState: 'authorized-readonly',
          writerEpoch: 1,
        }}
      />,
    )

    // 接管前：无 epoch 字段的 M2 事件兼容生效
    await act(async () => {
      pushM2Event?.({
        projectId: 'proj-plate-01',
        sequence: 1,
        revision: 'draft-5',
        fingerprint: 'fp-draft-5',
        type: 'model_ready',
      })
    })
    expect(screen.getByText(/3D · 草稿 5/)).toBeInTheDocument()

    // 点击接管当前草稿 -> scopeEpoch=2, writerEpoch=2, 开启严格代际守卫
    await user.click(screen.getByRole('button', { name: '接管当前草稿' }))
    expect(await screen.findByText(/已接管当前草稿（代际 #2 · 写入代际 #2）/)).toBeInTheDocument()

    // 接管后：缺失 epoch 的 M2 事件、旧 epoch 的 M2 事件、缺失/旧 epoch 的 M3 同项目事件全部 fail-closed 拒绝
    await act(async () => {
      pushM2Event?.({
        projectId: 'proj-plate-01',
        sequence: 2,
        revision: 'draft-99',
        fingerprint: 'fp-stale-no-epoch',
        type: 'model_ready',
      })
      pushM2Event?.({
        projectId: 'proj-plate-01',
        sequence: 3,
        revision: 'draft-98',
        fingerprint: 'fp-stale-old-epoch',
        scopeEpoch: 1,
        writerEpoch: 1,
        type: 'model_ready',
      })
      pushM3Event?.({
        eventId: 'ext-stale-no-epoch',
        projectId: 'proj-plate-01',
        projectName: '安装板项目',
        sequence: 4,
        draftRevision: 'draft-97',
        summary: '旧写入方无 epoch 覆盖',
      })
      pushM3Event?.({
        eventId: 'ext-stale-old-epoch',
        projectId: 'proj-plate-01',
        projectName: '安装板项目',
        sequence: 5,
        draftRevision: 'draft-96',
        scopeEpoch: 2,
        writerEpoch: 1,
        summary: '旧写入方低 writerEpoch 覆盖',
      })
    })
    expect(screen.queryByText(/草稿 99/)).not.toBeInTheDocument()
    expect(screen.queryByText(/草稿 98/)).not.toBeInTheDocument()
    expect(screen.queryByText(/草稿 97/)).not.toBeInTheDocument()
    expect(screen.queryByText(/草稿 96/)).not.toBeInTheDocument()
    expect(screen.getByText(/3D · 草稿 5/)).toBeInTheDocument()

    // 新代际（scopeEpoch=2, writerEpoch=2）事件正常生效
    await act(async () => {
      pushM2Event?.({
        projectId: 'proj-plate-01',
        sequence: 6,
        revision: 'draft-6',
        fingerprint: 'fp-draft-6',
        scopeEpoch: 2,
        writerEpoch: 2,
        type: 'model_ready',
      })
    })
    expect(screen.getByText(/3D · 草稿 6/)).toBeInTheDocument()
  })

  it('S1：切项目与接管路径立即重置 apiTesting 并递增测试代际，旧测试迟到返回不卡死按钮也不误清后续新测试状态', async () => {
    const user = userEvent.setup()
    const firstTestDeferred = createDeferred<M1WorkbenchBridgeResult<M1ModelApiTestResult>>()
    const secondTestDeferred = createDeferred<M1WorkbenchBridgeResult<M1ModelApiTestResult>>()
    let testCallCount = 0

    const bridge: M1WorkbenchBridge = {
      testM1ModelApiConnection: () => {
        testCallCount += 1
        return testCallCount === 1 ? firstTestDeferred.promise : secondTestDeferred.promise
      },
      takeoverM1Draft: async (req) => ({
        ok: true,
        value: {
          projectId: req.projectId,
          draftRevision: 'draft-2',
          scopeEpoch: req.nextScopeEpoch,
          writerEpoch: 2,
          writerOwner: 'desktop-new',
          revokedPreviousWriter: true,
        },
      }),
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={true}
        initialConnectionSnapshot={{
          connectionState: 'disconnected',
          source: 'model-api',
          projectId: 'proj-plate-01',
          draftRevision: 'draft-2',
          authorizationState: 'authorized-readonly',
          writerEpoch: 1,
        }}
      />,
    )

    // 1. 发起第 1 次模型 API 测试（在途挂起）
    await user.click(screen.getByRole('button', { name: /使用模型 API/ }))
    await user.type(screen.getByLabelText('密钥'), 'sk-s1-key')
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(screen.getByRole('button', { name: /正在测试连接与工具往返/ })).toBeDisabled()

    // 2. 期间执行“接管当前草稿” -> 立即释放 apiTesting，按钮恢复可点击
    await user.click(screen.getByRole('button', { name: '接管当前草稿' }))
    expect(await screen.findByRole('button', { name: '测试连接' })).toBeEnabled()

    // 3. 紧接着发起第 2 次新测试（在途挂起），然后让第 1 次旧测试迟到返回 -> 不得误清第 2 次的 apiTesting
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(screen.getByRole('button', { name: /正在测试连接与工具往返/ })).toBeDisabled()

    await act(async () => {
      firstTestDeferred.resolve({
        ok: true,
        value: {
          availableModels: ['gpt-4.1'],
          selectedModel: 'gpt-4.1',
          toolCallSupported: true,
          toolRoundTripPassed: true,
        },
      })
    })
    // 第 2 次测试仍在途，按钮仍保持测试中状态
    expect(screen.getByRole('button', { name: /正在测试连接与工具往返/ })).toBeDisabled()

    // 4. 切换到其他本地项目 -> 立即重置 apiTesting，按钮不再卡死
    await user.click(screen.getByRole('button', { name: '先跳过，直接体验工作台' }))
    await user.click(screen.getByRole('button', { name: '打开项目 隔套兼容示例' }))
    await user.click(screen.getByTestId('connection-capsule-btn'))
    await user.click(screen.getByRole('button', { name: '切换连接' }))
    await user.click(screen.getByRole('button', { name: /使用模型 API/ }))
    expect(screen.getByRole('button', { name: '测试连接' })).toBeEnabled()
  })

  it('S2：切回项目保持 strictEpochGuard，跨项目图纸重试不串台且接管后聊天应答被丢弃时正确释放 pending', async () => {
    const user = userEvent.setup()
    let pushM2Event: ((event: M2PreviewEvent) => void) | null = null
    const retryDeferred = createDeferred<
      M1WorkbenchBridgeResult<{
        readonly projectId: string
        readonly revision: string
        readonly revisionOrder?: number
        readonly fingerprint: string
        readonly summary?: string
      }>
    >()
    const chatDeferred = createDeferred<M1WorkbenchBridgeResult<M1ChatSendResult>>()

    const bridge: M1WorkbenchBridge & M2WorkbenchBridge = {
      takeoverM1Draft: async (req) => ({
        ok: true,
        value: {
          projectId: req.projectId,
          draftRevision: 'draft-5',
          scopeEpoch: req.nextScopeEpoch,
          writerEpoch: 2,
          writerOwner: 'desktop-new',
          revokedPreviousWriter: true,
        },
      }),
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushM2Event = listener
        return { ok: true, value: { subscriptionId: 'sub-s2' } }
      },
      retryM2Drawing: () => retryDeferred.promise,
      testM1ModelApiConnection: async () => ({
        ok: true,
        value: {
          availableModels: ['gpt-4.1'],
          selectedModel: 'gpt-4.1',
          toolCallSupported: true,
          toolRoundTripPassed: true,
        },
      }),
      sendM1ChatMessage: () => chatDeferred.promise,
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialConnectionSnapshot={{
          connectionState: 'disconnected',
          source: 'model-api',
          projectId: 'proj-plate-01',
          projectName: '安装板项目',
          baseRevision: 'v1',
          draftRevision: 'draft-5',
          authorizationState: 'authorized-readonly',
          writerEpoch: 1,
        }}
        initialPreviewSnapshot={{
          currentRevision: 'draft-5',
          model: {
            status: 'ready',
            revision: 'draft-5',
            revisionOrder: 5,
            isDraft: true,
            fingerprint: 'fp-draft-5',
          },
          drawingFailure: {
            failedRevision: 'draft-5',
            failedRevisionOrder: 5,
            reason: '投影超时',
            retryable: true,
          },
        }}
      />,
    )

    // 1. 接管项目 A -> 开启项目 A 的 strictEpochGuard
    await user.click(screen.getByRole('button', { name: '接管当前草稿' }))
    expect(await screen.findByText(/已接管当前草稿（代际 #2 · 写入代际 #2）/)).toBeInTheDocument()

    // 2. 在项目 A 发起重试图纸（在途挂起），随后切到项目 B 再让项目 A 的重试结果迟到返回 -> 不得污染项目 B
    await user.click(screen.getByRole('button', { name: '重试图纸' }))
    await user.click(screen.getByTestId('more-menu-btn'))
    await user.click(screen.getByRole('menuitem', { name: /切换本地项目/ }))
    await user.click(screen.getByRole('button', { name: '打开项目 隔套兼容示例' }))

    await act(async () => {
      retryDeferred.resolve({
        ok: true,
        value: {
          projectId: 'proj-plate-01',
          revision: 'draft-5',
          revisionOrder: 5,
          fingerprint: 'fp-draft-5',
          summary: '项目 A 迟到重试',
        },
      })
    })
    expect(screen.queryByText(/草稿 5 图纸重试成功/)).not.toBeInTheDocument()

    // 3. 切回项目 A -> strictEpochGuard 仍持久生效，无 epoch 的 M2 事件必须继续 fail-closed 拒绝
    await user.click(screen.getByTestId('more-menu-btn'))
    await user.click(screen.getByRole('menuitem', { name: /切换本地项目/ }))
    await user.click(screen.getByRole('button', { name: '打开项目 安装板项目' }))

    await act(async () => {
      pushM2Event?.({
        projectId: 'proj-plate-01',
        sequence: 1,
        revision: 'draft-99',
        fingerprint: 'fp-99',
        type: 'model_ready',
      })
    })
    expect(screen.queryByText(/草稿 99/)).not.toBeInTheDocument()

    // 4. 解锁内置对话并发送消息，后端返回缺失 epoch 的应答（在 strictEpochGuard 下被丢弃）-> chatPending 必须正确释放不卡死
    await user.click(screen.getByTestId('connection-capsule-btn'))
    await user.click(screen.getByRole('button', { name: '切换连接' }))
    await user.click(screen.getByRole('button', { name: /使用模型 API/ }))
    await user.type(screen.getByLabelText('密钥'), 'sk-s2')
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    await user.click(await screen.findByRole('button', { name: '开始建模' }))

    await user.type(screen.getByLabelText('内置对话输入框'), '测试接管后聊天释放')
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument()

    await act(async () => {
      chatDeferred.resolve({
        ok: true,
        value: {
          messageId: 'msg-no-epoch',
          reply: '缺失代际的回复',
        },
      })
    })
    expect(screen.queryByText('缺失代际的回复')).not.toBeInTheDocument()
    // 发送按钮不再处于 pending 卡死状态（停止按钮消失，发送按钮存在）
    expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument()
  })

  it('N2：重试图纸在途期间收到同修订较新 drawing_failed 时，早先重试成功返回被严格丢弃且正确释放 loading 状态', async () => {
    const user = userEvent.setup()
    let pushM2Event: ((event: M2PreviewEvent) => void) | null = null
    const retryDeferred = createDeferred<
      M1WorkbenchBridgeResult<{
        readonly projectId: string
        readonly revision: string
        readonly revisionOrder?: number
        readonly fingerprint: string
        readonly summary?: string
      }>
    >()

    const bridge: M1WorkbenchBridge & M2WorkbenchBridge = {
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushM2Event = listener
        return { ok: true, value: { subscriptionId: 'sub-n2' } }
      },
      retryM2Drawing: () => retryDeferred.promise,
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialDraftRevision="draft-8"
        initialPreviewSnapshot={{
          currentRevision: 'draft-8',
          model: {
            status: 'ready',
            revision: 'draft-8',
            revisionOrder: 8,
            isDraft: true,
            fingerprint: 'fp-draft-8',
          },
          drawingFailure: {
            failedRevision: 'draft-8',
            failedRevisionOrder: 8,
            reason: '首次投影失败',
            retryable: true,
          },
        }}
      />,
    )

    // 发起重试图纸（在途挂起）
    await user.click(screen.getByRole('button', { name: '重试图纸' }))
    expect(screen.getByRole('button', { name: '正在重试图纸…' })).toBeDisabled()

    // 挂起期间收到同修订较新的 drawing_failed -> 递增 drawingFailureGeneration
    await act(async () => {
      pushM2Event?.({
        projectId: 'proj-plate-01',
        sequence: 2,
        revision: 'draft-8',
        type: 'drawing_failed',
        errorReason: '二次投影失败（较新）',
      })
    })
    expect(screen.getByText(/二次投影失败（较新）/)).toBeInTheDocument()

    // 早先发起的重试成功返回 -> 必须被丢弃，不得清除较新失败或覆盖图纸，且释放 loading
    await act(async () => {
      retryDeferred.resolve({
        ok: true,
        value: {
          projectId: 'proj-plate-01',
          revision: 'draft-8',
          revisionOrder: 8,
          fingerprint: 'fp-draft-8',
          summary: '早先重试成功',
        },
      })
    })
    expect(screen.getByText(/二次投影失败（较新）/)).toBeInTheDocument()
    expect(screen.queryByText(/图纸重试成功/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试图纸' })).toBeEnabled()
  })

  it('N5：两槽同版就绪且 checks=[] 时收到 task_completed + checksInProgress=true，中央画布仍展示终态等待提示且阻断正式保存', async () => {
    const user = userEvent.setup()
    let pushM2Event: ((event: M2PreviewEvent) => void) | null = null
    const bridge: M1WorkbenchBridge & M2WorkbenchBridge = {
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushM2Event = listener
        return { ok: true, value: { subscriptionId: 'sub-n5' } }
      },
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialDraftRevision="draft-5"
        initialPreviewSnapshot={{
          currentRevision: 'draft-5',
          model: {
            status: 'ready',
            revision: 'draft-5',
            revisionOrder: 5,
            isDraft: true,
            fingerprint: 'fp-draft-5',
          },
          drawing: {
            status: 'ready',
            revision: 'draft-5',
            revisionOrder: 5,
            isDraft: true,
            fingerprint: 'fp-draft-5',
          },
          checks: [],
          checksInProgress: true,
        }}
      />,
    )

    await act(async () => {
      pushM2Event?.({
        projectId: 'proj-plate-01',
        sequence: 1,
        revision: 'draft-5',
        fingerprint: 'fp-draft-5',
        type: 'task_completed',
        taskCompleted: true,
        checksInProgress: true,
        checks: [],
      })
    })

    const summaryBanner = screen.getByRole('status', { name: '自然完成摘要' })
    expect(within(summaryBanner).getByText(/任务已结束 · 检查进行中 · 尚未满足正式保存条件/)).toBeInTheDocument()

    // 打开完成视图确认正式保存按钮仍被阻断
    await user.click(within(summaryBanner).getByRole('button', { name: '前往复核与确认' }))
    expect(screen.getByRole('button', { name: '保存正式版本' })).toBeDisabled()
  })

  it('N6：接管挂起时切项目释放 takeoverPending，A→B→A 切回后旧接管迟到返回因代际校验被丢弃且不误清更新接管', async () => {
    const user = userEvent.setup()
    const firstTakeoverDeferred = createDeferred<M1WorkbenchBridgeResult<M1DraftTakeoverResult>>()
    const secondTakeoverDeferred = createDeferred<M1WorkbenchBridgeResult<M1DraftTakeoverResult>>()
    let takeoverCalls = 0

    const bridge = {
      requestM1ProjectAuthorization: async (req: {
        readonly projectId: string
        readonly requestId: string
        readonly requestGeneration: number
      }) => ({
        ok: true as const,
        value: {
          projectId: req.projectId,
          authorizationRef: `auth-${req.requestGeneration}`,
          requestGeneration: req.requestGeneration,
        },
      }),
      takeoverM1Draft: () => {
        takeoverCalls += 1
        return takeoverCalls === 1 ? firstTakeoverDeferred.promise : secondTakeoverDeferred.promise
      },
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialConnectionSnapshot={{
          connectionState: 'disconnected',
          source: 'local-agent',
          projectId: 'proj-plate-01',
          projectName: '安装板项目',
          baseRevision: 'v1',
          draftRevision: 'draft-5',
          authorizationState: 'authorized-readonly',
          writerEpoch: 1,
        }}
      />,
    )

    // 1. 在项目 A 发起接管（在途挂起）
    await user.click(screen.getByRole('button', { name: '接管当前草稿' }))
    expect(screen.getByRole('button', { name: '接管当前草稿' })).toBeDisabled()

    // 2. 切到项目 B -> takeoverPending 立即释放
    await user.click(screen.getByTestId('more-menu-btn'))
    await user.click(screen.getByRole('menuitem', { name: /切换本地项目/ }))
    await user.click(screen.getByRole('button', { name: '打开项目 隔套兼容示例' }))

    // 3. 切回项目 A -> 先完成原生只读授权，再确认按钮可用（未卡死）并发起第二次接管
    await user.click(screen.getByTestId('more-menu-btn'))
    await user.click(screen.getByRole('menuitem', { name: /切换本地项目/ }))
    await user.click(screen.getByRole('button', { name: '打开项目 安装板项目' }))
    await user.click(screen.getByRole('button', { name: '申请原生只读授权' }))
    expect(await screen.findByRole('button', { name: '接管当前草稿' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '接管当前草稿' }))
    expect(screen.getByRole('button', { name: '接管当前草稿' })).toBeDisabled()

    // 4. 第一次旧接管迟到返回 -> 必须被丢弃，且不得误清第二次接管的 pending 状态
    await act(async () => {
      firstTakeoverDeferred.resolve({
        ok: true,
        value: {
          projectId: 'proj-plate-01',
          draftRevision: 'draft-5',
          scopeEpoch: 2,
          writerEpoch: 2,
          writerOwner: 'stale-owner',
          revokedPreviousWriter: true,
        },
      })
    })
    expect(screen.queryByText(/已接管当前草稿（代际 #2/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '接管当前草稿' })).toBeDisabled()
  })

  it('N7：同项目接管成功递增 commitRequestEpoch 时同步重置 commitPending，避免原提交被丢弃后按钮持续禁用', async () => {
    const user = userEvent.setup()
    const commitDeferred = createDeferred<M1WorkbenchBridgeResult<M3CommitApprovedDraftResult>>()

    const bridge: M1WorkbenchBridge & M3WorkbenchBridge = {
      commitM3ApprovedDraft: () => commitDeferred.promise,
      takeoverM1Draft: async (req) => ({
        ok: true,
        value: {
          projectId: req.projectId,
          draftRevision: 'draft-5',
          scopeEpoch: req.nextScopeEpoch,
          writerEpoch: 2,
          writerOwner: 'desktop-takeover',
          revokedPreviousWriter: true,
        },
      }),
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialShowCompletionView={true}
        initialConnectionSnapshot={{
          connectionState: 'disconnected',
          source: 'local-agent',
          projectId: 'proj-plate-01',
          projectName: '安装板项目',
          baseRevision: 'v1',
          draftRevision: 'draft-5',
          authorizationState: 'authorized-readonly',
          writerEpoch: 1,
        }}
        initialPreviewSnapshot={{
          currentRevision: 'draft-5',
          model: {
            status: 'ready',
            revision: 'draft-5',
            revisionOrder: 5,
            isDraft: true,
            fingerprint: 'fp-draft-5',
          },
          drawing: {
            status: 'ready',
            revision: 'draft-5',
            revisionOrder: 5,
            isDraft: true,
            fingerprint: 'fp-draft-5',
          },
          requirements: [
            {
              requirementId: 'req-right-margin',
              title: '右孔边距',
              interpretation: '≥ 13 mm',
              required: true,
              status: 'confirmed',
              anchor: {
                documentRef: 'doc-1',
                documentName: '安装板任务书.pdf',
                page: 1,
                excerpt: '≥ 13 mm',
              },
              linkedFeatureIds: ['obj-right-hole'],
              linkedAnnotationIds: ['ann-right-margin'],
            },
          ],
          checks: [
            {
              checkId: 'chk-n7',
              requirementId: 'req-right-margin',
              title: '右孔边距',
              required: true,
              status: 'pass',
              summary: '通过',
              linkedFeatureIds: ['obj-right-hole'],
              linkedAnnotationIds: ['ann-right-margin'],
              revisionFingerprint: 'fp-draft-5',
            },
          ],
          checksInProgress: false,
        }}
      />,
    )

    // 进入一次性确认并点击确认提交（在途挂起）
    await user.click(screen.getByRole('button', { name: '保存正式版本' }))
    await user.click(screen.getByRole('button', { name: '确认提交正式版本' }))
    expect(screen.getByRole('button', { name: '正在提交正式版本…' })).toBeDisabled()

    // 同项目接管成功 -> 递增 commitRequestEpoch 并立即重置 commitPending
    await user.click(screen.getByRole('button', { name: '接管当前草稿' }))
    expect(await screen.findByText(/已接管当前草稿（代际 #2 · 写入代际 #2）/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认提交正式版本' })).toBeEnabled()
  })

  it('M1-BE-02D B1 & B2：testM1ModelApiConnection 发送布尔 contextPreview 并展示字符串 sentContextSummary；sendM1ChatMessage 发送不透明 ID 并渲染标准 toolCalls', async () => {
    const user = userEvent.setup()
    const testSpy = vi.fn<NonNullable<M1WorkbenchBridge['testM1ModelApiConnection']>>(async () => ({
      ok: true as const,
      value: {
        availableModels: ['gpt-4.1'],
        selectedModel: 'gpt-4.1',
        toolCallSupported: true,
        toolRoundTripPassed: true,
        toolRoundTripName: 'describe_project',
        sentContextSummary: '项目 proj-plate-01 · 草稿 draft-2 · 附带 1 份任务书摘录',
      },
    }))
    const sendSpy = vi.fn<NonNullable<M1WorkbenchBridge['sendM1ChatMessage']>>(async () => ({
      ok: true as const,
      value: {
        messageId: 'msg-be02d-1',
        reply: '已更新隔套草稿并等待补充公差说明。',
        draftRevision: 'draft-3',
        toolCalls: [
          { name: 'updateSpacerDraft', status: 'awaitingInput' as const, taskId: 'task-88' },
          { name: 'describe_project', status: 'succeeded' as const },
        ],
      },
    }))

    const bridge: M1WorkbenchBridge = {
      testM1ModelApiConnection: testSpy,
      sendM1ChatMessage: sendSpy,
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialDraftRevision="draft-2"
        availableTaskbooks={TEST_TASKBOOK_FIXTURES}
        availableObjects={TEST_OBJECT_FIXTURES}
      />,
    )
    await user.click(screen.getByRole('button', { name: /使用模型 API/ }))
    await user.type(screen.getByLabelText('密钥'), 'sk-be02d')
    await user.click(screen.getByRole('button', { name: '测试连接' }))

    expect(testSpy).toHaveBeenCalledTimes(1)
    expect(testSpy.mock.calls[0][0].contextPreview).toBe(true)
    expect(
      await screen.findByText('项目 proj-plate-01 · 草稿 draft-2 · 附带 1 份任务书摘录'),
    ).toBeInTheDocument()

    // 进入内置建模对话并发送消息
    await user.click(screen.getByRole('button', { name: '开始建模' }))
    await user.type(screen.getByLabelText('内置对话输入框'), '更新隔套长度')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy.mock.calls[0][0].attachments).toEqual(['tb-plate-p1'])
    expect(sendSpy.mock.calls[0][0].selectedObject).toBe('obj-right-hole')

    // 气泡清晰展示后端标准 toolCalls 状态与 taskId
    expect(await screen.findByText('updateSpacerDraft：待补充输入（任务 task-88）')).toBeInTheDocument()
    expect(screen.getByText('describe_project：已成功')).toBeInTheDocument()
  })

  it('M1-BE-02D B3：subscribeM1WorkbenchEvents 消费 snapshot_required 重置超前游标并续读后续事件，且重订阅携带 afterSequence', async () => {
    const user = userEvent.setup()
    let pushEvent: ((event: M1WorkbenchIncomingEvent) => void) | null = null
    const subscribeSpy = vi.fn(
      async (
        _req: { readonly projectId: string; readonly scopeEpoch: number; readonly afterSequence?: number },
        listener: (event: M1WorkbenchIncomingEvent) => void,
      ) => {
        pushEvent = listener
        return { ok: true as const, value: { subscriptionId: 'sub-b3', unsubscribe: vi.fn() } }
      },
    )

    const bridge: M1WorkbenchBridge = {
      subscribeM1WorkbenchEvents: subscribeSpy,
      takeoverM1Draft: async (req) => ({
        ok: true as const,
        value: {
          projectId: req.projectId,
          draftRevision: req.draftRevision,
          scopeEpoch: req.nextScopeEpoch,
          writerEpoch: 2,
          writerOwner: 'b3-owner',
          revokedPreviousWriter: true as const,
        },
      }),
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialDraftRevision="draft-1"
      />,
    )

    expect(subscribeSpy).toHaveBeenCalledTimes(1)
    expect(subscribeSpy.mock.calls[0][0]).toEqual({
      projectId: 'proj-plate-01',
      scopeEpoch: 1,
    })

    // 先推进本地游标到 50
    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        scopeEpoch: 1,
        writerEpoch: 1,
        sequence: 50,
        type: 'draft_updated',
        draftRevision: 'draft-2',
      })
    })
    expect(screen.getAllByText(/draft-2/).length).toBeGreaterThan(0)

    // 收到 snapshot_required 将超前游标重置为 10，并更新连接状态、草稿与活动
    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        scopeEpoch: 1,
        writerEpoch: 1,
        sequence: 10,
        type: 'snapshot_required',
        snapshot: {
          connectionState: 'connected',
          source: 'local-agent',
          clientName: 'Claude Desktop',
          projectId: 'proj-plate-01',
          projectName: '安装板项目',
          baseRevision: 'v1',
          draftRevision: 'draft-3',
          authorizationState: 'authorized-writable',
          writerEpoch: 1,
          writerOccupied: true,
          writerOwner: 'Claude Desktop',
        },
        activities: [
          {
            taskId: 'task-snap-1',
            projectId: 'proj-plate-01',
            status: 'running',
            title: '快照同步后的外部活动',
          },
        ],
      })
    })
    expect(screen.getByText('快照同步后的外部活动')).toBeInTheDocument()
    expect(screen.getAllByText(/draft-3/).length).toBeGreaterThan(0)

    // 重置后 seq=11（小于原超前游标 50，但大于重置游标 10）必须正常续读生效
    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        scopeEpoch: 1,
        writerEpoch: 1,
        sequence: 11,
        type: 'draft_updated',
        draftRevision: 'draft-4',
      })
    })
    expect(screen.getAllByText(/draft-4/).length).toBeGreaterThan(0)

    // 断线后触发接管推进 scopeEpoch=2 -> 实际触发第 2 次订阅且携带 afterSequence=11
    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        scopeEpoch: 1,
        writerEpoch: 1,
        sequence: 12,
        type: 'connection_changed',
        connectionState: 'disconnected',
      })
    })
    await user.click(screen.getByRole('button', { name: '接管当前草稿' }))
    expect(await screen.findByText(/已接管当前草稿（代际 #2 · 写入代际 #2）/)).toBeInTheDocument()
    expect(subscribeSpy).toHaveBeenCalledTimes(2)
    expect(subscribeSpy.mock.calls[1][0]).toEqual({
      projectId: 'proj-plate-01',
      scopeEpoch: 2,
      afterSequence: 12,
    })
  })

  it('M1-BE-02D B4：AUTH_REQUIRED 携带正整数 detail 同步可信 scopeEpoch 并重建订阅；无草稿时提供原生写入申请入口调用 takeoverM1Draft', async () => {
    const user = userEvent.setup()
    const subscribeSpy = vi.fn(async () => ({
      ok: true as const,
      value: { subscriptionId: 'sub-b4', unsubscribe: vi.fn() },
    }))
    const statusSpy = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: 'AUTH_REQUIRED',
        message: 'scope epoch 已过期，请使用主进程当前 epoch',
        detail: '5',
      },
    }))
    const takeoverSpy = vi.fn(async (req: {
      readonly projectId: string
      readonly draftRevision: string | null
      readonly requestId: string
      readonly previousScopeEpoch: number
      readonly nextScopeEpoch: number
      readonly targetSource: 'local-agent' | 'model-api'
    }) => ({
      ok: true as const,
      value: {
        projectId: req.projectId,
        draftRevision: req.draftRevision,
        scopeEpoch: req.nextScopeEpoch,
        writerEpoch: 2,
        writerOwner: 'local-agent-owner',
        revokedPreviousWriter: true as const,
      },
    }))

    const bridge = {
      requestM1ProjectAuthorization: async (req: {
        readonly projectId: string
        readonly requestId: string
        readonly requestGeneration: number
      }) => ({
        ok: true as const,
        value: {
          projectId: req.projectId,
          authorizationRef: `auth-b4-${req.requestGeneration}`,
          requestGeneration: req.requestGeneration,
        },
      }),
      getM1ConnectionStatus: statusSpy,
      subscribeM1WorkbenchEvents: subscribeSpy,
      takeoverM1Draft: takeoverSpy,
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={true}
        initialDraftRevision={null}
        initialConnectionSnapshot={{
          connectionState: 'connected',
          source: 'local-agent',
          clientName: 'Claude Desktop',
          projectId: 'proj-plate-01',
          projectName: '安装板项目',
          baseRevision: 'v1',
          draftRevision: null,
          authorizationState: 'unauthorized',
          writerEpoch: 1,
          writerOccupied: false,
          writerOwner: null,
        }}
      />,
    )

    // 1. 检测连接状态返回 AUTH_REQUIRED (detail: "5") -> 本地 scopeEpoch 同步更新为 5 并以 scopeEpoch=5 重建订阅
    await user.click(screen.getByRole('button', { name: '检测连接状态' }))
    expect(await screen.findByText(/AUTH_REQUIRED/)).toBeInTheDocument()
    expect(subscribeSpy).toHaveBeenCalledTimes(2)
    expect(subscribeSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 'proj-plate-01', scopeEpoch: 5 }),
      expect.any(Function),
    )

    // 2. 无草稿时先完成原生只读授权（此时仅显示只读授权按钮，不堆叠写入按钮），授权后再点击“申请原生写入权限”
    const authCard = screen.getByRole('region', { name: '项目授权状态' })
    expect(within(authCard).queryByRole('button', { name: '申请原生写入权限' })).not.toBeInTheDocument()
    await user.click(within(authCard).getByRole('button', { name: '申请原生只读授权' }))
    expect(await within(authCard).findByText('已授权（只读）')).toBeInTheDocument()
    await user.click(within(authCard).getByRole('button', { name: '申请原生写入权限' }))
    expect(takeoverSpy).toHaveBeenCalledTimes(1)
    expect(takeoverSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        projectId: 'proj-plate-01',
        draftRevision: null,
        previousScopeEpoch: 5,
        nextScopeEpoch: 6,
        targetSource: 'local-agent',
      }),
    )
    expect(await screen.findByText(/已获得原生写入授权并接管项目（代际 #6 · 写入代际 #2）/)).toBeInTheDocument()
    expect(within(authCard).getByText('已授权（可写）')).toBeInTheDocument()
  })

  it('P1-1：AUTH_REQUIRED.detail 同步新 scopeEpoch 时重置 writerEpoch 基线为 0，触发二次订阅携带 afterSequence，放行新 scope 低 writerEpoch 快照并拒绝旧 scope 事件', async () => {
    const user = userEvent.setup()
    let pushEvent: ((event: M1WorkbenchIncomingEvent) => void) | null = null
    const subscribeSpy = vi.fn(
      async (
        _req: {
          readonly projectId: string
          readonly scopeEpoch: number
          readonly afterSequence?: number
        },
        listener: (event: M1WorkbenchIncomingEvent) => void,
      ) => {
        pushEvent = listener
        return { ok: true as const, value: { subscriptionId: 'sub-p1-1', unsubscribe: vi.fn() } }
      },
    )
    const statusSpy = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: 'AUTH_REQUIRED',
        message: 'scope epoch 已变化',
        detail: '2',
      },
    }))

    const bridge: M1WorkbenchBridge = {
      subscribeM1WorkbenchEvents: subscribeSpy,
      getM1ConnectionStatus: statusSpy,
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={true}
        initialConnectionSnapshot={{
          connectionState: 'connected',
          source: 'local-agent',
          clientName: 'Claude Desktop',
          projectId: 'proj-plate-01',
          projectName: '安装板项目',
          baseRevision: 'v1',
          draftRevision: 'draft-1',
          authorizationState: 'authorized-writable',
          writerEpoch: 8,
          writerOccupied: true,
          writerOwner: 'old-writer',
        }}
      />,
    )

    // 初始第 1 次订阅（无 afterSequence）
    expect(subscribeSpy).toHaveBeenCalledTimes(1)
    expect(subscribeSpy.mock.calls[0][0]).toEqual({
      projectId: 'proj-plate-01',
      scopeEpoch: 1,
    })

    // 推进本地游标到 14
    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        scopeEpoch: 1,
        writerEpoch: 8,
        sequence: 14,
        type: 'draft_updated',
        draftRevision: 'draft-2',
      })
    })
    expect(screen.getAllByText(/draft-2/).length).toBeGreaterThan(0)

    // 触发 AUTH_REQUIRED (detail: "2") -> 同步 scopeEpoch=2 且重置 writerEpoch=0，触发第 2 次订阅并携带 afterSequence=14
    await user.click(screen.getByRole('button', { name: '检测连接状态' }))
    expect(await screen.findByText(/AUTH_REQUIRED/)).toBeInTheDocument()
    expect(subscribeSpy).toHaveBeenCalledTimes(2)
    expect(subscribeSpy.mock.calls[1][0]).toEqual({
      projectId: 'proj-plate-01',
      scopeEpoch: 2,
      afterSequence: 14,
    })

    // 旧 scope=1 事件（即使 writerEpoch=99）必须被严格拒绝
    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        scopeEpoch: 1,
        writerEpoch: 99,
        sequence: 15,
        type: 'draft_updated',
        draftRevision: 'draft-stale-scope1',
      })
    })
    expect(screen.queryByText(/draft-stale-scope1/)).not.toBeInTheDocument()

    // 新 scope=2 的权威 snapshot_required（writerEpoch=1 < 旧 writerEpoch=8）不得被误弃，并建立新 writerEpoch=1
    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        scopeEpoch: 2,
        writerEpoch: 1,
        sequence: 3,
        type: 'snapshot_required',
        snapshot: {
          connectionState: 'connected',
          source: 'local-agent',
          clientName: 'New Agent',
          projectId: 'proj-plate-01',
          projectName: '安装板项目',
          baseRevision: 'v1',
          draftRevision: 'draft-synced-scope2',
          authorizationState: 'authorized-writable',
          writerEpoch: 1,
          writerOccupied: true,
          writerOwner: 'New Agent',
        },
        activities: [
          {
            taskId: 'task-p1-1',
            projectId: 'proj-plate-01',
            status: 'running',
            title: '新代际权威快照活动',
          },
        ],
      })
    })
    expect(screen.getAllByText(/draft-synced-scope2/).length).toBeGreaterThan(0)
    // 进入工作台查看侧栏已同步的新代际权威快照活动
    await user.click(screen.getByRole('button', { name: '进入工作台' }))
    expect(screen.getByText('新代际权威快照活动')).toBeInTheDocument()
  })

  it('P1-2：真实 sendM1ChatMessage 桥接可用但无当前项目真实引用时严禁发送硬编码示例 ID（attachments=[], selectedObject=null），注入真实项目上下文后仅发送真实 ID', async () => {
    const user = userEvent.setup()
    const sendSpy = vi.fn<NonNullable<M1WorkbenchBridge['sendM1ChatMessage']>>(async () => ({
      ok: true as const,
      value: { messageId: 'msg-p1-2', reply: '收到' },
    }))
    const bridge: M1WorkbenchBridge = {
      testM1ModelApiConnection: async () => ({
        ok: true,
        value: {
          availableModels: ['gpt-4.1'],
          selectedModel: 'gpt-4.1',
          toolCallSupported: true,
          toolRoundTripPassed: true,
        },
      }),
      sendM1ChatMessage: sendSpy,
    }

    // 场景 A：真实桥接可用、未注入夹具、无项目真实上下文 -> 严禁发送 tb-plate-p1 / obj-right-hole
    const { unmount } = render(<ProjectAgentM1Workbench bridge={bridge} />)
    await user.click(screen.getByRole('button', { name: /使用模型 API/ }))
    await user.type(screen.getByLabelText('密钥'), 'sk-real-bridge')
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    await user.click(await screen.findByRole('button', { name: '开始建模' }))

    await user.type(screen.getByLabelText('内置对话输入框'), '检查当前项目')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy.mock.calls[0][0].attachments).toEqual([])
    expect(sendSpy.mock.calls[0][0].selectedObject).toBeNull()
    unmount()

    // 场景 B：真实桥接可用且通过当前项目快照提供真实特征与要求锚点 -> 仅发送真实项目 ID
    sendSpy.mockClear()
    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialPreviewSnapshot={{
          features: [
            {
              objectId: 'real-obj-flange-01',
              breadcrumb: '法兰盘 › 中心孔',
              featureRef: 'flange/center-hole',
              partName: '法兰盘',
              role: '中心孔',
              kind: 'hole',
              linkedAnnotationIds: [],
            },
          ],
          requirements: [
            {
              requirementId: 'real-req-1',
              title: '法兰盘中心孔公差',
              interpretation: 'Ø20 H7',
              required: true,
              status: 'confirmed',
              anchor: {
                documentRef: 'real-doc-flange-p1',
                documentName: '法兰盘规范.pdf',
                page: 1,
                excerpt: '中心孔 Ø20 H7',
              },
              linkedFeatureIds: ['real-obj-flange-01'],
              linkedAnnotationIds: [],
            },
          ],
        }}
      />,
    )
    await user.click(screen.getByRole('button', { name: /使用模型 API/ }))
    await user.type(screen.getByLabelText('密钥'), 'sk-real-bridge-2')
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    await user.click(await screen.findByRole('button', { name: '开始建模' }))

    await user.type(screen.getByLabelText('内置对话输入框'), '复核法兰盘中心孔')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy.mock.calls[0][0].attachments).toEqual(['real-doc-flange-p1'])
    expect(sendSpy.mock.calls[0][0].selectedObject).toBe('real-obj-flange-01')
  })

  it('P1-3：发送聊天前严格裁剪 history<=32，附加任务书引用超出 8 条时在 UI 给出清晰提示并阻止超限', async () => {
    const user = userEvent.setup()
    const sendSpy = vi.fn<NonNullable<M1WorkbenchBridge['sendM1ChatMessage']>>(async () => ({
      ok: true as const,
      value: { messageId: 'msg-p1-3', reply: 'ok' },
    }))
    const bridge: M1WorkbenchBridge = {
      testM1ModelApiConnection: async () => ({
        ok: true,
        value: {
          availableModels: ['gpt-4.1'],
          selectedModel: 'gpt-4.1',
          toolCallSupported: true,
          toolRoundTripPassed: true,
        },
      }),
      sendM1ChatMessage: sendSpy,
    }

    const manyTaskbooks = Array.from({ length: 10 }, (_, idx) => ({
      refId: `tb-doc-${idx + 1}`,
      documentName: `规范文档-${idx + 1}.pdf`,
      page: idx + 1,
      excerpt: `第 ${idx + 1} 条规范摘录`,
    }))
    const manyMessages = Array.from({ length: 36 }, (_, idx) => ({
      id: `hist-${idx + 1}`,
      role: (idx % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `历史消息 ${idx + 1}`,
      status: 'sent' as const,
    }))

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        availableTaskbooks={manyTaskbooks}
        initialMessages={manyMessages}
      />,
    )

    await user.click(screen.getByRole('button', { name: /使用模型 API/ }))
    await user.type(screen.getByLabelText('密钥'), 'sk-p1-3')
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    await user.click(await screen.findByRole('button', { name: '开始建模' }))

    // 打开「+ 引用」浮层：默认已选第 1 条，再连续点击第 2..8 条（共 8 条），尝试第 9 条 -> 给出上限提示且阻止超限
    await user.click(screen.getByTestId('attach-ref-btn'))
    for (let i = 2; i <= 8; i += 1) {
      await user.click(screen.getByRole('button', { name: new RegExp(`规范文档-${i}\\.pdf`) }))
    }
    expect(screen.getByText('附加任务书引用（8/8）')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /规范文档-9\.pdf/ }))
    expect(screen.getByText(/最多可附加 8 份任务书引用，已达到上限/)).toBeInTheDocument()
    expect(screen.getByText('附加任务书引用（8/8）')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '关闭引用选择' }))

    // 发送聊天：history 裁剪为最近 32 条（历史消息 5..36），attachments 恰好 8 条
    await user.type(screen.getByLabelText('内置对话输入框'), '按上限发送')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy.mock.calls[0][0].history).toHaveLength(32)
    expect(sendSpy.mock.calls[0][0].history[0]?.content).toBe('历史消息 5')
    expect(sendSpy.mock.calls[0][0].history[31]?.content).toBe('历史消息 36')
    expect(sendSpy.mock.calls[0][0].attachments).toHaveLength(8)
    expect(sendSpy.mock.calls[0][0].attachments).not.toContain('tb-doc-9')
  })

  it('P1-4：重试图纸在途期间收到同修订较新 drawing_ready 时，早先迟到重试成功被严格丢弃不覆盖较新图纸槽且释放 loading 状态', async () => {
    const user = userEvent.setup()
    let pushM2Event: ((event: M2PreviewEvent) => void) | null = null
    const retryDeferred = createDeferred<
      M1WorkbenchBridgeResult<{
        readonly projectId: string
        readonly revision: string
        readonly revisionOrder?: number
        readonly fingerprint: string
        readonly summary?: string
      }>
    >()

    const bridge: M1WorkbenchBridge & M2WorkbenchBridge = {
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushM2Event = listener
        return { ok: true, value: { subscriptionId: 'sub-p1-4' } }
      },
      retryM2Drawing: () => retryDeferred.promise,
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialDraftRevision="draft-8"
        initialPreviewSnapshot={{
          currentRevision: 'draft-8',
          model: {
            status: 'ready',
            revision: 'draft-8',
            revisionOrder: 8,
            isDraft: true,
            fingerprint: 'fp-draft-8-newer',
          },
          drawingFailure: {
            failedRevision: 'draft-8',
            failedRevisionOrder: 8,
            reason: '投影超时',
            retryable: true,
          },
        }}
      />,
    )

    // 发起重试图纸（在途挂起）
    await user.click(screen.getByRole('button', { name: '重试图纸' }))
    expect(screen.getByRole('button', { name: '正在重试图纸…' })).toBeDisabled()

    // 挂起期间收到同修订较新的 drawing_ready -> 递增 drawingStateGeneration 并更新图纸槽
    await act(async () => {
      pushM2Event?.({
        projectId: 'proj-plate-01',
        sequence: 2,
        revision: 'draft-8',
        fingerprint: 'fp-draft-8-newer',
        type: 'drawing_ready',
        summary: '同修订较新图纸已自动就绪',
        annotations: [
          {
            annotationId: 'ann-newer-ready',
            label: '较新自动就绪标注',
            valueText: '15.5 mm',
            view: 'top',
            linkedFeatureIds: ['obj-right-hole'],
          },
        ],
      })
    })
    expect(screen.getByText(/较新自动就绪标注/)).toBeInTheDocument()

    // 早先发起的迟到重试成功返回 -> 必须被严格丢弃，不覆盖较新图纸槽，且释放 loading
    await act(async () => {
      retryDeferred.resolve({
        ok: true,
        value: {
          projectId: 'proj-plate-01',
          revision: 'draft-8',
          revisionOrder: 8,
          fingerprint: 'fp-draft-8-stale-retry',
          summary: '迟到的旧重试结果',
        },
      })
    })
    expect(screen.getByText(/较新自动就绪标注/)).toBeInTheDocument()
    expect(screen.queryByText(/图纸重试成功/)).not.toBeInTheDocument()
    expect(screen.getByText(/已丢弃来自旧代际\/先前客户端的迟到响应或事件/)).toBeInTheDocument()
  })

  it('P1-5：工作台内联衔接原生只读授权前置链，未只读授权严禁触发 takeoverM1Draft，connectionSource=none 时强制明确选择目标入口', async () => {
    const user = userEvent.setup()

    // 1. 缺失 requestM1ProjectAuthorization 时诚实提示不可用且不伪造授权
    const takeoverSpyMissing = vi.fn()
    const { unmount: unmountMissing } = render(
      <ProjectAgentM1Workbench
        bridge={{ takeoverM1Draft: takeoverSpyMissing }}
        initialShowOnboarding={false}
        initialDraftRevision={null}
        initialConnectionSnapshot={{
          connectionState: 'disconnected',
          source: 'none',
          projectId: 'proj-plate-01',
          authorizationState: 'unauthorized',
          draftRevision: null,
        }}
      />,
    )
    // 未只读授权时仅展示“申请原生只读授权”，严禁暴露/触发写入接管
    expect(screen.queryByRole('button', { name: '申请原生写入' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '申请原生只读授权' }))
    expect(await screen.findByText(/缺失方法：requestM1ProjectAuthorization/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '申请原生写入' })).not.toBeInTheDocument()
    expect(takeoverSpyMissing).not.toHaveBeenCalled()
    unmountMissing()

    // 2. 完整前置链：先返回 AUTH_REQUIRED（不伪造授权），再授权成功进入只读授权；source='none' 时必须显式选择目标入口
    const authSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        error: { code: 'AUTH_REQUIRED', message: '用户拒绝了本次原生只读授权' },
      })
      .mockImplementationOnce(
        async (req: {
          readonly projectId: string
          readonly requestId: string
          readonly requestGeneration: number
        }) => ({
          ok: true as const,
          value: {
            projectId: req.projectId,
            authorizationRef: 'auth-ref-p1-5',
            requestGeneration: req.requestGeneration,
          },
        }),
      )
    const takeoverSpy = vi.fn(
      async (req: {
        readonly projectId: string
        readonly draftRevision: string | null
        readonly requestId: string
        readonly previousScopeEpoch: number
        readonly nextScopeEpoch: number
        readonly targetSource: 'local-agent' | 'model-api'
      }) => ({
        ok: true as const,
        value: {
          projectId: req.projectId,
          draftRevision: req.draftRevision,
          scopeEpoch: req.nextScopeEpoch,
          writerEpoch: 2,
          writerOwner: `owner-${req.targetSource}`,
          revokedPreviousWriter: true as const,
        },
      }),
    )

    render(
      <ProjectAgentM1Workbench
        bridge={{
          requestM1ProjectAuthorization: authSpy,
          takeoverM1Draft: takeoverSpy,
        }}
        initialShowOnboarding={false}
        initialDraftRevision="draft-3"
        initialConnectionSnapshot={{
          connectionState: 'disconnected',
          source: 'none',
          projectId: 'proj-plate-01',
          projectName: '安装板项目',
          baseRevision: 'v1',
          draftRevision: 'draft-3',
          authorizationState: 'unauthorized',
          writerEpoch: 1,
        }}
      />,
    )

    const banner = screen.getByRole('alert', { name: '断线与接管状态' })
    expect(within(banner).getByText(/须先完成原生只读授权，再申请写入或接管/)).toBeInTheDocument()
    expect(within(banner).queryByRole('button', { name: '接管当前草稿' })).not.toBeInTheDocument()

    // 第一次申请只读授权返回 AUTH_REQUIRED -> 展示错误且仍未授权
    await user.click(within(banner).getByRole('button', { name: '申请原生只读授权' }))
    expect(await screen.findByText(/AUTH_REQUIRED.*用户拒绝了本次原生只读授权/)).toBeInTheDocument()
    expect(within(banner).queryByRole('button', { name: '接管当前草稿' })).not.toBeInTheDocument()
    expect(takeoverSpy).not.toHaveBeenCalled()

    // 第二次申请只读授权成功 -> 更新为已授权（只读），但因为 source='none' 尚未选择目标入口，接管按钮仍禁用
    await user.click(within(banner).getByRole('button', { name: '申请原生只读授权' }))
    expect(await screen.findByText(/已完成项目 proj-plate-01 的原生只读授权/)).toBeInTheDocument()
    expect(within(banner).getByRole('button', { name: '接管当前草稿' })).toBeDisabled()

    // 明确选择目标入口为「模型 API」后，接管按钮解锁并以 targetSource='model-api' 调用 takeoverM1Draft
    await user.selectOptions(within(banner).getByLabelText('接管目标入口'), 'model-api')
    expect(within(banner).getByRole('button', { name: '接管当前草稿' })).toBeEnabled()
    await user.click(within(banner).getByRole('button', { name: '接管当前草稿' }))

    expect(takeoverSpy).toHaveBeenCalledTimes(1)
    expect(takeoverSpy.mock.calls[0][0].targetSource).toBe('model-api')
    expect(await screen.findByText(/已接管当前草稿（代际 #2 · 写入代际 #2）/)).toBeInTheDocument()
  })

  it('R-A：首次 subscribeM1WorkbenchEvents 返回无 detail 的 AUTH_REQUIRED 后，点击内联「申请原生只读授权」成功自动重建订阅并正常渲染新推送事件与活动', async () => {
    const user = userEvent.setup()
    let pushSecondSubEvent: ((event: M1WorkbenchIncomingEvent) => void) | null = null
    const subscribeSpy = vi
      .fn<NonNullable<M1WorkbenchBridge['subscribeM1WorkbenchEvents']>>()
      .mockResolvedValueOnce({
        ok: false as const,
        error: {
          code: 'AUTH_REQUIRED',
          message: '项目尚未完成原生只读授权，暂不可订阅事件流',
        },
      })
      .mockImplementationOnce(async (_req, listener) => {
        pushSecondSubEvent = listener
        return {
          ok: true as const,
          value: { subscriptionId: 'sub-ra-recovered', unsubscribe: vi.fn() },
        }
      })

    const authSpy = vi.fn(
      async (req: {
        readonly projectId: string
        readonly requestId: string
        readonly requestGeneration: number
      }) => ({
        ok: true as const,
        value: {
          projectId: req.projectId,
          authorizationRef: `auth-ra-${req.requestGeneration}`,
          requestGeneration: req.requestGeneration,
        },
      }),
    )

    render(
      <ProjectAgentM1Workbench
        bridge={{
          subscribeM1WorkbenchEvents: subscribeSpy,
          requestM1ProjectAuthorization: authSpy,
        }}
        initialShowOnboarding={false}
        initialDraftRevision={null}
        initialConnectionSnapshot={{
          connectionState: 'disconnected',
          source: 'none',
          projectId: 'proj-plate-01',
          projectName: '安装板项目',
          baseRevision: 'v1',
          draftRevision: null,
          authorizationState: 'unauthorized',
          writerEpoch: 1,
        }}
      />,
    )

    // 首次未授权启动调用订阅，返回无 detail 的 AUTH_REQUIRED（scopeEpoch 仍为 1）
    await waitFor(() => {
      expect(subscribeSpy).toHaveBeenCalledTimes(1)
    })
    expect(subscribeSpy.mock.calls[0][0]).toEqual({
      projectId: 'proj-plate-01',
      scopeEpoch: 1,
    })

    // 点击内联「申请原生只读授权」并成功 -> 自动触发二次 subscribeM1WorkbenchEvents
    const readonlyAuthButtons = screen.getAllByRole('button', { name: '申请原生只读授权' })
    await user.click(readonlyAuthButtons[0])
    expect(await screen.findByText(/已完成项目 proj-plate-01 的原生只读授权/)).toBeInTheDocument()

    await waitFor(() => {
      expect(subscribeSpy).toHaveBeenCalledTimes(2)
    })
    expect(subscribeSpy.mock.calls[1][0]).toEqual({
      projectId: 'proj-plate-01',
      scopeEpoch: 1,
    })

    // 通过恢复后的新订阅推送活动与草稿更新事件 -> UI 正常渲染展示
    await act(async () => {
      pushSecondSubEvent?.({
        projectId: 'proj-plate-01',
        scopeEpoch: 1,
        writerEpoch: 1,
        sequence: 1,
        type: 'activity_updated',
        activity: {
          taskId: 'task-ra-1',
          projectId: 'proj-plate-01',
          status: 'running',
          title: '只读授权恢复后的实时活动推送',
        },
      })
      pushSecondSubEvent?.({
        projectId: 'proj-plate-01',
        scopeEpoch: 1,
        writerEpoch: 1,
        sequence: 2,
        type: 'draft_updated',
        draftRevision: 'draft-ra-9',
      })
    })
    expect(screen.getByText('只读授权恢复后的实时活动推送')).toBeInTheDocument()
    expect(screen.getAllByText(/draft-ra-9/).length).toBeGreaterThan(0)
  })

  it('R-C：草稿 8 重试图纸挂起期间模型推进至草稿 9（drawingStateGeneration 未变），迟到草稿 8 重试返回时不覆盖画布、释放 loading、不误报成功且展示过期丢弃提示', async () => {
    const user = userEvent.setup()
    let pushM2Event: ((event: M2PreviewEvent) => void) | null = null
    const retryDeferred = createDeferred<
      M1WorkbenchBridgeResult<{
        readonly projectId: string
        readonly revision: string
        readonly revisionOrder?: number
        readonly fingerprint: string
        readonly summary?: string
        readonly annotations?: readonly {
          readonly annotationId: string
          readonly label: string
          readonly valueText: string
          readonly view: 'front' | 'top' | 'side'
          readonly linkedFeatureIds: readonly string[]
        }[]
      }>
    >()

    const bridge: M1WorkbenchBridge & M2WorkbenchBridge = {
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushM2Event = listener
        return { ok: true, value: { subscriptionId: 'sub-rc' } }
      },
      retryM2Drawing: () => retryDeferred.promise,
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialDraftRevision="draft-8"
        initialPreviewSnapshot={{
          currentRevision: 'draft-8',
          model: {
            status: 'ready',
            revision: 'draft-8',
            revisionOrder: 8,
            isDraft: true,
            fingerprint: 'fp-draft-8',
          },
          drawingFailure: {
            failedRevision: 'draft-8',
            failedRevisionOrder: 8,
            reason: '草稿 8 投影超时',
            retryable: true,
          },
        }}
      />,
    )

    // 1. 针对草稿 8 发起重试图纸（在途挂起）
    await user.click(screen.getByRole('button', { name: '重试图纸' }))
    expect(screen.getByRole('button', { name: '正在重试图纸…' })).toBeDisabled()

    // 2. 挂起期间仅收到草稿 9 的 model_ready（drawingStateGeneration 未变化）
    await act(async () => {
      pushM2Event?.({
        projectId: 'proj-plate-01',
        sequence: 2,
        revision: 'draft-9',
        revisionOrder: 9,
        fingerprint: 'fp-draft-9',
        type: 'model_ready',
        summary: '草稿 9 模型已就绪',
      })
    })
    expect(screen.getAllByText(/draft-9|草稿 9/).length).toBeGreaterThan(0)

    // 3. 迟到的草稿 8 重试返回成功 -> reducer 拒绝替换，UI 释放 loading、不覆盖画布、严禁误报“图纸重试成功”并明确提示已过期丢弃
    await act(async () => {
      retryDeferred.resolve({
        ok: true,
        value: {
          projectId: 'proj-plate-01',
          revision: 'draft-8',
          revisionOrder: 8,
          fingerprint: 'fp-draft-8',
          summary: '迟到的草稿 8 图纸重试结果',
          annotations: [
            {
              annotationId: 'ann-rc-stale-draft-8',
              label: '不应覆盖画布的草稿 8 迟到标注',
              valueText: '13.2 mm',
              view: 'top',
              linkedFeatureIds: ['obj-right-hole'],
            },
          ],
        },
      })
    })

    // loading 已释放
    expect(screen.queryByRole('button', { name: '正在重试图纸…' })).not.toBeInTheDocument()
    // 画布不被草稿 8 迟到重试覆盖
    expect(screen.queryByText(/不应覆盖画布的草稿 8 迟到标注/)).not.toBeInTheDocument()
    // 严禁误报成功
    expect(screen.queryByText(/图纸重试成功/)).not.toBeInTheDocument()
    // 明确展示旧修订重试结果已过期丢弃提示
    expect(
      screen.getByText(/旧修订（草稿 8）的图纸重试结果已过期丢弃，当前已推进至新修订（草稿 9）/),
    ).toBeInTheDocument()
  })
})
