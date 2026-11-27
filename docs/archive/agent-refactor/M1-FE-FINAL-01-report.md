# M1-FE-FINAL-01 交付与验收报告

## 1. 修改与新增文件清单

本次任务共修改 **9** 个前端文件，新增 **1** 个报告文件（合计 **10** 个文件）；冻结边界目录保持 **0 改动**。

### 修改文件（9）
1. `src/workspace/project-agent/m1WorkbenchBridge.ts` — 对齐 M1-BE-02D 契约类型与纯函数（`contextPreview: boolean`、`sentContextSummary?: string`、不透明 ID 聊天入参、后端标准 `toolCalls` 格式化、`afterSequence` / `snapshot_required` 游标重置守卫、`AUTH_REQUIRED.detail` 可信 `scopeEpoch` 解析）
2. `src/workspace/project-agent/m2WorkbenchBridge.ts` — 修复 N1（同修订省略 `checksInProgress` 保留检查中状态）、N2（`drawingFailureGeneration` 校验防迟到图纸重试覆盖较新失败）、N3（同 `revisionOrder` 不同修订 ID 碰撞 fail-closed 拒绝）、N5（`task_completed` + `checksInProgress: true` + `checks: []` 终态等待摘要）
3. `src/workspace/project-agent/m3WorkbenchBridge.ts` — 修复 N4（`computeNextExternalNotificationWatermark` 在不可比较通知到达时保留水位表已有数值型 `revisionOrder`）
4. `src/workspace/project-agent/M2CenterCanvas.tsx` — 修复 N5（在终态等待横幅中区分展示「检查进行中 · 尚未满足正式保存条件」）
5. `src/workspace/project-agent/ProjectAgentM1Workbench.tsx` — 联动修复 N2、N4、N6（切项目释放 `takeoverPending` 与 A→B→A 代际校验）、N7（同项目接管成功递增 `commitRequestEpoch` 时同步重置 `commitPending`），并完成全部 4 项 M1-BE-02D 契约对接与无草稿原生写入申请入口
6. `src/workspace/project-agent/m1WorkbenchBridge.test.ts` — 新增 Part B 契约纯函数单元测试（3 项）
7. `src/workspace/project-agent/m2WorkbenchBridge.test.ts` — 新增 N1、N2、N3、N5 回归单元测试（4 项）
8. `src/workspace/project-agent/m3WorkbenchBridge.test.ts` — 新增 N4 回归单元测试（1 项）
9. `src/workspace/project-agent/ProjectAgentM1Workbench.test.tsx` — 更新既有聊天不透明 ID 断言，新增 N2、N5、N6、N7 与 Part B（B1–B4）组件级回归/契约集成测试（7 项）

### 新增文件（1）
10. `docs/agent-refactor/M1-FE-FINAL-01-report.md` — 本验收报告

---

## 2. Part A（N1–N7 缺陷修复）逐条对照

| 编号 | 级别 | 修复点与实现摘要 | 对应自动化回归测试用例 | 结果 |
| --- | --- | --- | --- | --- |
| **N1** | P0 | `reduceM2PreviewEvent` 在同修订事件同时省略 `checks` 与 `checksInProgress` 时保留 `state.checksInProgress`，仅在显式 `checksInProgress: false` 或非 `checking` 的新 `checks` 到达时清除，确保 `canSaveFormal` 持续阻断。 | `m2WorkbenchBridge.test.ts` → `N1：同修订事件省略 checks 与 checksInProgress 时保留 checksInProgress=true，直至显式结束` | PASS |
| **N2** | P0 | `M2CanvasState` 与 `WorkbenchTracker` 维护单调递增 `drawingFailureGeneration`（每次 `drawing_failed` 递增）；发起重试图纸时捕获 `expectedDrawingFailureGeneration`；`handleRetryDrawing` 与 `applyM2DrawingRetryResult` 校验不匹配时严格丢弃迟到成功返回，不清除较新失败、不覆盖图纸，同时释放 `retryDrawingPending`。 | `m2WorkbenchBridge.test.ts` → `N2：迟到的图纸重试成功因 drawingFailureGeneration 不匹配被严格丢弃，严禁覆盖同修订较新 drawing_failed`<br>`ProjectAgentM1Workbench.test.tsx` → `N2：重试图纸在途期间收到同修订较新 drawing_failed 时，早先重试成功返回被严格丢弃且正确释放 loading 状态` | PASS |
| **N3** | P1 | `reduceM2PreviewEvent` 与 `applyM2DrawingRetryResult` 新增 `isSameOrderRevisionCollision` 守卫：当 `incomingOrder === currentRevisionOrder` 且 `incomingRevision !== currentRevision`（如 `draft-7` vs `branch-7`）时，fail-closed 拒绝替换当前画布，仅归档历史（`isLateStale: true`），不推进 `currentRevision`、不污染 `revisionSequences` / `lastEventSequence`。 | `m2WorkbenchBridge.test.ts` → `N3：同 revisionOrder 不同修订 ID 碰撞（draft-7 vs branch-7）fail-closed 拒绝替换画布且不污染水位` | PASS |
| **N4** | P1 | `m3WorkbenchBridge.ts` 新增 `computeNextExternalNotificationWatermark` 并在 `mergeExternalProjectNotificationWithWatermarks` 与 `ProjectAgentM1Workbench.tsx` 统一调用：当不可比较通知缺少数值型 `revisionOrder` 时，严格保留水位表中已有的最大数值型 `revisionOrder`，防止更旧修订凭更高 `sequence` 绕过水位。 | `m3WorkbenchBridge.test.ts` → `N4：不可比较通知（无 revisionOrder）合并时严禁擦除水位表已有数值型 revisionOrder，后续更旧修订凭更高 sequence 仍被拒绝` | PASS |
| **N5** | P1 | `computeNaturalCompletionSummary` 调整判定顺序：两槽同版就绪、`checks === []`、收到 `task_completed` 且 `checksInProgress === true` 时返回 `isPendingChecksTerminal: true`、`checksInProgress: true`、`allRequiredPassed: false` 的终态等待提示；`M2CenterCanvas` 清晰展示「检查进行中 · 尚未满足正式保存条件」，同时 `canSaveFormal` 保持 `false`。 | `m2WorkbenchBridge.test.ts` → `N5：task_completed 且 checksInProgress=true 且 checks=[] 时仍展示终态等待提示并保持未通过正式保存条件`<br>`ProjectAgentM1Workbench.test.tsx` → `N5：两槽同版就绪且 checks=[] 时收到 task_completed + checksInProgress=true，中央画布仍展示终态等待提示且阻断正式保存` | PASS |
| **N6** | P1 | `resetProjectScopedStateForSwitch` 重置 `takeoverPending` 为 `false`；切项目路径（`handleOpenLocalProject` / `handleOpenExternalProjectResult`）递增 `takeoverRequestEpoch`；`handleTakeoverDraft` 与 `handleReconnect` 异步返回同时校验 `projectId`、`capturedScopeEpoch`、`switchProjectEpoch`、`takeoverRequestEpoch`，丢弃时不误锁或误清更新接管的 `takeoverPending`。 | `ProjectAgentM1Workbench.test.tsx` → `N6：接管挂起时切项目释放 takeoverPending，A→B→A 切回后旧接管迟到返回因代际校验被丢弃且不误清更新接管` | PASS |
| **N7** | P1 | `handleTakeoverDraft` 同项目接管成功并递增 `commitRequestEpoch` 时，同步执行 `setCommitPending(false)`，避免原提交被丢弃后确认提交按钮持续禁用。 | `ProjectAgentM1Workbench.test.tsx` → `N7：同项目接管成功递增 commitRequestEpoch 时同步重置 commitPending，避免原提交被丢弃后按钮持续禁用` | PASS |

---

## 3. Part B（M1-BE-02D 合流契约对齐）逐条对照

严格对照 `/Users/aston/DSH/wt/gpt-agent-refactor-m1-entry-20261123-1948/docs/agent-refactor-m0/m1-be-02d-report.md` 及后端共享类型核对并对齐以下 4 项：

| 序号 | 契约对齐项 | 前端改动要点 | 对应自动化契约测试用例 | 结果 |
| --- | --- | --- | --- | --- |
| **B1** | `testM1ModelApiConnection` 入参/出参对齐 | `M1ModelApiTestRequest.contextPreview` 改为 `boolean`（前端发送 `true`）；`M1ModelApiTestResult.sentContextSummary` 改为 `string`，在「模型 API 测试结果」面板清晰展示实际发送上下文摘要。 | `ProjectAgentM1Workbench.test.tsx` → `M1-BE-02D B1 & B2：testM1ModelApiConnection 发送布尔 contextPreview 并展示字符串 sentContextSummary；sendM1ChatMessage 发送不透明 ID 并渲染标准 toolCalls` | PASS |
| **B2** | `sendM1ChatMessage` 入参/回执对齐 | `attachments` 发送不透明 ID 数组 `string[]`（`refId`）；`selectedObject` 发送不透明 ID `string | null`（`objectId`）；新增 `formatChatToolCallItem` 支持后端标准 `{ name, status: 'awaitingInput' | 'succeeded', taskId? }` 并兼容旧 `{ toolName, status, summary }` 与字符串格式，在对话气泡中展示工具状态与任务 ID。 | `m1WorkbenchBridge.test.ts` → `M1-BE-02D B2：formatChatToolCallItem 支持后端标准结构 { name, status, taskId? } 并兼容旧结构与字符串`<br>`ProjectAgentM1Workbench.test.tsx` → `M1-BE-02D B1 & B2：...` | PASS |
| **B3** | `subscribeM1WorkbenchEvents` 支持 `afterSequence` 与 `snapshot_required` | 订阅入参扩展可选 `afterSequence?: number`，按 `scopeEpoch` 重建订阅并在已有游标时续传 `afterSequence`；新增 `shouldAcceptWorkbenchEventSequence` 允许 `snapshot_required` 重置超前游标并同步消费其 `snapshot` 与 `activities`，随后从重置游标继续续读不发生断流。 | `m1WorkbenchBridge.test.ts` → `M1-BE-02D B3：shouldAcceptWorkbenchEventSequence 对 snapshot_required 允许重置超前游标，普通事件保持严格递增`<br>`ProjectAgentM1Workbench.test.tsx` → `M1-BE-02D B3：subscribeM1WorkbenchEvents 消费 snapshot_required 重置超前游标并续读后续事件，且重订阅携带 afterSequence` | PASS |
| **B4** | `scopeEpoch` 同步与原生写入申请 | 新增 `parseAuthoritativeScopeEpochFromError`：当后端返回 `AUTH_REQUIRED` 且 `detail` 匹配 `/^[1-9]\d*$/` 时同步更新本地 `scopeEpoch` 并重建订阅；保持客户端连接态与原生项目授权态分离展示；在无草稿时（`draftRevision === null`）提供「申请原生写入权限」/「申请原生写入」操作入口，按契约调用 `takeoverM1Draft({ projectId, draftRevision: null, requestId, previousScopeEpoch, nextScopeEpoch, targetSource })`。 | `m1WorkbenchBridge.test.ts` → `M1-BE-02D B4：parseAuthoritativeScopeEpochFromError 仅在 AUTH_REQUIRED 且 detail 为正整数字符串时提取可信 epoch`<br>`ProjectAgentM1Workbench.test.tsx` → `M1-BE-02D B4：AUTH_REQUIRED 携带正整数 detail 同步可信 scopeEpoch 并重建订阅；无草稿时提供原生写入申请入口调用 takeoverM1Draft` | PASS |

---

## 4. 全量验收命令执行结果与冻结边界核查

工作目录：`/Users/aston/DSH/wt/dsh-agent-refactor-m0`（分支 `agent/dsh-agent-refactor-m0`）

| 验收项 | 命令 | 退出码 | 结果摘要 |
| --- | --- | ---: | --- |
| Lint | `npm run lint` | 0 | 0 errors, 0 warnings |
| Typecheck (app/node/mcp) | `npm run typecheck` | 0 | 全部通过 |
| Typecheck (desktop) | `npm run typecheck:desktop` | 0 | 全部通过 |
| 全量前端测试 | `npm test` | 0 | **149 / 149** 测试文件通过，**1543 / 1543** 测试用例通过（较基线 1528 新增 15 项回归与契约用例） |
| 生产构建 | `npm run build` | 0 | `tsc -b && vite build` 成功（`built in 248ms`） |
| 冻结边界核查 | `git diff --stat -- desktop/shared/contracts.ts desktop/preload desktop/main` | 0 | 输出为空（0 改动） |

---

## 5. 遗留问题与风险

- 本次任务在前端工作树内完成全部缺陷修复、M1-BE-02D 契约对齐与自动化单元测试验证，无遗留前端阻塞项。
- 端到端真机双入口合流（连接后端 `M1-BE-02D` 主进程 IPC 与真实 preload）需待前后端分支正式合流后执行联合验收。
