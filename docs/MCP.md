# MCP 入口：让别人家的 agent 用寸链内核

一句话：**只读与计算，写入必须回桌面端点确认。** MCP 入口只把确定性内核暴露出去，
不替代桌面端的保存/提交门禁。

```
mcp/
  server.mjs        # stdio 传输入口（node mcp/server.mjs 或 npm run mcp）
  main.ts           # JSON-RPC 2.0 帧、工具注册、错误映射
  tools/            # 每个工具一个文件（下面五个，没有空壳）
  lib/              # 参数校验、mm 文本、日志、隔套接线
  tests/            # 一致性与传输层用例（npm run test:mcp）
```

## 五个工具

| 工具 | 输入 | 输出 | 走的同一份内核 |
|---|---|---|---|
| `read_taskbook` | PDF 绝对路径、可选页范围 | 候选（kind/符号/值 q/单位/出处{页,选区,原文}）+ 阻塞项（原因码 + 人话） | `buildExtractionDraft` + `isProvenanceCompleteness` |
| `calc_chain` | `parameters`（内径/外径/长度 q）**或** `terms`（符号、基本尺寸 q、上下偏差 q、增/减环）+ 可选 target | 封闭环 C（q + mm）、极值上下限、公差、组成环清单 | `computeChange` → `calculateChain`（`src/domain/calculate.ts`） |
| `check_requirement` | C（q）、可选 Cmax（q）、下限 q、上限 q、含边界标志 | `satisfied` / `exceeded` + 下/上裕量（q + mm）+ 原因码 | `closedIntervalVerdict`（服务端条款判定同一实现） |
| `render_drawing` | 隔套三参数（mm 文本）、`svg`/`dxf`、目标目录绝对路径 | 真实文件路径、字节数、SHA-256、「用户输入，无外部原文件」标记 | `buildSpacerDrawing` + `renderDrawingSvg` / `buildDxfDocument` |
| `describe_project` | `.cunlian` 绝对路径 | 正式版本、三参数、组成环、活动条款、出处清单 | `decodeProjectFile` + `isProvenanceCompleteness` |

所有数值都带两种写法：整数 `q`（1 q = 0.0001 mm）与 mm 文本（由内核 `formatMm` 生成）。
`terms`/`parameters` 的数值全部标注为「用户输入」，不伪造文件出处。

**没有的工具**：保存项目、提交版本、改参数落盘、删除、导出到系统保存框、调用模型。
这些只能在桌面端由人点击完成。

## 启动

要求 Node.js ≥ 22.15（本机实测 v26.12；入口用 Node 内置的类型剥离 + 一个解析钩子
直接执行 `src/` 下的 TypeScript，不生成第二份 JS 副本，也没有原生依赖）。

```bash
cd /path/to/staff
npm run mcp            # = node mcp/server.mjs，stdio 模式，等客户端发帧
npm run test:mcp       # 22 条用例：一致性 / 协议 / 工具边界 / 幂等
npm run mcp:smoke      # 用真实子进程跑五个工具，打印摘要与幂等结果
```

`stdout` 只有 JSON-RPC 帧；日志一律写 `stderr`（`CUN_LIAN_MCP_VERBOSE=1` 可打开调试日志）。

## 客户端配置

### Claude Code

项目根目录 `.mcp.json`（把路径换成你自己的仓库绝对路径）：

```json
{
  "mcpServers": {
    "cunlian": {
      "command": "node",
      "args": ["/Users/you/DSH/staff/mcp/server.mjs"]
    }
  }
}
```

或命令行注册：

```bash
claude mcp add cunlian -- node /Users/you/DSH/staff/mcp/server.mjs
```

### Codex CLI

`~/.codex/config.toml`：

```toml
[mcp_servers.cunlian]
command = "node"
args = ["/Users/you/DSH/staff/mcp/server.mjs"]
```

两者都通过 stdio 启动同一份 `mcp/server.mjs`；不发布 npm 包（`package.json` 保持
`"private": true`），先给源码 + 配置。

## 调用示例

```jsonc
// calc_chain：隔套长度 12.05 mm（= 120500 q）
{ "parameters": { "innerDiameterQ": 200000, "outerDiameterQ": 320000, "lengthQ": 120500 } }
// → result: { nominalQ: 1500, minQ: 1000, maxQ: 2000, toleranceQ: 1000, ... }

// check_requirement：C=[0.1000, 0.2000] 对条款 [0.1000, 0.3000]
{ "cQ": 1000, "cMaxQ": 2000, "lowerQ": 1000, "upperQ": 3000, "inclusive": true }
// → status: "satisfied", margins.marginQ: 0
```

边界语义：默认闭区间，`inclusive: false` 时严格不等；`marginQ` 取最紧的一侧
（下/上裕量取小），可能为负。

## 与桌面端一致性的证据

`npm run test:mcp` 里的四组判据值（12.00 / 12.04 / 12.05 / 12.10）不是手算常量：
测试先走产品路径 `createRequirementProject → computeCandidateRequirementCheck`
得到服务端内核结果，再把同一组参数交给 MCP `calc_chain`/`check_requirement`，
逐项比较 `nominalQ / minQ / maxQ / lowerDeviationQ / upperDeviationQ / toleranceQ`
与下/上裕量，不相等即失败。运行日志与调用帧见
`docs/evidence/mcp-entry/`。

## 能力边界

- 只支持带文本层的 PDF（不 OCR）；一次最多读 200 页，默认从起始页起 100 页。
- `calc_chain` 的 `parameters` 模式只代表内置隔套三参数链（主进程 `chain-demo` 模板）；
  任意链请用 `terms`。
- `render_drawing` 只生成隔套模板（A4 SVG / DXF R12 / DXF 2000），不做 PDF 打印。
- 不联网、不读密钥、不调用模型；`describe_project` 只解码与读取，不重新判定条款。
