/**
 * SHA-256 十六进制摘要。
 *
 * 使用 Web Crypto（异步、原生实现），不把 20 MiB 文件同步哈希在主线程上。
 * 浏览器不支持 SubtleCrypto 时明确报错，由导入流程转成可见失败，不静默跳过
 * 哈希或用其它摘要冒充。
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) {
    throw new Error('当前环境不支持 Web Crypto SHA-256，无法计算文件摘要')
  }
  const digest = await subtle.digest('SHA-256', new Uint8Array(bytes))
  const hashBytes = new Uint8Array(digest)
  let hex = ''
  for (const value of hashBytes) {
    hex += value.toString(16).padStart(2, '0')
  }
  return hex
}
