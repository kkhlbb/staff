# L1-a 整份失败 → 部分成功（`document-extractor-6`）

一句话：页跨度超过 `MAX_EXTRACTION_PAGES`（100）不再整份返回 `PAGE_LIMIT` + 0 候选，
而是**按上限顺序切块**、逐块跑同一套逐页扫描再合并；单块失败不连坐，坏页不废整份，
合并结果与“整份一次扫描”等价且两次运行字节一致。

真实语料 r4（MT/T 1097，170 页）改前**整份 0 候选**，改后 **7 条候选**（pending 1）；
其余 5 份的候选数与可确认数**逐个不变**（逐份表见第四节）。

分支 `agent/extract-chunking`，基线 `main 5b2f06c`（V4.0 + DXF + P2 已合入）。

| 项 | 值 |
|---|---|
| 实现提交 | `69857f2`（规则 + 用例 + main 侧放开页跨度 + 版本串同步） |
| 证据提交 | 本目录（本文 + 日志 + M23 + baseline 更新），哈希见 `git log --oneline 5b2f06c..HEAD` |
| 规则版本 | `document-extractor-5` → **`document-extractor-6`** |
| 新增用例 | C-01～C-07（`chunking.test.ts`）+ schema8 切块往返 1 条 + main 侧 170 页 1 条 |
| 度量 | 候选 **131 → 138**；pending **57 → 58**；r4 **0 → 7**；其余 5 份 0 变化 |
| 变异 | M23 关掉切块（回退整份拒绝）→ 6 failed / 1 passed；恢复 → 7 passed |

---

## 一、规则（落地时怎么判）

实现全在 `src/document-extraction/parse.ts`，分三层：

1. `planExtractionChunks(range)`：1-based 闭区间，每块最多 100 页、`index` 从 1 开始。
   页跨度 ≤ 100 → 恰好一块，**不写任何 CHUNK_* issue**，与旧版逐页扫描完全同构。
2. `scanChunkPages(pages, source, unitContext)`：一块页面 → 组成环条目 + 直接候选
   （部件/区间/公式）+ 本块 issue。**组成环不在这里 resolve**。
3. 合并：所有块的组成环条目汇总后统一 `resolveRings`（跨块同符号按**全局出现顺序**编号
   occurrence，同符号同值跨块仍合并成一条），再接上直接候选；之后 `checkConflicts`、
   `sortCandidates`、上限截断都作用于整份文档。

几条硬边界：

- **切的是页数组，不重读文件**：`request.layer.pages` 已在请求里，切块只做
  `pages.filter(page.page ∈ [from, to])`；同一 revision 只解析一次 PDF 字节。
- **单位语义不因切块改变**：单位上下文按**整个请求页范围**收集一次再传给每一块，
  文档级声明仍取请求范围第一页的「单位：」句（不是每块自己的首页）。
- **单块失败不连坐**：块扫描抛错时**整块**丢弃（不留半截条目），只发一条
  `CHUNK_FAILED`（blocked，`page` = 块起始页，`chunk={index,from,to}`，message 含页范围与
  错误原因）；其余块照常并入。
- **不静默丢块**：每块处理完成发一条 `CHUNK_PROCESSED`（warning），message 写明页范围、
  本块扫描到的条目数与问题数。issue 上新增可选字段 `chunk:{index,from,to}`。
- **坏页不废全份**：逐页判定，无文本层的页只在该页发 `NO_TEXT_LAYER`（blocked）并继续，
  其余页（含跨块边界的另一侧）照常出候选。
- **来源身份不因切块变化**：`sourceIdentity` 仍是请求里的 `documentId/revisionId/sha256/
  blobKey/pageCount`，`pageRange` 仍是用户请求的页范围；幂等键未加块信息。
- **不放宽任何判据**：单位/精度/公式/出处完整性/同符号多值互斥全部沿用原规则
  （C-07 用“无单位行仍 UNKNOWN_UNIT 阻塞”钉住）。

`schema` 只做加法：`ExtractionIssue.chunk?: {index, from, to}` 可选、可读旧草稿，
`src/project-file/validation.ts` 的 `extractionIssueSchema` 同步接受（`.nullable().optional()` +
`to >= from`）。候选字段、q 精度、既有字段语义一律未动。

`PAGE_LIMIT` 已不再由提取器产生，但**保留在原因码表**里以读旧草稿（代码注释注明）。

参考：切块边界与合并语义以任务卡第 1 节为准；合并后“整份一次扫描”的等价性用
`logs/05-r4-chunked.log` 与 `logs/06-r4-singlepass.log` 的候选数组 SHA-256 对照证明（第五节）。

---

## 二、改动清单

| 文件 | 改动 |
|---|---|
| `src/document-extraction/types.ts` | `EXTRACTOR_VERSION` → `document-extractor-6`（注释写明 v6 语义）；新增 `ExtractionChunkRef`；`ExtractionIssue.chunk?`（纯加法）；issue 码新增 `CHUNK_PROCESSED` / `CHUNK_FAILED`；`PAGE_LIMIT` 标注为旧码 |
| `src/document-extraction/parse.ts` | 去掉“页跨度超上限即整份拒绝”；新增 `scanChunkPages` / `planExtractionChunks` / `chunkIssue` / `errorSummary`；`buildExtractionDraft` 改为“收集单位上下文 → 逐块扫描 → 跨块汇总 resolve → 统一排序” |
| `src/document-extraction/index.ts` | 导出 `ExtractionChunkRef` 类型 |
| `src/project-file/validation.ts` | `extractionIssueSchema` 接受可选 `chunk`（严格对象 + 范围校验） |
| `desktop/main/extractionService.ts` | 删除 main 侧“页跨度 > 100 → `TOO_LARGE`”的整份拒绝（页范围合法 + 不超 PDF 页数照旧校验） |
| `src/document-extraction/__tests__/chunking.test.ts` | **新增** C-01～C-07（合成文本层，纯数据，不依赖 PDF 夹具） |
| `src/project-file/schema8.test.ts` | **新增** 1 条：170 页切块草稿 encode→decode，`chunk` 页范围与全量内容逐字段保留 |
| `desktop/tests/extraction.test.ts` | **新增** 1 条：170 页经 main 侧提取不再被拦（CHUNK_PROCESSED×2、无 PAGE_LIMIT） |
| `src/document-extraction/__tests__/{expressionUnits,formulaForms}.test.ts` | 升版断言 5 → 6 |
| `scripts/v36-drafts-seed.ts`、`desktop/tests/e2e/v36drafts.mjs` | V3.6 草稿 seed/e2e 的硬编码版本串同步到 v6（否则升版必红） |
| `docs/evidence/real-doc-baseline/{baseline.json,metrics.json}` | 基线随规则更新（40 处 diff，分类见第六节） |
| `docs/evidence/extract-chunking/**` | 本文、r4 探针、日志、M23 补丁与红绿日志 |

---

## 三、C-01～C-07 真实输出

命令与原文：`logs/04-chunking-tests-verbose.log`（`--reporter=verbose`，exit 0，**7 passed**）。

| 用例 | 覆盖的验收点 | 实测 |
|---|---|---|
| C-01 170 页两块合并 | 候选数 = 两块之和；ID 不撞；块踪迹 | 170 页 → **170 条候选**，等于 `[1-100]` 与 `[101-170]` 两次单独提取之和（100 + 70）；ID 集合大小 = 170；`CHUNK_PROCESSED` 两条，`chunk` 分别为 `{1,1,100}` / `{2,101,170}`，message 含「页 1-100」「页 101-170」；无 `PAGE_LIMIT`；`sourceIdentity` 与请求完全相等 |
| C-02 中间块抛错不连坐 | `CHUNK_FAILED` + 页范围；其余块保留 | 250 页（3 块），第 150 页注入「读 items 抛错」→ 1 条 `CHUNK_FAILED`（blocked，`chunk={2,101,200}`，`page=101`，message 含「页 101-200」与错误原文）；`CHUNK_PROCESSED` 只剩第 1、3 块；候选 **150 条**（100 + 50），**没有一条落在 101-200 页**，第 39、250 页仍在 |
| C-03 某页无文本层 | 只标该页，其余页正常 | 150 页第 40 页无 item → `NO_TEXT_LAYER` 恰好 1 条且 `page=40`；候选 **149 条**；第 39/41 页（块内）与第 100/101 页（块边界两侧）、第 150 页都有候选；第 40 页无候选 |
| C-04 跨块同符号全局编号 | 1/2、2/2 + 各自页码 | `B1 = 130 mm`（p1）与 `B1 = 135 mm`（p110，第二块）→ 两条候选，`occurrence` 依次 `{1,2}`、`{2,2}`，`page` 分别 1、110，各自 evidence 全部指向自己的页，`nominal.text` 130 / 135，ID 不同；另有一条 `AMBIGUOUS_ASSIGNMENT`（`page=1`，`candidateIds` 2 条），沿用既有“逐处候选不择优”语义 |
| C-05 连跑两次字节一致 | 幂等 + 来源身份 | 两次构建的 `JSON.stringify(draft)` 完全相等（先断言 170 条候选与 2 条 `CHUNK_PROCESSED`，避免“两次都失败也一致”）；`draftId` / `idempotencyKey` / `sourceIdentity` 相同，`revisionId=rev-chunk-synthetic-170`、`sha256=c…c` 未被切块改写 |
| C-06 显式页范围优先 | 用户 pageRange 语义不变 | 170 页文档请求 `60..140`（81 页 ≤ 100）→ 只跑一块，候选 81 条，**0 条 CHUNK_* issue**，`pageRange={60,140}`，候选页码全在范围内 |
| C-07 切块不等于放宽 | 判据/单位/出处不变 | 第 120 页 `D001 = 10`（无单位）在切块路径里仍 `blocked` + `UNKNOWN_UNIT`，`unit=null`、`valueQ=null`；所有候选的每条 evidence 都过 `isEvidenceComplete` 且页码在 1-170 内 |

配套两条（另两个文件的断言，日志 `logs/04b-…`、`logs/04c-…`）：

- `schema8.test.ts`「切块草稿（170 页）往返」：encode → decode 后 `CHUNK_PROCESSED` 的
  `chunk` 仍是 `[{1,1,100},{2,101,170}]`，且整份草稿 `toEqual` 原草稿（纯加法字段不扰动其它内容）。
- `desktop/tests/extraction.test.ts`「170 页超过单块上限」：走真实 `ExtractionService.run` →
  `candidateCount=170`，无 `PAGE_LIMIT`，两条 `CHUNK_PROCESSED`，`sourceIdentity.pageCount=170`。

---

## 四、真实文档度量：改前 / 改后（逐份）

```bash
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs node scripts/real-doc-metrics.mjs
```

- 改前（`main 5b2f06c`，`document-extractor-5`）原文：`logs/00-metrics-before-main.txt`
- 改后（本分支，`document-extractor-6`）原文：`logs/01-metrics-after-chunking.txt`

| 文档 | 改前 候选/pending/blocked | 改后 候选/pending/blocked | 增减 |
|---|---|---|---|
| r1 装配工艺课件（zh，74 页） | 15 / 4 / 11（26.7%） | 15 / 4 / 11（26.7%） | 0 / 0 / 0 |
| r2 北理工学报（zh，5 页） | 22 / 7 / 15（31.8%） | 22 / 7 / 15（31.8%） | 0 / 0 / 0 |
| r3 RV 减速器（zh，4 页） | 3 / 0 / 3（0.0%） | 3 / 0 / 3（0.0%） | 0 / 0 / 0 |
| **r4 MT/T 1097（zh，170 页，`PAGE_LIMIT`）** | **0 / 0 / 0（n/a）** | **7 / 1 / 6（14.3%）** | **+7 / +1 / +6** |
| r5 英文公差分析（en，8 页） | 4 / 2 / 2（50.0%） | 4 / 2 / 2（50.0%） | 0 / 0 / 0 |
| r6 英文装配工艺（en，8 页） | 87 / 44 / 43（50.6%） | 87 / 44 / 43（50.6%） | 0 / 0 / 0 |
| **汇总** | **131 / 57 / 74；43.5% / 56.5%** | **138 / 58 / 80；42.0% / 58.0%** | **+7 / +1 / +6** |

验收线（“r4 从 0 候选 → 有候选；其余 5 份候选数与可确认数一个都不许掉”）：**过了**——
r1/r2/r3/r5/r6 的 `candidates.total / pending / blocked` 全部逐字未变（baseline diff 里这 5 份
只出现 `extractorVersion` 一处变化，见第六节）。

### 4.1 汇总可确认率为什么从 43.5% 降到 42.0%（如实说明）

分母多了 r4 的 7 条，其中只有 1 条 pending：57/131 → 58/138。这是**新救回的文档**以真实质量
计入分母，不是既有文档退化（既有 5 份的 pending 一条没少）。r4 的 7 条候选与状态：

| 页 | 类型 | 状态 | 原因 / 内容 |
|---|---|---|---|
| p13 | ring | blocked | `UNKNOWN_UNIT`；原文行 `mn nominal=2`（无单位声明） |
| p22 | formula | blocked | `FORMULA_UNSUPPORTED`；`注:Ac=g(sinθ+f cosθ)`（非线性、含三角函数） |
| p29 | part-dimension | blocked | `NUMBER_UNSUPPORTED`；内径原文串 `120150180220260290320`（表格被压成一串数字） |
| p31 | part-dimension | blocked | 同上（`环`） |
| p108 | ring | **pending** | `R nominal=0.5mm`（显式 mm） |
| p170 | formula | blocked | `FORMULA_UNSUPPORTED`；`力 1℉=9/5℃+32` |
| p170 | formula | blocked | `FORMULA_UNSUPPORTED`；`1℃=5/9` |

问题码：r4 `NO_TEXT_LAYER×3`（页 1、2、6，与 manifest 注记一致）+ `CHUNK_PROCESSED×2`；
不再有 `PAGE_LIMIT`。

### 4.2 五份既有文档为什么“一条都不动”

页跨度都 ≤ 100 → `planExtractionChunks` 只产生一块，页数组原样传入 `scanChunkPages`，
条目顺序、`resolveRings` 分组顺序、排序键都没变；单位上下文仍按整份范围收集一次。
因此候选/状态/问题码逐字不变（度量实测一致，见第四节上表与第六节 baseline diff）。

---

## 五、切块合并 ≡ 整份一次扫描（真实 r4 对照）

`logs/05-r4-chunked.log`（上限 100，两块）vs `logs/06-r4-singlepass.log`
（**临时**把 `MAX_EXTRACTION_PAGES` 抬到 1000，等价于旧版“整份一次扫描”的代码路径；
跑完已改回 100，`git diff` 里没有这处改动）：

| 项 | 切块（100） | 整份（1000） |
|---|---|---|
| 候选数 | 7（blocked 6 / pending 1） | 7（blocked 6 / pending 1） |
| 候选数组 SHA-256 | `b1ba4ae8e8be3671607764d7eb5569b4a33c988a1e394ce635761e018f997cdf` | **同左** |
| 非切块 issue SHA-256 | `928dd2334bf0d843545e9f77f214dca40efab7bfc02777dcbad4600a5c5d1f20` | **同左** |
| CHUNK_* issue | `CHUNK_PROCESSED×2` | 无（单块不写） |

即：切块只增加“块踪迹”，不改候选数组的任何一个字节。整份草稿 JSON 见
`logs/05-r4-chunked.json`、`logs/06-r4-singlepass.json`；两者的候选数组 / 非切块 issue /
`sourceIdentity` / `pageRange` 逐字节一致（对照输出 `logs/05b-r4-compare.log`：

```
chunked candidates=7 singlepass candidates=7
candidates identical: true
non-chunk issues identical: true
chunk issues: {"index":1,"from":1,"to":100} {"index":2,"from":101,"to":170}
sourceIdentity identical: true
pageRange identical: true
```

两份 JSON 都按仓库约定走 `serializeEvidence`（`evidenceViolations` 与序列化幂等自检通过；
生成式 `draftId` 按约定写 `<generated>` 并附 `generatedValueKind`/`runTimeFields` 说明）。
数组 SHA-256 由探针在序列化前对原始候选计算，所以是“未规范化”的字节身份。）

---

## 六、`baseline.json` 更新与理由

```bash
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs \
  node scripts/real-doc-metrics.mjs --update-baseline --reason "…"
```

原文 `logs/07-update-baseline.log`：**40 处变化**，全部可归为三类（不是“整体重写”）：

| 类别 | 处数 | 内容 |
|---|---|---|
| 版本串 | 7 | 6 份文档 + `summary.rules` 的 `document-extractor-5 → 6` |
| r4 规则效果 | 29 | 候选 0→7（pending 0→1、blocked 0→6、byKind ring 2 / formula 3 / part-dimension 2）、blockedReasonCodes 新增 3 类、issues 1→5（byCode `PAGE_LIMIT×1 → NO_TEXT_LAYER×3`、新增 `CHUNK_PROCESSED×2`）、`noTextLayerPages` 空→1,2,6、`pageLimit` 非空→null |
| 汇总 | 4 | `candidates.total 131→138`、`confirmableRate 0.435115→0.42029`、`noTextLayerPages 1→4`、`reasonCodeTop5` 中 `UNKNOWN_UNIT 44→45`、`FORMULA_UNSUPPORTED 29→32`、`NUMBER_UNSUPPORTED` 进入前四、`UNSUPPORTED_UNIT` 后移 |

**一处口径变化如实记**：r4 不再有 `PAGE_LIMIT`，度量脚本原有的“对 `PAGE_LIMIT` 文档追加
1-20 页探针”因此不再触发，`summary.pageRangeProbe` 从 1 条变 0 条。探针**不是**抽取规则，
也没有为了保住这一行去改 `scripts/real-docs/metrics.mjs`（该脚本保持原样，包括
`READ_BUDGET` 只放大读取预算的注释）。

更新后不带参数再跑 → `BASELINE MATCH`（`logs/17-metrics.log` 末尾）。

---

## 七、M23 变异：把切块关掉（回退整份拒绝）

patch：`mutations/M23-disable-chunking.patch`（在 `buildExtractionDraft` 里恢复旧的
“页跨度 > 100 → `PAGE_LIMIT` + 0 候选”早退；`git apply --check` 通过）。

| 状态 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 关掉切块 | `npx vitest run src/document-extraction/__tests__/chunking.test.ts` | **6 failed / 1 passed**：C-01、C-02、C-03、C-04、C-05、C-07 全红 | `mutations/M23-red.log` |
| 恢复 | 同上 | **7 passed** | `mutations/M23-green.log` |

仍然**绿**的是 C-06（81 页、≤ 100 页的单块路径，本来就不经过切块）——说明变异打掉的正是
“切块”这件事，而不是把所有用例一起打红。

复现：

```bash
git apply docs/evidence/extract-chunking/mutations/M23-disable-chunking.patch
npx vitest run src/document-extraction/__tests__/chunking.test.ts   # 预期 6 failed / 1 passed
git checkout -- src/document-extraction/parse.ts
npx vitest run src/document-extraction/__tests__/chunking.test.ts   # 预期 7 passed
```

---

## 八、六条命令 + 打包（原始输出）

在 `4d0a634` 的干净工作树上执行（源码与证据都已提交；执行时只有本目录的日志文件在写，
`logs/` 被 `.gitignore` 覆盖，所以 `git status --short` 全程无输出，见 `logs/20-git-status-after-commands.txt`）。

| # | 命令 | 退出码 | 实际输出 | 日志 |
|---|---|---|---|---|
| 1 | `npm run typecheck` | 0 | 无诊断 | `logs/10-typecheck.log` |
| 2 | `npm run typecheck:desktop` | 0 | 无诊断 | `logs/11-typecheck-desktop.log` |
| 3 | `npm run lint` | 0 | `eslint .` 无输出 | `logs/12-lint.log` |
| 4 | `npm test` | 0 | **103 文件 / 1107 用例全过** | `logs/13-test.log` |
| 5 | `npm run test:desktop` | 0 | **39 文件通过 + 1 跳过（40）；278 通过 + 14 跳过（292）** | `logs/14-test-desktop.log` |
| 6 | `npm run build` | 0 | vite 生产构建通过（`✓ built in 216ms`；既有 chunk >500 kB 警告） | `logs/15-build.log` |
| 7 | `npm run test:real-docs` | 0 | 1 文件 / 5 用例全过 | `logs/16-test-real-docs.log` |
| 8 | `npm run metrics:real-docs` | 0 | 逐份表 + `BASELINE MATCH：与 docs/evidence/real-doc-baseline/baseline.json 完全一致（6 份文档）` | `logs/17-metrics.log` |
| 9 | `npm run package:desktop -- --arch=arm64` | 0 | 打包成功，末尾 `RESULT PASS 打包产物中的 pdf worker 可被 main.cjs 运行时加载`；asar 内 `pdf.worker.mjs` sha256 `b4c8353d…` 与 `node_modules/pdfjs-dist` 一致 | `logs/18-package-desktop.log` |
| 10 | `npm run check:package:pdf-worker` | 0 | `RESULT PASS`（同上 sha256 断言） | `logs/19-check-package-pdf-worker.log` |

（第 7、8 条是本节“度量”口径的命令，一并附上真实输出；第 9、10 条是打包与打包校验。）

跑完后的工作树：`git status --short` **无输出**（原文与说明见
`logs/20-git-status-after-commands.txt`）。

> 本次提交只新增这些日志与本节文本，**没有改动任何源码/测试**；因此上面十条命令的结果
> 就是当前分支 HEAD 的结果（`git log --oneline 5b2f06c..HEAD` 可见提交顺序）。

---

## 九、未做 / 已知问题（如实列出）

1. **产品链路的读取预算没有动**：main 侧 `extractPdfTextPages` 仍是默认 20,000 文本项预算，
   r4 全篇 94,214 项，真实产品路径（不是度量脚本）仍会先在**读取预算**处 `EXTRACTION_BUDGET`
   失败。本任务按“同一 revision 只解析一次、切的是页数组”的约束没有改读取预算（改预算属于
   放阈值的另一件事），因此**r4 在打包应用里目前仍取不到候选**；度量用的是脚本放大的读取预算
   （`READ_BUDGET`，其注释写明只看规则、不改规则）。这是本任务最需要跟进的遗留项。
2. **120 页以上 3 块的组合只在合成用例里测过**（C-02，250 页）；真实语料最长 170 页，
   r4 只走“两块”。4 块及以上没有真实样本。
3. **块失败只在“块扫描抛错”这一层隔离**：若某页数据损坏到让 `collectUnitContext`
   （块之前的整份收集）抛错，仍会整份失败——那是单位上下文必须整份可见的代价，未在本任务改动。
4. **`EXTRACTION_EMPTY` 的既有缺陷未修**（0 候选时该 warning 在 `linkedIssues` 之后才 push，
   不会出现在 issues 里）。属 P0 之前就存在的问题，不在本任务范围。
5. **`PAGE_LIMIT` 原因码保留未删**：为了让旧草稿/旧项目文件仍能过 `validation.ts` 的枚举校验。
   新提取不会再产生它，但代码里存在“历史码”这一点需要读代码的人知道。
6. **`desktop/tests/e2e/v36drafts.mjs` 未运行**：需要打包应用 + 重新生成的
   `DRAFTS-V36.cunlian` 夹具（CDP 走查）。本次只把硬编码版本串同步到 v6（否则升版必红），
   这条走查**没有实测**，如实标注为未测。
7. **候选的 `chunk` 归属没写进候选对象**：候选是“跨块汇总后”的产物（同符号同值会跨块合并），
   强行标注单块索引会失真；块踪迹因此只挂在 issue 上，候选的块归属可由 `page` 与块页范围直接
   推出。schema 只加了 `issue.chunk`。
