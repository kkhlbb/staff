# P2 公式行里的显式末尾值（`document-extractor-5`）

一句话：真实语料 45 条 `FORMULA_UNSUPPORTED` 里，**17 行的原文已经写出了「符号 = 表达式 = 数值 单位」的
结果值**，其中 16 行被救回（改判为赋值行，取末尾那枚**显式**值，**不做任何算术求值**），1 行因为中间夹着
第二处赋值而**继续阻塞**。真正不可解析的 28 行（纯符号函数式、缺单位、数值被文本层拆碎、符号位丢失）
原样保留 `FORMULA_UNSUPPORTED`。

```
分支          agent/extract-formula
基线          main 635384d（DXF 已合入）
实现提交      867b070（规则 + 夹具 + F-01～F-07 + 版本串同步）
规则版本      document-extractor-4 → document-extractor-5
诊断探针      docs/evidence/extract-formula/probe-formulas.mjs
用例          15 条断言（F-01～F-07 + 6 条纯函数形态 + 1 条出处完整性），全通过
真实文档      候选 126 → 131；pending 38 → 57；blocked 88 → 74；可确认率 30.2% → 43.5%
FORMULA_UNSUPPORTED  45 → 29
验收线（pending ≥ 50）  57，过了
变异 M22      关掉 P2 接管 → 6 failed / 9 passed；恢复 → 15 passed
```

---

## 一、诊断先于改码：45 条到底是什么

```bash
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs \
  node docs/evidence/extract-formula/probe-formulas.mjs            # 改前日志：logs/01-probe-before.log
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs \
  node docs/evidence/extract-formula/probe-formulas.mjs            # 改后日志：logs/02-probe-after.log
```

探针只做字符事实统计（不改规则、不求值、不猜变量），并对同一条原文调用**产品自己的**
`matchExpressionAssignment` 打印“产品形态命中”，所以改前/改后的差异是产品判定本身，不是第二套解析。

### 1.1 主归类（每条只归一类，合计 45）

| 归类 | 条数 | 分布 | 含义 |
|---|---|---|---|
| 末尾有「数值+单位」且等号左边是字母/希腊字母符号 | **17** | r2×2 r6×15 | 原文已给出结果值，**本任务的处理对象** |
| ├ 中间式纯加减 | 2 | r2·r6 | P1 本可解析，却被公式分支抢先（管道顺序缺陷） |
| └ 中间式含字母/乘除/括号 | 15 | r2·r6 | P1 形态未覆盖的写法 |
| 末尾有「数值+单位」但等号左边不是符号 | 5 | r2×2 r6×3 | `0=…=228.11mm`：符号位在文本层丢失，**不猜** |
| 末尾没有「数值+单位」 | 23 | r1×7 r2×5 r3×2 r6×9 | 纯符号函数式 / 缺单位 / 数值被拆碎 |

形态标记（多标签，一行可命中多个）：多等号 31｜含括号 36｜乘除混合 20｜含单位串 28｜希腊字母 17｜
含汉字 7｜±偏差 5｜含函数调用 2｜下标上标字符 **0**｜括号嵌套 **0**｜数字里连续点号（数值错乱）1。

> **下标/上标归一化（任务卡第 1 节候选方向 1）没有做**：诊断里 `下标上标字符 = 0`，45 条里一条都没有。
> 按任务卡“按诊断结果挑，不许全做”的要求，直接跳过。

### 1.2 关键发现：5 行连现有形态都命中，只是轮不到

改前探针里就有 5 条打印了「产品形态命中」——`Zmax`（redundant）、`B3`（single）、`a1`（deviation）、
`T0`（redundant）、`on`（deviation）。原因是 `buildExtractionDraft` 的行循环里
`parseFormulaLine` **排在赋值解析之前**，只要这一行含 `=`、没有独立数字、并且带 `[×÷*/()^]` 之一，
就当场变成 `FORMULA_UNSUPPORTED` 候选并 `continue`，P1 的三种形态永远看不到它。
这不是“公式判不了”，是**管道顺序把能读的行挡在了外面**。

### 1.3 45 条逐条归类与处理结果

“处理结果”列 = 本分支跑完后的实际结果（`logs/05-candidates-after.log` 可逐条核对）。

| # | 文档·页·idx | 原文（归一化后） | 主归类 | 处理结果 |
|---|---|---|---|---|
| 1 | r1 p41 idx4 | `A=( A+ A)-` | 无末尾值 | 仍阻塞（行尾是 `-`） |
| 2 | r1 p41 idx5 | `( A+A+A)=0` | 无末尾值·无符号 | 仍阻塞（`0` 无单位） |
| 3 | r1 p43 idx6 | `即 T= T- ( T+T+T+T) =0.5-0.2- 0.10-0.05-0.05` | 无末尾值 | 仍阻塞（末尾是式子，不是「数值+单位」） |
| 4 | r1 p63 idx10 | `准件), A=5` | 无末尾值 | 仍阻塞（`A=5` 无单位） |
| 5 | r1 p64 idx11 | `T=T=0.06 , T=T=0.04 , T=0.05 ( 标 准 件 不 能` | 无末尾值 | 仍阻塞（三段都无单位） |
| 6 | r1 p65 idx12 | `T=0.12 , T=T=0.10 , T=0.05 (标准件不能` | 无末尾值 | 仍阻塞 |
| 7 | r1 p65 idx13 | `得: A=43.05 A=43.05±T/2=43.05±0.075= ` | 无末尾值 | 仍阻塞（行尾 `=` 后为空） |
| 8 | r2 p3 idx4 | `于100.0-0.1=99.9mm(即L的 基 本 尺 寸` | 有末尾值·无符号 | 仍阻塞（等号左边是 `100.0-0.1`，没有符号位） |
| 9 | r2 p3 idx6 | `Zmax=5.2+0.1-4.9=0.4mm)` | 有末尾值·纯加减 | **取 Zmax 0.4 mm** |
| 10 | r2 p4 idx10 | `δL=δL-δL=0.25-0.10=0.15mm)补偿环尺` | 有末尾值·含字母 | **取 δL 0.15 mm** |
| 11 | r2 p4 idx11 | `-0.1.05-0.1.2-0.1Lb =43.100- (29.900+4.950+2.975-` | 无末尾值 | 仍阻塞（数值被文本层拆碎、行尾是 `-`） |
| 12 | r2 p4 idx12 | `5.35-0.1 mm.0.225=5.050mm)` | 有末尾值·无符号 | 仍阻塞（等号左边是 `…0.225`，且数值错乱） |
| 13 | r2 p4 idx14 | `2220.304-0.250=0.054(mm).` | 无末尾值 | 仍阻塞（单位在括号里、数值错乱） |
| 14 | r2 p4 idx15 | `δL= δL+δL4)` | 无末尾值 | 仍阻塞（右侧无任何数值） |
| 15 | r2 p4 idx16 | `δL+δbi = δL+δb +δbi5)` | 无末尾值 | 仍阻塞 |
| 16 | r2 p4 idx18 | `δL=δL- δL= δL-δLi7)` | 无末尾值 | 仍阻塞（末尾无数值） |
| 17 | r3 p2 idx0 | `x = ( rp+ lrp) sin - asin ( za ) + ( rrp+ lrrp) ×` | 无末尾值 | 仍阻塞（纯符号函数式，无任何数值） |
| 18 | r3 p2 idx1 | `y = ( rp+ lrrp) cos - acos( za ) + ( rrp+ lrrp)×` | 无末尾值 | 仍阻塞 |
| 19 | r6 p2 idx4 | `0=A3(A1+A2)=1753-(759.48+765.41)=228.11mm` | 有末尾值·无符号 | 仍阻塞（符号位是 `0`，原文符号丢失，不猜） |
| 20 | r6 p2 idx5 | `0=+0.3-(-0.3)=0.6mm.` | 有末尾值·无符号 | 仍阻塞（同上） |
| 21 | r6 p2 idx6 | `avA=T0/m(m-Ring Qyt.)=0.6/3=0.2mm` | 有末尾值·含字母 | **取 avA 0.2 mm**（符号 `avA` 是原文 token） |
| 22 | r6 p2 idx13 | `B1=(125×COS10°+230/2)=238.1mm, B2=(33×COS10°)=32.5mm, B3=488.88mm (within the` | 有末尾值·含字母 | **取 B1 238.1 / B2 32.5 / B3 488.88 mm（3 条）** |
| 23 | r6 p2 idx14 | `framework of the arc processing size), after assembly to ensure that the size of a1=759.48±0.1mm.` | 有末尾值（±偏差） | **取 a1 759.48 ±0.1 mm** |
| 24 | r6 p3 idx15 | `0= + 0.1-(-0.1)=0.2mm` | 有末尾值·无符号 | 仍阻塞（符号位丢失） |
| 25 | r6 p3 idx23 | `Δ0=[0.1+(-0.1)]/2=0mm` | 有末尾值·含括号 | **取 Δ0 0 mm** |
| 26 | r6 p3 idx24 | `Δ1=[0.07+(-0.07)]/2=0mm` | 有末尾值·含括号 | **取 Δ1 0 mm** |
| 27 | r6 p3 idx25 | `Δ3=[0.05+(-0.05)]/2=0mm` | 有末尾值·含括号 | **取 Δ3 0 mm** |
| 28 | r6 p3 idx26 | `ES2=Δ2+T2/2=0+0.06/2=0.03` | 无末尾值 | 仍阻塞（末尾无单位） |
| 29 | r6 p3 idx27 | `EI2=Δ2- T2/2=0-0.06/2=-0.03` | 无末尾值 | 仍阻塞 |
| 30 | r6 p3 idx29 | `So ES0=Δ0+T0/2=0+0.182/2=0.091mm,EI0=Δ0-T0/2=0-0.182/2=-0.091mm, A1=759.48±0.091,` | 有末尾值·含字母 | **取 ES0 0.091 / EI0 −0.091 mm**（`A1` 段无单位 → 只留 UNKNOWN_UNIT issue） |
| 31 | r6 p4 idx31 | `1on=250/2=125. Free roller tolerance and the same drive roller,` | 无末尾值 | 仍阻塞（末尾无单位） |
| 32 | r6 p4 idx33 | `3- mandrel: a large-diameter φ= 129h6( ), the small diameter φ=110f7(-0.071 ) .` | 无末尾值 | 仍阻塞（`h6`/`f7` 是公差带代号，不是单位） |
| 33 | r6 p4 idx34 | `4- bearing: bore φ= 180H7( ), the base surface to the hole center distance L=135.` | 无末尾值 | 仍阻塞（`135.` 无单位） |
| 34 | r6 p4 idx35 | `B1=B1+B1under=135+250/2=260 mm` | 有末尾值·含字母 | **取 B1 260 mm**（并入既有 `B1=260±0.07` 桶，不新增候选） |
| 35 | r6 p4 idx36 | `T0=+0.07-(-0.07)=0.14 mm` | 有末尾值·纯加减 | **取 T0 0.14 mm** |
| 36 | r6 p4 idx43 | `Δ0=Δ1+Δ2=[0.05+(-0.05)]/2+[0.045+(-0.045)]/2=0mm,` | 有末尾值·含括号 | **取 Δ0 0 mm**（并入 Δ0 桶） |
| 37 | r6 p4 idx44 | `EI0=Δ0-T0/2=0-0.135/2=-0.07mm.It can be seen B1=260±0.07 comply with B1=260±0.07mm` | 有末尾值·含字母 | **仍阻塞**：中间夹着第二处赋值 `B1=`，不把 260 挂到 EI0 头上 |
| 38 | r6 p5 idx51 | `(-0.025/2)=0.0325, a` | 无末尾值 | 仍阻塞（等号左边是括号式，无符号位） |
| 39 | r6 p5 idx55 | `Closed loop a02=a5-(a0+a01) , amax=0.1-(0.008+0)=0.092, amin=-0.1-(0.0355+0.0325)=-0.168,` | 无末尾值 | 仍阻塞（三段末尾都没有单位） |
| 40 | r6 p6 idx62 | `loop a03=a6-a7, amax=0.04/2-(-0.025/2)=0.0325, amin=0/2-(0/2)=0 , a03=0+0.03250 (assembly` | 无末尾值 | 仍阻塞 |
| 41 | r6 p6 idx68 | `tolerances) and B1. on = 125±0.045mm fit, take the B1 at cost: the B1=125±0.045m .` | 有末尾值（±偏差） | **取 on 125 ±0.045 mm**（符号被文本层断成 `on`，见第九节） |
| 42 | r6 p6 idx69 | `Δ0=Δ1+Δ2=[0.052+(-0.048)]/2+[0.045+(-0.045)]/2=0.002mm，` | 有末尾值·含括号 | **取 Δ0 0.002 mm** |
| 43 | r6 p6 idx70 | `ES0=Δ0+T0/2=0.002+0.135/2=0.07mm` | 有末尾值·含字母 | **取 ES0 0.07 mm** |
| 44 | r6 p6 idx71 | `EI0=Δ0-T0/2=0.002-0.135/2=-0.07mm` | 有末尾值·含字母 | **取 EI0 −0.07 mm** |
| 45 | r6 p7 idx75 | `①Base into the hole center distance L size chain a02: closed loop a02=a5-(a0+a01),` | 无末尾值 | 仍阻塞（末尾是符号式） |

合计：**16 行改判为赋值行**（#9、10、21、22、23、25、26、27、30、34、35、36、41、42、43、44），
**29 行仍 `FORMULA_UNSUPPORTED`**（#1–8、11–20、24、28、29、31–33、37–40、45）。

---

## 二、规则（落地时到底怎么判）

判定分两处，都是纯字符串/形态判定，不读文件、不做算术：

### 2.1 形态 1 的中间式放宽（`expressionUnits.ts`）

`符号 = 中间式 = 数值 单位` 里，中间式的**唯一**用途是“这一行是赋值而不是公式”，从不参与取值：

- **认**：含字母（`B1+B1under`、`Δ1+Δ2`）、乘除（`250/2`、`[0.05+(−0.05)]/2`）、括号、`°`，以及 3 个及以上等号；
- **不认**（返回 null，交回既有阻塞或既有解析）：
  1. 任何中间块为空（`A=43.05 … =`）；
  2. 任何中间块是**孤立符号**（`A = B = 10 = 12 mm` 是符号链，交回 `ASSIGNMENT_PATTERN` 逐符号解析）；
  3. 任何中间块含**显式单位或汉字** —— 说明这行中间夹着**另一处赋值**：
     `EI0=…=−0.07mm.It can be seen B1=260±0.07mm` 的 `260±0.07` 不属于 `EI0`；
  4. 末段不是「数值 [±偏差] 单位」。

单位串在这个守卫里判得比 `UNIT_TEXT_SOURCE` 更严（拉丁字母单位必须自成词），否则 `Ring` 里的 `in`
会被误当英制单位。末尾那段单位仍交给既有 `buildQuantity`：mm 才可用，英制照旧 `UNSUPPORTED_UNIT`，
未知照旧 `UNKNOWN_UNIT`，精度/量级阈值一律没动。

### 2.2 符号位接受希腊字母

`Δ0`、`Δ1`、`δL` 这类符号在此前只能被截成 `0`、`1`、`L`（或干脆认不出）。本分支把符号位的字符集扩到
拉丁字母 + 希腊字母，**只扩字符集，不解释含义**：`δL` 就是 `δL`，不会被当成“隔套长度”。

### 2.3 管道让位（`parse.ts`）

行循环里，`parseFormulaLine` 返回**blocked + unsupported** 时，先问一句
`lineMatchesAssignmentForm(行文本)`：任一个逗号片段命中三种形态之一，这一行就是赋值行，交给
`parseAssignmentLine`；**取不到任何条目时仍保留原来的 `FORMULA_UNSUPPORTED` 候选**（不静默丢行）。

`FORMULA_UNSUPPORTED_PATTERN`（`/[×÷*/()^]/`）、`FORMULA_PATTERN`、`data.unsupported` 的语义**一个字没改**——
改的只是“谁先拿到这一行”。

### 2.4 五条硬约束对照

| 约束 | 本分支怎么守 |
|---|---|
| 不许算术求值 | 取的是末尾那枚**显式**数值；中间式只做“字符是否越界”的校验。反证：r6 p3 `T = T − T − T= 0.22 − 0.1152 − 0.0972 = 0.132mm` 里 `0.22−0.1152−0.0972` 实为 `0.0076`，我们仍取原文写的 `0.132`（`logs/05` 可查），没有算。 |
| 不许猜变量含义 | `Lb`、`δL`、`δbi` 只作符号字符串；符号位在文本层丢失的 `0=…=228.11mm` 一律报缺。 |
| 不许放宽 `FORMULA_UNSUPPORTED` 判定 | 判定条件与正则原样；29 条仍以该码阻塞（见第一节表）。 |
| 不改 q 精度 / schema / 阈值；不碰 P0/P1 单位规则 | `types.ts` 只加版本注释与版本串；`unitScope.ts`、`buildQuantity`、`tryParseMm` 未动。 |
| 不做多链求解 / 统计公差 | 只按符号逐处取值，多值仍然逐条列出 + `AMBIGUOUS_ASSIGNMENT` 警告，不合并、不求解。 |

参考依据（AGENTS.md 要求）：GB/T 4458.4-2003《机械制图 尺寸注法》——以毫米为单位不注单位、采用其他
单位须注明（单位判定仍沿用 P0/P1 的既有结论）；GB/T 4458.5-2003——对称偏差注法（`±`，P1 已实现，
本分支只是让这类行不再被公式分支抢走）。标准正文未获取，形态判定以语料原文与任务卡第 1 节为准。

---

## 三、改动清单

| 文件 | 改动 |
|---|---|
| `src/document-extraction/expressionUnits.ts` | 形态 1 中间式改为“按 `=` 切块 + 三条越界守卫”；符号位接受希腊字母；新增 `lineMatchesAssignmentForm()`（供管道让位） |
| `src/document-extraction/parse.ts` | 公式分支遇到“显式末尾值行”时让位给赋值解析；取不到条目仍保留原阻塞记录 |
| `src/document-extraction/types.ts` | `EXTRACTOR_VERSION` → `document-extractor-5` + 规则 5 的语义注释 |
| `src/document-extraction/__fixtures__/formula-form-sample.pdf` | **新增** 7 页合成夹具（一页一场景） |
| `src/document-extraction/__tests__/formulaForms.test.ts` | **新增** F-01～F-07 + 6 条纯函数形态 + 1 条出处完整性（15 条） |
| `src/document-extraction/__tests__/expressionUnits.test.ts` | 版本断言 v4 → v5（语义变了必须升版） |
| `scripts/make-formula-form-sample.cjs` | **新增** 夹具生成脚本（Chromium `printToPDF`） |
| `scripts/v36-drafts-seed.ts`、`desktop/tests/e2e/v36drafts.mjs` | V3.6 草稿 seed/e2e 的硬编码版本串同步到 v5 |
| `docs/evidence/real-doc-baseline/{baseline.json,metrics.json}` | 基线随规则更新（44 处 diff，逐条见第六节） |
| `docs/evidence/extract-formula/**` | 本文、三个探针、日志、M22 |

夹具生成命令（可复核）：

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron \
  scripts/make-formula-form-sample.cjs src/document-extraction/__fixtures__/formula-form-sample.pdf
# written src/document-extraction/__fixtures__/formula-form-sample.pdf 145742 bytes
```

7 页：p1 F-01 / p2 F-02 / p3 F-03 / p4 F-04 / p5 F-05 / p6 F-06 / p7 F-07，测试按页范围分别取用。

---

## 四、F-01～F-07 真实输出

```bash
npx vitest run src/document-extraction/__tests__/formulaForms.test.ts --reporter=verbose
# 15 passed (15)
```

逐场景实测（`node docs/evidence/extract-formula/probe-fixture.mjs`，原文 `logs/07-fixture-F01-F07.log`）：

| 用例 | 期望 | 实测 |
|---|---|---|
| F-01 `B1 = B1 + B1under = 135 + 250/2 = 260 mm` | 取 260 mm，中间式原样保留 | 1 条 pending：`symbol=B1`、`nominal.text=260`、`valueQ=2600000`、`unit=mm`；出处含 `B1 = B1 + B1under = 135 + 250/2 =` 与独立的 `mm` 文本项；basis 含 `RULE_UNIT_EXPRESSION_TAIL`；该页没有 formula 候选 |
| F-02 `Zmax=5.2+0.1-4.9=0.4mm)` | 不再被公式分支抢先 | 1 条 pending `Zmax 0.4 mm / 4000 q`；页内没有任何 `FORMULA_UNSUPPORTED`（改前必然是 blocked） |
| F-03 `Δ0=[0.1+(−0.1)]/2=0mm` | 希腊字母符号 + 括号负数 | 1 条 pending `symbol=Δ0`、`0 mm`、`valueQ=0`；符号出处指回 `Δ0` |
| F-04 `EI0=…=−0.07mm.It can be seen B1=260±0.07mm` | **仍阻塞**，不把 260 挂给 EI0 | 该页 **0 条 ring**；1 条 formula blocked `reasonCodes=["FORMULA_UNSUPPORTED"]`；页内没有 pending |
| F-05 `A = B = 10 = 12 mm` | 符号链不接管 | 形态匹配返回 null；该页按既有解析出 `A`/`B` 两条（`UNKNOWN_UNIT`，沿用旧行为） |
| F-06 `ES2=Δ2+T2/2=0+0.06/2=0.03` | 末尾无单位 → 仍阻塞 | 0 ring；1 条 formula blocked `FORMULA_UNSUPPORTED` |
| F-07 `B1=…=238.1mm, B2=…=32.5mm` | 一行两条赋值各自取显式值 | 2 条 pending：`B1 238.1 mm / 2381000 q`、`B2 32.5 mm / 325000 q` |

另有 6 条纯函数测试锁形态边界（区间切片必须落回原文、符号链/中间夹单位/无单位尾巴一律 null、
`lineMatchesAssignmentForm` 只认带显式单位尾巴的赋值行），以及 1 条“每个数值字段的每条出处都过
`isEvidenceComplete` 且页码落在请求范围内（1–7 页逐页）”。

---

## 五、真实文档度量：改前 / 改后（逐份）

```bash
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs node scripts/real-doc-metrics.mjs
```

- 改前（`main 635384d`，`document-extractor-4`）原文：`logs/00-metrics-before.txt`
- 改后（本分支，`document-extractor-5`）原文：`logs/14-metrics-real-docs.log`
- 逐条候选对照：`logs/04-candidates-before.log` / `logs/05-candidates-after.log` / `logs/06-candidates-diff.log`

| 文档 | 改前 候选/pending/blocked | 改后 候选/pending/blocked | 增减 |
|---|---|---|---|
| r1 装配工艺课件（zh，74 页） | 15 / 4 / 11（26.7%） | 15 / 4 / 11（26.7%） | 0 / 0 / 0 |
| r2 北理工学报（zh，5 页） | 20 / 5 / 15（25.0%） | **22 / 7 / 15**（31.8%） | **+2 / +2 / 0** |
| r3 RV 减速器（zh，4 页） | 3 / 0 / 3（0.0%） | 3 / 0 / 3（0.0%） | 0 / 0 / 0 |
| r4 MT/T 1097（zh，170 页，`PAGE_LIMIT`） | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| r5 英文公差分析（en，8 页） | 4 / 2 / 2（50.0%） | 4 / 2 / 2（50.0%） | 0 / 0 / 0 |
| r6 英文装配工艺（en，8 页） | 84 / 27 / 57（32.1%） | **87 / 44 / 43**（50.6%） | **+3 / +17 / −14** |
| **汇总** | **126 / 38 / 88；30.2% / 69.8%** | **131 / 57 / 74；43.5% / 56.5%** | **+5 / +19 / −14** |

原因码分布（对 blocked 候选计数）：`FORMULA_UNSUPPORTED` **45 → 29**，`UNKNOWN_UNIT` 42 → 44，
`UNSUPPORTED_UNIT` 1 → 1，`INCONSISTENT_REDUNDANT_VALUE` 0 → 0。
问题码：r2 `UNKNOWN_UNIT×5 → ×3`、`AMBIGUOUS_ASSIGNMENT×2 → ×4`；r6 `UNKNOWN_UNIT×18 → ×16`、
`AMBIGUOUS_ASSIGNMENT×11 → ×16`；r1/r3/r4/r5 不变。

### 5.1 逐份解释（哪一份动了、为什么）

- **r1 / r3 / r4 / r5 计数完全不变**：r1 的 7 条公式行**全篇没有 mm 单位串**（`A=5`、`T=T=0.06`、
  `…=0.5-0.2-0.10-0.05-0.05`），末尾段永远凑不出「数值+单位」，规则不接；r3 两条是纯符号函数式
  （`sin`/`cos`，无任何数值）；r4 整份 `PAGE_LIMIT`、0 候选；r5 没有公式行。
- **r2 +2 候选 / +2 pending**：`Zmax=5.2+0.1-4.9=0.4mm)`（P1 形态本来就命中，纯管道问题）与
  `δL=δL-δL=0.25-0.10=0.15mm)`（3 个等号 + 中间含符号）各落一条 pending。
  同时 `δL=0.10mm` 这条的符号从被截断的 `L` 修正为 `δL`（同页同值，pending 数不变）。
  副作用（**必须解释**）：`L` 分组从此没有可解析成员，`δL= 0.25-0.20-0.10-0.20-0.05=`、
  `δL= 0.20+0.10+0.20+0.05=` 这两条由“issue 记录”变成“blocked 候选”（`UNKNOWN_UNIT`），
  因此 r2 的 blocked 仍是 15（−2 公式 +2 单位）、问题码里 `UNKNOWN_UNIT` 5 → 3。
- **r6 +3 候选 / +17 pending / −14 blocked**：14 条公式行改判，17 处显式末尾值落成待确认；
  其中 `B1=260 mm` 并入既有 `B1=260±0.07` 桶、`B1=238.1`／`B2`／`B3` 与 p3 的同值桶合并
  （代表页从 p3 前移到 p2）、`Δ0=0 mm` 与 p3 的同值合并 → 所以候选只 +3。
  **另有 6 条 pending 来自不在 45 条里的行**（以前既不阻塞也不出候选，直接掉在地上）：
  `T3=T0−T1−T2=0.6−0.2−0.2=0.2mm`、`T = T − T − T= 0.22 − 0.1152 − 0.0972 = 0.132mm`、
  `T = T − T − T= 0.412 − 0.062 − 0.102 =0.182mm`、`T = T +T = 0.10 +0.09 = 0.135mm,ES0=…=0.07mm`（2 条）、
  `Δ2=0−0−0=0mm`。这 6 条同样只取原文值、不求值。
- `AMBIGUOUS_ASSIGNMENT` 11 → 16（r6）、2 → 4（r2）：同符号现在有多处**可解析**的不同取值
  （`T` 3 处、`Δ0` 2 处、`ES0` 2 处、`EI0` 2 处、r2 的 `δL` 2 处），按 V3.6 既有语义逐处列候选 + 一条
  warning，**不择优**。

### 5.2 新增的 19 条 pending 逐条来源（20 处“新身份”里 1 处是符号修正）

| 文档·页 | 原文 | 取到的值 |
|---|---|---|
| r2 p3 | `Zmax=5.2+0.1-4.9=0.4mm)` | Zmax 0.4 mm |
| r2 p3 | `δL=0.10mm,则 补偿环间隔尺寸` | δL 0.10 mm（**符号修正**：原为截断的 `L`） |
| r2 p4 | `δL=δL-δL=0.25-0.10=0.15mm)补偿环尺` | δL 0.15 mm |
| r6 p2 | `avA=T0/m(m-Ring Qyt.)=0.6/3=0.2mm` | avA 0.2 mm |
| r6 p2 | `framework of … a1=759.48±0.1mm.` | a1 759.48 ±0.1 mm |
| r6 p2 | `T3=T0−T1−T2=0.6−0.2−0.2=0.2mm.` | T3 0.2 mm |
| r6 p3 | `T = T − T − T= 0.22 − 0.1152 − 0.0972 = 0.132mm` | T 0.132 mm |
| r6 p3 | `T = T − T − T= 0.412 − 0.062 − 0.102 =0.182mm.` | T 0.182 mm |
| r6 p3 | `Δ0=[0.1+(−0.1)]/2=0mm` | Δ0 0 mm |
| r6 p3 | `Δ1=[0.07+(−0.07)]/2=0mm` | Δ1 0 mm |
| r6 p3 | `Δ3=[0.05+(−0.05)]/2=0mm` | Δ3 0 mm |
| r6 p3 | `Δ2=0−0−0=0mm` | Δ2 0 mm |
| r6 p3 | `So ES0=…=0.091mm,EI0=…=−0.091mm, …` | ES0 0.091 mm、EI0 −0.091 mm |
| r6 p4 | `T0=+0.07−(−0.07)=0.14 mm` | T0 0.14 mm |
| r6 p4 | `T = T +T = 0.10 +0.09 = 0.135mm,ES0=Δ0+T0/2=0+0.135/2=0.07mm,` | T 0.135 mm、ES0 0.07 mm |
| r6 p6 | `tolerances) and B1. on = 125±0.045mm fit, …` | on 125 ±0.045 mm（符号见第九节） |
| r6 p6 | `Δ0=Δ1+Δ2=[0.052+(−0.048)]/2+[0.045+(−0.045)]/2=0.002mm，` | Δ0 0.002 mm |
| r6 p6 | `EI0=Δ0−T0/2=0.002−0.135/2=−0.07mm` | EI0 −0.07 mm |

### 5.3 剩下 29 条为什么还阻塞（分组，不是“懒得做”）

| 原因（= 第 1.1 节的主归类） | 条数 | 例子 |
|---|---|---|
| 末尾没有「数值+单位」 | **23** | 纯符号函数式：`x = ( rp+ lrp) sin - asin ( za ) + …`；缺单位：`ES2=Δ2+T2/2=0+0.06/2=0.03`、`得: A=43.05 A=43.05±T/2=43.05±0.075=`；数值被文本层拆碎：`-0.1.05-0.1.2-0.1Lb =…`、`2220.304-0.250=0.054(mm).`；公差带代号不是单位：`φ= 129h6( )` |
| 末尾有值但等号左边不是符号（符号位在文本层丢失） | **5** | `0=A3(A1+A2)=…=228.11mm`；`0=+0.3-(-0.3)=0.6mm.`；`于100.0-0.1=99.9mm(…`；`(−0.025/2)=0.0325, a` |
| 中间夹着第二处赋值（有末尾值也不挂） | **1** | `EI0=…=−0.07mm.It can be seen B1=260±0.07mm` |

23 + 5 + 1 = 29，与 `FORMULA_UNSUPPORTED` 的改后计数一致。

---

## 六、`baseline.json` 更新与理由

```bash
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs node scripts/real-doc-metrics.mjs \
  --update-baseline --reason "P2 公式行显式末尾值（document-extractor-4→5）…"
```

原文 `logs/08-update-baseline.log`：**44 处变化**，按来源分四类（不是“整体重写”）：

| 类别 | 处数 | 内容 |
|---|---|---|
| 版本串 | 8 | 6 份文档 + `rules` + `summary.rules` 的 `document-extractor-4 → 5` |
| r2 规则效果 | 15 | `candidates.total 20→22`、`pending 5→7`、`byKind[ring] 11→15`、`byKind[formula] 9→7`、`issues.blocked 5→3`、`issues.warning 2→4`、`blockedReasonCodes` 与 `byCode` 的 code/count 互换（`FORMULA_UNSUPPORTED 9→7`、`UNKNOWN_UNIT 6→8`） |
| r6 规则效果 | 14 | `candidates.total 84→87`、`pending 27→44`、`blocked 57→43`、`byKind[ring] 56→73`、`byKind[formula] 28→14`、`blockedReasonCodes[FORMULA_UNSUPPORTED] 27→13`、`issues.blocked 18→14`、`issues.warning 11→16`、`issues.total 29→30` |
| 汇总 | 9 | `total 126→131`、`pending 38→57`、`blocked 88→74`、`confirmableRate 0.301587→0.435115`、`blockedRate 0.698413→0.564885`、`reasonCodeTop5` 前两位互换（`UNKNOWN_UNIT 44` 变成第一、`FORMULA_UNSUPPORTED 29` 第二） |

`baselineReason` 写明了完整理由（逐条对应 5.1 / 5.2）。更新后不带参数再跑一次 → `BASELINE MATCH`
（`logs/14-metrics-real-docs.log` 末尾）。

已知的“不好看”的变化（如实列出，均为既有语义的必然结果，不是为凑数字）：
- `UNKNOWN_UNIT` 42 → 44（r2 两条由 issue 变候选，见 5.1）；
- 问题码 `AMBIGUOUS_ASSIGNMENT` 增加 5 + 2（同符号新增多处可解析取值，逐处列出不择优）。

---

## 七、M22 变异：把 P2 接管关掉

patch：`mutations/M22-disable-explicit-tail-adoption.patch`（26 行，两处；`npm run typecheck` 仍通过，
`git apply --check` 通过）：

1. `MIDDLE_FORBIDDEN` 收紧成“中间式里只许出现数字、`+`、`-`、空白、点” —— 等价于**退回 P1 的纯加减限制**；
2. 让位判断改成 `lineMatchesAssignmentForm('')`（恒 false）—— 公式分支不再让位。

| 状态 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 关掉 P2 接管 | `npx vitest run src/document-extraction/__tests__/formulaForms.test.ts` | **6 failed / 9 passed**：F-01（纯函数 + 夹具）、F-02、F-03（纯函数 + 夹具）、F-07 全红 | `mutations/M22-red.log` |
| 恢复 | 同上 | **15 passed** | `mutations/M22-green.log` |

值得注意（说明变异不是“全红=什么都没测”）：F-04（中间夹第二处赋值）、F-05（符号链）、F-06（末尾无单位）
在变异下仍**绿** —— 变异只打掉“能取到显式末尾值的地方”，没打掉“必须继续阻塞的地方”。

复现：

```bash
git apply docs/evidence/extract-formula/mutations/M22-disable-explicit-tail-adoption.patch
npx vitest run src/document-extraction/__tests__/formulaForms.test.ts   # 预期红
git checkout -- src/document-extraction/expressionUnits.ts src/document-extraction/parse.ts
npx vitest run src/document-extraction/__tests__/formulaForms.test.ts   # 预期绿
```

---

## 八、六条命令 + 打包（原始输出）

| # | 命令 | 结果 | 日志 |
|---|---|---|---|
| 1 | `npm test` | 102 files / **1097 tests** 全通过，exit 0 | `logs/09-test.log` |
| 2 | `npm run test:desktop` | 39 passed / 1 skipped（40 files），**277 tests** 通过 / 14 skipped，exit 0 | `logs/10-test-desktop.log` |
| 3 | `npm run typecheck` | 无输出，exit 0 | `logs/11-typecheck.log` |
| 4 | `npm run lint` | 无告警，exit 0 | `logs/12-lint.log` |
| 5 | `npm run test:real-docs` | 5 passed，exit 0 | `logs/13-test-real-docs.log` |
| 6 | `npm run metrics:real-docs` | 度量输出 + `BASELINE MATCH`，exit 0 | `logs/14-metrics-real-docs.log` |
| 7 | `npm run package:desktop -- --arch=arm64` | 打包成功，末尾 `RESULT PASS 打包产物中的 pdf worker 可被 main.cjs 运行时加载`，exit 0 | `logs/15-package-desktop.log` |
| 8 | `npm run check:package:pdf-worker` | `RESULT PASS`，exit 0（asar 内 `pdf.worker.mjs` sha256 `b4c8353d…` 与 `node_modules/pdfjs-dist` 一致） | `logs/16-check-package-pdf-worker.log` |

---

## 九、未做 / 已知问题（如实列出）

1. **29 条仍 `FORMULA_UNSUPPORTED`**：分组见 5.3。要救它们必须“补符号”或“做算术求值”或“猜公差带
   代号含义”，任务卡明确禁止，因此没有动。
2. **符号位在文本层丢失的 3 条 `0=…=数值mm`**（`0=A3(A1+A2)=…=228.11mm` 等）：原文只剩 `0`，
   真实符号（`T0`? `Δ0`? `a0`?）无从核对，按“不知道就报缺”处理，**没有猜**。
3. **`on` 这条的符号是文本层断开的产物**（`tolerances) and B1. on = 125±0.045mm`）：值 125 ±0.045 mm 与
   全文其它 `B1=125±0.045mm` 一致，但符号字符串是 `on` 而不是 `B1`。这与 P1 已记录的“符号取等号左侧
   紧邻 token（`upper`/`below`）”的同类问题，本次沿用同一语义、没有额外加特判；
   19 条新增 pending 里它是唯一一条符号可疑的，人工复核时优先看它。
4. **`avA` 同理**：`avA=T0/m(m−Ring Qyt.)=0.6/3=0.2mm` 的符号是原文 token `avA`（很可能是 `ΔavA` 被拆），
   值 0.2 mm 与原文一致，符号未修正。
5. **一条逗号行里有不可读片段时，该片段只留 issue 不造候选**：如 r6 p3 `So ES0=…, EI0=…, A1=759.48±0.091,`
   的 `A1` 段（无单位）→ 只出 `UNKNOWN_UNIT` issue。旧行为同样如此（只是旧行为整行被公式分支吃掉）。
6. **“中间式里含单位或汉字就整行不认”是保守取舍**：`EI0=…=−0.07mm.It can be seen B1=260±0.07mm` 这类
   行里的 `EI0=−0.07mm` 本来可以取，但同一行还夹着另一处赋值，宁可整行报缺也不冒挂错符号的风险。
   要救它需要“按 `;`/句号切子句”的语义分割，属另一件事。
7. **`δL` 与 `L`、`T` 与 `T0` 这类符号仍然按字符串区分**，不做任何等价归一（任务卡只允许下标/上标等价
   归一，而诊断显示语料里 0 条下标上标，故未实现）。
8. **`desktop/tests/e2e/v36drafts.mjs` 未运行**：需要打包应用 + 重新生成的 `DRAFTS-V36.cunlian` 夹具；
   本次只把硬编码版本串同步到 v5（否则升版后必红），这条 CDP 走查**没有实测**，如实标注为未测。
