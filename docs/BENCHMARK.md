# 真实文档度量基准

这份文件回答一个问题：**「你的提取器到底行不行？」** 用可复现的数字回答，不用形容词。

## 一、语料是什么（先说清局限）

6 份**公开可得**的技术文档，共 269 页，113,222 个文本层文本项：

| ID | 文档 | 语言 | 页数 | 特点 |
|---|---|---|---|---|
| r1 | 高校装配工艺讲义（PPT 转 PDF） | 中 | 74 | 公式被转成私用区字符（`\uf02b`） |
| r2 | 公差值域论文 | 中 | 5 | 中文行文、公式密集 |
| r3 | RV 减速器论文 | 中 | 4 | 摆线轮/针齿间隙 |
| r4 | 机械设计标准（MTT 1097） | 中 | **170** | 超长文档，多页无文本层 |
| r5 | 公差分析英文论文 | 英 | 8 | 英文表格 |
| r6 | 节段装配英文论文 | 英 | 8 | 大量符号赋值 |

**局限必须写在前面：这不是机械装配技术任务书。** 公开渠道找不到规范的、可下载的真实任务书样本（找过，没找到——这是"未确认"，不是"不存在"）。

所以下面的百分比衡量的是**「对排版不规整的中文/英文技术文档能抽出多少」**，**不等于「能不能读任务书」**。

## 二、当前基线

```
文档 6 份 / 269 页 / 113,222 文本项
候选 140（待确认 58｜阻塞 82｜已确认 0）
待确认比例 41.4%　阻塞率 58.6%
抽取规则版本 document-extractor-8
correctness: { pendingChecked: 19, wrongPending: 0, wrongRate: 0 }
```

逐份：

| 文档 | 候选 | 可确认 | 阻塞 |
|---|---:|---:|---:|
| r1 | 15 | 4 | 11 |
| r2 | 24 | 10 | 14 |
| r3 | 3 | 0 | 3 |
| r4 | 7 | 1 | 6 |
| r5 | 4 | 2 | 2 |
| r6 | 87 | 41 | 46 |

正确性口径：`docs/evidence/ground-truth/gt-01.json` 的 19 条均逐字核读渲染裁片，
以文档/页/出处几何匹配 pending，并逐 q 比较 nominal。改前 19 条中 2 条错误；
改后 `wrongPending=0`。这不代表其余 pending 已逐条核验，也不衡量符号名与公差的全语料正确率。
以后抽取验收必须同时报告 correctness，不能只把 pending 数量称为“可确认率”。
详见 `docs/evidence/supersub-fix/README.md` 与 `COMPARISON.md`。

## 三、提升过程（每一步都有变异验证）

| 步骤 | 改了什么 | 候选 | 可确认 | 可确认率 |
|---|---|---:|---:|---:|
| 基线（`document-extractor-1`） | — | 184 | 7 | **3.8%** |
| 修 `AMBIGUOUS_ASSIGNMENT` | 同符号多处赋值 → 每处各一条候选、同组互斥 | 123 | 26 | 21.1% |
| P0 单位继承 | 表头/上下文声明单位时允许继承 | 123 | 26 | 21.1%（**0 收益**，规则正确） |
| P1 表达式末尾单位 | `A0max = 1753.1−759.38−765.31 = 228.41 mm` | 126 | 38 | 30.2% |
| P2 公式行显式末尾值 | 原文已写出结果值的，取那枚**显式**值（**不做算术求值**） | 131 | 57 | 43.5% |
| L1-a 大文档切块 | 超 100 页分块、坏页不连坐 | 138 | 58 | 42.0% |
| 上下标与公差粘连修复 | `L₁=100⁺⁰·²₋₀.₁` 不再抽成 `1001`；非对称公差如实建模 | 140 | 58 | 41.4% |

**P0 是 0 收益，我照实写。** 比例在 L1-a 掉下来是因为分母多了 7 条（r4 从 0 变 7），绝对值涨了 1。

## 三·五、正确性（比数量更重要）

**长期只看"抽了多少条"，从没测过"抽对了多少条"。2026-11-13 起改口径。**

真值集 `docs/evidence/ground-truth/gt-01.json`：19 条（r2 全部 7 + r5 全部 2 + r6 抽 10），
**真值从原件渲染裁片逐字读出**，不从抽取结果反推。

| | 修前 | 修后 |
|---|---:|---:|
| 核对条数 | 19 | 19 |
| **错值（wrongPending）** | **2**（`1001`、`430`） | **0** |
| 错误率 | 10.5% | **0** |

错值样例：原文 `L₁ = 100⁺⁰·²₋₀.₁ mm` 被抽成 **1001**（下标 1 粘进基本尺寸）；
`L₃ = 43⁺⁰·²₀ mm` 被抽成 **430**（上偏差的 0 被当数字）。

**限定条件（不许省）**：0 错值只覆盖这 19 条 nominal，**其余 39 条 pending 与其它字段尚未逐条核验**。

## 四、还阻塞在哪（82 条；原因码可重叠）

| 原因码 | 条数 | 能不能靠算法救 |
|---|---:|---|
| `UNKNOWN_UNIT` | 44 | 原文该行没有显式单位时不可猜测 |
| `FORMULA_UNSUPPORTED` | 32 | 已确认不可解析（纯符号函数式、缺单位、文本层把数值拆碎） |
| `NUMBER_UNSUPPORTED` | 2 | 数值格式不支持 |
| `UNSUPPORTED_UNIT` | 1 | 单位本身不支持 |
| `SUBSCRIPT_AMBIGUOUS` | 2 | 上下标几何或文字不能可靠判定，不能静默拼值 |
| `AMBIGUOUS_DEVIATION` | 2 | 同符号同值的不同出处有互相冲突的偏差，保守阻塞 |

阻塞数不能证明算法空间耗尽，更不能证明 pending 正确；本次上下标错值说明必须先核正确性。

## 五、怎么自己复现

```bash
# 1) 把 6 份 PDF 放到一个目录（文件清单与 SHA-256 见
#    docs/evidence/real-doc-baseline/corpus-manifest.json）
# 2) 一条命令出全部度量
REAL_DOC_CORPUS=<目录> npm run metrics:real-docs
# 3) 结果写到 docs/evidence/real-doc-baseline/metrics.json
```

## 六、为什么这套度量本身有价值

大多数"AI 读文档"的说法只给一个百分比，不给：

- **逐份**结果（哪一份文件崩在哪）
- **原因码分布**（阻塞是单位缺失还是公式不支持）
- **改前改后对照**（每加一条规则，涨了哪些、掉了哪些）
- **变异实验**（把规则改坏，用例必须红——证明测试真的在测东西）

这套东西在 `docs/evidence/` 里逐批留存，可以逐条回放。

## Cunlian-Bench v1 全链路实测成绩单

产品版本 `1.0.1`，实测源码 SHA `23087d69207d34c86e4014f78e77a9a38eb52f6e`。运行时已接入本节所列 npm 脚本。条目数按 runner 实际输出计，顺序为 PASS / FAIL / SKIP。

环境为 Apple M4，10 逻辑核心，16 GiB，darwin 25.4.0 arm64，Node v26.12.1。固定随机种子 20261126，统计用例 50,000 样本。

| 套件 | 冷缓存离线 | 外部模式 | 外部模式实测 |
|---|---:|---:|---|
| A STEP/XCAF | 1 / 1 / 10 | 8 / 4 / 0 | NIST 导入 9/10，装配树 0/4，投影 9/10。导入 p50/p95 740.74/1600.56 ms，HLR 446.71/2537.06 ms |
| B 配合与求解 | 0 / 5 / 1 | 0 / 5 / 1 | 精确率 45.45%，召回率 80.65%，F1 58.14%，求解收敛率 100%，欠约束分类准确率 100%，平均 2.67 ms |
| C GD&T | 6 / 0 / 0 | 6 / 0 / 0 | 3D 全算 688.07 ms，MMC/RFS 增量 3.29/2.64 ms |
| D 柔性/MIC | 4 / 0 / 1 | 4 / 0 / 1 | MIC 最大相对误差 0，16×6 批处理 7.94 ms，全耦合 913.61 ms |
| E 端到端 | 1 / 1 / 2 | 1 / 1 / 2 | 已启用能力的同源数值零偏差，E3 全部拦截，E4 的 12 条报告结论按种子精确复现 |

冷缓存离线 `npm run bench:v1` 为 12 / 7 / 14，退出码 `1`。外部模式 `npm run bench:v1:external` 为 19 / 10 / 4，退出码 `1`。完整外部模式逐项指标见 [机器可读成绩单](benchmarks/cunlian-bench-v1-report.json)。

### 逐项状态

| 用例 | 冷缓存离线 | 外部模式 |
|---|---|---|
| A1-STC-06 | SKIP · EXTERNAL_ASSET | PASS |
| A1-STC-07 | SKIP · EXTERNAL_ASSET | PASS |
| A2-CTC-01 | SKIP · EXTERNAL_ASSET | PASS |
| A2-CTC-02 | SKIP · EXTERNAL_ASSET | PASS |
| A3-FTC-07 | SKIP · EXTERNAL_ASSET | FAIL |
| A3-FTC-08 | SKIP · EXTERNAL_ASSET | FAIL |
| A3-FTC-09 | SKIP · EXTERNAL_ASSET | FAIL |
| A3-FTC-10 | SKIP · EXTERNAL_ASSET | FAIL |
| A4-CTC-04 | SKIP · EXTERNAL_ASSET | PASS |
| A4-CTC-05 | SKIP · EXTERNAL_ASSET | PASS |
| A3-LOCAL-XCAF | PASS | PASS |
| A5 | FAIL | PASS |
| B-plate-spacer-cover-pins | FAIL | FAIL |
| B-l-bracket-flange | FAIL | FAIL |
| B-stepped-shaft-seat-cover | FAIL | FAIL |
| B-shell-four-corner-clamps | FAIL | FAIL |
| B-eccentric-coupling | FAIL | FAIL |
| B-FUSION360 | SKIP · EXTERNAL_ASSET | SKIP · EXTERNAL_ASSET |
| C1 | PASS | PASS |
| C2 | PASS | PASS |
| C3 | PASS | PASS |
| C4 | PASS | PASS |
| C5 | PASS | PASS |
| C6 | PASS | PASS |
| D1 | PASS | PASS |
| D2 | PASS | PASS |
| D3 | PASS | PASS |
| D4 | SKIP · NO_CCX | SKIP · NO_CCX |
| D5 | PASS | PASS |
| E1 | SKIP · EXTERNAL_ASSET | SKIP · EXTERNAL_ASSET |
| E2 | SKIP · EXTERNAL_ASSET | SKIP · EXTERNAL_ASSET |
| E3 | PASS | PASS |
| E4 | FAIL | FAIL |

### 实测缺陷与覆盖限制

- **CB-A5（中，内存门禁）** 冷缓存离线为 FAIL。最近五轮释放后 RSS 为 253.79, 255.61, 257.56, 258.11, 258.67 MiB，门禁要求这一序列不能持续上升。峰值 307.82 MiB，末轮 258.67 MiB，进程 RSS 会受分配器与 GC 影响，单次结果不足以定位泄漏。复现用 `npm run bench:v1 -- --suite A --out /tmp/a.json`，冷缓存需使用新工作树。
- **CB-A5（中，内存门禁）** 外部模式为 PASS。最近五轮释放后 RSS 为 405.36, 402.70, 401.95, 402.23, 392.03 MiB，门禁要求这一序列不能持续上升。峰值 526.09 MiB，末轮 392.03 MiB。外部模式用四个经校验的 CTC 文件，冷缓存模式用两个本地替代件。复现用 `npm run bench:v1:external -- --suite A --out /tmp/a.json`。
- **CB-A3（中，夹具覆盖缺口）** FTC-07、08、09、10 的源文件各含 0 个装配 occurrence，门禁要求至少 2 个。FTC-07、08、10 各导入 1 个实体，门禁要求至少 2 个。NIST 将这四个文件列为可装配在一起的零件，单文件结果不能判定产品导入真实多零件 XCAF 装配失败。本地双件 XCAF 夹具通过。复现用 `npm run bench:v1:external -- --suite A --out /tmp/a.json`。
- **CB-A3-FTC09-IMPORT（中，STEP 兼容性）** 校验通过的 FTC-09 文件在 OCCT 导入阶段返回 `STEP root transfer failed`，未得到实体或投影，目标至少导入 1 个实体，并成功输出三视图。复现同 CB-A3。
- **CB-B（中，推荐精度）** 五个本地样本均有配合差异，按顺序 TP/FP/FN 为 6/2/0、3/1/0、4/9/0、9/16/4、3/2/2。匹配使用轴向叉积 ≤0.001、距离 ≤0.05 mm，目标是零漏配、零误配。薄壁壳体与偏心联轴器的预测剩余自由度相对真值分别偏差 −3、+2。复现用 `npm run bench:v1 -- --suite B --out /tmp/b.json`。
- **CB-E4（中，报告可追溯性）** 必需字段应覆盖全部 3 种格式，实测 EvidenceRef 仅 2/3（HTML、JSON）包含，CSV 缺附录。复现用 `npm run bench:v1 -- --suite E --out /tmp/e.json`。
- 冷缓存离线跳过 10 个 NIST 文件；外部模式下载并经 SHA-256 校验后逐个测试。Fusion 360 缺符合许可且带真值和固定校验和的研究子集，两次均跳过。
- D4 四角夹紧与单调性已执行，缺 CalculiX 和可溯源参考位移场。E1 缺 6 份真 PDF，未把历史 269 页统计视为本次结果。
- E2 使用本机生产云端服务与桌面核心对照。两态尺寸结果一致，开启时 GD&T、柔性和报告结论也一致，关闭时这三个接口按预期返回 `FEATURE_DISABLED`，因此完整双态数值对照标为 SKIP。

### 数据来源与复现

- NIST MBE PMI 的测试件、CAD 和 STEP 可不受限制地使用，NIST 请求注明出处，禁止在推广材料中使用其标志。归属为 NIST MBE PMI Validation and Conformance Testing Project。[NIST 官方下载页和声明](https://www.nist.gov/ctl/smart-connected-systems-division/smart-connected-manufacturing-systems-group/mbe-pmi-0)
- Autodesk Fusion 360 Gallery 数据仅限非商业研究，禁止整库再分发，子集或衍生物须遵守许可中的再分发条件。本次未取得该子集。[Autodesk 固定版本许可](https://github.com/AutodeskAILab/Fusion360GalleryDataset/blob/1084b881f3bb710267801d812d6e9286b8667059/LICENSE.md)
- D4 自编几何为合成夹具，未复制或分发 Liu & Hu (1997) 位移场。E1 各 PDF 来源见仓库语料清单，公开下载不等于统一再分发许可。[既有 PDF 来源清单](evidence/real-doc-baseline/corpus-manifest.json)

在干净的 BENCH-03 工作树中使用上述 Node 版本。冷缓存结果要求在首次外部下载之前运行离线模式，两次均可用 `--out` 保留各自报告。E1 可用 `REAL_DOC_CORPUS` 指向按语料清单校验的目录。

```sh
npm ci --no-audit --no-fund
npm run bench:v1 -- --out /tmp/cunlian-bench-v1-offline.json
npm run bench:v1:external -- --out /tmp/cunlian-bench-v1-external.json
npm run package:desktop -- --arch=arm64
npm run check:release:step
npm run lint
npm run typecheck
```

### 发布隔离与回归

在 NIST 缓存已有 10 个文件时重新构建 macOS arm64 Electron 包，`npm run package:desktop -- --arch=arm64` 退出 0，内置 PDF worker 和 STEP 资源断言通过。实际检查了 `寸链.app` 文件树（621 条，包括解包资源）与 `app.asar`（37 条），其中未找到基准目录、缓存、基准报告或已下载 NIST 样本路径。Forge 原有 Vite 路径白名单已能排除这些内容。

Docker 根上下文新增 `.dockerignore`，排除基准目录、外部缓存和生成报告。用这些排除规则创建并列出本地检查归档，3,179 条记录中无三个排除目标，且保留 Dockerfile 与 package.json。生产 Dockerfile 各阶段也仅复制指定源路径。本机无 Docker 客户端或守护进程，此项证据覆盖本地归档与 Dockerfile 审计，Docker 实际发送的上下文和镜像文件树未执行验证。

`npm run check:release:step`、`npm run lint`、`npm run typecheck` 均退出 0。原始 SHA 的独立基线也通过 lint 和 typecheck。额外执行的 `npm test` 为 1750 通过、1 失败，失败为 `evidenceRepro.test.ts` 的 `Git original changed: desktop/tests/senderGuard.test.ts`，同一用例在原始 SHA 的独立检出中复现。
