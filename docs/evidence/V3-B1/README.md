# V3 · B1 内置轴系示例 + 3D —— 实现者自测证据

分支：`agent/dsh-v3-a4c`　基线：`ddef9513754aa9210ae77426c35170155a7b04f1`（dsh-v3-A 头）
采集时间：2026-11-09（本地时区 PST）
采集者：代达罗斯（实现者自测；B1-04 的独立验收由用户/架构师另做，本目录不是独立审查结论）

## 1. 环境与产物

| 项 | 值 |
|---|---|
| 机器 | Mac mini（Apple M4），macOS 26.4，arm64 |
| Node / npm | v26.12.1 / 11.20.0（终端版本，不等同 Electron 内置 Node） |
| Electron | 45.2.3（`package.json` 固定版本） |
| 产物 | `out/寸链-darwin-arm64/寸链.app` |
| renderer 加载 URL | `file:///…/寸链.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.desktop.html` |
| 屏幕 | 2560×1440，本次窗口 `devicePixelRatio = 1`（不是 Retina 2x 路径，如实记录） |

打包命令：`npm run package:desktop -- --arch=arm64`

## 2. 复现命令

```bash
npm run typecheck && npm run typecheck:desktop && npm run lint \
  && npm test && npm run test:desktop \
  && npm run build && npm run package:desktop -- --arch=arm64
node docs/evidence/V3-B1/capture.mjs        # 本目录截图与 b1-electron-report.json 的来源
```

`capture.mjs` 只通过 CDP 驱动打包产物，不修改产品代码、不注入 `--no-sandbox`，
不关闭 `webSecurity`，不启用 SwiftShader；窗口安全参数与生产一致（`sandbox: true`）。

## 3. WebGL2 实际创建结果（真实 Electron 产物）

产品路径（`ThreeViewport` → 懒加载 `threeScene`）：

```
WebGL 2.0 (OpenGL ES 3.0 Chromium)
ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)
```

同页独立探测（`document.createElement('canvas').getContext('webgl2')`）：

```
version   : WebGL 2.0 (OpenGL ES 3.0 Chromium)
shading   : WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0 Chromium)
vendor    : Google Inc. (Apple)
renderer  : ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)
attributes: antialias=true depth=true preserveDrawingBuffer=false stencil=false
```

结论：sandboxed renderer 在本机可创建 WebGL2（硬件 ANGLE Metal 路径，非 SwiftShader 软件渲染）。
`WEBGL_debug_renderer_info` 在该环境可用；若不可用脚本会记录 `扩展不可用`，不会补造。

## 4. 体积实测（硬门槛：3D 懒加载 chunk gzip ≤ 300 KiB）

| 产物 | 原始 | gzip（`gzip -c` 实测） |
|---|---|---|
| `threeScene-C07wB_wD.js`（**3D 懒加载 chunk**） | 570,448 B | **140,645 B = 137.3 KiB**（Vite 报告 142.31 kB） |
| `index.desktop-Jt8FaHqk.js`（首屏入口） | 809,838 B | 243,903 B |
| `index-DCXu6T8D.css` | 30,548 B | 5,988 B |
| `pdf.worker.min-CIqJB0yW.mjs`（A 批次既有，仍按需加载） | 1,271,915 B | 379,584 B |

- 3D chunk 占预算 **46%**（140,645 / 307,200 B），**未超门槛**。
  两个测量口径都远低于 300 KiB：`gzip -c` 140,645 B、Vite 构建报告 142.31 kB（≈145,725 B），
  差异来自压缩实现/级别，不影响结论。
- 首屏增量（同 `npm run build` 的 `dist` 入口，基线为安装 three 前的实测值，取 Vite 报告口径以保持一致）：
  `1,266.05 kB / gzip 400.40 kB` → `1,276.98 kB / gzip 404.16 kB`，
  即 **+10.93 kB 原始 / +3.76 kB gzip**。three 不在首屏 chunk 内，只进懒加载 chunk。
- `out/寸链-darwin-arm64/寸链.app` = 255.2 MiB，`app.asar` = 3,102,736 B。
  基线 `.app` 大小**未测**：本批次开工前该工作树没有 `out/`（首个 `package` 才生成目录），
  不存在可量的基线打包副本，也不编造增量。

## 5. 两个尺寸的真实截图

窗口或内容尺寸、canvas 尺寸、DPR 均为实测值（来自 `b1-electron-report.json` 的 `window1440` / `smallWindow`）。

| 截图 | 窗口 / 内容尺寸 | canvas（CSS=backing） | 说明 |
|---|---|---|---|
| `1440-selected-spacer.png` | 窗口 1440×900 / inner 1440×868 | 884×481 | 树选隔套：浅靛蓝 + #3730A3 轮廓，属性栏只读参数 |
| `1440-exploded-100.png` | 同上 | 884×481 | 爆炸 100%：左右轴承 ±40、挡圈 −76、轴与隔套不动；隔套选中 |
| `1440-exploded-100-bearing-left.png` | 同上 | 884×481 | 爆炸 100% 改选左轴承：属性「当前 / 上限」均为 −24.0 mm（X） |
| `1440-reset-assembly.png` | 同上 | 884×481 | 复位装配：t=0、相机回默认、隔套仍选中 |
| `3d-degraded.png` | 同上 | —（无 canvas） | 真实 `WEBGL_lose_context` 丢失后局部降级 + 重试，其他标签可用 |
| `960-selected.png` | 窗口 960×640 / inner 960×608 | 404×198 | 小窗选隔套（t=0），工具条 2 行不重叠 |
| `960-exploded-100.png` | 窗口 960×640 / inner 960×608 | 404×198 | 小窗爆炸 100%，5 件全在画布内；隔套选中 |
| `960-exploded-100-bearing-left.png` | 窗口 960×640 / inner 960×608 | 404×198 | 小窗爆炸 100% 改选左轴承：「当前」−24.0 mm（X）非零 |
| `960-reset-assembly.png` | 窗口 960×640 / inner 960×608 | 404×198 | 小窗复位装配：**项目树无选中**、`属性 · 未选择`、t=0 |
| `960-offline-reopened.png` | 窗口 960×640 / inner 960×608 | 716×252 | 阻断 HTTP(S) 重载后重新打开示例 |

**960×640 是真实窗口缩放的**：渲染进程调用 `window.resizeTo(960, 640)`，窗口实测
`outerWidth/outerHeight = 960×640`、`innerWidth/innerHeight = 960×608`（32 px 标题栏），
与 `desktop/main/window.ts` 的 `minWidth: 960 / minHeight: 640` 一致。
脚本另外保留了 `Emulation.setDeviceMetricsOverride` 回退路径，本次未触发。
截图物理尺寸即 960×608，未拉伸伪装。

坏像素证据：截图的 canvas 区域用纯 Node（`node:zlib`）解码后统计颜色多样性，
1440 选中态 1,114 种颜色 / 8.19% 非背景像素；爆炸态 1,461 / 11.1%；
960 选中态 707 / 6.56%；960 爆炸态 903 / 8.95%；重载重开 775 / 4.70%。
即画布里确有模型，不是空 canvas。

## 6. 断言清单（35 项全 PASS）

`b1-electron-report.json` 的 `checks` 数组为原始记录，摘要：

- API 面：`window.cunlian` 键集合与 A-04 基线 18 个函数逐一相同（**B1 未新增 IPC**）；
  renderer 无 `require`/`process`/`ipcRenderer`，无 `invoke`/`send`/`on` 通用逃逸口。
- 3D 就绪：`data-three-state=ready`、`data-part-count=5`、`.three-viewport canvas` 恰好 1 个。
- 树 → 模型：隔套 `aria-pressed=true`、属性标题 `属性 · 隔套`、状态栏 `当前选择：隔套`、
  属性值 `20.0000 / 32.0000 / 12.0000 mm`（隔套源 q 换算）、「编辑参数（C 批次）」disabled。
- 属性位移：装配态「当前」为 0；爆炸 100% 隔套标注装配基准；改选左轴承时「当前 / 上限」均为 −24.0 mm（X）。
- 爆炸/复位：滑条 100 → t=1；复位装配 → t=0 且隔套仍选中。
- 960 复位：树无 `aria-pressed=true`、属性 `属性 · 未选择`、滑条 0%；
  且 `960-reset-assembly.png` 与 `960-selected.png` 的 SHA-256 不同。
- 降级：真实 contextlost → `3D 暂不可用：CONTEXT_LOST`，其他标签仍可切换并渲染；重试后恢复且只有 1 个 canvas。
- 离线等价：阻断全部 HTTP(S) 后整页重载，应用仍从 `file://` 加载，3D chunk 正常渲染，
  `performance.getEntriesByType('resource')` 全部为 `file:`，无 HTTP(S) 请求。
- A-04 回归：尺寸链示例表存在、`52.2000`、`未保存草稿`；编辑 52.3 →
  main `reattachSession` 返回 `editSeq=1`、`nominalQ=523000`、dirty；
  结果区 `0.2500 至 0.3500 mm` 由既有领域公式重算；重载后 `editSeq=1` 保留，
  且 3D 示例按设计关闭（需重新打开）。

## 7. 未做 / 未测 / 已知问题（不计入通过）

1. **性能验收未做**：p95 ≤ 33.3 ms、>50 ms 帧占比 ≤ 5% 的目标值只在单测中用注入时钟验证了
   统计与降级判定逻辑（`src/parts/frameStats.test.ts`）；**真机分布未测**，无 FPS/帧间隔实测数据。
   这正是用户留给 B1-04 的部分，本目录不声称性能达标。
2. **物理断网未做**：脚本用 `Network.setBlockedURLs(['http://*','https://*'])` 阻断远程 URL，
   `file://` 不受影响。这能证明“无网络兜底/无远程资源”，但不等于拔网线；
   系统网络开关需要额外权限，未擅自改动。
3. **拖动旋转/平移的“拖动不误选”只在单测覆盖**（4 CSS px 阈值、组合键、多指判定），
   真实指针拖动未在 Electron 中做自动化注入。
4. **DPR=1 路径**：本次显示器 `devicePixelRatio=1`，未走 2x；`min(dpr,2)` 与降级到 1 的分支只有单测覆盖，
   真机 2x 表现未测。
5. **未做 20 次开关/重试的存活实例计数**：单测覆盖了 dispose 幂等与单实例，真实 renderer.info
   平台期未测（B1-04 项）。
6. **`npm run test:desktop:e2e` 预先失败，与 B1 无关**：
   `desktop/tests/e2e/smoke.mjs` 仍断言 body 含“桌面壳”、且 `window.cunlian` 只有 4 个键，
   这两条断言早于 A-02/A-04 的 preload 扩展。`git diff ddef951 -- desktop/preload desktop/shared desktop/main desktop/tests/e2e/smoke.mjs`
   为空，本批次未改这些文件；也未顺手改这份冒烟（按分工留给 B1-04）。
   同一次运行中安全类断言（无通用 IPC 逃逸口、无远程资源、子框架拿不到桥、关闭屏障）均 PASS。
7. **挡圈在装配态几乎被左轴承遮住**（r14 位于 X∈[-29,-27]，紧邻轴承 [-26,-6]）。
   这是任务卡 §3.2 夹具表的给定几何，未擅自改动；爆炸后清晰可见。
   **操作限制：装配态下挡圈主要从项目树选择**（画布拾取容易被左轴承挡住），这是夹具几何的既定结果，
   不是选择逻辑缺陷。可验证路径：树点「挡圈」→ 属性 `属性 · 挡圈`、`aria-pressed=true`、画布高亮。
8. 示例持久化按用户拍板只做 renderer 侧车：不新增 IPC、不动 schema；
   应用重启后需重新打开示例（界面已明说）。

## 8. 审查修正 R1（2026-11-09，用户验收后）

### 8.1 `960-reset-assembly.png` 重拍（原先与 `960-selected.png` 同字节）

- 原因：旧脚本在 960 复位时仍选中隔套、t=0，画面状态与 `960-selected.png` 完全一致，于是字节相同
  （旧值两张均为 `63a3a76326dee9756e9658c5960e77370df8063eec0de78d24b4e0eb57104ddd`）。
- 改法：`capture.mjs` 在 960 复位前用 CDP `Input.dispatchMouseEvent` 点击画布空白处清除选择，
  再点「复位装配」；脚本断言树无 `aria-pressed=true`、属性标题 `属性 · 未选择`、滑条 0%，
  并在脚本内计算两张 960 截图的 SHA-256 断言不同。
- 独立复核（`shasum -a 256`）：
  - `960-selected.png`       = `ea42c663746fb1fad7d0d89db63acf8dd2051c1511860963aed9812262f75d34`
  - `960-reset-assembly.png` = `64782439da3f9d9c3484cf061fc5148b4c1dcc813732d5570de0a53589432ce6`
  - 两者不同。

### 8.2 属性栏「爆炸最大位移 +0.0 mm（X）」恒为 0

- 原因：`partPropertyRows(id)` 只返回本件静态 `explodeX`，行名却像当前值；滑条变化时不重算，
  而隔套（及轴）本身设计位移就是 0，所以装配态与 100% 爆炸态都显示 `+0.0`。
- 改法（同时满足“实时当前值”和“静态上限写清”两条要求）：`partPropertyRows(id, explodeT)` 拆成两行——
  - 「爆炸位移（当前）」= `clamp(t,0,1) × 本件 explodeX`，随滑条实时变化；
  - 「设计最大位移（上限）」= 本件静态设计参数，明确标注是上限；
    轴/隔套不参与爆炸时追加「（装配基准，不参与爆炸）」，不再用 0 冒充动态量。
- 证据：
  - `960-exploded-100-bearing-left.png` / `1440-exploded-100-bearing-left.png`：100% 爆炸选左轴承，
    「当前」与「上限」均为 −24.0 mm（X）；
  - `960-exploded-100.png` / `1440-exploded-100.png`：隔套选中，当前 0.0 且上限行标注装配基准。
- 受影响用例：`src/parts/shaftDemo.test.ts` 新增「爆炸位移：当前值随 t 变化，静态上限单独成行」；
  `src/pages/DesktopWorkspace.test.tsx` 新增「B1 属性栏「爆炸位移（当前）」随滑条变化…」。

## 9. 文件

- `capture.mjs`：CDP 采集脚本（含纯 Node PNG 解码，用于截图像素断言）
- `b1-electron-report.json`：35 项检查的原始结果 + 全部尺寸/探针测量值
- 10 张 PNG 截图
