import { listBuiltinTemplates, type BuiltinTemplateId } from '../../templates/registry'
import type {
  M1ChatToolCallItem,
  M1ClientConnectionState,
  M1ConnectionSource,
  M1ExternalActivityItem,
  M1ProjectAuthorizationState,
  M1SelectedObjectRef,
  M1TaskbookReference,
} from './m1WorkbenchBridge'
import type { M2RequirementItem } from './m2WorkbenchBridge'

export interface WorkbenchLocalProject {
  readonly projectId: string
  readonly projectName: string
  readonly baseRevision: string | null
  readonly draftRevision: string | null
  readonly isSample?: boolean
  readonly summary?: string
  readonly templateId?: BuiltinTemplateId
}

export interface WorkbenchChatMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly attachments?: readonly M1TaskbookReference[]
  readonly selectedObject?: M1SelectedObjectRef | null
  readonly toolCalls?: readonly M1ChatToolCallItem[]
  readonly draftRevision?: string | null
  readonly status?: 'sent' | 'failed' | 'cancelled'
  readonly errorMessage?: string
}

export type OnboardingChoice = 'local-agent' | 'model-api' | 'skip-local'
export type SidebarTab = 'external' | 'builtin'

export interface WorkbenchTracker {
  projectId: string
  draftRevision: string | null
  scopeEpoch: number
  writerEpoch: number
  strictEpochGuard: boolean
  strictEpochGuardByProject: Record<string, boolean>
  mounted: boolean
  requestSeq: number
  modelApiTestEpoch: number
  detectLocalAgentsEpoch: number
  registerLocalAgentEpoch: number
  modelListFetchEpoch: number
  commitRequestEpoch: number
  switchProjectEpoch: number
  takeoverRequestEpoch: number
  readonlyAuthGeneration: number
  readonlyAuthRequestEpoch: number
  retryDrawingEpoch: number
  drawingFailureGeneration: number
  drawingStateGeneration: number
  undoRequestEpoch: number
  migrationRequestEpoch: number
  activeChatRequestId: string | null
  activeTestRequestId: string | null
  lastEventSequence: number
}

export const DEFAULT_LOCAL_PROJECTS: readonly WorkbenchLocalProject[] = listBuiltinTemplates().map(
  (tpl) => ({
    projectId: tpl.projectDefaults.projectId,
    projectName: tpl.projectDefaults.projectName,
    baseRevision: tpl.projectDefaults.baseRevision,
    draftRevision: tpl.projectDefaults.draftRevision,
    isSample: tpl.projectDefaults.isSample,
    summary: tpl.projectDefaults.summary,
    templateId: tpl.templateId,
  }),
)

export const DEFAULT_TASKBOOKS: readonly M1TaskbookReference[] =
  listBuiltinTemplates()[0]?.taskbooks ?? []

export const STARTER_PROMPTS = [
  '生成 80×50×8 安装板',
  '向右移动选中孔 1 mm',
  '完成并复核',
] as const

export function formatClientConnectionLabel(
  state: M1ClientConnectionState,
  clientName: string | null,
): string {
  if (state === 'connected') {
    return clientName ? `已连接（${clientName}）` : '已连接'
  }
  if (state === 'connecting') {
    return '连接中'
  }
  return '未连接'
}

export function getClientConnectionTone(state: M1ClientConnectionState): string {
  if (state === 'connected') return 'pa-tone-pass'
  if (state === 'connecting') return 'pa-tone-pending'
  return 'pa-tone-muted'
}

export function formatAuthorizationLabel(state: M1ProjectAuthorizationState): string {
  if (state === 'authorized-writable') return '已授权（可写）'
  if (state === 'authorized-readonly') return '已授权（只读）'
  return '未授权'
}

export function getAuthorizationTone(state: M1ProjectAuthorizationState): string {
  if (state === 'authorized-writable') return 'pa-tone-pass'
  if (state === 'authorized-readonly') return 'pa-tone-action'
  return 'pa-tone-muted'
}

export function formatSourceLabel(
  source: M1ConnectionSource,
  clientName: string | null,
  modelName: string,
  skipped: boolean,
): string {
  if (source === 'local-agent') {
    return clientName ? `本地 Agent · ${clientName}` : '本地 Agent'
  }
  if (source === 'model-api') {
    return modelName.trim() ? `模型 API · ${modelName.trim()}` : '模型 API'
  }
  if (skipped) {
    return '本地浏览（跳过连接）'
  }
  return '未选择连接'
}

export function formatActivityStatusLabel(status: M1ExternalActivityItem['status']): {
  label: string
  tone: string
} {
  switch (status) {
    case 'succeeded':
      return { label: '已成功', tone: 'pa-tone-pass' }
    case 'running':
      return { label: '运行中', tone: 'pa-tone-action' }
    case 'queued':
      return { label: '排队中', tone: 'pa-tone-pending' }
    case 'awaitingInput':
      return { label: '待回答', tone: 'pa-tone-pending' }
    case 'interrupted':
      return { label: '已中断', tone: 'pa-tone-pending' }
    case 'failed':
      return { label: '已失败', tone: 'pa-tone-danger' }
    case 'cancelled':
      return { label: '已取消', tone: 'pa-tone-muted' }
  }
}

export function formatQuestionReason(reason: 'missing' | 'conflict' | 'ambiguousReference'): string {
  switch (reason) {
    case 'missing':
      return '缺项'
    case 'conflict':
      return '来源冲突'
    case 'ambiguousReference':
      return '引用歧义'
  }
}

export async function copyText(
  text: string,
  customWriter?: (value: string) => Promise<void> | void,
): Promise<boolean> {
  try {
    if (customWriter) {
      await customWriter(text)
      return true
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
    return false
  } catch {
    return false
  }
}

export function deriveTaskbooksFromRequirements(
  requirements: readonly M2RequirementItem[],
): readonly M1TaskbookReference[] {
  const seen = new Set<string>()
  const result: M1TaskbookReference[] = []
  for (const req of requirements) {
    const refId = req.anchor?.documentRef?.trim()
    if (!refId || seen.has(refId)) continue
    seen.add(refId)
    result.push({
      refId,
      documentName: req.anchor.documentName,
      page: req.anchor.page,
      excerpt: req.anchor.excerpt,
    })
  }
  return result
}
