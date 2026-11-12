# MCP 通用入口：五个只读/计算工具 + 一致性证据

一句话：把确定性内核挂到 **MCP stdio** 上，任何 MCP client（Claude Code / Codex /
Inspector）都能读任务书、算尺寸链、判条款、出图、读项目。**只读与计算，写入必须回
桌面端点确认。**

| 项 | 值 |
|---|---|
| 基线 | `main = aacdab8` |
| 分支 | `agent/mcp-server`（从 aacdab8 切出；未合并、未推送、未删除） |
| 实现提交 | `0266d81`（`feat(mcp): stdio MCP 入口暴露五个只读/计算工具（计算走同一内核）`） |
| 证据提交 | 见 `git log --oneline aacdab8..HEAD` |
| 工具数 | **5**（`read_taskbook` / `calc_chain` / `check_requirement` / `render_drawing` / `describe_project`） |
| 新增用例 | `npm run test:mcp`：3 文件 / **22 用例** |
| 既有用例 | `npm test`：108 文件 / **1186 用例**（基线 1184 + 证据守卫自动为新增的 2 份证据 JSON 各加 1 条）；`npm run test:desktop`：**285 通过 / 17 跳过**（未变） |
| 真实客户端 | **MCP Inspector 2.15.0 CLI** 跑通 5/5（`logs/inspector-*.log`） |
| 一致性 | 四组判据值 q **逐项相等**（`consistency.json`） |
| 幂等 | 同输入 3 次独立进程，5/5 工具响应字节一致 |
| 变异 | **M29 红 → 绿**（`mutations/M29-red.log` / `M29-green-restored.log`） |

---

## 一、形态与红线

```
mcp/server.mjs      入口：registerHooks 补 .ts 后缀后启动 main.ts（Node ≥ 22.15）
mcp/main.ts         JSON-RPC 2.0：initialize / tools/list / tools/call；stdout 只有帧
mcp/tools/*.ts      五个工具，每个一个文件；只做参数校验与转调 src/ 内核
mcp/lib/*.ts        参数校验、mm 文本、stderr 日志、隔套参数→快照接线
mcp/tests/*.test.ts 一致性 / 协议 / 工具边界 / 幂等
docs/MCP.md         Claude Code 与 Codex 两种客户端配置 + 边界说明
```

**跑的是同一份 TypeScript**：Node 自带类型剥离 + 一个解析钩子，直接 import
`src/domain/calculate.ts`、`src/requirements/check.ts`、`src/drawing/dxfExport.ts` 等，
不生成也不提交第二份 JS/算法副本。

红线自查：

| 红线 | 落实方式 |
|---|---|
| 不暴露写操作 | 工具清单固定五个（`mcp/tests/tools.test.ts` 断言没有 write/save/commit/delete 类名字）；没有项目保存/提交/改参数落盘的工具 |
| 不碰密钥、不调模型 | 代码里没有 keychain/modelAdapter/API 调用；`describe_project` 只 `decodeProjectFile` |
| 不联网 | 没有 fetch/http/socket；只读本地 PDF/项目，`render_drawing` 只新增导出文件 |
| 不另写第二份算法 | 计算 `computeChange → calculateChain`；条款 `closedIntervalVerdict`；出处 `isProvenanceCompleteness`；出图 `buildSpacerDrawing` + `renderDrawingSvg` / `buildDxfDocument` |

`check_requirement` 与原服务端条款判定共用同一函数：本次把 `numericVerdict` 里的
闭区间比较抽成导出的 `closedIntervalVerdict`（`src/requirements/check.ts`），
`numericVerdict` 改为调用它；行为不变（既有 1184 用例全绿）。

## 二、真实客户端调用（MCP Inspector 2.15.0 CLI）

命令（在本仓库根执行；`--tool-arg` 的嵌套 JSON 由 Inspector 解析）：

```bash
npx -y @modelcontextprotocol/inspector@2.15.0 --cli node mcp/server.mjs --method tools/list
npx -y @modelcontextprotocol/inspector@2.15.0 --cli node mcp/server.mjs --method tools/call \
  --tool-name read_taskbook \
  --tool-arg pdfPath=/Users/aston/DSH/staff/docs/evidence/V3.5/fixtures/taskbook-2p.pdf \
  --tool-arg pageFrom=1 --tool-arg pageTo=2
npx -y @modelcontextprotocol/inspector@2.15.0 --cli node mcp/server.mjs --method tools/call \
  --tool-name calc_chain \
  --tool-arg 'parameters={"innerDiameterQ":200000,"outerDiameterQ":320000,"lengthQ":120000}'
npx -y @modelcontextprotocol/inspector@2.15.0 --cli node mcp/server.mjs --method tools/call \
  --tool-name check_requirement --tool-arg cQ=500 --tool-arg cMaxQ=1500 \
  --tool-arg lowerQ=1000 --tool-arg upperQ=3000
npx -y @modelcontextprotocol/inspector@2.15.0 --cli node mcp/server.mjs --method tools/call \
  --tool-name render_drawing \
  --tool-arg 'parameters={"innerDiameter":"20.00","outerDiameter":"32.00","length":"12.05"}' \
  --tool-arg format=dxf --tool-arg dxfVersion=2000 \
  --tool-arg outputDir=/Users/aston/DSH/staff/docs/evidence/mcp-entry/artifacts
npx -y @modelcontextprotocol/inspector@2.15.0 --cli node mcp/server.mjs --method tools/call \
  --tool-name describe_project \
  --tool-arg path=/Users/aston/DSH/staff/docs/evidence/v40-stage4/fixtures/a40-1204.cunlian
```

原始回执：`logs/inspector-tools-list.log`、`logs/inspector-read-taskbook.log`、
`logs/inspector-calc-chain.log`、`logs/inspector-check-requirement.log`、
`logs/inspector-render-drawing.log`、`logs/inspector-describe-project.log`。

| 工具 | 真实回执要点 |
|---|---|
| `read_taskbook` | `pageCount=2`，候选 1（kind=interval），阻塞项 0；每条数值带页/选区/原文出处 |
| `calc_chain` | `nominalQ=2000, minQ=1500, maxQ=2500, toleranceQ=1000` |
| `check_requirement` | `status="exceeded"`，`marginQ=-500`（−0.050 mm），`LOWER_VIOLATED` |
| `render_drawing` | 文件 `artifacts/spacer-i20.00-o32.00-l12.05-DXF-AC1015.dxf`，21239 字节，`sha256=3e20f273…541b`，`unprovenanced=true` |
| `describe_project` | `project-a`，参数 3、组成环 4、活动条款 `reqrev-1`（0.1000～0.3000）；只读 |

**真实客户端暴露的互操作问题（已修）**：Inspector CLI 按 schema 猜类型，把字符串枚举
`dxfVersion="2000"` 发成数字 `2000`，第一次 `render_drawing` 被拒
（`INVALID_ARGUMENTS: dxfVersion 只接受 r12 / 2000`）。修正：`mcp/lib/args.ts` 只对
“数字与字符串枚举项逐字相等”的情况做字符串化（`2000 → "2000"`），其它值照旧拒绝；
布尔同样只接受 `true/false` 字面量。修正后同一命令通过（见 `logs/inspector-render-drawing.log`）。

## 三、四组判据值：MCP 与服务端内核算出的 q 完全相等

服务端参照路径（产品真实代码）：`createRequirementProject`（已确认绑定 + 条款
0.1000～0.3000）→ `draftWithLength` → `computeCandidateRequirementCheck`
（内部 `computeChange → calculateChain`）。
MCP 路径：`calc_chain(parameters)` → `check_requirement`。

| 隔套长度 | 服务端 minQ / maxQ | MCP minQ / maxQ | 判定 | 最紧裕量 |
|---|---|---|---|---|
| 12.00 | 1500 / 2500 | 1500 / 2500 | satisfied（服务端 satisfied） | +500（+0.0500） |
| 12.04 | 1100 / 2100 | 1100 / 2100 | satisfied（服务端 satisfied） | +100（+0.0100） |
| 12.05 | 1000 / 2000 | 1000 / 2000 | satisfied（服务端 satisfied，边界相等） | 0（0.0000） |
| 12.10 | 500 / 1500 | 500 / 1500 | **exceeded**（服务端 unsatisfied） | −500（−0.0500） |

逐项比较的字段：`nominalQ / minQ / maxQ / lowerDeviationQ / upperDeviationQ /
toleranceQ` + 条款 `margins.lowerQ / margins.upperQ`。任何一项不等，用例即失败。
结构化结果：`consistency.json`；测试日志：`logs/test-mcp-green.log`（含四行
`{"length":…,"equal":true}`）。

## 四、幂等：同输入 3 次，输出字节一致

`node scripts/mcp-smoke.mjs --repeat 3`：**三次独立子进程**，每次 initialize →
tools/list → 五个 tools/call；按响应 `content[0].text` 取 SHA-256。

| 工具 | 唯一哈希数 | 字节一致 |
|---|---|---|
| read_taskbook | 1 | 是 |
| calc_chain | 1 | 是 |
| check_requirement | 1 | 是 |
| render_drawing | 1 | 是（同一路径、同一字节、同一 SHA-256） |
| describe_project | 1 | 是 |

摘要：`logs/stdio-summary.json`（`"byteIdentical": true` ×5）；完整帧：
`logs/stdio-frames.ndjson`；stderr：`logs/stdio-stderr.log`（0 字节）。
进程内 3 连跑也有一组用例（`mcp/tests/tools.test.ts`）。

## 五、M29：超限也返回 satisfied → 必须红

变异：`mcp/tools/check-requirement.ts` 把 `status` 写死为 `'satisfied'`、`satisfied: true`。

- 红：`npm run test:mcp` → **2 failed / 20 passed**，失败点
  `12.10 → expected 'satisfied' to be 'exceeded'` 与开区间边界用例。
  日志：`mutations/M29-red.log`。
- 恢复：还原后用同一命令 → **22 passed**。日志：`mutations/M29-green-restored.log`。

## 六、命令与结果（本机 macOS，Node v26.12.1）

| 命令 | 结果 |
|---|---|
| `npm test` | **1186 passed / 108 files**（22.15s；含证据守卫为 2 份新 JSON 自动生成的 2 条） |
| `npm run test:desktop` | **285 passed / 17 skipped**（7.91s） |
| `npm run test:mcp` | **22 passed / 3 files** |
| `npm run typecheck` | 通过（app + node + mcp 三个工程） |
| `npm run lint` | 通过（`eslint .`） |
| `npm run build` | 通过（built in 231ms） |
| `npm run package:desktop -- --arch=arm64` | **PASS**（app.asar + pdf.worker 运行时可加载） |

原始输出：`logs/npm-test.log`、`logs/npm-test-desktop.log`、`logs/npm-typecheck.log`、
`logs/npm-lint.log`、`logs/npm-build.log`。

**证据守卫抓到一次真问题（已修）**：第一次把冒烟摘要直接写成 JSON 时，
`src/test/evidenceRepro.test.ts` 报了 `absolute path`（`/Users/aston/…`）与
`unmarked UUID`（项目 revisionId）。修正：证据脚本改用仓库既有的规范序列化器
`scripts/evidence-json.ts` 的 `serializeEvidence`（机器路径转相对、生成 ID 标
`<generated>`），不另写清洗规则；随后 `npm test` 全绿。

## 七、未做 / 已知边界

- **未发布 npm**：`package.json` 保持 `"private": true`，只给源码 + 配置。
- **未在 Claude Code 里实跑**：本机没有 `claude` 可执行文件；改用 MCP Inspector
  2.15.0 CLI（真实 MCP client）跑通 5/5。本机装有 `codex`，但没有改动用户的
  `~/.codex/config.toml`（配置示例写在 `docs/MCP.md`）。
- **Node 要求**：`node mcp/server.mjs` 依赖 Node ≥ 22.15（`module.registerHooks` +
  类型剥离），本机 v26.12.1 实测。Node 18 不能直接跑（任务卡写的“Node 18+”未满足，
  这是事实差异，不粉饰）。
- `read_taskbook` 只支持文本层 PDF（不 OCR）；一次最多 200 页，默认最多 100 页。
- `calc_chain` 的 `parameters` 模式只对应内置隔套链（主进程 `chain-demo` 模板）；
  任意链用 `terms`。
- `render_drawing` 只出隔套模板（SVG / DXF R12 / DXF 2000），不出 PDF（打印依赖
  Electron，不在 MCP 里做）。
- `describe_project` 里的条款状态是文件记录的历史检查证据，读取时**不重新判定**。

## 八、文件索引

```
docs/MCP.md                                    客户端配置与边界
mcp/                                           MCP server + 五工具 + 用例
scripts/mcp-smoke.mjs                          真实子进程五工具冒烟/幂等
scripts/mcp-evidence.mjs                       证据后处理（consistency.json）
docs/evidence/mcp-entry/consistency.json       四组判据值 + 幂等摘要
docs/evidence/mcp-entry/logs/                  测试/客户端/幂等原始日志
docs/evidence/mcp-entry/mutations/             M29 红 → 绿
docs/evidence/mcp-entry/artifacts/             真实导出 DXF（21239 字节）
```
