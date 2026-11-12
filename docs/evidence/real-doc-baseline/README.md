# 真实文档抽取基线（可重复的百分数）

一句话：在 `main 15cdac5`（提取器 `document-extractor-2`）上，6 份真实机械/装配 PDF 共 269 页，
**候选 123 条、可人工确认（pending）26 条、可确认率 21.1%、阻塞率 78.9%、confirmed 0 条**。
这条命令就是尺子，以后每次改抽取都必须与 `baseline.json` 对比。

```bash
node scripts/real-doc-metrics.mjs        # 一条命令出全部数字，并写 metrics.json、与 baseline.json 对比
npm run test:real-docs                   # 回归测试：重跑度量 + 与基线逐项比对
```

本任务只**度量**：不改抽取规则、不改判定阈值、不清洗/重排原文。度量脚本调用的就是产品同一条链路
（`pdfjs legacy getTextContent → buildPdfTextLayer → buildExtractionDraft`），没有第二份解析实现。

---

## 一、语料：6 份 PDF 不进仓库

6 份都是论文、教材与行业标准，仓库是公开 MIT 项目，提交 PDF 等于公开再分发（版权风险）。
因此仓库只提交 `corpus-manifest.json`（文件名 / 字节数 / SHA-256 / 页数 / 来源 URL），
不提交任何 PDF 字节。脚本从 `REAL_DOC_CORPUS` 读语料，默认 `~/DSH/tmp/cunlian-v36/real-docs/`。

| id | 文件 | 语言 | 页数 | 字节数 | SHA-256 | 来源 |
|---|---|---|---:|---:|---|---|
| r1 | r1-assembly-course.pdf | zh | 74 | 540,357 | `fc6ad0216abf60e381d222cbdb84378acecdc799bd753a92baa318a8af1b607d` | 装配工艺基础（高校课件）`https://fztr.file.gkfz.net/pdf/ee9bd4be47855a95997fe4edfc471f05.pdf` |
| r2 | r2-tolerance-domain.pdf | zh | 5 | 1,663,725 | `c20d6b523e20a0554b0f5c0c38bbb3c7b32a604505a0dd1b8eb8872483aea9e2` | 公差值域的扩展及其应用（北京理工大学学报 2013）`http://journal.bit.edu.cn/zr/cn/article/pdf/preview/20131207.pdf`（需浏览器 UA） |
| r3 | r3-rv-3dcs.pdf | zh | 4 | 2,087,731 | `458a68fdae943174b5edcf35df146ed90e6cb314be14d43d0cdff2b4a701e2d1` | 基于 3DCS 的 RV 减速器静态装配公差分析及优化（机械传动 2019）`https://qikan.cmes.org/jxcd/EN/PDF/10.16578/j.issn.1004.2539.2019.06.027`（需 UA + Referer） |
| r4 | r4-mtt1097.pdf | zh | 170 | 2,335,500 | `e1865268858081545f8ebe9860bae03c5b9fd3fa0d31f4a21367fdeeecf3264d` | MT/T 1097-2008 煤矿机电设备检修技术规范（国家矿山安全监察局公开 PDF）`https://www.chinamine-safety.gov.cn/zfxxgk/fdzdgknr/zcfg/hybz_01/mkanj/201911/P020210202593864022810.pdf` |
| r5 | r5-tolerance-analysis.pdf | en | 8 | 1,574,718 | `e4f5c52b525948faa7c547458d07e66418241392d698ed892cd44cac1cc310c5` | Tolerance Analysis of Mechanical Parts（Tehnički glasnik 2020，DOI 10.31803/tg-20200504092314；Semantic Scholar 镜像）`https://pdfs.semanticscholar.org/d285/b9b08f8201831e9aef53e4b6169f8cbd6987.pdf` |
| r6 | r6-segments-assembly.pdf | en | 8 | 2,347,628 | `fbe5db55db9b6bdf220e1ebef42c3f414580c8e1f360b7c739ab70e7c78d28be` | Segments Assembly Process Analysis and QC（ICMCM 2016，Atlantis Press OA）`https://www.atlantis-press.com/article/25866130.pdf` |

**本机复跑怎么拿到这 6 份**：按上表 URL 下载（r2/r3 需带浏览器 UA，r3 另需
`Referer: https://qikan.cmes.org/jxcd/CN/10.16578/j.issn.1004.2539.2019.06.027`），
放同一个目录后：

```bash
REAL_DOC_CORPUS=/path/to/real-docs node scripts/real-doc-metrics.mjs
```

脚本逐份核对**字节数与 SHA-256**（同一时间还核对 pages）：

- 任何一份缺失 → `CORPUS_MISSING`，退出码 1；
- 任何一份字节数或 SHA-256 不符 → `CORPUS_MISMATCH`，退出码 1，并打印期望/实际；
- **不静默跳过、不用别的文件顶替**，也不会自动去网络下载。

镜像/期刊站可能失效（r5 原刊直链 418、r2 裸 curl 拿 HTML、r3 裸 curl 403），
拿不到时本机度量就无法复跑——这是有意的硬失败，不降级。

**CI 上默认不跑该度量**：默认 `npm test` 只含 `src/**`；本度量在专用套件 `npm run test:real-docs`，
没有语料时该套件会以 `CORPUS_MISSING` 失败（不是 skip）。

---

## 二、判据口径（必须先读再用数字）

| 术语 | 含义 |
|---|---|
| 候选（candidate） | 提取器从文本层识别出的一条数值/公式候选；每条都带页、选区、原文片段等出处 |
| `pending` | **可人工确认**：出处完整、没有触发阻塞原因码，等人逐条确认。**不等于已确认通过** |
| `blocked` | **抽取器拒绝猜测**：单位未知、公式不可表达、偏差符号缺失、区间端点语义缺失等。**不是错误/bug**，是设计边界 |
| `confirmed` | 人工确认后才有；全新草稿里必须为 0（本基线为 0，没有任何人工决定） |
| 可确认率 | `pending / 候选总数`（本基线 26/123 = 21.1%） |
| 阻塞率 | `blocked / 候选总数`（本基线 97/123 = 78.9%） |
| `PAGE_LIMIT` | 页跨度超过 `MAX_EXTRACTION_PAGES`（100 页）→ 整份不提取，只留一条 issue；r4 即此情形 |
| `NO_TEXT_LAYER` | 该页没有可读文本层（扫描/图片页），不做 OCR、不猜；r1 第 40 页即此情形 |
| 原因码 Top5 | 对 `blocked` 候选的 `reasonCodes` 逐条计数后取前 5（一条候选可带多个码） |

两条容易读歪的地方：

1. `pending` 只是「值得人工看一眼」，**不是通过率**。对外说「可用率」时不能把 pending 说成已确认。
2. `blocked` 不是失败率。它度量的是「抽取器主动弃权」的规模，弃权本身是安全行为。

### 读取预算（唯一一处与产品默认不同，已显式记录）

产品默认读文本层有 `maxTextItems=20000 / timeoutMs=20000`，超了整份拒绝读取。
r4 全篇有 94,214 个文本项，用默认预算会先在「读取预算」处失败，看不到它真正的
`PAGE_LIMIT` 判定。度量脚本因此只把**读取预算**放大到 `maxTextItems=200000 / timeoutMs=300000`，
页数上限（100）、候选上限（200）、问题上限（200）与全部抽取规则**一律不动**。
实际用量写在 `metrics.json` 的 `rules.readBudget` 与每份文档的 `textItems` 里，可复核。

---

## 三、汇总（`node scripts/real-doc-metrics.mjs` 的真实输出）

```
汇总：6 份 / 269 页 / 候选 123（pending 26｜blocked 97｜confirmed 0）
可确认率 = pending/候选 = 26/123 = 21.1%；阻塞率 = 78.9%
PAGE_LIMIT 文档：r4；NO_TEXT_LAYER 页数：1
原因码 Top5：UNKNOWN_UNIT×51, FORMULA_UNSUPPORTED×45, UNSUPPORTED_UNIT×1
```

| 指标 | 数值 |
|---|---:|
| 文档 / 页数 | 6 / 269 |
| 候选总数 | 123 |
| 可确认（pending） | 26 |
| 已确认（confirmed） | 0 |
| 阻塞（blocked） | 97 |
| **可确认率** | **21.1%**（26/123） |
| **阻塞率** | **78.9%** |
| `PAGE_LIMIT` 文档 | 1（r4，170 页 > 100） |
| `NO_TEXT_LAYER` 页 | 1（r1 第 40 页） |

原因码 Top5（对 97 条 blocked 候选计数；合计 97 = 每条候选恰好一个码）：

| 排名 | 原因码 | 条数 | 占 blocked |
|---:|---|---:|---:|
| 1 | `UNKNOWN_UNIT` | 51 | 52.6% |
| 2 | `FORMULA_UNSUPPORTED` | 45 | 46.4% |
| 3 | `UNSUPPORTED_UNIT` | 1 | 1.0% |

### 每份文档

| 文档 | 语言 | 页数 | 文本项 | 候选 | pending | blocked | 可确认率 | 阻塞率 | PageLimit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| r1 装配工艺课件 | zh | 74 | 4,409 | 15 | 4 | 11 | 26.7% | 73.3% | — |
| r2 北理工学报 | zh | 5 | 6,105 | 20 | 5 | 15 | 25.0% | 75.0% | — |
| r3 RV 减速器 | zh | 4 | 1,570 | 3 | 0 | 3 | 0.0% | 100.0% | — |
| r4 MT/T 1097 | zh | 170 | 94,214 | 0 | 0 | 0 | n/a | n/a | `PAGE_LIMIT` |
| r5 英文公差分析 | en | 8 | 4,053 | 5 | 2 | 3 | 40.0% | 60.0% | — |
| r6 英文装配工艺 | en | 8 | 2,871 | 80 | 15 | 65 | 18.8% | 81.3% | — |

逐份阻塞原因码（候选级）：

- r1：`FORMULA_UNSUPPORTED`×7，`UNKNOWN_UNIT`×4；issue 另有 `UNKNOWN_UNIT`×53、`AMBIGUOUS_ASSIGNMENT`×2、`NO_TEXT_LAYER`×1（第 40 页）
- r2：`FORMULA_UNSUPPORTED`×9，`UNKNOWN_UNIT`×6
- r3：`FORMULA_UNSUPPORTED`×2，`UNKNOWN_UNIT`×1
- r4：整份 `PAGE_LIMIT`（无候选）
- r5：`UNKNOWN_UNIT`×3
- r6：`UNKNOWN_UNIT`×37，`FORMULA_UNSUPPORTED`×27，`UNSUPPORTED_UNIT`×1

### 页范围探针（超预算文档只取前 20 页）

r4 单独跑 `1..20` 页（`metrics.json` 的 `summary.pageRangeProbe`）：

```
页范围探针 r4@1-20：候选 1（pending 0｜blocked 1）；阻塞原因码 UNKNOWN_UNIT×1；
问题码 NO_TEXT_LAYER×3；无文本层页 1,2,6
```

解读：缩小页范围确实绕过了 `PAGE_LIMIT`——能出候选，但这一份依然只有 1 条（且阻塞），
3 页文本层为空（封面与 2、6 页）。**「选页范围就能读 170 页标准」这个说法在本度量里不成立**：
r4 的可用性瓶颈不是页数上限，而是版面/单位/表格本身超出了当前抽取能力。

---

## 四、与旧手测数字对账（123 / 26 / 21% 与 184 / 7 / 3.8%）

有两条旧数字，必须分开说：

### 1. 对外口径 `123 候选 / 26 可确认 / 21%` —— 逐项一致，无差异

本次度量在 `main 15cdac5`（`document-extractor-2`）上得到 **123 / 26 / 21.1%**，与对外说法完全一致：
候选总数一致、pending 一致、可确认率一致（21.1% 四舍五入为 21%）。
因此这个百分数不是估算，可以被一条命令复现，已经固化成 `baseline.json`。

### 2. 更早的临时报告 `184 候选 / 7 可确认 / 3.8%` —— 旧提取器（v1）的数字，且报告自身有 1 条口径不一致

`docs/evidence/real-doc-baseline/history/v1-c52ac9f-metrics.json` 是用**同一套度量代码**
跑 `c52ac9f`（`document-extractor-1`，旧报告称的基线）得到的：

| 版本 | 提取器 | 候选 | pending | blocked | 可确认率 | 阻塞率 | 原因码 Top1 |
|---|---|---:|---:|---:|---:|---:|---|
| c52ac9f（旧） | `document-extractor-1` | 184 | **6** | 178 | **3.3%** | 96.7% | `AMBIGUOUS_ASSIGNMENT`×117 |
| 15cdac5（现） | `document-extractor-2` | 123 | **26** | 97 | **21.1%** | 78.9% | `UNKNOWN_UNIT`×51 |

差异原因（可核对的代码改动，不是猜测）：`8d68f2b fix(V3.6): 同符号多处赋值改为逐处候选，组内互斥可撤销`
把「同一符号多处不同赋值 → 整组 `AMBIGUOUS_ASSIGNMENT` 阻塞」改成「逐处候选，人工挑一处」，
`EXTRACTOR_VERSION` 由 1 升到 2。后果：

- 候选 184 → 123：同值多处合并、坏处只留 issue，不再为每处重复生成阻塞候选；
- 可确认 6 → 26：原先被整组阻塞的逐处取值，现在成了可选（组内互斥）的 pending；
- 阻塞率 96.7% → 78.9%，原因码主因从 `AMBIGUOUS_ASSIGNMENT`（117）变成 `UNKNOWN_UNIT`（51）。

旧报告的 1 条不一致：报告正文写「合计 7 条 / 184 条（3.8%）」，但它自己的表格
（53+25+3+0+5+98 = 184，pending 0+2+0+0+2+2 = **6**）加起来是 6 条。本次 v1 复算同样是 184/6。
结论：**184 这个候选总数可复现，7 这个 pending 数不可复现**，差值 1 条且无从追踪
（旧报告的探针脚本是临时文件、跑完已删，见其「复现方式」一节只留了注释）。
不把 7 当作可复现数字使用；对外只使用能在本仓库一条命令复现的 123/26/21.1%。

两张表的逐份数字也对得上（v1：r1 53/0、r2 25/2、r3 3/0、r4 0、r5 5/2、r6 98/2），
说明差异来自提取器版本，不是语料或页范围不同。

---

## 五、回归：数字变了必须显式更新基线

- 基线文件：`docs/evidence/real-doc-baseline/baseline.json`（含 `baselineReason`，说明这批数字为什么成立）
- 同目录 `metrics.json` 是本次运行的完整度量（走 `serializeEvidence`，无本地绝对路径、无随机 UUID）
- 测试：`npm run test:real-docs`（`vitest.realdocs.config.ts`，只跑 `scripts/real-docs/**/*.test.ts`）

测试覆盖 5 件事：

1. manifest 的 6 份文件字节数 + SHA-256 全部吻合；
2. 语料缺失报 `CORPUS_MISSING`（不 skip）；
3. 语料被替换（字节数不变、内容改变）报 `CORPUS_MISMATCH`；
4. 重跑度量和 `baseline.json` 逐项比对，**任何数字变化都会红**，并打印 `路径: 基线=… 实测=…`；
5. 提交的 `metrics.json` 必须与当前度量一致（防止手改证据）。

数字确实该变时（改了抽取规则/阈值/依赖/语料），必须显式更新并写明原因：

```bash
node scripts/real-doc-metrics.mjs --update-baseline --reason "为什么变化：改了哪条规则、预期影响"
```

`--reason` 为空会直接报错。原因写进 `baseline.json` 的 `baselineReason`，同时脚本会打印
相对旧基线的逐项变化（`变化 <路径>: 旧 → 新`），便于评审核对是不是有意为之。
**不允许**为了让测试变绿而删断言、跳过测试或直接改 `metrics.json` 里的数字。

度量里刻意不记录的东西：读取耗时（不稳定，会污染对比）、时间戳、本机绝对路径。

---

## 六、未做 / 已知问题（如实列出）

1. **语料不可随仓库分发**：没有 6 份 PDF 的机器无法复跑，只能看到已提交的 `metrics.json`/`baseline.json`。
   这是版权约束下的取舍，不是遗漏。
2. **只有一个页范围探针**（r4 取 1-20 页）。没有做「换起始页 / 换窗口 20 页」的扫描，
   也没有验证「选页后 r4 是否真的更好用」——本任务只度量，不做优化结论。
3. **读取预算与产品默认不同**（20k/20s → 200k/300s），原因见第二节；度量结果**不能**直接当作
   「UI 里点一次提取会得到多少候选」——UI 还会受默认读取预算与候选/问题上限约束。
4. **每份文档的语言只按 manifest 标注**（zh/en），没有做语种识别；不参与任何判定。
5. **`pending` 没有经过人工逐条确认**：`confirmed` 恒为 0。要得到「确认通过率」需要人工把候选逐条确认，
   本任务不做，也不允许把 pending 当通过。
6. **重复可复现性依赖 pdfjs 版本**：`pdfjs-dist 6.5.438`（`package.json` 锁死）。升级后文本项切分可能变化，
   数字变化需按第五节显式更新基线并说明。
7. `metrics.json` 里 `UNKNOWN_UNIT` 的 issue 条数（如 r1 的 53 条）大于候选数：那是逐处缺口记录，
   不是候选；两类计数不混用。
