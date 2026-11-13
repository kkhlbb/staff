# L2 确认效率（把 80 条阻塞变成能批量处理的东西）

一句话：**让人的动作变少，不让校验变松。** 候选按原因码分组；「仅差单位」可整批补单位
（逐条记 user-attestation、原话逐字保存）；同组单值可整批确认（逐条落盘）；同符号多处
赋值组仍只能人工选一处，批量动作遇到该组一律整批拒绝（0 写入）；公式/数值/单位不支持
三类不给任何批量动作。

- 基线：`main` = `fce521ba94d174c481fa303542dc47a574eb820d`（v0.4.0-beta 已发布）
- 分支：`agent/confirm-efficiency`
- 未 merge / 未 push / 未删分支；仓库工作区在开工与交付时均为空（见第 8 节）

## 1. 硬指标与结论

| 指标 | 目标 | 实测 | 证据 |
|---|---|---|---|
| 候选 / 可确认 / 阻塞 | 138 / 58 / 80 **一个都不许变** | **138 / 58 / 80**（逐份一致） | `logs/07-test-real-docs.log`、`logs/08-metrics-real-docs.log`、`confirm-efficiency-metrics.json` |
| 必须人工单独决策的条目数 | 58 → **≤ 25** | **58 → 11** | 真实语料分组度量 + 界面计数用例（第 5 节） |
| 每条决定逐条落盘 | 是 | 批量确认/补单位都是「每候选一条决定」，不合并 | `desktop/tests/extractionBatch.test.ts`、`src/document-extraction/__tests__/confirmBatch.test.ts` |
| 出处 | 每条带出处 | 补单位追加 user-attestation（含页码/原文的 PDF 出处原样保留） | 同上 |
| 可撤销 | 是 | 补单位可整批撤销（batchId）+ 逐条撤销；确认仍可逐条撤销 | 面板截图 04、主进程用例 |
| 同组互斥 | 不放松 | 批量确认遇到同符号多处组 → 整批拒绝；单条确认仍只允许一处 | M32（第 6 节）、截图 05 |
| 三类“不支持” | 无任何批量动作 | UI 不渲染按钮，写明「只能补原文或放弃」 | 面板用例、截图 01 |

## 2. 改动清单

新增（领域层，纯函数）：

| 文件 | 作用 |
|---|---|
| `src/document-extraction/confirmGroups.ts` | 按原因码分组：可确认单值 / 可确认同符号多处 / 仅差单位单值 / 仅差单位多处 / 各阻塞码 / 已确认 / 已拒绝 / 已失效。固定组序，组内保持草稿顺序（页 → 位置 → 类型 → candidateId），两次打开一致 |
| `src/document-extraction/batch.ts` | `confirmCandidateBatch`（逐条走 `confirmCandidate`）、`attestCandidateUnits`（整批资格校验 → 逐条 user-attestation）、`revokeUnitAttestations`（整批/逐条撤销） |
| `src/document-extraction/__tests__/confirmBatch.test.ts` | 16 条纯函数用例（M32/M33 靶子） |
| `desktop/tests/extractionBatch.test.ts` | 7 条 main/IPC 全链路用例（真实 `buildExtractionDraft` 合成文本层） |
| `scripts/real-docs/confirm-efficiency.test.ts` | 真实 6 份语料分组回归（138/58/80、45/32/2/1、58→11） |
| `scripts/confirm-efficiency-report.mjs` | 逐份分组表 + 汇总 JSON（证据） |
| `scripts/confirm-efficiency-seed.ts` | 截屏夹具：真实 r6 任务书 + 真实提取草稿 |
| `desktop/tests/e2e/confirmEfficiency.mjs` | 打包应用走查：分组 / 批量补单位 / 整批撤销 / 互斥拒绝 + 截图 |
| `docs/evidence/confirm-efficiency/` | 本证据目录（README、logs、mutations、screenshots、JSON） |

修改：

| 文件 | 改了什么（以及为什么） |
|---|---|
| `src/document-extraction/types.ts` | `DecisionAction` 增加 `attest-unit`；`ExtractionDecision.batchId?`（纯加法）；4 个新错误码（BATCH_NOT_ELIGIBLE / UNIT_STATEMENT_INVALID / ATTESTATION_NOT_FOUND / ATTESTATION_CONFIRMED） |
| `src/document-extraction/unitScope.ts` | 新增 `parseUnitStatement`：只认「单位 mm / 单位为毫米 / Units: mm」这类**带“单位”词**的写法，出现两类单位即 conflict；不改文档抽取规则 |
| `src/document-extraction/index.ts` | 导出新模块 |
| `src/project-file/validation.ts` | decision schema 接受 `attest-unit` 与可选 `batchId`；**已撤销的 user-attestation 允许留在出处里**（I4 出处不可抹；能不能当依据由 planApplication 判 `PROVENANCE_REVOKED`） |
| `desktop/shared/contracts.ts` | 3 个 IPC 通道 + 请求/值类型 + 3 个新错误码 |
| `desktop/main/extractionChannels.ts` | 三个通道的 zod schema（`revokeUnits` 要求 batchId/candidateId 二选一） |
| `desktop/main/extractionService.ts` | `confirmBatch / attestUnits / revokeUnits`：先编码自校验 → 写恢复草稿 → 才切快照；补单位把断言写入项目账本并推进 sessionSeq |
| `desktop/preload/index.ts` | 暴露三个具体函数（无通用 invoke 口） |
| `src/workspace/desktopAdapter.ts`、`useDesktopSession.ts`、`src/pages/DesktopWorkspace.tsx` | 接线；批量失败时把 main 的 message 原样带回面板 |
| `src/components/ExtractionReviewPanel.{tsx,css}` | 分组摘要 + 可折叠组、批量补单位表单、批量确认（组级/选中项）、补单位批次与整批撤销、逐条撤销补单位；`confirmable:multi` 组不出现批量按钮 |
| `src/components/ExtractionReviewPanel.test.tsx` | 新增 5 条用例（分组数字、组级批量确认、互斥拒绝、批量补单位、操作数计数）；既有 4 条因“分组后顺序变化”改为按原文定位行（断言意图不变） |
| `desktop/tests/preloadContract.test.ts` | 允许新增的三个 preload 函数（仍只增不改） |
| `vitest.v36fixture.config.ts` | 纳入截屏夹具生成器 |

## 3. 分组口径（与数字）

真实 6 份语料（`REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs`）：

| 文档 | 候选 | pending | blocked | 可批量单值 | 同符号多处（条/组） | 仅差单位（单值+多处） | 必须单独决策 |
|---|---|---|---|---|---|---|---|
| r1 r1-assembly-course.pdf | 15 | 4 | 11 | 1 | 3 / 1 | 2 + 2 | 1 |
| r2 r2-tolerance-domain.pdf | 22 | 7 | 15 | 5 | 2 / 1 | 2 + 6 | 1 |
| r3 r3-rv-3dcs.pdf | 3 | 0 | 3 | 0 | 0 / 0 | 1 + 0 | 0 |
| r4 r4-mtt1097.pdf | 7 | 1 | 6 | 1 | 0 / 0 | 1 + 0 | 0 |
| r5 r5-tolerance-analysis.pdf | 4 | 2 | 2 | 2 | 0 / 0 | 2 + 0 | 0 |
| r6 r6-segments-assembly.pdf | 87 | 44 | 43 | 19 | 25 / 9 | 5 + 24 | 9 |
| **汇总** | **138** | **58** | **80** | **28** | **30 / 11** | **13 + 32 = 45** | **11** |

阻塞原因码（按候选计，口径同 `scripts/real-doc-metrics.mjs`）：
`UNKNOWN_UNIT×45、FORMULA_UNSUPPORTED×32、NUMBER_UNSUPPORTED×2、UNSUPPORTED_UNIT×1`。
其中 45 条 UNKNOWN_UNIT 全部满足「仅差单位」（结构完整、只缺单位、原文可按 mm 精确解析）。

「仅差单位」判据（`isUnitOnlyCandidate`）：状态 blocked + **恰好只有** UNKNOWN_UNIT +
至少一个 unit=null 的数值字段 + 所有缺单位字段原文都能精确解析为 mm。任一不满足就不是该组；
批量补单位据此整批拒绝并逐条指出（M33 靶子）。

组序固定为：可确认单值 → 可确认同符号多处 → 仅差单位单值 → 仅差单位多处 →
FORMULA_UNSUPPORTED → NUMBER_UNSUPPORTED → UNSUPPORTED_UNIT → 其余阻塞码（按原因码表）→
已确认 → 已拒绝 → 已失效。组内不重排（沿用草稿顺序：页 → 页面自上而下 → 类型 → candidateId），
`scripts/real-docs/confirm-efficiency.test.ts` 对同一草稿连续分组两次逐条比对，证明“两次打开一致”。

## 4. 让人的动作变少，但校验不松

- **批量确认**：只对「可确认 · 单值」组开放；每条候选仍走单条确认同一个纯函数
  `confirmCandidate`（状态/编辑代数/出处完整性/同符号互斥全部照旧），逐条写决定。
  选中任何“同符号多处赋值”候选 → 整批拒绝，message 列出该组全部候选，0 条写入。
- **批量补单位**：只改单位字段与出处，不改数值文本；先整批资格校验，任一条不合格整批
  拒绝并指出是哪几条（0 条写入）；合格时给每个缺单位数值追加一条 user-attestation，
  `statement` 逐字保存，并同步写入项目账本（`project.attestations`，sessionSeq 推进）。
  **补单位不是确认**：候选回到待确认，仍要逐条/逐组确认。
- **撤销**：补单位按 `batchId` 整批撤销或按 `candidateId` 逐条撤销；撤销只把 user-attestation
  追加 `revokedAt/revokedBy/revokedStatement`，原文与条目都不删除（I4）；已确认的候选
  撤销补单位会被拒（先撤销确认）。确认本身仍走既有的单条撤销。
- **不给批量**：FORMULA_UNSUPPORTED / NUMBER_UNSUPPORTED / UNSUPPORTED_UNIT 三组在 UI 里
  不渲染任何批量按钮，组头写明「这类只能补原文或放弃」，面板用例逐组断言只有折叠按钮。
- 批量动作没有跳过 `isProvenanceCompleteness`：确认批量复用 `confirmCandidate`；
  补单位在资格校验里对原有出处逐条过该判据，并对新断言本身也过该判据。

## 5. 操作数前后对照（怎么数的）

计数用例：`src/components/ExtractionReviewPanel.test.tsx` →
「L2 操作数计数用例（界面里数，不凭感觉估）」。它用一份**结构与 6 份语料聚合数字一致**的夹具
（28 单值 + 30 同符号多处/11 组 + 13 仅差单位单值 + 32 仅差单位多处/16 组 + 35 三类阻塞 = 138），
在 jsdom 里真实点击/输入，并按“1 次点击 = 1 次操作；1 次输入提交 = 1 次操作（不是每字符）”
用 `opsCounter` 累加，断言 `{clicks: 14, inputs: 1}`：

| 场景 | 改前 | 改后 | 计数来源 |
|---|---|---|---|
| 必须人工单独决策的条目数（58 范围） | 58 条逐条确认 | **11**（互斥组每组只能人工选一处） | 真实语料 `pendingIndividualDecisions=11`；界面用例断言 `1 + 11 ≤ 25` |
| 完成 58 条确认的点击 | 58 | **12**（1 次「本组全部确认（28 条）」+ 11 次逐组选一处） | `ops.state.clicks - 2 = 12` |
| 额外处理 45 条「仅差单位」 | 无批量动作（只能逐条看/改） | **3**（开表单 1 点击 + 输入声明 1 + 确认补单位 1 点击） | `clicks=14 = 12 + 2`，`inputs=1` |
| 合计操作（58 确认 + 45 补单位） | 58 | **15** | `expect(ops.state).toEqual({ clicks: 14, inputs: 1 })` |

说明（如实）：
- 「58 → 11」里的 11 是**互斥组数**（每组必须由人挑一处），不是把 30 条都算成决定；
  另外 19 条同符号成员不会被确认、也不需要决定（它们保持待确认）。改前 58 条每条都要
  单独核对并点击，所以基线是 58。
- 补单位把「80 条阻塞要一条条看」压成 1 次声明 + 1 次确认；但补完仍停在待确认，
  32 条互斥成员仍需 11 组人工各选一处（这是“互斥不放松”的必然成本，不装作省掉）。

真实语料逐份数据由 `scripts/confirm-efficiency-report.mjs` 输出（`confirm-efficiency-metrics.json`），
与 UI 用例使用同一个 `groupConfirmCandidates`，不存在“界面一套、脚本一套”。

## 6. 变异 M32 / M33

| 变异 | 改动 | 红 | 恢复绿 |
|---|---|---|---|
| **M32** 批量跳过同符号互斥 | `batch.ts`：`if (multiGroups.size > 0)` → `if (false && …)` | `confirmBatch.test.ts` 1 failed / 15 passed；`extractionBatch.test.ts` 1 failed / 6 passed（`mutations/logs/M32-*-red.log`，exit=1） | 16/16 与 7/7 全绿（`M32-*-green.log`，exit=0） |
| **M33** 批量补单位把不合格条目也改 | `batch.ts`：`if (ineligible.length > 0)` → `if (false && …)` | `confirmBatch.test.ts` 1 failed / 15 passed；`extractionBatch.test.ts` 1 failed / 6 passed（`M33-*-red.log`，exit=1） | 16/16 与 7/7 全绿（`M33-*-green.log`，exit=0） |

变异补丁：`mutations/M32-skip-group-conflict.patch`、`mutations/M33-attest-ineligible.patch`。
两者都只改一行判定，用来证明“整批拒绝”不是摆设：去掉判定，对应用例立刻红。

## 7. 门禁与证据

六条命令 + 打包（原始 stdout/stderr 与退出码见 `logs/`、`verification.json`）：

| # | 命令 | 退出码 | 实际输出 | 日志 |
|---|---|---|---|---|
| 1 | `npm run typecheck` | 0 | 无诊断 | `logs/01-typecheck.log` |
| 2 | `npm run typecheck:desktop` | 0 | 无诊断 | `logs/02-typecheck-desktop.log` |
| 3 | `npm run lint` | 0 | `eslint .` 无输出 | `logs/03-lint.log` |
| 4 | `npm test` | 0 | **111 文件 / 1243 用例全过** | `logs/04-test.log` |
| 5 | `npm run test:desktop` | 0 | **43 文件 / 297 过（+17 跳过）** | `logs/05-test-desktop.log` |
| 6 | `npm run test:mcp` | 0 | **3 文件 / 22 用例全过** | `logs/06-test-mcp.log` |
| 7 | `npm run test:real-docs` | 0 | **2 文件 / 6 用例全过** | `logs/07-test-real-docs.log` |
| 8 | `REAL_DOC_CORPUS=… npm run metrics:real-docs` | 0 | `BASELINE MATCH`：138/58/80 与 baseline 完全一致 | `logs/08-metrics-real-docs.log` |
| 9 | `npm run build` | 0 | 构建通过（既有 chunk >500kB 警告） | `logs/09-build.log` |
| 10 | `npm run package:desktop -- --arch=arm64` | 0 | `RESULT PASS 打包产物中的 pdf worker 可被 main.cjs 运行时加载` | `logs/10-package-desktop.log` |
| 11 | `npm run check:package:pdf-worker` | 0 | `RESULT PASS` | `logs/12-check-package-pdf-worker.log` |

用例数 1243 = 1219（基线）+ 16（纯函数批量）+ 5（面板新增）+ 3（新增证据 JSON 触发的守卫：
`confirm-efficiency-metrics.json`、`e2e-summary.json`、`verification.json`）。

`verification.json` 由 `capture.mjs` 生成（每个命令真实执行并记录退出码/耗时，走
`serializeEvidence` 归一化）。打包未在 capture 里重跑（耗时数分钟），其 EXIT 取自
`logs/10-package-desktop.log` 的真实运行记录，`verification.json` 里标注 `invoked:false`。

### 打包应用走查（真实 .app + CDP，无文件对话框）

`node desktop/tests/e2e/confirmEfficiency.mjs` → `RESULT PASS`，产出 `e2e-summary.json` 与截图：

| 截图 | 内容 |
|---|---|
| `screenshots/l2-01-grouped-panel.png` | 真实 r6：可确认 44（单值 19 可批量 / 同符号多处 25、9 组）、仅差单位 29（单值 5 / 多处 24）、阻塞其余 14（FORMULA_UNSUPPORTED 13 / UNSUPPORTED_UNIT 1，只能补原文或放弃），各组折叠与「本组全部确认」 |
| `screenshots/l2-02-unit-statement-form.png` | 「单位声明」输入框 + 「确认补单位（29 条）」+ 说明 |
| `screenshots/l2-03a-attest-message.png` | 补单位成功提示：29 条逐条记 user-attestation、声明原话逐字保存、仍是待确认 |
| `screenshots/l2-03-units-attested.png` | 补单位后：可确认 73（单值 24 / 多处 49、16 组）、仅差单位 0、批次行 + 「整批撤销」 |
| `screenshots/l2-04a-revoke-message.png` / `l2-04-units-revoked.png` | 整批撤销提示；计数恢复 44 / 43，批次消失 |
| `screenshots/l2-05-group-refusal.png` | 选中同符号 T1 两处 → 「批量确认选中项」→ `EXTRACTION_GROUP_CONFLICT`：同一符号多处赋值只能确认一处…**整批未执行（0 条写入）**；已确认 0、决定 0 |

走查断言（`e2e-summary.json` 可核）：补单位决定 29 条（逐条，共享 1 个 batchId）、
statement 逐字、补后 pending 44+29=73、撤销后 44/43 且账本 29 条撤销留痕、互斥拒绝 0 写入。

## 8. 工作区与提交

- `git status --short` 在本次提交前非空（本分支的新增/修改就是交付物）；提交后实测为**空**。
  该检查不写成仓库内日志：日志文件本身会让工作区再次变脏（自引用），交付正文直接给出命令输出。
- 分支：`agent/confirm-efficiency`；提交：见本次交付正文（commit hash）。
- 未 merge / 未 push / 未删除任何分支或数据。

## 9. 未做项 / 已知问题（如实标注）

1. **只支持 mm 声明**：批量补单位不做换算，声明里必须出现「单位 mm / 单位为毫米 / Units: mm」
   这类写法；「本表按毫米计」「照表抄」这类句子会被拒（`UNIT_STATEMENT_INVALID`）。
2. **逐条撤销补单位在界面上按候选显示**：整批撤销按 batchId；逐条撤销按钮只在该候选仍有
   有效补单位决定时出现。项目账本里的同批断言会同步标撤销，但按“整批”粒度的审计视图没有
   单独页面（沿用既有账本展示）。
3. **schemaVersion 仍为 10**：新增 `action='attest-unit'` 与可选 `batchId` 是纯加法，旧文件照读；
   但 v0.4.0-beta 旧版读**含新字段**的项目文件会被严格 schema 拒绝。要正式前向兼容应另开
   schema 11，本任务未做（改动面会覆盖全部项目夹具与迁移用例）。
4. **PDF 草稿的“送入项目”通道仍未接**：user-attestation 在 `planApplication` 里仍受会话
   匹配约束（`ATTESTATION_SESSION_MISMATCH`），当前 PDF 草稿没有调用它的 UI 路径；补单位
   断言的提交资格要等该通道（与 ADR-001 既有待接项一致），本任务只保证草稿层与账本留档。
5. **互斥组的“补单位后选择”仍需人工**：45 条仅差单位里有 32 条属于 11 个互斥组，补完单位
   仍要每组选一处；这是“同组互斥不放松”的必然成本，没有用批量动作替代。
6. **只在本机 macOS 26.4 / arm64 验证**：打包走查与截图均在本机完成，未在 CI 或其它机型复跑。
7. **e2e 只走 r6 一份文档**：其余 5 份的数字由真实语料脚本与测试覆盖；面板的批量交互在
   r6 上实测（含 29 条补单位、9 组互斥拒绝）。
8. 既有 4 条面板用例因分组改变了 DOM 顺序，改为按原文定位行；断言内容（状态、禁用、理由、
   互斥提示）未放宽。
