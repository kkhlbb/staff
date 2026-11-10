# V3.6 第 2 阶段：主进程 IPC + 审阅界面 + 持久化与跨重启幂等

状态：**实现、自动化测试、打包应用走查、M03 变异（红 → 恢复绿）均已完成。**
未合并、未推送、未删除任何分支/工作树；按用户指令直接在 `main` 上提交（不自开分支）。

- 仓库：`/Users/aston/DSH/staff`
- 分支：`main`
- 基线：`b1d2b31`（第 1 阶段证据提交，工作区干净）
- 实现提交：`<IMPL_COMMIT>`
- 证据提交：`<DOCS_COMMIT>`（本文件与截图/日志）
- 未改：domain 公式、q 精度、V3.5 数值断言（1500/2500、1100/2100、500/1500、1000/2000）、
  既有 schema3–7 严格判据（只新增 schema8，旧版本读入规则不放宽）。

## 1. 为什么升 schema 8，能否不升

**结论：要满足“候选/逐条决定随项目文件持久化、跨重启仍在、写入可追溯”，必须升 8；
不升 8 无法诚实实现。**

- 现有写端 schema 7 是**严格** zod 对象（`projectV5Schema`），任何未知键都会被拒绝。
  把提取草稿塞进 schema7 等于偷偷扩展严格 schema，任务卡 §2.4 明确不允许。
- 任务卡 §6 要求“跨关闭/重开幂等须持久化稳定键与决定日志；若仅会话暂存必须明确限制，
  不能声称跨重启幂等已满足”。用户本次明确要求“存项目文件，不存内存”。
- 独立 sidecar 文件（项目旁边的 JSON）能避开 schema 变更，但：
  1) 不是“项目文件”，移动/复制 `.cunlian` 时会丢审计；
  2) 没有与项目内容同一原子提交点，无法保证“候选/决定与项目版本一致”。
- 因此采用**最小** schema8 扩展：只在 `project.json` 增加 `extractionDrafts` 数组，
  不新增容器条目、不改尺寸链 schema（仍为 2）、不改容器 formatVersion（仍为 2）。
  语义：schema8 = schema7 + 任务书提取草稿。旧 schema3–7 读入时补 `[]`，首次显式保存才写 8；
  旧程序不能打开 schema8（无无损降级），与 V3.5 相同的升级约定。

同步改动（任务卡 §2.4 要求）：`types/validation/codec/upgrade/newProject/migrateV2`、固定样例夹具与
既有测试中的版本字面量；新增 `src/project-file/schema8.test.ts` 验证往返、旧 schema 补空、
schema7 混入新字段被拒、伪造确认被拒、悬空 PDF 版本被拒。

`stageDraft` 在 `ProjectService.stageFromDto` 中把 `extractionDrafts` 加入 main 权威保护字段：
renderer 的普通编辑通道不能伪造“已确认”、决定时间或出处；有专门用例验证伪造后仍是 `pending`。

## 2. main / IPC / preload

新增：

| 文件 | 职责 |
|---|---|
| `desktop/main/pdfTextExtract.ts` | pdfjs legacy fake worker 读取指定页范围 TextItem；页数/词项预算（20000 item）、20s 超时、逐页取消检查；不渲染、不 OCR |
| `desktop/main/extractionService.ts` | 确切 revision 解析（不追随 latest）、附件字节/SHA-256 校验、领域提取、幂等合并、逐条决定、失败零写入、同会话串行、并发 BUSY |
| `desktop/main/extractionChannels.ts` | `extraction:run` / `extraction:decide` / `extraction:cancel`；sender 白名单 + 会话校验 + 严格 schema + 统一错误码 |
| `desktop/shared/contracts.ts` | 通道、请求/返回值、`CunlianApi` 扩展、提取错误码 |
| `desktop/preload/index.ts` | 只暴露 `runExtraction` / `decideExtraction` / `cancelExtraction` 三个具体函数 |

请求只含：`sessionId`、`baseEditSeq`、确切 `revisionId`、1-based 页范围、`requestId`。
不传路径、blobKey、sha256、字节、actor、decidedAt 或最终状态。

失败/拒绝路径（均为实际测试覆盖）：

- 未知 revision → `SOURCE_NOT_FOUND`；页范围非法/越界 → `PAGE_OUT_OF_RANGE`；
- 附件缺失 → `ATTACHMENT_MISSING`；字节哈希不符 → `HASH_MISMATCH`；
- 并发提取 → `EXTRACTION_BUSY`；取消 → `EXTRACTION_CANCELLED`；超时 → `EXTRACTION_TIMEOUT`；
  词项超预算 → `EXTRACTION_BUDGET`；无文本层 → 草稿 0 候选 + `NO_TEXT_LAYER`（blocked），不报假成功；
- 决定门禁：`EXTRACTION_CONFIRMATION_REQUIRED`、`EXTRACTION_EVIDENCE_REQUIRED`、
  `EXTRACTION_CANDIDATE_BLOCKED`、`EXTRACTION_CANDIDATE_REJECTED`、`EXTRACTION_STALE_DECISION`、
  `EXTRACTION_REASON_REQUIRED`。

任何失败都发生在替换 `session.snapshot` 之前：用例逐步对比 `JSON.stringify(snapshot)` 与
`acceptedSeq` 证明零写入、不留半截。

提取/决定只更新 main 会话快照与恢复草稿，**不自动保存项目文件**；正式落盘仍由用户显式保存，
沿用既有临时文件 → 回读校验 → rename 原子提交。

## 3. 审阅界面

新增 `src/components/ExtractionReviewPanel.tsx` + CSS，接入桌面工作台第 6 个标签“任务书提取”。

- 候选逐条显示：类型、符号/名称、原文片段、页、选区 `rectPdf` + `pageBoxPdf` + TextItem 索引、
  全部数值字段、置信与原因码；`data-status` + 文字徽标 + 左侧色条区分
  待确认 / 阻塞 / 已确认 / 已拒绝 / 已失效；已确认/已拒绝行显示决定（动作、actor、时间、理由）。
- 明确限制：显示 `extractorVersion`（默认 `document-extractor-1`）、“只验证过 1 份自造样例”、
  “只做带文本层 PDF，不做 OCR/DOCX/图片识别/联网识别”。
- 确认：逐条点击，没有默认勾选，**不提供批量确认**（任务卡 §4.2）；阻塞/已拒绝/已确认行按钮禁用。
- 拒绝：必须填理由才可提交；批量操作只支持**批量拒绝**已选中的候选（逐条记录理由）。
- 编辑：只接受 mm，且改后文本必须出现在该字段原有原文片段里；否则 main 返回
  `EXTRACTION_EVIDENCE_REQUIRED`，界面提示“拒绝后走人工录入”，不伪造出处。
- 定位：点击“定位到 PDF 选区”显示确切版本/页码/选区，并用只读 `PdfViewer` 高亮该矩形；
  字节经 `window.cunlian.readAttachment` 从 main 读取，renderer 不接触路径。
- 旧版本提示：选中 revision 不是文档 latest 时显示醒目警告，提取仍只读该确切版本。
- 未确认候选不参与计算：界面明确声明，代码中计算只读 `dimensionChain`/`draft`；main 用例断言
  提取/确认/拒绝前后 target、参数、绑定、条款、事件、尺寸链完全不变。

## 4. 幂等与跨重启

- 幂等键保持第 1 阶段的 `project + documentId/revisionId/sha256 + 页范围 + extractorVersion`。
- 同键重复提取：合并到原草稿，候选 ID/数量/`draftRevision` 不变，`acceptedSeq` 不推进，
  返回 `unchanged: true`。候选 ID 由内容身份生成，不依赖数组序号或时间戳。
- 决定随 `project.extractionDrafts[].decisions` 持久化，包含 candidateId、editRevision、
  原值/最终值快照、完整 evidence、actor（本地操作身份 `local-operator`）与决定时间。
- 保存后关闭重开：项目文件解码仍是 7 候选、1 已确认、1 已拒绝；重开后再提取同范围
  仍返回 `unchanged`（main 测试 + 打包应用走查各一次）。

**已知偏差（需说明，不冒充已满足）**：任务卡 §6 还写了“扩大页范围仅追加新项”。
本次实现为**每个规范页范围一份独立草稿**（幂等键含页范围）：
- 原因：候选身份包含“首次出现页/选区”，把 `[2,2]` 的解析结果与 `[1,2]` 合并会产生
  同一语义候选的两条记录，或者必须把旧范围的决定迁移到重新解析的候选上（会违反
  “决定绑定候选身份/代数”的追溯要求）。
- 行为：`[2,2]` 与 `[1,2]` 各自草稿、各自决定；同一草稿内部绝不重复候选。
- 用例：`不同页范围各自独立草稿：旧范围的决定不被新范围覆盖（偏差见证据文档）`。
- 如果验收坚持“单草稿扩范围追加”，需要先拍板候选身份是否允许跨范围合并/决定迁移。

## 5. 六条命令（提交后在干净工作树执行）

| # | 命令 | 退出码 | 实际输出 | 日志 |
|---|---|---|---|---|
| 1 | `npm run typecheck` | 0 | 无诊断 | `logs/typecheck-v36-stage2.log` |
| 2 | `npm run typecheck:desktop` | 0 | 无诊断 | `logs/typecheck-desktop-v36-stage2.log` |
| 3 | `npm run lint` | 0 | `eslint .` 无告警 | `logs/lint-v36-stage2.log` |
| 4 | `npm test` | 0 | **89 文件 / 909 用例全过** | `logs/test-v36-stage2.log` |
| 5 | `npm run test:desktop` | 0 | **27 文件 / 191 用例全过** | `logs/test-desktop-v36-stage2.log` |
| 6 | `npm run build` | 0 | vite 生产构建通过（既有 chunk 体积警告） | `logs/build-v36-stage2.log` |

`npm run package:desktop -- --arch=arm64`：退出码 0，真实输出（节选）：

```
{
  "asar": ".../out/寸链-darwin-arm64/寸链.app/Contents/Resources/app.asar",
  "main": ".vite/build/main.cjs",
  "workerNamesInMain": ["pdf.worker.mjs"],
  "worker": { "entry": "/.vite/build/pdf.worker.mjs", "byteSize": 1327591, "unpacked": false }
}
RESULT PASS 打包产物中的 pdf worker 可被 main.cjs 运行时加载
```

完整日志：`logs/package-desktop-v36-stage2.log`。打包走查日志：`logs/e2e-v36-stage2.log`。

跑完上述命令后 `git status --short` 无输出（测试不往仓库写文件；证据日志先落到仓库外再单独提交）。

## 6. 打包应用走查（真实 .app + CDP + open-file）

脚本：`desktop/tests/e2e/v36ui.mjs`；种子：`scripts/v36-seed.ts`（含真实 1110 PDF 的 schema8 项目，
由 `vitest.v36fixture.config.ts` 生成）。应用通过 LaunchServices `open -a` 打开项目，无文件对话框。

状态摘要：`docs/evidence/V3.6/stage2-e2e.json`。实测（节选）：

```
saved:   drafts=1 candidates=7 statuses=[pending,confirmed,pending,pending,rejected,pending,pending]
         decisions=[confirm(local-operator,reason=null), reject(本地操作身份,reason=长度数值需人工核对)]
         target={minQ:1000,maxQ:3000} activeRequirementRevisionId=null parameters=0 bindings=0
idempotent: drafts=1 candidates=7 draftRevision=3 editSeq=3 savedSeq=3
reopened:   drafts=1 candidates=7 statuses 同上 decisions 同上 extractorVersion=document-extractor-1
idempotentAfterReopen: drafts=1 candidates=7 statuses 同上 editSeq=0（未推进）
```

截图（`docs/evidence/V3.6/screenshots/`）：

| 文件 | 内容 |
|---|---|
| `v36-01-extraction-empty.png` | 提取页初始：规则版本、样本限制、不做 OCR/DOCX、确切版本选择 |
| `v36-02-candidates-pending.png` | 1110 `[1,2]` 提取后 7 条候选全部待确认，每条含原文/页/选区/item |
| `v36-03-confirmed-rejected.png` | 顶部计数与操作后的整体状态 |
| `v36-03a-confirmed-row.png` | H 已确认（绿色徽标，按钮禁用） |
| `v36-03b-rejected-row.png` | S 已拒绝（灰色徽标，显示 actor/时间/理由，按钮禁用） |
| `v36-04-locate-pdf-selection.png` | 定位到 PDF 第 1 页，高亮 H 行 `52.20` 选区，摘要显示 PDF 点 |
| `v36-05-idempotent-reextract.png` | 同范围重提：候选 7 条未变化 |
| `v36-06-reopened-state-kept.png` / `06b` | 关闭重开：计数与决定保留 |
| `v36-07-reopened-idempotent.png` | 重开后再提取：仍“未变化、未产生重复候选” |

## 7. M03 变异：把“已拒绝”改成仍可确认

补丁：`docs/evidence/V3.6/mutations/M03-rejected-can-be-confirmed.patch`
（删除 `confirmCandidate` 中的 `CANDIDATE_REJECTED` 门禁）。

- 红（领域）：`npx vitest run src/document-extraction` → **exit 1，1 failed / 43 passed**
  - `拒绝必须写理由；拒绝后不能直接确认复活`（期望 `CANDIDATE_REJECTED`，实际确认成功）
  - 日志：`mutations/logs/M03-red.log`
- 红（main）：`npx vitest run --config vitest.desktop.config.ts desktop/tests/extraction.test.ts`
  → **exit 1，1 failed / 12 passed**
  - `确认一项 + 拒绝一项…`（期望 `EXTRACTION_CANDIDATE_REJECTED`，实际成功）
  - 日志：`mutations/logs/M03-red-desktop.log`
- 恢复：`git checkout -- src/document-extraction/draft.ts`（`git diff` 为空）
- 绿：同一两条命令 → **exit 0，44 passed / 13 passed**
  - 日志：`mutations/logs/M03-green-restored.log`、`M03-green-restored-desktop.log`

## 8. 未做 / 阻塞 / 已知限制（如实列出）

1. **“送入项目草稿/参数/条款”未做**：本阶段只落提取草稿与决定；不自动改 target、不建条款版本、
   不改绑定、不自动提交（按任务卡要求）。`planApplication` 仍是 `applied:false` 的计划。
2. **没有批量确认**：任务卡 §4.2 明确“无默认勾选或全批确认”；批量仅支持拒绝。
3. **扩大页范围语义与任务卡 §6 措辞有偏差**：见第 4 节，每个页范围独立草稿；需用户拍板是否改。
4. **只验证过 1 份自造样例**（TB-2026-1110）与 3 份自造坏样例；真实外部任务书、复杂表格/分栏/
   字体编码、扫描件均未验证；不做 OCR/DOCX/图片/联网识别。
5. **旋转 90/270、非零/负原点、缩放/DPR 的定位**只沿用既有坐标约定与 `page.view`，本阶段打包走查
   只覆盖 rotate 0、原点 0 的 1110；未新增旋转样例。
6. **actor 是本地操作身份**（`local-operator`），不是实名批准；没有用户账号体系。
7. **未保存即退出会丢决定**：决定只进 main 会话/恢复草稿，必须显式保存项目文件才跨重启保留；
   关闭时的 dirty gate 会要求保存。
8. **旧程序不能打开 schema8**，无无损降级；首次保存旧文件前会创建可恢复副本（既有逻辑）。
9. **预算常量**：20000 个 TextItem、20 秒、最多 100 页、200 候选、200 issue（本阶段冻结）；
   复杂大文件可能需要用户缩小页范围。
10. **未运行真实外部包签名/安装验证**；只运行 `package:desktop` 产物与本机 CDP 走查。

## 9. 复现

```bash
cd /Users/aston/DSH/staff
npx vitest run desktop/tests/extraction.test.ts --config vitest.desktop.config.ts
npx vitest run src/project-file/schema8.test.ts
npx vitest run src/components/ExtractionReviewPanel.test.tsx
npm run typecheck && npm run typecheck:desktop && npm run lint
npm test && npm run test:desktop && npm run build
npm run package:desktop -- --arch=arm64

# 打包应用走查（会写 /Users/aston/DSH/tmp/cunlian-v36/）
V36_SEED_OUT=/Users/aston/DSH/tmp/cunlian-v36/E2E-V36.cunlian \
  npx vitest run --config vitest.v36fixture.config.ts
env -u ELECTRON_RUN_AS_NODE node desktop/tests/e2e/v36ui.mjs
```
