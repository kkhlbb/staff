/**
 * 任务记录脱敏：密钥、绝对路径、长文本（PDF 全文）一律不落。
 *
 * 只保留工具名、参数键、短数值和摘要指纹；摘要用于人工比对，不参与工程判定。
 */
import { stableFingerprint } from '../revisions/canonical'

const absolutePath = /(?:\/(?:Users|var\/folders|private|Volumes|tmp)\/[^\s"'<>\\]*)/gu
const secret = /\b(?:sk-[A-Za-z0-9_-]{8,}|(?:api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+|Bearer\s+[A-Za-z0-9._~+/-]{8,})/giu

export function fingerprint(value: unknown): string {
  return stableFingerprint(value)
}

/** 去掉路径与密钥，压平空白，超长文本截断并附指纹。 */
export function redactText(text: string, maxLength = 120): string {
  const cleaned = text.replace(absolutePath, '<path>').replace(secret, '<secret>').replace(/\s+/gu, ' ').trim()
  if (cleaned.length <= maxLength) return cleaned
  return `${cleaned.slice(0, maxLength)}…<${cleaned.length} chars ${stableFingerprint(cleaned)}>`
}

function summarizeString(value: string): string {
  return redactText(value, 80)
}

function summarizeValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return summarizeString(value)
  if (Array.isArray(value)) {
    return {
      array: value.length,
      sample: value.slice(0, 4).map((item) => summarizeValue(item, depth + 1)),
    }
  }
  if (typeof value === 'object') {
    if (depth >= 3) return { object: Object.keys(value).slice(0, 12) }
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 20)
    return Object.fromEntries(entries.map(([key, item]) => [redactText(key, 60), summarizeValue(item, depth + 1)]))
  }
  return '<unsupported>'
}

/** AgentStep.inputSummary：参数键 + 脱敏后的值，永远不是原始参数对象。 */
export function summarizeArguments(value: unknown): Record<string, unknown> {
  const summarized = summarizeValue(value, 0)
  if (summarized !== null && typeof summarized === 'object' && !Array.isArray(summarized)) {
    return summarized as Record<string, unknown>
  }
  return { value: summarized }
}

export function summarizeMessages(messages: { role: string; content: string }[]): unknown[] {
  return messages.slice(-6).map((message) => ({
    role: message.role,
    chars: message.content.length,
    digest: fingerprint(message.content),
    text: redactText(message.content, 80),
  }))
}

/** 存储前的最后一道防线；发现敏感内容直接拒绝写盘。 */
export function sensitiveFindings(text: string): string[] {
  const findings: string[] = []
  if (/\/(?:Users|var\/folders|private|Volumes|tmp)\//u.test(text)) findings.push('absolute path')
  if (/\bsk-[A-Za-z0-9_-]{8,}/u.test(text)) findings.push('secret')
  if (/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/u.test(text)) findings.push('bearer token')
  return findings
}
