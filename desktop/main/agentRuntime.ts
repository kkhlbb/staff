/**
 * 阶段 2 的主进程装配：把调度器接到阶段 1 的 AgentToolService。
 *
 * 模型参数已由 AgentScheduler 做 JSON Schema 校验；这里调用的是受信工具服务，
 * 因此不经过渲染进程 IPC。真正的窗口/侧栏入口留到阶段 3。
 */
import type { AgentBudget } from '../../src/agent/types'
import { AgentScheduler, type AgentToolDispatcher } from './agentScheduler'
import { AgentTaskStore } from './agentTaskStore'
import type { AgentToolService } from './agentToolService'
import { ModelAdapterRegistry, ModelConfig, type ProviderStatus } from './modelAdapter'

export interface AgentRuntimeDeps {
  service: AgentToolService
  windowId: number
  rootDir: string
  activeProjectId: string
  adapters?: ModelAdapterRegistry
  provider?: { getProviderStatus(): ProviderStatus }
  budget?: Partial<AgentBudget>
  now?: () => number
}

export function createAgentToolDispatcher(service: AgentToolService, windowId: number): AgentToolDispatcher {
  return {
    dispatch(call) {
      return service.run(windowId, call.command, call.arguments)
    },
  }
}

export function createAgentRuntime(deps: AgentRuntimeDeps): AgentScheduler {
  return new AgentScheduler({
    store: new AgentTaskStore({ rootDir: deps.rootDir }),
    dispatch: createAgentToolDispatcher(deps.service, deps.windowId),
    adapters: deps.adapters ?? new ModelAdapterRegistry(),
    provider: deps.provider ?? new ModelConfig(),
    activeProjectId: deps.activeProjectId,
    ...(deps.budget === undefined ? {} : { budget: deps.budget }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  })
}
