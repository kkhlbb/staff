# V3.6 多草稿（1+3 方案）：默认最新规则版本 + 旧草稿只读折叠 / 显式删除

状态：**实现、自动化测试（六条命令全绿）、变异 M05（红 → 恢复绿）、打包应用走查（6 张截图 + JSON 摘要）
均已完成。未合并、未推送、未删除任何分支/工作树；未新建分支（按用户指令在 `main` 上工作）。**

- 仓库：`/Users/aston/DSH/staff`，分支 `main`，基线 `8d68f2b`（工作区干净）
- 现场复现（seed，见 `scripts/v36-drafts-seed.ts`）：同一 PDF（`sr-1`，1110 两页任务书）+ 同一页范围 `[1,2]`
  - 旧草稿 `draft-d01a5f1315a6b269` · `document-extractor-1` · 7 条候选（已确认 1）
  - 新草稿 `draft-d11a60a683e35328` · `document-extractor-2` · 7 条候选（全部待确认）

## 1. 方案 1：默认显示最新规则版本的草稿

规则落在纯函数模块 `src/document-extraction/draftScope.ts`（UI 与 main 共用，避免界面说旧、
写入口按新处理的两套判断）：

- 作用域 = `documentId + revisionId + 页范围`。只有同一作用域内的草稿才比较新旧；
  不同页范围各自独立，不互相取代（扩大页范围仍会新增草稿，旧草稿原样保留）。
- 当前草稿 = 作用域内 `extractorVersion` 最高者；版本号取末尾整数比较（`v10 > v9`），
  解析不出数字时按字符串比较（确定性，不猜）。
- 同版本取数组中较后的一份（提取追加顺序即创建顺序）。同版本重复草稿都算“当前”，
  不会被冒充成旧规则行；也因此不能删除（见 §2 的“存在严格更高版本”判据）。
- 提取页顶部新增 `当前显示：document-extractor-2 · 草稿 draft-… · 第 1–2 页`（`data-testid="extraction-current-draft"`），
  同一行给出“该范围另有 N 份旧草稿已折叠，只读”。候选列表、计数行、批量操作都来自当前草稿。
- 旧草稿折叠成一行：`旧规则版本（document-extractor-1）· 共 7 条候选（已确认 1）· 已被 v2 取代`
  （无已确认决定时不显示括号；同版本重复草稿显示“同版本重复草稿（…）· … · 未删除，仅供对照”）。
- 展开旧草稿后，候选的取值/原文/页/选区/出处/决定历史都可看；**确认、撤销确认、拒绝、编辑、
  批量选择一律禁用**，并逐行写明原因：
  `旧规则版本，请在新版（document-extractor-2）上复核后确认：此处只读，确认/编辑/拒绝均不可用。`
  只有「定位到 PDF 选区」可用（取旧草稿自己的证据）。
- main 侧同样的门禁：`extraction:decide` 对“被取代”的草稿一律返回
  `EXTRACTION_DRAFT_SUPERSEDED`，伪造请求也不能在旧草稿上确认。
- 入口未决角标：`countPendingExtractionCandidates` 现在只统计“当前草稿”
  （被取代的旧草稿不计入）。理由：旧草稿已折叠只读，把它的未决候选算进角标会让用户点进去
  只看到折叠行、数字却对不上；角标与提取页计数行从此始终一致。

## 2. 方案 3：旧草稿可显式删除（不自动删）

- 只有折叠行提供「删除该旧草稿…」；点击后出现二次确认框（`aria-label="删除旧草稿确认"`）：
  - 有已确认决定：`该草稿有 N 条已确认决定，删除后不可恢复；`
  - 无已确认决定：`该草稿无已确认决定；`
  - 两句之后固定追加：`只删除该草稿的候选与决定，来源 PDF、条款、绑定与图纸不受影响。`
  - 按钮为「确认删除」「取消」，未确认前不发任何请求。
- **最新草稿不许删**（两选一里选这个，理由）：删除最新草稿等于删掉唯一可用结果，
  而且角标/候选列表会瞬间清空，用户很难分清“我删了旧的”和“提取白做了”。用户真正需要的是
  重新提取——同一范围直接重提即可，旧结果会自动折叠保留。main 侧对最新草稿返回
  `EXTRACTION_DRAFT_LATEST`，不依赖界面隐藏按钮。判据是可删断言：该草稿所在作用域里必须存在
  **严格更高**的 `extractorVersion`。
- **原子**：`deleteDraft` 的顺序是
  1. 校验会话/编辑序号/草稿存在/确实被取代；
  2. 用 `encodeProjectFile(nextSnapshot)` 对“删除后的聚合”做 schema8 完整编码自校验；
  3. 写恢复草稿（`recovery.stage`）；
  4. 以上全部成功后才切换会话快照与 `acceptedSeq`。
  任一步失败都返回错误且**内存快照、恢复草稿、项目文件都不变**（不做“先改内存再补写”）。
- 只删这一份 `extractionDrafts` 条目：来源 PDF/版本/blob、条款、绑定、参数、图纸、模型、
  事件、文件版本都不动（测试逐项断言），项目文件仍需用户显式保存才落盘。
- 删除后角标/计数按新快照重算；关闭重开（序列化往返）后默认选中与删除结果都保持。

## 3. 改动文件

| 文件 | 改动 |
|---|---|
| `src/document-extraction/draftScope.ts` | 新增：作用域分组、版本比较、默认选中、被取代判定、可删判定、有效确认计数 |
| `src/document-extraction/index.ts` | 导出上述纯函数 |
| `src/document-extraction/pending.ts` | 角标只统计当前草稿 |
| `desktop/shared/contracts.ts` | 新通道 `extraction:delete-draft`、请求/返回值、两个错误码、`deleteExtractionDraft` |
| `desktop/main/extractionService.ts` | `deleteDraft` 原子实现；`decide` 对旧草稿返回 `EXTRACTION_DRAFT_SUPERSEDED` |
| `desktop/main/extractionChannels.ts` | 新通道 schema（strict）+ sender/会话校验 |
| `desktop/preload/index.ts` | 暴露 `deleteExtractionDraft`（仍不暴露通用 invoke/send） |
| `src/workspace/desktopAdapter.ts` / `useDesktopSession.ts` | 会话状态同步与锁/提示复用既有路径 |
| `src/pages/DesktopWorkspace.tsx` | 接线 `onDeleteDraft` |
| `src/components/ExtractionReviewPanel.tsx` / `.css` | 顶部当前草稿、折叠行、只读候选、删除二次确认 |
| `src/pages/DesktopWorkspace.test.tsx` | 新 IPC 的假 mock（`deleteExtractionDraft`） |
| `desktop/tests/preloadContract.test.ts` | 允许新增函数清单补 `deleteExtractionDraft` |
| `scripts/v36-drafts-seed.ts`、`vitest.v36fixture.config.ts` | 证据 seed（真实 pdfjs 文本层 + 真实提取/确认路径） |
| `desktop/tests/e2e/v36drafts.mjs` | 打包应用走查 + 截图 + 断言 |

schema 仍为 8：未加字段、未改 domain 公式/ q 精度/ 判据；旧的 schema8 项目文件（单草稿）
照常读取，行为不变。

## 4. 测试

命令与真实结果（日志在 `docs/evidence/V3.6/logs/drafts-*.log`）：

| 命令 | 结果 |
|---|---|
| `npm test` | 92 个文件 / 940 个用例全部通过 |
| `npm run test:desktop` | 27 个文件 / 197 个用例全部通过 |
| `npm run typecheck` | 通过（无输出） |
| `npm run typecheck:desktop` | 通过（无输出） |
| `npm run lint` | 通过（无输出） |
| `npm run build` | 通过（`✓ built in …`，仅有既有的 chunk > 500 kB 警告） |
| `npm run package:desktop -- --arch=arm64` | `RESULT PASS 打包产物中的 pdf worker 可被 main.cjs 运行时加载` |

### 新增/修改用例

- `src/document-extraction/draftScope.test.ts`（5 条，新增文件）
  1. 版本号末位整数比较（2>1、10>9、无法解析时确定性）
  2. **默认选中最新的 extractor 版本，与数组顺序无关**（M05 目标用例）
  3. 同版本取较后；同版本重复不算“旧版”
  4. 同一 PDF 版本 + 同一页范围才互相取代；不同页范围独立；可删判定
  5. 已确认决定计数只算仍有效的确认（确认 → 1，撤销 → 0）；空项目无默认草稿
- `src/components/ExtractionReviewPanel.test.tsx`（+6 条）
  1. **默认选中最新的 extractor 版本（旧版在前也选新），顶部写明版本与草稿 id**（M05 目标用例）
  2. 旧草稿折叠成一行：版本/候选数/已确认数/被谁取代
  3. 展开旧草稿：候选可见、确认/编辑/拒绝禁用并写明原因、定位仍可用
  4. 删除先二次确认：写明已确认决定数，确认后才发删除请求
  5. 无已确认决定的旧草稿：确认框写明“无已确认决定”
  6. 删除失败（返回 null）：提示错误、旧草稿仍在
- `src/document-extraction/pending.test.ts`（+1 条）：被取代的旧草稿不计入角标
- `desktop/tests/extraction.test.ts`（+5 条）
  1. 旧草稿上确认被 main 拒绝（`EXTRACTION_DRAFT_SUPERSEDED`），快照不变
  2. 删除旧草稿：只删它、其它数据逐项完好；保存 → 从磁盘字节解码 → 只剩新草稿且默认选中它
  3. 最新草稿不许删（`EXTRACTION_DRAFT_LATEST`），零写入
  4. 删除失败注入（恢复草稿写入抛错）：项目文件 SHA-256 不变、两份草稿都在、`acceptedSeq` 不变
  5. 删除不存在的草稿：`NOT_FOUND` 且零写入
- `desktop/tests/preloadContract.test.ts`：允许清单补一项（契约扩展）

## 5. 变异实验 M05（默认改成选“最旧”版本）

补丁：`docs/evidence/V3.6/mutations/M05-default-oldest-version.patch`
（`compareExtractorVersions(...) >= 0` → `<= 0`，即当前草稿改为作用域内最低版本）

- 红：`npx vitest run src/document-extraction/draftScope.test.ts src/components/ExtractionReviewPanel.test.tsx`
  → **8 failed / 12 passed**，其中
  - `默认选中最新的 extractor 版本，与数组顺序无关` ×
  - `默认选中最新的 extractor 版本（旧版在前也选新），顶部写明版本与草稿 id` ×
  - 另有 6 条与“哪份被折叠/哪份被删”强相关的用例随变异一起红（同一处判断的连锁反应）
  - 日志：`docs/evidence/V3.6/mutations/logs/M05-red.log`
- 恢复：同一命令 → **20 passed**，日志：`docs/evidence/V3.6/mutations/logs/M05-green.log`
- 补丁可复现性已验证：`git apply --check` → `git apply` → 与变异文件逐字节一致 →`git apply -R` → 与还原文件一致。

## 6. 打包应用走查（真实 `.app` + CDP + open-file）

`node desktop/tests/e2e/v36drafts.mjs` → `RESULT PASS`，摘要 `docs/evidence/V3.6/drafts-e2e.json`，
截图（`docs/evidence/V3.6/screenshots/`）：

| 截图 | 内容 |
|---|---|
| `v36-12-multidraft-default-new.png` | 默认显示新草稿：顶部版本+草稿 id、计数“待确认 7”、角标“待确认 7” |
| `v36-12b-old-draft-folded-row.png` | 旧草稿折叠一行：`旧规则版本（document-extractor-1）· 共 7 条候选（已确认 1）· 已被 v2 取代` |
| `v36-13-old-draft-expanded-readonly.png` | 展开旧草稿：7 条候选可见，确认/编辑/拒绝置灰，原因文案可见，定位可用 |
| `v36-14-delete-confirm.png` | 删除二次确认：`该草稿有 1 条已确认决定，删除后不可恢复…` + 确认删除/取消 |
| `v36-15-old-draft-deleted.png` | 删除后：只剩新草稿、折叠行消失、角标与计数仍一致 |
| `v36-16-reopened-single-draft.png` | 退出重启重开同文件：只剩 1 份草稿且默认仍是 `document-extractor-2` |

走查断言（失败即 `RESULT FAIL` 且退出码 1）：默认版本/候选数/计数/角标、折叠行文案、
旧草稿按钮禁用与原因文案、确认框文案、删除后只剩新草稿、保存后重开仍只剩新草稿且默认选它。

## 7. 未做 / 已知限制

- 多份草稿的“跨页范围合并”仍不做：不同页范围各是独立草稿，界面上以作用域切换器切换
  （只有 >1 个作用域时才显示切换器）。扩大页范围仍会新增草稿，旧草稿需手动删除。
- 删除只作用于当前项目会话内存 + 恢复草稿；**项目文件要在用户显式保存后才落盘**（与提取/决定一致）。
  删除后关闭窗口且不保存，会按恢复草稿/上次保存状态恢复。
- 同版本重复草稿（仅可能出现在手工构造/未来迁移的文件里）目前只能折叠查看，不可删；
  界面文案明确写“同版本重复草稿 … 未删除，仅供对照”。
- 旧草稿只读是 UI + main 双层限制；没有做“旧草稿与新草稿的候选级 diff 高亮”（不在本卡范围）。
- 打包产物未签名，安装/校验说明沿用 `docs/release` 的既有 V3.6.0-alpha 文档。
