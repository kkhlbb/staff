# 寸链（Cunlian）· 机械制图与三维装配公差 Agent 工作台

> **最新版本**：[`v1.0.3`](https://github.com/kkhlbb/staff/releases/tag/v1.0.3)（[Latest Release](https://github.com/kkhlbb/staff/releases/latest)）｜**实测基准**：[`Cunlian-Bench v1`：25 PASS / 4 FAIL / 4 SKIP](docs/BENCHMARK.md#cunlian-bench-v1-全链路实测成绩单)
> **技术架构**：Electron + React + TypeScript + Open CASCADE 7.8.1 Unified XCAF WASM
> **开源许可**：MIT（Open CASCADE LGPL-2.1-only + OCCT Exception 与第三方组件许可见 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)）

**寸链**是一个面向机械设计师与公差工程师的**桌面 + 云端双模**可审计制图与三维装配公差分析工作台：**把零件任务书 PDF、STEP 装配模型与工程约束交给本地 Agent（MCP）或云端 AgentArts / REST 服务，寸链基于确定性几何与物理内核完成三维构形、二维正投影出图、10 类 GD&T 形位公差与柔性装配仿真，并输出离线可审计报告；任何写入授权、接管与正式版本提交都必须由人确认，零静默改图。**

---

## 一、核心能力（`v1.0.3`）

| 能力领域 | `v1.0.3` 实装能力 |
|---|---|
| **统一 OCCT 7.8.1 XCAF WASM 几何内核** | 单一统一 `cunlian_occt.wasm`（Open CASCADE 7.8.1，LGPL-2.1 + OCCT Exception，支持动态替换与完整源码/SBOM 溯源），覆盖 STEP AP214/AP203 装配导入、XCAF 装配树与特征提取、三维构形、**2D HLR 矢量工程图**与 AP214 STEP / SVG / DXF / PDF 导出，内置 Three.js 真 3D 拾取。 |
| **10 类 GD&T 6-DOF 小位移旋量（SDT）与柔性形变公差仿真** | 支持 3-2-1 基准参考系（DRF A/B/C）、MMC/LMC 实体补偿与共享基准偏移（Datum Shift），覆盖 **10 类 GD&T**：位置度、平行度、垂直度、平面度、同轴度、轮廓度（含不等双边 `UZ`）、圆跳动、全跳动、圆柱度、复合位置度。<br>原生耦合 **4 类解析柔性模型**（轴向压紧回弹、Kirchhoff 薄板压装变形、Euler–Bernoulli 悬臂/简支梁弯曲、热膨胀/双层热翘曲）与 **MIC 刚度/影响系数矩阵** 批量评估（+0 MB 内置 FEA 二进制），支持 CalculiX / Code_Aster / ANSYS / Abaqus 外置 FEA Sidecar 协议与 **3D 变形云图动画**（刚性 vs 柔性 Cp/Cpk/PPM 对比）。 |
| **AI 装配配合关系草稿与人机确认闭环** | 基于装配几何特征自动生成配合关系草稿（面接触、同轴、浮动间隙等），经 SE(3) 求解器执行收敛性与欠约束诊断；**零静默改图**——必需条款未通过严禁提交正式版，所有写入授权、接管与正式提交均须人工确认并校验修订指纹（`checksetFingerprint`）。 |
| **离线工程审计报告（HTML / PDF / CSV / JSON）** | 一键导出四格式自包含离线报告（零外部 CDN/字体依赖），内置 `EvidenceRef` 完整溯源、`appVersion` 版本标识、`projectId`、`revision`、`checksetFingerprint`、确定性随机种子 `seed`、SHA-256 摘要及 GD&T/柔性贡献度图表；桌面 IPC、MCP（`export_simulation_report`）与 Cloud REST 全链路同源一致。 |
| **双模部署：桌面端 + 云端 / AgentArts** | **桌面端**：一键检测并配置 Claude Code / Codex / Claude Desktop / Cursor / Windsurf 的 `cunlian-local` stdio MCP 桥接 + 10 家 OpenAI 兼容内置模型 API 预设。<br>**云端 / AgentArts**：支持 Streamable HTTP MCP、OpenAPI REST、写入租约（Writer Lease）、Webhook 签名重试与只读 Web 审查台（`cloud/web`）；默认 `FEATURE_3D_ASSEMBLY_M1=false` 保持基线兼容，开启 `FEATURE_3D_ASSEMBLY_M1=true` 解锁完整 3D + GD&T + 柔性 + 报告能力。 |
| **旧项目兼容与可回退工作台** | 完整兼容旧版 `.cunlian` 隔套一维整数 `q`（`1q = 0.0001 mm`）尺寸链项目与安装板任务书工作流，顶栏支持随时回切旧工作台（`#/desktop-legacy`）。 |

---

## 二、权威基准实测（Cunlian-Bench v1）

完整评测口径、逐项状态、实测缺陷与数据归属见 [`docs/BENCHMARK.md`](docs/BENCHMARK.md)，机器可读逐项指标见 [`docs/benchmarks/cunlian-bench-v1-report.json`](docs/benchmarks/cunlian-bench-v1-report.json)。

- **External 模式总成绩（`v1.0.2`）**：**`25 PASS / 4 FAIL / 4 SKIP`**（共 33 项；较 `v1.0.1` 的 `19 PASS / 10 FAIL / 4 SKIP` 提升 **+6 PASS**，且 `benchmarks/` 目录零改动；冷缓存离线模式 `18 PASS / 1 FAIL / 14 SKIP`）。
- **测试环境与口径**：产品版本 `1.0.2`（实测源码 SHA `23499df`），Apple M4（10 逻辑核心、16 GiB、macOS arm64、Node `v26.12.1`），固定随机种子 `20261126`，统计仿真 `50,000` 样本。

| 评测套件 | External 结果 (PASS/FAIL/SKIP) | 关键实测指标（严格对照 `cunlian-bench-v1-report.json`） |
|---|---:|---|
| **Suite A · NIST STEP 导入与 HLR** | `8 / 4 / 0` | NIST STEP 导入 **`10/10`（100%）**、三视图 HLR 投影 **`10/10`（100%）**；导入耗时 p50 / p95 **`733.82 / 1458.85 ms`**，HLR 耗时 p50 / p95 **`388.18 / 2394.78 ms`**；本地双件 XCAF 夹具（`A3-LOCAL-XCAF`）与 10 轮加载/释放内存门禁（`A5`）均 PASS。 |
| **Suite B · AI 装配配合草稿与 SE(3) 求解** | `5 / 0 / 1` | Precision **`100%`** / Recall **`100%`** / F1 **`100%`**（`TP/FP/FN = 31/0/0`），求解收敛率 **`100%`**，欠约束分类准确率 **`100%`**，剩余自由度误差全 **`0`**，平均求解耗时 **`2.05 ms`**。 |
| **Suite C · 公差求解精度与性能（10 类 GD&T）** | `6 / 0 / 0` | 轴向极值误差 **`0 q`**（50k MC vs RSS 相对误差 `0.27%`）；MMC 补偿与共享基准偏移相对误差 `0.0062%`；同轴度/跳动最大相对误差 `0.00028%`（序违例 `0`）；不等轮廓度相对误差 `0.055%`；50,000 样本 3D 全算 **`642.27 ms`**，MMC / RFS 增量 What-If **`3.21 / 2.59 ms`**。 |
| **Suite D · 柔性形变仿真与 MIC 矩阵** | `4 / 0 / 1` | 轴向压紧、悬臂/简支梁弯曲、热膨胀/双层热翘曲解析对比最大相对误差 **`< 1e-15`**（轴向 `0`、悬臂梁 `1.25e-16`、热弯曲 `2.54e-16`）；MIC 矩阵最大相对误差 **`0`**，`16×6`（50,000 样本）批处理 **`7.73 ms`**，4 类柔性 + 10 类 GD&T 全耦合 **`874.11 ms`**。 |
| **Suite E · 离线报告审计与工程安全合规** | `2 / 0 / 2` | `E3` 退化基准 / 非法修饰符 / 写入租约冲突 / 过期指纹提交拦截全 PASS；`E4` 自动化校验覆盖 HTML / CSV / JSON 三格式 `EvidenceRef` 与审计字段 **`3/3`**（产品导出四格式 HTML / PDF / CSV / JSON 均内置 `EvidenceRef` 与 `appVersion`），12 条报告结论按种子精确复现零偏差。 |

> **诚实说明（剩余 FAIL 与 SKIP 原因）**
> - **4 项 FAIL（`A3-FTC-07/08/09/10`）**：NIST 官方这 4 个 FTC STEP 源文件本身为单零件文件（`assemblyOccurrences = 0`），不满足多件装配门禁 `≥ 2` occurrence 的阈值；4 个文件均已成功导入实体并完成三视图投影（NIST 导入 `10/10`、投影 `10/10`），属外部测试数据特性而非导入失败，本地双件 XCAF 夹具（`A3-LOCAL-XCAF`）已 PASS。
> - **4 项 SKIP**：`B-FUSION360`（缺少符合许可且带固定校验和的研究子集）、`D4`（四角夹紧单调性已执行，缺 CalculiX 与独立参考位移场）、`E1`（缺 6 份外部真 PDF，不以历史数据顶替）、`E2`（关闭 `FEATURE_3D_ASSEMBLY_M1` 时云端按预期返回 `FEATURE_DISABLED`，开启态数值零偏差）。

**本地一行复现**（需 Node.js 20+）：

```bash
# External 模式（自动下载并按 SHA-256 校验 NIST 样本）
npm run bench:v1:external -- --out /tmp/cunlian-bench-v1-external.json

# 或冷缓存离线模式
npm run bench:v1 -- --out /tmp/cunlian-bench-v1-offline.json
```

---

## 三、下载与体验（`v1.0.3`）

前往 **[GitHub Releases `v1.0.3`](https://github.com/kkhlbb/staff/releases/tag/v1.0.3)** 或 **[Latest Release](https://github.com/kkhlbb/staff/releases/latest)** 下载对应平台安装包，并对照 `SHA256SUMS.txt` 校验文件完整性：

| 平台 | 发布包 | 说明 |
|---|---|---|
| **macOS (Apple Silicon / arm64)** | `cunlian-v1.0.3-macOS-arm64.zip` | 解压拖入 `/Applications` 使用 |
| **Windows x64（安装程序）** | `cunlian-v1.0.3-windows-x64-setup.exe` | NSIS 每用户安装程序，内置 Windows 命名管道与 `cunlian-mcp.cmd` 桥接 |
| **Windows x64（便携版）** | `cunlian-v1.0.3-windows-x64.zip` | 免安装解压即用 |
| **校验清单** | `SHA256SUMS.txt` | 所有发布包 SHA-256 校验和 |

### 签名与首次启动说明

- **macOS arm64**：当前为 ad-hoc 签名、未公证；下载解压后首次打开若遇 Gatekeeper 提示，可执行：
  ```bash
  xattr -dr com.apple.quarantine /Applications/寸链.app
  ```
- **Windows x64**：当前社区版未附商业代码签名，首次下载运行前请先对照 `SHA256SUMS.txt` 校验完整性：
  ```cmd
  certutil -hashfile cunlian-v1.0.3-windows-x64-setup.exe SHA256
  ```
  校验一致后，若遇 Windows SmartScreen 拦截提示，点击「更多信息」→「仍要运行」（或直接使用免安装 `.zip`）。如需配置 Authenticode 代码签名（SignPath.io 开源免费 / Azure Trusted Signing / 本地 PFX），详见 [`docs/windows-code-signing.md`](docs/windows-code-signing.md)。

---

## 四、Agent 权限与安全边界

- **本地 & 云端 MCP 工具**：涵盖项目授权与写入租约（`capabilities`、`authorizeProject`、`acquireWriter`、`takeOverWriter`、`revokeWriter`、`readWriterContext`）、草稿与尺寸链计算（`stageChange`、`moveRightHoleX`、`calc_chain`、`check_requirement`、`render_drawing`、`read_taskbook`、`describe_project`）、三维 GD&T 与柔性分析（`stage_datum`、`stage_gdt`、`analyze_gdt_stackup`、`stage_physics`、`import_mic_matrix`、`analyze_compliant_stackup`）及离线审计报告（`export_simulation_report`）。
- **硬架构边界**：模型不直接算数、不自行判定合规、不执行任意代码、拿不到主进程或人工签发的正式提交授权；写入授权、接管与正式提交均须人工确认并校验文件绑定与修订指纹。详见 [`ADR-001`](docs/adr/ADR-001-证据模型.md)。

---

## 五、本地验证与构建

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

# 生产构建与多平台打包
npm run build
npx vite build --config cloud/web/vite.config.ts
npm run package:desktop -- --arch=arm64                 # macOS arm64
npm run package:desktop -- --platform=win32 --arch=x64  # Windows x64
```

---

## 六、数据与隐私

- 几何构形、STEP XCAF 导入/导出、二维投影、10 类 GD&T 与柔性装配仿真、HTML/PDF/CSV/JSON 报告与 SVG/DXF 渲染全部在**本机完成，不联网**。
- 项目存档保存在你指定的 `.cunlian` 文件（ZIP：项目数据、来源附件与 MIC 矩阵原始字节、版本、事件日志与快照）。
- 唯一外发网络请求为你主动配置的模型 API 或自托管云端实例；密钥经 Electron `safeStorage` / 系统钥匙串加密保存，明文不落盘。

---

## 七、仓库目录结构

```text
src/core/solver/              3D 装配求解器、10 类 GD&T 引擎、4 类解析柔性模型与 MIC 批量评估器
src/core/geometry/            统一 XCAF OCCT WASM 装配几何提取与构形 worker
src/report/                   离线 HTML/PDF/CSV/JSON 仿真审计报告引擎
src/transport/                桌面 IPC / 云端 HTTP 双模统一传输层
src/workspace/project-agent/  主工作台（双入口向导、3D 热力图/GD&T 框格、2D SVG 画布与报告导出）
desktop/                      Electron 主进程、Preload 受控桥接与本地 MCP 端点
cloud/                        Cloud / AgentArts Streamable HTTP MCP、OpenAPI REST 服务与只读审查 Web UI
mcp/                          本地桥接 cunlian-local 与只读/计算 MCP 服务
benchmarks/                   Cunlian-Bench v1 自动化基准测试套件
docs/                         架构决策（ADR）、基准成绩单（BENCHMARK）、MIC/FEA 插件协议与验收文档
```
