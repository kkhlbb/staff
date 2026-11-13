/**
 * 任务记录脱敏：密钥、绝对路径、长文本（PDF 全文）一律不落。
 *
 * 只保留工具名、参数键、短数值和摘要指纹；摘要用于人工比对，不参与工程判定。
 *
 * 路径覆盖两套平台：
 * - POSIX（macOS）：`/Users/`、`/var/folders/`、`/private/`、`/Volumes/`、`/tmp/`
 * - Windows：盘符路径 `C:\Users\…` / `C:/Users/…`、UNC `\\server\share\…`、
 *   环境变量根 `%APPDATA%` / `%LOCALAPPDATA%` / `%TEMP%` / `%USERPROFILE%`
 */
import { stableFingerprint } from '../revisions/canonical'

const posixAbsolutePath = /(?:\/(?:Users|var\/folders|private|Volumes|tmp)\/[^\s"'<>\\]*)/gu

/**
 * Windows 盘符路径：单个字母 + 冒号 + 分隔符。
 * - 前面不能紧跟字母数字（否则 `ABC:\x` 这种正文会被当成盘符）；
 * - 目录段（以分隔符结尾）允许空格，覆盖 `C:\Program Files\…`；
 * - 末段不含空白与全角标点，避免把后面的正文一起吃掉；
 * - `C:\` 单独出现在正文里不当作路径（没有后续段，认不出位置）。
 */
const winDrivePath = /(?<![\w\\/])[A-Za-z]:[\\/](?:[^\\/:*?"<>|\r\n\u3000-\u303f\uff00-\uffef]+[\\/])*[^\\/:*?"<>|\s\u3000-\u303f\uff00-\uffef]*/gu

/** UNC 共享路径 `\\server\share\…`（server 段不含空白）。 */
const winUncPath = /\\\\[^\\/:*?"<>|\s]+\\[^\\/:*?"<>|\s]+(?:[\\/][^\\/:*?"<>|\s\u3000-\u303f\uff00-\uffef]*)*/gu

/** Windows 环境变量根（环境变量名大小写不敏感）。 */
const winEnvPath = /%(?:APPDATA|LOCALAPPDATA|TEMP|USERPROFILE)%(?:[\\/][^\\/:*?"<>|\s\u3000-\u303f\uff00-\uffef]*)*/giu

/** 替换成 `<path>`，但把误吞的句末标点还回去。 */
function replacePath(match: string): string {
  const trimmed = match.replace(/[.,;:!?]+$/u, '')
  if (trimmed === '' || trimmed === match) return '<path>'
  return `<path>${match.slice(trimmed.length)}`
}

/** Windows 路径脱敏（盘符 / UNC / 环境变量根）；不加显式空格的 `C:\` 保持原样。 */
function redactWindowsPaths(text: string): string {
  return text
    .replace(winUncPath, replacePath)
    .replace(winEnvPath, replacePath)
    .replace(winDrivePath, (match) => (/^[A-Za-z]:[\\/]$/u.test(match) ? match : replacePath(match)))
}

const secret = /\b(?:sk-[A-Za-z0-9_-]{8,}|(?:api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+|Bearer\s+[A-Za-z0-9._~+/-]{8,})/giu

export function fingerprint(value: unknown): string {
  return stableFingerprint(value)
}

/** 去掉路径与密钥，压平空白，超长文本截断并附指纹。 */
export function redactText(text: string, maxLength = 120): string {
  const cleaned = redactWindowsPaths(text)
    .replace(posixAbsolutePath, '<path>')
    .replace(secret, '<secret>')
    .replace(/\s+/gu, ' ')
    .trim()
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
  const findings = new Set<string>()
  if (/\/(?:Users|var\/folders|private|Volumes|tmp)\//u.test(text)) findings.add('absolute path')
  // 与脱敏用同一套 Windows 规则判，避免「能脱敏但检测放行」两套口径。
  if (redactWindowsPaths(text) !== text) findings.add('absolute path')
  if (/\bsk-[A-Za-z0-9_-]{8,}/u.test(text)) findings.add('secret')
  if (/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/u.test(text)) findings.add('bearer token')
  return [...findings]
}
