# FE-BUGFIX-02 修复与回归验证报告

- **任务卡**：`FE-BUGFIX-02`（一次性收口 QA-FE-02 检出的 E1–E7 与 S1–S5 共 12 项前端残余缺陷）
- **工作目录**：`/Users/aston/DSH/wt/dsh-agent-refactor-m0`
- **分支**：`agent/dsh-agent-refactor-m0`

---

## 1. 修改/新增文件清单

### 修改文件（10 个）
1. `src/workspace/project-agent/m2WorkbenchBridge.ts`
2. `src/workspace/project-agent/m3WorkbenchBridge.ts`
3. `src/workspace/project-agent/M2CenterCanvas.tsx`
4. `src/workspace/project-agent/M3CompletionView.tsx`
5. `src/workspace/project-agent/ProjectAgentM1Workbench.tsx`
6. `src/workspace/project-agent/m2WorkbenchBridge.test.ts`
7. `src/workspace/project-agent/m3WorkbenchBridge.test.ts`
8. `src/workspace/project-agent/ProjectAgentM1Workbench.test.tsx`
9. `src/workspace/project-agent/ProjectAgentM2Workbench.test.tsx`
10. `src/workspace/project-agent/ProjectAgentM3Workbench.test.tsx`

### 新增文件（1 个）
1. `docs/agent-refactor/FE-BUGFIX-02-report.md`（本报告）

---

## 2. 逐条缺陷修复对照与回归测试结果（E1–E7 & S1–S5）

| 缺陷 | 优先级 | 具体修复点 | 对应回归测试用例及结果 |
| --- | --- | --- | --- |
| **E1** | P0 | 1. `m2WorkbenchBridge.ts` 新增 `resolveSlotFingerprint`：跨修订的 `model_ready` / `drawing_ready` / `revision_refreshed` 省略 `fingerprint`（`undefined` / `null` / 空串）时显式置 `null`，严禁继承上一修订槽位指纹；同修订再次更新仅在提供非空指纹时更新或保留同修订既有指纹。<br>2. `reduceM2PreviewEvent` 在 `event.revision !== state.currentRevision` 且省略 `checks` 时清空旧修订检查（置 `[]`），绝不将旧草稿检查继承为当前草稿已通过。<br>3. `m3WorkbenchBridge.ts` 的 `evaluateCompletionReadiness` 对缺失当前修订非空指纹或缺失当前修订对应检查的情况严格阻断 `canSaveFormal = false`。 | - `m2WorkbenchBridge.test.ts`：`E1：新修订省略 fingerprint 严禁继承旧修订指纹，且修订推进省略 checks 时不得继承旧草稿检查`（PASS）<br>- `m3WorkbenchBridge.test.ts`：`E1 & E3：缺失当前修订指纹、存在未确认必需要求或必需要求缺少当前修订通过检查时严禁放行正式提交`（PASS） |
| **E2** | P1 | 1. `m2WorkbenchBridge.ts` 在 `drawing_ready` 处理分支中区分 `isSameDrawingRevision = state.drawing.revision === event.revision`：新修订省略 `annotations` 且 `annotationsByRevision[event.revision]` 无缓存时，置为 `[]`（严禁回退取 `state.annotations` 中旧草稿标注），并同步触发 `validateSelectionAfterRefresh` 校验 `selectedAnnotationId` 失效。 | - `m2WorkbenchBridge.test.ts`：`E2：新修订 drawing_ready 省略 annotations 且无缓存时置为 []（不得回退旧草稿标注）并同步校验 selectedAnnotationId 失效`（PASS） |
| **E3** | P1 | 1. `m2WorkbenchBridge.ts` 的 `computeNaturalCompletionSummary` 同时校验 `requirements`：任意 `required === true` 且状态为 `needsClarification` / `conflict` / `uncovered`，或缺少对应当前修订指纹且 `status === 'pass'` 检查记录的必需要求，均不得判定为自然完成。<br>2. `m3WorkbenchBridge.ts` 的 `evaluateCompletionReadiness` 新增可选参数 `requirements` 与返回字段 `blockingRequirements: readonly M3BlockingRequirementDetail[]`，只要存在未确认或缺少当前修订通过检查的必需要求，严格阻断 `canSaveFormal = false` 并在 `blockReasons` 列出阻塞要求。<br>3. `ProjectAgentM1Workbench.tsx` 两处 `evaluateCompletionReadiness` 均传入 `requirements: canvasState.requirements`；`M3CompletionView.tsx` 新增 `正式提交阻塞要求提示` / `阻塞必需要求列表` 告警区明确列出阻塞要求。 | - `m2WorkbenchBridge.test.ts`：`E3 & E4：存在未确认/未覆盖必需要求时不得判定自然完成；task_completed 且 checks 为空时输出明确终态摘要`（PASS）<br>- `m3WorkbenchBridge.test.ts`：`E1 & E3：缺失当前修订指纹、存在未确认必需要求或必需要求缺少当前修订通过检查时严禁放行正式提交`（PASS）<br>- `ProjectAgentM3Workbench.test.tsx`：`E3（UI）：存在待澄清或缺少检查的必需要求时，完成视图明确列出阻塞必需要求并阻断正式保存`（PASS） |
| **E4** | P1 | 1. `m2WorkbenchBridge.ts` 的 `computeNaturalCompletionSummary` 在两槽同版 ready、收到 `task_completed`（或 `taskCompleted: true`）但当前修订 `checks` 为空时，返回明确的非完成终态摘要（`isPendingChecksTerminal: true`、`allRequiredPassed: false`，文案“任务已结束 · 等待检查结果 · 尚未满足正式保存条件”，并一并列出未满足/待澄清必需要求）。<br>2. `M2CenterCanvas.tsx` 针对 `isPendingChecksTerminal` 渲染醒目提示与 `未满足必需要求` 徽标，同时 `evaluateCompletionReadiness` 保持 `canSaveFormal = false`。 | - `m2WorkbenchBridge.test.ts`：`E3 & E4：存在未确认/未覆盖必需要求时不得判定自然完成；task_completed 且 checks 为空时输出明确终态摘要`（PASS）<br>- `ProjectAgentM2Workbench.test.tsx`：`E4：两槽同版 ready 且收到 task_completed 但 checks 为空时展示明确终态摘要，并阻断正式保存`（PASS） |
| **E5** | P1 | 1. `m3WorkbenchBridge.ts` 新增 `canonicalizeSourceAnchor`，在 `computeCheckSetFingerprint` 中纳入稳定排序的 `linkedFeatureIds`、`linkedAnnotationIds` 与规范化序列化后的 `anchor`（含 `documentRef`、`documentName`、`page`、`region`、`excerpt`），确保顺序无关稳定且任意证据关联或原文锚点变更必改指纹。 | - `m3WorkbenchBridge.test.ts`：`E5：computeCheckSetFingerprint 纳入稳定排序的 linkedFeatureIds / linkedAnnotationIds 与规范化 anchor，任意证据或锚点变更必改指纹`（PASS） |
| **E6** | P1 | 1. `m3WorkbenchBridge.ts` 新增按 `projectId` 索引的高水位表类型 `M3ExternalNotificationWatermarks` 及纯函数 `isExternalNotificationNewerThanWatermark`、`mergeExternalProjectNotificationWithWatermarks`。<br>2. `ProjectAgentM1Workbench.tsx` 维护持久化 `externalNotificationWatermarksRef`，通知被打开、关闭（“稍后查看”）或清除后水位不丢失，旧通知再次到达被严格丢弃。 | - `m3WorkbenchBridge.test.ts`：`E6：通知清除或打开后水位表仍持久化保留，旧通知再次到达被严格丢弃不得复活`（PASS）<br>- `ProjectAgentM3Workbench.test.tsx`：`E6（UI）：关闭外部项目通知后，再次收到旧通知严禁复活`（PASS） |
| **E7** | P1 | 1. `m2WorkbenchBridge.ts` 新增 `isOpaqueUnorderedRevision` 守卫：当已有 `currentRevision` 且收到既不等于 `currentRevision`、又解析不出数值后缀且未提供显式 `revisionOrder` 的不透明修订（如 `"rev-opaque"` / `"hotfix"`）时，fail-closed 拒绝覆盖当前画布，仅归档历史（`isLateStale: true`），不推进 `currentRevision`、不污染 `lastEventSequence` 或 `revisionSequences`。 | - `m2WorkbenchBridge.test.ts`：`E7：已有 currentRevision 时收到无数值后缀且缺显式 revisionOrder 的不透明修订，fail-closed 拒绝覆盖画布且不污染水位`（PASS） |
| **S1** | P1 | 1. `ProjectAgentM1Workbench.tsx` 在 `handleOpenLocalProject`、`handleOpenExternalProjectResult` 与 `handleTakeoverDraft` 路径立即递增 `tracker.modelApiTestEpoch`、清空 `tracker.activeTestRequestId` 并复位 `apiTesting` 为 `false`。<br>2. `handleTestModelApi` 丢弃旧应答时仅当 `tracker.activeTestRequestId === requestId` 才释放 `apiTesting`，既不锁死测试按钮也不误清后续新发起测试的 `apiTesting`。 | - `ProjectAgentM1Workbench.test.tsx`：`S1：切项目与接管路径立即重置 apiTesting 并递增测试代际，旧测试迟到返回不卡死按钮也不误清后续新测试状态`（PASS） |
| **S2** | P1 | 1. `ProjectAgentM1Workbench.tsx` 将 `strictEpochGuard` 改为按 `projectId` 持久化记录于 `tracker.strictEpochGuardByProject`，切出项目 A 再切回 A 仍保持 strict 守卫。<br>2. `handleRetryDrawing` 异步返回严格校验 `projectId`、`switchProjectEpoch`、`scopeEpoch`、`retryDrawingEpoch` 与 `result.value.projectId`，防止落入新项目 B 并正确释放重试 loading。<br>3. `dispatchChatTurn` 在当前聊天应答因缺失或旧代际被丢弃时，若 `tracker.activeChatRequestId === requestId` 则立即清空并释放 `setChatPending(false)`，绝不卡死发送/停止按钮。 | - `ProjectAgentM1Workbench.test.tsx`：`S2：切回项目保持 strictEpochGuard，跨项目图纸重试不串台且接管后聊天应答被丢弃时正确释放 pending`（PASS） |
| **S3** | P1 | 1. `ProjectAgentM1Workbench.tsx` 的 `handleConfirmCommitFormal` 在等待提交期间若因草稿修订推进导致旧提交返回被丢弃，当 `tracker.commitRequestEpoch === capturedCommitEpoch` 时立即释放 `setCommitPending(false)`（且不误清更新提交的 pending）。<br>2. 提交返回严格校验 `committed.checkSetFingerprint === capturedCheckSetFingerprint` 与 `(committed.previousBaseRevision ?? null) === (capturedBaseRevision ?? null)`，不匹配时拒绝投影成功并提示绑定校验失败。 | - `ProjectAgentM3Workbench.test.tsx`：`S3：同项目草稿修订推进后旧提交返回释放 commitPending，且返回指纹/基线绑定不匹配时拒绝投影成功`（PASS） |
| **S4** | P1 | 1. `resetProjectScopedStateForSwitch` 切项目时彻底清空 `setAttachedRefIds([])`。<br>2. `handleLoadMigrationReport` 与 `handleUndoBlockedDraft` 新增请求代际（`migrationRequestEpoch`、`undoRequestEpoch`）并在异步返回严格校验 `projectId`、`switchProjectEpoch`、`scopeEpoch` 及返回体 `projectId`，防止项目 A 迟到结果串台写入项目 B，同时正确释放 loading/undo 状态。 | - `ProjectAgentM3Workbench.test.tsx`：`S4：切项目彻底清空任务书附件，且 getMigrationReport / undoDraftChange 跨项目迟到返回严格丢弃不串台`（PASS） |
| **S5** | P1 | 1. `m2WorkbenchBridge.ts` 新增独立本地图纸重试产物更新函数 `applyM2DrawingRetryResult`，仅更新图纸槽位、标注（含 E2 隔离与失效校验）、视图联动与历史记录，**严禁**推进 `revisionSequences` 或 `lastEventSequence`。<br>2. `ProjectAgentM1Workbench.tsx` 的 `handleRetryDrawing` 改为调用 `applyM2DrawingRetryResult`，确保随后到达的同序号真实服务端检查事件不被误过滤。 | - `m2WorkbenchBridge.test.ts`：`S5：applyM2DrawingRetryResult 仅更新图纸槽位、标注与历史，严禁推进 revisionSequences 或全局服务端水位`（PASS）<br>- `ProjectAgentM2Workbench.test.tsx`：`S5：重试图纸成功后不污染服务端 sequence 水位，随后到达的同序号真实服务端检查事件正常处理`（PASS） |

---

## 3. 全部验收命令执行结果与冻结边界核查

在 `/Users/aston/DSH/wt/dsh-agent-refactor-m0` 下全部顺序执行并均以退出码 `0` 通过：

1. `npm run lint`：**PASS**（0 errors, 0 warnings）
2. `npm run typecheck`：**PASS**（`tsconfig.app.json` + `tsconfig.node.json` + `tsconfig.mcp.json` 全通过）
3. `npm run typecheck:desktop`：**PASS**（`tsconfig.desktop.json` 通过）
4. `npm test`：**PASS**（**149 个测试文件全部通过，1528 条测试用例全部通过**；相对 FE-BUGFIX-01 新增 16 条针对 E1–E7 / S1–S5 的自动化回归用例）
5. `npm run build`：**PASS**（`tsc -b && vite build` 成功产出 `dist/`）
6. `git diff --stat -- desktop/shared/contracts.ts desktop/preload desktop/main`：**空输出（0 改动）**，冻结边界严格保持不变。
7. 路由与窄接口边界核查：既有路由 `#/desktop`、`#/desktop-m0-preview`、`#/desktop-m1-readonly`、`#/desktop-m1-workbench`、无碰撞窄接口名（`locateM2Evidence`、`commitM3ApprovedDraft` 等）及零手动参数入口边界均保持不变。

---

## 4. 遗留问题与风险

- **无遗留缺陷与阻塞风险**。QA-FE-02 检出的 E1–E7 与 S1–S5 共 12 项残余缺陷已全部闭环并通过单元测试与全量前端校验。
