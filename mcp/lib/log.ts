/**
 * MCP server 的日志：**一律写 stderr**。
 *
 * stdout 是 JSON-RPC 传输通道，任何多余字节都会破坏 MCP 帧；所以这里不提供
 * stdout 接口。默认只在 CU_NLIAN_MCP_VERBOSE=1 时输出，避免污染客户端日志。
 */

const verbose = process.env.CUN_LIAN_MCP_VERBOSE === '1'

export function mcpLog(message: string): void {
  if (!verbose) return
  process.stderr.write(`[cunlian-mcp] ${message}\n`)
}
