# P0 单位从表头/上下文继承（`document-extractor-3`）

一句话：单元格/数值项自己没写单位、但**表头 / 同一页的「单位：」句 / 图注 / 页范围第一页的
文档级声明**明确写了单位时，允许继承该单位，并把声明本身的页 / 选区 / item 索引 / 原文片段
写进候选出处；没有显式文字时照旧 `UNKNOWN_UNIT` 阻塞，同作用域两个不同单位一律
`UNIT_CONFLICT` 阻塞、不择优。

分支 `agent/extract-unit-inherit`，基线 `main 9b5491e`。

| 项 | 值 |
|---|---|
| 实现提交 | `b6d44cf`（规则 + 夹具 + U-01～U-08 + 版本串同步） |
| 证据提交 | 紧随实现提交的 `docs(evidence): 单位继承 …` 一笔（本目录 + 日志 + M18 + baseline 更新），哈希见 `git log --oneline 9b5491e..HEAD` |
| 规则版本 | `document-extractor-2` → **`document-extractor-3`** |
| 用例 | U-01～U-08，共 17 条断言（全部通过） |
| 真实文档度量 | **123 / 26 / 21.1% 不变**（6 份逐份不变，只有版本号变），原因见第四节 |
| 变异 | M18 关闭继承 → 13 红 4 绿；恢复 → 17 绿 |

---

## 一、规则（落地时怎么判）

单位来源只有四种**显式**写法，全部来自文本层原文，全部带出处：

| 作用域 | 识别写法 | 覆盖范围 |
|---|---|---|
| `table` | 表头 `基本尺寸(mm)`、`基本尺寸 (mm)`、`基本尺寸/mm` | 只管这张表自己的数据行 |
| `page` | `单位：mm` / `单位:mm` / `单位为毫米` / `单位是 mm` / `Unit: mm` | 只管本页数值 |
| `caption` | 行首 `图 3 …（mm）` / `图注 …（mm）` / `Fig. 2 … (inch)` | 只管本页数值 |
| `document` | 同上「`单位：`」写法，且出现在**所请求页范围的第一页** | 覆盖整个页范围 |

判定顺序（`src/document-extraction/unitScope.ts` + `parse.ts:buildQuantity`）：

1. **显式单位永远优先**。这一处自己写了单位串就用它，继承值不覆盖（硬约束 3）。
2. 这一处没写单位 → 合并「文档级 + 本页 + 本表表头」全部声明，按出处去重：
   - 只剩一种单位 → 继承，并把声明出处追加进该数值字段的 `evidence`；
   - 出现两种及以上不同单位 → `UNIT_CONFLICT`，值留原文、`valueQ=null`，**不挑一个**；
   - 一条声明都没有 → 照旧 `UNKNOWN_UNIT` / `UNSUPPORTED_UNIT`（硬约束 5，原义不变）。
3. 跨页只认文档级声明：表头不跨页（续表那页没有表头就不构成候选），页级/图注不跨页。
4. 不新增 schema 字段。审计线索放在两处：`evidence`（能点回表头/声明的那一段文字）与
   `confidenceBasis` 的 `RULE_UNIT_INHERITED_{TABLE|PAGE|CAPTION|DOCUMENT}`。
   `QuantityValue.unitText` 记录“这一处可用的单位串”（显式写的或声明里的），
   `valueQ` 仍只在 mm 且精度合法时才有值。

`UNIT_CONFLICT` 在 V3.6 就已在 `EXTRACTION_REASON_CODES` 里预留（`types.ts`），本次是它第一次
真正被产生；schema 与判定阈值、q 精度、公式解析一行未改。

---

## 二、改动清单

| 文件 | 改动 |
|---|---|
| `src/document-extraction/unitScope.ts` | **新增**。显式单位声明的识别与作用域合并（纯函数，无 IO） |
| `src/document-extraction/parse.ts` | 单位作用域收集、`buildQuantity` 继承与冲突、表格行单位分组、`UNIT_CONFLICT` issue、`confidenceBasis` 标记 |
| `src/document-extraction/types.ts` | `EXTRACTOR_VERSION` → `document-extractor-3`（含版本语义说明） |
| `src/document-extraction/__fixtures__/unit-inherit-sample.pdf` | **新增** 12 页合成夹具（一页一场景） |
| `src/document-extraction/__tests__/unitInheritance.test.ts` | **新增** U-01～U-08（17 条） |
| `scripts/make-unit-inherit-sample.cjs` | **新增** 夹具生成脚本（Chromium `printToPDF`） |
| `scripts/v36-drafts-seed.ts`、`desktop/tests/e2e/v36drafts.mjs` | V3.6 草稿 seed/e2e 的硬编码版本串同步到 v3（升版带来的连带修改） |
| `docs/evidence/real-doc-baseline/{baseline.json,metrics.json,README.md}` | 基线随版本号更新 + 第七节说明 |
| `docs/evidence/extract-unit-inherit/**` | 本文、诊断探针、日志、M18 |

夹具生成命令（可复核，Apple Silicon 本机）：

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron \
  scripts/make-unit-inherit-sample.cjs src/document-extraction/__fixtures__/unit-inherit-sample.pdf
# written src/document-extraction/__fixtures__/unit-inherit-sample.pdf 256042 bytes
```

12 页一页一个场景（p1 文档级声明 / p2–p3 正文与无单位表头 / p4 表头单位 / p5 单元格 in /
p6 冲突 / p7 无线索 / p8–p9 跨页表 / p10 图注 / p11–p12 量级与英制），测试按页范围分别取用，
所以“文档级声明”的作用域就是该范围第一页——与实现定义一致，不靠测试放宽。

---

## 三、U-01～U-08 真实输出

命令（原文见 `logs/08-unit-U01-U08.log`）：

```bash
npx vitest run src/document-extraction/__tests__/unitInheritance.test.ts --reporter=verbose
```

结果：**17 passed (17)**。逐场景关键数字（都是测试真实断言，不是推算）：

| 用例 | 期望 | 实测 |
|---|---|---|
| U-01 表头 `基本尺寸/mm` | 继承 mm，出处指向表头文本项 | 2 条候选 pending，`52.20 → valueQ 522000`、偏差 `±0.02 → ±200`；出处含表头选区 `基本尺⼨/mm`（第 4 页，y 高于数据行），basis `RULE_UNIT_INHERITED_TABLE` |
| U-02 第 1 页 `单位：mm` | 后续页全部继承，出处指向该声明 | 4 条候选 pending（H/B1/S 在第 2 页、B2 在第 3 页），每条出处都含第 1 页 `单位：mm` 选区，basis `RULE_UNIT_INHERITED_DOCUMENT` |
| U-03 表头 mm + 单元格 `in` | 保留 in，不被覆盖，报 `UNSUPPORTED_UNIT` | 候选 blocked，`UNSUPPORTED_UNIT`（且**不是** `UNIT_CONFLICT`）；`text=2.05`、`unitText=in`、`unit=null`、`valueQ=null`；同行的 `±0.02` 仍按表头继承 mm（`±200` q） |
| U-04 表头 mm + 正文「单位为英寸」 | `UNIT_CONFLICT`，不许二选一 | 只产出 **1 条** blocked 候选（不是 mm/in 两条），三个字段 `unit=null`、`valueQ=null`、原文数字原样保留；issue `UNIT_CONFLICT`（blocked）同时挂表头与英寸两处出处，文案含「未择优」 |
| U-05 完全无线索 | 仍 `UNKNOWN_UNIT` 阻塞 | 2 条候选（表头行 + `K = 30`）都 blocked，`reasonCodes = ['UNKNOWN_UNIT']`，`unit=null`，没有任何 `RULE_UNIT_INHERITED_*` |
| U-06 单位声明在表格上一页 | 按「同一表格」判定，取不到就阻塞 | 第 8 页表正常继承表头（pending）；第 9 页续表行因无表头**不构成候选**，第 9 页的 `K = 30` 仍 `UNKNOWN_UNIT`，且其出处全在第 9 页（没有跨页继承第 8 页表头） |
| U-07 图注「间隙（mm）」 | 继承 mm，出处指向图注 | 2 条候选 pending，`0.15 → 1500 q`、`0.20 → 2000 q`，出处含第 10 页图注选区，basis `RULE_UNIT_INHERITED_CAPTION` |
| U-08 量级判据不被破坏 | 越界仍报既有错误；英制不换算 | `12.34567` → `PRECISION_UNSUPPORTED`（不四舍五入）；`12345678` → `NUMBER_UNSUPPORTED`（不截断）；`单位：英寸` + `0.15` → `UNSUPPORTED_UNIT`、`valueQ=null`；对照：继承到 mm 的 `0.15` = `1500 q`——两者量级不同，没有被互换 |

另有 1 条“证据完整性”测试：把 U-01～U-08 九个页范围各跑一遍，**每个数值字段的每条出处**
都过 `isEvidenceComplete`（版本/页/选区/原文/页框），且页码都落在请求范围内；继承没有豁免出处要求。

---

## 四、真实文档度量：改前 / 改后（一条命令，逐份）

```bash
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs node scripts/real-doc-metrics.mjs
```

- 改前（`main 9b5491e`，`document-extractor-2`）原文：`logs/00-metrics-before-v2.txt`
- 改后（本分支，`document-extractor-3`）原文：`logs/06-metrics-real-docs.log`

| 文档 | 改前 候选/pending/blocked | 改后 候选/pending/blocked | 增减 |
|---|---|---|---|
| r1 装配工艺课件（zh，74 页） | 15 / 4 / 11（26.7%） | 15 / 4 / 11（26.7%） | 0 / 0 / 0 |
| r2 北理工学报（zh，5 页） | 20 / 5 / 15（25.0%） | 20 / 5 / 15（25.0%） | 0 / 0 / 0 |
| r3 RV 减速器（zh，4 页） | 3 / 0 / 3（0.0%） | 3 / 0 / 3（0.0%） | 0 / 0 / 0 |
| r4 MT/T 1097（zh，170 页，`PAGE_LIMIT`） | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| r5 英文公差分析（en，8 页） | 5 / 2 / 3（40.0%） | 5 / 2 / 3（40.0%） | 0 / 0 / 0 |
| r6 英文装配工艺（en，8 页） | 80 / 15 / 65（18.8%） | 80 / 15 / 65（18.8%） | 0 / 0 / 0 |
| **汇总** | **123 / 26 / 97；21.1% / 78.9%** | **123 / 26 / 97；21.1% / 78.9%** | **0 / 0 / 0** |

原因码分布（对 97 条 blocked 候选计数）：

| 原因码 | 改前 | 改后 |
|---|---:|---:|
| `UNKNOWN_UNIT` | 51 | 51 |
| `FORMULA_UNSUPPORTED` | 45 | 45 |
| `UNSUPPORTED_UNIT` | 1 | 1 |
| `UNIT_CONFLICT` | 0（未产生过） | 0 |

问题码（issue）逐份也不变（r1 `UNKNOWN_UNIT×53 / AMBIGUOUS_ASSIGNMENT×2 / NO_TEXT_LAYER×1`、
r2 `UNKNOWN_UNIT×5 / AMBIGUOUS_ASSIGNMENT×2`、r3 无、r4 `PAGE_LIMIT×1`、
r5 `AMBIGUOUS_ASSIGNMENT×1`、r6 `UNKNOWN_UNIT×29 / AMBIGUOUS_ASSIGNMENT×11`），
r4 的 1-20 页探针同样不变（候选 1、阻塞 1、`UNKNOWN_UNIT×1`）。

**没有任何一份文档的数字下降**，也没有上升——每份都是 0 变化，原因必须逐份说明（第五节），
不是“没测到”。

---

## 五、为什么 6 份都是 0 变化（逐份解释，可复跑）

诊断探针（证据用，非产品脚本）：

```bash
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs \
  node docs/evidence/extract-unit-inherit/probe-unit-declarations.mjs
# 原文：logs/07-unit-declarations-probe.log
```

它用产品同一套 `detectUnitDeclarations` / `buildExtractionDraft` 数两件事：
语料里到底有几条**显式单位声明**，以及每条 `UNKNOWN_UNIT` 阻塞候选长什么样。

| 文档 | 显式单位声明 | `UNKNOWN_UNIT` 阻塞候选 | 其中：行内有单位串但不在数值 token 上（A） | 行内完全没单位串（B） | 下标片段 i=0/i=1（C） | 因继承拿到单位的候选 |
|---|---:|---:|---:|---:|---:|---:|
| r1 | 0 | 4 | 0 | 4 | 0 | 0 |
| r2 | 0 | 6 | 2 | 3 | 1 | 0 |
| r3 | 0 | 1 | 0 | 1 | 0 | 0 |
| r4 | **58**（全部是「单位为毫米」） | 0 | 0 | 0 | 0 | 0 |
| r5 | 0 | 3 | 0 | 2 | 1 | 0 |
| r6 | 0 | 37 | 9 | 28 | 0 | 0 |
| 合计 | 58 | 51 | 11 | 38 | 2 | **0** |

逐份结论：

- **r1 / r2 / r3 / r5 / r6**：整份文档**一条** P0 认可的显式单位声明都没有。这 51 条
  `UNKNOWN_UNIT` 里，38 条所在行根本没有任何单位串（真正缺证据 → 必须继续阻塞），
  2 条是 `i=0` / `i=1` 这类公式下标碎片（误报候选，与单位无关），
  11 条的行内**确实写了 mm**，但单位串不在被解析的那个数值 token 上
  （典型：`A0max=1753.1−759.38−765.31=228.41mm`、`A=230±0.3mm`——单位写在整段表达式末尾，
  中间夹着 ±偏差或第二个等号）。要救这 11 条得改**数值/表达式的解析规则**，
  任务卡第 1 节第 5 条明确禁止（“不改已有候选的数值解析”），因此本任务不碰，也不会
  把它们算成“继承能解决”。
- **r4**：唯一有显式声明的一份（58 条「单位为毫米」），但它是 170 页标准、整份 `PAGE_LIMIT`
  （0 候选），声明再多也没有可继承的数值；页范围探针 1-20 页同样只有 1 条 `UNKNOWN_UNIT`
  候选，那页也没有声明。

因此 P0 在**这批语料上**的正确结果是 0 变化：规则做对了没有凭空放宽。
（反过来讲：如果有人拿这次改动去宣称“UNKNOWN_UNIT 下降 53%”，那一定是放宽了条件。）

真正的改进证据在合成夹具里（第三节 U-01/U-02/U-07），以及“有声明就继承、没声明就阻塞”
这条边界（U-05/U-06）。

---

## 六、`baseline.json` 更新与理由

```bash
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs \
  node scripts/real-doc-metrics.mjs --update-baseline --reason "…"
```

脚本打印的变化（原文见执行输出）：

```
变化 documents[0].extractorVersion: "document-extractor-2" → "document-extractor-3"
…（documents[1..5] 同）
变化 rules.extractorVersion: "document-extractor-2" → "document-extractor-3"
变化 summary.rules.extractorVersion: "document-extractor-2" → "document-extractor-3"
相对旧基线共 8 处变化
```

**8 处全部是版本串**，没有任何候选数/pending/blocked/原因码/页码变化。
更新理由已写进 `baseline.json` 的 `baselineReason`（摘要：语料里唯一的显式声明在 `PAGE_LIMIT`
的 r4；51 条 `UNKNOWN_UNIT` 里 11 条属数值解析、38 条无任何单位串、2 条下标片段，
0 条满足继承前提）。更新后不带参数再跑一次 → `BASELINE MATCH`（`logs/06`）。

---

## 七、M18 变异：关闭单位继承

patch：`mutations/M18-disable-unit-inheritance.patch`（只改 `parse.ts` 一处，把作用域解析结果
强制成 `absent`，其余代码不动；`tsc` 仍通过）。

| 状态 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 关闭继承 | `npx vitest run src/document-extraction/__tests__/unitInheritance.test.ts` | **13 failed / 4 passed**，U-01、U-02、U-07 全红 | `mutations/M18-red.log` |
| 恢复 | 同上 | **17 passed** | `mutations/M18-restored.log` |

同时值得注意的两点（说明变异不是“全红=什么都没测”）：
`U-05 完全没有任何单位线索` 在变异下仍然**绿**（关掉继承后它本来就该阻塞），
`U-06 不许跨页继承` 那条也仍绿——变异只打掉“能继承的地方”，没打掉“该阻塞的地方”。

复现：

```bash
git apply docs/evidence/extract-unit-inherit/mutations/M18-disable-unit-inheritance.patch
npx vitest run src/document-extraction/__tests__/unitInheritance.test.ts   # 预期红
git checkout -- src/document-extraction/parse.ts
npx vitest run src/document-extraction/__tests__/unitInheritance.test.ts   # 预期绿
```

---

## 八、六条命令 + 打包（原始输出）

| # | 命令 | 结果 | 日志 |
|---|---|---|---|
| 1 | `npm test` | 99 files / **1049 tests** 全通过，exit 0 | `logs/01-test.log` |
| 2 | `npm run test:desktop` | 32 files / **237 tests** 全通过，exit 0 | `logs/02-test-desktop.log` |
| 3 | `npm run typecheck` | 无输出（`tsc -p tsconfig.app.json && -p tsconfig.node.json` 均通过），exit 0 | `logs/03-typecheck.log` |
| 4 | `npm run lint` | 无告警，exit 0 | `logs/04-lint.log` |
| 5 | `npm run test:real-docs` | 1 file / 5 tests 通过（含 `CORPUS_MISSING`/`MISMATCH` 守卫与基线逐项比对），exit 0 | `logs/05-test-real-docs.log` |
| 6 | `npm run metrics:real-docs` | 度量输出 + `BASELINE MATCH`，exit 0 | `logs/06-metrics-real-docs.log` |
| 7 | `npm run package:desktop -- --arch=arm64` | 打包成功 → `out/寸链-darwin-arm64/寸链.app`，exit 0（日志末尾自检 `RESULT PASS 打包产物中的 pdf worker 可被 main.cjs 运行时加载`） | `logs/09-package-desktop.log` |
| 8 | `npm run check:package:pdf-worker` | 7 条 PASS，`RESULT PASS`，exit 0（asar 内 `pdf.worker.mjs` 与 `node_modules/pdfjs-dist` 同版本字节一致） | `logs/10-check-pdf-worker.log` |

---

## 九、未做 / 已知问题（如实列出）

1. **`FORMULA_UNSUPPORTED` 的 45 条本任务不碰**（留 P1）。本次没有改任何公式解析代码，
   `parseFormulaLine` / `checkConflicts` 一行未动。
2. **11 条“行内有单位串但不在数值 token 上”的候选仍未解决**（第五节 A 类）。它们要的是
   “表达式/±偏差解析”，属数值解析规则变更，按任务卡第 1 节第 5 条不做；这批不是继承能救的，
   也不该记在 P0 的账上。
3. **跨页表格本身仍不解析**：续页没有表头就不产出候选（U-06 用测试锁住“不许跨页猜”）。
   要真正吃下跨页表，需要版面级表格重建，属另一件事。
4. **文档级声明的作用域是“所请求页范围的第一页”**，不是“PDF 第 1 页”。用户只选 10-20 页时，
   封面上的「单位：mm」不会被读到（宁可不继承，也不跨范围猜）。这是刻意的保守取舍。
5. **继承只认四种写法**（表头括号/斜杠、`单位：`、`Unit:`、图注括号）。`Units of: mm`、
   `所有尺寸单位 mm`、页脚 `All dimensions in mm` 之类目前不识别；宁可少继承，不扩写法。
   另：正文里孤立的 `(mm)` 不会被当成页级声明（只有图注行才认），避免把 `0.054(mm)` 这类
   句子误当声明。
6. **`RULE_UNIT_UNSUPPORTED` 这条 confidenceBasis 文案对“精度超限但写了 mm”的候选会显得别扭**
   （`unitText` 有值、`unit` 为 null）。这是 V3.6 就存在的老行为，本次未改（属 UI 文案，不在
   本任务范围）。
7. **`desktop/tests/e2e/v36drafts.mjs` 未运行**：它需要打包应用 + 重新生成的
   `DRAFTS-V36.cunlian` 夹具。本次只把它的硬编码版本串同步到 v3（否则升版后必红），
   打包应用可正常产出，但这条 CDP 走查**没有实测**，如实标注为未测。
8. 合成夹具只有中文页面（英制/英文写法通过 `单位：英寸`、`in` 覆盖），没有做英文版夹具的
   独立验证；`Unit: mm` 英文写法目前只有 `unitScope` 的正则覆盖，没有夹具用例。
