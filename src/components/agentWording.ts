/**
 * 任务侧栏的用户可见文案：把工具名、任务状态与错误码翻成人话。
 *
 * 边界（本模块只决定“打印给人看的那一行怎么写”，不改任何判定）：
 * - 工具名、状态机枚举、错误码与回执数据保持原样，仍完整保存在任务记录、日志与
 *   证据里；这里只负责显示层映射。
 * - 未认识的工具 / 状态 / 错误码不回显原始标识符，一律落到中性说法，避免以后
 *   新增内部名时又漏到界面上。
 * - 工具定义与工具描述不经过本模块：模型看到的仍是 src/agent/toolSchemas.ts 原文。
 */
import type { AgentStepRecord, AgentTaskState } from '../agent/types'
import { SPACER_PARAMETER_LABELS } from '../drawing/types'

/** 工具名 → 用户说法。键是模型侧工具名，值只出现在界面上。 */
const TOOL_LABELS: Record<string, string> = {
  context: '读项目',
  confirmed: '读已确认项',
  apply: '按确认建草稿',
  stage: '改参数',
  preview: '算一遍',
  export: '导出',
  createProject: '建立无任务书项目',
  setChain: '写组成环',
  setRequirement: '写条款区间',
  setBinding: '写隔套参数',
  ingest_readings: '接收外部读数（未核对）',
}

export function toolLabel(tool: unknown): string {
  return typeof tool === 'string' && Object.hasOwn(TOOL_LABELS, tool) ? TOOL_LABELS[tool] : '工具操作'
}

/** 任务状态 → 用户说法（“谁在干活、干到哪、卡在哪”）。 */
const TASK_STATE_LABELS: Record<AgentTaskState, string> = {
  idle: '还没开始',
  reading: '正在读项目',
  'awaiting-input': '等你补充信息',
  'awaiting-confirmation': '等你确认',
  executing: '正在改图',
  checking: '正在复核',
  'ready-to-commit': '已算完，等你确认',
  committing: '正在保存',
  completed: '已完成',
  failed: '没有做成',
  cancelled: '已取消',
}

export function taskStateLabel(state: string): string {
  return Object.hasOwn(TASK_STATE_LABELS, state) ? TASK_STATE_LABELS[state as AgentTaskState] : '状态未知'
}

/** 错误码 → 一句话原因（不回显码本身）。 */
const CODE_TITLES: Record<string, string> = {
  INVALID_INPUT: '数值或参数不合法',
  CONSTRAINT_VIOLATED: '这个参数被锁定',
  NEEDS_CLARIFICATION: '还需要你补充一句',
  UNSUPPORTED_SCOPE: '超出这个工具的范围',
  SOURCE_CHANGED: '任务书已换版',
  NOT_CONFIRMED: '相关候选还没确认',
  STALE_BASE: '基线版本已经变了',
  STALE_PREVIEW: '这次预览已经过期',
  STALE_REPLY: '项目已经切换',
  CANCELLED: '任务被取消',
  BUDGET_EXHAUSTED: '工具调用次数用完了',
  CHUNK_FAILED: '读任务书时出错',
  EXPORT_UNAVAILABLE: '导出端口没有装配',
  REQUIREMENT_MUST_BE_USER_GIVEN: '条款区间必须由你说',
  VALUE_MUST_BE_USER_GIVEN: '数值必须由你说',
  STATEMENT_NOT_USER_GIVEN: '出处原话不是本轮输入',
}

export function codeTitle(code: string | null): string {
  return code !== null && Object.hasOwn(CODE_TITLES, code) ? CODE_TITLES[code] : '这一步没有做成'
}

/** 错误码 → 下一步怎么办。 */
const CODE_REMEDIES: Record<string, string> = {
  INVALID_INPUT: '检查数值与单位后再说一次，例如“把长度改成 12.04 mm”。',
  CONSTRAINT_VIOLATED: '换一个能改的参数（内径 / 外径 / 长度）；锁定参数改不了。',
  NEEDS_CLARIFICATION: '补一句更具体的改动，再重新发起。',
  UNSUPPORTED_SCOPE: '这个工具只处理隔套的一条轴向链，换成本工具支持的改动。',
  SOURCE_CHANGED: '先核对新版任务书、重新确认条款，再发起改动。',
  NOT_CONFIRMED: '先在提取复核里确认候选，再来改图。',
  STALE_BASE: '点“继续”，从最新版本重新开始。',
  STALE_PREVIEW: '点“继续”，重新算一遍再确认。',
  STALE_REPLY: '重新发起一次任务；旧任务的回包已被丢弃。',
  CANCELLED: '需要的话重新发起任务。',
  BUDGET_EXHAUSTED: '把改动说得更直接，或拆成更小的一步再试。',
  CHUNK_FAILED: '换一份带文本层的 PDF；扫描件或加密文档读不出来。',
  EXPORT_UNAVAILABLE: '在桌面包里重试导出；导出仍由系统保存对话框确认。',
  REQUIREMENT_MUST_BE_USER_GIVEN: '把条款区间用自己的话说一遍（例如“间隙 0.15 到 0.25”）；模型不能代填或引用标准等级。',
  VALUE_MUST_BE_USER_GIVEN: '把尺寸用自己的话说一遍；编造或推算的数会被拒绝。',
  STATEMENT_NOT_USER_GIVEN: '让用户原样说出这句话，再重试。',
}

export function codeRemedy(code: string | null): string {
  return code !== null && Object.hasOwn(CODE_REMEDIES, code)
    ? CODE_REMEDIES[code]
    : '点“继续”从最新版本重试；若反复失败，检查参数后重新发起。'
}

function parameterLabelOf(summary: Record<string, unknown>): string | null {
  const args = summary.arguments
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return null
  const parameter = (args as Record<string, unknown>).parameter
  return typeof parameter === 'string' && Object.hasOwn(SPACER_PARAMETER_LABELS, parameter)
    ? SPACER_PARAMETER_LABELS[parameter as keyof typeof SPACER_PARAMETER_LABELS]
    : null
}

/**
 * 执行步骤 → 一句人话（不写“工具A → 工具B”的管道）。
 * 只读 step 的既有字段，不推断模型意图。
 */
export function stepSentence(step: Pick<AgentStepRecord, 'kind' | 'inputSummary' | 'errorCode'>): string {
  if (step.kind === 'model') return '模型想好了下一步'
  const tool = step.inputSummary.tool
  if (step.errorCode !== null) return `${toolLabel(tool)}没成功`
  switch (tool) {
    case 'stage': {
      const parameter = parameterLabelOf(step.inputSummary)
      return parameter === null ? '改了一个参数并重算' : `已改${parameter}参数并重算`
    }
    case 'preview': return '已算完，等你确认'
    case 'apply': return '已按确认建好草稿'
    case 'context': return '已读项目'
    case 'confirmed': return '已读已确认项'
    case 'export': return '已导出'
    case 'createProject': return '已建立无任务书项目'
    case 'setChain': return '已写入组成环草稿'
    case 'setRequirement': return '已写入条款区间草稿（来自你的原话）'
    case 'setBinding': return '已写入隔套参数草稿'
    default: return '已执行一步'
  }
}

/** 回执行 → “工具说法 · 结果”，不带工具名与错误码。 */
export function receiptLabel(step: Pick<AgentStepRecord, 'kind' | 'inputSummary' | 'errorCode'>): string {
  if (step.kind === 'model') return '模型回复 · 已收到'
  return `${toolLabel(step.inputSummary.tool)} · ${step.errorCode === null ? '完成' : '没成功'}`
}

/** 回执时间；回执引用（outputRef）是给机器与日志的，不直接打印。 */
export function receiptTime(at: string): string {
  const value = new Date(at)
  return Number.isNaN(value.getTime()) ? '—' : value.toLocaleTimeString('zh-CN')
}
