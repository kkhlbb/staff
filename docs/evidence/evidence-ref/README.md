# ADR-001 第 2 步：EvidenceRef 泛化（PDF 路径零变化）

一句话：把“来源”从单一 PDF 身份泛化成 `EvidenceRef` 联合类型
（`pdf-text` / `pdf-ocr` / `image-ocr` / `user-attestation`），
**出处完整性仍只有一个闸门**，真实语料上的候选数/候选 ID/`evidenceKey`/幂等键/
失效传播/提交结果与改前**逐份逐项一致**。

| 项 | 值 |
|---|---|
| 分支 | `agent/evidence-ref`（从 `main 8fa7531` 切出；未合并、未推送、未删除） |
| 实现提交 | `ac56746`（领域 + schema 9 + 用例 + 证据脚本）、`382d396`（桌面侧跟进） |
| 证据提交 | 本目录（本文 + JSON 快照 + 日志 + M02/M24 补丁与红绿日志），哈希见 `git log --oneline 8fa7531..HEAD` |
| 提取规则版本 | **不变**：`document-extractor-6`（本步不改抽取规则） |
| 项目文件 schema | `PROJECT_FILE_SCHEMA_VERSION` 8 → **9**（纯加法 `provenance`） |
| IndexedDB 版本 | `PROJECT_DB_VERSION` **仍为 7**（与项目 JSON schema 分开处理，见第六节） |
| 新增用例 | `evidenceRef.test.ts` 22 条 + `schema9.test.ts` 3 条 |
| 真实语料 | 候选 **138 → 138**、pending **58 → 58**、r4 **7 → 7**（逐份表见第四节） |
| 变异 | M02 红（3 failed / 45 passed）→ 恢复绿（48 passed）；M24 红（3 failed / 19 passed）→ 恢复绿（22 passed） |

---

## 一、本步做了什么（只做一件事）

`src/document-extraction/types.ts`：

| 类型 / 函数 | 说明 |
|---|---|
| `PdfTextEvidence` | = 现有 `ExtractionEvidence`，**字段一个不动**；`kind` 可选（旧 evidence 没有该字段，读取方一律按 pdf-text 解释，写出时不加字段） |
| `PdfOcrEvidence` | 扫描件：`revisionId + page + rectPdf + pageBoxPdf + textSnippet + confidence` |
| `ImageOcrEvidence` | 草绘/样品照片：`imageId + sha256 + fileName + rectPdf + recognizedText + confidence` |
| `UserAttestation` | `actorId`（手输）+ `at` + `sessionSeq`（项目内自增）+ `sessionLabel`（备注）+ `statement`（原话）+ `fieldPath`；撤销字段只追加。**无 UUID**（ADR §11） |
| `EvidenceRef` | 四支联合 |
| `isProvenanceCompleteness(ref)` | **唯一闸门**。`pdf-text` 分支就是改前 `isEvidenceComplete` 的函数体（同字段检查、同 `1e-6` 容差、缺项 false）；其它三支各按自己的锚点判完整 |
| `isEvidenceComplete` | 保留为**别名**（`return isProvenanceCompleteness(evidence)`），不是第二份实现；旧调用方/旧用例不动 |
| `evidenceKey` | 参数类型放宽到“文本锚点四要素”，**输出字符串逐字节不变** |
| `provenanceKey` | 按 kind 生成；`pdf-text` 直接 `return evidenceKey(ref)`（不重写格式），其它 kind 追加种类后缀防碰撞 |
| `uniqueProvenance` / `uniqueEvidence` | 去重唯一实现是 `uniqueProvenance`；`uniqueEvidence` 是 pdf 分支的类型包装 |
| `provenanceValidity(ref, state)` | I3：pdf-* 看 revision `sha256`、image-ocr 看图片 `sha256`、attestation 只有 `revoked` |
| `revokeAttestation` | 只追加 `revokedBy/revokedAt/revokedStatement`，不删出处、不改原话 |
| `valueProvenance` / `candidateProvenance` / `decisionProvenance` | 唯一映射入口：有显式 `provenance` 用它，旧数据缺省时把 `evidence` 逐条解释为 pdf-text（显式空数组**不会**回退） |

其它文件：

| 文件 | 改动 |
|---|---|
| `parse.ts` | `buildQuantity`/候选/公式/区间/部件的 `provenance` 与 `evidence` 同源写入；闸门调用改名为 `isProvenanceCompleteness`；候选 ID 的构成**未改**（不含 provenance） |
| `draft.ts` | `evidenceMissing` → `provenanceMissing`（存在 + 完整，同一判据）；确认/拒绝/撤销/编辑写入 `provenance`；`planApplication` 见第三节 |
| `index.ts` | 导出新类型/新函数 |
| `project-file/types.ts` | `PROJECT_FILE_SCHEMA_VERSION=9`、`V36_PROJECT_FILE_SCHEMA_VERSION=8`、`ProjectFileProjectV8`、版本联合与 manifest 版本枚举 |
| `project-file/validation.ts` | 出处联合 zod schema（四支）；数值/候选/决定接受可选 `provenance`；schema 8 与 schema 9 分开解析；`adaptProjectV8` 补出处；草稿引用校验走 `isProvenanceCompleteness` |
| `project-file/codec.ts` | manifest 接受 schema 8（读）与 9（写） |
| `project-file/upgrade.ts` | 升级说明与版本记录原因改为 schema 9 |
| `desktop/main/extractionService.ts` | 新错误码映射到现有 IPC 码（**不新增契约码**，见第十章） |
| `scripts/real-docs/metrics.mjs` | 只改页范围探针的触发条件（见第七节） |
| `scripts/evidence-ref-candidates.mjs` | 新增证据探针：逐份导出 draftId/幂等键/候选 ID/evidenceKey/候选数组哈希 |
| `scripts/evidence-ref-mutations.mjs` | M02/M24 变异驱动（apply/revert 用同一组文本替换，可逆） |
| `scripts/evidence-ref-record.mjs` | 由产物生成 `evidence-ref.json`（`serializeEvidence` + `evidenceViolations` 自检） |
| `scripts/evidence-ref-gate-identity.mjs` | 改前/改后 pdf 校验函数体逐行比对（I1 证据） |

**本步不建 UI、不新增工具**：`createProject`/`setChain`/`setRequirement`/`setBinding` 未做；
`user-attestation` 只作为类型、校验与用例存在，没有进入任何真实产品流程。

---

## 二、四条不变量怎么落地

**I1　闸门不搬家**
`isProvenanceCompleteness` 是唯一实现：`parse.buildQuantity`、`draft.provenanceMissing`、
`buildEditedQuantity`、`project-file.validateExtractionDraftReferences` 全部调用它。
`pdf-text` 分支保留改前的逐条检查（documentId/revisionId/sha256/blobKey 非空、
page 安全整数 ≥1、textSnippet 非空、textItemIndexes 非负安全整数、rect/box 4 个有限数、
正面积、包含容差 `1e-6`）。逐行等价不是口头声明：`scripts/evidence-ref-gate-identity.mjs`
把 `8fa7531` 的 `isEvidenceComplete` 函数体与当前 `pdf-text` 分支归一后逐行比对，
两侧都是 27 行、无差异（`logs/17-gate-identity.log` → `IDENTICAL_AFTER_NORMALIZATION`）。
M02 仍红（第五节）。

**I2　出处非空**
每个数值/公式候选的 `provenance` 至少一条；`[]` 等同非法。
两条用例：`evidenceRef.test.ts`（显式空 provenance 即使 evidence 仍满也拒绝确认）、
`project-file/validation.ts`（项目文件里数值出处为空/不完整 → `INVALID_RECORD`）。

**I3　失效按 kind 分开**
`provenanceValidity` 只用 `ProvenanceSourceState` 判定：pdf-text/pdf-ocr → 该 revision 的
`sha256` 比对；image-ocr → 图片 `sha256`；user-attestation **不因文件变化 stale**，
只有 `revokedAt` 非空时返回 `revoked`（与 `stale` 分开报）。用例覆盖三者 + 撤销留痕。

**I5　PDF 路径零变化**
见第四节：候选身份探针改前/改后 **JSON 逐字节一致**（`cmp` 通过），真实语料基线
`BASELINE MATCH`。`planApplication` 对 pdf 的第一道检查（request.source 与
draft.sourceIdentity 的 revisionId+sha256）**代码与文案原样保留**，随后对每条 pdf 出处
再逐条比对（同 revisionId+sha256）；未确认/决定代数/数值快照/同符号互斥检查未动。

---

## 三、`planApplication` 的改动（ADR §4）

```
改前：request.source 与 draft.sourceIdentity 不一致 → SOURCE_STALE
      每个数值字段 evidence 非空且每条 isEvidenceComplete
      公式候选同理

改后：1) 同一条 request.source 比对（同一错误码与文案，代码原样）
      2) 每个数值字段 provenance 非空，且每条过 isProvenanceCompleteness
      3) 逐条有效性：pdf-* → revisionId+sha256 与草稿来源一致（否则 SOURCE_STALE）
                     image-ocr → request.images 里的图片 sha256 一致（否则 SOURCE_STALE）
                     user-attestation → 已撤销 PROVENANCE_REVOKED；
                                        actorId/sessionSeq 与 request.session 不一致
                                        → ATTESTATION_SESSION_MISMATCH
      4) 计划项携带 provenance（数值出处 + 公式候选级出处，按 kind 去重）
```

判据严格度不变：仍是同一套状态/决定代数/数值快照/同符号互斥的检查，`applied: false`。

---

## 四、I5 逐份度量对照（真实语料）

命令（两侧相同）：

```bash
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs node scripts/real-doc-metrics.mjs
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs \
  node scripts/evidence-ref-candidates.mjs --out <before|after>.json
```

改前日志 `logs/01-metrics-before.log`，改后 `logs/05-metrics-after.log` / `logs/08-metrics-after-baseline.log`。

| 文档 | 页数 | 候选（前→后） | pending（前→后） | blocked（前→后） | 候选数组 SHA-256（前 = 后） |
|---|---|---|---|---|---|
| r1 | 74 | 15 → 15 | 4 → 4 | 11 → 11 | `2f00d767…0b0df7` |
| r2 | 5 | 22 → 22 | 7 → 7 | 15 → 15 | `7ca45c3d…7641c0` |
| r3 | 4 | 3 → 3 | 0 → 0 | 3 → 3 | `b0d4c916…af18e` |
| r4 | 170 | 7 → 7 | 1 → 1 | 6 → 6 | `98abced2…622587` |
| r5 | 8 | 4 → 4 | 2 → 2 | 2 → 2 | `eecbbff0…45588` |
| r6 | 8 | 87 → 87 | 44 → 44 | 43 → 43 | `2eef7127…86c6` |
| **合计** | 269 | **138 → 138** | **58 → 58** | 80 → 80 | 6/6 全等 |

“候选数组 SHA-256”覆盖：`candidateId`、kind、groupId、page、status、reasonCodes、
候选级 evidenceKey、每个数值字段的 evidenceKey。逐份 draftId 与幂等键也一致
（见 `evidence-ref.json` 的 `draftId.before/after`、`idempotencyKey.before/after`）。

产物：

- `real-docs-candidates-before.json` / `real-docs-candidates-after.json`：两侧 `cmp` **逐字节相同**
- `evidence-ref.json`：由脚本从上述产物生成（`serializeEvidence`，`evidenceViolations` 为空）
- `docs/evidence/real-doc-baseline/{metrics,baseline}.json`：唯一变化是恢复的探针（第七节）

日志里的逐份明细（阻塞原因码、问题码、无文本层页）两侧一致；汇总同样是
「6 份 / 269 页 / 候选 138（pending 58｜blocked 80｜confirmed 0）」。

---

## 五、变异：M02 仍红，新增 M24 红 → 绿

补丁与日志在 `mutations/`。恢复均用同一组替换反向执行，恢复后 `git status --short` 为空。

### M02（“必须有出处 → 可空”）

改前的补丁因 `parse.ts` 经过切块重构已无法直接套用，所以先**在基线上按同一语义复跑**：
`mutations/M02-before-baseline.patch`（parse 不再拦缺出处 + draft `evidenceMissing` 恒 null）。

| 阶段 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 基线复跑（红） | `npx vitest run .../badSamples.test.ts .../confirmation.test.ts` | exit 1，**2 failed / 24 passed** | `mutations/M02-before-red.log` |
| 基线恢复（绿） | 同上 | exit 0，26 passed | `mutations/M02-before-green.log` |
| 改后（红） | 同上 + `.../evidenceRef.test.ts` | exit 1，**3 failed / 45 passed** | `mutations/M02-red.log` |
| 改后恢复（绿） | 同上 | exit 0，**48 passed** | `mutations/M02-green-restored.log` |

改后红的三条：`页面边界框无效 → 数值不进候选`、`M02：有数值但出处为空 → 不能确认`、
`evidence 仍在但 provenance 显式为 [] → 不能确认`。说明变异打掉的正是“出处闸门”，
不是把所有用例一起打红。补丁：`mutations/M02-provenance-optional.patch`。

### M24（把 user-attestation 当成“总是有效”）

补丁：`mutations/M24-attestation-always-valid.patch`（`attestationMatchesSession` 直接
`return true`，跳过 actorId/sessionSeq 与当前会话的一致性校验）。

| 状态 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 变异 | `npx vitest run src/document-extraction/__tests__/evidenceRef.test.ts` | exit 1，**3 failed / 19 passed** | `mutations/M24-red.log` |
| 恢复 | 同上 | exit 0，**22 passed** | `mutations/M24-green-restored.log` |

红的正是三条跨会话用例：`actorId 不同`、`sessionSeq 不同`、`完全没有会话信息`；
同会话与已撤销两条仍绿——变异只打掉“会话一致性”，不是把 attestation 逻辑全打死。

---

## 六、schema 8 → 9 与版本边界

- `PROJECT_FILE_SCHEMA_VERSION` 8 → **9**：只给提取草稿的数值/候选/决定新增可选
  `provenance`；尺寸链、参数、条款、图纸、容器布局一律未动（`formatVersion` 仍 2）。
- `PROJECT_DB_VERSION` **保持 7**：IndexedDB 的 store 结构没变，升它没有意义；
  仓库既有约定就是“项目 JSON schema”与“数据库版本”分开（见 `src/storage/db.ts` 顶部注释）。
- `PROJECT_SCHEMA_VERSION`（内嵌尺寸链 JSON，=2）**未动**。
- **旧 schema8 读入**：`parseProjectVersioned` 返回 version 6 → `adaptProjectV8`
  按每个数值原有的 `evidence` 逐条补 pdf-text 出处，候选级/决定级同理；
  **不重算、不改值**，候选 ID/幂等键/数值/快照判据全部原样。保存时才写 9，
  旧历史 Revision 记录仍保留其原 schema（不可变历史）。
- 用例 `schema9.test.ts`：
  1. schema9 往返逐字段保留，候选 ID 列表与出处 key 不变，`calculateChain` 结果一致；
  2. 把容器降级成 schema8（删掉全部 `provenance`）再读入：补出的出处与 evidence 同序同 key；
     候选 ID、幂等键、页范围、决定、尺寸链、目标区间、`calculateChain` 全等；重写后 manifest 为 9；
  3. 带 `user-attestation` 出处的草稿可编码/解码往返（类型 + 严格校验通过）。
- `schema8.test.ts` 的“旧 schema7 缺 extractionDrafts”等兼容用例继续通过；
  “schema9 明确拒绝”改为“schema10 明确拒绝”。

---

## 七、顺手修一处：`pageRangeProbe` 为什么变空、怎么恢复

**查清的是“被跳过”，不是脚本没了。**

`scripts/real-docs/metrics.mjs` 原来的探针触发条件是“该文档出现 `PAGE_LIMIT`”：

```js
if (measured.row.pageLimit === null) continue
```

L1-a 切块（`document-extractor-6`）之后，r4 不再产生 `PAGE_LIMIT`，于是这一行永远跳过，
`summary.pageRangeProbe` 从 1 条变 0 条。`docs/evidence/extract-chunking/README.md` 第六节
当时把这件事记为“口径变化”，没有改脚本。

**只动证据脚本**：把触发条件改成“页跨度超过上限、确实会被切块的文档”
（当前只有 r4，170 页 > 100），探针本身（前 20 页单独扫一次）一行没改：

```js
if (measured.pages <= modules.MAX_EXTRACTION_PAGES) continue
```

恢复后的探针数值与 v1 基线记录（`docs/evidence/real-doc-baseline/history/v1-c52ac9f-metrics.json`）
**逐字段一致**：`r4@1-20`，候选 1（pending 0 / blocked 1 / ring×1），
`UNKNOWN_UNIT×1`，问题 3（`NO_TEXT_LAYER×3`），无文本层页 `1,2,6`。

基线更新：`logs/07-update-baseline.log` 记录 **1 处变化**（`summary.pageRangeProbe[0]`：
`undefined → {r4@1-20…}`），原因写在命令行里；更新后不带参数再跑 → `BASELINE MATCH`
（`logs/08-metrics-after-baseline.log`）。

---

## 八、全量回归与打包（改后）

| # | 命令 | exit | 结果 | 日志 |
|---|---|---|---|---|
| 1 | `npm run typecheck` | 0 | 无诊断 | `logs/10-typecheck.log` |
| 2 | `npm run typecheck:desktop` | 0 | 无诊断 | `logs/11-typecheck-desktop.log` |
| 3 | `npm run lint` | 0 | `eslint .` 无输出 | `logs/09-lint.log` |
| 4 | `npm test` | 0 | **105 文件 / 1135 用例全过** | `logs/12-test.log` |
| 5 | `npm run test:desktop` | 0 | **39 文件通过 + 1 跳过（40）；278 通过 + 14 跳过（292）** | `logs/13-test-desktop.log` |
| 6 | `npm run build` | 0 | `✓ built in 220ms`（既有 chunk >500 kB 警告） | `logs/14-build.log` |
| 7 | `npm run package:desktop -- --arch=arm64` | 0 | 末尾 `RESULT PASS 打包产物中的 pdf worker 可被 main.cjs 运行时加载`；asar 内 `pdf.worker.mjs` sha256 `b4c8353ded0d88d2e2009574a29eb4e0c3ff7e942ecdf51ef5f71566a9667f31` | `logs/15-package-desktop.log` |
| 8 | `npm run check:package:pdf-worker` | 0 | `RESULT PASS`（同上 sha256） | `logs/16-check-package-pdf-worker.log` |

改动规模：改前基线 `npm test` 为 103 文件 / 1108 用例（`logs/03-test-before.log`）；改后
105 文件 / **1135** 用例。新增**声明**用例 25 条（1251 → 1276：`evidenceRef.test.ts` 22 +
`schema9.test.ts` 3）；运行时总数还受既有「证据守卫」影响——`src/test/evidenceRepro.test.ts`
对 `docs/evidence/**/*.json` 逐文件展开一条 STAGE 2 用例，本步新增 3 个证据 JSON
（`docs/evidence` 下 JSON 57 → 60），因此实际运行条数比“声明增加数”多。

**一次全量偶发红，如实记**：`logs/12-test-flake-run.log` 是同一命令的一次运行，
`src/workspace/useAutoPreview.test.tsx > 快速连续输入：只接受最后序号的草稿/预览`
报 `expected "vi.fn()" to be called 2 times, but got 1`（1 failed / 1134 passed），
单独重跑该文件 3/3 全过；紧接着的同环境全量重跑全绿（`logs/12-test.log`）。
按仓库既有结论（`docs/evidence/flake-fix/README.md`：负载相关超时/时序 flake）
判断为既有 flake，**本步未修它**，也没有把它记作通过。若要求“零 flake”，需要另行立卡。

`git status --short` 在提交后为空（见交付消息里的输出）。

---

## 九、复现

```bash
git switch agent/evidence-ref

# 真实语料度量（需 6 份文档在 REAL_DOC_CORPUS）
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs node scripts/real-doc-metrics.mjs
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs \
  node scripts/evidence-ref-candidates.mjs --out /tmp/candidates.json
cmp /tmp/candidates.json docs/evidence/evidence-ref/real-docs-candidates-after.json

# 变异
node scripts/evidence-ref-mutations.mjs m02 apply
npx vitest run src/document-extraction/__tests__/{badSamples,confirmation,evidenceRef}.test.ts  # 预期 3 failed
node scripts/evidence-ref-mutations.mjs m02 revert
node scripts/evidence-ref-mutations.mjs m24 apply
npx vitest run src/document-extraction/__tests__/evidenceRef.test.ts                          # 预期 3 failed
node scripts/evidence-ref-mutations.mjs m24 revert

# 证据摘要（只在刷新时运行）
node scripts/evidence-ref-record.mjs

# I1 逐行等价（pdf-text 分支 vs 基线 8fa7531）
node scripts/evidence-ref-gate-identity.mjs
```

---

## 十、未做 / 已知限制（如实）

1. **`provenance` 尚未落到参数/组成环记录**：`mapConfirmed` 仍只把出处写进
   `sourceNote`/计划项；`ProjectFileSpacerParameter` 与 `DimensionTerm` 没有 provenance
   字段（后者要改内嵌尺寸链 schema=2，本步明确不动）。I2 目前落在**应用计划**这一道门
   与提取草稿的持久化上；参数记录级 provenance 留到下一步接 `createProject`/`setChain`。
2. **attestation 不进入产品流程**：没有 UI、没有工具、没有 IPC 契约码；
   `ATTESTATION_SESSION_MISMATCH` / `PROVENANCE_REVOKED` 在 main 侧映射到现有
   `EXTRACTION_EVIDENCE_REQUIRED`，属于临时口径（注释已写明）。
3. **图片存储未接**：`image-ocr` 的类型/校验/失效判定有，项目文件里只有出处对象；
   没有图片来源库，因此项目文件校验对 image-ocr 只查完整性，不查图片是否存在（代码已注明）。
   同理 `pdf-ocr` 的 OCR 引擎、置信度展示与“<0.9 强制人工誊写”是下一步 UI 的事；
   本步只保证出处里必须带 `confidence`。
4. **`evidence` 与 `provenance` 双写**：解析器两处同源写入；`provenance` 为权威集合，
   缺省时才回退到 `evidence`（读旧数据）。这意味着“只把 evidence 清空、故意保留 provenance”
   的手改草稿不再被判空——真实链路不会产生这种状态；`confirmation.test.ts` 的 M02 用例
   因此改为同时清空两者，并新增一条“显式空 provenance 仍拒绝”的用例。这是新增权威字段
   带来的语义边界，不是放宽校验。
5. **schema 8 记录若自带 `provenance` 也会被接受**（zod 里该字段可空）。写端只写 9，
   不影响任何判据；若要“旧 schema 一律拒绝新字段”，需要为 v8/v9 各维护一套嵌套 schema，
   本步判断收益不足，故按纯加法处理。
6. **`pageRangeProbe` 只对“会被切块”的文档触发**（当前仅 r4）。若将来语料里出现
   第二份 >100 页文档，会多一条探针记录，届时需要显式更新基线并说明。
7. 未做：无来源项目建项/提交/出图/导出四处标记（ADR §6）、`-userinput` 后缀、
   DXF/SVG/PDF 导出出处清单——都属于后续任务卡。
