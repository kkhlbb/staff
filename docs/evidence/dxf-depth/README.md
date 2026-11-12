# 出图加深 · 证据（追上 AgentCAD 的图纸能力）

分支 `agent/dxf-depth`，基线 `main` = `791483c`（意图建件已合入）。
本目录放**研究**（`research.md`）、**样本**（`samples/`）、**渲染图**（`screenshots/`）、
**日志**（`logs/`）、**变异脚本**（`mutations/`）。

---

## 1. 研究结论（先研究后写码）

完整版在 `research.md`（含组码表与实测证据）。三个问题的答案：

1. **R2000 的 `DIMENSION` 最小可用字段集**：`2`（匿名几何块名，**缺了它 ezdxf 直接判
   UNDEFINED_BLOCK 并删除该标注**）、`3`（DIMSTYLE 名）、`10/11`（尺寸线定义点、文字中点）、
   `70`（低 4 位标注类型 + 位 32「几何块被引用」）、`1`（文字覆盖值）、子类
   `AcDbAlignedDimension` 的 `13/14/50` 或 `AcDbDiametricDimension` 的 `15`、`42` 实测值。
   另需 `DIMSTYLE` 表条目（句柄组码是 `105`）与 `BLOCK_RECORD` + `BLOCK/ENDBLK`（匿名块 `70=1`）。
2. **路线选 A（自写）**：
   - B（`@tarikjabiri/dxf` 2.10.0）实测不合格——它写出的 DIMENSION **没有 `2` 几何块、没有 `10/11/3/42`**，
     ezdxf `audit()` 直接 `UNDEFINED_BLOCK Removed DIMENSION(...)`；且 `LIB` 里 `LAYOUT`/`VIEWPORT`
     出现 **0** 次（只有 VPORT 表记录的 `AcDbViewportTableRecord`）、`ANSI_936`/GBK 出现 **0** 次。
     证据：`research/lib-dimension-tarikjabiri.dxf`、`research/audit_tarikjabiri.py`。
   - C 无候选（无原生模块 / 不联网）。
   - A 的可行性与组码由 ezdxf 参考样本 `research/ref-r2000.dxf` 逐条对照。
3. **图纸空间**：`BLOCK_RECORD` 表（`*Model_Space`/`*Paper_Space`/匿名块）+ `BLOCKS` 段 +
   `ENTITIES` 里 `67=1` 的图纸空间实体 + `OBJECTS` 段的根字典 / `ACAD_LAYOUT` 字典 / 两个
   `LAYOUT` 对象（`44/45 = 420/297`）+ 一个 `VIEWPORT` 实体。
   **`VIEWPORT` 实体的 `40=视口宽`、`41=视口高`（纸面 mm）、`45=模型视高`**，
   `41/45 = 1/k`（1:1 → 1，1:2 → 0.5）。这个语义用不对称视口（`size=(100,2)`）实测确认过：
   `research/probe-vp-40-41.dxf` + `research/probe-vp.png`（渲染出来是一条 100×2 的细缝）。

研究阶段**没改任何产品代码**（本目录先落研究文件，实现是第 2 步）。

研究脚本都可重跑（只需一个装了 `ezdxf` 的临时 venv，脚本内路径全部相对本目录）：

```bash
python3 -m venv /tmp/venv-dxf && /tmp/venv-dxf/bin/pip install ezdxf
cd docs/evidence/dxf-depth/research
/tmp/venv-dxf/bin/python audit_samples.py      # 5 份样本 ezdxf 读回 + audit
/tmp/venv-dxf/bin/python audit_tarikjabiri.py  # 路线 B 的 DIMENSION 为什么不能用
/tmp/venv-dxf/bin/python diff_entities.py      # 我的实体 vs ezdxf 规范化后的组码差
/tmp/venv-dxf/bin/python diff_tables.py        # 符号表/块的组码差
/tmp/venv-dxf/bin/python resave_compare.py     # 用 ezdxf 另存后对比结构清单
/tmp/venv-dxf/bin/python dump_vport.py         # 参考样本的 VPORT 表记录
```

渲染 PNG（模型空间 / 图纸空间，§10）另需 matplotlib，命令见 §10.5。


### 1.1 研究里踩到的两个坑（都写进 `research.md` §5）

- **ezdxf `audit()` 0 错误 ≠ 文件能被 CAD 打开**。第一版 R2000 在 QCAD 3.33.1 里
  `Null object Id: <object> (0)` 整份拒收，原因是缺 `100` 子类标记（实体、符号表记录都有）、
  符号表头缺 `330 0`/`100 AcDbSymbolTable`、块内实体属主写成模型空间、
  `LAYOUT.331` 指向一个不存在的句柄、图纸空间折线的 VERTEX/SEQENT 漏了 `67 1`。
- **QCAD 的无头渲染不画标注文字/箭头**：本仓库的文件和 ezdxf 的参考样本
  （`research/ref-model.png`）表现一致，所以「数字对不对」由组码读回证明，不由位图证明。

---

## 2. 改动清单

| 文件 | 改动 |
|---|---|
| `src/drawing/dxfExport.ts` | 新增 R2000 图纸结构：`DIMSTYLE` 表、`BLOCK_RECORD` 表、`BLOCKS` 段（`*Model_Space`/`*Paper_Space`/匿名标注块）、真 `DIMENSION` 实体、A3 图纸空间图框/标题栏/技术要求区、`VIEWPORT`、`OBJECTS`（根字典 + `ACAD_LAYOUT` + `LAYOUT`）、实体子类标记。**R12 分支逐字节不变**（见 §6）。新增导出常量 `DXF_SHEET_A3`、`A3_LAYOUT`、`DXF_DIM_STYLE_NAME`、`sourceMarkerOf()`；`DxfBuildResult` 增 `sheet` / `dimensions` / `viewport` / `counts.dimension` / `counts.viewport` |
| `src/drawing/dxfExport.test.ts` | D-01/D-02 的 2000 分支改成版本相关（模型空间计数、标注文字从匿名块读）；**新增 D-09～D-13**（见 §3） |
| `src/drawing/dxfR12Freeze.test.ts` | **新增**：R12 golden SHA-256 冻结（4 个比例/场景） |
| `desktop/tests/dxfExport.test.ts` | D-07 的 2000 读回把匿名块里的文字一起算（否则读不到标注数字） |
| `scripts/dxf-export-evidence.ts` | 旧证据脚本改成版本相关（模型空间计数、块内文字、包围盒排除图纸空间） |
| `scripts/dxf-depth-samples.ts` + `vitest.dxf-depth.config.ts` | **新增**：本任务样本生成器（5 份样本 + `samples/index.json`） |
| `README.md` | 把「DXF 的实情」拆成 R12 / 2000 两段，明确 R12 保持现状（无 DIMENSION/LAYOUT/VIEWPORT） |
| `docs/evidence/dxf-export/*` | 跑旧证据脚本时被重新生成（2000 样本内容变了；**R12 样本文件没变**，`git status` 只显示 2000 那一个） |

冻结区**没动**：纸面→模型换算（`x=k·x_paper`、`y=k·(纸面高−y_paper)`、`k=分母/分子`）、
R12 白名单、`DrawingData` 生成逻辑（只改导出层）、无新依赖、无原生模块、不联网。

---

## 3. 新增用例

| 用例 | 断言什么 |
|---|---|
| **D-09** 2000 的真 DIMENSION（6 条） | 3 条 `DIMENSION`（模型空间里尺寸层不再有 LINE/TEXT 冒充标注）；`70` = 32/35/35（长度 + 两个直径 + 位 32）；每条指向自己的 `*D1/*D2/*D3`，块里有线有文字（长度块 7 线 + 1 文字）；**改 q → `42`/`1` 跟着变**（12.05→12.4）；`DIMSTYLE` 名被引用且句柄组码是 `105`；定义点是模型坐标（纸面 (80,110)→模型 (80,100)、界线 y=113、直径 10↔15 距离 = 32） |
| **D-10** A3 图幅（4 条） | `$PLIMMAX=420×297`；两个 `LAYOUT` 的 `44/45=420/297`、`71=0/1`、`Layout1.76=1` 且 `331` 指向真实 VIEWPORT 句柄；图框折线在图纸空间 10..410 / 10..287（400×277 内框）；模型空间仍是 12.05×32 真实尺寸 |
| **D-11** 视口比例（4 条） | 1:1 / 1:2 / 2:1：`40=360`、`41=208` 不随比例变，`45=208k`，`41/45=1/k`；视口 `67=1`、`100 AcDbViewport`、属主是 `*Paper_Space` 的块记录 |
| **D-12** 标题栏（3 条） | 零件名/隔套/材料/45 钢/版本/草稿 v1/`1:2 · mm`/`A3 横向 · 第三角`/日期都在图纸空间；有来源写 basis 原文（文档名+页），无来源写「依据：用户输入，无外部原文件」；版本栏「草稿 · 第 3 版」，图上无 ≥32 位十六进制串（连组码 1 全部扫过） |
| **D-13** R12 不变（2 条） | R12 里 `DIMENSION`/`LAYOUT`/`VIEWPORT`/`BLOCK_RECORD`/`DIMSTYLE` 出现次数都是 0；实体仍只有 `LINE/POLYLINE/CIRCLE/TEXT`；尺寸层的线和文字仍在 ENTITIES（没有匿名块） |
| **R12 冻结**（4 条） | R12 输出字节数与 SHA-256 与 `main@791483c` 一致（4 个场景） |

刷新旧用例的地方：D-01 的 2000 分支改成「模型空间实体计数 + 标注文字从匿名块读」，
D-02 的标题栏文字高度断言拆成 R12（3→6，模型空间）与 2000（图纸空间恒 3，另加一条新用例）。

---

## 4. 变异验证（M27 / M28）

脚本：`mutations/run-mutations.sh` + `mutations/mutate.py`（改坏 → 跑 → 还原 → 再跑）。

| 变异 | 结果 | 日志 |
|---|---|---|
| **M27** 2000 的标注退回「几何 + TEXT」 | **8 条红**（D-09 全部 6 条 + D-01 的 2000 分支 + D-02 的 2000 分支）→ 还原后 33 条全绿 | `logs/50-M27-red.log` / `logs/51-M27-green.log` |
| **M28** 视口比例写死 `45 = heightMm`（1:1） | **2 条红**（D-11 的 1:2 与 2:1）→ 还原后 33 条全绿 | `logs/52-M28-red.log` / `logs/53-M28-green.log` |

两次还原后 `cmp` 都确认 `src/drawing/dxfExport.ts` 与备份逐字节一致（脚本最后一行打印）。

---

## 5. 样本与 SHA-256

`npx vitest run --config vitest.dxf-depth.config.ts` 生成（断言不过就不生成）。

| 样本 | 字节 | SHA-256 |
|---|---|---|
| `samples/spacer-20x32x12.05-dxf-r12-1x1.dxf` | 8,689 | `a5bd8e12ba25c2f5ff7e14bd3d55e50e727d930fd77b95f66fe0302f9c29d31a` |
| `samples/spacer-20x32x12.05-dxf-r12-1x2.dxf` | 8,717 | `0e4754f775567f371e610c04d76592043e2b4506516e24c0f5438e545b6e25a7` |
| `samples/spacer-20x32x12.05-dxf-2000-1x1.dxf` | 21,231 | `d943b2c3c02522145cd288ae43d9364750d141478438aee0bef8052ce5c557c4` |
| `samples/spacer-20x32x12.05-dxf-2000-1x2.dxf` | 21,264 | `1aba5d95e649c30a61eec0ca544adc79e32e4dc326db8fabead93cea92ca8b10` |
| `samples/spacer-20x32x12.05-dxf-2000-1x2-userinput.dxf` | 21,293 | `778a2e32ac8f16627fe96ec340fb683f96b1b2a7a1e32f683facf9ecd54b9663` |

第 5 份是**无来源项目**：`frame.fields.basis = 依据：用户输入，无外部原文件`，
文件名带 `-userinput`，标题栏与技术要求区都写着这句话（两处都在）。

`samples/index.json` 里每份样本都记了：图幅、视口 `40/41/45`、`LAYOUT` 的 `44/45/76`、
3 条 DIMENSION 的块名/类型/实测值、标题栏里与来源/版本相关的文字、`hex32Leaks`（必须为空）。

### 5.1 第三方读回

| 工具 | 结果 | 日志 |
|---|---|---|
| `dxf-parser` 1.1.2（仓库既有 devDependency，产品测试里跑） | 3 条 `DIMENSION`（`dimensionType` 32/35/35、`block` `*D1/*D2/*D3`、`actualMeasurement` 12.05/20/32）、`TEXT` 都在匿名块里、图纸空间实体 `inPaperSpace=true` | `npm test`（`src/drawing/dxfExport.test.ts`） |
| **ezdxf 1.4.2** `readfile` + `audit()` | **5 份样本全部 `audit errors = 0, fixes = 0`**；`dxfversion` AC1009/AC1015 正确；DIMENSION 的 `geometry`/`dimstyle`/`defpoint`/`text`/`actual` 全部读出；`Layout1` 视口 `width=360 height=208 view_height=208/416` | `logs/30-ezdxf-audit.log`（脚本 `research/audit_samples.py`） |

---

## 6. R12 保持不变的证明

三道证据，互相独立：

1. **逐字节对比**（临时把 `main` 的 `dxfExport.ts` 原样拷成模块，同一份 `DrawingData` 各生成一次）：
   4 个场景（1:1 / 1:2 / 2:1 / 1:1+无来源）**字节数、SHA-256、每个字节都相同** →
   `logs/31-r12-byte-identical.log`（`R12_SAME 1:1 bytes=8676 sha256=bdbb9aa9…` 等）。
2. **golden 冻结用例**：把上面这 4 组哈希写进 `src/drawing/dxfR12Freeze.test.ts`，
   以后任何人改动 R12 输出都会红。
3. **旧证据脚本重跑**：`npx vitest run --config vitest.dxfexport.config.ts` 之后
   `git status` 里只有 `docs/evidence/dxf-export/samples/…-dxf-2000.dxf` 变了，
   **`…-dxf-r12.dxf` 没有出现在改动列表**（R12 样本字节没变）。

另外 `D-13` 用例直接从组码层面断言：R12 文件里 `DIMENSION`/`LAYOUT`/`VIEWPORT`/`BLOCK_RECORD`/`DIMSTYLE`
出现次数为 0，实体集合仍限于 `LINE/POLYLINE/CIRCLE/TEXT`，尺寸仍是「几何 + TEXT」。

---

## 7. 看图软件实测（用了什么、看到了什么、哪里没做到）

**软件：QCAD 3.33.1**（Homebrew cask `qcad 3.33.1,13-26-qt6`，`/Applications/QCAD.app`）。
本机没有 AutoCAD；LibreCAD 的 cask 被 Homebrew 以 Gatekeeper 为由禁用，所以选 QCAD。
（另有 ezdxf 1.4.2 作为独立的严格读回校验器，不是看图软件。）

| 证据 | 文件 | 说明 |
|---|---|---|
| QCAD 把标注**识别成标注对象** | `samples/*-2000-*.svg` 里 `<!-- Rotated Dimension -->` ×1、`<!-- Diametric Dimension -->` ×2 | QCAD 的 SVG 导出按实体类型打注释。**对照**：同图纸的 R12 文件只有 `<!-- Line -->` ×29、`<!-- Polyline -->` ×4、`<!-- Circle -->` ×2，**零 Dimension** —— 同一张图，R12 是线，2000 是标注 |
| A3 图幅 + 标题栏 + 技术要求区 | `screenshots/qcad-sheet-2000-1x2.png`（1:1 版 `qcad-sheet-2000-1x1.png`） | QCAD 渲染图纸空间：420×297 横向外框、右下 10 行标题栏（标签 + 值两列）、左下技术要求区 |
| 零件几何（模型空间） | `screenshots/qcad-model-2000-1x2.png`、`qcad-model-r12-1x1.png` | R12 那张能看到 `12.050`、`⌀20.000`、`⌀32.000`（它是普通 TEXT，QCAD 画得出来） |
| 1:2 视口 | 组码 `40=360 41=208 45=416` + `samples/index.json` 的 `viewport` 字段 + `logs/30-ezdxf-audit.log` | 数值证据；`index.json` 同时断言「视口在模型里覆盖的窗口 ⊇ 图形包围盒」，即零件确实装得进这个 1:2 视口 |

### 没做到的两件事（如实写，不编）

1. **没有 GUI 点选属性面板的截图**。本机 `screencapture` 无权限
   （`could not create image from display`）、辅助功能（AX）也无权限，
   无法在 QCAD 界面上点选尺寸再截属性面板。替代证据是上面第 1 行的
   **QCAD 实体类型注释**（`<!-- Rotated Dimension -->`）——它来自 QCAD 自己的导出器，
   不是我们写的文本。
2. **位图渲染看不到标注数字/箭头**。QCAD 3.33.1 的无头 `dwg2bmp`/`dwg2svg` 不绘制
   DIMENSION 的文字与箭头；**对照组** ezdxf 参考样本 `research/ref-r2000.dxf` 渲染出来
   也一样是空壳（`research/ref-model.png`）。所以图上「12.050」这类数字由组码读回证明
   （`1=12.050`、`42=12.05`、`5` 号块 `*D1` 里的 `TEXT`），不是由截图证明。
   中文在无头渲染里显示为 `?????`，因为文件用的是 `txt.shx/hztxt.shx`（中文 CAD 惯例），
   这台机器上 QCAD 的无头渲染找不到这两个字体；文字内容本身由 dxf-parser/ezdxf 读回证明。

> **这两条已在 §10 用 ezdxf 的 drawing addon 补上**：换渲染器后，模型空间能看到三条尺寸的
> 尺寸线/箭头/数字，图纸空间能看到图框 + 标题栏 + 视口里的零件与尺寸，中文也不是乱码。
> §10 同时解释了 QCAD 为什么渲不出来，免得下一个人以为图坏了。

---

## 8. 六条命令 + 打包（真实输出）

| # | 命令 | 结果 | 日志 |
|---|---|---|---|
| 1 | `npm run typecheck` | exit 0 | `logs/20-typecheck.log` |
| 2 | `npm run typecheck:desktop` | exit 0 | `logs/21-typecheck-desktop.log` |
| 3 | `npm run lint` | exit 0（无输出） | `logs/22-lint.log` |
| 4 | `npm test` | **108 文件 / 1184 用例全过**（基线 107/1159） | `logs/23-test.log` |
| 5 | `npm run test:desktop` | **41 文件通过 + 2 跳过；285 通过 + 17 跳过**（与基线一致） | `logs/24-test-desktop.log` |
| 6 | `npm run build` | `✓ built in 224ms` | `logs/10-build.log` |
| 7 | `npm run package:desktop -- --arch=arm64` | `RESULT PASS 打包产物中的 pdf worker 可被 main.cjs 运行时加载` | `logs/11-package.log` |
| 8 | `npm run check:package:pdf-worker` | `RESULT PASS` | `logs/12-check-pdf-worker.log` |
| 9 | `npx vitest run --config vitest.dxf-depth.config.ts` | 1 用例通过，生成 5 份样本 | 见 §5 |
| 10 | `npx vitest run --config vitest.dxfexport.config.ts` | 1 用例通过（旧回环证据，R12 样本未变） | — |

---

## 9. 未做 / 已知限制

1. **有来源项目的「文档名+页」没写进标题栏**。`DrawingData` 只有 `frame.fields.basis`
   这一个来源载体（生成逻辑冻结，不许改），没有文档名/页字段。所以：
   basis 有值 → 原样写进标题栏（无来源项目就是「依据：用户输入，无外部原文件」）；
   basis 为空（有来源项目）→ 写「依据：本图档未记录来源文档名/页」。
   要真正写「《xxx.pdf》第 3 页」，得在 `revisions/compute.ts` 里把来源信息塞进
   `frameFields`（属于改生成逻辑，本任务不做）。
2. **QCAD 会重算标注**，不显示匿名块里的原生图形（无头渲染还丢文字/箭头）。文件里
   `*D1/*D2/*D3` 的线条与文字是完整的（组码读回可验），AutoCAD 系编辑器按块显示；
   QCAD 的表现是它自己的渲染策略，不是文件缺陷。
3. **只做了隔套一张图**（`DrawingData` 本来就只有这一个模板）；A3 版式是导出层按
   `A3_LAYOUT` 常量画的，不跟随 `DrawingData.paper`（后者仍是 A4，属冻结区）。
4. **没有出 PDF 打印版的 A3**（本任务只管 DXF）。
5. 视口尺寸取固定 `360×208`（纸面 mm），不是自动适配零件大小；零件变大到超出视口时
   目前不会报警（只有 `scripts/dxf-depth-samples.ts` 里的样例断言检查了包围盒）。

---

## 10. 「图能看」的正面证据：换 ezdxf 渲染（QCAD 渲不出来 ≠ 文件坏了）

§7 里 QCAD 的三张位图**不能**证明「人打开图能看见标注」：A3 图框 + 标题栏在，但视口里是空的；
模型图上看不到任何尺寸线/箭头；中文是方块。所以换一个**真会画 DIMENSION、也真会画视口**的
渲染器重渲：ezdxf 的 `addons.drawing`。结论：**同一批文件渲得出来，图是好的**，
QCAD 渲不出来是它的渲染策略问题（§10.4 逐条说明）。

### 10.1 用了什么（版本 + 后端）

| 项 | 值 |
|---|---|
| 渲染库 | `ezdxf` **1.4.2**（Python 3.9.6，项目内 venv `~/DSH/.venv-dxf-render`） |
| 后端 | **`ezdxf.addons.drawing.matplotlib.MatplotlibBackend`**（ezdxf 官方 drawing addon 的 matplotlib 后端，`qsave()` + Agg） |
| 其余 | matplotlib **3.9.4**、numpy 2.0.2、Pillow（随 matplotlib 装） |
| 渲染配置 | `background_policy=WHITE`、`color_policy=BLACK`、`min_lineweight=0.18`（黑白打印效果，最利于判读） |
| 脚本 | `research/render_ezdxf.py`（可重跑，§10.5 给命令） |
| 运行日志 | `logs/62-ezdxf-render.log`（下面每条数字都在里面） |

### 10.2 三张（+2 张放大）图，及每张能看到什么

| 图 | 渲染对象 | 能看到什么 |
|---|---|---|
| `screenshots/render-model-2000-1x1.png` | `...-dxf-2000-1x1.dxf` 的 **Model 空间** | `12.050` 的**尺寸线 + 两端箭头 + 尺寸界线**；`⌀20.000` / `⌀32.000` 两条**引线箭头分别咬在内外圆上**；剖视 + 端视轮廓、中心线；底部中文注释「第三角投影：右端视图置于主视图右侧」 |
| `screenshots/render-layout-2000-1x1.png` | 同一文件的 **`Layout1`（A3 图纸空间）** | A3 图框（420×297）+ 右下 10 行标题栏 + 左下技术要求区 + **视口里的零件与三条尺寸**（标注线、箭头、数字都在） |
| `screenshots/render-layout-2000-1x2.png` | `...-dxf-2000-1x2.dxf` 的 `Layout1` | 同上，标题栏「比例/单位」= `1:2 · mm`，视口里的零件明显更小 |
| `screenshots/render-layout-2000-1x1-viewport-zoom.png` | 上面两张的纸面 `x=30..390, y=72..280` 裁剪 | 1:1：零件纸面 **12.05×32 mm**，尺寸线两端箭头清楚、`12.050` 在线上方 |
| `screenshots/render-layout-2000-1x2-viewport-zoom.png` | **同一纸面矩形**的裁剪 | 同一零件变成 **6.03×16 mm**（正好一半），标注文字仍是 3.5 mm（纸面字高不随比例变） |

### 10.3 不靠眼睛的三条量化（都在 `logs/62-ezdxf-render.log`）

1. **标注真的被画进位图**：模型空间渲染两遍，第二遍用 `filter_func` 去掉 3 条 `DIMENSION`
   → 两张 PNG 的墨迹差 **58,111 px**（差分包围盒覆盖整个标注区域）。没画出来就不可能有差。
2. **视口真的把模型内容画进位图**：图纸空间渲染两遍，第二遍去掉 `VIEWPORT`
   → 1:1 差 **36,567 px**（差分纸面矩形 `x=200.24..357.63, y=108.71..201.08`）、
   1:2 差 **34,318 px**（`x=203.20..349.84, y=108.71..193.29`），都落在视口 `30..390 / 72..280` 内。
3. **视口比例不是写死的**：在渲染图上按纸面 mm 量 `12.050` 那条尺寸线的长度
   → 1:1 = **11.77 mm**、1:2 = **5.84 mm**，比值 **2.01**（理论 `12.05 / 6.025 = 2.00`；
   差值来自 300 dpi 下阈值化墨迹宽度）。
   同时 `research/render_ezdxf.py` 用视口自己的变换矩阵 `get_transformation_matrix()` 预测
   轮廓层纸面尺寸：1:1 = `122.03×32.00 mm`、1:2 = `111.01×16.00 mm`（剖视 12.05 与端视 32 横向排开，
   所以 x 是两张视图的跨度；y 的 32 → 16 就是 1:2），渲染结果与预测一致。

### 10.4 为什么 QCAD 渲不出视口内容（不是文件坏了）

1. **`dwg2bmp -block=*Paper_Space` 只画图纸空间自身的实体**，不会把 `VIEWPORT` 里的模型内容
   变换、裁剪进视口 → 图框、标题栏、技术要求都在，**视口位置是空白**。
   （`qcad-sheet-2000-1x1.png` 的空白就是这样来的。）

2. **QCAD 导入后自己重算标注，不画匿名块里的原生图形**。文件里 `*D1/*D2/*D3` 的线、箭头、
   文字是完整的（组码读回可验：`*D1` 7 条 LINE + TEXT `12.050`，`*D2/*D3` 各 4 条 LINE + 直径文字，
   见 `logs/62-ezdxf-render.log` 的 `DIMENSION` 三行），AutoCAD 系编辑器按块直接显示；QCAD 走它自己的
   标注重算路径，无头渲染连重算出来的文字/箭头也一并丢掉 → 模型图上看不到尺寸。
   QCAD 的 SVG 导出其实**认得**这是标注（`<!-- Rotated Dimension -->` ×1、`<!-- Diametric Dimension -->` ×2，
   见 §7 第 1 行），只是没把几何画进位图。

3. **中文在 QCAD 里是乱码方块，但文件本身没坏**：文件文字样式是 `txt.shx` + 大字体 `hztxt.shx`
   （中文 CAD 惯例），这台机器上没有这两个 SHX，QCAD 无头渲染就画成方块/`?????`；
   而且它**不读 `$DWGCODEPAGE`**。文件里 `$DWGCODEPAGE = ANSI_936`、文字内容按 GBK 编码，
   dxf-parser（GBK 解码）与 ezdxf 都读出正确中文；ezdxf 渲染时把 `txt.shx` 替换成
   `Arial Unicode.ttf`（Arial Unicode MS，`logs/62-ezdxf-render.log` 第 11–12 行的
   `STYLE '标准' … -> 渲染用 FontFace(filename='Arial Unicode.ttf', …)`），
   所以上面 5 张图里中文正常。

4. **同一个文件、换渲染器的对照**：QCAD 位图 = 视口空白 + 无尺寸 + 方块中文；
   ezdxf = 图框 + 标题栏 + 视口内零件与尺寸 + 正常中文。差别在渲染器，不在 DXF。

### 10.5 复算

```bash
# 项目内装依赖（不装全局）
python3 -m venv ~/DSH/.venv-dxf-render
~/DSH/.venv-dxf-render/bin/pip install "ezdxf==1.4.2" matplotlib

cd docs/evidence/dxf-depth
~/DSH/.venv-dxf-render/bin/python research/render_ezdxf.py | tee logs/62-ezdxf-render.log
# 5 张 PNG 落到 screenshots/，stdout 里有 §10.3 的三条差分/量图数字
```

### 10.6 这张证据的边界（如实写）

1. **渲的是「文件里写了什么」**，不是「AutoCAD 打开一定长这样」。ezdxf 的 drawing addon 是
   独立实现，它的标注/视口语义可能与 AutoCAD 有细微差异（例如箭头被画成细三角、线宽按
   `min_lineweight` 归一化），但「尺寸是标注、视口里有零件」这两件事它证到了。
2. **`⌀` 符号略粗**：文字的 `%%c` 被 ezdxf 换成直径符号 `⌀` 并按填充路径绘制，在这个字体下
   笔画偏粗；数字内容（`20.000` / `32.000`）与组码 `1=%%c20.000` 完全一致。
3. **本机没有 AutoCAD**，所以「AutoCAD 里也这样」仍属未验证（本任务卡没要求）。
4. **别被 1:2 那份的模型包围盒骗了**：`...-1x2.dxf` 的模型包围盒是 `302.47×174.55 mm`，
   比 1:1 的 `161.78×95.27 mm` 还大。原因是本仓库的纸面→模型换算是 `模型 = 纸面 × k`
   （1:2 时 k=2），文字高度也跟着 ×2；**零件本身仍是真实尺寸**（剖视轮廓在模型里
   1:1 与 1:2 两份都是 `12.06×32 mm`，只是平移了位置），1:2 的“变小”发生在纸面：
   视口 `45=416`（=208×2）把它按 0.5 画到纸上 → 纸面 `6.03×16 mm`。这也是 §10.3 第 3 条的来由。
