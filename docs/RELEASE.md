# 发布说明 · 寸链 0.4.0 beta（macOS / Apple 芯片）

本文件说明**未签名产物**的获取、校验与安装方式，以及这一版能做与不能做的事。
签名与公证**未做**，这是有意的：项目按开源自用发布，不为分发购买 Apple Developer 账号。

## 1 产物与校验

| 文件 | 大小 | SHA-256 |
|---|---|---|
| `寸链-v0.4.0-beta-macOS-arm64.zip` | 121,217,497 字节 | `27f53371a2fd6b29180761538e9da76f8a227d6d1ed26aae49cd7de3ad2d81ed` |

`CFBundleShortVersionString` = `0.4.0-beta`，arm64，未签名未公证（`adhoc, linker-signed`）。解压后 `.app` 约 258 MB。

下载后先校验，再解压：

```bash
shasum -a 256 寸链-v0.4.0-beta-macOS-arm64.zip
# 必须与上表一致；不一致就别用
```

## 2 安装（首次打开会被 Gatekeeper 拦，属预期）

1. Finder 里**右键 → 打开** → 再点一次「打开」；或
2. 系统设置 → 隐私与安全性 → 底部找到拦截提示 → **仍要打开**；或
3. 终端：

```bash
xattr -dr com.apple.quarantine /Applications/寸链.app
```

**自己从源码构建的产物不需要这一步。**

## 3 从源码构建（不需要开发者账号）

```bash
npm install
npm run package:desktop -- --arch=arm64
# 产物：out/寸链-darwin-arm64/寸链.app
```

需要 Node.js 20+。

## 4 这一版能做什么

### 4.1 从任务书建项目
- 带文本层的 PDF → 候选参数 / 组成环 / 公式 / 闭区间要求，每条带页、选区、原文片段
- 同一符号多处赋值 → 每处各一条候选、标「第 k/N 处」、同组只能确认一处、可撤销
- 人工逐条确认 → 生成隔套项目草稿 → 提交前重算 → 版本冻结
- **超过 100 页的文档自动切块**，单块失败不连坐，无文本层只标记该页

### 4.2 无任务书也能建（本期新增）
- 用对话把零件说出来：`createProject` / `setChain` / `setRequirement` / `setBinding`
- 每个数值的出处是「**用户输入**」，不是文件；条款区间**只能由用户给**，模型代填会被拒（`REQUIREMENT_MUST_BE_USER_GIVEN`）
- 无来源项目在**项目列表徽标 / 图纸标题栏 / DXF 文件头 / 文件名后缀 `-userinput`** 四处标记
- 提交前必须勾选「这些尺寸由我提供，无原文件可核对」

### 4.3 出图（本期加深）
- **DXF 2000（AC1015）**：A3 横向 420×297 图幅、图纸空间 `VIEWPORT`（1:1 / 1:2 / 2:1）、图框与标题栏、**真 `DIMENSION` 实体**（`DIMSTYLE` + 匿名几何块 `*D1/*D2/*D3`），数值来自 q 换算
- **DXF R12（AC1009）**：保持原样——单张、模型空间 1:1、`LINE/POLYLINE/CIRCLE/ARC/TEXT`，尺寸是「几何 + 文字」
- PDF / SVG 矢量输出，字体子集嵌入

### 4.4 被别人调用（本期新增）
- **MCP stdio 入口**（`npm run mcp`）：`read_taskbook` / `calc_chain` / `check_requirement` / `render_drawing` / `describe_project`
- 只读与计算，**不暴露任何写操作**；写入与提交必须回桌面端点确认
- 与服务端同一套内核：四组判据值（12.00 / 12.04 / 12.05 / 12.10）MCP 与桌面端算出的 q 完全相等

### 4.5 Agent 的边界
- 模型只有 6 个原有工具 + 4 个意图建件工具，**全部只产草稿**
- 授权 `approvalId` 只在主进程签发，模型拿不到；提交时主进程重算
- 侧栏只显示工具回执；模型文本单列展示，不作判据

## 5 这一版不能做什么（重要）

- **不支持**：扫描件 / 图片 PDF、DOCX、形位公差与 GD&T、统计公差（RSS / 蒙特卡洛）、多链联合求解、非回转体零件、STEP 导出、DWG、Windows
- **只能**在「隔套 + 一条一维轴向链 + 一条毫米闭区间」上工作
- 真实文档抽取可确认率 **42.0%**（6 份公开语料 269 页，138 候选 / 58 可确认）；**评测语料不是任务书**，真实任务书样本一份都没有
- 尺寸标注**不是参数化的**：改图后必须重新出图，CAD 里不会自动改数
- `%%c` 直径符号是 DXF 标准控制码，AutoCAD 系认；部分看图软件不认，会显示成方块
- 真模型验收用的是 **DeepSeek**（`openai-compatible-1` 适配器），不是 GPT
- 定位高亮只在 rotate 0、页原点 (0,0) 时验证过；旋转与非零原点未验证
- 界面中文硬编码，无 i18n

## 6 数据与隐私

- 计算、渲染、PDF / DXF 生成全部在本机完成，**不联网**
- 项目文件是 `.cunlian`（ZIP：项目、来源附件原始字节、版本、事件、快照）
- 唯一外部调用是 Agent 模型：只有配置真实模型并点「真实模型执行」时才向供应商发请求，发送结构化参数、工具回执与条款摘录，**不发送整份 PDF**；密钥存 macOS Keychain，明文不落盘
- MCP 入口纯确定性：不调模型、不读密钥

## 7 许可

**MIT**（见 `LICENSE`）。第三方组件与字体许可见 `THIRD-PARTY-NOTICES.md`（pdfjs 为 Apache-2.0，Noto 字体为 OFL-1.1）。
`package.json` 的 `"private": true` 只为防误 `npm publish`，不影响开源与再分发。

## 8 怎么验证这一版

```bash
npm test              # 1186 用例 / 108 文件
npm run test:desktop  # 285 通过（另 17 条真模型用例默认跳过，需密钥）
npm run test:mcp      # 22 用例
npm run typecheck && npm run lint && npm run build
```

每个功能的证据（含**变异实验**：把实现改坏、用例必须变红）在 `docs/evidence/` 下。
真实文档度量与复现方式见 `docs/BENCHMARK.md`。
