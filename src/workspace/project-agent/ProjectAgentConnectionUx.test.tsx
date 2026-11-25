// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectAgentM1Workbench } from './ProjectAgentM1Workbench'
import {
  M1_MODEL_API_PROVIDER_PRESETS,
  type M1ConnectionUxBridge,
  type M1DetectLocalAgentsResult,
  type M1ListModelApiModelsResult,
  type M1WorkbenchBridge,
  type M1WorkbenchBridgeResult,
} from './m1WorkbenchBridge'

type TestWorkbenchBridge = M1WorkbenchBridge & M1ConnectionUxBridge

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('UX-CONN-FE-01 零手动配置连接体验', () => {
  afterEach(() => {
    vi.useRealTimers()
    delete (window as { cunlian?: unknown }).cunlian
  })

  it('本地 Agent 自动检测优先展示已检测客户端、已配置 ✓ 徽标，一键配置成功后更新状态并展示重启与路径提示', async () => {
    const user = userEvent.setup()
    const detectSpy = vi.fn(
      async (): Promise<M1WorkbenchBridgeResult<M1DetectLocalAgentsResult>> => ({
        ok: true,
        value: {
          agents: [
            {
              id: 'windsurf',
              name: 'Windsurf',
              detected: false,
              configured: false,
              method: 'config-file',
              configPath: null,
            },
            {
              id: 'claude-code',
              name: 'Claude Code',
              detected: true,
              configured: true,
              method: 'cli',
              configPath: '/Users/demo/.claude.json',
            },
            {
              id: 'cursor',
              name: 'Cursor',
              detected: true,
              configured: false,
              method: 'config-file',
              configPath: '/Users/demo/.cursor/mcp.json',
            },
          ],
        },
      }),
    )
    const registerSpy = vi.fn(async ({ agentId }: { agentId: string }) => ({
      ok: true as const,
      value: {
        agentId: agentId as 'cursor',
        name: 'Cursor',
        configured: true as const,
        method: 'config-file' as const,
        configPath: '/Users/demo/.cursor/mcp.json',
        backupPath: '/Users/demo/.cursor/mcp.json.bak',
        message: '已为 Cursor 写入寸链 MCP 配置',
        requiresRestart: true,
      },
    }))

    const bridge: TestWorkbenchBridge = {
      getM1LocalAgentInstallInfo: async () => ({
        ok: true,
        value: {
          installPath: '/Applications/寸链.app',
          bridgeCommand: '/Applications/寸链.app/Contents/Resources/cunlian-mcp',
          bridgeArgs: ['--stdio'],
        },
      }),
      getM1ConnectionStatus: async () => ({
        ok: true,
        value: {
          connectionState: 'disconnected',
          source: 'none',
          clientName: null,
          projectId: 'proj-plate-01',
          draftRevision: null,
          authorizationState: 'unauthorized',
          writerEpoch: 1,
          writerOccupied: false,
        },
      }),
      detectM1LocalAgents: detectSpy,
      registerM1LocalAgent: registerSpy,
    }

    render(<ProjectAgentM1Workbench bridge={bridge} />)

    // 自动调用 detectM1LocalAgents
    await waitFor(() => expect(detectSpy).toHaveBeenCalledTimes(1))

    // 已检测到列表突出展示 Claude Code（已配置 ✓）与 Cursor（一键配置连接）
    const detectedList = await screen.findByRole('list', { name: '已检测到的本地 Agent 列表' })
    expect(within(detectedList).getByText('Claude Code')).toBeInTheDocument()
    expect(within(detectedList).getByText('已配置 ✓')).toBeInTheDocument()
    expect(within(detectedList).getByText('Cursor')).toBeInTheDocument()
    expect(within(detectedList).queryByText('Windsurf')).not.toBeInTheDocument()

    // 未检测客户端低调收纳在折叠区
    expect(screen.getByText('未检测到的其他支持客户端（1）')).toBeInTheDocument()

    // 点击 Cursor 的「一键配置连接」
    await user.click(screen.getByRole('button', { name: '一键配置连接 Cursor' }))
    expect(registerSpy).toHaveBeenCalledWith({ agentId: 'cursor' })

    // 成功后立即更新为「已配置 ✓」，并展示重启与路径/备份摘要
    expect(await screen.findByText('已为 Cursor 写入寸链 MCP 配置')).toBeInTheDocument()
    expect(screen.getByText('请重启 Cursor 以加载新配置。')).toBeInTheDocument()
    expect(screen.getByText('配置文件：/Users/demo/.cursor/mcp.json')).toBeInTheDocument()
    expect(screen.getByText('原配置备份：/Users/demo/.cursor/mcp.json.bak')).toBeInTheDocument()
    expect(within(detectedList).getAllByText('已配置 ✓')).toHaveLength(2)
  })

  it('本地 Agent 一键注册失败时展示清晰中文报错且绝不伪造已配置', async () => {
    const user = userEvent.setup()
    const bridge: TestWorkbenchBridge = {
      detectM1LocalAgents: async () => ({
        ok: true,
        value: {
          agents: [
            {
              id: 'claude-desktop',
              name: 'Claude Desktop',
              detected: true,
              configured: false,
              method: 'config-file',
              configPath: '/Users/demo/claude_desktop_config.json',
            },
          ],
        },
      }),
      registerM1LocalAgent: async () => ({
        ok: false,
        error: { code: 'PERMISSION_DENIED', message: '无法写入配置文件，请检查目录权限' },
      }),
    }

    render(<ProjectAgentM1Workbench bridge={bridge} />)

    const btn = await screen.findByRole('button', { name: '一键配置连接 Claude Desktop' })
    await user.click(btn)

    expect(
      await screen.findByText(/配置 Claude Desktop 失败（PERMISSION_DENIED）：无法写入配置文件/),
    ).toBeInTheDocument()
    expect(screen.queryByText('已配置 ✓')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '一键配置连接 Claude Desktop' }),
    ).toBeInTheDocument()
  })

  it('本地 Agent 未接线自动检测时诚实提示，且手动 MCP 配置默认折叠在底部并支持展开复制，同时支持从 window.cunlian 读取', async () => {
    const user = userEvent.setup()
    const copied: string[] = []
    const windowDetectSpy = vi.fn(async () => ({
      ok: true as const,
      value: {
        agents: [
          {
            id: 'codex' as const,
            name: 'Codex',
            detected: true,
            configured: true,
            method: 'cli' as const,
            configPath: null,
          },
        ],
      },
    }))

    // 1. bridge={{}} 未接线时诚实提示自动检测不可用 + 底部手动配置默认折叠
    const { unmount } = render(
      <ProjectAgentM1Workbench
        bridge={{}}
        clipboardWriter={(text) => {
          copied.push(text)
        }}
      />,
    )

    expect(screen.getByText(/本地 Agent 自动检测尚未接线\/不可用/)).toBeInTheDocument()
    const manualSummary = screen.getByText('其他客户端 / 手动复制 MCP 配置')
    const manualDetails = manualSummary.closest('details')
    expect(manualDetails).not.toBeNull()
    expect(manualDetails?.open).toBe(false)

    await user.click(manualSummary)
    expect(manualDetails?.open).toBe(true)
    await user.click(screen.getByRole('button', { name: '复制 MCP 配置' }))
    expect(copied[0]).toContain('mcpServers')
    unmount()

    // 2. 不传 bridge prop 时从 window.cunlian 探测 3 个新方法
    ;(window as { cunlian?: unknown }).cunlian = {
      detectM1LocalAgents: windowDetectSpy,
    }
    render(<ProjectAgentM1Workbench />)
    await waitFor(() => expect(windowDetectSpy).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Codex')).toBeInTheDocument()
  })

  it('模型 API 服务商下拉完整包含 10 个预设：选中预设自动填充 URL 与推荐模型并隐藏 URL 输入框，选自定义地址时展开 URL 输入框', async () => {
    const user = userEvent.setup()
    render(<ProjectAgentM1Workbench bridge={{}} />)

    await user.click(screen.getByRole('button', { name: /使用模型 API/ }))

    const providerSelect = screen.getByLabelText('服务商') as HTMLSelectElement
    const optionValues = Array.from(providerSelect.options).map((o) => o.value)
    expect(optionValues).toEqual(M1_MODEL_API_PROVIDER_PRESETS.map((p) => p.id))
    expect(optionValues).toHaveLength(10)

    // 默认选中 DeepSeek：隐藏 URL 输入框，展示只读 URL 提示并预填 deepseek-chat
    expect(providerSelect.value).toBe('deepseek')
    expect(screen.queryByLabelText('服务地址')).not.toBeInTheDocument()
    expect(screen.getByText('https://api.deepseek.com/v1')).toBeInTheDocument()
    expect((screen.getByLabelText('模型名') as HTMLInputElement).value).toBe('deepseek-chat')

    // 切换到 OpenAI / 智谱 / 通义千问 / Moonshot
    await user.selectOptions(providerSelect, 'openai')
    expect(screen.getByText('https://api.openai.com/v1')).toBeInTheDocument()
    expect((screen.getByLabelText('模型名') as HTMLInputElement).value).toBe('gpt-4o')

    await user.selectOptions(providerSelect, 'zhipu')
    expect(screen.getByText('https://open.bigmodel.cn/api/paas/v4')).toBeInTheDocument()
    expect((screen.getByLabelText('模型名') as HTMLInputElement).value).toBe('glm-4-plus')

    await user.selectOptions(providerSelect, 'qwen')
    expect(screen.getByText('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBeInTheDocument()
    expect((screen.getByLabelText('模型名') as HTMLInputElement).value).toBe('qwen-plus')

    await user.selectOptions(providerSelect, 'moonshot')
    expect(screen.getByText('https://api.moonshot.cn/v1')).toBeInTheDocument()
    expect((screen.getByLabelText('模型名') as HTMLInputElement).value).toBe('moonshot-v1-8k')

    // 切换到自定义地址：展开可编辑「服务地址」输入框
    await user.selectOptions(providerSelect, 'custom')
    const urlInput = screen.getByLabelText('服务地址') as HTMLInputElement
    expect(urlInput).toBeInTheDocument()
    expect(urlInput.value).toBe('')
  })

  it('填完 Key 后防抖约 400ms 自动调用 listM1ModelApiModels 渲染模型下拉并按优先级默认选中，支持 ↻ 立即刷新', async () => {
    vi.useFakeTimers()
    const listModelsSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          models: ['deepseek-reasoner', 'deepseek-chat'],
          defaultModel: 'deepseek-reasoner',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          models: ['deepseek-v3', 'deepseek-chat'],
          defaultModel: null,
        },
      })

    const bridge: TestWorkbenchBridge = {
      listM1ModelApiModels: listModelsSpy,
    }

    render(<ProjectAgentM1Workbench bridge={bridge} />)
    fireEvent.click(screen.getByRole('button', { name: /使用模型 API/ }))

    fireEvent.change(screen.getByLabelText('密钥'), { target: { value: 'sk-deepseek-key' } })

    // 350ms 内尚未触发防抖
    await act(async () => {
      vi.advanceTimersByTime(350)
    })
    expect(listModelsSpy).not.toHaveBeenCalled()

    // 满 400ms 后自动触发拉取
    await act(async () => {
      vi.advanceTimersByTime(60)
      await Promise.resolve()
    })
    expect(listModelsSpy).toHaveBeenCalledTimes(1)
    expect(listModelsSpy.mock.calls[0][0]).toMatchObject({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-deepseek-key',
      projectId: 'proj-plate-01',
      scopeEpoch: 1,
    })

    // 渲染 <select> 并默认选中 backend defaultModel（deepseek-reasoner）
    const modelSelect = screen.getByLabelText('模型名') as HTMLSelectElement
    expect(modelSelect.tagName).toBe('SELECT')
    expect(modelSelect.value).toBe('deepseek-reasoner')

    // 点击 ↻ 立即重新拉取，defaultModel 为 null 时回退命中预设推荐模型 deepseek-chat
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '刷新模型列表' }))
      await Promise.resolve()
    })
    expect(listModelsSpy).toHaveBeenCalledTimes(2)
    expect((screen.getByLabelText('模型名') as HTMLSelectElement).value).toBe('deepseek-chat')
  })

  it('防乱序与 F03 守卫：切换服务商后旧模型列表迟到响应被丢弃不污染新下拉，同时撤销既有测试解锁态', async () => {
    vi.useFakeTimers()
    const slowDeepSeek = createDeferred<M1WorkbenchBridgeResult<M1ListModelApiModelsResult>>()
    const fastOpenAi = createDeferred<M1WorkbenchBridgeResult<M1ListModelApiModelsResult>>()
    let callCount = 0

    const bridge: TestWorkbenchBridge = {
      listM1ModelApiModels: vi.fn(() => {
        callCount += 1
        return callCount === 1 ? slowDeepSeek.promise : fastOpenAi.promise
      }),
      testM1ModelApiConnection: vi.fn(async () => ({
        ok: true as const,
        value: {
          availableModels: ['deepseek-chat'],
          selectedModel: 'deepseek-chat',
          toolCallSupported: true,
          toolRoundTripPassed: true,
          toolRoundTripName: 'describe_project',
        },
      })),
    }

    render(<ProjectAgentM1Workbench bridge={bridge} />)
    fireEvent.click(screen.getByRole('button', { name: /使用模型 API/ }))
    fireEvent.change(screen.getByLabelText('密钥'), { target: { value: 'sk-key-1' } })

    // 先完成一次测试连接解锁「开始建模」
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
      await Promise.resolve()
    })
    expect(screen.getByRole('button', { name: '开始建模' })).toBeEnabled()

    // 触发 DeepSeek 模型列表拉取（在途挂起）
    await act(async () => {
      vi.advanceTimersByTime(450)
      await Promise.resolve()
    })
    expect(callCount).toBe(1)

    // 立即切换到 OpenAI -> F03 立即撤销「开始建模」解锁，并递增 modelListFetchEpoch
    fireEvent.change(screen.getByLabelText('服务商'), { target: { value: 'openai' } })
    expect(screen.getByRole('button', { name: '开始建模' })).toBeDisabled()

    // 触发 OpenAI 模型列表拉取并先返回
    await act(async () => {
      vi.advanceTimersByTime(450)
      await Promise.resolve()
    })
    expect(callCount).toBe(2)

    await act(async () => {
      fastOpenAi.resolve({
        ok: true,
        value: { models: ['gpt-4o', 'gpt-4o-mini'], defaultModel: 'gpt-4o' },
      })
      await Promise.resolve()
    })
    expect((screen.getByLabelText('模型名') as HTMLSelectElement).value).toBe('gpt-4o')

    // 此时迟到的 DeepSeek 旧响应到达 -> 必须被丢弃，绝不污染 OpenAI 下拉
    await act(async () => {
      slowDeepSeek.resolve({
        ok: true,
        value: { models: ['deepseek-stale-only'], defaultModel: 'deepseek-stale-only' },
      })
      await Promise.resolve()
    })
    const currentSelect = screen.getByLabelText('模型名') as HTMLSelectElement
    expect(currentSelect.value).toBe('gpt-4o')
    expect(Array.from(currentSelect.options).map((o) => o.value)).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })

  it('本地 Ollama 与 LM Studio 标注密钥可选、空 Key 自动拉取模型列表，并支持空 Key 直接测试连接', async () => {
    vi.useFakeTimers()
    const listModelsSpy = vi.fn(async ({ baseUrl }: { baseUrl: string }) => ({
      ok: true as const,
      value: {
        models: baseUrl.includes('11434') ? ['qwen2.5-coder:14b', 'llama3.2'] : ['local-lmstudio-model'],
        defaultModel: null,
      },
    }))
    const testSpy = vi.fn(async () => ({
      ok: true as const,
      value: {
        availableModels: ['qwen2.5-coder:14b'],
        selectedModel: 'qwen2.5-coder:14b',
        toolCallSupported: true,
        toolRoundTripPassed: true,
        toolRoundTripName: 'describe_project',
      },
    }))

    const bridge: TestWorkbenchBridge = {
      listM1ModelApiModels: listModelsSpy,
      testM1ModelApiConnection: testSpy,
    }

    render(<ProjectAgentM1Workbench bridge={bridge} />)
    fireEvent.click(screen.getByRole('button', { name: /使用模型 API/ }))

    // 切换到本地 Ollama（空 Key）
    fireEvent.change(screen.getByLabelText('服务商'), { target: { value: 'ollama' } })
    expect(screen.getByText('密钥（可选）')).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(450)
      await Promise.resolve()
    })
    expect(listModelsSpy).toHaveBeenCalledTimes(1)
    expect(listModelsSpy.mock.calls[0][0]).toMatchObject({
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: '',
    })
    expect((screen.getByLabelText('模型名') as HTMLSelectElement).value).toBe('qwen2.5-coder:14b')

    // 空 Key 直接测试连接成功
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
      await Promise.resolve()
    })
    expect(testSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '开始建模' })).toBeEnabled()

    // 切换到本地 LM Studio（空 Key）自动拉取
    fireEvent.change(screen.getByLabelText('服务商'), { target: { value: 'lmstudio' } })
    await act(async () => {
      vi.advanceTimersByTime(450)
      await Promise.resolve()
    })
    expect(listModelsSpy).toHaveBeenCalledTimes(2)
    expect((screen.getByLabelText('模型名') as HTMLSelectElement).value).toBe('local-lmstudio-model')
  })

  it('拉取模型失败、返回空列表或后端未接线时优雅降级为手动模型输入框，绝不阻塞测试连接流程', async () => {
    vi.useFakeTimers()
    const listModelsSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'NETWORK_ERROR', message: '上游连接超时' },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { models: [], defaultModel: null },
      })
    const testSpy = vi.fn(async () => ({
      ok: true as const,
      value: {
        availableModels: ['custom-manual-model'],
        selectedModel: 'custom-manual-model',
        toolCallSupported: true,
        toolRoundTripPassed: true,
        toolRoundTripName: 'describe_project',
      },
    }))

    // 1. 拉取失败 -> 降级手动输入
    const { unmount } = render(
      <ProjectAgentM1Workbench
        bridge={{
          listM1ModelApiModels: listModelsSpy,
          testM1ModelApiConnection: testSpy,
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /使用模型 API/ }))
    fireEvent.change(screen.getByLabelText('密钥'), { target: { value: 'sk-fallback' } })

    await act(async () => {
      vi.advanceTimersByTime(450)
      await Promise.resolve()
    })
    expect(screen.getByText(/自动拉取模型列表失败（NETWORK_ERROR）：上游连接超时/)).toBeInTheDocument()
    const manualInput = screen.getByLabelText('模型名') as HTMLInputElement
    expect(manualInput.tagName).toBe('INPUT')

    // 2. 点击 ↻ 返回空列表 -> 保持手动输入并提示
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '刷新模型列表' }))
      await Promise.resolve()
    })
    expect(screen.getByText(/服务商未返回可用模型列表/)).toBeInTheDocument()
    expect((screen.getByLabelText('模型名') as HTMLInputElement).tagName).toBe('INPUT')

    // 手动输入模型名并测试连接不受阻塞
    fireEvent.change(screen.getByLabelText('模型名'), { target: { value: 'custom-manual-model' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
      await Promise.resolve()
    })
    expect(testSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '开始建模' })).toBeEnabled()
    unmount()

    // 3. 后端未接线 listM1ModelApiModels -> 非阻塞提示 + 手动输入
    render(<ProjectAgentM1Workbench bridge={{ testM1ModelApiConnection: testSpy }} />)
    fireEvent.click(screen.getByRole('button', { name: /使用模型 API/ }))
    fireEvent.change(screen.getByLabelText('密钥'), { target: { value: 'sk-unwired' } })
    expect(screen.getByText(/当前环境未接线自动拉取模型列表/)).toBeInTheDocument()
    expect((screen.getByLabelText('模型名') as HTMLInputElement).tagName).toBe('INPUT')
  })
})
