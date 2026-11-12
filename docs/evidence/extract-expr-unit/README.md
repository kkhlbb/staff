# P1 表达式末尾单位与多等号数值解析（`document-extractor-4`）

一句话：只在这三种明确形态下，把**整段表达式末尾**的单位归给被采用的结果值，并把单位本身的
页 / 选区 / item 索引 / 原文片段写进出处；中间表达式只作原文字符串保留，**不做算术求值**；
多个等号结果不一致 → 新原因码 `INCONSISTENT_REDUNDANT_VALUE` 阻塞，不挑一个。

```
1. X = 表达式 = 数值 单位      A0max = 1753.1 − 759.38 − 765.31 = 228.41 mm
2. 符号 = 数值 ± 偏差 单位      A = 230 ± 0.3 mm
3. 符号 = 数值 单位            （长符号不再被 4 字符截断：A0max = 228.41 mm）
```

分支 `agent/extract-expr-unit`，基线 `main 392fc87`（P0 已合入，`document-extractor-3`）。

| 项 | 值 |
|---|---|
| 实现提交 | `246e9fc`（规则 + 夹具 + E-01～E-07 + 版本串同步） |
| 证据提交 | 紧随其后的 `docs(evidence): 表达式末尾单位 …` 一笔（本目录 + 日志 + M19 + baseline 更新），哈希见 `git log --oneline 392fc87..HEAD` |
| 规则版本 | `document-extractor-3` → **`document-extractor-4`** |
| 用例 | E-01～E-07 + 3 条纯函数形态测试 + 1 条出处完整性，共 12 条断言（全部通过） |
| 真实文档度量 | 候选 **123 → 126**；pending **26 → 38**；blocked 97 → 88；可确认率 **21.1% → 30.2%** |
| 验收线（pending ≥ 35） | **过了**：38（逐份见第四节；另有 3 条不属三形态，如实列出原因） |
| 变异 | M19 关闭末尾单位归属 → E-01/E-02/E-03/E-04 红（4 failed / 8 passed）；恢复 → 12 passed |

---

## 一、规则（落地时怎么判）

判定在 `src/document-extraction/expressionUnits.ts`（纯匹配，无 IO），由
`parse.ts:parseAssignmentLine` 按**逗号分隔片段**先试形态、再回落旧解析：

1. **形态 1（多个等号）**：片段里第一个 `=` 左边紧邻的连续字母数字串是符号；右边按**最后一个** `=` 切开，
   左边必须是由数字与 `+/-`（含 `(−0.3)` 括号负数）组成的式子，右边必须是 `数值 单位`。
   - 多于两个 `=`，或式子含字母 / `/` / `*`，或末段不是数值 → **返回 null**，走既有解析（`UNKNOWN_UNIT` /
     `FORMULA_UNSUPPORTED` 原义不变）。
   - **不做算术求值**：式子只做“字符是否合法”的校验，`1753.1 − 759.38 − 765.31` 原样留在
     `rawText` 与出处里；被采用的数值是末尾那个结果值（`228.41`），不是算出来的。
   - 中间段只有一个数字（`A = 10 = 12 mm`）→ 只做十进制字符串归一比较：不一致 → `inconsistent`。
2. **形态 2（± 偏差）**：`数值 ± 偏差 单位` → 基本尺寸取 `数值`，上偏差 `+偏差`、下偏差 `-偏差`，
   两者出处都指向同一枚 `±0.3` 显式记号（同一段文字派生的两个字段，不造第二处原文）。
3. **形态 3（单值）**：`数值 单位`。旧规则里 `A = 10 mm` 本来就能读，这里主要是让**长符号**
   （`A0max`、`B1below`）不再被旧的 `[A-Za-z][A-Za-z0-9]{0,3}` 截成 `max` / `elow`。

其它硬边界：

- **单位归属写进 evidence**：末尾单位文本自己的选区（页 / rect / item 索引 / 原文片段）进数值字段的
  `evidence`，`confidenceBasis` 记 `RULE_UNIT_EXPRESSION_TAIL` 或 `RULE_ASSIGNMENT_PM_DEVIATION`。
  没有新 schema 字段。
- **单位仍由既有判定**：`parseUnitToken` / `buildQuantity` 照旧，mm 才可用；英制 `UNSUPPORTED_UNIT`、
  未知 `UNKNOWN_UNIT`、精度/量级越界照旧。**没有声明时不继承、不默认 mm**。
- **冲突不择优**：`A = 10 = 12 mm` → 候选 blocked、`valueQ=null`、`unit=null`，另发一条
  `INCONSISTENT_REDUNDANT_VALUE` 阻塞 issue，消息里并列 `10 / 12` 并写明“未挑其中一个值”。
- **下标碎片**：仅排除最窄形态 `^[a-z]\s*=\s*[01]$`（`i = 0` / `i = 1`）；`a = 5`、`A = 0`、`i = 12`
  仍照旧走赋值解析。

参考来源（AGENTS.md 要求）：GB/T 4458.5-2003《机械制图 尺寸公差与配合注法》第 1 章 (4)——公差带对称
布置时偏差数字只注一次、并在基本尺寸与偏差之间注出「±」；GB/T 4458.4-2003《机械制图 尺寸注法》——
以毫米为单位不注单位，采用其他单位须注明（条目：全国标准信息公共服务平台 GB/T 4458.4-2003 现行；
注法摘要：https://www.gstarcad.com/cmsDetail/5259/ 第五/六章）。标准正文未获取，形态判定以语料原文
与任务卡第 1 节为准。

---

## 二、改动清单

| 文件 | 改动 |
|---|---|
| `src/document-extraction/expressionUnits.ts` | **新增**。三种形态的纯匹配（区间 / 单位 / 偏差 / 不一致标记），不做算术、不碰 IO |
| `src/document-extraction/parse.ts` | `parseAssignmentLine` 按片段先试形态；形态条目构造（单位出处、± 偏差、不一致值）；`INCONSISTENT_REDUNDANT_VALUE` issue；`i=0/i=1` 下标排除；`confidenceBasis` 规则标记 |
| `src/document-extraction/types.ts` | `EXTRACTOR_VERSION` → `document-extractor-4`；新增原因码 `INCONSISTENT_REDUNDANT_VALUE`（含语义注释） |
| `src/document-extraction/__fixtures__/expression-unit-sample.pdf` | **新增** 7 页合成夹具（一页一场景；结果值/单位拆成独立文本项，出处能精确指到单位） |
| `src/document-extraction/__tests__/expressionUnits.test.ts` | **新增** E-01～E-07 + 3 条纯函数形态测试 + 1 条出处完整性（12 条） |
| `scripts/make-expression-unit-sample.cjs` | **新增** 夹具生成脚本（Chromium `printToPDF`） |
| `scripts/v36-drafts-seed.ts`、`desktop/tests/e2e/v36drafts.mjs` | V3.6 草稿 seed/e2e 的硬编码版本串同步到 v4（升版连带修改） |
| `docs/evidence/real-doc-baseline/{baseline.json,metrics.json}` | 基线随规则更新（32 处 diff，逐条见第五节） |
| `docs/evidence/extract-expr-unit/**` | 本文、三个探针、日志、M19 |

夹具生成命令（可复核，Apple Silicon 本机）：

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron \
  scripts/make-expression-unit-sample.cjs src/document-extraction/__fixtures__/expression-unit-sample.pdf
# written src/document-extraction/__fixtures__/expression-unit-sample.pdf 143713 bytes
```

7 页：p1 E-01 / p2 E-02 / p3 E-03 / p4 E-04 / p5 E-05 / p6 E-06（页内 `单位：mm`）/ p7 E-07。
测试按页范围分别取用，所以 E-06 的“文档级声明”作用域就是它自己那一页——与实现定义一致，不靠测试放宽。

---

## 三、E-01～E-07 真实输出

命令（原文见 `logs/14-fixture-e01-e07.log`、`logs/03-test.log`）：

```bash
npx vitest run src/document-extraction/__tests__/expressionUnits.test.ts --reporter=verbose
# 12 passed (12)
```

逐场景实测（`probe-fixture.mjs` 对每一页单独取页范围打印，原文 `logs/14-fixture-e01-e07.log`）：

| 用例 | 期望 | 实测 |
|---|---|---|
| E-01 `A0max = 1753.1 − 759.38 − 765.31 = 228.41 mm` | 取 228.41 mm，出处指向末尾单位，原表达式原样保留 | 1 条 pending，`symbol=A0max`，`nominal.text=228.41`、`valueQ=2284100`、`unit=mm`；`rawText` 完整保留 `A0max = 1753.1 − 759.38 − 765.31 = 228.41 mm`（没有算出的中间值、没有替换原文）；出处含独立文本项 `"mm"`（页码 1，x0 大于 `228.41` 那一项的 x0，item 索引不同）；basis `RULE_UNIT_EXPRESSION_TAIL` |
| E-02 `A = 230 ± 0.3 mm` | 基本尺寸 230、上下偏差 ±0.3，单位 mm | 1 条 pending：`230 / 2300000 q / mm`，上偏差 `+0.3 / 3000 q`，下偏差 `-0.3 / -3000 q`；两个偏差的出处都是那枚 `±0.3`（片段含 `±`）；basis `RULE_ASSIGNMENT_PM_DEVIATION` |
| E-03 `T0 = +0.3 − (−0.3) = 0.6 mm` | 取 0.6 mm；括号负数不被当成两个值 | 1 条 pending，`symbol=T0`，`nominal.text=0.6`、`valueQ=6000`、`unit=mm`，上下偏差均为 null，该页只有 **1** 条候选（没有多出 `−0.3` 那条） |
| E-04 `A = 10 = 12 mm` | `INCONSISTENT_REDUNDANT_VALUE` 阻塞 | 1 条 blocked，`reasonCodes=["INCONSISTENT_REDUNDANT_VALUE"]`，`nominal.unit=null`、`valueQ=null`；issue `INCONSISTENT_REDUNDANT_VALUE`（blocked）消息：`符号 A 的赋值含多个等号，结果值互不一致（10 / 12）；该条已阻塞，未挑其中一个值`，`candidateIds` 指向这条候选，该页无 pending |
| E-05 `A0max = 1753.1 − 759.38 − 765.31`（无单位） | 仍 `UNKNOWN_UNIT` | 1 条 blocked，`reasonCodes=["UNKNOWN_UNIT"]`，`unit=null`、`valueQ=null`，basis 里**没有** `RULE_UNIT_EXPRESSION_TAIL`（走的是旧解析） |
| E-06 `A = 230 ± 0.3`（无单位，页内有「单位：mm」） | 走 P0 继承 mm（回归保护） | 1 条 pending，`230 / 2300000 q / mm`，basis 含 `RULE_UNIT_INHERITED_DOCUMENT`，出处含 `单位:mm` 那条文本项的第 6 页选区 |
| E-07 `i = 0` / `i = 1` | 不当尺寸候选 | 该页 **0** 条候选（旧规则会出 2 条 UNKNOWN_UNIT 误报） |

另有 3 条纯函数测试锁住“区间偏移按整行算”（`Take B2=32.5±0.03mm, and take B3=488.88±0.05mm.` 的第二段
切出来必须是 `B3` / `488.88` / `mm`——开发中这里出过一次偏移串位，正好被这条测试挡住），
以及 1 条“每个数值字段的每条出处都过 `isEvidenceComplete` 且页码落在请求范围内”。

---

## 四、真实文档度量：改前 / 改后（逐份）

```bash
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs node scripts/real-doc-metrics.mjs
```

- 改前（`main 392fc87`，`document-extractor-3`）原文：`logs/00-metrics-before-v3.txt`
- 改后（本分支，`document-extractor-4`）原文：`logs/08-metrics-real-docs.log`

| 文档 | 改前 候选/pending/blocked | 改后 候选/pending/blocked | 增减 |
|---|---|---|---|
| r1 装配工艺课件（zh，74 页） | 15 / 4 / 11（26.7%） | 15 / 4 / 11（26.7%） | 0 / 0 / 0 |
| r2 北理工学报（zh，5 页） | 20 / 5 / 15（25.0%） | 20 / 5 / 15（25.0%） | 0 / 0 / 0 |
| r3 RV 减速器（zh，4 页） | 3 / 0 / 3（0.0%） | 3 / 0 / 3（0.0%） | 0 / 0 / 0 |
| r4 MT/T 1097（zh，170 页，`PAGE_LIMIT`） | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| r5 英文公差分析（en，8 页） | 5 / 2 / 3（40.0%） | **4 / 2 / 2**（50.0%） | **−1 / 0 / −1** |
| r6 英文装配工艺（en，8 页） | 80 / 15 / 65（18.8%） | **84 / 27 / 57**（32.1%） | **+4 / +12 / −8** |
| **汇总** | **123 / 26 / 97；21.1% / 78.9%** | **126 / 38 / 88；30.2% / 69.8%** | **+3 / +12 / −9** |

原因码分布（对 blocked 候选计数）：`UNKNOWN_UNIT` **51 → 42**，`FORMULA_UNSUPPORTED` 45 → 45，
`UNSUPPORTED_UNIT` 1 → 1，`INCONSISTENT_REDUNDANT_VALUE` 0 → 0（真实语料没有多等号矛盾的写法）。

问题码：r1 `UNKNOWN_UNIT×53 / AMBIGUOUS_ASSIGNMENT×2 / NO_TEXT_LAYER×1`、r2 `UNKNOWN_UNIT×5 /
AMBIGUOUS_ASSIGNMENT×2`、r3 无、r4 `PAGE_LIMIT×1` 全部不变；r5 `AMBIGUOUS_ASSIGNMENT×1 → 无`；
r6 `UNKNOWN_UNIT×29 → 18`、`AMBIGUOUS_ASSIGNMENT×11 → 13`；r4 的 1-20 页探针不变
（候选 1、阻塞 1、`UNKNOWN_UNIT×1`、无文本层页 1,2,6）。

### 4.1 逐份解释（哪一份动了、为什么）

- **r1 / r2 / r3 / r4 计数完全不变**：这四份里没有任何行落进三种形态（r2 的两条“行内有单位串”
  见 4.3，不属三形态；r4 整份 `PAGE_LIMIT`，0 候选）。r2 有一处**行级**变化但计数没动：
  `i=1` 这一行按 E-07 不再建条目，它与另一行同符号同值的 `ïi=1` 原本就合并成 1 条候选，
  所以候选还是 1 条、`rawText` 变成后者的原文（`logs/11` vs `logs/12` 的 p4 段可见）。
- **r5 候选 −1**：只少了 `i=0` 这条下标碎片（任务卡 E-07 要求），pending 与 blocked 各自
  只少了那一条，`AMBIGUOUS_ASSIGNMENT` 随之消失（同符号 `i` 只剩一处）。这是**下降**且是
  预期内的下降：它不是尺寸，本来就不该出候选。
- **r6 +4 候选、+12 pending、−8 blocked**：见 4.2 的逐条对照。

### 4.2 r6 逐候选对照（`logs/13-candidates-diff.log`）

8 条 `UNKNOWN_UNIT` 阻塞候选取到末尾单位（blocked → pending）：

| 页 | 原文 | 取到的值 |
|---|---|---|
| p1 | `A=230±0.3mm high precision, as shown in Figure1, …` | 230 ±0.3 mm（长符号不再截断，symbol 仍是 `A`） |
| p2 | `A0max=1753.1−759.38−765.31=228.41mm` | 228.41 mm（旧解析读的是第一个数 1753.1、符号被截成 `max`） |
| p2 | `A0min=1752.9−759.58−765.51=227.81mm` | 227.81 mm |
| p2 | `Then A0=228.11±0.3mm. …` | 228.11 ±0.3 mm |
| p3 | `configuration principle, take B3=488.88±0.05mm. …` | 488.88 ±0.05 mm |
| p3 | `Take B2=32.5±0.03mm, …` | 32.5 ±0.03 mm |
| p5 | `…the B1, B1 lower value of:B1upper =135±0.05mm;` | 135 ±0.05 mm（旧符号 `pper` → `B1upper`） |
| p5 | `(3)Decomposed B1 upper=125±0.045mm into …` | 125 ±0.045 mm（旧符号 `pper` → `upper`，原文用空格断开） |

另 4 条此前**出不了候选**的写法现在能出（pending +4，都写了 `±` 与 `mm`）：
`B1=238.1±0.07mm`（p3）、`B1=260±0.07mm`（p4）、`B1=125 ± 0.045mm`（p4）、`1below =125±0.045mm`（p5，
符号取紧邻 token `below`）。它们以前被旧规则的 4 字符符号截断 + “每段只取第一个匹配”吃掉。

2 条同值候选改由较早页代表（值不变、出处仍在）：`B1=135 mm`（p6 → p4，两处同值合并）、
`elow=135`（p5 → `B1below=135`，符号不再是截断串）。

`AMBIGUOUS_ASSIGNMENT` 11 → 13 是同一原因：`B1` 这个符号现在有 238.1 / 260 / 135 / 125 四处
**可解析**的取值（旧规则只有 135 一条可解析、其余只留 issue），按 V3.6 的既有语义逐处出候选 + 一条
warning，不择优。

### 4.3 11 条“行内有单位串”里剩下的 3 条（**没有**救回，如实列出）

`probe-expression-units.mjs` 改前/改后对比（`logs/01-probe-before.log` → `logs/01b-probe-after.log`）：
`UNKNOWN_UNIT` 51 → 42，其中“行内有单位串”11 → 3。

| 页 | 原文 | 为什么仍然阻塞 |
|---|---|---|
| r2 p2 | `2个尺寸有本质 的 区 别.L2 =100+0.2mm 要 求 尺 寸` | 是“基本尺寸 + 上偏差”但**没有 ±**（`100+0.2mm`），不属任务卡第 1 节三种形态；硬约束 1 要求不外延，故不解析 |
| r2 p3 | `+0.2 mm,L2 Lb=5` | 单位在行首（文本层顺序），不是“整段表达式末尾”，无形态可依 |
| r6 p5 | `…Closed loop a01=a3−a4, amax=0.04/2−` | 末尾不是数值也不是单位（式子含 `/`、行尾是 `−`），且本任务不做算术求值 |

这 3 条要救，得放宽形态或做求值，本任务明确不做（见第七节）。

---

## 五、`baseline.json` 更新与理由

```bash
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs \
  node scripts/real-doc-metrics.mjs --update-baseline --reason "…"
```

原文 `logs/02-update-baseline.log`：**32 处变化**，按来源分四类（不是“整体重写”）：

| 类别 | 处数 | 内容 |
|---|---|---|
| 版本串 | 8 | 6 份文档 + `rules` + `summary.rules` 的 `document-extractor-3 → 4` |
| r6 规则效果 | 16 | `candidates.total 80→84`、`pending 15→27`、`blocked 65→57`、`byKind[ring] 52→56`、`blockedReasonCodes[UNKNOWN_UNIT] 37→29`、`issues.blocked 29→18`、`issues.total 40→29`、`byCode[UNKNOWN_UNIT] 29→18` |
| r5 E-07 | 6 | `candidates.total 5→4`、`blocked 3→2`、`byKind[ring] 5→4`、`issues.total 1→0`、`issues.warning 1→0`、`byCode[AMBIGUOUS_ASSIGNMENT]` 消失 |
| 汇总 | 6 | `total 123→126`、`pending 26→38`、`blocked 97→88`、`confirmableRate 0.2114→0.3016`、`blockedRate 0.7886→0.6984`、`reasonCodeTop5` 前两位互换（`FORMULA_UNSUPPORTED 45` 变成第一） |

`baselineReason` 写明了完整理由（逐条对应 4.2 / 4.3）。更新后不带参数再跑一次 → `BASELINE MATCH`
（`logs/08-metrics-real-docs.log` 末尾）。

---

## 六、M19 变异：关掉末尾单位归属

patch：`mutations/M19-disable-expression-unit-attribution.patch`（只改 `parse.ts` 一处：把片段长度
压成 0，形态永远认不出来；`tsc` 仍通过，`git apply --check` 通过）。

| 状态 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 关闭末尾单位归属 | `npx vitest run src/document-extraction/__tests__/expressionUnits.test.ts` | **4 failed / 8 passed**：E-01、E-02、E-03、E-04 全红 | `mutations/M19-red.log` |
| 恢复 | 同上 | **12 passed** | `mutations/M19-green.log` |

同时值得注意（说明变异不是“全红=什么都没测”）：E-05（无单位仍阻塞）、E-06（P0 继承）、
E-07（下标碎片）在变异下仍**绿**——变异只打掉“能取到末尾单位的地方”，没打掉“该阻塞的地方”。

复现：

```bash
git apply docs/evidence/extract-expr-unit/mutations/M19-disable-expression-unit-attribution.patch
npx vitest run src/document-extraction/__tests__/expressionUnits.test.ts   # 预期红
git checkout -- src/document-extraction/parse.ts
npx vitest run src/document-extraction/__tests__/expressionUnits.test.ts   # 预期绿
```

---

## 七、六条命令 + 打包（原始输出）

| # | 命令 | 结果 | 日志 |
|---|---|---|---|
| 1 | `npm test` | 100 files / **1061 tests** 全通过，exit 0 | `logs/03-test.log` |
| 2 | `npm run test:desktop` | 32 files / **237 tests** 全通过，exit 0 | `logs/04-test-desktop.log` |
| 3 | `npm run typecheck` | 无输出，exit 0 | `logs/05-typecheck.log` |
| 4 | `npm run lint` | 无告警，exit 0 | `logs/06-lint.log` |
| 5 | `npm run test:real-docs` | 通过，exit 0 | `logs/07-test-real-docs.log` |
| 6 | `npm run metrics:real-docs` | 度量输出 + `BASELINE MATCH`，exit 0 | `logs/08-metrics-real-docs.log` |
| 7 | `npm run package:desktop -- --arch=arm64` | 打包成功，日志末尾 `RESULT PASS 打包产物中的 pdf worker 可被 main.cjs 运行时加载`，exit 0 | `logs/09-package-desktop.log` |
| 8 | `npm run check:package:pdf-worker` | `RESULT PASS`，exit 0（asar 内 `pdf.worker.mjs` sha256 `b4c8353d…` 与 `node_modules/pdfjs-dist` 一致） | `logs/10-check-package-pdf-worker.log` |

小插曲（如实记录）：第一次 `npm run lint` 报 `no-useless-assignment`（`let nominal = null` 初值没被读到），
改成不带初值的声明后 lint 与 typecheck 都过；随后重跑了 `npm test` 与度量，数字未变。

---

## 八、未做 / 已知问题（如实列出）

1. **3 条“行内有单位串”的候选仍阻塞**（4.3）：`L2 =100+0.2mm`（只有上偏差、无 ±）、
   `+0.2 mm,L2 Lb=5`（单位在行首）、`amax=0.04/2−`（末尾不是数值/单位）。要救必须放宽形态或做
   算术求值，任务卡明确禁止，因此没有动。
2. **`±` 只在不写单位时仍解析不出偏差**：`A = 230 ± 0.3`（无单位）走旧解析 → 拿到继承的 mm，
   但上下偏差留空（E-06 只保护“继承”本身）。要让“无单位 + ±”也出偏差，需要把形态 2 与继承组合，
   属规则扩围，本任务不做。
3. **一行多个赋值的结构沿用旧行为**：每个逗号片段只取第一个匹配，`;` 分隔的后续赋值不另出候选
   （例：`Take B2=32.5±0.03mm, and take B1=238.1±0.07mm; B2=32.5- 0.03mm; B3=488.88±0.05mm.`
   只出 B2 与 B1；那一行里的 B3 没被取，B3 是靠另一行救回的）。要按 `;` 再切分属另一件事。
4. **符号取“等号左侧紧邻的连续字母数字串”**：原文用空格断开时只能取到后一个 token
   （`B1 upper=` → `upper`，`1below =` → `below`）。这是文本层事实，不跨空格合成符号；
   `rawText` 与出处保留原文，人工可核对。旧规则会把它们截成 `pper` / `elow`，同类问题但不截断。
5. **粘连的下标行仍会出候选**：只按最窄形态 `^[a-z]\s*=\s*[01]$` 排除。r2 p4 的 `i=1`、r5 p3 的
   `i=0` 已排除；但 `ïi=1`、`i=1i=1`（r2 p4）与 `i=1ï`（r5 p3）这类粘连行仍各出一条
   `UNKNOWN_UNIT` 阻塞候选（它们本来就不是 pending，不影响验收线）。
6. **`EXTRACTION_EMPTY` 在 0 候选时不进 issues**（P0 之前就有的缺陷：`linkedIssues` 在 push 之前算）。
   本任务没修（不在范围），因此 E-07 只断言“没有候选”，没有断言这条 warning。
7. **英文 `in` 的单位歧义**：形态匹配沿用 `UNIT_TEXT_SOURCE`（含 `in`），理论上 `L = 135 in Figure 5`
   会被当英制。本次语料未触发（度量里 `UNSUPPORTED_UNIT` 仍只有 1 条、位置未变），作为残留风险记录。
8. **`desktop/tests/e2e/v36drafts.mjs` 未运行**：它需要打包应用 + 重新生成的 `DRAFTS-V36.cunlian` 夹具；
   本次只把硬编码版本串同步到 v4（否则升版后必红），这条 CDP 走查**没有实测**，如实标注为未测。
