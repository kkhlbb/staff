# DXF 导出 v1（车间/外协可用的 2D 交付）

一句话：从现有 `DrawingData` 直接生成 **DXF** —— **R12（AC1009，默认，给切割/检具/老设备）**
与 **2000（AC1015）**；模型空间按**真实尺寸 1:1（mm、y 向上）**写出，图层/颜色分开，
尺寸是「几何 + TEXT」。**不碰 DWG。**

| 项 | 值 |
|---|---|
| 分支 | `agent/dxf-export` |
| 基线 | `main d0b6b1f`（V4.0 五阶段全部合入） |
| 实现提交 | `a2a7f0b`（本文件与其后日志/样本在同一分支的证据提交里） |
| 回环报告 | `docs/evidence/dxf-export/roundtrip.json`（`serializeEvidence`） |
| 样本 | `samples/spacer-20x32x12.05-dxf-r12.dxf`、`samples/spacer-20x32x12.05-dxf-2000.dxf` |
| 打包走查 | `e2e-result.json` + `screenshots/`（**保存对话框一项 BLOCKED，见 §9，如实记录**） |

> **这些尺寸没有 CAD 关联性**：DXF 里没有 `DIMENSION` 实体，尺寸线/界线是 `LINE`、
> 数字是 `TEXT`。改了图**不会自动改数**，改完必须回寸链重新导出。不要把它当参数化标注。

---

## 一、坐标换算（任务卡 §1.1）

`DrawingData` 是**纸面毫米、左上原点、y 向下**；DXF 模型空间是**真实尺寸 1:1、y 向上**。

```
k        = 分母 / 分子          （1:1 → 1，1:2 → 2，2:1 → 0.5）
x_model  = k · x_paper
y_model  = k · (纸面高 − y_paper)      paper.heightMm = 210
h_text   = k · 纸面字高（标注 3.5mm，标题栏 3.0/3.2/4.0mm）
```

- 几何值保留到 1e-9mm（只去浮点噪声），**不取整到 0.01**；标注数字才走既有显示规则
  （`formatMm`：3 位小数，第 4 位非零保留 4 位，例如 `12.050` / `12.0501`）。
- 虚线节距、箭头长度/宽度也乘 `k`，保证在模型空间里视觉比例与纸面一致。
- 实测（`roundtrip.json > halved`）：1:2 图纸纸面外廓 6.025 × 16mm → 模型外廓
  **12.05 × 32mm**；整图（含图框）包围盒 20–574 × 20–400mm，正好是纸面 10–287 × 10–200 的 2 倍；
  标注文字 3.5→7mm，标题栏文字 3.0→6.0mm；CENTER 线型节距总长 20→40mm。
- 1:1 与 1:2 的主视图**模型尺寸相同**（都是真实尺寸），差别只在纸面：这是换算正确的最小判据。

## 二、R12 实体白名单与编码

- 实体只用 `LINE / POLYLINE+VERTEX / CIRCLE / TEXT`；**不写** `LWPOLYLINE`、`MTEXT`、`SPLINE`、
  `HATCH`、`DIMENSION`。测试直接扫文件文本，四个禁用词出现次数必须为 0。
- `$DWGCODEPAGE = ANSI_936`，整个文件按 **GBK 字节**写出（R12/2000 都没有 Unicode）。
  中文层名与中文标注因此在中文 CAD 里能正常显示；`⌀` 用 R12 控制码 **`%%c`**（ASCII），
  不依赖 Unicode 字形（读回时 `%%c20.000` 即直径 20）。
- GBK 表由 `scripts/gen-dxf-gbk-table.py` 从系统 GBK 编码生成并提交在
  `src/drawing/dxfGbkTable.ts`（21,791 个双字节码位，纯查表，无原生模块、不联网）。
  **表外字符（emoji、表外生僻字）会明确报错 `DXF_TEXT_UNENCODABLE`，绝不写 `?` 或乱码。**
- 字体：`STYLE` 表 `标准` = `txt.shx` + 大字体 `hztxt.shx`（中文 R12 的常规组合）。
- 2000 版：`$ACADVER=AC1015`、`$INSUNITS=4`（毫米）、`$MEASUREMENT=1`，实体带句柄；
  R12 版：`$ACADVER=AC1009`、`$MEASUREMENT=1`，无句柄、无 `$INSUNITS`。

## 三、图层与颜色

| 图层 | ACI 颜色 | 线型 | 内容（实测实体数，1:1 样本） |
|---|---|---|---|
| `轮廓` | 7（白/黑） | CONTINUOUS | 5（主视图轮廓 1 折线 + 2 隐藏线 + 2 圆） |
| `中心线` | 1（红） | CENTER | 3 |
| `尺寸` | 3（绿） | CONTINUOUS | 18（尺寸线/界线/箭头短线 + 3 个数字） |
| `文字` | 2（黄） | CONTINUOUS | 1（第三角投影说明） |
| `图框` | 4（青） | CONTINUOUS | 38（图框线、标题栏线、标题栏/技术要求文字） |

隐藏线在 `轮廓` 层上用 `DASHED` 线型覆盖（R12 实体级 linetype 合法）；箭头在 `尺寸` 层用
**两条短线**画成 V 形（R12 白名单里没有 `SOLID`，本版不用块）。

## 四、D-01～D-08 实测

命令：`npx vitest run src/drawing/dxfExport.test.ts`（13 条，`logs/01-test.log` 为全量套件）
与 `npx vitest run --config vitest.desktop.config.ts desktop/tests/dxfExport.test.ts`（6 条）。

| 编号 | 场景 | 实测结果 |
|---|---|---|
| D-01 | 1:1 隔套 20×32×12.05 | **通过**。R12 与 2000 都被 `dxf-parser` 读回：LINE 29 / POLYLINE 4（VERTEX 20）/ CIRCLE 2 / TEXT 30，无其它实体；主视图外廓 12.05 × 32mm；标注文字 `12.050`、`%%c20.000`、`%%c32.000`；版本头 AC1009 / AC1015 |
| D-02 | 1:2 图纸 | **通过**。k=2；纸面 6.025×16 → 模型 12.05×32；标注字高 3.5→7、标题栏 3.0→6.0；CENTER 节距 20→40；整图包围盒 20–574×20–400 = 纸面×2 |
| D-03 | R12 实体白名单 | **通过**。文件文本 `LWPOLYLINE / MTEXT / SPLINE / HATCH` 各 **0** 次；解析出的实体类型只有 LINE/POLYLINE/CIRCLE/TEXT；`66=1` 折线 + VERTEX 计数与预期一致 |
| D-04 | 图层与颜色 | **通过**。五个图层齐全，`轮廓 7 / 中心线 1 / 尺寸 3 / 文字 2 / 图框 4`，每层都有实体引用（见上表） |
| D-05 | 中文标注 | **通过（GBK 路线）**。字节用 `TextDecoder('gbk')` 解码后与生成文本逐字相同，`U+FFFD` 0 个；`待复核草稿 · 未复核、未批准`、`技术要求 / 缺项`、`第三角投影：右端视图置于主视图右侧`、`45 钢` 都能读回；`iconv -f GBK -t UTF-8` 也能整文件解码 |
| D-06 | 取消保存 | **通过**。对话框返回 null → 回执 `CANCELLED`；导出目录 `readdir` 为空（无 `.dxf`、无 `.tmp`） |
| D-07 | 保存成功 | **通过**。R12: `隔套-DXF-R12.dxf` 8,684 B / SHA-256 `17eb16ec…bbf7`；2000: 9,552 B / `168514d5…2f68`；回执文件名/字节数/SHA-256 与磁盘逐项相等；覆盖已有文件时也原子替换且无临时残留 |
| D-08 | 空/异常 DrawingData | **通过**。空图元、NaN 坐标、零分母、未知版本、表外字符分别得到 `INVALID_DRAWING` / `UNSUPPORTED_VERSION` / `DXF_TEXT_UNENCODABLE`，不返回字节；通道层无图纸 → `DRAWING_NOT_FOUND`，**保存对话框 0 次调用**、目录为空；过期指纹/序号 → `STALE_DRAWING` / `STALE_EDIT`，同样不产生文件 |

回环校验不是「生成成功就算」：`scripts/dxf-export-evidence.ts` 把**写盘后的字节**重新读入
（`new TextDecoder('gbk')` → `dxf-parser`），逐项断言后才落 `roundtrip.json`；失败时证据不会生成。

## 五、样本与 SHA-256

| 文件 | 字节 | SHA-256 |
|---|---|---|
| `samples/spacer-20x32x12.05-dxf-r12.dxf` | 8,684 | `17eb16ec75bda446a69b57bfd00f19a675092a871bbaa4aa9ecdca08dfb8bbf7` |
| `samples/spacer-20x32x12.05-dxf-2000.dxf` | 9,552 | `168514d599484b88a64374bfd285441c482dc23ff3985187044804710ee52f68` |

1:2 用例（不入样本目录，哈希在 `roundtrip.json > halved`）：8,712 B /
`7fc9dd2aeb17094de0206375c87c0d2e8b58d1b03b454516fffff4bca67e45f9`。

复算：`npx vitest run --config vitest.dxfexport.config.ts`（`npm run evidence:dxf`）。
报告里的 `parsedGeometry` 来自 `dxf-parser` 读磁盘字节；`expectedWidth/Height` 由 **q 与比例独立换算**
（不调用导出模块的坐标函数），1:1 与 1:2 都是 12.05 × 32，偏差 0mm（容差 0.001mm）。

## 六、导出入口（系统对话框 / 取消 / 回执）

工程图页底部新增两个按钮：**「导出 DXF（R12）」** 与 **「导出 DXF（2000）」**（原有 PDF/SVG 不变）。
走与 PDF/SVG 相同的原子落盘：同目录临时文件 → 回读哈希 → 结构校验（`validateDxfBytes` 重建期望并逐字节比对）
→ rename 前再核对目标 → 原子 rename → 回读确认。

- 对话框取消 → `CANCELLED`（「已取消选择导出位置」），**不产生文件**。
- 成功回执：真实文件名 / 字节数 / SHA-256（界面显示前 12 位，证据里是全量）。
- 建议文件名：`<零件名>-图纸-<比例>-DXF-R12.dxf` / `-DXF-2000.dxf`，默认目录「文稿」。
- DXF 字节在**弹对话框之前**生成：数据非法时直接报错，不会留下半截文件，也不会白弹一次对话框。

## 七、改动清单

| 文件 | 改动 |
|---|---|
| `src/drawing/dxfExport.ts` | **新增**。换算（`dxfScaleFactorOf` / `dxfPaperToModel`）、实体生成、头/表/图层/线型、`validateDxfBytes`、错误码 |
| `src/drawing/dxfGbk.ts`、`src/drawing/dxfGbkTable.ts` | **新增**。GBK 查表编码；表外字符报错；生成文件 21,791 条 |
| `scripts/gen-dxf-gbk-table.py` | **新增**。表生成器（一次性；`git diff` 为空可复算） |
| `src/drawing/dxfExport.test.ts` | **新增**。D-01～D-05、D-08 共 13 条（含 dxf-parser 读回） |
| `desktop/main/drawingChannels.ts` | 两个 DXF 通道；DXF 在选路径前生成；落盘前 `validateDxfBytes` |
| `desktop/main/drawingExportStore.ts` | `DrawingExportKind` 增加 `dxf-r12`/`dxf-2000`，后缀映射 `.dxf` |
| `desktop/main/index.ts` | 保存对话框标题/过滤器按版本区分 |
| `desktop/shared/contracts.ts`、`desktop/preload/index.ts` | 两个新通道与 `window.cunlian` 方法（只增不改旧函数） |
| `src/components/SpacerDrawingPanel.tsx` | 两个按钮 + 回执提示 + 「没有 CAD 关联性」说明 |
| `desktop/tests/dxfExport.test.ts` | **新增**。D-06/D-07 + 通道级 D-08（6 条） |
| `desktop/tests/e2e/dxfExport.mjs` | **新增**。打包应用真实点击走查（保存 / 取消） |
| `scripts/dxf-export-evidence.ts`、`vitest.dxfexport.config.ts` | **新增**。回环证据与样本生成 |
| `package.json` / `package-lock.json` | devDependency `dxf-parser@1.1.2`（MIT，仅测试/证据用，不进打包产物）；`evidence:dxf`、`test:desktop:dxf-e2e` 脚本 |
| `src/pages/DesktopWorkspace.test.tsx`、`desktop/tests/preloadContract.test.ts` | 既有 mock/白名单随新增只增方法同步 |

## 八、变异（红 → 恢复绿）

补丁在 `mutations/`，日志在 `logs/`；恢复后 `git diff` 为空（DXF 模块是新增文件，恢复用同内容覆盖并逐字节比对）。

| 变异 | 做法 | 红 | 恢复 |
|---|---|---|---|
| **M20** 不做纸面→模型换算 | `dxfPaperToModel` 直接返回纸面坐标（不乘 k、不翻 y） | `logs/10-M20-red.log`：**D-02 2 条红**（模型宽度 6.025 ≠ 12.05；另 D-08 坐标精度用例连带红），`Tests 3 failed / 10 passed`，exit 1 | 覆盖回原实现 → `logs/11-M20-restored-green.log`：`13 passed`，exit 0 |
| **M21** R12 里插 `LWPOLYLINE` | `ENTITIES` 段在 `version==='r12'` 时多写一条 `0/LWPOLYLINE` | `logs/12-M21-red.log`：**D-03 红**（`occurrences: 1 ≠ 0`），`1 failed / 12 skipped`，exit 1 | `logs/13-M21-restored-green.log`：`1 passed / 12 skipped`，exit 0 |

## 九、打包应用真实点击（如实）

`npm run package:desktop -- --arch=arm64` → 真实 `.app`；走查脚本 `desktop/tests/e2e/dxfExport.mjs`
用 CDP 打开内置示例、生成图纸、点按钮，用 System Events 操作系统保存对话框。
结果（`e2e-result.json`、`logs/09-e2e-packaged.log`）：

- **通过**：打包产物里两个 DXF 按钮可见可点；点「导出 DXF（R12）」后按钮进入 busy —
  主进程 IPC 挂起在 `dialog.showSaveDialog`，即**真的打开了系统保存对话框**；
  截图 `screenshots/dxf-01-buttons.png`、`dxf-02-dialog-pending-no-ax.png`。
- **阻塞（不是通过）**：本 Hermes 会话**没有辅助功能（AX）权限** —— System Events 对「寸链」
  返回 `count of windows = 0`（进程列表里能看到「寸链」，`screencapture` 同样不可用）。
  因此**没有**在对话框里填文件名/按回车、也没有执行取消路径；应用在 2 秒后被 SIGKILL，
  `Documents` 下没有生成任何文件。`e2e-result.json > checks` 里这一项是 `blocked: true`，
  原因写的是 `no-accessibility-permission`，不是产品能力问题。
- 有权限的会话里可复现（脚本已实现同一套步骤，名称只填文件名、不填路径）：
  ```
  osascript -e 'tell application "System Events" to tell process "寸链" to get count of sheets of window 1'
  osascript -e 'tell application "System Events" to tell process "寸链" to tell splitter group 1 of sheet 1 of window 1 to set value of text field "保存为：" to "dxf-r12-e2e.dxf"'
  osascript -e 'tell application "System Events" to tell process "寸链" to key code 36'   # 保存
  osascript -e 'tell application "System Events" to tell process "寸链" to key code 53'   # Esc 取消
  ```
  > 陷阱：`保存为` 字段只接受**文件名**，填路径会把 `/` 存进文件名。

**结论**：DXF 的产品路径（通道、原子落盘、回执、取消）由 6 条桌面测试覆盖并通过；
「打包应用里亲手点一次保存」这一步在本会话被 AX 权限阻塞，**记未完成**，等有权限的会话复核。

## 十、六条命令 + 打包（`a2a7f0b` 工作树，原始输出见 `logs/`）

| # | 命令 | 退出码 | 实际输出 | 日志 |
|---|---|---|---|---|
| 1 | `npm test` | 0 | 101 files / **1082 tests** 全通过 | `logs/01-test.log` |
| 2 | `npm run test:desktop` | 0 | 39 files 通过 / 1 skipped；**277 passed** / 14 skipped | `logs/02-test-desktop.log` |
| 3 | `npm run typecheck` | 0 | 无诊断 | `logs/03-typecheck.log` |
| 4 | `npm run typecheck:desktop` | 0 | 无诊断 | `logs/04-typecheck-desktop.log` |
| 5 | `npm run lint` | 0 | `eslint .` 无输出 | `logs/05-lint.log` |
| 6 | `npm run build` | 0 | vite 生产构建通过（既有 chunk >500kB 警告） | `logs/06-build.log` |
| 7 | `npm run package:desktop -- --arch=arm64` | 0 | `RESULT PASS 打包产物中的 pdf worker 可被 main.cjs 运行时加载`；asar 内含 `drawing:export-dxf-r12` | `logs/07-package-desktop.log` |
| 8 | `npx vitest run --config vitest.dxfexport.config.ts` | 0 | 回环证据生成 + 1 条断言通过 | `logs/14-dxf-roundtrip-evidence.log` |
| 9 | `node desktop/tests/e2e/dxfExport.mjs` | 2 | 前 4 项 PASS，保存对话框项 **BLOCKED（无 AX 权限）** | `logs/09-e2e-packaged.log` |

## 十一、未做 / 已知边界（如实）

1. **STEP 导出（AP214 几何 / AP242 带公差）本期不做。** 未来实现时，应新增独立后端
   （`CadExportBackend`），从同一 `DrawingData` / 参数派生，**不要与 DXF 写在同一函数里**；
   AP242 的语义 PMI 开源侧写不出来（OCCT 仅 AP203/AP214），届时要么对接客户已有商业 CAD，
   要么评估 OEM。
2. **DWG 不做**：ODA 年费 $3,000 起，客户点名再上。
3. **Agent 侧 `exportApprovedVersion` 仍只支持 pdf/svg**：本轮按任务卡「新增独立按钮」路线实现，
   没有把 dxf 塞进 Agent 工具格式枚举（那会改动 Agent 回执 schema）；需要时另开小卡。
4. **2000 版是最小 AC1015 结构**：有 `$INSUNITS=4`、句柄、LTYPE/LAYER/STYLE/APPID 表，
   但没有 `BLOCK_RECORD`／`330 owner`／`100 子类标记`、`BLOCKS` 为空。`dxf-parser` 读回通过；
   **未在 AutoCAD 2000/Mechanical 里实测**（本机没有 CAD）。R12 是给老设备的默认版，风险更低。
5. **打包应用保存对话框的真实点击被 AX 权限阻塞**（§9）：已点开对话框，未完成保存/取消的
   GUI 操作，也没有在 `Documents` 留下文件；这一步**没有测**，等有权限的会话按脚本复核。
6. **文字与箭头**：标题栏/说明字高按预览的 3.0/3.2/4.0mm、标注/注释 3.5mm × k，统一用
   `txt.shx + hztxt.shx`；箭头是两条短线，不是 `SOLID`/块，因此在 CAD 里不能整体选中箭头。
7. **GBK 表外字符直接报错**（emoji、表外生僻字、其它文字），不降级、不写 `?`；
   常见简体/繁体中文与符号在表内（21,791 条）。
8. **包围盒口径**：`roundtrip.json > bounds.parsedGeometry` 含图框（图框也在模型空间），
   所以 1:1 时正好等于纸面 10–287 × 10–200；零件真实尺寸单独核对 `drawingOutline`
   （12.05 × 32）。`TEXT` 只按插入点参与 `entityBounds`，没有字形宽度外框。
9. **`%%c` 是 R12 控制码**：DXF 文本里读回来是 `%%c20.000`，CAD 里显示为直径符号；
   README 与测试都按这个口径核对，不是 Unicode `⌀`。
