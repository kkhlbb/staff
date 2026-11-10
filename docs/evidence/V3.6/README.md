# V3.6 阶段 1：任务书 PDF 领域提取器 + 候选模型 + 人工确认契约

状态：**领域层实现、自动化测试、坏样例判定、两条回退实验（红 → 恢复绿）均已完成。
未做 IPC/UI/持久化（第 2 阶段），未合并、未推送、未删除任何分支/工作树。**

- 仓库：`/Users/aston/DSH/staff`，分支 `main`（按用户指令：不自开分支、不建工作树）
- 基线：`5aa8057`（v3.5.0-beta.1）
- 实现提交：`a87fc59`（feat）、`2859cd0`（refactor：去掉噪音 issue、精确公式单位原因）、
  `a96c1ff`（test：断言单一 NFKC 不覆盖 CJK 部首补充区）
- 证据文档提交：见交付消息（本文件、日志、变异补丁、抽取 JSON）
- 固定样例：`src/document-extraction/__fixtures__/taskbook-TB-2026-1110.pdf`（完整版 2 页）
  - SHA-256：`6b6b02ebbe796168447ec18b698fa12db6a93eb7f5dd1ec5b9a9473879b6f0ff`
  - 与 `/Users/aston/DSH/tmp/cunlian-v36/taskbook/` 中文件字节一致；未修改、未替换
- 1109（缺 S 长度、缺偏差数字）**没有**被当作完整期望，保留给 V3.5 回归。

## 1. 本阶段做了什么

新目录 `src/document-extraction/`（纯数据/纯函数，不依赖 Electron/React/IndexedDB）：

| 文件 | 职责 |
|---|---|
| `types.ts` | 契约：候选/出处/决定/草稿/错误码；`isEvidenceComplete` 是出处唯一闸门（M02 目标） |
| `textLayer.ts` | pdfjs TextContent → 行/片段/选区；NFKC + CJK 部首补充区映射 |
| `cjkRadicals.ts` | UCD `CJKRadicals.txt` 的 U+2E80–U+2EFF 全量映射（生成数据，非按文件硬编码） |
| `parse.ts` | 确定性规则：组成环表、部件尺寸行、区间句、线性公式、行内赋值；冲突检查 |
| `draft.ts` | 确认/拒绝/编辑/应用计划/幂等合并；`planApplication` 只产出计划（`applied:false`） |
| `ids.ts` | 内容身份（FNV-1a 双轮），重复提取得到相同 ID |
| `index.ts` | 公共入口 |

边界：本阶段**没有**写项目文件、改 target、建条款版本、改绑定、自动提交，也没有调用任何计算。
`planApplication` 返回的映射计划永远 `applied: false`。

## 2. 固定样例 1110 的抽取结果（逐条含出处）

草稿：`draft-793590e034dfdc5a`，7 个候选，全部 `pending`，`issues: []`。
完整 JSON（含每条 evidence 的 rectPdf/pageBoxPdf/textItemIndexes）：
`docs/evidence/V3.6/1110-extraction.json`。

页面均为 `612 × 792` PDF 点、rotate 0；页码 1-based；选区为未旋转 PDF 点。

| # | 类型 | 符号/部件 | 页 | 字段 | 原文 | q（1mm=10000q） | 选区 rectPdf | 原文片段 |
|---|---|---|---|---|---|---|---|---|
| 1 | ring | H（总长） | 1 | nominal | 52.20 | 522000 | [141.42, 640.28, 177.42, 655.28] | `52.20` |
| | | | 1 | upperDev | +0.02 | 200 | [235.03, 640.28, 271.04, 655.28] | `+0.02` |
| | | | 1 | lowerDev | -0.02 | -200 | [314.25, 640.28, 350.25, 655.28] | `-0.02` |
| 2 | ring | B1（左轴承） | 1 | nominal | 20.00 | 200000 | [139.01, 628.28, 175.02, 643.28] | `20.00` |
| | | | 1 | upperDev | +0.01 | 100 | [232.63, 628.28, 268.63, 643.28] | `+0.01` |
| | | | 1 | lowerDev | -0.01 | -100 | [311.84, 628.28, 347.85, 643.28] | `-0.01` |
| 3 | ring | B2（右轴承） | 1 | nominal | 20.00 | 200000 | [139.01, 616.28, 175.02, 631.28] | `20.00` |
| | | | 1 | upperDev | +0.01 | 100 | [232.63, 616.28, 268.63, 631.28] | `+0.01` |
| | | | 1 | lowerDev | -0.01 | -100 | [311.84, 616.28, 347.85, 631.28] | `-0.01` |
| 4 | ring | S（隔套） | 1 | nominal | 12.00 | 120000 | [141.42, 604.28, 177.42, 619.28] | `12.00` |
| | | | 1 | upperDev | +0.01 | 100 | [235.03, 604.28, 271.04, 619.28] | `+0.01` |
| | | | 1 | lowerDev | -0.01 | -100 | [314.25, 604.28, 350.25, 619.28] | `-0.01` |
| 5 | part-dimension | 隔套 | 1 | innerDiameter | 20.00 | 200000 | [83.80, 676.28, 141.41, 691.28] | `20.00 mm` |
| | | | 1 | outerDiameter | 32.00 | 320000 | [184.61, 676.28, 242.22, 691.28] | `32.00 mm` |
| | | | 1 | length | 12.00 | 120000 | [285.42, 676.28, 343.03, 691.28] | `12.00 mm` |
| 6 | interval | C | 2 | lower / upper | 0.1000 / 0.3000 | 1000 / 3000 | [141.40, 712.28, 184.61, 727.28] / [196.61, 712.28, 239.82, 727.28] | `0.1000` / `0.3000` |
| | | | 2 | 端点语义 | 含两端（上下限均包含） | — | [261.42, 712.28, 321.42, 727.28] | `，含两端。` |
| 7 | formula | C | 2 | 表达式 | `C = H - B1 - S - B2` | — | [16.60, 688.28, 153.42, 703.28] | `C = H - B1 - S - B2` |

补充事实（均可从 JSON 复核）：

- ring H/B1/B2 的 nominal 各有 4 段 evidence：第 1 页表格值 + 表头 `(mm)` + 第 2 页“其中 …”重述值/单位；
  相同符号相同数值的重述被**合并为同一候选的多段证据**，不产生重复候选。
- 区间 rawText 保留原符号：`轴向装配间隙 C 应为 0.1000～0.3000 mm，含两端。`（`～` 未丢）。
- 公式 rawText：`C = H - B1 - S - B2`；`operands = [H:+1, B1:-1, S:-1, B2:-1]`；不 eval、不改引擎公式。
- 公式与区间一致性用整数 q 结构化核对：522000−200000−120000−200000 = 2000 ∈ [1000, 3000]，不报冲突。
- 仅选 `[2,2]` 提取时：不出现部件候选、不出现 S（第 2 页没有 S 数值），公式因缺操作数而
  `blocked/FORMULA_UNRESOLVED_OPERAND`——不回填第 1 页值。

## 3. 三条坏样例的判定

夹具全部是真实 Chromium `printToPDF` 产物（`scripts/v36-make-bad-samples.cjs` 生成，
字体/排版与真实样例同源，因此文本层也有同类部首码位）。判定记录：`docs/evidence/V3.6/bad-samples.json`。

| 样例 | 构造 | 实际判定 |
|---|---|---|
| `bad-no-text-layer.pdf` | 只有一张位图，页面无任何文本 item | 候选 **0**；issue `NO_TEXT_LAYER`（blocked，“本版本不做 OCR，拒绝数值提取”）；无任何数值 |
| `bad-formula-conflict.pdf` | 同页两条公式 `C=H−B1−S−B2` 与 `C=H−B1+S−B2`，区间 0.1000~0.3000 | 两条公式 `blocked/FORMULA_CONFLICT`；区间 `blocked/[CONFLICT_GROUP_MEMBER, FORMULA_VALUE_CONFLICT]`；issue `FORMULA_CONFLICT` + `FORMULA_VALUE_CONFLICT`；4 个环仍 `pending`，数值未被修正 |
| `bad-inch-unit.pdf` | 表头 `(in)`、区间 `0.0039～0.0118 in` | 4 环 + 区间全部 `blocked/UNSUPPORTED_UNIT`；公式 `blocked/UNSUPPORTED_UNIT`；`valueQ` 全为 `null`，`unitText='in'` 原文保留；**没有**任何 mm 数值被造出来 |

其余“不确定”分支（合成文本层用例）：缺单位 → `UNKNOWN_UNIT`；>4 位小数 → `PRECISION_UNSUPPORTED`；
同符号两组值 → 两个候选均 `AMBIGUOUS_ASSIGNMENT`（不按先后/置信择优）；页框无效 → 数值不进候选，
只留 `SOURCE_UNRESOLVED`；缺端点语义 → `ENDPOINT_SEMANTICS_MISSING`（`lowerInclusive/upperInclusive = null`）；
上下限颠倒 → `RANGE_CONFLICT`（不自动交换）。

## 4. 文本层归一：NFKC 不够，需 UCD 部首映射（实测结论）

实测 1110 文本层有 **24 处**部首码位，共 9 个字符：
`⽂ ⻚ ⽤ ⼀ ⼨ ⻓ ⾯ ⽑ ⽅`。

- `⽂ ⽤ ⼀ ⼨ ⾯ ⽑ ⽅` 属于康熙部首区（U+2F00–U+2FDF），Unicode **NFKC 会**归一为统一汉字；
- `⻓`（U+2ED3）、`⻚`（U+2EDA）属于 CJK 部首补充区（U+2E80–U+2EFF），**NFKC 不覆盖**，
  归一后仍是部首码位（本机实测：`'⻓'.normalize('NFKC') === '⻓'`）。

处理方式：`NFKC` + 按 Unicode UCD `CJKRadicals.txt`（CJKRadicals-18.0.0，2026-02-03）把该区段
**全量**映射为统一汉字（29 条，含 `U+2ED3 → 长`、`U+2EDA → 页`），不是针对本文件硬编码某几个字。
用例断言：

- 原文 24 处部首码位；归一后剩余 **0** 处；
- 归一后能匹配 `文件编号` / `零件尺寸` / `长度 12.00 mm` / `页数` / `总长`；
- 原文片段（`textSnippet`）仍保留原码位（如 `⽂件编号`、`⻓度`），归一文本另存 `normalizedSnippet`，不覆盖原文。

## 5. 人工确认契约与两条硬约束

- 候选默认只能是 `pending` / `blocked`；`confirmed` 只由 `confirmCandidate` 写入，且要求
  字面量 `confirmed: true`、本地操作身份、决定时间、候选当前 `editRevision`。
- 单个数值字段必须带完整出处（documentId/revisionId/sha256/blobKey/page/rectPdf/pageBoxPdf/
  原文片段/item 索引），缺任一项：`confirmCandidate` 与 `planApplication` 都返回 `EVIDENCE_REQUIRED`。
- 编辑数值：必须带完整 PDF 证据、只接受 mm、必须能精确转 q；编辑后候选回到 `pending`，
  旧确认决定被标记 `invalidatedByEditRevision`，旧代数确认被 `STALE_EDIT_REVISION` 拒绝。
- 拒绝：必须写理由；拒绝后 `confirmCandidate` 返回 `CANDIDATE_REJECTED`（不复活）；重复拒绝幂等。
- `planApplication` 只接受：状态 `confirmed`、决定未失效、数值快照未变、出处完整、来源版本/哈希一致，
  输出 `applied: false` 的映射计划；任何一条不满足都失败。

## 6. 幂等与不污染

- 同一 PDF 版本 + 同一页范围 + 同一规则重复提取：`draftId`、`idempotencyKey`、候选 ID、数量、
  全量 JSON 完全一致（用例 `JSON.stringify` 比较）。
- `mergeExtractionDraft` 同版本合并：不新增重复候选，已有确认决定保留；不同 revision 合并返回
  `SOURCE_IDENTITY_MISMATCH`（字节一致也区分身份）。
- 不污染：`parse`/`draft` 纯函数；用例对草稿做深冻结后执行确认/编辑/拒绝/计划，输入 JSON 前后一致；
  本阶段没有任何写盘/写项目/计算调用。

## 7. 六条命令（在 `2859cd0` 干净工作树上执行）

| # | 命令 | 退出码 | 实际输出 | 日志 |
|---|---|---|---|---|
| 1 | `npm run typecheck` | 0 | 无诊断 | `logs/typecheck-v36.log` |
| 2 | `npm run typecheck:desktop` | 0 | 无诊断 | `logs/typecheck-desktop-v36.log` |
| 3 | `npm run lint` | 0 | `eslint .` 无输出 | `logs/lint-v36.log` |
| 4 | `npm test` | 0 | **87 文件 / 897 用例全过**（基线 853 + 新增 44） | `logs/test-v36.log` |
| 5 | `npm run test:desktop` | 0 | **26 文件 / 178 用例全过** | `logs/test-desktop-v36.log` |
| 6 | `npm run build` | 0 | vite 生产构建通过（既有 chunk 体积警告） | `logs/build-v36.log` |

跑完六条命令后：`git status --short` 无输出（测试不写仓库文件）。

## 8. 回退实验（红 → 恢复绿）

补丁与日志：`docs/evidence/V3.6/mutations/`。两条都在 `2859cd0` 上做，
恢复用 `git checkout --`，恢复后 `git diff` 为空。

### M01 去掉人工确认门禁（`M01-remove-confirmation-gate.patch`）

删除 `planApplication` 中的状态与决定校验（status / 决定代数 / 数值快照），模拟“提取后直接写入”。

- 红：`npx vitest run src/document-extraction/__tests__/confirmation.test.ts` → **exit 1，2 failed / 15 passed**
  - `未确认候选不能进入应用计划`（期望 `NOT_CONFIRMED`，实际 `ok: true`）
  - `确认后数值被改动 → STALE_DECISION（不只看状态布尔）`（期望失败，实际 `ok: true`）
  - 日志：`mutations/logs/M01-red.log`
- 恢复：`git checkout -- src/document-extraction/draft.ts`
- 绿：同一命令 → **exit 0，17 passed**，日志 `mutations/logs/M01-green-restored.log`

### M02 把“必须有原文出处”改成可空（`M02-evidence-optional.patch`）

1. `parse.buildQuantity` 不再要求 evidence 完整，缺出处也保留数值；
2. `draft.evidenceMissing` 恒返回 null（确认/应用不再检查证据）。

- 红：`npx vitest run .../badSamples.test.ts .../confirmation.test.ts` → **exit 1，2 failed / 24 passed**
  - `页面边界框无效 → 无法生成选区，数值不进候选，只留 SOURCE_UNRESOLVED`（候选不再为空）
  - `M02：有数值但出处为空 → 不能确认，也不能进入应用计划`（期望 `EVIDENCE_REQUIRED`，实际成功）
  - 日志：`mutations/logs/M02-red.log`
- 恢复：`git checkout -- src/document-extraction/parse.ts src/document-extraction/draft.ts`
- 绿：同一命令 → **exit 0，26 passed**，日志 `mutations/logs/M02-green-restored.log`

## 9. 未做 / 阻塞 / 已知限制

1. **第 2 阶段未做**：main 侧读取精确版本字节、页范围预算/取消/超时、IPC/preload/契约、
   renderer 审阅 UI、持久化（schema8）与跨重启幂等。本阶段 `planApplication` 只是计划，不写项目。
2. 本阶段不生成 `src/pages/DesktopWorkspace.test.tsx` 假 mock——未新增 IPC/契约（按任务卡允许）。
3. 真实外部任务书样例仍未验证（只用 1 份完整自造样例 + 3 份坏样例）；复杂表格/分栏/字体编码/跨页语义
   泛化能力未承诺。
4. OCR、DOCX、图片输入、外部联网识别、inch 自动换算、自动补公差、自动推导缺失尺寸均未做（任务卡禁止）。
5. 公式只支持线性加减；乘除/括号表达式会 `unsupported` 并阻塞，不改引擎公式。
6. 表格版式只支持“位号 名称 基本尺寸 上偏差 下偏差”列序；其它列序直接 `UNSUPPORTED_TABLE_LAYOUT`。
7. 1109 未参与本阶段期望（缺 S 长度与偏差数字），仅保留 V3.5 回归；本阶段未运行 V3.5 回归以外的打包/真实包验证。

## 10. 复现

```bash
cd /Users/aston/DSH/staff
npx vitest run src/document-extraction                     # 44 个 V3.6 用例
npx vitest run --config vitest.v36evidence.config.ts       # 重新生成抽取 JSON
# 重新生成坏样例 PDF（三者需分开运行，Electron 多窗口同进程会崩）：
for i in 0 1 2; do
  env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron \
    scripts/v36-make-bad-samples.cjs src/document-extraction/__fixtures__ $i
done
```
