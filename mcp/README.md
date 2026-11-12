# 寸链 MCP 入口（源码）

**只读与计算，写入必须回桌面端点确认。**

- 启动：`node mcp/server.mjs`（= `npm run mcp`），stdio JSON-RPC 2.0。
- 五个工具：`read_taskbook` / `calc_chain` / `check_requirement` / `render_drawing` / `describe_project`。
- 客户端配置、输入示例与边界：见 [`../docs/MCP.md`](../docs/MCP.md)。
- 不发布 npm（`package.json` 保持 `"private": true`），只给源码 + 配置示例。

```
mcp/
  server.mjs    # 入口：注册 TS 解析钩子后启动 main.ts
  main.ts       # initialize / tools/list / tools/call；stdout 只输出 JSON-RPC 帧
  tools/        # 五个工具，各一个文件；计算全部转调 src/ 下的既有内核
  lib/          # 参数校验、mm 文本、stderr 日志、隔套参数接线
  tests/        # npm run test:mcp（一致性 / 协议 / 工具边界 / 幂等）
```

为什么入口能直接跑 TypeScript：Node ≥ 22.15 自带类型剥离，`mcp/server.mjs`
用 `module.registerHooks` 把 TS 风格的无扩展名相对导入补成 `.ts`。因此仓库里
**只有一份实现**（`src/domain/calculate.ts` 等），MCP 不复制算法、也不提交生成产物。
