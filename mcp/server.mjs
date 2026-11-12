#!/usr/bin/env node
/**
 * 寸链 MCP stdio 服务器入口（`node mcp/server.mjs` 或 `npm run mcp`）。
 *
 * 实现是 TypeScript（mcp/main.ts 与 mcp/tools/*），直接复用 src/ 下的领域内核，
 * 不生成、也不提交第二份 JS 副本。`register-ts.mjs` 负责 Node 版本闸门与
 * “无扩展名相对导入 → .ts”的解析钩子。
 *
 * 要求 Node.js >= 22.15（本机实测 v26.12）。没有原生依赖、不联网、不读密钥。
 */
import './register-ts.mjs'

const { startServer } = await import('./main.ts')
await startServer()
