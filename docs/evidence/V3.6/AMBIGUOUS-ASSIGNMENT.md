# V3.6 体验修订：AMBIGUOUS_ASSIGNMENT 改为「同一符号多处赋值 → 逐处候选」

状态：实现、领域/界面/桌面测试、真实文档回归、M04 变异、打包应用走查均完成。
按指令**未自开分支、未建工作树、未 merge/push/delete**，改在 `main` 工作树。

- 仓库：`/Users/aston/DSH/staff`，分支 `main`
- 基线：`c52ac9f`（v3.6.0-alpha 已发布，工作区干净）
- 未动：domain 公式、q 精度、schema 8 版本号与既有判据、V3.5/V3.6 已通过数值断言
- 规则版本：`document-extractor-1` → `document-extractor-2`
  （规则语义变化必须升版本，否则旧草稿幂等键会把新旧候选合并；见 §7 已知影响）

## 1. 改法（与任务卡逐条对应）

| # | 要求 | 实现位置 | 结果 |
|---|---|---|---|
| 1 | 同符号多处不同赋值 → 该 group 每条取值一条候选，各自带出处 | `src/document-extraction/parse.ts` `resolveRings` | 按 `quantityKey`（值/单位/原文写法）分桶，每桶一条候选；出处只取本桶条目（页/rectPdf/pageBoxPdf/原文片段/item 索引） |
| 2 | 状态待确认（不是 blocked），UI 与数据标明「第 k/N 处」与「同一符号只能确认一处」 | `types.ts` `ExtractionOccurrence`（候选 `occurrence` 字段）+ `ExtractionReviewPanel.tsx` | 候选 `status='pending'`、`occurrence={index,total}`；面板显示徽标「同一符号第 k/N 处」+ 互斥提示 |
| 3 | 互斥：确认一条后其余不可确认；不允许同 group 两条已确认 | `draft.ts` `confirmCandidate` + 新增 `revokeConfirmation` | 第二条确认返回 `GROUP_ALREADY_CONFIRMED`（IPC 映射 `EXTRACTION_GROUP_CONFLICT`）；UI 置灰并提示先撤销；撤销后恢复可选；`planApplication` 再兜底拒绝同组合计两条 |
| 4 | 值相同的多处合并成一条 | `parse.ts` 分桶（既有 `quantityKey`/`mergeQuantity`） | 3 处 `0.500 mm` → 1 条候选，`nominal.evidence` 保留 3 处不同选区 |
| 5 | 有的能解析、有的解析不了 → 好的出行，坏处单独 issue | `parse.ts` `nominalUsable` + issue 分支 | 缺单位那一处 → 1 条 `UNKNOWN_UNIT` issue（blocked 严重度、`candidateIds=[]`），其余处照常出候选 |
| 6 | 不猜、不合并不同值的出处 | 同上 | 不同值各自一条候选；测试断言每条候选片段不含其它处数值 |

### 1.1 数据契约变化（同提交补假 mock）

- `ExtractionCandidate.occurrence?: { index, total } | null`：仅多值符号写入（total>1），
  单值/旧草稿为 null/缺省。schema8 校验中为**可选**字段，旧项目文件仍可读。
- `ExtractionDecision.action` 增加 `'revoke'`（撤销留痕，不删除历史）。
- `ExtractionErrorCode` 增加 `GROUP_ALREADY_CONFIRMED`；IPC `IpcErrorCode` 增加
  `EXTRACTION_GROUP_CONFLICT`；`extractionSchemas.decide.action` 允许 `revoke`。
- `src/pages/DesktopWorkspace.test.tsx` 的 `decideExtraction` 假 mock 同提交更新（回显 action）。

## 2. 样例 PDF（真实文本层，非手写候选）

生成器：`scripts/make-ambiguous-sample.cjs`（Electron `printToPDF`）
产物：`src/document-extraction/__fixtures__/ambiguous-assignment.pdf`（98,573 字节，2 页）

| 符号 | 原文 | 期望 |
|---|---|---|
| A0 | `A0 = 0.100 mm` / `0.200 mm` / `0.150 mm` | 3 条候选，待确认，第 1/3、2/3、3/3 处 |
| B0 | `B0 = 0.500 mm` ×3 | 1 条候选（合并，出处 3 处） |
| C0 | `C0 = 0.300 mm` / `0.400 mm` / `0.350`（缺单位） | 2 条候选 + 1 条 `UNKNOWN_UNIT` issue |

## 3. 测试（新增/更新）

`src/document-extraction/__tests__/ambiguousAssignment.test.ts`（8 条，走真实 PDF → `readPdfTextPages` → `buildPdfTextLayer` → `buildExtractionDraft`）：

1. A0 三处不同值 → 3 条 pending、`reasonCodes` 为空、`occurrence` = 1/3、2/3、3/3
2. 每条候选只带本处出处（矩形互不相同、片段含本处数值且不含其它两处）
3. `AMBIGUOUS_ASSIGNMENT` 降为 warning，`candidateIds` 3 条；无任何 blocked 候选
4. B0 三处同值 → 1 条候选、`occurrence=null`、`nominal.evidence` 3 处不同矩形
5. C0 一处缺单位 → 2 条候选 + 1 条 `UNKNOWN_UNIT` issue（第 2 页、未进入候选）
6. 确认第 1 处后：第 2/3 处确认返回 `GROUP_ALREADY_CONFIRMED`；同组仅 1 条 confirmed；
   其它符号（B0）不受影响；撤销后第 2 处可确认
7. `planApplication` 只接受一条；手工把第二条改成 confirmed 后计划被拒
8. 撤销未确认候选 → `NOT_CONFIRMED`；确认→撤销→再确认可行；重复确认幂等不新增决定

更新：
- `badSamples.test.ts`：同符号两值用例由「两条 blocked」改为「两条 pending + 第 k/2 处 + warning」，
  仍断言不按先后择优（两条都在、文本为 50.00/52.20）。
- `ExtractionReviewPanel.test.tsx`：+2 条（第 k/N 徽标/提示/置灰、撤销发出 action=revoke）。

## 4. 真实文档回归（r2，改前 → 改后）

探针（临时脚本，跑完删除）：pdfjs `getTextContent` → `buildPdfTextLayer` → `buildExtractionDraft`，
页范围 1..N，来源哈希即文件 SHA-256。原始数字：

- 改前：`docs/evidence/V3.6/real-docs-r2-before.json`
- 改后：`docs/evidence/V3.6/real-docs-r2-after.json`

| 文档 | 指标 | 改前 | 改后 |
|---|---|---:|---:|
| r2-tolerance-domain.pdf（5 页，sha256 c20d6b52…） | 候选 | 25 | **20** |
| 同上 | 阻塞 | 23 | **15** |
| 同上 | 待确认 | 2 | **5** |
| 同上 | 带 occurrence 的候选 | 0 | 4（2 个多值符号 × 2 处） |
| 同上 | 原因码 | AMBIGUOUS_ASSIGNMENT 12、UNKNOWN_UNIT 11、FORMULA_UNSUPPORTED 9 | UNKNOWN_UNIT 6、FORMULA_UNSUPPORTED 9（**AMBIGUOUS_ASSIGNMENT 0**） |
| 同上 | issue | AMBIGUOUS_ASSIGNMENT 5 | AMBIGUOUS_ASSIGNMENT 2（warning）、UNKNOWN_UNIT 5 |
| r6-segments-assembly.pdf（8 页，sha256 fbe5db55…） | 候选 | 98 | **80** |
| 同上 | 阻塞 | 96 | **65** |
| 同上 | 待确认 | 2 | **15** |
| 同上 | 带 occurrence 的候选 | 0 | 36 |
| 同上 | issue | AMBIGUOUS_ASSIGNMENT 16 | AMBIGUOUS_ASSIGNMENT 11（warning）、UNKNOWN_UNIT 29 |

说明（不粉饰）：
- 候选总数下降是因为规则 5：同一符号里**解析不了的那一处**不再硬造 blocked 候选，改为
  issue（r2 的 UNKNOWN_UNIT：改前 11 条候选原因，改后 6 条候选 + 5 条 issue）。
- 阻塞仍高的主因变成 `UNKNOWN_UNIT` 与 `FORMULA_UNSUPPORTED`：真实文献大量公式行不支持，
  且缺单位处按规则只能给 issue——这不是本次改动引入的退化，改动前这些候选也是阻塞。
- 确认可用性：r2 待确认从 2 → 5，r6 从 2 → 15；原先被 `AMBIGUOUS_ASSIGNMENT` 一票阻塞的
  多值符号现在每处都可单独核对。

## 5. M04 变异：去掉 group 互斥约束

- 补丁：`docs/evidence/V3.6/mutations/M04-remove-group-mutex.patch`
  （删除 `confirmCandidate` 中 ring group 冲突检查）
- 红：`npx vitest run src/document-extraction/__tests__/ambiguousAssignment.test.ts`
  → **exit 1，1 failed / 7 passed**
  - 失败用例：`确认第 1 条后第 2、3 条不能确认；撤销后恢复可选`
  - 断言：`expected true to be false`（第二条确认本应被拒，实际成功）
  - 日志：`docs/evidence/V3.6/mutations/logs/M04-red.log`
- 绿（恢复）：同一命令 → **exit 0，8 passed**
  - 日志：`docs/evidence/V3.6/mutations/logs/M04-green-restored.log`

## 6. 打包应用走查（真实 .app + CDP + open-file）

- 种子：`scripts/v36-ambiguous-seed.ts`（真实 PDF → 真实提取器 → schema8 项目文件）
  `V36_AMB_SEED_OUT=/Users/aston/DSH/tmp/cunlian-v36/AMB-V36.cunlian npx vitest run --config vitest.v36fixture.config.ts`
- 走查脚本：`desktop/tests/e2e/v36ambiguous.mjs`
  （`open -a` 打开项目 → 提取页 → 截图 → 确认第 1 处 → 断言第 2/3 处置灰
  → 直连 IPC 再确认第 2 处必须 `EXTRACTION_GROUP_CONFLICT` → 撤销 → 保存 → 重读决定）
- 摘要：`docs/evidence/V3.6/ambiguous-e2e.json`；日志：`docs/evidence/V3.6/logs/ambiguous-e2e.log`

实测（原文摘要）：

```
initial        6 条候选：A0 第 1/3、2/3、3/3 + B0（无徽标）+ C0 第 1/2、2/2
afterConfirm   A0#1 confirmed（撤销确认按钮出现）；A0#2/#3 status=pending
               confirmDisabled=true
               title="同一符号已确认第 1 处；同一符号只能确认一处，请先撤销该确认"
               hint="同一符号只能确认一处；已确认第 1/3 处，需先撤销该确认才能选此处。"
ipcAttempt     {"ok":false,"code":"EXTRACTION_GROUP_CONFLICT",
                "message":"同一符号 A0 已确认第 1/3 处（候选 ring-18c7346a248d1a54）；同一符号只能确认一处，请先撤销该确认"}
afterRevoke    A0 三处全部 pending、确认按钮全部可用
persisted      savedSeq=2 statuses 全 pending
               decisions=[confirm(invalidated=0), revoke(invalidated=null)]
               occurrences=[1/3,2/3,3/3,1/2,2/2]
RESULT         mutexUi=true ipc=true revoke=true persisted=true
```

截图（`docs/evidence/V3.6/screenshots/`）：
- `v36-11-ambiguous-candidates.png`：6 条候选，A0 第 1/3、2/3、3/3 处，各自页/选区/片段/item；
  顶部 issue 两条 `AMBIGUOUS_ASSIGNMENT`（warning）与一条 `UNKNOWN_UNIT`
- `v36-11b-group-mutex.png`：第 1 处已确认（含「撤销确认」），第 2 处确认置灰并提示先撤销
- `v36-11c-after-revoke.png`：撤销后三处均回待确认、按钮恢复可用

## 7. 六条命令真实输出（最终态）

```
$ npm test
 Test Files  91 passed (91)
      Tests  927 passed (927)

$ npm run test:desktop
 Test Files  27 passed (27)
      Tests  192 passed (192)

$ npm run typecheck
> tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.node.json --noEmit
（无输出，exit 0）

$ npm run typecheck:desktop
> tsc -p tsconfig.desktop.json --noEmit
（无输出，exit 0）

$ npm run lint
> eslint .
（无输出，exit 0）

$ npm run package:desktop -- --arch=arm64
...
RESULT PASS 打包产物中的 pdf worker 可被 main.cjs 运行时加载
```

完整日志：`docs/evidence/V3.6/logs/ambiguous-*.log`。

## 8. 已知影响 / 未做项

1. **规则版本升到 2**：项目里已存在的 `document-extractor-1` 草稿不会自动重算，
   需用户主动重提（`mergeExtractionDraft` 会以 `EXTRACTOR_VERSION_MISMATCH` 拒绝混并）。
   这是规则语义变化后的预期行为，未做自动迁移。
2. **同值不同写法不合并**：`0.20 mm` 与 `0.200 mm` 数值相同但原文写法不同，目前仍是两条候选
   （不猜该显示哪个原文）。本次只合并「值 + 单位 + 原文写法」完全相同的多处。
3. **公式操作数遇到多值符号仍阻塞**：`ringQuantity` 要求符号唯一，多个候选时公式
   保持 `FORMULA_UNRESOLVED_OPERAND` / `FORMULA_UNSUPPORTED`（真实文档仍以这两类阻塞为主）。
   本次未改公式解析。
4. **r6 的 UNKNOWN_UNIT 仍多**：真实论文大量数值无单位或单位在图表外，按「不猜」原则只能给 issue。
   要提升可用性需要后续做「单位从表头/上下文继承」的显式规则，不在本次范围。
5. **未做撤销的 UI 二次确认**：点击「撤销确认」立即执行（有决定留痕、可再确认），
   未加确认对话框；若需要可后续补。
6. 未测：r1/r3/r4/r5 未纳入本次回归（任务只要求 r2）；未做 Windows 打包走查。
