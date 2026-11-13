# 批量补单位做成真状态变更（补 L2 留下的窟窿）

一句话：**L2 只算了操作成本，这次把状态做实。** 用户给一句单位声明，45 条「仅差单位」
真的从 blocked 变成 pending，每条带 `user-attestation`（actorId + sessionSeq + turnId +
原话逐字）；界面写明「单位来源：用户声明」；按 batchId 整批撤销后逐项回到 138 / 58 / 80。

- 基线：`main` = `519f7dc`（L2 已合）
- 分支：`agent/unit-attest-state`
- 未 merge / 未 push / 未删分支；交付时 `git status --short` 为空（见第 8 节）
- 抽取规则未改：仍 `document-extractor-6`（真实语料每份草稿的 extractorVersion 已逐份断言）

## 1. 硬指标（真跑出来，不是凑的）

| 指标 | 现在（未声明） | 真跑批量声明 mm 后 | 整批撤销后 | 证据 |
|---|---|---|---|---|
| 候选 | 138 | **138** | 138 | `logs/09-metrics-attest.log` |
| pending | 58 | **103**（58 + 45） | 58 | 同上 |
| blocked | 80 | **35**（80 − 45） | 80 | 同上 |
| 可确认率 | 42.0% | **74.6%** | 42.0% | 同上 |
| 三类“不支持” | 32 / 2 / 1 | **32 / 2 / 1（一条没动）** | 32 / 2 / 1 | 同上逐份段 |

45 条全部转过去了，没有“差几条没转”的情况。每份文档的数字见第 3 节。

## 2. 改动清单

领域层（纯函数，唯一判据入口没变）：

| 文件 | 改动 |
|---|---|
| `src/document-extraction/batch.ts` | `AttestUnitsRequest` 增加必填 `turnId`（空串/空白 → `ATTESTATION_TURN_REQUIRED`）；每条断言写入 `turnId`；补单位后**再过一遍** `provenanceMissing`，任一数值字段出处仍不齐 → 整批拒绝（`EVIDENCE_REQUIRED`，0 写入）；新增只读 `unitAttestationOf(candidate)` 供界面显示来源 |
| `src/document-extraction/types.ts` | 新错误码 `ATTESTATION_TURN_REQUIRED` |
| `src/document-extraction/index.ts` | 导出 `unitAttestationOf` |

main / 契约：

| 文件 | 改动 |
|---|---|
| `desktop/main/extractionService.ts` | `attestUnits` 由 main 生成 `turnId = extraction-panel-<sessionSeq>`（renderer/模型不能提供）；新错误码映射 |
| `desktop/shared/contracts.ts` | 注释写明 turnId 由 main 生成（请求形状不变，仍不接受 renderer 传身份） |

界面：

| 文件 | 改动 |
|---|---|
| `src/components/ExtractionReviewPanel.tsx` | 每条补过单位的候选显示「单位来源：用户声明 · 原话「…」· 第 N 次输入（actor · turn）」；批次行也写明“单位来源：用户声明” |
| `src/components/ExtractionReviewPanel.css` | 该行独立配色/左边框，和“从原文读到的”出处视觉分开 |

度量与证据：

| 文件 | 作用 |
|---|---|
| `scripts/real-docs/metrics.mjs` | 新增 `attachUnitsAndVerify`：逐份真跑「补单位 → 整批撤销」，核对转 pending 条数、三类不支持数不变、撤销后状态逐项相同；任一不符直接抛错 |
| `scripts/real-doc-metrics.mjs` | 新增 `--attest-units "<声明>"` 模式：逐份三列（未声明 / 声明后 / 撤销后）+ 可确认率；不比较 baseline、不覆盖 `real-doc-baseline/metrics.json` |
| `scripts/real-docs/unit-attest-state.test.ts` | 真实 6 份语料回归：138/58/80 → 138/103/35 → 撤销回 138/58/80，两次一致；45 条逐个断言 turnId/原话/完整性；三类不支持保持 |
| `scripts/unit-attest-state-seed.ts` | 生成 6 份语料的项目文件（45 条断言）+ 脱敏 JSON（encode 后 decode 回读） |
| `scripts/unit-attest-mutations.mjs` | M34 / M35 变异驱动（apply/revert） |
| `desktop/tests/e2e/unitAttestState.mjs` | 真实打包应用走查：29 条补单位 / 界面原话 / 保存并回读项目文件 / 整批撤销 |
| `docs/evidence/unit-attest-state/` | 本证据目录 |

新增/修改用例：

- `src/document-extraction/__tests__/confirmBatch.test.ts`：+3（M34 撤销必须改存储；M35 三类不支持进不了批量；空 turnId 被拒）
- `src/components/ExtractionReviewPanel.test.tsx`：+1（界面必须显示「单位来源：用户声明」+ 原话 + 轮次；未补单位的不出现该行）
- `scripts/real-docs/unit-attest-state.test.ts`：+1（真实语料真状态变更，专用配置）
- `desktop/tests/extractionBatch.test.ts`：补单位断言加 `turnId` 期望（未放宽其它断言）

## 3. 两种跑法（逐份）

命令 1（未声明，现状基线）：

```
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs node scripts/real-doc-metrics.mjs
```

输出（`logs/08-metrics-real-docs.log`）：

```
汇总：6 份 / 269 页 / 候选 138（pending 58｜blocked 80｜confirmed 0）
可确认率 = pending/候选 = 58/138 = 42.0%；阻塞率 = 58.0%
BASELINE MATCH：与 docs/evidence/real-doc-baseline/baseline.json 完全一致（6 份文档）
```

命令 2（批量声明 mm，新增开关）：

```
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs \
  node scripts/real-doc-metrics.mjs --attest-units "本表单位 mm"
```

输出（`logs/09-metrics-attest.log`）：

| 文档 | 候选 | 未声明 pending | 未声明 blocked | 声明后 pending | 声明后 blocked | 补上条数 | 撤销后 pending | 撤销后 blocked | 撤销一致 |
|---|---|---|---|---|---|---|---|---|---|
| r1 r1-assembly-course.pdf | 15 | 4 | 11 | 8 | 7 | 4 | 4 | 11 | 是 |
| r2 r2-tolerance-domain.pdf | 22 | 7 | 15 | 15 | 7 | 8 | 7 | 15 | 是 |
| r3 r3-rv-3dcs.pdf | 3 | 0 | 3 | 1 | 2 | 1 | 0 | 3 | 是 |
| r4 r4-mtt1097.pdf | 7 | 1 | 6 | 2 | 5 | 1 | 1 | 6 | 是 |
| r5 r5-tolerance-analysis.pdf | 4 | 2 | 2 | 4 | 0 | 2 | 2 | 2 | 是 |
| r6 r6-segments-assembly.pdf | 87 | 44 | 43 | 73 | 14 | 29 | 44 | 43 | 是 |
| **汇总** | **138** | **58** | **80** | **103** | **35** | **45** | **58** | **80** | **6/6** |

```
可确认率 = 声明后 pending/候选 = 103/138 = 74.6%
汇总：候选 138｜未声明 pending 58 / blocked 80｜声明后 pending 103 / blocked 35｜补上 45 条｜撤销后 pending 58 / blocked 80
r6 声明「本表单位 mm」｜actor=local-operator｜sessionSeq=6｜turnId=real-doc-attest-6｜batchId=unit-batch-131c0223ac65c…｜决定 29 条｜三类不支持保持：FORMULA_UNSUPPORTED×13、NUMBER_UNSUPPORTED×0、UNSUPPORTED_UNIT×1
```

每份都核对“三类不支持保持”：r1 7/0/0、r2 7/0/0、r3 2/0/0、r4 3/2/0、r5 0/0/0、
r6 13/0/1，合计 32 / 2 / 1，与未声明时逐项相同。

## 4. 出处可见（界面 + 项目文件）

界面（真实打包应用，r6）：

| 截图 | 内容 |
|---|---|
| `screenshots/l3-01-before.png` | 未声明：可确认 44（19 可批量 / 25、9 组）、仅差单位 29、阻塞其余 14 |
| `screenshots/l3-02-after-attest.png` | 声明后：可确认 73、仅差单位 0、阻塞其余 14（FORMULA 13 / UNSUPPORTED_UNIT 1）；批次行「单位来源：用户声明 · 声明「本表单位 mm（2026-11-12 复核）」+ 整批撤销」 |
| `screenshots/l3-03-unit-source.png` | 候选行：`单位来源：用户声明 · 原话「本表单位 mm（2026-11-12 复核）」· 第 1 次输入 （local-operator · extraction-panel-1）` |
| `screenshots/l3-04-revoked.png` | 整批撤销后回到 44 / 43，仅差单位 29 回来、批次行消失 |

`e2e-summary.json` 里的原始读数：补单位后 pending 73 / blocked 14 / 决定 29 / 账本 29 条，
turnId 全为 `extraction-panel-1`；撤销后 pending 44 / blocked 43 / 撤销决定 29 条。

项目文件（`.cunlian`）不是只改内存：走真实 `saveProject` 落盘，再用 `decodeProjectFile`
回读（`e2e-summary.json` 的 `saved-after-attest` / `saved-after-revoke`）：

- 补单位后回读：pending 73 / blocked 14、29 条断言全部有效（`activeAttestations=29`）；
- 撤销后回读：pending 44 / blocked 43、29 条断言全部带 `revokedAt`（`revokedAttestations=29`），
  出处条目没被删除（I4 出处不可抹）。

45 条全量片段见 `project-attestation.json`（6 份语料打包成一个项目文件，encode → decode 回读；
无绝对路径、无 PDF 正文）。摘一段：

```json
{
  "documentId": "doc-1",
  "candidateId": "ring-4c0a2da712e7ea71",
  "actorId": "local-operator",
  "sessionSeq": 1,
  "turnId": "unit-attest-seed-1",
  "statement": "本表单位 mm（2026-11-12 复核）",
  "fieldPath": "candidate:ring-4c0a2da712e7ea71:unit",
  "values": [{ "field": "nominal", "text": "0", "unit": "mm", "unitText": "mm" }]
}
```

`project-attestation.json` 的 `counts`：documents 6、candidates 138、pending 103、blocked 35、
userAttestations 45。

## 5. 撤销（存储级）

- 度量里每份都真撤销（`revokeUnitAttestations({batchId})`），撤销后逐项等于补单位前；
  `metrics.mjs` 在数字不一致时直接抛 `UNIT_REVOKE_INCOMPLETE`，不会输出“看起来对”的表。
- 连跑两次逐字节一致：同一命令跑两遍，`metrics.json` 的 SHA-256 都是
  `1135a6a9f2d26e05588ddb17dbf65c92e1361451b137fb592e9b5c593cb574a0`
  （`logs/09-metrics-attest.log`、`logs/09-metrics-attest-run2.log`）。
- 界面撤销后退回 44 / 43（`l3-04`），并且**保存后的项目文件**也回到 44 / 43、断言带
  `revokedAt`——不是只改界面。

## 6. 变异 M34 / M35

| 变异 | 改动 | 红 | 恢复绿 |
|---|---|---|---|
| **M34** 撤销只改界面不改存储 | `batch.ts`：撤销时 `status: candidate.status`、`reasonCodes` 不还原（只追加决定/失效标记） | `confirmBatch.test.ts` **3 failed / 16 passed**（含「撤销必须真的改存储」「整批撤销…」「逐条撤销…」），exit=1；`desktop/tests/extractionBatch.test.ts` **1 failed / 6 passed**，exit=1（`logs/M34-unit-red.log`、`logs/M34-main-red.log`） | 19/19 与 7/7 全绿，exit=0（`logs/M34-green.log`、`logs/M34-main-green.log`） |
| **M35** 把“公式不支持”也纳入批量 | `confirmGroups.ts`：`isUnitOnlyCandidate` 从“恰好 UNKNOWN_UNIT”放宽为“有个原因码即可” | `confirmBatch.test.ts` **3 failed / 16 passed**（含「三类“不支持”无论怎么传…」「“仅差单位”判据…」），exit=1（`logs/M35-unit-red.log`） | 19/19 全绿，exit=0（`logs/M35-green.log`） |

补丁：`mutations/M34-revoke-ui-only.patch`、`mutations/M35-include-formula.patch`；
驱动：`node scripts/unit-attest-mutations.mjs m34|m35 apply|revert`。

如实说明：M35 变异下真实语料回归**仍是绿**（`logs/M35-real-red.log`）。原因是真实语料里的
FORMULA_UNSUPPORTED 候选没有“unit=null 且原文可按 mm 解析”的字段，放宽唯一原因码后它们仍
不满足 `unitPendingField`；也就是说这个变异在当前语料上无法显形，范围守卫由合成夹具用例
（显式混入三类阻塞，断言整批拒绝）负责红。没有为了让日志好看去改语料或放宽断言。

## 7. 门禁（六条命令 + 真实语料 + 打包）

原始 stdout/stderr 与退出码见 `logs/`、`verification.json`：

| # | 命令 | 退出码 | 实际输出 | 日志 |
|---|---|---|---|---|
| 1 | `npm run typecheck` | 0 | 无诊断 | `logs/01-typecheck.log` |
| 2 | `npm run typecheck:desktop` | 0 | 无诊断 | `logs/02-typecheck-desktop.log` |
| 3 | `npm run lint` | 0 | `eslint .` 无输出 | `logs/03-lint.log` |
| 4 | `npm test` | 0 | **111 文件 / 1251 用例全过** | `logs/04-test.log` |
| 5 | `npm run test:desktop` | 0 | **43 文件 / 297 过（+17 跳过）** | `logs/05-test-desktop.log` |
| 6 | `npm run test:mcp` | 0 | **3 文件 / 22 用例全过** | `logs/06-test-mcp.log` |
| 7 | `REAL_DOC_CORPUS=… npm run test:real-docs` | 0 | **3 文件 / 7 用例全过** | `logs/07-test-real-docs.log` |
| 8 | `REAL_DOC_CORPUS=… npm run metrics:real-docs` | 0 | `BASELINE MATCH`：138/58/80 与 baseline 一致 | `logs/08-metrics-real-docs.log` |
| 9 | `REAL_DOC_CORPUS=… node scripts/real-doc-metrics.mjs --attest-units "本表单位 mm"` | 0 | 138 / 103 / 35，撤销回 138 / 58 / 80 | `logs/09-metrics-attest.log` |
| 10 | `npm run build` | 0 | 构建通过（既有 chunk 警告） | `logs/11-build.log` |
| 11 | `npm run check:package:pdf-worker` | 0 | `RESULT PASS` | `logs/12-check-package-pdf-worker.log` |
| 12 | `npm run package:desktop -- --arch=arm64` | 0 | `RESULT PASS 打包产物中的 pdf worker 可被 main.cjs 运行时加载` | `logs/10-package-desktop.log` |

1251 = 1243（基线）+ 4（新增用例：confirmBatch 3 + 面板 1）+ 4（新增证据 JSON 触发的守卫：
`metrics.json`、`project-attestation.json`、`e2e-summary.json`、`verification.json`）。

打包应用走查（真实 `.app` + CDP，无文件对话框）：

```
node desktop/tests/e2e/unitAttestState.mjs
RESULT PASS 批量补单位真状态走查（29 条转 pending / 界面对话原话 / 项目文件回读 / 整批撤销）
```

## 8. 工作区与提交

- `git status --short` 在提交前非空（本分支改动就是交付物）；提交后实测为**空**（见交付正文）。
- 分支：`agent/unit-attest-state`；提交：见本次交付正文（commit hash）。
- 未 merge / 未 push / 未删除任何分支或数据。

## 9. 未做项 / 已知问题（如实标注）

1. **只支持 mm 声明**：仍不换算，声明必须是「单位 mm / 单位为毫米 / Units: mm」这类显式写法。
2. **turnId 是面板轮次，不是 Agent 任务 ID**：提取面板的补单位是用户在本机面板的一次提交，
   main 生成 `extraction-panel-<sessionSeq>`；若将来从 Agent 任务里触发，应改绑该任务 ID。
3. **schemaVersion 仍为 10**：`turnId` 是既有可选字段，没有升 schema；旧文件照读，
   旧版应用读含 `turnId` 的文件会因严格 schema 被拒（与 L2 的已知前向兼容问题同源，本卡未改）。
4. **真实语料里 M35 变异不可见**（见第 6 节）：范围守卫靠合成夹具用例，已如实记录，没有改语料。
5. **e2e 只走 r6 一份文档**：其余 5 份由真实语料脚本与测试覆盖（138/103/35 全量数字来自 6 份）。
6. **只在本机 macOS 26.4 / arm64 验证**：未在 CI 或其它机型复跑。
7. **项目文件脱敏片段是全量 45 条的 encode→decode 回读**，不是从用户实际保存的工程里另抄；
   界面走查另有一份真实 `saveProject` 落盘 + 回读的 29 条证据（`e2e-summary.json`）。
