# 寸链 · 机械制图与三维装配公差 Agent 工作台

> **版本**：`v1.0.1`（GA 正式版）｜**架构**：Electron + React + TypeScript + Open CASCADE 7.8.1 Unified XCAF WASM
> **许可**：MIT（Open CASCADE LGPL-2.1-only + OCCT Exception 与第三方组件许可见 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)）

**寸链**是一个面向机械设计师与工程团队的**桌面 + 云端双模**可审计制图与三维装配公差分析工作台：**把零件任务书 PDF、STEP 装配模型与工程约束交给本地 Agent（MCP）或云端 AgentArts / REST 服务，寸链基于确定性几何与物理内核完成三维构形、二维正投影出图、10 类 GD&T 形位公差与柔性装配仿真，并输出离线可审计报告；任何写入授权、接管与正式版本提交都必须由人确认。**

---

## 一、核心能力（`v1.0.1` GA）

| 能力领域 | `v1.0.1` GA 正式版实现 |
|---|---|
| **3D 装配与统一 XCAF OCCT 内核** | 单一统一 `cunlian_occt.wasm`（Open CASCADE 7.8.1，LGPL 2.1 + OCCT Exception，支持动态替换与完整源码/SBOM 溯源），覆盖 STEP AP214/AP203 装配导入、XCAF 装配树与特征提取、三维构形、二维正投影与 AP214 STEP 导出，以及 Three.js 真 3D 拾取与真 2D SVG/DXF/PDF 工程图。 |
| **10 类三维 GD&T 形位公差引擎** | 支持 3-2-1 基准参考系（DRF A/B/C）、MMC/LMC 实体补偿与基准偏移（Datum Shift），完整覆盖 **10 类 GD&T**：位置度（Position）、平行度（Parallelism）、垂直度（Perpendicularity）、平面度（Flatness）、同轴度（Coaxiality）、**轮廓度（Profile of a Surface，含不等双边 `UZ`）**、**圆跳动（Circular Runout）**、**全跳动（Total Runout）**、**圆柱度（Cylindricity）**与**复合位置度（Composite Position）**；50,000 样本三维耦合仿真 `< 1s`（Apple M4），增量 What-If `< 260ms`。 |
| **4 类解析柔性力学模型 + MIC/FEA 插件协议** | 在不增加桌面安装包体积（**+0 MB 内置 FEA 二进制**）的前提下，原生耦合 **4 类解析柔性模型**（轴向压紧回弹、Kirchhoff 薄板压装变形、Euler–Bernoulli 悬臂/简支梁弯曲、热膨胀/双层热翘曲）与 **MIC 影响系数矩阵（Influence Coefficient Matrix）** 批量评估，支持 CalculiX / Code_Aster / ANSYS / Abaqus 外置 FEA Sidecar 协议、3D 顶点热力图与 60fps 变形动画、刚性 vs 柔性 Cp/Cpk/PPM 对比。 |
| **离线可审计仿真报告（HTML / PDF / CSV / JSON）** | 一键导出自包含离线报告（零外部 CDN/字体依赖），内置 `projectId`、`revision`、`checksetFingerprint`、确定性随机种子 `seed`、SHA-256 内容摘要、GD&T 与柔性贡献度图表、以及完整 `EvidenceRef` 证据附录；支持桌面 IPC、MCP（`export_simulation_report`）、Cloud REST（`POST /api/v1/projects/:id/report`）全链路一致导出。 |
| **双模部署：桌面端 + 云端 / AgentArts** | **桌面端**：一键检测并配置 Claude Code / Codex / Claude Desktop / Cursor / Windsurf 的 `cunlian-local` stdio MCP 桥接 + 10 家 OpenAI 兼容内置模型 API 预设。<br>**云端 / AgentArts**：支持 Streamable HTTP MCP、OpenAPI REST、写入租约（Writer Lease）、Webhook 签名重试与只读 Web 审查台（`cloud/web`）；默认 `FEATURE_3D_ASSEMBLY_M1=false` 保持竞赛基线 100% 兼容，开启 `FEATURE_3D_ASSEMBLY_M1=true` 解锁完整 3D + GD&T + 柔性 + 报告能力。详见 [`docs/cloud-deployment.md`](docs/cloud-deployment.md)。 |
| **人机确认闭环与旧项目兼容** | 必需条款未通过严禁提交正式版；通过后须经绑定草稿与 `checksetFingerprint` 的一次性人工确认原子写入 `.cunlian` 存档。完整兼容旧版隔套一维整数 `q`（`1q = 0.0001 mm`）尺寸链项目与安装板任务书工作流，顶栏支持随时回切旧工作台（`#/desktop-legacy`）。 |

---

## 二、Agent 权限与安全边界

- **本地 & 云端 MCP 工具**：涵盖项目授权与写入租约（`capabilities`、`authorizeProject`、`acquireWriter`、`takeOverWriter`、`revokeWriter`、`readWriterContext`）、草稿与尺寸链计算（`stageChange`、`moveRightHoleX`、`calc_chain`、`check_requirement`、`render_drawing`、`read_taskbook`、`describe_project`）、三维 GD&T 与柔性分析（`stage_datum`、`stage_gdt`、`analyze_gdt_stackup`、`stage_physics`、`import_mic_matrix`、`analyze_compliant_stackup`）及离线审计报告（`export_simulation_report`）。
- **硬架构边界**：模型不直接算数、不自行判定合规、不执行任意代码、拿不到主进程或人工签发的正式提交授权；写入授权、接管与正式提交均须人工确认并校验文件绑定与修订指纹。详见 [`ADR-001`](docs/adr/ADR-001-证据模型.md)。

---

## 三、平台安装包与签名说明

- **macOS arm64**（`cunlian-v1.0.1-macOS-arm64.zip`）：ad-hoc 签名、未公证；下载解压后首次打开若遇 Gatekeeper 提示，可执行：
  ```bash
  xattr -dr com.apple.quarantine /Applications/寸链.app
  ```
- **Windows x64**（`cunlian-v1.0.1-windows-x64.zip` 免安装版 & `cunlian-v1.0.1-windows-x64-setup.exe` NSIS 每用户安装程序）：内置 Windows 命名管道与 `cunlian-mcp.cmd` 本地桥接；当前社区版未附商业代码签名，首次下载运行前请先对照 `SHA256SUMS.txt` 校验完整性：
  ```cmd
  certutil -hashfile cunlian-v1.0.1-windows-x64-setup.exe SHA256
  ```
  校验一致后，若遇 Windows SmartScreen 拦截提示，点击「更多信息」→「仍要运行」（或直接使用免安装 `.zip`）。如需配置 Authenticode 代码签名（SignPath.io 开源免费 / Azure Trusted Signing / 本地 PFX），详见 [`docs/windows-code-signing.md`](docs/windows-code-signing.md)。

---

## 四、本地验证与构建

需要 Node.js 20+（推荐 22+）。

```bash
npm ci

# 代码、类型与 LGPL 2.1 / XCAF 合规门禁
npm run lint
npm run typecheck
npm run typecheck:desktop
npm run check:release:step

# 全量自动化测试套件
npx vitest run --pool=forks --maxWorkers=1
npm run test:desktop
npm run test:mcp
npm run test:cloud
npm run test:step-kernel
npm run test:step-license
node --import ./mcp/register-ts.mjs --test src/core/solver/test/*.node.test.mjs
node src/core/solver/test/advancedGdtBenchmark.mjs
npm run cloud:smoke

# 生产构建与三平台打包
npm run build
npx vite build --config cloud/web/vite.config.ts
npm run package:desktop -- --arch=arm64                 # macOS arm64
npm run package:desktop -- --platform=win32 --arch=x64  # Windows x64
```

---

## 五、数据与隐私

- 几何构形、STEP XCAF 导入/导出、二维投影、10 类 GD&T 与柔性装配仿真、HTML/PDF/CSV/JSON 报告与 SVG/DXF 渲染全部在**本机完成，不联网**。
- 项目存档保存在你指定的 `.cunlian` 文件（ZIP：项目数据、来源附件与 MIC 矩阵原始字节、版本、事件日志与快照）。
- 唯一外发网络请求为你主动配置的模型 API 或自托管云端实例；密钥经 Electron `safeStorage` / 系统钥匙串加密保存，明文不落盘。

---

## 六、仓库目录结构

```text
src/core/solver/              3D 装配求解器、10 类 GD&T 引擎、4 类解析柔性模型与 MIC 批量评估器
src/core/geometry/            统一 XCAF OCCT WASM 装配几何提取与构形 worker
src/report/                   离线 HTML/PDF/CSV/JSON 仿真审计报告引擎
src/transport/                桌面 IPC / 云端 HTTP 双模统一传输层
src/workspace/project-agent/  主工作台（双入口向导、3D 热力图/GD&T 框格、2D SVG 画布与报告导出）
desktop/                      Electron 主进程、Preload 受控桥接与本地 MCP 端点
cloud/                        Cloud / AgentArts Streamable HTTP MCP、OpenAPI REST 服务与只读审查 Web UI
mcp/                          本地桥接 cunlian-local 与只读/计算 MCP 服务
docs/                         架构决策（ADR）、云端部署指南、MIC/FEA 插件协议与验收文档
```
