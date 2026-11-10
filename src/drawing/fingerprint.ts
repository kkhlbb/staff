/**
 * 稳定内容哈希（V3-C）：同步 SHA-256 + 规范化 JSON。
 *
 * 为什么不用 src/sources/hash.ts 的 Web Crypto：图纸生成必须在 renderer 与 main
 * 里同步、确定性地得到同一 fingerprint，且不依赖 async 排序。这里只哈希几 KB
 * 的纯数据，自己实现 SHA-256 不会拖慢主线程；算法是 FIPS 180-4 的标准实现。
 *
 * 纯函数、无 Node 内置模块：renderer、jsdom 测试与 main 共用同一份。
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits))
}

export function sha256Bytes(bytes: Uint8Array): string {
  const bitLength = bytes.byteLength * 8
  const paddedLength = (((bytes.byteLength + 8) >> 6) + 1) << 6
  const buffer = new Uint8Array(paddedLength)
  buffer.set(bytes)
  buffer[bytes.byteLength] = 0x80
  const view = new DataView(buffer.buffer)
  // 长度字段为 64 位大端；这里的数据远小于 2^32 位，高位写 0。
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      w[index] = view.getUint32(offset + index * 4, false)
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(w[index - 15], 7) ^ rotr(w[index - 15], 18) ^ (w[index - 15] >>> 3)
      const s1 = rotr(w[index - 2], 17) ^ rotr(w[index - 2], 19) ^ (w[index - 2] >>> 10)
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0
    }

    let a = h[0], b = h[1], c = h[2], d = h[3]
    let e = h[4], f = h[5], g = h[6], hh = h[7]

    for (let index = 0; index < 64; index += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (hh + S1 + ch + K[index] + w[index]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0
      hh = g; g = f; f = e
      e = (d + temp1) >>> 0
      d = c; c = b; b = a
      a = (temp1 + temp2) >>> 0
    }

    h[0] = (h[0] + a) >>> 0
    h[1] = (h[1] + b) >>> 0
    h[2] = (h[2] + c) >>> 0
    h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0
    h[5] = (h[5] + f) >>> 0
    h[6] = (h[6] + g) >>> 0
    h[7] = (h[7] + hh) >>> 0
  }

  let hex = ''
  for (const value of h) {
    hex += value.toString(16).padStart(8, '0')
  }
  return hex
}

export function sha256Text(text: string): string {
  return sha256Bytes(new TextEncoder().encode(text))
}

/**
 * 规范化 JSON：对象键按字典序，数组保持顺序。
 * 拒绝 undefined/function/symbol/bigint 与循环引用，避免“看起来成功”的哈希。
 */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>()
  const encode = (input: unknown, path: string): string => {
    if (input === null) return 'null'
    switch (typeof input) {
      case 'string':
        return JSON.stringify(input)
      case 'number':
        if (!Number.isFinite(input)) {
          throw new Error(`规范化 JSON 不接受非有限数值：${path}`)
        }
        return Object.is(input, -0) ? '-0' : JSON.stringify(input)
      case 'boolean':
        return input ? 'true' : 'false'
      case 'object': {
        const object = input as object
        if (seen.has(object)) {
          throw new Error(`规范化 JSON 不接受循环引用：${path}`)
        }
        seen.add(object)
        let encoded: string
        if (Array.isArray(object)) {
          encoded = `[${object.map((item, index) => encode(item, `${path}[${index}]`)).join(',')}]`
        } else {
          const record = object as Record<string, unknown>
          const keys = Object.keys(record).sort()
          encoded = `{${keys
            .map((key) => {
              const item = record[key]
              if (item === undefined) {
                throw new Error(`规范化 JSON 不接受 undefined：${path}.${key}`)
              }
              return `${JSON.stringify(key)}:${encode(item, `${path}.${key}`)}`
            })
            .join(',')}}`
        }
        seen.delete(object)
        return encoded
      }
      default:
        throw new Error(`规范化 JSON 不接受 ${typeof input}：${path}`)
    }
  }
  return encode(value, '$')
}

export function stableFingerprint(value: unknown): string {
  return sha256Text(canonicalJson(value))
}
