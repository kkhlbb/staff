# A-03 V2 迁移 · 实现与实测记录

分支：`agent/dsh-v3-A`（工作树 `/Users/aston/DSH/wt/dsh-v3-A`）
日期：2026-11-09（PST）
前置：A-01/A-02 已由用户验收关账，HEAD `0efdf35`
范围：任务卡 `/Users/aston/DSH/tmp/cunlian-v3/任务卡_V3-A.md` §5 与 §6 A-03 行。

## 1. 交付文件

| 要求 | 实现 |
|---|---|
| 两条输入（`.cunlian.zip` / 旧 JSON）→ V3 单项目聚合 | `src/project-file/migrateV2.ts` |
| 从 restore.ts 抽纯解析/校验 | `src/backup/restoreParser.ts`（新）；`src/backup/restore.ts` 只留空库事务写入端 |
| 从 storage/projects.ts 抽纯解析/校验 | `src/storage/projectJson.ts`（新）；`src/storage/projects.ts` 只留 IDB 事务/ID 冲突/写库 |
| 项目字段跨文件保留 | `src/project-file/types.ts`、`validation.ts`（project.json 增加 engineVersion/createdAt/updatedAt/relationRevision/relationReview/migration/baseline） |
| 迁移事件类型 | `src/history/events.ts` 新增 `project_migrated_from_v2`（仅追加，不改既有类型行为） |
| IPC `migration:inspect` / `migration:commit` | `desktop/main/migrationService.ts`（新）、`desktop/main/index.ts`、`desktop/shared/contracts.ts`、`desktop/preload/index.ts` |
| dirty gate 边界 | `desktop/main/projectService.ts` 新增只读 `dirtySessionCount()`；A-04 接三选 |
| 测试 | `src/project-file/migrateV2.test.ts`（15 例）、`desktop/tests/migrationService.test.ts`（9 例） |

未改：`src/domain/*` 公式/q 精度/DOMAIN 常量、`src/backup/zip.ts`、V2 `formatVersion`、`restoreBackup` 的事务顺序与错误码、`review/rules.ts`。

## 2. 纯校验管道的抽取边界（原行为保留）

- `restoreParser.ts` 逐段搬移 `restore.ts` 的 zip 读入、manifest/条目哈希、记录 zod、
  快照深校验与引用校验；`parseBackup`、`failure`、`sameChain` 改为导出。
  `restore.ts` 仍只做“空库检查 + 单事务写入 + 清当前确认 + 恢复事件”，
  原错误码、`afterPartialWrite` 注入点与回滚语义不变。
- `projectJson.ts` 搬移 `decodeProjectJson` / `parseImportedProject` /
  `parseSourceMetadata` / 单位与 20 环上限/`calculateChain` 重算；`projects.ts`
  的 `importProject`、ID 冲突重写、Blob 重新生成与事务保持不变（仅改为调用抽出的函数）。
- 验证：抽取后先跑全量既有套件（`574 passed`，与 A-02 基线一致）再写迁移，
  见提交顺序与 `a03-test.log` 的最终 `588 passed`。

## 3. 迁移规则落点

1. **不写 IDB**：`migrateV2*` 只 `parseBackup` / `parseImportedProject` + 内存构造；
   不 import `storage/db`，不调用 `restoreBackup`，不清库。落盘在 `MigrationService`
   里由 `FileStore.saveAtomic` 完成，且发生在完整编码自校验之后。
2. **多项目**：`inspect` 列出全部项目；`commit` 只取所选项目；其余项目在包内不动，
   后续仍可选。测试 `多项目：预检列出全部，迁移只带所选项目，其余仍可选`。
3. **退役 `::retired::`**：所选项目基名下的退役记录（document/revision/blob 元数据/
   binding/event）及“基名不在包内项目清单”的孤立退役记录，均进入
   `history/legacyArchive.json` 的 `records`（保留原 `projectId` 与记录内容），
   `warnings` 列出数量；不并入当前来源、不冒充当前绑定。项目范围内记录数 0 时不写
   legacyArchive。归档只保留记录与哈希，**不携带退役项目附件字节**（见风险）。
4. **当前确认清零 / 历史原样**：
   - `Project.relationReview = null`；
   - 每个当前 binding `reviewedTermRevision/reviewedAt/historicalAcceptance = null`；
   - `AnalysisSnapshot` 整体原样拷贝（含冻结 `result`/`review`/`sourceManifest`/
     `comparison`；缺 `comparison` 不补算，仍为 null/缺省）；
   - 迁移不写任何复核结论，测试用 `evaluateReviewChecklist` 重新派生待办，断言
     `RELATION_CONFIRMED` 非 passed、`reviewComplete=false`。
5. **relationRevision 两条算法**：
   - ZIP：沿用 `restoreBackup` 既有值（不清零、不 +1）；
   - JSON v2：沿用 `parseImportedProjectV2` 的“原值 + 1”；v1：`1`；
   - v2 原值为 `Number.MAX_SAFE_INTEGER` 时迁移层显式拒绝（JSON 溢出），
     不改原解析器行为。
6. **当前 working 重算**：`calculateChain` 重算后与“同一 definition 的旧快照冻结
   result”逐数值/状态/贡献项比对；不一致 → `CALCULATION_FAILED`。JSON 路径与
   `parseImportedProject` 返回的重算结果比对。V2 深校验本身已拒绝伪造 result，
   迁移层比对是第二道防线。
7. **旧 JSON 限制**：`decodeProjectJson` 1 MiB、`MAX_CHAIN_TERMS=20`、
   `unit` 声明必须 `q`、`qPerMm` 声明必须 10000；全部沿用原解析，不放宽。
8. **缺附件**：ZIP 只接受 manifest 逐条声明的缺失；JSON 每个 revision 重新生成
   `legacy-json-*` blobKey，并逐条写入 `missingAttachments(reason=legacy-json)`；
   不读取磁盘同名 PDF、不伪造字节。
9. **工程字段**：project.json 现已保存 `engineVersion/createdAt/updatedAt/
   relationRevision/relationReview/migration/baseline`，迁移原样携带；V3 新建项目
   使用同一形状（A-04 新建时 relationReview=null）。`dimensionChain`（working/
   target/assumptions、整数 q、termRevision）整体保留。

## 4. 迁移前后字段对照表（真实断言的字段）

样本：`src/backup/__fixtures__` + 测试内用 V2 生产导出器（`createProjectBundle`）
生成的合法完整备份；下表“迁移后”均由 `migrateV2.test.ts` 深比较断言，不是手工誊写。

| 字段 | 迁移前（V2） | 迁移后（V3 `.cunlian`） | 规则 | 断言位置 |
|---|---|---|---|---|
| `project.id` / `name` | 项目记录 | 不变 | ZIP/JSON 一致 | 字段保留用例 |
| `working.terms[].nominalQ/lower/upper/sign/termRevision` | 整数 q | 逐字段不变 | 不重算、不改精度 | `dimensionChain toEqual` |
| `working.target` / `assumptions` | 目标区间/假设文本 | 不变 | 原样 | 同上 |
| `project.baseline` | `{savedAt, definition}` 或 null | 不变 | 原样，链经 `validateChain` 复核 | `baseline toEqual` |
| `project.relationRevision` | ZIP：任意既有值；JSON v2：N；v1：无 | ZIP：N；JSON v2：N+1；v1：1 | 两条路径不同算法 | V1/V2/JSON 用例 + ZIP 用例 |
| `project.relationReview` | 可能有确认对象 | `null` | 当前确认清零 | fallback 实验目标用例 |
| `binding.reviewedTermRevision` | 可能为 N | `null` | 当前确认清零 | 字段保留 + fallback |
| `binding.reviewedAt` | 可能有时间 | `null` | 当前确认清零 | 同上 |
| `binding.historicalAcceptance` | 可能有凭据 | `null` | 当前确认清零 | 同上 |
| `binding.revisionId/page/rectPdf/pageBoxPdf/note` | 原绑定 | 不变 | 几何复用 `validateBindingRegion` 等价校验 | `binding toEqual` |
| `sources.revisions[]`（id/fileName/sha256/byteSize/pageCount/blobKey） | 原记录 | 不变（ZIP）；JSON 重新生成 blobKey | 不伪造 | `revisions toEqual` / JSON 用例 |
| `attachments/<blobKey>.bin` | PDF 原字节 | 逐版本字节，SHA-256 一致 | 只搬字节不转码 | `sha256Hex(bytes)===revision.sha256` |
| `workspace/draft.json` | 草稿原始字符串 | 不变 | 无效输入也保留 | `draft toEqual` |
| `history/events.json` | 原事件 | 原事件 + 一条 `project_migrated_from_v2` | 不覆盖旧事件 | `toContainEqual` |
| `history/analysisSnapshots.json` | 冻结快照 | 整体不变（含 review/result/sourceManifest/comparison） | 不重算、不补 comparison | `analysisSnapshots toEqual` |
| `importSnapshots` / `migrationBackups` | 原记录 | 原记录 | 不冒充 AnalysisSnapshot | JSON 深比较 |
| `legacyArchive` | 无 | 退役闭包 + 孤立退役记录，含数量警告 | 只读、不并入当前 | 退役归档用例 |

## 5. IPC 契约落点（任务卡 §3 对应行）

- `migration:inspect` 参数 `{kind:'bundle'|'json'}`：main 对话框授权读取、拒绝符号
  链接/非普通文件、bundle≤150 MiB、JSON≤1 MiB；完整校验通过后才发 token。
- token：绑定窗口 `webContents.id`、原始字节（冻结副本）、源路径、源 SHA-256、
  候选项目与过期时间（10 分钟）；提交时不再读源文件，避免校验后被替换。
- `migration:commit` 参数 `{importToken, projectId}`：token 存在/未过期/窗口一致；
  项目属于预检；dirty gate（注入，A-04 接三选）；另存目标必须 `.cunlian`、不得
  等于输入、必须不存在；转换 → 编码自校验 → 同目录临时文件 + fsync + 回读全检 +
  rename → 回读成功后 `ProjectService.openBytes` 建立会话。
- 错误码：`STALE_IMPORT`、`INVALID_REQUEST`、`CANCELLED`、`CALCULATION_FAILED`、
  `SAVE_FAILED`、容器码与 V2 原码（`UNSAFE_PATH`/`MISSING_REFERENCE`/…）直传。
- 提交成功后 token 删除（不可重放）；提交前失败 token 保留到过期，允许修复目标
  后重试；当前会话/编辑序号/dirty/附件/最近索引不动（最近索引属 A-04，未接）。

## 6. 测试与真实命令

最终全量（本文件生成时）：

```
$ npx vitest run
Test Files  56 passed (56)
     Tests  589 passed (589)

$ npx vitest run --config vitest.desktop.config.ts
Test Files  7 passed (7)
     Tests  58 passed (58)

$ npm run typecheck          # exit 0
$ npm run typecheck:desktop  # exit 0
$ npm run lint               # exit 0
$ npm run build              # exit 0
```

日志：`a03-test.log`、`a03-desktop-test.log`；迁移专项共 24 例
（`migrateV2.test.ts` 15 + `migrationService.test.ts` 9）。

单元/集成覆盖（对应任务卡要求）：

- 两条输入分派：`inspectV2Bundle`/`inspectV2Json`、`migrateV2Bundle`/`migrateV2Json`；
- V1/V2 `relationRevision` 差异（1 / N+1 / ZIP 原值）；
- 退役归档归属（所选项目退役 5 条 + 孤立 3 条；其它项目退役不并入）；
- 保留字段逐字段深比较（见 §4 表）；
- 拒绝路径：单位错、`qPerMm` 错、未来 schema、非法 rect、跨项目 blob、危险路径、
  >1 MiB JSON、21 环、孤立附件元数据；
- 集成：预检不写会话/不落盘；dirty gate 取消零写入；目标已存在/父目录缺失/目标
  等于输入零写入；token 过期/跨窗口 `STALE_IMPORT`；成功后 `ProjectService.openFile`
  重开 DTO 与提交返回逐字段一致；失败后原会话 `acceptedSeq/savedSeq/path/dirty`
  不变、源文件字节哈希不变。

## 7. 回退实验（任务卡 §8「迁移确认边界」）

定点变异：仅把 ZIP 路径“清当前确认”退回“保留原凭据”，历史转换不动
（补丁与说明：`rollback-a03.patch`）。

```
-    relationReview: null,
+    relationReview: project.relationReview,
...
-      reviewedTermRevision: null,
-      reviewedAt: null,
-      historicalAcceptance: null,
```

红灯原文（`rollback/a03-red.log`）：

```
FAIL  src/project-file/migrateV2.test.ts > V2 完整备份：预检与字段保留 >
      migration-clears-current-preserves-history：当前确认非 null 即失败
AssertionError: expected { relationRevision: 3, …(2) } to be null
- Expected: null
+ Received: { "confirmedAt": "2026-11-05T08:00:00.000Z", "fingerprint": "a342ec97fddbc0ab",
+             "relationRevision": 3 }
 ❯ expect(project.relationReview).toBeNull()
Test Files  1 failed (1)
     Tests  1 failed | 1 passed | 12 skipped (14)
```

同一次运行里 `migration-keeps-history-verbatim` 为 **passed**（历史深相等不受该变异
影响），证明红灯原因是“当前确认非 null”，不是编译失败或历史断言连带失败。

恢复实现后（`rollback/a03-green-restored.log`）：

```
Test Files  1 passed (1)
     Tests  2 passed | 12 skipped (14)
```

## 8. 未完成 / 阻塞 / 已知问题（不记通过）

1. **A-MIG-1 阻塞**：用户尚未提供真实 V2 完整备份样本。以上自动化全部基于仓库
   `src/backup/__fixtures__` 与 V2 生产导出器生成的合法包，**不能写成“已通过真实
   迁移验收”**。真实样本到位后需另跑 A-MIG-2/3/5 的对照与逐版本打开。
2. A-MIG-2/3/4/5 的产品级手工验收、断网 Finder 打开、打包产物内迁移未执行
   （A-05 独立验收；本卡只交实现与自动化证据）。
3. dirty gate 的生产实现只完成“检测 dirty + 不保存/取消”；“保存并迁移”需 renderer
   flush + 正式保存，属 A-04 会话层，当前选择该按钮会明确提示“保存流程尚未接入”
   并取消，不伪造已保存。
4. 会话切换/最近项目索引属 A-04：`commit` 成功后建立新会话并返回 DTO，但不会主动
   关闭旧会话或写最近索引；失败时也因此不会改动它们（更严格的“不变”）。
5. 退役归档不携带退役项目附件字节（`legacyArchive` 是 JSON 记录 + 哈希）；如果
   用户要求完整保留已删除项目的 PDF 字节，需要新的容器扩展，不能在本卡静默假设。
6. 快照引用当前项目闭包外的来源版本时，迁移以 `MISSING_REFERENCE` 明确拒绝，而不
   改写历史作用域或丢引用；此类包需单独定归属规则。
7. 迁移后若落盘成功但 `openBytes` 建会话失败，文件已保存且不回滚，错误文案明确为
   “迁移文件已保存，但建立会话失败”；目前无自动化制造该状态（编码/解码同一实现，
   除非磁盘被并发改写）。
8. 未做 150 MiB bundle 的实跑上限用例；bundle 上限复用 V2 zip 常量与
   `parseBackup` 的既有测试，JSON 1 MiB 上限有实测拒绝。
9. `project/project.json` 在 A-03 增加了必填字段（engineVersion/createdAt/
   updatedAt/relationRevision/relationReview/migration/baseline）。格式尚未发布，
   A-02 的测试夹具已同步；若存在 A-03 之前生成的开发期 `.cunlian` 文件，会被
   按 `INVALID_RECORD` 拒绝，需要重新编码，不能静默补默认值。

## 9. 参考来源（提交说明同步登记）

- 仓库内既有实现：`src/backup/{zip,projectBundle,restore}.ts`、`src/storage/{db,projects,migrateV1}.ts`、
  `src/domain/{types,calculate,validation}.ts`、`src/sources/{types,bindings,revisions,pdfCoordinates}.ts`、
  `src/history/{events,snapshots}.ts`、`src/review/rules.ts`、`src/project-file/*`（A-02）。
- Electron 官方：IPC `https://www.electronjs.org/docs/latest/tutorial/ipc`、
  sender 校验 `https://www.electronjs.org/docs/latest/tutorial/security#validate-the-sender-of-all-ipc-messages`、
  `dialog`（showOpenDialog/showSaveDialog/showMessageBox）与 `app.getPath('documents')` 用法沿用 A-01 的官方页记录。
