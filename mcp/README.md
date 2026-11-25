# 寸链 MCP 入口（源码）

**只读与计算，写入必须回桌面端点确认。**

- 启动：`node mcp/server.mjs`（= `npm run mcp`），stdio JSON-RPC 2.0。
- 既有工具：`read_taskbook` / `calc_chain` / `check_requirement` / `render_drawing` / `describe_project`。
- 源码 stdio 另提供 `analyze_assembly_3d`，支持 `solve`、`simulate`、`suggest-mates`。
- 客户端配置、输入示例与边界：见 [`../docs/MCP.md`](../docs/MCP.md)。
- 不发布 npm（`package.json` 保持 `"private": true`），只给源码 + 配置示例。

```
mcp/
  server.mjs    # 入口：注册 TS 解析钩子后启动 main.ts
  main.ts       # initialize / tools/list / tools/call；stdout 只输出 JSON-RPC 帧
  tools/        # 只读与计算工具；共享 src/ 下的内核
  lib/          # 参数校验、mm 文本、stderr 日志、隔套参数接线
  tests/        # npm run test:mcp（一致性 / 协议 / 工具边界 / 幂等）
```

为什么入口能直接跑 TypeScript：Node ≥ 22.15 自带类型剥离，`mcp/server.mjs`
用 `module.registerHooks` 把 TS 风格的无扩展名相对导入补成 `.ts`。因此仓库里
**只有一份实现**（`src/domain/calculate.ts` 等），MCP 不复制算法、也不提交生成产物。


## 3D 装配

`analyze_assembly_3d` 接受 Schema 11 工程绝对路径 `path` 或内联 `assembly`，两者择一。例如 `{"operation":"solve","path":"/absolute/project.cunlian"}`。仿真需要 `parameters`，每项指定 `id`、`partId`、`featureId`、`dof` 和标准差及上下限。平移用 `sigmaQ`、`lowerQ`、`upperQ`，转动用 `sigmaRad`、`lowerRad`、`upperRad`。可传 `seed`、`samples`、`bins` 和以测量 ID 为键的 `limits`。草案操作可接收真实提取报告的 `candidates` 及按特征绑定的 `evidenceByFeature`。返回的草案需要人工确认。算法和输出口径见 [3D solver](../src/core/solver/README.md)。
