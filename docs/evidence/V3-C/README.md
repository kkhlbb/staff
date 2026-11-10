# V3-C 交付证据（隔套三参数 → 确定性图纸 → SVG/PDF）

状态：**实现完成、自动化与真实 Electron 出图已执行；打包应用内“点保存对话框导出”未自动化，见“未完成/边界”。**
本目录只记录实际运行结果；未测项不记通过。

## 1. 分支与提交

- 工作树：`/Users/aston/DSH/wt/dsh-v3-A`
- 分支：`agent/dsh-v3-A`（按用户指令：**不自开分支、不建新工作树**；任务卡原建议的 `agent/dsh-v3-C` 未使用）
- 基线 HEAD：`c2b825ad6f5525cf027ff063a7bf091a86767141`（c2b825a）
- 本批提交：见本文件同提交的 `git log -1`（交付消息中给出完整哈希）
- 未 push、未 merge、未删除用户文件。

## 2. 环境

macOS 26.4 (25E246) arm64；Node v26.12.1；Electron v45.2.3；构建工具均为项目内依赖。

## 3. 命令与实际退出码

日志见同目录 `logs-*.log`（`*.log` 被仓库忽略，提交时以 `git add -f` 纳入证据）。

| 命令 | 退出码 | 结果摘要 |
|---|---|---|
| `npm run typecheck` | 0 | app + node 两套 tsc 通过 |
| `npm run typecheck:desktop` | 0 | desktop tsc 通过 |
| `npm run lint` | 0 | eslint 全仓通过 |
| `npm test` | 0 | 71 files / 750 tests 全通过 |
| `npm run test:desktop` | 0 | 19 files / 139 tests 全通过 |
| `npm run build` | 0 | 渲染端生产构建通过 |
| `npm run package:desktop -- --arch=arm64` | 0 | 打包成功，产物 `out/寸链-darwin-arm64/寸链.app` |
| `node desktop/tests/e2e/smoke.mjs` | 0 | 打包 app：标题、桥白名单、无远程资源、编辑屏障、关闭销毁全 PASS |
| `node desktop/tests/e2e/drawingSmoke.mjs` | 0 | 打包 app：工程图页生成/标注/属性定位/两种视口截图全 PASS |
| `npx vitest run src/project-file/versioning.test.ts src/project-file/schema5.test.ts` | 0 | 15 tests：1/2 与 3/4 旧格式兼容、升级与拒绝规则 |
| pdf harness（`vite build` + `electron`） | 0 | 真实 printToPDF 生成 PDF，结构校验通过 |

## 4. 实际产物（相对本目录）

- `spacer-a4-1to1.pdf` — 真实 Electron `printToPDF` 输出，**26,807 字节**
- `spacer-a4-1to1.svg` — 同一 `DrawingData` 的规范 SVG
- `spacer-a4-1to1.drawingdata.json` — 生成该 PDF/SVG 的权威 DrawingData（含 fingerprint）
- `spacer-a4-2to1.svg` / `1to2` / `1to5` / `1to10` — 五个登记比例；`scale-summary.json` 记录各比例指纹、fits、标注 parameterId
- `spacer-a4-1to1.pdfcheck.json` — 解析 PDF 字节得到的页框/字体/位图/矢量统计
- `renders/pdf-page-100pct.png`、`pdf-page-400pct.png`、`pdf-titleblock-8x.png`、`pdf-endview-8x.png`、`pdf-axial-8x.png` — 逐页/局部放大目检
- `gui-1440x900.png`、`gui-960x640.png`、`gui-960x640-drawing.png` — 打包应用工程图页走查
- `mutations/` — MUT-C1/C2 的 patch、红/恢复绿日志、变异 PDF 与解析

## 5. PDF 字体与页框证据（实际解析）

`spacer-a4-1to1.pdfcheck.json`：

- 页数：1
- MediaBox：`[0 0 841.91998 594.95996]`，CropBox 缺省，Rotate 0
- 有效页面：**841.92 × 594.96 pt**（A4 横向 841.8898×595.2756，宽差 0.03pt、高差 0.32pt，均 ≤1pt）
- 位图对象：**0**
- 矢量操作符：274，文本操作符存在
- 字体（`FontFile2` + `BaseFont` 子集前缀）：
  - `AAAAAA+NotoSansSC-Cunlian` — CIDFontType2，`embedded: true`
  - `BAAAAA+NotoSansMath-Regular` — CIDFontType2，`embedded: true`
  - 嵌入计数字段 `embeddedFontCount: 4`（同一字体在页面资源里出现两次；Type0 包装 + CIDFontType2 字体程序）

PyMuPDF 独立复核（`renders` + 终端记录）：

- 文字提取包含：`寸链 · 待复核草稿`、`隔套`、`待补充`、`第三角投影：右端视图置于主视图右侧`、`12.00`、`⌀20.00`、`⌀32.00`
- 所有文字 span 走嵌入字体；早期版本曾出现 14 个 Type3 回退 span，已定位为“标注文字被 CSS 加了 stroke”并修复，最终 **Type3 span = 0**
- 100% 与 800% 目检：图框四边完整、标题栏 9 行完整、长度尺寸两端实心箭头、两条直径引出线箭头指到圆周、中心线超出轮廓、隐藏线短虚线、无豆腐块/裁切/整图栅格化

## 6. 字体来源与许可

见 `public/fonts/SOURCE.md` 与 `LICENSE-OFL-1.1.txt`。

- 中文/数字：Noto Sans SC，`google/fonts` 的 `NotoSansSC[wght].ttf`（提交 `2894aab…`），固定 `wght=400` 后子集化，186 字符 / 559 字形 / 38,920 字节
- 符号：**Noto Sans SC 不含 U+2300 ⌀**（源字体 cmap 实测），因此另带 Noto Sans Math 子集（同 OFL-1.1，提交 `55773c3…`）提供 `⌀ ±`；PDF 中两个字体都必须嵌入
- 生成脚本：`scripts/build-font-subset.py`（fontTools 只在临时 venv，不进入项目依赖）

## 7. 数据与渲染分离（红线 1）

- 唯一生成器 `src/drawing/spacerDrawing.ts`（参数 q + 模板 + 比例 + 图框字段）
- 唯一序列化器 `src/drawing/renderDrawingSvg.ts`：预览、SVG 导出、PDF 打印页都调用它
- PDF：隐藏 BrowserWindow 加载独立 `drawing_print` 入口 → `printToPDF`（A4 landscape、0 边距、preferCSSPageSize、printBackground、无页眉页脚）
- 打印窗口无 preload、无通用 IPC、独立 partition、禁导航/新窗口、非 file/data 请求拒绝
- 依赖边界测试 `src/drawing/dependencyBoundary.test.ts`：`drawingPdf.ts` 必须含 `printToPDF` 且不得出现 `capturePage/toDataURL/nativeImage`；打印入口只收 `svg + fonts + fingerprint`
- 落盘：`DrawingExportStore` 同目录临时文件 wx/0600 → fsync → 回读哈希 + 结构校验 → 目标指纹复核 → rename → 回读；失败不留正式文件/不截断原目标
- 导出文件**不**回灌为项目附件（单测断言 blob 计数不变）

## 8. 标注取模型真值（红线 2）

- `resolveDimension(parameterId, parameterSnapshot)` 只查 q；`formatQWithDecimals` 用整数商/余数，不经浮点 `toFixed`
- 比例只作用于 `scaleFactor` 几何；标注文字不受 scale/zoom/DPR 影响
- 覆盖：`12.1000` 与 `12.10` 同为 q=121000、几何完全相同、显示分别为四位/两位；`12.1001` 为 121001，两位/三位小数无法无损表达时拒绝；`12`/`12.0`/`12.00` 分别保留位数
- 同一 `parameterId` 的标注只从同一快照解析

## 9. 持久化 schema 5（C-03）

- `formatVersion` 保持 2；`project.schemaVersion` 写 5；仍可读 3（formatVersion 1）与 4（formatVersion 2）
- `parameters[]`：`parameterId/partId/key/valueQ/inputDecimals/reviewStatus/sourceNote?`
- `drawings[]`：仅引用（drawingId、templateVersion、revisionId、parameterIds、paper/scale、frameFields、status、dataFingerprint），**不存图元数组/截图/base64 PDF**
- 打开时按参数 + 模板确定性重建，重建 fingerprint 必须等于保存的 `dataFingerprint`，否则 `INVALID_RECORD`
- 旧文件读取不写盘、不产生 dirty；保存时新增一条 schema5 版本，旧 schema3/4 历史原样保留
- `stageDraft` 不能伪造 `parameters/drawings`（main 权威字段保护）

实测：

- 真实 B1 fixture（formatVersion 1 / schema 3）可打开，q、PDF 字节与历史保持（`versioning.test.ts`）
- 由真实容器改写为 formatVersion 2 / schema 4 后：解码成功、工作形状升为 5、来源格式仍 2、参数/图纸为空；升级新增 schema5 版本，旧记录保持 4；重编码后 manifest schema 5（`schema5.test.ts`）
- schema4 中塞入非空 parameters/drawings 仍被拒绝

## 10. 变异实验（实际执行）

### MUT-C1：标注改取缩放后值

- patch：`mutations/MUT-C1.patch`（`resolveDimension` 改为 `valueQ * 0.5`）
- 红：`MUT-C1-app-red.log` = app 侧 **6 failed / 19 passed，exit 1**；`MUT-C1-desktop-red.log` = **2 failed / 8 passed，exit 1**
  - 失败点包括 1:2 几何减半仍要求 20.00/32.00/12.00、12.1000/12.10、五个比例、渠道 q 断言、SVG 文本
- 恢复：`MUT-C1-app-restored-green.log` = 25 passed；desktop = 10 passed；未修改任何期望值

### MUT-C2：PDF 入口改成 capturePage 整页 image

- patch：`mutations/MUT-C2.patch`（`capturePage().toPNG()` → `<img>` → printToPDF）
- 红：`MUT-C2-boundary-red.log` = 依赖边界测试 **1 failed / 4 passed，exit 1**（源码出现 `capturePage`）
- 变异实际产物：`mutations/mut-c2/spacer-a4-1to1.pdf`（4,675 字节），解析 `mut-c2/spacer-a4-1to1.pdfcheck.json`：
  - `ok: false`
  - `errors: ["PDF 没有字体资源", "PDF 含 2 个位图对象，疑似截图出图"]`
  - `imageCount: 2`、`embeddedFontCount: 0`、`hasTextOperator: false`
  - 说明：Electron 进程对 `app.exit(1)` 返回 0，但权威判定以 pdfcheck 的 `ok:false` 为准
- 恢复：`MUT-C2-boundary-restored-green.log` = 5 passed；正常 PDF 重新生成并通过

未执行 MUT-C3/C4（任务卡要求“至少 MUT-C1 和 MUT-C2 实际执行”；C3/C4 见任务卡 9.2，未声称通过）。

## 11. GUI 走查（打包应用）

`drawingSmoke.mjs` 在打包 app 内实际执行：

- 打开内置示例 → 工程图页“生成图纸”（走 `drawing:update-spacer`）
- 预览出现 64 位指纹；长度标注 `12.00`；外径 `⌀32.00`；状态含“待复核草稿”
- 预览 DOM 无 `<image>` 截图
- 点击长度标注 → 属性栏显示 `q = 120000 · 输入 2 位小数` 与绑定标注
- 1440×900：整张 A4 完整可见（fit 变换实测 matrix 0.392，纸张 440×311 落在画布 850×343 内）
- 960×640：侧栏/参数改为两列、按钮完整；窄窗需滚动，滚动后整张图纸与导出按钮可达（`gui-960x640-drawing.png`）
- 说明：960 截图用 CDP 视口覆盖，未触发真实窗口初始侧栏折叠逻辑；侧栏折叠在本轮未单独验收

## 12. 未完成 / 已知边界

1. **打包应用内点击“导出 PDF/SVG”并走系统保存对话框的端到端流程未自动化**。本轮实际 PDF 由真实 Electron 45.2.3 + 生产模块 `buildSpacerDrawing → renderDrawingSvg → printDrawingToPdf → printToPDF` 生成；打包 app 内已确认 `drawing_print` 入口、两套字体、主/preload 产物都在 asar 中（`asar list` 实测），但未驱动原生保存对话框。
2. 960×640 使用视口覆盖，侧栏折叠（真实窗口 resize 初始化）未逐项验收；图纸滚动后可见。
3. Noto Sans SC 无 U+2300，`⌀` 由同许可的 Noto Sans Math 子集提供（已在上文与字体来源文件写明，不冒充单一字体覆盖）。
4. 未执行 MUT-C3/C4；未做 D 批次（尺寸链联动改值、参数同步、公差链重算）。
5. 不声明符合 GB/ISO；图框固定“待复核草稿 / 未复核、未批准”。
6. 导出 SVG 只承诺规范 SVG 与预览一致，不承诺任何 CAD 可直接打开；界面文案已避免 CAD 兼容暗示。
7. 已删除/终止一个 06:24 遗留的旧打包 app 测试实例（PID 51455，占用单实例锁），未触碰用户项目文件。

## 13. 文件映射（摘要）

| 卡 | 主要文件 |
|---|---|
| C-01 参数/数据 | `src/parts/spacerParameters.ts`、`src/drawing/{types,formatDimension,fingerprint}.ts`、`src/project-file/{types,validation,codec,upgrade}.ts` |
| C-02 几何/唯一数据 | `src/drawing/{spacerDrawing,layout,renderDrawingSvg}.ts`、`src/drawing/spacerDrawing.test.ts` |
| C-03 持久化/工作台 | `src/project-file/schema5.test.ts`、`src/components/{DrawingCanvas,SpacerDrawingPanel}.*`、`src/pages/DesktopWorkspace.tsx`、`desktopAdapter/useDesktopSession` |
| C-04 IPC/导出 | `desktop/main/{drawingChannels,drawingExportStore,pdfCheck,printAssets}.ts`、`desktop/shared/contracts.ts`、`desktop/preload/index.ts`、`desktop/main/index.ts` |
| C-05 打印/PDF | `index.print.html`、`src/desktop/drawingPrintEntry.ts`、`src/desktop/drawingPrint.css`、`desktop/main/drawingPdf.ts`、`vite.print.config.ts`、`forge.config.ts` |
| 字体 | `public/fonts/*`、`scripts/build-font-subset.py` |
| 证据 | `desktop/tests/e2e/{pdfHarness.ts,drawingSmoke.mjs}`、本目录 |
