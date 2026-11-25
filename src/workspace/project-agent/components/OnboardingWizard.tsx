import type { RefObject } from 'react'
import {
  M1_MODEL_API_PROVIDER_PRESETS,
  type M1ClientConnectionState,
  type M1DetectedLocalAgent,
  type M1LocalAgentId,
  type M1ModelApiProviderPreset,
  type M1ModelApiProviderPresetId,
  type M1ModelApiTestResult,
  type M1OutgoingContextSummary,
  type M1ProjectAuthorizationState,
} from '../m1WorkbenchBridge'
import {
  formatAuthorizationLabel,
  formatClientConnectionLabel,
  getAuthorizationTone,
  getClientConnectionTone,
  type OnboardingChoice,
  type WorkbenchLocalProject,
} from '../workbenchHelpers'

export interface LocalAgentRegisterFeedback {
  readonly ok: boolean
  readonly agentId: M1LocalAgentId
  readonly agentName: string
  readonly message: string
  readonly configPath?: string | null
  readonly backupPath?: string | null
  readonly requiresRestart?: boolean
}

export interface ModelApiFailureNotice {
  readonly title: string
  readonly detail: string
  readonly code?: string
}

export interface OnboardingWizardProps {
  readonly onboardingChoice: OnboardingChoice
  readonly onSelectChoice: (choice: OnboardingChoice) => void
  readonly onClose: () => void

  // Capabilities
  readonly hasLocalAgentInstallInfo: boolean
  readonly hasConnectionStatus: boolean
  readonly hasDetectLocalAgents: boolean
  readonly hasModelApiTest: boolean

  // Local Agent state & handlers
  readonly detectingLocalAgents: boolean
  readonly localAgentDetectCompleted: boolean
  readonly localAgentDetectError: string | null
  readonly sortedDetectedLocalAgents: {
    readonly detected: readonly M1DetectedLocalAgent[]
    readonly undetected: readonly M1DetectedLocalAgent[]
  }
  readonly registeringAgentId: M1LocalAgentId | null
  readonly registerFeedback: LocalAgentRegisterFeedback | null
  readonly localAgentConfig: {
    readonly installPath: string
    readonly mcpConfigJson: string
    readonly connectPrompt: string
  }
  readonly statusChecking: boolean
  readonly connectionState: M1ClientConnectionState
  readonly clientName: string | null
  readonly authorizationState: M1ProjectAuthorizationState
  readonly writerOwner: string | null
  readonly draftRevision: string | null
  readonly readonlyAuthPending: boolean
  readonly takeoverPending: boolean
  readonly localAgentCopyFeedback: string | null
  readonly localAgentNotice: string | null
  readonly onDetectLocalAgents: () => void
  readonly onRegisterLocalAgent: (agent: M1DetectedLocalAgent) => void
  readonly onCopyLocalAgent: (text: string, label: string) => void
  readonly onRefreshConnectionStatus: () => void
  readonly onRequestReadonlyAuthorization: () => void
  readonly onTakeoverForLocalAgent: () => void
  readonly onEnterWorkbenchExternal: () => void

  // Model API state & handlers
  readonly apiProviderId: M1ModelApiProviderPresetId
  readonly currentProviderPreset: M1ModelApiProviderPreset
  readonly apiBaseUrl: string
  readonly apiKey: string
  readonly apiModel: string
  readonly availableApiModels: readonly string[]
  readonly manualModelInputMode: boolean
  readonly modelListLoading: boolean
  readonly effectiveModelListNotice: string | null
  readonly outgoingContextSummary: M1OutgoingContextSummary
  readonly modelApiFailure: ModelApiFailureNotice | null
  readonly modelApiTestResult: M1ModelApiTestResult | null
  readonly builtinUnlocked: boolean
  readonly apiTesting: boolean
  readonly testModelApiButtonRef: RefObject<HTMLButtonElement | null>
  readonly onProviderChange: (nextProviderId: M1ModelApiProviderPresetId) => void
  readonly onChangeApiBaseUrl: (value: string) => void
  readonly onChangeApiKey: (value: string) => void
  readonly onChangeApiModel: (value: string) => void
  readonly onToggleManualModelInputMode: () => void
  readonly onRefreshModelList: () => void
  readonly onTestModelApi: () => void
  readonly onStartBuiltinModeling: () => void

  // Local projects & built-in templates
  readonly localProjects: readonly WorkbenchLocalProject[]
  readonly onSkipDirectlyToWorkbench: () => void
  readonly onSkipToLocalProjects: () => void
  readonly onOpenLocalProject: (item: WorkbenchLocalProject) => void
}

/**
 * Scene 1: Focused single-column onboarding wizard with:
 * - Zero-manual-config Local Agent auto-detection & one-click registration
 * - 10 Model API provider presets + auto-fetched model dropdown
 * - Local projects & read-only built-in template entry
 */
export function OnboardingWizard({
  onboardingChoice,
  onSelectChoice,
  onClose,
  hasLocalAgentInstallInfo,
  hasConnectionStatus,
  hasDetectLocalAgents,
  hasModelApiTest,
  detectingLocalAgents,
  localAgentDetectCompleted,
  localAgentDetectError,
  sortedDetectedLocalAgents,
  registeringAgentId,
  registerFeedback,
  localAgentConfig,
  statusChecking,
  connectionState,
  clientName,
  authorizationState,
  writerOwner,
  draftRevision,
  readonlyAuthPending,
  takeoverPending,
  localAgentCopyFeedback,
  localAgentNotice,
  onDetectLocalAgents,
  onRegisterLocalAgent,
  onCopyLocalAgent,
  onRefreshConnectionStatus,
  onRequestReadonlyAuthorization,
  onTakeoverForLocalAgent,
  onEnterWorkbenchExternal,
  apiProviderId,
  currentProviderPreset,
  apiBaseUrl,
  apiKey,
  apiModel,
  availableApiModels,
  manualModelInputMode,
  modelListLoading,
  effectiveModelListNotice,
  outgoingContextSummary,
  modelApiFailure,
  modelApiTestResult,
  builtinUnlocked,
  apiTesting,
  testModelApiButtonRef,
  onProviderChange,
  onChangeApiBaseUrl,
  onChangeApiKey,
  onChangeApiModel,
  onToggleManualModelInputMode,
  onRefreshModelList,
  onTestModelApi,
  onStartBuiltinModeling,
  localProjects,
  onSkipDirectlyToWorkbench,
  onSkipToLocalProjects,
  onOpenLocalProject,
}: OnboardingWizardProps) {
  return (
    <div className="pa-onboarding-shell pa-onboarding-focused">
      <section className="pa-panel pa-onboarding-container" aria-label="首次启动与连接向导">
        <div className="pa-header pa-onboarding-hero">
          <div>
            <h2 className="pa-onboarding-title">选择一种方式连接 AI，开始建模</h2>
            <p className="pa-muted">
              3 步完成一次设计：① 连上 AI → ② 看图对话改图 → ③ 核查并确认保存
            </p>
          </div>
          <button
            type="button"
            className="pa-icon-btn"
            aria-label="收起向导"
            title="收起向导"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* 2 Primary Choice Cards */}
        <div className="pa-onboarding-options-two" role="group" aria-label="连接入口选项">
          <button
            type="button"
            className={`pa-option-card ${onboardingChoice === 'local-agent' ? 'pa-option-card-active' : ''}`}
            aria-pressed={onboardingChoice === 'local-agent'}
            onClick={() => onSelectChoice('local-agent')}
          >
            <div className="pa-row">
              <strong>连接本地 Agent</strong>
              <span className="pa-pill pa-tone-action">推荐</span>
            </div>
            <span className="pa-muted">
              复制 MCP 配置接入 Claude Desktop / Cursor 等本地客户端，零密钥外发。
            </span>
          </button>

          <button
            type="button"
            className={`pa-option-card ${onboardingChoice === 'model-api' ? 'pa-option-card-active' : ''}`}
            aria-pressed={onboardingChoice === 'model-api'}
            onClick={() => onSelectChoice('model-api')}
          >
            <div className="pa-row">
              <strong>使用模型 API</strong>
            </div>
            <span className="pa-muted">
              填入兼容 OpenAI 的地址、模型名与密钥，直接在寸链内对话建模。
            </span>
          </button>
        </div>

        {/* Expanded Step for Selected Card ONLY */}
        {onboardingChoice === 'local-agent' ? (
          <section className="pa-card pa-onboarding-step-card" aria-label="连接本地 Agent 配置">
            {!hasLocalAgentInstallInfo || !hasConnectionStatus ? (
              <div className="pa-notice" role="alert">
                后端尚未接线/不可用（缺失方法：
                <span className="pa-mono">
                  {[
                    !hasLocalAgentInstallInfo ? 'getM1LocalAgentInstallInfo' : null,
                    !hasConnectionStatus ? 'getM1ConnectionStatus' : null,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </span>
                ）。下方展示默认配置模板，不会伪造已连接状态。
              </div>
            ) : null}

            {/* Step 1: One-click Local Agent Auto-Detection & Registration */}
            <div className="pa-step-block">
              <div className="pa-header">
                <span className="pa-card-label">第 1 步 · 一键配置本地 Agent 客户端</span>
                <button
                  type="button"
                  className="pa-btn pa-btn-ghost pa-btn-sm"
                  disabled={detectingLocalAgents || !hasDetectLocalAgents}
                  onClick={onDetectLocalAgents}
                >
                  {detectingLocalAgents ? '检测中…' : '刷新检测'}
                </button>
              </div>

              {!hasDetectLocalAgents ? (
                <div className="pa-notice" role="status">
                  本地 Agent 自动检测尚未接线/不可用，请展开下方「其他客户端 / 手动复制 MCP 配置」完成配置。
                </div>
              ) : detectingLocalAgents && !localAgentDetectCompleted ? (
                <p className="pa-muted" role="status">
                  正在检测本机已安装的 Agent 客户端…
                </p>
              ) : localAgentDetectError ? (
                <div className="pa-danger-box" role="alert">
                  <span>{localAgentDetectError}</span>
                </div>
              ) : (
                <>
                  {sortedDetectedLocalAgents.detected.length > 0 ? (
                    <ul className="pa-agent-list" aria-label="已检测到的本地 Agent 列表">
                      {sortedDetectedLocalAgents.detected.map((agent) => (
                        <li key={agent.id} className="pa-agent-item">
                          <div className="pa-agent-item-info">
                            <div className="pa-row">
                              <span className="pa-agent-item-name">{agent.name}</span>
                              <span className="pa-muted">
                                {agent.method === 'cli' ? 'CLI' : '配置文件'}
                              </span>
                            </div>
                            {agent.detail || agent.configPath ? (
                              <span className="pa-agent-item-meta pa-mono">
                                {agent.detail ?? agent.configPath}
                              </span>
                            ) : null}
                          </div>
                          {agent.configured ? (
                            <span className="pa-pill pa-tone-pass">已配置 ✓</span>
                          ) : (
                            <button
                              type="button"
                              className="pa-btn pa-btn-primary pa-btn-sm"
                              disabled={registeringAgentId === agent.id}
                              aria-label={`一键配置连接 ${agent.name}`}
                              onClick={() => onRegisterLocalAgent(agent)}
                            >
                              {registeringAgentId === agent.id ? '配置中…' : '一键配置连接'}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="pa-muted" role="status">
                      暂未在本机检测到支持的 Agent 客户端，请展开下方手动复制 MCP 配置。
                    </p>
                  )}

                  {sortedDetectedLocalAgents.undetected.length > 0 ? (
                    <details className="pa-inline-details">
                      <summary className="pa-muted">
                        未检测到的其他支持客户端（{sortedDetectedLocalAgents.undetected.length}）
                      </summary>
                      <div className="pa-details-body">
                        <ul className="pa-agent-list" aria-label="未检测到的本地 Agent 列表">
                          {sortedDetectedLocalAgents.undetected.map((agent) => (
                            <li key={agent.id} className="pa-agent-item pa-agent-item-muted">
                              <div className="pa-agent-item-info">
                                <span className="pa-agent-item-name">{agent.name}</span>
                                {agent.detail ? (
                                  <span className="pa-agent-item-meta">{agent.detail}</span>
                                ) : null}
                              </div>
                              <span className="pa-pill pa-tone-muted">未检测到</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </details>
                  ) : null}
                </>
              )}

              {registerFeedback ? (
                <div
                  className={registerFeedback.ok ? 'pa-pass-box' : 'pa-danger-box'}
                  role={registerFeedback.ok ? 'status' : 'alert'}
                >
                  <strong>{registerFeedback.message}</strong>
                  {registerFeedback.ok && registerFeedback.requiresRestart ? (
                    <span>请重启 {registerFeedback.agentName} 以加载新配置。</span>
                  ) : null}
                  {registerFeedback.ok && registerFeedback.configPath ? (
                    <span className="pa-mono">配置文件：{registerFeedback.configPath}</span>
                  ) : null}
                  {registerFeedback.ok && registerFeedback.backupPath ? (
                    <span className="pa-mono">原配置备份：{registerFeedback.backupPath}</span>
                  ) : null}
                </div>
              ) : null}

              <details className="pa-inline-details pa-manual-mcp-details">
                <summary className="pa-muted">其他客户端 / 手动复制 MCP 配置</summary>
                <div className="pa-details-body">
                  <div className="pa-header">
                    <span className="pa-muted">手动复制 MCP JSON 配置片段</span>
                    <div className="pa-controls">
                      <button
                        type="button"
                        className="pa-btn pa-btn-sm"
                        onClick={() => onCopyLocalAgent(localAgentConfig.mcpConfigJson, 'MCP 配置')}
                      >
                        复制 MCP 配置
                      </button>
                    </div>
                  </div>
                  <pre className="pa-code-block pa-mono">{localAgentConfig.mcpConfigJson}</pre>
                  <details className="pa-inline-details">
                    <summary className="pa-muted">
                      查看自然语言连接说明与安装路径（{localAgentConfig.installPath}）
                    </summary>
                    <div className="pa-details-body">
                      <pre className="pa-code-block pa-mono">
                        {localAgentConfig.connectPrompt}
                      </pre>
                      <button
                        type="button"
                        className="pa-btn pa-btn-sm"
                        onClick={() => onCopyLocalAgent(localAgentConfig.connectPrompt, '连接说明')}
                      >
                        复制连接说明
                      </button>
                    </div>
                  </details>
                </div>
              </details>
            </div>

            {/* Step 2: Clearly Separated Client Connection & Project Authorization */}
            <div className="pa-step-block">
              <div className="pa-header">
                <span className="pa-card-label">第 2 步 · 确认连接与项目授权</span>
                <button
                  type="button"
                  className="pa-btn pa-btn-ghost pa-btn-sm"
                  disabled={statusChecking}
                  onClick={onRefreshConnectionStatus}
                >
                  {statusChecking ? '检测中…' : '检测连接状态'}
                </button>
              </div>

              <div className="pa-grid">
                <section className="pa-status-box" aria-label="客户端连接状态">
                  <span className="pa-card-label">客户端连接状态</span>
                  <div className="pa-row">
                    <span className={`pa-pill ${getClientConnectionTone(connectionState)}`}>
                      {formatClientConnectionLabel(connectionState, clientName)}
                    </span>
                    <span className="pa-muted pa-mono">{clientName ?? '未识别'}</span>
                  </div>
                </section>

                <section className="pa-status-box" aria-label="项目授权状态">
                  <span className="pa-card-label">项目授权状态</span>
                  <div className="pa-row">
                    <span className={`pa-pill ${getAuthorizationTone(authorizationState)}`}>
                      {formatAuthorizationLabel(authorizationState)}
                    </span>
                    {authorizationState === 'unauthorized' ? (
                      <button
                        type="button"
                        className="pa-btn pa-btn-sm pa-btn-active"
                        disabled={readonlyAuthPending}
                        onClick={onRequestReadonlyAuthorization}
                      >
                        {readonlyAuthPending ? '正在申请…' : '申请原生只读授权'}
                      </button>
                    ) : authorizationState === 'authorized-readonly' ? (
                      <button
                        type="button"
                        className="pa-btn pa-btn-sm pa-btn-active"
                        disabled={takeoverPending}
                        onClick={onTakeoverForLocalAgent}
                      >
                        {takeoverPending
                          ? '正在申请…'
                          : draftRevision === null
                            ? '申请原生写入权限'
                            : '申请原生写入 / 接管草稿'}
                      </button>
                    ) : (
                      <span className="pa-muted pa-mono">写入方：{writerOwner ?? '已就绪'}</span>
                    )}
                  </div>
                </section>
              </div>
            </div>

            {localAgentCopyFeedback ? (
              <p className="pa-muted" role="status">
                {localAgentCopyFeedback}
              </p>
            ) : null}
            {localAgentNotice ? (
              <div className="pa-notice" role="status">
                {localAgentNotice}
              </div>
            ) : null}

            <div className="pa-onboarding-cta-row">
              <button
                type="button"
                className="pa-btn pa-btn-primary"
                onClick={onEnterWorkbenchExternal}
              >
                进入工作台
              </button>
            </div>
          </section>
        ) : null}

        {onboardingChoice === 'model-api' ? (
          <section className="pa-card pa-onboarding-step-card" aria-label="使用模型 API 配置">
            {!hasModelApiTest ? (
              <div className="pa-notice" role="alert">
                后端尚未接线/不可用（缺失方法：
                <span className="pa-mono">testM1ModelApiConnection</span>
                ）。无法执行真实工具往返测试，内置建模对话保持锁定。
              </div>
            ) : null}

            <div className="pa-form-stack">
              <label className="pa-field">
                服务商
                <select
                  aria-label="服务商"
                  className="pa-input"
                  value={apiProviderId}
                  onChange={(event) => {
                    onProviderChange(event.target.value as M1ModelApiProviderPresetId)
                  }}
                >
                  {M1_MODEL_API_PROVIDER_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                {!currentProviderPreset.isCustom ? (
                  <span className="pa-provider-url-hint pa-mono">
                    {currentProviderPreset.baseUrl}
                  </span>
                ) : null}
              </label>

              {currentProviderPreset.isCustom ? (
                <label className="pa-field">
                  服务地址
                  <input
                    type="text"
                    aria-label="服务地址"
                    className="pa-input pa-mono"
                    placeholder="https://api.example.com/v1"
                    value={apiBaseUrl}
                    onChange={(event) => onChangeApiBaseUrl(event.target.value)}
                  />
                </label>
              ) : null}

              <div className="pa-form-grid-two">
                <label className="pa-field">
                  <span>
                    密钥
                    {currentProviderPreset.apiKeyOptional ? '（可选）' : ''}
                  </span>
                  <input
                    type="password"
                    aria-label="密钥"
                    className="pa-input pa-mono"
                    placeholder={
                      currentProviderPreset.apiKeyOptional
                        ? '本地服务通常无需密钥（密钥可选）'
                        : 'sk-...'
                    }
                    value={apiKey}
                    onChange={(event) => onChangeApiKey(event.target.value)}
                  />
                </label>

                <div className="pa-field">
                  <div className="pa-model-field-meta">
                    <span>模型名</span>
                    {availableApiModels.length > 0 ? (
                      <button
                        type="button"
                        className="pa-link-subtle"
                        onClick={onToggleManualModelInputMode}
                      >
                        {manualModelInputMode ? '选择列表' : '手动输入'}
                      </button>
                    ) : null}
                  </div>
                  <div className="pa-input-inline-row">
                    {availableApiModels.length > 0 && !manualModelInputMode ? (
                      <select
                        aria-label="模型名"
                        className="pa-input pa-mono"
                        value={apiModel}
                        onChange={(event) => onChangeApiModel(event.target.value)}
                      >
                        {availableApiModels.map((modelName) => (
                          <option key={modelName} value={modelName}>
                            {modelName}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        aria-label="模型名"
                        className="pa-input pa-mono"
                        placeholder="例如 deepseek-chat / gpt-4o"
                        value={apiModel}
                        onChange={(event) => onChangeApiModel(event.target.value)}
                      />
                    )}
                    <button
                      type="button"
                      className="pa-btn pa-btn-sm"
                      aria-label="刷新模型列表"
                      title="刷新模型列表"
                      disabled={modelListLoading}
                      onClick={onRefreshModelList}
                    >
                      ↻
                    </button>
                  </div>
                  {modelListLoading ? (
                    <span className="pa-provider-url-hint" role="status">
                      正在拉取可用模型…
                    </span>
                  ) : effectiveModelListNotice ? (
                    <span className="pa-provider-url-hint" role="status">
                      {effectiveModelListNotice}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Compact Outgoing Context Summary */}
            <section
              className="pa-disclosure-box"
              aria-label="本次需发送的文档片段与项目摘要"
            >
              <div className="pa-row">
                <span className="pa-card-label">外发上下文摘要</span>
                <span className="pa-muted pa-mono">
                  {outgoingContextSummary.projectName}（{outgoingContextSummary.projectId}）· 草稿{' '}
                  {outgoingContextSummary.draftRevision ?? '无'}
                </span>
                {outgoingContextSummary.selectedObject ? (
                  <span className="pa-muted">
                    · 选中：{outgoingContextSummary.selectedObject.breadcrumb}
                  </span>
                ) : null}
              </div>
              {outgoingContextSummary.documentExcerpts.length === 0 ? (
                <p className="pa-muted">当前未附加任务书片段，仅发送项目基础摘要与最小工具探测请求。</p>
              ) : (
                <ul className="pa-list">
                  {outgoingContextSummary.documentExcerpts.map((doc) => (
                    <li key={doc.refId} className="pa-muted">
                      <strong className="pa-mono">
                        {doc.documentName} · P{doc.page}
                      </strong>
                      ：{doc.excerpt}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {modelApiFailure ? (
              <div className="pa-danger-box" role="alert">
                <strong>
                  {modelApiFailure.title}
                  {modelApiFailure.code ? `（${modelApiFailure.code}）` : ''}
                </strong>
                <span>{modelApiFailure.detail}</span>
              </div>
            ) : null}

            {modelApiTestResult ? (
              <section
                className={builtinUnlocked ? 'pa-pass-box' : 'pa-notice'}
                aria-label="模型 API 测试结果"
              >
                <div className="pa-row">
                  <strong>
                    {builtinUnlocked ? '连接与真实工具往返通过' : '连接结果未满足解锁条件'}
                  </strong>
                  <span className="pa-mono">当前模型：{modelApiTestResult.selectedModel}</span>
                </div>
                <div className="pa-row">
                  <span>
                    工具调用能力：{modelApiTestResult.toolCallSupported ? '支持' : '不支持'}
                  </span>
                  <span>
                    真实工具往返：
                    {modelApiTestResult.toolRoundTripPassed
                      ? `通过${modelApiTestResult.toolRoundTripName ? `（${modelApiTestResult.toolRoundTripName}）` : ''}`
                      : '未通过'}
                  </span>
                </div>
                <div className="pa-row">
                  <span>
                    可用模型：
                    <span className="pa-mono">
                      {modelApiTestResult.availableModels.length > 0
                        ? modelApiTestResult.availableModels.join(', ')
                        : '无'}
                    </span>
                  </span>
                </div>
                {modelApiTestResult.sentContextSummary ? (
                  <div className="pa-row" aria-label="实际发送上下文摘要">
                    <span>
                      实际发送上下文摘要：
                      <span className="pa-mono">{modelApiTestResult.sentContextSummary}</span>
                    </span>
                  </div>
                ) : null}
              </section>
            ) : null}

            <div className="pa-onboarding-cta-row">
              <button
                ref={testModelApiButtonRef}
                type="button"
                className={builtinUnlocked ? 'pa-btn' : 'pa-btn pa-btn-primary'}
                disabled={apiTesting}
                onClick={onTestModelApi}
              >
                {apiTesting ? '正在测试连接与工具往返…' : '测试连接'}
              </button>
              <button
                type="button"
                className={builtinUnlocked ? 'pa-btn pa-btn-primary' : 'pa-btn'}
                disabled={!builtinUnlocked}
                onClick={onStartBuiltinModeling}
              >
                开始建模
              </button>
            </div>
          </section>
        ) : null}

        {onboardingChoice === 'skip-local' ? (
          <section className="pa-card pa-onboarding-step-card" aria-label="本地项目与示例">
            <div className="pa-header">
              <h3 className="pa-title">选择本地项目或示例直接体验</h3>
              <button
                type="button"
                className="pa-btn pa-btn-sm"
                onClick={onSkipDirectlyToWorkbench}
              >
                直接进入当前工作台
              </button>
            </div>
            {localProjects.length === 0 ? (
              <p className="pa-muted">暂无本地项目与示例</p>
            ) : (
              <ul className="pa-list">
                {localProjects.map((item) => (
                  <li key={item.projectId} className="pa-check">
                    <div>
                      <div className="pa-row">
                        <strong>{item.projectName}</strong>
                        <span className="pa-mono pa-muted">{item.projectId}</span>
                        {item.isSample ? (
                          <span className="pa-pill pa-tone-action">示例</span>
                        ) : null}
                        <span className="pa-muted pa-mono">
                          正式版 {item.baseRevision ?? '无'} · 草稿 {item.draftRevision ?? '无'}
                        </span>
                      </div>
                      {item.summary ? <p className="pa-muted">{item.summary}</p> : null}
                    </div>
                    <button
                      type="button"
                      className="pa-btn pa-btn-sm"
                      aria-label={`打开项目 ${item.projectName}`}
                      onClick={() => onOpenLocalProject(item)}
                    >
                      打开项目
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {/* Single Subtle Skip Link at Bottom */}
        {onboardingChoice !== 'skip-local' ? (
          <div className="pa-onboarding-skip-row">
            <button
              type="button"
              className="pa-link-subtle"
              onClick={onSkipToLocalProjects}
            >
              先跳过，直接体验工作台
            </button>
          </div>
        ) : null}
      </section>
    </div>
  )
}
