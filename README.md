# 寸链 · 轴系轴向尺寸链工作台

一个 macOS 桌面应用（Electron + React + TypeScript）：**从机械任务书 PDF 里提取参数，用整数精度算出尺寸链，出 A4 工程图与 DXF，并允许用自然语言改图 —— 但任何保存、提交、导出都必须由人点头。**

它不是一个通用 CAD，也不是一个公差分析仿真器。它做的是**一条窄而完整的链路**，并且把"凭什么这么算"留在文件里。

许可 **MIT**。第三方组件与字体许可见 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)。

---

## 一、它到底能做什么

| 环节 | 现在能做到 | 证据 |
|---|---|---|
| **读任务书** | 带文本层的 PDF → 候选参数/组成环/公式/闭区间要求，每条带页、选区、原文片段 | 6 份真实文档 269 页：**138 候选 / 58 可确认 = 42.0%**，逐份原因码见 [`docs/BENCHMARK.md`](docs/BENCHMARK.md) |
| **建项目** | 人工逐条确认 → 生成隔套项目草稿 | 确认凭据只来自界面；请求里带 `confirmed: true` 一律不采信 |
| **算尺寸链** | 整数 `q`（1q = 0.0001 mm）极值法；`C = H − B1 − S − B2` | 内核不联网、不依赖浮点累加 |
| **判条款** | 结果落在任务书要求的闭区间内？超了多少？ | 12.00→`0.1500~0.2500` 满足；12.10→`0.0500~0.1500` 不满足 |
| **出图** | A4 横向工程图 → 矢量 PDF / SVG / **DXF（R12 + 2000）** | DXF 我在模型空间按真实尺寸输出，`$DWGCODEPAGE=ANSI_936` |
| **改图** | 一句话（"加厚 0.10"）→ 草稿 → 重算 → 复核 | 真实模型 **14/14** 条验收通过（DeepSeek） |
| **留痕** | 版本不可变、出处可追、提交时重算 | 授权只在主进程签发，模型拿不到 `approvalId` |

## 二、Agent 在这里做什么（以及不许做什么）

模型只有 **6 个工具**（`src/agent/toolSchemas.ts`）：

```
context   读项目/版本/草稿/条款     只读
confirmed 读已确认候选              只读
apply     候选 → 项目草稿           只产草稿
stage     改一个参数并重算          只产草稿，且只接受 内径/外径/长度
preview   重算图纸/区间/条款         只读
export    导出                     需用户点保存框
```

**它不能**：算数（内核算）、判合规（提交时主进程重算）、提交（`agentToolService.ts:280` 签发授权）、自己宣布成功（侧栏只显示工具回执）。

这条边界不是靠自觉，是架构关住的。设计理由见 [`ADR-001`](docs/adr/ADR-001-证据模型.md)。

## 三、能力边界（先说清，免得你白试）

**不支持**：扫描件 / 图片 PDF（只吃文本层）· DOCX · 形位公差与 GD&T · 统计公差（RSS/蒙特卡洛）· 多链联合求解 · 非回转体零件 · STEP 导出 · DWG · Windows

**只能在 隔套 + 一条一维轴向链 + 一条毫米闭区间 上工作。** 这不是路线图问题，是数据模型就这么窄。

**DXF 的实情（分两个版本，能力不一样）**：

- **R12（AC1009）保持现状**：单张纸、只有模型空间，实体白名单 `LINE/POLYLINE/CIRCLE/ARC/TEXT`；
  **没有 `DIMENSION` 实体**（尺寸是几何 + 文字，改图不会自动改数），也**没有 `LAYOUT`/`VIEWPORT`**（R12 没这些结构）。
  R12 的 TEXT 有 255 字节上限；GBK 表外字符直接报错。
- **2000（AC1015）有真图纸结构**：A3 横向 420×297 图幅，图框/标题栏/技术要求区在**图纸空间**，
  零件在**模型空间按 1:1 真实尺寸**，一个 `VIEWPORT` 把两者按比例（1:1 / 1:2 / 2:1 …）接起来；
  三条尺寸（长度 12.05、外径 ⌀32、内径 ⌀20）是**真 `DIMENSION` 实体**（`DIMSTYLE` 表 + 匿名几何块 `*D1/*D2/*D3`），
  数值来自参数快照的 q 换算，不是写死的文字。改 q 编号会跟着变。
  代价：文件结构复杂得多（`BLOCK_RECORD` 表、`LAYOUT` 对象、子类标记都得齐全），
  导入器的实测坑见 `docs/evidence/dxf-depth/research.md` §5。

**签名**：`.app` 是 ad-hoc 签名、未公证。自行构建可直接打开；下载来的会被 Gatekeeper 拦一次：

```bash
xattr -dr com.apple.quarantine /Applications/寸链.app
```

## 四、怎么验证我说的话

不信任何一句，跑命令：

```bash
npm install
npm test                 # 1138 用例 / 105 文件（证据 JSON 每份各带一条序列化守卫用例）
npm run test:desktop     # 278 用例（另 14 条真模型用例默认跳过，需密钥）
npm run typecheck && npm run lint && npm run build

# 真实文档度量（需自备 6 份 PDF，见 docs/BENCHMARK.md）
REAL_DOC_CORPUS=<目录> npm run metrics:real-docs
```

每个功能的证据都在 `docs/evidence/` 下，含**变异实验**：把实现改坏，用例必须变红，再改回来。

```bash
# 例：去掉出处校验 → 必须红
docs/evidence/evidence-ref/mutations/M02-red.log    # 3 failed / 45 passed
docs/evidence/evidence-ref/mutations/M02-green-restored.log  # 48 passed
```

## 五、构建桌面应用

```bash
npm run package:desktop -- --arch=arm64
# 产物：out/寸链-darwin-arm64/寸链.app（约 256 MB）
```

需要 Node.js 20+ 与 macOS。构建本机不需要 Apple 开发者账号。

## 六、数据与隐私

- 所有计算、渲染、PDF/DXF 生成都在本机完成，**不联网**
- 项目文件是你指定的 `.cunlian`（ZIP：项目、来源附件原始字节、版本、事件、快照）
- 唯一的外部调用是 **Agent 模型**，密钥存 macOS Keychain，明文不落盘；不配置模型时用离线假模型演示
- `package.json` 的 `"private": true` 只为防误 `npm publish`

## 七、仓库里有什么

```
src/domain/            尺寸链内核（整数 q、极值法）
src/document-extraction/  任务书提取（document-extractor-6）：规则、切块、出处校验
src/agent/             Agent 工具契约
src/drawing/           DrawingData → SVG / PDF / DXF
desktop/main/          主进程：授权签发、提交重算、导出端口
docs/adr/              架构决策（证据模型、入口与出处）
docs/evidence/         每批交付的度量、变异日志、截图
docs/BENCHMARK.md      真实文档度量体系与复现方式
```

## 八、已知未做

- 真实机械装配任务书样本：**一份都没有**（评测语料是公开论文与标准）
- 三维实体与 STEP：没有 B-rep，`three.js` 只是网格预览
- 校对—审核—批准三级签署、多用户、审计导出
- 自动更新、崩溃上报、Windows 构建

---

**这是一个作品，不是一个产品。** 它的价值在"每一步都能被验证、每个结论都有出处"，不在功能多少。如果你只想算一个尺寸链，Excel 或网页计算器够了。
