/**
 * 确定性的候选/草稿身份：同一 PDF 版本 + 同一规则重复提取必须得到相同 ID。
 *
 * 用两轮 32 位 FNV-1a 组合成 16 位十六进制；这是内容身份，不是安全哈希。
 * 不以数组序号、时间戳或随机数生成身份，否则重试/并发重提会产生重复候选。
 */
export function stableHash(parts: readonly (string | number)[]): string {
  const text = parts.map((part) => String(part)).join('\u0001')
  let first = 0x811c9dc5
  let second = 0x01000193
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193) >>> 0
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`
}

export function stableId(prefix: string, parts: readonly (string | number)[]): string {
  return `${prefix}-${stableHash(parts)}`
}
