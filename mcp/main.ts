/**
 * MCP stdio 服务器主体：JSON-RPC 2.0 帧 + 五个只读/计算工具。
 *
 * 边界（任务卡 §3）：
 * - 没有写项目/提交/保存的工具，也没有密钥与模型调用；
 * - 不联网；只读本地 PDF / 项目文件，`render_drawing` 只新增导出文件；
 * - stdout 只输出 JSON-RPC 帧，日志一律 stderr（见 lib/log.ts）。
 *
 * 传输按 MCP stdio 约定：一行一个 JSON 对象；请求逐个响应，通知不响应。
 */
import { readFile } from 'node:fs/promises'
import { createStdioServer } from './stdio'
import { TOOLS } from './tools/index'
export { SUPPORTED_PROTOCOL_VERSIONS, DEFAULT_PROTOCOL_VERSION } from './stdio'
export type { ServerIo } from './stdio'

export const SERVER_NAME = 'cunlian'
export const INSTRUCTIONS =
  '寸链确定性内核：读任务书、算尺寸链、判条款、出图、读项目。只读与计算，写入必须回桌面端点确认。'

async function packageVersion(): Promise<string> {
  try {
    const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8')
    const parsed = JSON.parse(raw) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export const { startServer, handleFrame } = createStdioServer({
  name: SERVER_NAME,
  version: packageVersion,
  instructions: INSTRUCTIONS,
  tools: TOOLS,
})
