# 出图加深 · 研究（第 1 步，先研究后写码）

分支 `agent/dxf-depth`，基线 `main` = `791483c`。
研究阶段**没有改任何产品代码**；本文所有结论都有可重跑的实测文件，全部落在
`docs/evidence/dxf-depth/research/`。

## 0. 实验环境（版本必须写清，截图/渲染都靠它）

| 工具 | 版本 | 用途 |
|---|---|---|
| QCAD | **3.33.1**（cask `qcad 3.33.1,13-26-qt6`，安装到 `/Applications/QCAD.app`） | 第三方看图/渲染：`dwg2svg`、`dwg2bmp` |
| ezdxf | **1.4.2**（python 3.9.6，临时 venv） | 独立的严格 DXF 实现：写参考样本 + `audit()` 校验 |
| dxf-parser | **1.1.2**（仓库既有 devDependency） | 产品测试里的读回 |
| `@tarikjabiri/dxf` | **2.10.0**（`npm pack` 到临时目录，**未装进仓库**） | 路线 B 的可行性实测 |

`LibreCAD` 的 cask 被 Homebrew 标记为 *Disabled because it does not pass the macOS
Gatekeeper check*（2026-09-01 禁用），因此选 QCAD。

> 本机限制（影响“截图”这条验收，先说清楚）：本会话 `screencapture` 直接失败
> （`could not create image from display`），辅助功能（AX）权限也没有，无法用脚本点选
> QCAD 属性面板。所以**没有 GUI 点选截图**；替代证据是 QCAD 自己的渲染器输出
> （`dwg2svg` 会按实体类型打注释）与 `dwg2bmp` 位图。见 §4。

---

## 1. R2000 的 `DIMENSION` 最小可用字段集

### 1.1 参照样本怎么来的

用 ezdxf（成熟、严格）写一份 R2000 参考样本，再把它写出的组码原样 dump：

```python
dim = msp.add_linear_dim(base=(0, 20), p1=(0, 0), p2=(100, 0), dimstyle="EZDXF")
dim.render()          # render() 才生成匿名几何块 *D1
```

产物：`research/ref-r2000.dxf`；组码 dump：`research/ezdxf-reference-tags.txt`、
`research/ezdxf-reference-objects.txt`。

ezdxf 写出的 `DIMENSION` 实体原文（`ezdxf-reference-tags.txt` 第 3 行）：

```
0=DIMENSION 5=8B 330=17 100=AcDbEntity 8=0 100=AcDbDimension 2=*D1 3=EZDXF
10=0.0 20=20.0 30=0.0 11=50.0 21=22.375 31=0.0 70=32 71=5 1=<>
100=AcDbAlignedDimension 13=0.0 23=0.0 33=0.0 14=100.0 24=0.0 34=0.0 50=0.0
100=AcDbRotatedDimension
```

### 1.2 最小字段集（缺一条 CAD 就不认）

| 组码 | 含义 | 本实现填什么 | 缺了会怎样 |
|---|---|---|---|
| `0` | `DIMENSION` | 固定 | 不是标注 |
| `5` | 句柄 | 递增 hex | R2000 必需 |
| `330` | 属主（`*Model_Space` 的 BLOCK_RECORD 句柄） | 块记录句柄 | 所有权错乱，audit 报错 |
| `100 AcDbEntity` / `8` | 子类标记 / 图层 | `尺寸` 层 | — |
| `100 AcDbDimension` | 子类标记 | 固定 | AutoCAD 不认该实体 |
| **`2`** | **几何块名（匿名块 `*D1`）** | `*D1`/`*D2`/`*D3` | **致命**：ezdxf `audit` 直接判 `UNDEFINED_BLOCK` 并删除该 DIMENSION（见 §2.2 实测） |
| `3` | 标注样式名（DIMSTYLE 表里的条目名） | `寸链尺寸` | 回退到 Standard，测量值/小数位不受控 |
| `10/20/30` | 标注线定义点（尺寸线位置） | 尺寸线中点 | 尺寸线跑到原点 |
| `11/21/31` | 文字中点 | 现有 `textPositionMm` 换算值 | 文字位置错 |
| **`70`** | 标注类型 + 位标志 | `0 | 32`（0=rotated/线性，32=`块被本尺寸引用`） | 低 4 位错 → 变成角度/半径标注；缺 32 位 → 有些软件当作“无几何块” |
| `71` | 文字附着点 | `5`（正中） | 文字偏移 |
| `1` | 文字覆盖值 | `<>`（= 用实测值）或既有 `12.050`/`%%c32.000` | 空值也可，但 `<>` 最稳 |
| `100 AcDbAlignedDimension` + `13/23/33`、`14/24/34`、`50` | 第一/第二界线原点 + 旋转角 | 两个被标注端点、`50=角度` | 线性尺寸必须 |
| `100 AcDbRotatedDimension` | 子类标记（70 低 4 位 = 0 时） | 固定 | — |

`42`（实测值 actual measurement）**不是必需**——AutoCAD/QCAD/ezdxf 都会自己按
`13`→`14` 算。本实现仍然写它，让「数值来自模型真值」在文件里可核对。

### 1.3 匿名块 `*D1` 里必须有东西

`ezdxf-reference-objects.txt` 里 `*D1` 的内容（`dim.render()` 的结果）：

```
LINE  (0,0.625)->(0,21.25)      界线
LINE  (100,0.625)->(100,21.25)  界线
INSERT _ARCHTICK  x2            箭头（块引用）
LINE  (0,20)->(100,20)          尺寸线
MTEXT "100"                     标注文字
POINT x3 (Defpoints 层)         定义点
```

结论：**DIMENSION 实体本身不画任何线**，它只指向匿名块；线条都在块里。所以：

- 现有「几何 + TEXT」的图元（尺寸线/界线/两条箭头线/文字）**原样搬进匿名块**即可，
  图形外观与现在完全一致；
- 块必须有自己的 `BLOCK_RECORD`（`0=BLOCK_RECORD ... 2=*D1`）和 `BLOCK ... ENDBLK`
  （`ezdxf-reference-tags.txt` 第 3 行给出 `0=BLOCK 5=8D 330=8C ... 2=*D1 70=1`——
  匿名标注块的 `70` 是 **1**，普通块是 0）。

### 1.4 DIMSTYLE 表条目

参考样本里 `Standard` 与 `EZDXF` 两条记录带全套变量（`40/41/42/.../179/271...`，
见 `ezdxf-reference-tags.txt` 第 6 行）。最小可用集合（本实现采用）：`2`（名）、`70`、
`40`（DIMSCALE）、`41`（DIMASZ 箭头）、`42`（DIMEXO 界线偏移）、`43`（DIMDLI）、
`44`（DIMEXE 界线延伸）、`140`（DIMTXT 字高）、`147`（DIMGAP）、`77`（DIMTAD 文字在线上）、
`271`（DIMDEC 小数位）、`278`（DIMDSEP 小数点）、`340`（DIMTXSTY 文字样式句柄，R2000 用 `340`）。
其余变量省略时由 CAD 用默认值，QCAD/AutoCAD 均正常（§2.3 用 QCAD 实测确认）。

**注意 R12 的 DIMSTYLE 用 `105` 而不是 `5` 作句柄组码**（参考样本第 6 行 `0=DIMSTYLE 105=2B`），
这是 DXF 的历史坑；R2000 同样用 `105`。

---

## 2. 三条路线：选 **A 自写**

### 2.1 路线 B（`@tarikjabiri/dxf` v2.10.0）—— 实测不合格

不看 README，直接装到临时目录写真文件、再读回。

**(a) 它确实有 Dimension 类**（`lib/index.d.ts` 第 294–443 行）：
`LinearDimension / AlignedDimension / DiameterDimension / RadialDimension / ArcDimension`，
也有 `DIMSTYLE` 表。所以“支持 DIMENSION”这句话表面成立。

**(b) 但它写出来的 DIMENSION 不完整**。实测（`research/lib-dimension-tarikjabiri.dxf`，
由 `new DxfWriter(); addLine(); addLinearDim()` 生成），该实体原文组码是：

```
0=DIMENSION 5=1B 330=C 100=AcDbEntity 8=0 100=AcDbDimension 70=0 71=5 1=100
100=AcDbAlignedDimension 13=0 23=0 33=0 14=100 24=0 34=0 50=0 100=AcDbRotatedDimension
```

缺 `2`（几何块）、缺 `10/11`（定义点、文字中点）、缺 `3`（标注样式）、缺 `42`。
**它完全不生成匿名块 `*D`**（文件里 `BLOCKS` 段只有 `*Model_Space`/`*Paper_Space`）。

ezdxf 读回并 `audit()`（脚本 `research/audit_tarikjabiri.py`）实测：

```
readfile OK, dxfversion = AC1015
msp entities: [('LINE', '1A'), ('DIMENSION', '1B')]
DIMENSION count: 1
  dim_type = 0 geometry block = None defpoint = (0.0, 0.0, 0.0) defpoint2 = (0.0, 0.0, 0.0)
blocks: ['*Model_Space', '*Paper_Space']
audit errors: 0 fixes: 1
  FIX AuditError.UNDEFINED_BLOCK Removed DIMENSION(#1B) without valid geometry block.
```

即：**严格校验器直接把这个 DIMENSION 删了**。它不是一个能被 CAD 正常显示/点选的标注对象。
这一条就足以判 B 不合格（任务卡 §0.2 的“选 B 必须先证明它真能写出 DIMENSION 并读回”）。

**(c) 它没有图纸空间能力**：`lib/index.mjs` 里 `LAYOUT` 出现 **0** 次、`VIEWPORT` 出现 **0** 次；
唯一的 `AcDbViewport*` 命中是 VPORT **表记录**（`AcDbViewportTableRecord`），不是图纸空间
`VIEWPORT` 实体。A3 图幅 + 视口这条它做不了，还得自己手写。

**(d) 它不支持 GBK**：`ANSI_936` / `DWGCODEPAGE` / `gbk` 在 `index.mjs` 里出现 **0** 次。
而本项目的 DXF 是 ANSI_936 + GBK 字节（`dxfGbk.ts`，D-05 已锁死），换库等于把中文编码
链路整条重做。

**(e) 破坏回归**：D-01～D-08 里大量断言是对**当前字节/组码**的精确断言（图层颜色、LTYPE
节距、`%%c` 控制码、`$MEASURING`、R12 白名单…）。换库必然重写这些，而任务卡要求
“D-01~08 原有用例全绿”“R12 保持现状”。

### 2.2 路线 C（其他）—— 无候选

- `dxf-writer`（JS）：只写几何，无 DIMENSION。
- 直接生成 DWG：需原生库 / ODA 商业授权，**违反“不引原生模块”**。
- 服务端转换：**违反“不联网”**。

### 2.3 路线 A（自写）—— 选定

理由：

1. 现有 `dxfExport.ts` 已经是一个**完整、可控、逐字节可预测**的 R2000 写出器（HEADER/TABLES/
   BLOCKS/ENTITIES、句柄分配、GBK 编码、`%%c` 控制码），缺的只是 `DIMSTYLE` 表、匿名块、
   `DIMENSION` 实体、`BLOCK_RECORD` 表、`LAYOUT` 对象、`VIEWPORT` 实体这几块“小众结构”；
2. 这几块的组码已经由 ezdxf 参考样本逐条给出（§1、§3），照抄结构即可，风险可控；
3. R12 路径可以**一行都不动**，回归天然保住；
4. 无新依赖、无原生模块、无联网。

实测确认 A 可行：参考样本 `ref-r2000.dxf` 由 QCAD 3.33.1 导入并渲染，`dwg2svg` 输出里
该标注被渲成 `<!-- Rotated Dimension -->`（`research/ref-r2000.svg` 第 4 行区域），
而不是 `<!-- Text -->` + `<!-- Line -->`。这就是“CAD 认它是标注”的直接证据。

---

## 3. 图纸空间 `LAYOUT` / `VIEWPORT` 怎么做

### 3.1 需要新增的四类结构

**(1) `BLOCK_RECORD` 表**（参考样本第 2 行）：

```
0 TABLE 2 BLOCK_RECORD 5 <h> 330 0 100 AcDbSymbolTable 70 <n>
0 BLOCK_RECORD 5 <h> 330 <table h> 100 AcDbSymbolTableRecord 100 AcDbBlockTableRecord 2 *Model_Space
0 BLOCK_RECORD 5 <h> 330 ... 2 *Paper_Space
0 BLOCK_RECORD 5 <h> 330 ... 2 *D1
0 ENDTAB
```

**(2) `BLOCKS` 段里的 `*Model_Space` / `*Paper_Space` / 匿名块**：

```
0 BLOCK 5 <h> 330 <block_record h> 100 AcDbEntity 8 0 100 AcDbBlockBegin 2 *Paper_Space 70 0
      10 0 20 0 30 0 3 *Paper_Space 1 <空>
  ... 图元（图纸空间图元写在这里或 ENTITIES 里，二选一，不能重复）
0 ENDBLK 5 <h> 330 <block_record h> 100 AcDbEntity 8 0 100 AcDbBlockEnd
```

匿名标注块 `2 *D1` + `70 1`。

**(3) `ENTITIES` 段**：模型空间图元 `67` 缺省（=0）；图纸空间图元写 `67 1`。
一个 `VIEWPORT` 实体（图纸空间）：

```
0 VIEWPORT 5 <h> 330 <*Paper_Space block_record h> 100 AcDbEntity 67 1 8 <layer>
100 AcDbViewport 10 <cx> 20 <cy> 30 0 40 <宽> 41 <高> 68 2 69 <id> 12 <vx> 22 <vy>
13 0 23 0 14 10 24 10 15 10 25 10 16 0 26 0 36 1 17 0 27 0 37 0 42 50 43 0 44 0
45 <模型视高> 50 0 51 0 72 100 90 0 1 <空> 281 0 71 0 74 0 110 0 120 0 130 0
111 1 121 0 131 0 112 0 122 1 132 0 79 0 146 0
```

### 3.2 关键坑：`40/41` 到底是“宽/高”还是“高/宽高比”

DXF 参考文档里 VPORT **表记录**是 `40=视高, 41=宽高比`；图纸空间 **VIEWPORT 实体**在
ezdxf 里是 `40=宽(width), 41=高(height)`（`ezdxf/entities/viewport.py` 第 59/61 行：
`"width": DXFAttr(40,...)`、`"height": DXFAttr(41,...)`）。

两种读法差异巨大，做个**不对称视口实验**定死（`research/probe-vp-40-41.dxf`，
`size=(100,2)` → 文件里 `40=100, 41=2`）：

- 若 `40=宽/41=高`：视口框 = 100×2（一条细缝）
- 若 `40=高/41=宽高比`：视口框 = 200×100（一个宽扁矩形）

QCAD 3.33.1 渲染结果 `research/probe-vp.png`：**是一条 100×2 的细缝**（420mm 图框内
视口只有几像素高）。同一实验在 `research/ref-r2000.dxf`（`40=300,41=150`）上渲染出的
是 300×150 的矩形（`research/ref-layout1.png`）。

**结论（实测）：图纸空间 `VIEWPORT` 的 `40=视口宽（纸面单位）`、`41=视口高（纸面单位）`；
比例由 `45`（模型视高）与 `41` 的比值决定：`纸面高 41 / 模型视高 45 = 1/k`。**
即 1:1 → `45 = 41`；1:2 → `45 = 41 × 2`。

### 3.3 A3 420×297 与两个比例怎么落

- 图纸空间单位 = 纸面 mm，因此图框/标题栏坐标就是真实 mm：A3 横向 `420 × 297`，
  内框留 10mm 边（`10,10`–`410,287`）。**与 `scale` 无关**（这正是视口存在的意义）。
- 视口尺寸（纸面）：取 `360 × 240`（能装下零件与标注）。
- `45 = 240 × k`：1:1 → `240`；1:2 → `480`；`12/22` = 模型视图中心。
- 模型空间仍然是 1:1 真实尺寸零件（`x=k·x_paper`、`y=k·(纸面高−y_paper)` 不变）。

### 3.4 `LAYOUT` 对象（`OBJECTS` 段）

参考样本第 9/12 行，每个布局两条子类：

```
0 LAYOUT 5 <h> 330 <ACAD_LAYOUT 字典 h>
100 AcDbPlotSettings  1 <页面名> 4 A3  44 420.0 45 297.0  72 1 73 0 74 5 75 16 76 0 77 2 78 300 ...
100 AcDbLayout        1 <布局名> 70 1 71 <序号> 10 0 20 0 11 420 21 297 12 0 22 0 32 0
                     14 1e+20 24 1e+20 15 -1e+20 25 -1e+20 146 0
                     13 0 23 0 33 0 16 1 26 0 36 0 17 0 27 1 37 0
                     76 <视口数> 330 <块记录 h> 331 <视口实体 h>
```

`71` = 标签页顺序（Model=0，第一个图纸空间=1）；`76` = 该布局的视口数；`331` 逐个列视口句柄。

`OBJECTS` 段还需要根字典 + `ACAD_LAYOUT` 字典（第 15 行）：

```
0 DICTIONARY 5 A 330 0 100 AcDbDictionary 281 1 3 ACAD_LAYOUT 350 D
0 DICTIONARY 5 D 330 A 100 AcDbDictionary 281 1 3 Layout1 350 <LAYOUT h>
```

### 3.5 R12 怎么办

R12（AC1009）没有 `LAYOUT`、没有 `VIEWPORT`、也没有 `DIMENSION` 的必要块结构约定。
任务卡要求 **R12 保持现状**：单张、模型空间、几何 + TEXT。所以 R2000 的新能力
全部走 `version === '2000'` 分支，R12 代码路径不进入。

---

## 4. 关于“看图软件实测截图”

- QCAD **3.33.1** 已安装并能真实导入本项目的 DXF：`dwg2svg` / `dwg2bmp` 均可用，
  渲染结果见 `research/ref-layout1.png`、`research/probe-vp.png`。
- **但不能提供“点选尺寸 → 属性面板显示标注”的 GUI 截图**：本会话 `screencapture`
  报 `could not create image from display`（无屏幕录制权限），AX 也无权限，无法脚本点选。
- 替代证据（非伪造，可重跑）：
  1. QCAD `dwg2svg` 输出里按实体类型写的注释：`<!-- Rotated Dimension -->`
     （若是“文字+线”，这里只会出现 `<!-- Line -->` / `<!-- Text -->`）；
  2. QCAD `dwg2bmp` 渲出的位图（A3 图框、1:2 视口、标注可见）；
  3. ezdxf `readfile` + `audit()`：`dxftype=DIMENSION`、`audit errors=0`；
  4. `dxf-parser` 读回：`type === 'DIMENSION'`（产品测试里跑）。
- 交付文档会**如实写明“无 GUI 点选截图”**，不编。

---

## 5. 实测踩坑记录：ODA/QCAD 导入器到底要什么（自写实现必须照做）

写完第一版 R2000（DIMSTYLE + 匿名块 + DIMENSION + A3 图纸空间 + LAYOUT/VIEWPORT）后，
**ezdxf `audit()` 报 0 错误，但 QCAD 3.33.1 直接拒收**：

```
Warning:  RDwgImporter::importFile: reading: OdError:
   "RDwgServices::printErrorStackTrace: Null object Id: <object> (0)"
Warning:  "Import for file …dxf failed"
```

QCAD 的 DXF 导入走 ODA（Teigha）内核，比 ezdxf 严格得多。用「在已知可用文件上做减法 /
在自己文件上逐段删」的方式定位，结论如下（全部实测，非推测）：

| 必须写的东西 | 不写会怎样 | 证据 |
|---|---|---|
| 每个实体前的 **`100 AcDbEntity`**，以及实体专属子类（`AcDbLine` / `AcDbCircle` / `AcDb2dPolyline` / `AcDbVertex` + `AcDb2dVertex` / `AcDbText`，TEXT 在 `73` 前还要再来一次 `AcDbText`） | 整份文件拒收（Null object Id） | 组码逐条对比 `research/diff_entities.py` |
| **符号表记录的子类标记**：`100 AcDbSymbolTableRecord` + `AcDbLinetypeTableRecord` / `AcDbLayerTableRecord` / `AcDbTextStyleTableRecord` / `AcDbRegAppTableRecord` / `AcDbDimStyleTableRecord` / `AcDbBlockTableRecord` / `AcDbViewportTableRecord` | 同样拒收 | `research/diff_tables.py` |
| **`TABLE` 头** 的 `330 0` + `100 AcDbSymbolTable` | 拒收 | 同上 |
| **图纸空间折线的 VERTEX/SEQEND 也要 `67 1`** | 顶点被归到模型空间 | 同上（ezdxf 写出 67=1，我第一版漏了） |
| **块内实体的 `330` 必须是该块的 BLOCK_RECORD**（不是模型空间） | 拒收 | 实测：改前拒收，改后通过 |
| **`LAYOUT` 的 `331` 必须是真实 VIEWPORT 实体句柄** | 拒收 | 实测：先分配新句柄时拒收，改为写出时记录的真实句柄后通过 |

不需要的（实测删掉仍可导入）：`CLASSES` 段、`VIEW`/`UCS` 表、`ACAD_*` 系列字典
（根字典里只留 `ACAD_LAYOUT` 也能开）。`$HANDSEED` 用 `FFFF` 也没问题。

> 这些字段在 DXF 参考文档里散落在「组码 100 子类标记」「符号表」两章，容易整体漏掉；
> 而 ezdxf 的 `audit()` 不检查它们，**只有真 CAD 会拒收**。这就是为什么任务卡要求
> 「在看图软件里实测」。

### 5.1 渲染侧的限制（如实记录）

QCAD 3.33.1 的**无头位图/SVG 导出不绘制标注的文字与箭头**：

- 本仓库的 2000 文件渲染出来只有标注的引出线；
- **对照组**：ezdxf 参考样本 `research/ref-r2000.dxf` 渲染结果 `research/ref-model.png`
  同样只有一个光秃秃的尺寸线框、没有 `100` 数字。

所以「尺寸数字正确」这条**不能靠位图截图证明**，由 `dxf-parser` / `ezdxf` 读回组码证明
（`1=12.050`、`42=12.05`）。位图能证明的是：A3 图框/标题栏/技术要求区版式、零件几何、
以及 R12 与 2000 的对比（R12 的标注数字是会画出来的，因为它就是普通 TEXT）。

另外本机 `screencapture` 无权限（`could not create image from display`）、AX 也无权限，
**没有 GUI 点选属性面板的截图**。

---

## 6. 研究结论（一句话）

**走路线 A 自写**：仿 ezdxf 参考样本的组码结构，在 R2000 分支里补
`DIMSTYLE` 表 + `BLOCK_RECORD` 表 + 匿名标注块 + `DIMENSION` 实体 + A3 图纸空间 + `LAYOUT`/`VIEWPORT`；
R12 路径完全不动。路线 B 已被实测否掉（无几何块 → audit 判定 UNDEFINED_BLOCK 并删除；
且无 LAYOUT/VIEWPORT/GBK 能力）。自写实现必须同时满足 §5 的导入器要求，否则
ezdxf 能读、QCAD/AutoCAD 打不开。
