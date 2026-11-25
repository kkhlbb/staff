# 寸链 · 机械制图 Agent 工作台

> **版本**：`v0.5.0-beta`（机械制图 Agent 重构版）｜**架构**：Electron + React + TypeScript + Open CASCADE WASM  
> **许可**：MIT（第三方组件与字体许可见 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)）

**寸链**是一个面向机械设计师的本地桌面制图工作台：**把带文本层的零件任务书 PDF 交给常用的本地 Agent（MCP）或内置模型 API，寸链按已确认的尺寸和约束生成可修改的三维实体、二维正投影图纸与多维检查记录，在桌面直接并排展示。**

它不是通用 CAD，也不是通用公差仿真器。它专注**一条窄而可追责的工程闭环**——支持持续修改同一个有工程依据的项目、失败后恢复与次日重开；**任何写入授权、接管、正式版本提交与导出都必须由人在桌面端确认。**

---

## 一、核心能力（`v0.5.0-beta`）

| 能力 | 当前实现 |
|---|---|
| **双入口 Agent 互联** | **1) 外置本地 Agent（标准 MCP stdio）**：随包提供 `cunlian-local` 桥接（导出标准 `mcpServers` JSON，冷启动唤起桌面、同 UID 本地通道），兼容 Claude Code / Claude Desktop / Codex / Cursor / Windsurf / Orca / DSH 等标准 MCP 客户端；同时保留原 `mcp/server.mjs` 5 个只读/计算工具。<br>**2) 内置模型 API（OpenAI 兼容协议）**：支持 DeepSeek、OpenAI、兼容网关及本机回环 `127.0.0.1`（Ollama / vLLM / LM Studio）；强制通过真实只读工具往返探针（`m1_connection_probe`）后才解锁建模对话。 |
| **无手动参数表的主工作台** | 主流程移除手动参数表、尺寸滑块与坐标编辑器。中央画布内置 **Three.js 真 3D 网格拾取**与 **真 2D SVG 矢量图纸**（主/俯/侧视、实线/圆/隐藏虚线与特征绑定标注），支持模型 / 图纸 / 并排三视图与窄屏标签降级、特征 ↔ 标注双向高亮、连续修改保留 3D 视角与 2D 平移缩放。 |
| **精确几何与多维检查** | 基于 **OCCT WASM（Replicad OpenCascade.js）** 在可取消独立 worker 中构形与投影；覆盖矩形安装板 + 贯穿圆孔 + 平行参考盖板，并完整保留旧版隔套 + 一维整数 `q`（`1q = 0.0001 mm`）极值尺寸链。<br>支持：**一维尺寸链极值**、**二维轴向孔边距极值**、**三维刚体变换（含绕轴旋转 90°）平行面间隙**、**固定姿态接触 / 干涉 / 间隙判定**，以及**具名持久引用失效检测与显式重绑**。 |
| **异步出图、乱序守卫与人机确认闭环** | 模型与图纸异步独立生成；图纸失败时保留上一有效版本并明确标明版本号，支持单步重试；同修订指纹对齐后自动并排展示。每项目单写入方，支持原生接管并撤销旧写入租约；必需条款未通过严禁提交正式版，通过后经绑定草稿与检查集指纹的一次性原生确认原子写入。 |
| **旧项目兼容与迁移** | 打开旧版 `.cunlian` 隔套项目时严格保留原件，生成迁移差异报告（列出未解释旧字段与受限操作），既有 12.00 / 12.04 / 12.10 / 12.05 尺寸链回归与独立未提交草稿保持一致；顶部栏提供「返回旧工作台」（`#/desktop-legacy`）随时回切。 |

---

## 二、Agent 权限与安全边界

- **外置 `cunlian-local` MCP 工具（10 个）**：`capabilities`、`authorizeProject`、`getContext`、`getExternalActivities`、`acquireWriter`、`takeOverWriter`、`readWriterContext`、`stageChange`、`revokeWriter`、`moveRightHoleX`。
  - 安装板右孔位移：在桌面授权项目并取得写入权后，用 `readWriterContext` 读取 `baseRevision` 和 `mountingPlateDraftRevision`，再传入 `projectId`、`baseRevision`、`expectedDraftRevision`、`idempotencyKey` 和整数 `deltaQ`（+1 mm 为 `10000`）。成功返回草稿修订和构建任务 ID，正式版本须在桌面确认提交。
- **原 `mcp/server.mjs` 只读/计算工具（5 个）**：`read_taskbook`、`calc_chain`、`check_requirement`、`render_drawing`、`describe_project`。
- **内置模型对话工具**：`m1_connection_probe`（只读探针）、`m1_stage_spacer`（隔套草稿）、`m2_move_right_hole_x`（安装板右孔沿 X 轴位移）。
- **硬架构边界**：模型不直接算数、不自行判定合规、不执行任意代码、拿不到主进程签发的正式提交授权；写入授权、接管与正式提交均由 Electron 主进程原生弹窗确认并校验文件绑定与代际。详见 [`ADR-001`](docs/adr/ADR-001-证据模型.md)。

---

## 三、能力边界与已知限制

- **零件与分析范围**：当前覆盖「矩形板件拉伸 + Z 向贯穿圆孔 + 平行参考盖板」与「隔套 + 一维轴向尺寸链」。**不支持**自由曲面、任意装配运动、完整 GD&T / 形位公差、扫描件自动 OCR、DOCX、原生 DWG。
- **互联协议范围**：
  - 外置 MCP 仅限本机同用户 stdio 桥接，不支持远程公网 Streamable HTTP / SSE；第三方成品客户端自动改写配置未实现（需复制 `mcpConfigJson` 填入客户端）。
  - 内置 API 仅实现 OpenAI 兼容协议（`chat/completions` + `tools`）；Anthropic / Gemini 原生接口需通过 OpenAI 兼容网关接入。
- **平台与签名**：
  - **macOS arm64**：ad-hoc 签名、未公证；下载后首次打开若遇 Gatekeeper 拦截，可执行：
    ```bash
    xattr -dr com.apple.quarantine /Applications/寸链.app
    ```
  - **Windows x64**：随 `v0.5.0-beta` 提供 `win32-x64` 解压即用包（本地桥接采用 Windows 命名管道与 `cunlian-mcp.cmd`），未做代码签名，Windows 真机实测持续完善中。

---

## 四、本地验证与构建

需要 Node.js 20+（推荐 22+）。

```bash
npm ci

# 代码与类型检查
npm run lint
npm run typecheck
npm run typecheck:desktop

# 自动化测试套件
npm test                 # 前端与工作台全量单测（含 A01–A12 前端验收走查）
npm run test:mcp         # MCP stdio 协议回归
npm run test:desktop     # 主进程 M1/M2/M3 生命周期、几何引擎与兼容回归
node --test desktop/tests/projectAgentM0.node.mjs

# 生产构建与打包
npm run build
npm run package:desktop -- --arch=arm64                 # macOS arm64
npm run package:desktop -- --platform=win32 --arch=x64  # Windows x64
```

---

## 五、数据与隐私

- 几何构形、二维投影、尺寸链与多维检查、PDF/SVG/DXF 渲染全部在**本机完成，不联网**。
- 项目存档保存在你指定的 `.cunlian` 文件（ZIP：项目数据、来源附件原始字节、版本、事件日志与快照）。
- 唯一外发网络请求为你主动配置的 **模型 API**；密钥经 Electron `safeStorage` / 系统钥匙串加密保存，日志、响应与项目存档严格脱敏，明文不落盘。

---

## 六、仓库目录结构

```text
src/workspace/project-agent/  重构版主工作台（双入口向导、3D 网格与 2D SVG 画布、检查/来源定位、完成视图与迁移横幅）
src/domain/                   一维整数 q 尺寸链内核
src/document-extraction/      任务书 PDF 文本提取、切块与出处校验
src/drawing/                  工程图 SVG / PDF / DXF（R12 & 2000）渲染
desktop/main/project-agent/   主进程本地授权、单写入方事务、本机 MCP 端点、内置模型 API、M2 几何与投影引擎、M3 迁移与原子提交
desktop/shared/project-agent/ 前后端共享 M0–M3 契约与事件 Schema
desktop/preload/              Electron Preload 受控桥接（19 项重构工作台接口 + 旧版兼容接口）
mcp/                          随包本地桥接 cunlian-local 与原只读 MCP 服务 server.mjs
docs/                         架构决策（ADR）、真实文档基准（BENCHMARK）与 M0–M3 / 合流验收报告
```
