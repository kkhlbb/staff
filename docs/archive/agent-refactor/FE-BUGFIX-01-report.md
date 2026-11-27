# FE-BUGFIX-01 修复与回归验证报告

- **任务卡**：`FE-BUGFIX-01`（修复 QA-FE-01 检出的前端 P0/P1 守卫与状态机缺陷：`F03 / F04 / F06 / F07 / F08 / F09 / F10 / F11 / F12`）
- **工作目录**：`/Users/aston/DSH/wt/dsh-agent-refactor-m0`
- **分支**：`agent/dsh-agent-refactor-m0`

---

## 1. 修改/新增文件清单

### 修改文件（11 个）
1. `src/workspace/project-agent/m1WorkbenchBridge.ts`
2. `src/workspace/project-agent/m2WorkbenchBridge.ts`
3. `src/workspace/project-agent/m3WorkbenchBridge.ts`
4. `src/workspace/project-agent/M2CenterCanvas.tsx`
5. `src/workspace/project-agent/M3CompletionView.tsx`
6. `src/workspace/project-agent/ProjectAgentM1Workbench.tsx`
7. `src/workspace/project-agent/m1WorkbenchBridge.test.ts`
8. `src/workspace/project-agent/m2WorkbenchBridge.test.ts`
9. `src/workspace/project-agent/m3WorkbenchBridge.test.ts`
10. `src/workspace/project-agent/ProjectAgentM1Workbench.test.tsx`
11. `src/workspace/project-agent/ProjectAgentM2Workbench.test.tsx`
12. `src/workspace/project-agent/ProjectAgentM3Workbench.test.tsx`

### 新增文件（1 个）
1. `docs/agent-refactor/FE-BUGFIX-01-report.md`（本报告）

---

## 2. 逐条缺陷修复对照与回归测试结果

| 缺陷 | 优先级 | 具体修复点 | 对应回归测试用例及结果 |
| --- | --- | --- | --- |
| **F03** | P1 | 1. `m1WorkbenchBridge.ts` 新增 `computeModelApiConfigFingerprint` 与统一门禁函数 `canUseBuiltinModelApiChat`，强制要求当前表单配置指纹与最近通过工具往返测试的指纹一致且处于已连接 `model-api` 会话。<br>2. `ProjectAgentM1Workbench.tsx` 在修改 Base URL / 模型名 / 密钥任意一项时，`resetModelApiUnlock` 立即递增 `tracker.modelApiTestEpoch`、清空 `activeTestRequestId`、复位 `apiTesting` 与 `testedModelApiConfigFingerprint`；旧在途测试请求的迟到成功应答被严格丢弃，断线重连无法绕过门禁。 | - `m1WorkbenchBridge.test.ts`：`F03：统一门禁函数校验当前表单指纹、工具往返通过与已连接状态，禁止绕过解锁条件`（PASS）<br>- `ProjectAgentM1Workbench.test.tsx`：`F03：修改服务地址/模型名/密钥后立即撤销在途测试代际，旧测试成功迟到应答不得解锁当前表单，断线重连不得绕过门禁`（PASS） |
| **F04** | P1 | 1. `m1WorkbenchBridge.ts` 中 `isReplyAcceptedForScope`、`isEventAcceptedForScope` 引入 `isValidEpoch`（`typeof v === 'number' && Number.isFinite(v)`），对缺失/`undefined`/`null`/`NaN`/`Infinity` 的 `scopeEpoch` / `writerEpoch` 严格 **fail-closed 拒绝**。<br>2. 新增 `isScopedArtifactEventAccepted` 并为 `M2PreviewEvent` 与 `M3ExternalProjectEvent` 新增可选 `scopeEpoch?: number \| null`、`writerEpoch?: number \| null`。<br>3. `ProjectAgentM1Workbench.tsx` 接管成功后置 `tracker.strictEpochGuard = true`，此后所有缺失或旧代际的 M2 预览事件、M3 同项目外部事件及聊天响应均 fail-closed 丢弃；未接管前无 epoch 字段的兼容边界清晰保留。 | - `m1WorkbenchBridge.test.ts`：`F04：代际守卫对缺失/null/非有限数 scopeEpoch 或 writerEpoch 严格 fail-closed 拒绝，并区分接管前后 M2/M3 兼容边界`（PASS）<br>- `ProjectAgentM1Workbench.test.tsx`：`F04：接管草稿后，缺失或旧代际的 M2 预览事件与 M3 同项目外部事件必须 fail-closed 拒绝，不得覆盖画布与状态`（PASS） |
| **F06** | P1 | 1. `m2WorkbenchBridge.ts` 引入按修订隔离的 `revisionSequences: Record<string, number>` 水位管理：迟到的旧修订事件（如 `draft-7` seq 7）只进历史并按自身修订去重，**绝不**推进用于过滤当前/更新修订的水位（确保随后的 `draft-8` seq 6 正常生效）。<br>2. 引入 `annotationsByRevision` 按修订隔离标注数据：保留旧草稿图纸展示时收到新修订模型事件（含空标注或新标注），绝不覆盖旧图正在显示的标注，直到新修订自身 `drawing_ready` 就绪后再切换。 | - `m2WorkbenchBridge.test.ts`：`F06：旧修订迟到高序号事件只进历史、不污染当前修订水位，且新修订模型事件不覆盖旧图展示标注`（PASS） |
| **F07** | P1 | 1. `m2WorkbenchBridge.ts` 修复 `validateSelectionAfterRefresh`：`!state.selectedObjectId` 时保留既有 `selectionInvalidated` 与 `invalidatedObjectLabel`，绝不在下一份特征事件中静默清零，必须等待用户主动重选或取消选择。<br>2. 特征存在性仅按严格 `f.objectId === state.selectedObjectId` 判定，彻底移除按 `featureRef` 静默改绑到不同 `objectId` 的逻辑。<br>3. 刷新时同步校验 `selectedAnnotationId` 是否仍存在于当前展示的 `nextAnnotations` 中，若消失则同步置失效并展示失效提示。 | - `m2WorkbenchBridge.test.ts`：`F07：对象失效标志不在后续特征事件中静默清零、禁止仅凭 featureRef 静默改绑、同步检查 selectedAnnotationId 失效`（PASS） |
| **F08** | P0 | 1. `m2WorkbenchBridge.ts` 修复 `createInitialM2CanvasState`：无 `initialPreviewSnapshot` 时禁止凭修订合成 `status: 'ready'` 与 `fp-*` 指纹，默认 `status: 'empty'`、`fingerprint: null`。<br>2. `areArtifactsRevisionAligned` 严格校验 `status === 'ready'`、非空去空白指纹严格相等、修订一致及可选 `expectedRevision` 匹配。<br>3. `m3WorkbenchBridge.ts` 修复 `evaluateCompletionReadiness`：空 `checks` 或无必需检查时阻断；两槽修订不等于目标 `draftRevision` 时阻断；任意必需检查缺少非空且与当前草稿指纹一致的 `revisionFingerprint` 时阻断；当前草稿存在同修订 `drawingFailure`（即使曾 ready 或保留旧图）时阻断；`model_ready` 不再误清同修订 `drawingFailure`。<br>4. `M3CompletionView.tsx` 在 `!readiness.canSaveFormal` 时不再误渲染“所有条款均已通过”，改为展示前置守卫阻塞原因。 | - `m2WorkbenchBridge.test.ts`：`F08：无产物快照初始化时禁止仅凭修订号合成 ready 与指纹`（PASS）<br>- `m3WorkbenchBridge.test.ts`：`F08：正式提交前置守卫阻断空检查、跨修订错配、旧修订检查指纹、空指纹及同修订 drawing_failed`（PASS） |
| **F09** | P1 | 1. `ProjectAgentM1Workbench.tsx` 在确认失效或 `!completionReadiness.canSaveFormal` 时立即 `setPendingConfirmation(null)` 彻底销毁旧确认对象，防止元组回到旧值后确认复活。<br>2. `m3WorkbenchBridge.ts` 中 `computeCheckSetFingerprint` 纳入每条检查的 `title`、`required`、`status`、`summary`、`detail`、`revisionFingerprint`、`clarificationReason`、`clarificationPrompt`。<br>3. 二次确认点击提交时重新实时计算 `evaluateCompletionReadiness` 与 `computeCheckSetFingerprint` 校验 `canSaveFormal` 及绑定指纹；`M3CompletionView.tsx` 同步禁用按钮。<br>4. 提交发起时递增并捕获 `commitRequestEpoch`，异步返回时严格校验 `projectId`、`draftRevision`、`scopeEpoch`、`commitRequestEpoch` 与返回体字段，彻底阻断项目 A 迟到提交污染项目 B。 | - `m3WorkbenchBridge.test.ts`：`F09：computeCheckSetFingerprint 纳入 summary 与 detail，任何摘要/详情变更都会改变指纹`（PASS）<br>- `ProjectAgentM3Workbench.test.tsx`：`F09：确认失效后立即彻底清除不得复活，且跨项目切换后旧项目迟到提交返回不得污染新项目`（PASS） |
| **F10** | P0 | 1. 核查只读 `desktop/preload/index.ts` 全量导出键，确认仅 `locateEvidence`（L310）与 `commitApprovedDraft`（L308）与旧 preload 存在同名不同签名碰撞，其余 M1/M2/M3 窄接口均无碰撞。<br>2. 将 M2/M3 窄接口改名为无碰撞名称 `locateM2Evidence`、`commitM3ApprovedDraft`，同步更新桥接接口类型、`capabilities`、`missingMethods`、组件调用及全部单测。 | - `m2WorkbenchBridge.test.ts`：`F10：duck-types M2 无碰撞窄接口（locateM2Evidence），不会被旧 preload 同名 locateEvidence 误判已接线`（PASS）<br>- `m3WorkbenchBridge.test.ts`：`F10：按 duck-typing 探测 M3 无碰撞窄接口（commitM3ApprovedDraft），不被旧 preload 同名 commitApprovedDraft 误判`（PASS） |
| **F11** | P1 | 1. `m2WorkbenchBridge.ts` 在 `M2PreviewEvent` 中新增事件类型 `'task_completed'` 与可选字段 `taskCompleted?: boolean`，新增纯函数 `computeNaturalCompletionSummary`。<br>2. 当模型+图纸同修订指纹就绪（无同修订图纸失败）、`checksInProgress === false` 且存在当前修订检查结果（或收到 `task_completed` 信号）时，自动切换至同修订并排视图并生成清晰的要求/检查完成摘要。<br>3. `M2CenterCanvas.tsx` 展示 `自然完成摘要` 状态区，明确提示“尚未自动提交正式版本 · 需人工复核确认”并提供前往完成视图入口，严禁自动提交正式版。 | - `m2WorkbenchBridge.test.ts`：`F11：支持 task_completed / taskCompleted 终态信号与模型+图纸+检查同版就绪自动联动并排与自然完成摘要`（PASS）<br>- `ProjectAgentM2Workbench.test.tsx`：`F11：任务自然完成（模型+图纸+检查同版就绪或 task_completed）自动展示并排视图与自然完成摘要，且严禁自动提交正式版`（PASS） |
| **F12** | P1 | 1. `m3WorkbenchBridge.ts` 新增 `isIncomingExternalNotificationNewer` 与 `mergeExternalProjectNotification`，同一非当前项目通知按 `revisionOrder` / `sequence` 单调比较，拒绝旧包覆盖新通知。<br>2. `ProjectAgentM1Workbench.tsx` 为切项目引入 `switchProjectEpoch` 请求代际，丢弃逆序迟到的旧切换响应。<br>3. 抽取 `resetProjectScopedStateForSwitch`，在切换本地/外部项目时彻底重置上一项目的消息、授权状态、活动流、历史/正式版/草稿、恢复状态、迁移报告、完成视图、待澄清、选中对象与确认状态，目标项目省略可选字段亦零残留。 | - `m3WorkbenchBridge.test.ts`：`F12：同一非当前项目外部通知按 revisionOrder / sequence 单调比较，拒绝旧包覆盖新通知`（PASS）<br>- `ProjectAgentM3Workbench.test.tsx`：`F12：切换外部项目丢弃逆序旧切换响应，且彻底重置上一项目消息/授权/活动/迁移报告/完成视图/选中与确认状态`（PASS） |

---

## 3. 更新后的无碰撞窄接口清单

已对照 `desktop/preload/index.ts` 全量导出键完成零碰撞核验：

### M1 窄接口（`M1_WORKBENCH_BRIDGE_METHODS`，9 项，均无碰撞）
- `getM1LocalAgentInstallInfo`
- `getM1ConnectionStatus`
- `testM1ModelApiConnection`
- `sendM1ChatMessage`
- `cancelM1ChatMessage`
- `getM1ExternalActivities`
- `subscribeM1WorkbenchEvents`
- `reconnectM1Session`
- `takeoverM1Draft`

### M2 窄接口（`M2_WORKBENCH_BRIDGE_METHODS`，5 项，均无碰撞）
- `getM2PreviewSnapshot`
- **`locateM2Evidence`**（**F10 改名**：原 `locateEvidence` 与旧 preload 同名碰撞）
- `retryM2Drawing`
- `submitM2Clarification`
- `subscribeM2PreviewEvents`
- **`M2PreviewEvent` 新增字段/事件类型**：
  - **F04**：`scopeEpoch?: number | null`、`writerEpoch?: number | null`
  - **F11**：`taskCompleted?: boolean`、事件类型 `'task_completed'`

### M3 窄接口（`M3_WORKBENCH_BRIDGE_METHODS`，5 项，均无碰撞）
- **`commitM3ApprovedDraft`**（**F10 改名**：原 `commitApprovedDraft` 与旧 preload 同名碰撞）
- `undoDraftChange`
- `getMigrationReport`
- `openExternalProjectResult`
- `subscribeM3ExternalProjectEvents`
- **`M3ExternalProjectEvent` 新增字段**：
  - **F04**：`scopeEpoch?: number | null`、`writerEpoch?: number | null`

---

## 4. 全部验收命令执行结果与冻结边界核查

在 `/Users/aston/DSH/wt/dsh-agent-refactor-m0` 下全部顺序执行并均以退出码 `0` 通过：

1. `npm run lint`：**PASS**（0 errors, 0 warnings）
2. `npm run typecheck`：**PASS**（`tsconfig.app.json` + `tsconfig.node.json` + `tsconfig.mcp.json` 全通过）
3. `npm run typecheck:desktop`：**PASS**（`tsconfig.desktop.json` 通过）
4. `npm test`：**PASS**（**149 个测试文件全部通过，1512 条测试用例全部通过**；其中 `src/workspace/project-agent/` 14 个文件 131 条用例全通过，含新增的 F03/F04/F06/F07/F08/F09/F10/F11/F12 回归单测）
5. `npm run build`：**PASS**（`tsc -b && vite build` 成功产出 `dist/`）
6. `git diff --stat -- desktop/shared/contracts.ts desktop/preload desktop/main`：**空输出（0 改动）**，冻结边界严格保持不变。
7. 路由与边界核查：既有路由 `#/desktop`、`#/desktop-m0-preview`、`#/desktop-m1-readonly`、`#/desktop-m1-workbench` 及零手动参数入口边界全部保持不变并通过回归测试。

---

## 5. 遗留问题与风险

- **本卡范围内无遗留缺陷**。
- F01 / F02 / F05 / F13 属前后端合流与后端几何/preload 接线项（不在本卡范围）；后续桌面端 preload 接线时请直接对接本报告第 3 节的无碰撞窄接口名称（`locateM2Evidence`、`commitM3ApprovedDraft`）以及 `M2PreviewEvent` / `M3ExternalProjectEvent` 的 `scopeEpoch` / `writerEpoch` / `taskCompleted` 字段。
