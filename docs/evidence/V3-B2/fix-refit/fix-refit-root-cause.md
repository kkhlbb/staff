# V3-B2 修复：替换模型后相机没有按新包围盒 refit

日期：2026-11-09（本机 macOS 26.4 / arm64）
分支：`agent/dsh-v3-A`（沿用现有分支，未新开分支、未 push/merge/delete）
范围：只改导入模型的相机适配与测试；`src/domain/**`、q 单位、B1 内置示例、C/D 批次均未动。

## 1. 现象（打包产物，窗口 1440×900，3D 画布 884×504）

先导入 `pr2-head-pan-binary.stl`（1,000 面），再依次替换：

| 步骤 | 修复前截图 | 模型像素覆盖率 | 现象 |
|---|---|---|---|
| 导入 pr2 | `before-01-pr2.png` | 14.65% | 正常，完整入画 |
| 替换 → `slotted-disk-ascii.stl`（288 面） | `before-02-disk.png` | 78.16%，包围盒贴满画布四边（x 0.17…1.0、h 1.0） | 相机停在 pr2 的距离，圆盘被过度放大并裁切 |
| 替换 → `nasa-wrench.stl`（14,564 面） | `before-03-wrench.png` | 0%（`nonBackground=0`） | **3D 区域完全空白**，状态栏仍是「3D 就绪 · WebGL2」 |
| 手动「重置视角」 | `before-04-wrench-after-reset.png` | 7.86% | 立刻正常 |

状态栏全程「3D 就绪 · WebGL2」，没有报错；用户看到的是“模型没加载出来/只剩一个面”。
（用户现场报告 pr2→圆盘为空白、圆盘→扳手为“一个被过度放大的面”；本次复现的两帧分别是
过度放大裁切与完全空白——方向取决于上一个模型留下的距离，本质都是“没有按新包围盒 fit”。）

## 2. 根因链路（验证过的调用顺序）

1. `src/workspace/useImportedModel.ts`
   - 相机位姿存在会话级 `view` 里，原来只在 **sessionId 变化** 时清空（`useEffect` → `setViewState(null)`）。
   - 替换模型（commit）只更新 `revisionId` 与 `geometry`，`view` 原样保留。
2. `src/components/ModelViewport.tsx`
   - 建场 effect 依赖 `geometry.revisionId`：revision 一变就 dispose 旧场景、新建 canvas、重建场景。
   - 新场景拿到的是 `view: propsRef.current.view`（旧 revision 的位姿）。
3. `src/parts/modelScene.ts` 的 `createModelScene`
   ```ts
   const incoming = normalizeViewState(options.view)
   const initialView = incoming ?? defaultModelView(options.bounds, aspect)
   ```
   `incoming` 非空 → 直接沿用旧相机的 position/target/zoom，**唯一**按新 `bounds` 计算的
   `defaultModelView` 被跳过。`resetView()` 走的是 `defaultModelView(options.bounds, …)`，
   所以点「重置视角」立刻正常。
4. 数值验证（FOV 45°、方向 (0.85,0.42,1)、aspect 1.5，与本机 STL 包围盒一致）：
   - fit 距离：pr2 ≈ 0.60，圆盘 ≈ 1.83，扳手 ≈ 164.82（扳手/圆盘 ≈ 90 倍）；
   - 把 pr2 的相机距离 0.60 套到圆盘：角点最坏投影 7.33 倍半幅（出画）；
   - 把圆盘的相机距离 1.83 套到扳手：7 个包围盒角点落在相机背后（相机在模型内部）；
   - 换成各自包围盒的 fit 后，8 角点全部在视锥内（含 10% 留白）。

结论：**替换后沿用上一个模型的位姿（position/target/zoom），不是 fit 用了旧包围盒**——
`options.bounds` 已经是新几何的；旧位姿让新包围盒的 fit 根本没被执行。

## 3. 修复

### 3.1 相机位姿归属到几何版本（`src/workspace/useImportedModel.ts`）

```ts
// 相机位姿记录它所属的几何版本：几何换成新 revision 时，旧位姿自然失效。
const [viewState, setViewState] = useState<{ revisionId: string; view: DemoViewState } | null>(null)
const geometryRevisionId = geometry?.revisionId ?? null
const view = viewState !== null && viewState.revisionId === geometryRevisionId ? viewState.view : null
```

- `setView` 只把位姿记到**当前实际渲染的几何** revision 上；旧场景的迟到通知不会冒充新版本视角。
- 用派生值而不是“revisionId 变化后 useEffect 清空”：清空必须发生在 **同一次 render** 里。
  如果等 effect，ModelViewport 已经用旧位姿建好场景；之后再清空 `view` 也不会重建场景
  （`view` 不是建场依赖），用户仍会看到错视角。

### 3.2 首建与重置同一套 fit（`src/parts/modelScene.ts`）

```ts
export function canvasAspect(canvas) { … }        // 统一纵横比口径（含 1.6 兜底）
const fitView = () => defaultModelView(options.bounds, canvasAspect(canvas))
const initialView = incoming ?? fitView()          // 首建 / 替换后自动 fit
…
resetView() { const view = fitView(); … }          // 重置视角
```

之前首建用 `width/height`（此时还是 0，退回 1.6），重置用真实 `width/height`，同一模型两者
可能差几个百分点；现在两者共用 `fitView()`（同一个 `defaultModelView` + 同一个 `canvasAspect`），
实测替换后与点「重置视角」的截图**逐字节相同**（见 §5）。

### 3.3 取舍：换模型一律重新 fit，同版本内保留手动视角

- **替换 = 新几何**：旧视角对新模型的尺寸/中心没有意义（相差可达 90 倍距离），直接按新包围盒
  fit；不尝试“把旧距离按包围盒比例缩放后保留朝向”——那会保留用户对旧模型构图的假设，
  且在极端尺寸差下仍可能出画，收益低、解释成本高。
- **同一 revision 内**：旋转/缩放/平移仍保留（`view` 与 revisionId 匹配时照常传入），
  切标签、重试 3D 也不重置相机；只有几何版本变化或用户点「重置视角」才改。
- 相机/视角仍只是会话 UI 状态：不写项目、不触发 dirty、不进入撤销历史（与 B1/B2 既有约束一致）。

## 4. 用例与红绿证据

### 4.1 几何单测（`src/parts/modelScene.test.ts`，+3 条）

- `fit 距离随新几何尺寸成比例`：断言圆盘 1.83 / 扳手 164.82 / pr2 0.60，比例 ≈ 90.04 与 3.06。
- `默认视角以包围盒中心为目标，距离等于同一 fit 计算（首建与重置共用）`：用**独立的正向投影**
  核对 8 角点（不是重算一遍 fit）：全部在视锥内、不越过 10% 留白、最坏方向 ≥ 85% 半幅。
- `沿用上一个模型的相机距离会出画（复现 bug），按新包围盒 fit 后完整可见`：
  圆盘用 pr2 距离 → 最坏投影 > 1（出画）；扳手用圆盘距离 → ≥ 1 个角点在相机背后；
  各自 fit 后 8 角点全部入画。

### 4.2 页面级回归（`src/pages/DesktopWorkspace.test.tsx`，+1 条）

`替换尺寸差异极大的模型：按新几何包围盒重新 fit，不沿用旧相机`

- 打开 1×1 模型 → 手动 `onViewChange([5,5,5])` → 走真实 UI（替换模型… → 确认 → commit）换成
  100×100 模型；
- 断言新场景的建场参数：`bounds = 新几何包围盒`、`view === null`（由此走 `defaultModelView`）；
- 断言新几何所需 fit 距离 > 100，而旧 pose 距离 8.66，比值 > 10（不是“没报错”就算过）；
- 断言同版本内再改视角不会重建场景（`modelScene.options` 仍为 2）。

红绿：

| 阶段 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 红（修复前） | `npx vitest run src/pages/DesktopWorkspace.test.tsx -t "替换尺寸差异极大的模型"` | 1 failed：`expected { position: [5,5,5], … } to be null`（新场景确实拿到旧位姿） | `logs/refit-red.log` |
| 绿（修复后） | `npx vitest run src/parts/modelScene.test.ts src/components/ModelViewport.test.tsx src/pages/DesktopWorkspace.test.tsx` | 3 files / 34 tests passed，exit 0 | `logs/refit-green.log` |
| 全量 src | `npx vitest run` | 68 files / 717 tests passed，exit 0 | `logs/refit-test-src.log` |
| 全量 desktop | `npm run test:desktop` | 17 files / 127 tests passed，exit 0 | `logs/refit-test-desktop.log` |
| 类型检查 | `npm run typecheck` / `npm run typecheck:desktop` | exit 0 / exit 0 | `logs/refit-typecheck-lint.log` |
| Lint | `npm run lint` | exit 0 | `logs/refit-typecheck-lint.log` |
| 打包 | `npm run package:desktop` | exit 0（arm64） | `logs/refit-package.log` |

## 5. 打包产物端到端（修复后）

应用：`out/寸链-darwin-arm64/寸链.app`（本次重新打包），窗口默认 1440×900，3D 画布 884×504。
脚本：`e2e-refit.mjs`（新建空项目 → 导入 pr2 → 替换圆盘 → 替换扳手 → 点重置视角）。
每一步用 CDP `Page.captureScreenshot` 截图，并在页面内对画布区域做像素统计（背景 #F5F7FA，
差值 > 24 记为模型像素），报告见 `after-report.json` / `before-report.json`。

| 步骤（均为替换后未点重置） | 修复前 | 修复后 | 截图 |
|---|---|---|---|
| 导入 pr2 | 14.65% | 14.65% | `after-01-pr2.png` |
| 替换 → 圆盘 | **78.16%，bbox 贴满四边（裁切）** | 17.35%，bbox x 0.347 / y 0.157 / w 0.328 / h 0.687（完整、有留白） | `after-02-disk.png` |
| 替换 → 扳手 | **0%（空白）** | 7.86%，bbox x 0.443 / y 0.056 / w 0.145 / h 0.815（整把扳手可见） | `after-03-wrench.png` |
| 再点「重置视角」 | 7.86% | 7.86% | `after-04-wrench-after-reset.png` |

**替换后无需手动重置的证据**：`after-03-wrench.png` 与 `after-04-wrench-after-reset.png`
的 MD5 完全一致（`7f1b6a85b15168a4d6a07454f71c1336`）——自动 fit 与「重置视角」得到的是同一个相机；
`after-02-disk.png`、`after-03-wrench.png` 都是替换完成当即截图，期间没有点过重置。

**canvas 修复未回退**：同一进程再连续替换 5 次（pr2 → 圆盘 → 扳手 → pr2 → 圆盘），
`canvas-cycle-report.json` 记录 6 次探测全部 `canvasCount=1`、`3D 就绪 · WebGL2`，
未出现 `RENDERER_INIT_FAILED`；末帧见 `after-05-canvas-cycle.png`。

三次画布数量均为 1，状态均为「3D 就绪 · WebGL2」。

## 6. 测试替身的边界（不记作“全真”）

- 端到端只在 **main 进程**把原生 `dialog.showOpenDialog` 返回值替换成固定 STL 路径
  （避免为测试去改本机「文稿文件夹」授权），并把“未保存编辑”提示固定为「不保存」；
  其余导入/替换流程、IPC、STL 解析、three 渲染、DOM 全部是打包产物真实代码。
- 单测里的 WebGL 仍是伪场景模块（jsdom 无 WebGL2）：断言建场参数与纯几何距离，
  不冒充 GPU 渲染；真实渲染证据只来自上面的打包产物截图。
- 未覆盖：用户手动旋转/缩放后再替换的“旧视角被丢弃”视觉对照（单测已断言 view 不迁移）；
  1440×900 以外的窗口尺寸；多显示器/高 DPI 仅本次 dpr=2 环境。

## 7. 复现命令

```bash
# 1) 测试
npx vitest run src/parts/modelScene.test.ts src/components/ModelViewport.test.tsx src/pages/DesktopWorkspace.test.tsx
# 2) 打包
npm run package:desktop
# 3) 启动打包产物（测试用调试端口）
./out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链 --inspect=9229 --remote-debugging-port=9336
# 4) 端到端（另开终端）
OUT_DIR=$PWD/docs/evidence/V3-B2/fix-refit PREFIX=after node docs/evidence/V3-B2/fix-refit/e2e-refit.mjs
```
