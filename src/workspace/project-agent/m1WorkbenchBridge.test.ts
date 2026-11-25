import { describe, expect, it } from 'vitest'
import {
  applyAuthoritativeScopeEpochSync,
  buildLocalAgentConfigSnippet,
  canAutoFetchModelApiModels,
  canUseBuiltinModelApiChat,
  classifyModelApiFailure,
  computeModelApiConfigFingerprint,
  findModelApiProviderPresetByUrl,
  formatChatToolCallItem,
  formatSelectedObjectReference,
  getModelApiProviderPreset,
  isEventAcceptedForScope,
  isModelApiUnlocked,
  isReplyAcceptedForScope,
  isScopedArtifactEventAccepted,
  isValidModelApiBaseUrl,
  M1_CONNECTION_UX_BRIDGE_METHODS,
  M1_MODEL_API_PROVIDER_PRESETS,
  M1_WORKBENCH_BRIDGE_METHODS,
  MAX_M1_CHAT_ATTACHMENTS,
  MAX_M1_CHAT_HISTORY,
  parseAuthoritativeScopeEpochFromError,
  probeM1ConnectionUxBridge,
  probeM1ProjectAuthorization,
  probeM1WorkbenchBridge,
  selectPreferredModelFromList,
  shouldAcceptWorkbenchEventSequence,
  sortDetectedLocalAgents,
  trimM1ChatAttachments,
  trimM1ChatHistory,
} from './m1WorkbenchBridge'

describe('m1WorkbenchBridge', () => {
  it('空对象或非对象探测时全部能力为 false 并列出全部缺失方法', () => {
    const emptyProbe = probeM1WorkbenchBridge(undefined)
    expect(emptyProbe.anyAvailable).toBe(false)
    expect(emptyProbe.missingMethods).toEqual([...M1_WORKBENCH_BRIDGE_METHODS])
    expect(emptyProbe.capabilities.modelApiTest).toBe(false)
    expect(emptyProbe.capabilities.takeover).toBe(false)
  })

  it('部分接线时精确区分可用与缺失能力，且不伪造未接线方法', () => {
    const probe = probeM1WorkbenchBridge({
      testM1ModelApiConnection: async () => ({
        ok: false,
        error: { code: 'AUTH_FAILED', message: 'bad key' },
      }),
      takeoverM1Draft: async () => ({
        ok: false,
        error: { code: 'WRITER_HELD', message: 'held' },
      }),
    })

    expect(probe.anyAvailable).toBe(true)
    expect(probe.capabilities.modelApiTest).toBe(true)
    expect(probe.capabilities.takeover).toBe(true)
    expect(probe.capabilities.builtinChat).toBe(false)
    expect(probe.capabilities.connectionStatus).toBe(false)
    expect(probe.missingMethods).toContain('sendM1ChatMessage')
    expect(probe.missingMethods).not.toContain('testM1ModelApiConnection')
  })

  it('模型 API 错误分类明确区分鉴权失败与缺少工具调用能力', () => {
    const authErr = classifyModelApiFailure(
      { code: 'AUTH_FAILED', message: 'API key rejected' },
      null,
    )
    expect(authErr?.kind).toBe('auth_failed')
    expect(authErr?.title).toBe('鉴权失败')

    const noToolsErr = classifyModelApiFailure(
      { code: 'TOOL_CALL_UNSUPPORTED', message: 'model does not support tools' },
      null,
    )
    expect(noToolsErr?.kind).toBe('tool_call_unsupported')
    expect(noToolsErr?.title).toBe('缺少工具调用能力')

    const resultNoTools = classifyModelApiFailure(null, {
      availableModels: ['basic-chat'],
      selectedModel: 'basic-chat',
      toolCallSupported: false,
      toolRoundTripPassed: false,
    })
    expect(resultNoTools?.kind).toBe('tool_call_unsupported')
    expect(resultNoTools?.title).toBe('缺少工具调用能力')

    const resultNoRoundTrip = classifyModelApiFailure(null, {
      availableModels: ['gpt-4.1'],
      selectedModel: 'gpt-4.1',
      toolCallSupported: true,
      toolRoundTripPassed: false,
    })
    expect(resultNoRoundTrip?.kind).toBe('tool_roundtrip_failed')
  })

  it('仅在支持工具调用且真实工具往返通过后才解锁内置建模对话', () => {
    expect(isModelApiUnlocked(null)).toBe(false)
    expect(
      isModelApiUnlocked({
        availableModels: ['m1'],
        selectedModel: 'm1',
        toolCallSupported: false,
        toolRoundTripPassed: true,
      }),
    ).toBe(false)
    expect(
      isModelApiUnlocked({
        availableModels: ['m1'],
        selectedModel: 'm1',
        toolCallSupported: true,
        toolRoundTripPassed: false,
      }),
    ).toBe(false)
    expect(
      isModelApiUnlocked({
        availableModels: ['m1'],
        selectedModel: 'm1',
        toolCallSupported: true,
        toolRoundTripPassed: true,
        toolRoundTripName: 'describe_project',
      }),
    ).toBe(true)
  })

  it('基于安装位置生成 MCP 配置片段与自然语言连接说明', () => {
    const fallback = buildLocalAgentConfigSnippet(null)
    expect(fallback.fromBackend).toBe(false)
    expect(fallback.mcpConfigJson).toContain('mcpServers')
    expect(fallback.connectPrompt).toContain('连接寸链')

    const custom = buildLocalAgentConfigSnippet({
      installPath: '/Users/demo/Apps/寸链 Beta.app',
      bridgeCommand: '/Users/demo/Apps/寸链 Beta.app/Contents/Resources/cunlian-mcp',
      bridgeArgs: ['--stdio'],
      mcpServerName: 'cunlian-local',
    })
    expect(custom.fromBackend).toBe(true)
    expect(custom.installPath).toBe('/Users/demo/Apps/寸链 Beta.app')
    expect(custom.mcpConfigJson).toContain('cunlian-local')
    expect(custom.mcpConfigJson).toContain('/Users/demo/Apps/寸链 Beta.app/Contents/Resources/cunlian-mcp')
    expect(custom.connectPrompt).toContain('/Users/demo/Apps/寸链 Beta.app')
  })

  it('代际/scope 守卫丢弃先前客户端的迟到响应与推送事件', () => {
    const current = { projectId: 'proj-1', scopeEpoch: 2, writerEpoch: 3 }

    expect(
      isReplyAcceptedForScope(current, { projectId: 'proj-1', scopeEpoch: 2, writerEpoch: 3 }),
    ).toBe(true)
    expect(
      isReplyAcceptedForScope(current, { projectId: 'proj-1', scopeEpoch: 1, writerEpoch: 2 }),
    ).toBe(false)
    expect(
      isReplyAcceptedForScope(
        current,
        { projectId: 'proj-1', scopeEpoch: 2, writerEpoch: 3 },
        { scopeEpoch: 1, writerEpoch: 2 },
      ),
    ).toBe(false)

    expect(
      isEventAcceptedForScope(current, { projectId: 'proj-1', scopeEpoch: 2, writerEpoch: 3 }),
    ).toBe(true)
    expect(
      isEventAcceptedForScope(current, { projectId: 'proj-1', scopeEpoch: 1, writerEpoch: 3 }),
    ).toBe(false)
    expect(
      isEventAcceptedForScope(current, { projectId: 'proj-1', scopeEpoch: 2, writerEpoch: 2 }),
    ).toBe(false)
    expect(
      isEventAcceptedForScope(current, { projectId: 'proj-other', scopeEpoch: 2, writerEpoch: 3 }),
    ).toBe(false)
  })

  it('格式化选中对象引用文本', () => {
    expect(
      formatSelectedObjectReference({
        objectId: 'o1',
        breadcrumb: '安装板 › 右孔 › 圆柱面',
        featureRef: 'plate/right-hole/cylinder',
      }),
    ).toBe('安装板 › 右孔 › 圆柱面 [plate/right-hole/cylinder]')
  })

  it('F03：统一门禁函数校验当前表单指纹、工具往返通过与已连接状态，禁止绕过解锁条件', () => {
    const passedResult = {
      availableModels: ['gpt-4.1'],
      selectedModel: 'gpt-4.1',
      toolCallSupported: true,
      toolRoundTripPassed: true,
      toolRoundTripName: 'describe_project',
    }
    const fpA = computeModelApiConfigFingerprint({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1',
      apiKey: 'sk-a',
    })
    const fpB = computeModelApiConfigFingerprint({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1',
      apiKey: 'sk-b',
    })

    // 全部满足才放行
    expect(
      canUseBuiltinModelApiChat({
        testResult: passedResult,
        testedConfigFingerprint: fpA,
        currentConfigFingerprint: fpA,
        connectionState: 'connected',
        connectionSource: 'model-api',
      }),
    ).toBe(true)

    // 修改任一表单项导致指纹不一致 -> 拒绝
    expect(
      canUseBuiltinModelApiChat({
        testResult: passedResult,
        testedConfigFingerprint: fpA,
        currentConfigFingerprint: fpB,
        connectionState: 'connected',
        connectionSource: 'model-api',
      }),
    ).toBe(false)

    // 断线状态 -> 拒绝
    expect(
      canUseBuiltinModelApiChat({
        testResult: passedResult,
        testedConfigFingerprint: fpA,
        currentConfigFingerprint: fpA,
        connectionState: 'disconnected',
        connectionSource: 'model-api',
      }),
    ).toBe(false)

    // 重连到 local-agent 或无已通过测试 -> 拒绝
    expect(
      canUseBuiltinModelApiChat({
        testResult: null,
        testedConfigFingerprint: null,
        currentConfigFingerprint: fpA,
        connectionState: 'connected',
        connectionSource: 'model-api',
      }),
    ).toBe(false)
  })

  it('F04：代际守卫对缺失/null/非有限数 scopeEpoch 或 writerEpoch 严格 fail-closed 拒绝，并区分接管前后 M2/M3 兼容边界', () => {
    const current = { projectId: 'proj-1', scopeEpoch: 2, writerEpoch: 3 }

    // isEventAcceptedForScope: 缺失 / null / NaN / Infinity 全部 fail-closed 拒绝
    expect(isEventAcceptedForScope(current, { projectId: 'proj-1' })).toBe(false)
    expect(
      isEventAcceptedForScope(current, {
        projectId: 'proj-1',
        scopeEpoch: undefined,
        writerEpoch: 3,
      }),
    ).toBe(false)
    expect(
      isEventAcceptedForScope(current, {
        projectId: 'proj-1',
        scopeEpoch: 2,
        writerEpoch: null,
      }),
    ).toBe(false)
    expect(
      isEventAcceptedForScope(current, {
        projectId: 'proj-1',
        scopeEpoch: Number.NaN,
        writerEpoch: 3,
      }),
    ).toBe(false)
    expect(
      isEventAcceptedForScope(current, {
        projectId: 'proj-1',
        scopeEpoch: 2,
        writerEpoch: Number.POSITIVE_INFINITY,
      }),
    ).toBe(false)

    // isReplyAcceptedForScope: captured 或 replyScope 缺失/非法 epoch 全部 fail-closed 拒绝
    expect(
      isReplyAcceptedForScope(current, { projectId: 'proj-1', scopeEpoch: 2 }),
    ).toBe(false)
    expect(
      isReplyAcceptedForScope(
        current,
        { projectId: 'proj-1', scopeEpoch: 2, writerEpoch: 3 },
        { scopeEpoch: undefined, writerEpoch: 3 },
      ),
    ).toBe(false)
    expect(
      isReplyAcceptedForScope(
        current,
        { projectId: 'proj-1', scopeEpoch: 2, writerEpoch: 3 },
        { scopeEpoch: 2, writerEpoch: Number.NaN },
      ),
    ).toBe(false)

    // isScopedArtifactEventAccepted: 未接管前无 epoch 字段兼容放行；部分携带但缺失另一字段拒绝
    expect(
      isScopedArtifactEventAccepted(
        { ...current, strictEpochGuard: false },
        { projectId: 'proj-1' },
      ),
    ).toBe(true)
    expect(
      isScopedArtifactEventAccepted(
        { ...current, strictEpochGuard: false },
        { projectId: 'proj-1', scopeEpoch: 2 },
      ),
    ).toBe(false)

    // 接管后（strictEpochGuard: true）缺失 epoch 或旧 epoch 严格 fail-closed 拒绝
    expect(
      isScopedArtifactEventAccepted(
        { ...current, strictEpochGuard: true },
        { projectId: 'proj-1' },
      ),
    ).toBe(false)
    expect(
      isScopedArtifactEventAccepted(
        { ...current, strictEpochGuard: true },
        { projectId: 'proj-1', scopeEpoch: 1, writerEpoch: 3 },
      ),
    ).toBe(false)
    expect(
      isScopedArtifactEventAccepted(
        { ...current, strictEpochGuard: true },
        { projectId: 'proj-1', scopeEpoch: 2, writerEpoch: 3 },
      ),
    ).toBe(true)
  })

  it('M1-BE-02D B2：formatChatToolCallItem 支持后端标准结构 { name, status, taskId? } 并兼容旧结构与字符串', () => {
    const awaiting = formatChatToolCallItem({
      name: 'updateSpacerDraft',
      status: 'awaitingInput',
      taskId: 'task-42',
    })
    expect(awaiting.label).toContain('updateSpacerDraft')
    expect(awaiting.label).toContain('待补充输入')
    expect(awaiting.label).toContain('task-42')
    expect(awaiting.tone).toBe('pa-tone-pending')

    const succeeded = formatChatToolCallItem({
      name: 'describe_project',
      status: 'succeeded',
    })
    expect(succeeded.label).toContain('describe_project')
    expect(succeeded.label).toContain('已成功')
    expect(succeeded.tone).toBe('pa-tone-pass')

    const legacy = formatChatToolCallItem({
      toolName: 'stageChange',
      status: 'failed',
      summary: '冲突',
    })
    expect(legacy.label).toBe('stageChange：冲突')
    expect(legacy.tone).toBe('pa-tone-danger')

    const raw = formatChatToolCallItem('raw-tool-note')
    expect(raw.label).toBe('raw-tool-note')
  })

  it('M1-BE-02D B3：shouldAcceptWorkbenchEventSequence 对 snapshot_required 允许重置超前游标，普通事件保持严格递增', () => {
    expect(
      shouldAcceptWorkbenchEventSequence(50, { type: 'draft_updated', sequence: 12 }),
    ).toEqual({ accepted: false, nextLastSequence: 50 })

    // snapshot_required 可重置超前游标 50 -> 12
    expect(
      shouldAcceptWorkbenchEventSequence(50, { type: 'snapshot_required', sequence: 12 }),
    ).toEqual({ accepted: true, nextLastSequence: 12 })

    // 重置后 seq=13 正常放行
    expect(
      shouldAcceptWorkbenchEventSequence(12, { type: 'draft_updated', sequence: 13 }),
    ).toEqual({ accepted: true, nextLastSequence: 13 })
  })

  it('M1-BE-02D B4：parseAuthoritativeScopeEpochFromError 仅在 AUTH_REQUIRED 且 detail 为正整数字符串时提取可信 epoch', () => {
    expect(
      parseAuthoritativeScopeEpochFromError({
        code: 'AUTH_REQUIRED',
        message: 'stale scope',
        detail: '7',
      }),
    ).toBe(7)
    expect(
      parseAuthoritativeScopeEpochFromError({
        code: 'AUTH_REQUIRED',
        message: 'stale scope',
        detail: '0',
      }),
    ).toBeNull()
    expect(
      parseAuthoritativeScopeEpochFromError({
        code: 'AUTH_REQUIRED',
        message: 'stale scope',
        detail: '-2',
      }),
    ).toBeNull()
    expect(
      parseAuthoritativeScopeEpochFromError({
        code: 'AUTH_REQUIRED',
        message: 'stale scope',
        detail: 'epoch-3',
      }),
    ).toBeNull()
    expect(
      parseAuthoritativeScopeEpochFromError({
        code: 'DISCONNECTED',
        message: 'offline',
        detail: '7',
      }),
    ).toBeNull()
  })

  it('P1-1：applyAuthoritativeScopeEpochSync 同步新 scopeEpoch 时重置 writerEpoch 基线为 0，放行新 scope 的低 writerEpoch 快照并继续拒绝旧 scope 事件', () => {
    const prevScope = { projectId: 'proj-1', scopeEpoch: 1, writerEpoch: 8 }
    const synced = applyAuthoritativeScopeEpochSync(prevScope, {
      code: 'AUTH_REQUIRED',
      message: 'scope epoch 已变化',
      detail: '2',
    })
    expect(synced.changed).toBe(true)
    expect(synced.next).toEqual({ projectId: 'proj-1', scopeEpoch: 2, writerEpoch: 0 })

    // 新 scope=2 的权威快照 writer=1 绝不被旧 writer=8 误弃
    expect(
      isEventAcceptedForScope(synced.next, {
        projectId: 'proj-1',
        scopeEpoch: 2,
        writerEpoch: 1,
      }),
    ).toBe(true)

    // 旧 scope=1 事件即使携带高 writerEpoch 仍严格拒绝
    expect(
      isEventAcceptedForScope(synced.next, {
        projectId: 'proj-1',
        scopeEpoch: 1,
        writerEpoch: 99,
      }),
    ).toBe(false)
  })

  it('P1-3：trimM1ChatHistory 与 trimM1ChatAttachments 严格对齐后端 Zod 上限（history<=32, attachments<=8）', () => {
    expect(MAX_M1_CHAT_HISTORY).toBe(32)
    expect(MAX_M1_CHAT_ATTACHMENTS).toBe(8)

    const rawHistory = Array.from({ length: 40 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `消息 #${i + 1}`,
    }))
    const trimmedHistory = trimM1ChatHistory([
      { role: 'user', content: '   ' },
      ...rawHistory,
    ])
    expect(trimmedHistory).toHaveLength(32)
    expect(trimmedHistory[0]?.content).toBe('消息 #9')
    expect(trimmedHistory[31]?.content).toBe('消息 #40')

    const trimmedAttachments = trimM1ChatAttachments([
      'ref-1',
      'ref-1',
      '  ',
      'ref-2',
      'ref-3',
      'ref-4',
      'ref-5',
      'ref-6',
      'ref-7',
      'ref-8',
      'ref-9',
      'ref-10',
    ])
    expect(trimmedAttachments.attachments).toEqual([
      'ref-1',
      'ref-2',
      'ref-3',
      'ref-4',
      'ref-5',
      'ref-6',
      'ref-7',
      'ref-8',
    ])
    expect(trimmedAttachments.truncatedCount).toBe(2)
  })

  it('P1-5：probeM1ProjectAuthorization 精确探测 requestM1ProjectAuthorization 可用性', () => {
    expect(probeM1ProjectAuthorization(undefined).available).toBe(false)
    expect(probeM1ProjectAuthorization({}).available).toBe(false)
    const probed = probeM1ProjectAuthorization({
      requestM1ProjectAuthorization: async () => ({
        ok: true,
        value: { projectId: 'p1', authorizationRef: 'auth-1', requestGeneration: 0 },
      }),
    })
    expect(probed.available).toBe(true)
    expect(typeof probed.requestM1ProjectAuthorization).toBe('function')
  })

  it('UX-CONN-FE-01：probeM1ConnectionUxBridge 精确探测 3 个新窄接口且不影响既有 9 项 M1_WORKBENCH_BRIDGE_METHODS', () => {
    expect(M1_WORKBENCH_BRIDGE_METHODS).toHaveLength(9)
    expect(M1_CONNECTION_UX_BRIDGE_METHODS).toEqual([
      'detectM1LocalAgents',
      'registerM1LocalAgent',
      'listM1ModelApiModels',
    ])

    const emptyProbe = probeM1ConnectionUxBridge(undefined)
    expect(emptyProbe.anyAvailable).toBe(false)
    expect(emptyProbe.capabilities).toEqual({
      detectLocalAgents: false,
      registerLocalAgent: false,
      listModelApiModels: false,
    })
    expect(emptyProbe.missingMethods).toEqual([...M1_CONNECTION_UX_BRIDGE_METHODS])

    const partialProbe = probeM1ConnectionUxBridge({
      detectM1LocalAgents: async () => ({ ok: true, value: { agents: [] } }),
      listM1ModelApiModels: async () => ({
        ok: true,
        value: { models: ['deepseek-chat'], defaultModel: 'deepseek-chat' },
      }),
    })
    expect(partialProbe.anyAvailable).toBe(true)
    expect(partialProbe.capabilities.detectLocalAgents).toBe(true)
    expect(partialProbe.capabilities.registerLocalAgent).toBe(false)
    expect(partialProbe.capabilities.listModelApiModels).toBe(true)
    expect(partialProbe.missingMethods).toEqual(['registerM1LocalAgent'])
  })

  it('UX-CONN-FE-01：内置 10 个服务商预设完整，URL 校验、自动拉取资格与模型优先级选择符合规范', () => {
    expect(M1_MODEL_API_PROVIDER_PRESETS).toHaveLength(10)
    expect(M1_MODEL_API_PROVIDER_PRESETS.map((p) => p.id)).toEqual([
      'deepseek',
      'openai',
      'zhipu',
      'qwen',
      'moonshot',
      'siliconflow',
      'openrouter',
      'ollama',
      'lmstudio',
      'custom',
    ])

    expect(getModelApiProviderPreset('deepseek').baseUrl).toBe('https://api.deepseek.com/v1')
    expect(getModelApiProviderPreset('deepseek').defaultModel).toBe('deepseek-chat')
    expect(getModelApiProviderPreset('openai').defaultModel).toBe('gpt-4o')
    expect(getModelApiProviderPreset('zhipu').defaultModel).toBe('glm-4-plus')
    expect(getModelApiProviderPreset('qwen').defaultModel).toBe('qwen-plus')
    expect(getModelApiProviderPreset('moonshot').defaultModel).toBe('moonshot-v1-8k')
    expect(getModelApiProviderPreset('ollama').apiKeyOptional).toBe(true)
    expect(getModelApiProviderPreset('lmstudio').apiKeyOptional).toBe(true)
    expect(getModelApiProviderPreset('custom').isCustom).toBe(true)

    expect(findModelApiProviderPresetByUrl('https://api.deepseek.com/v1/')?.id).toBe('deepseek')
    expect(findModelApiProviderPresetByUrl('https://custom.local/v1')).toBeNull()

    expect(isValidModelApiBaseUrl('https://api.openai.com/v1')).toBe(true)
    expect(isValidModelApiBaseUrl('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isValidModelApiBaseUrl('ftp://invalid')).toBe(false)
    expect(isValidModelApiBaseUrl('not-a-url')).toBe(false)

    // 普通服务商需非空 Key；Ollama / LM Studio 允许空 Key
    expect(
      canAutoFetchModelApiModels({
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: '',
        providerId: 'deepseek',
      }),
    ).toBe(false)
    expect(
      canAutoFetchModelApiModels({
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-123',
        providerId: 'deepseek',
      }),
    ).toBe(true)
    expect(
      canAutoFetchModelApiModels({
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKey: '',
        providerId: 'ollama',
      }),
    ).toBe(true)
    expect(
      canAutoFetchModelApiModels({
        baseUrl: 'http://127.0.0.1:1234/v1',
        apiKey: '',
        providerId: 'lmstudio',
      }),
    ).toBe(true)

    // 选模型优先级：defaultModel -> presetDefaultModel -> 首项
    expect(
      selectPreferredModelFromList({
        models: ['m-a', 'deepseek-chat', 'deepseek-reasoner'],
        defaultModel: 'deepseek-reasoner',
        presetDefaultModel: 'deepseek-chat',
      }),
    ).toBe('deepseek-reasoner')
    expect(
      selectPreferredModelFromList({
        models: ['m-a', 'deepseek-chat', 'deepseek-reasoner'],
        defaultModel: 'non-existent',
        presetDefaultModel: 'deepseek-chat',
      }),
    ).toBe('deepseek-chat')
    expect(
      selectPreferredModelFromList({
        models: ['m-a', 'm-b'],
        defaultModel: null,
        presetDefaultModel: 'deepseek-chat',
      }),
    ).toBe('m-a')
    expect(
      selectPreferredModelFromList({
        models: [],
        defaultModel: 'm-a',
        presetDefaultModel: 'deepseek-chat',
      }),
    ).toBe('')

    // 本地 Agent 排序：已检测优先，未检测归入次级分组
    const sorted = sortDetectedLocalAgents([
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
        configPath: '~/.claude.json',
      },
      {
        id: 'cursor',
        name: 'Cursor',
        detected: true,
        configured: false,
        method: 'config-file',
        configPath: '~/.cursor/mcp.json',
      },
    ])
    expect(sorted.detected.map((a) => a.id)).toEqual(['claude-code', 'cursor'])
    expect(sorted.undetected.map((a) => a.id)).toEqual(['windsurf'])
  })
})
