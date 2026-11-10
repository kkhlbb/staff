/**
 * 稳定 JSON 序列化：键名递归排序。
 *
 * 用途只有哈希/指纹比较，不用于持久化正文。数组顺序保留（顺序本身可能是
 * 用户可见状态），对象键排序消除 `JSON.stringify` 的属性顺序差异。
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value))
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item))
  }
  const record = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) {
    const item = record[key]
    if (item !== undefined) {
      out[key] = normalize(item)
    }
  }
  return out
}

/**
 * 同步稳定指纹（FNV-1a 64 位，十六进制）。
 *
 * 只用于“来源基准是否变化”的相等判定，不是密码学哈希、也不是签名。
 * 选同步实现是为了 renderer 能对同一快照独立重算，无需把验证结果当真源。
 */
export function stableFingerprint(value: unknown): string {
  const text = canonicalJson(value)
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index) & 0xff)
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}
