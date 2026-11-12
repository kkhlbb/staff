# 内置 DXF 看图 · 证据（只读）

分支 `agent/dxf-viewer`，基线 `main` = `420e3f7`（已推远端）。
本目录放**打包应用真实走查**（`e2e-result.json` + `screenshots/`）、**变异实验**
（`mutations/` + `mutations.json`）、**界面提示夹具**（`fixtures/`）。

---

## 1. 做了什么

在桌面应用里加一个**只读**的 DXF 看图：

| 能力 | 实现 |
|---|---|
| 打开 `.dxf` | 文件菜单「打开 DXF 看图…」/ 启动页与工作台按钮 → main 弹系统对话框 → main 读字节（拒绝符号链接/目录，≤64 MiB），renderer 只拿字节；另支持 `--open-dxf=<路径>` 启动参数（只消费一次，供取证与命令行打开） |
| 渲染 | 新建 `src/dxf-view/`（纯解析/场景）+ `src/components/DxfViewer.tsx`（SVG），**没有塞进 `DrawingData`**，也没有改 `dxfExport.ts` |
| 平移/缩放 | 真 `viewBox` 变换：拖拽改 `viewBox.x/y`，滚轮以指针为不动点改 `viewBox.width/height`；不是 `zoom` 数字配 CSS scale。e2e 用真实滚轮事件验证 viewBox 宽度变小、百分比变大 |
| 图层 | 按 `LAYER` 表分组，逐个显示/隐藏；实体颜色按 ACI 1..7 映射（7 在白底显示为深色） |
| 点选 | 命中容差按当前缩放换算；属性面板显示类型、图层、空间、关键坐标、TEXT/MTEXT 文字、DIMENSION 的 42 实测值与匿名块名 |
| 量距 | 点两点自动咬合端点/中点/圆心/象限点；`$INSUNITS=4` 显示 `mm`，否则如实写「图纸单位」 |
| 只读 | 只解析字节：不写回文件、不修改原图、不联网、无原生模块 |

支持的实体：`LINE`、`POLYLINE`+`VERTEX`、`LWPOLYLINE`、`CIRCLE`、`ARC`、`TEXT`、
`MTEXT`（纯文本）、`DIMENSION`（渲染匿名块几何，标注值取组码 `42`）、`VIEWPORT`
（图纸空间按 `41/45` 比例把模型内容画进纸面，按视口矩形裁剪）。

### 1.1 DIMENSION 的标注值

- 匿名块 `*D1/*D2/*D3` 的线段/箭头几何照画；
- 文字**不用**块里的旧文字，而是用组码 `42`（实测值）重新生成：`12.050`、
  `⌀20.000`（标注类型 3 = 直径加 `⌀` 前缀）、`⌀32.000`；
- 组码 1 的文字覆盖值只放进属性面板作对照；缺 `42` 的 DIMENSION 按「未渲染」计数并写解析说明，不猜数字。

### 1.2 未支持实体：显式计数，绝不静默丢弃

`SPLINE`/`HATCH`/`INSERT`/`SOLID` 等不在支持表里的实体进入 `doc.unsupported`
（按类型累加），界面逐条显示 **「未渲染 N 个 XXX（不支持）」**；一条都没有时显示
「全部实体均已渲染（0 个未支持）」。
`fixtures/unsupported.dxf` 的截图（`viewer-unsupported-fixture.png`）证明四类各 1 个都列出来了。
二进制 DXF（`AutoCAD Binary DXF` 开头）不冒充空图：界面显示「未渲染 1 个 二进制 DXF（不支持）」
并提示另存为 ASCII DXF。

### 1.3 中文与编码

- `$DWGCODEPAGE=ANSI_936` → GBK；声明 UTF-8 / DXF 2007+ → UTF-8；`TextDecoder({fatal:true})` 严格解码；
- 解码失败会退回单字节兜底，同时 `encoding.warning=true`，界面顶部显示
  **「本文件编码未识别，文字可能不正确」**+ 具体原因（截图 `viewer-broken-gbk-fixture.png`）；
- `%%c`→`⌀`、`%%d`→`°`、`%%p`→`±`；MTEXT 去掉 `\P` 以外的格式串，只留纯文本。
- 不按「字节看起来像 UTF-8」推翻 936 声明：GBK 双字节序列有相当一部分恰好也是合法 UTF-8，猜错会把中文静默变成别的字母。声明优先，失败才换。

---

## 2. 五份样本打开结果

五份样本全部来自 `docs/evidence/dxf-depth/samples/`（我们上一任务自己导出的真实文件）。
单测（`src/dxf-view/dxfView.test.ts`）逐份断言；打包应用（`viewer-*.png`）开其中三份代表文件。

| 样本 | 版本 | 断言结果 |
|---|---|---|
| `...-r12-1x1.dxf` | R12 / AC1009 | 图层 5 个；LINE 29 / POLYLINE 4 / CIRCLE 2 / TEXT 30；无 DIMENSION、无图纸空间；文本含「寸链 · 待复核草稿」「1:1 · mm」 |
| `...-r12-1x2.dxf` | R12 / AC1009 | 比例栏「1:2 · mm」；图元数与 1:1 相同；未支持 0 |
| `...-2000-1x1.dxf` | 2000 / AC1015 | A3 420×297；视口 360×208、视高 208、比例 1；三条 DIMENSION = 12.05 / 20 / 32 → `12.050` / `⌀20.000` / `⌀32.000` |
| `...-2000-1x2.dxf` | 2000 / AC1015 | 视口比例 0.5；中文标题栏、技术要求、三条标注可读；未支持 0 |
| `...-2000-1x2-userinput.dxf` | 2000 / AC1015 | 含「依据：用户输入，无外部原文件」及「6. 依据：用户输入，无外部原文件。」 |

已知坐标换算抽查：模型圆心 `(360,260)` 经 1:2 视口 → 纸面 `(310,176)` → 显示 `(310,-176)`、半径 `16→8`（单测 `2000 图纸空间把模型内容按视口比例画进纸面`）。

---

## 3. 对照 QCAD

- `screenshots/qcad-reference-2000-1x2.png`：QCAD 3.33 **无头**渲染的同一份 2000-1x2（上一任务产出，原样复制）。
- `screenshots/viewer-2000-1x2-paper.png` / `viewer-2000-1x2-zoom.png`：本应用界面。

对照结论（如实）：

1. 图框、视口位置、零件、端面视图、标题栏/技术要求区布局一致；
2. **QCAD 无头渲染不画标注几何/文字**，且缺 CJK 字体，中文显示成 `????`（上一任务
   `docs/evidence/dxf-depth/README.md` 已记录该限制）。因此「三条标注 + 中文标题栏可读」
   以本应用截图为准：`viewer-2000-1x2-zoom.png`（220%）同时可见 1:2 零件、端面圆、
   `12.050` / `⌀20.000` / `⌀32.000` 与中文投影说明；
3. 本会话没有屏幕录制/辅助功能权限（`screencapture` 与 System Events 均不可用），
   无法自动截 QCAD GUI 窗口；如需 QCAD GUI 对照图，只能在已授权会话里人工截。

---

## 4. 打包应用真实走查（`e2e-result.json`，43/43 通过）

`node desktop/tests/e2e/dxfViewer.mjs`：打包产物 + `--open-dxf=` + CDP 真实鼠标/滚轮，
独立 `--user-data-dir` 临时配置（不碰真实项目数据、不抢用户已开实例的单实例锁）。

| 用例 | 结果 |
|---|---|
| 三份样本 + 两张夹具打开、图层数、文件名 | PASS |
| 2000-1x2：A3 图框 / 1:2 / `12.050`、`⌀20.000`、`⌀32.000` / 中文「依据…」 | PASS |
| 真实滚轮：`viewBox` 420→293 宽、缩放 100%→143%；再放大到 220% | PASS |
| 真实点击量距：图框两角 → **400.00 mm** | PASS |
| 真实点击图框底线 → 属性 `POLYLINE / 图框 / 首点 (10, 10)` | PASS |
| 图层开关：中心线实体 3 → 0 → 3 | PASS |
| userinput 样本「依据：用户输入，无外部原文件」 | PASS |
| R12 样本 1:1 单张、无图纸空间 | PASS |
| 夹具：四类未支持实体 `未渲染 1 个 …（不支持）` | PASS |
| 夹具：坏编码顶部「本文件编码未识别，文字可能不正确」 | PASS |

截图：`screenshots/viewer-2000-1x2-paper.png`（100% A3 全景）、
`viewer-2000-1x2-zoom.png`（220% 三条标注）、`viewer-2000-1x2-measure.png`（400.00 mm）、
`viewer-2000-1x2-selected.png`、`viewer-2000-1x2-model.png`（模型空间）、
`viewer-2000-1x2-userinput.png`、`viewer-r12-1x1-model.png`、两张夹具截图。

---

## 5. 变异实验（`mutations.json`）

`node docs/evidence/dxf-viewer/mutations/run.mjs`：同一条用例，变异后必须红、恢复后必须绿，
并核对恢复前后文件 SHA-256 一致。

| 变异 | 改法 | 结果 |
|---|---|---|
| **M30** | 未支持实体分支删掉 `collectUnsupported`（静默跳过） | 用例「SPLINE / HATCH / INSERT / SOLID 按类型计数」**红**；恢复**绿**；`restoredHashOk=true` |
| **M31** | `ANSI_936` 分支的 GBK 解码换成 UTF-8 硬解 | 用例「GBK 样本解码出完整中文」**红**；恢复**绿**；`restoredHashOk=true` |

日志：`mutations/m30-red.log`、`mutations/m30-restored.log`、`mutations/m31-red.log`、`mutations/m31-restored.log`。

---

## 6. 改动清单

| 文件 | 改动 |
|---|---|
| `src/dxf-view/types.ts` | 解析/场景数据类型（与 `DrawingData` 分开） |
| `src/dxf-view/decode.ts` | 代码页识别、严格 GBK/UTF-8 解码、失败告警 |
| `src/dxf-view/text.ts` | `%%` 控制码、MTEXT 纯文本化、42 标注值格式 |
| `src/dxf-view/parse.ts` | ASCII DXF 组码解析：HEADER/TABLES/BLOCKS/ENTITIES/OBJECTS；POLYLINE/VERTEX、LWPOLYLINE（含 bulge 折线近似）、CIRCLE/ARC/TEXT/MTEXT、DIMENSION 匿名块、VIEWPORT；未支持实体计数 |
| `src/dxf-view/scene.ts` | DXF(y↑) → SVG(y↓) 变换、视口 `41/45` 映射与裁剪、viewBox 缩放/平移/坐标换算 |
| `src/dxf-view/hit.ts` | 点选距离、咬合点、量距文案（INSUNITS=4 → mm） |
| `src/components/DxfViewer.tsx` + `.css` | 只读看图界面：工具栏/图层/未支持面板/属性/量距/编码警示 |
| `src/pages/DesktopWorkspace.tsx` + `.css` | 启动页与工作台入口、全屏只读覆盖层、`--open-dxf` 排队文件消费 |
| `src/workspace/useDesktopSession.ts` | 菜单动作 `openDxf` 不走项目 dirty gate |
| `desktop/main/dxfChannels.ts` | `dxf:open` / `dxf:pending` 通道（dialog 与启动参数；只读字节） |
| `desktop/main/index.ts` | 注册通道、对话框、路径校验/64 MiB 上限、`--open-dxf`、`--user-data-dir` |
| `desktop/main/menu.ts` | 文件菜单「打开 DXF 看图…」 |
| `desktop/shared/contracts.ts`、`desktop/preload/index.ts` | 新通道类型与两个具体函数（旧函数不变） |
| 测试 | `src/dxf-view/dxfView.test.ts`（21）、`src/components/DxfViewer.test.tsx`（10）、`desktop/tests/dxfChannels.test.ts`（5）、`desktop/tests/preloadContract.test.ts` 新函数清单、`src/pages/DesktopWorkspace.test.tsx` mock 两函数 |

**没动**：`src/drawing/**`（`DrawingData` 生成、`dxfExport.ts`、SVG/PDF 渲染）、
导出行为、项目文件格式、计算内核。无新依赖、无原生模块、不联网。

---

## 7. 门禁（本分支实测）

```text
npm test              # 1219 通过 / 110 文件（原 1186/108，新增 31 用例 + 2 文件 + 2 份证据 JSON 守卫）
npm run test:desktop  # 290 通过（另 17 条真模型用例默认跳过）
npm run test:mcp      # 22 通过
npm run typecheck     # 通过
npm run lint          # 通过
npm run build         # 通过
npm run package:desktop -- --arch=arm64  # 通过（含 pdf worker 断言）
git status --short    # 空
```

证据 JSON 均经 `scripts/evidence-json.ts` 的 `serializeEvidence` 归一；
`src/test/evidenceRepro.test.ts` 通过（85 条，含两份新 JSON 的机器路径/UUID 守卫）。

---

## 8. 未做项与已知问题（不记作通过）

1. **没有做可编辑**：本版只读，不提供捕捉/修改/保存；符合任务卡。
2. `INSERT` 仍按不支持计数（任务卡要求），不展开块引用；`SPLINE`/`HATCH`/`ELLIPSE`/`SOLID` 不渲染。
3. `LWPOLYLINE`/`POLYLINE` 的 bulge 圆弧按 16 段折线近似，并在解析说明里写明段数；没有做真圆弧。
4. MTEXT 只保留纯文本：字体、颜色、堆叠、下划线等格式丢弃；`\S` 堆叠分数显示为「上/下」。
5. 视口只处理 `50=0`（无旋转）；非 0 时按 0 渲染并在解析说明里提示。
6. 量距测的是**当前显示空间**的距离：模型空间是模型单位，图纸空间是纸面 mm（界面会写明）；没有做「在图纸空间反投影回模型距离」。
7. 只完整验证 R12（AC1009）与 2000（AC1015）；其它版本按通用组码尽力解析，界面标「未专门验证」。
8. 系统文件对话框路径没有自动化：本会话无辅助功能/屏幕录制权限，e2e 用 `--open-dxf=`
   覆盖「读文件→渲染」链路；对话框本身由 `dxf:open` 通道单测（取消/传路径被拒/大小上限）与菜单项覆盖。
9. QCAD GUI 截图未取得（权限原因，见 §3）；QCAD 无头渲染不画标注文字，不能替代标注对照。
