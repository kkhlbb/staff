/**
 * 让 Node 直接执行仓库里的 TypeScript（MCP server 与证据脚本共用）。
 *
 * 两件事：
 * 1. 版本闸门：`module.registerHooks` + 类型剥离要求 Node ≥ 22.15；
 * 2. 解析钩子：把 TS 风格的无扩展名相对导入（`./types`）补成 `.ts` / `/index.ts`。
 *
 * 副作用式模块：import 即注册。只影响本进程，不写任何配置。
 */
import { registerHooks } from 'node:module'

if (typeof registerHooks !== 'function') {
  process.stderr.write(
    '[cunlian-mcp] 需要 Node.js >= 22.15（module.registerHooks + 类型剥离），当前 ' +
      `${process.version}。\n`,
  )
  process.exit(1)
}

const EXTENSIONS = ['.ts', '/index.ts']

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      const relative = specifier.startsWith('.') || specifier.startsWith('/')
      if (!relative) throw error
      for (const suffix of EXTENSIONS) {
        try {
          return nextResolve(`${specifier}${suffix}`, context)
        } catch {
          // 尝试下一个后缀；全部失败时抛原始错误。
        }
      }
      throw error
    }
  },
})
