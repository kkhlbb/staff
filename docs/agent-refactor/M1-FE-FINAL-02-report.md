# M1-FE-FINAL-02 交付与验收报告

## 1. 修改与新增文件清单

本次任务共修改 **6** 个前端文件，新增 **1** 个报告文件（合计 **7** 个文件）；冻结边界目录（`desktop/shared/contracts.ts`、`desktop/preload`、`desktop/main`）保持 **0 改动**。

### 修改文件（6）
1. `src/workspace/project-agent/m1WorkbenchBridge.ts` — 新增 P1-1 纯函数 `applyAuthoritativeScopeEpochSync`（同步 `AUTH_REQUIRED.detail` 的权威 `scopeEpoch` 时同步重置 `writerEpoch` 基线为 `0`）；新增 P1-3 常量 `MAX_M1_CHAT_HISTORY = 32`、`MAX_M1_CHAT_ATTACHMENTS = 8` 及纯裁剪函数 `trimM1ChatHistory`、`trimM1ChatAttachments`；新增 P1-5 窄探测函数 `probeM1ProjectAuthorization` / `resolveWindowM1ProjectAuthorization`（duck-typing 探测 `requestM1ProjectAuthorization`）。
2. `src/workspace/project-agent/m2WorkbenchBridge.ts` — 新增 P1-4 `drawingStateGeneration` 状态代际字段，覆盖同修订的 `drawing_failed` 与 `drawing_ready`（同时保留 `drawingFailureGeneration` 兼容）；扩展 `applyM2DrawingRetryResult` 支持校验 `expectedDrawingStateGeneration`，防止迟到图纸重试成功覆盖同修订较新的 `drawing_ready`。
3. `src/workspace/project-agent/ProjectAgentM1Workbench.tsx` — 联动闭环 P1-1（`syncScopeEpochFromAuthError` 重置 `writerEpoch` 基线为 `0` 且 `snapshot_required` 建立新 `writerEpoch`）、P1-2（区分演示模式/显式注入夹具与真实 `sendM1ChatMessage` 桥接上下文，严禁向真实桥接发送硬编码示例 ID）、P1-3（发送前严格裁剪 `history <= 32` 与 `attachments <= 8`，超限 8 条时在 UI 给出清晰提示并阻止超限）、P1-4（重试图纸捕获并校验 `drawingStateGeneration`，迟到成功返回严格丢弃且释放 loading 状态）、P1-5（内联探测并衔接 `requestM1ProjectAuthorization` 原生只读授权前置链，未授权禁止触发 `takeoverM1Draft`，`connectionSource === 'none'` 时强制用户通过明确控件选择目标入口）。
4. `src/workspace/project-agent/m1WorkbenchBridge.test.ts` — 新增 P1-1、P1-3、P1-5 纯函数单元测试（3 项）。
5. `src/workspace/project-agent/m2WorkbenchBridge.test.ts` — 新增 P1-4 `drawingStateGeneration` 迟到图纸重试防覆盖单元测试（1 项）。
6. `src/workspace/project-agent/ProjectAgentM1Workbench.test.tsx` — 为既有聊天/接管测试对齐 P1-2 显式夹具与 P1-5 只读授权前置链，补齐 B3 的“二次订阅携带 `afterSequence`”断言，并新增 P1-1 至 P1-5 完整组件级回归测试（5 项）。

### 新增文件（1）
7. `docs/agent-refactor/M1-FE-FINAL-02-report.md` — 本验收报告。

---

## 2. P1-1 至 P1-5 修复点与自动化回归用例逐条对照

| 编号 | 修复点与实现摘要 | 对应自动化回归测试用例 | 结果 |
| --- | --- | --- | --- |
| **P1-1** | `m1WorkbenchBridge.ts` 导出 `applyAuthoritativeScopeEpochSync`，在 `AUTH_REQUIRED.detail` 同步新 `scopeEpoch` 时同步将本地 `writerEpoch` 基线重置为 `0`；`ProjectAgentM1Workbench.tsx` 在 `syncScopeEpochFromAuthError` 中调用并重建订阅，随后 `snapshot_required` 无论是否携带 `snapshot` 均可建立新 `writerEpoch`（如 `scope=2, writer=1` 不被旧 `writer=8` 误弃，旧 `scope=1` 事件仍严格拒绝）；在组件测试中补齐订阅调用 2 次且第 2 次携带 `afterSequence` 的明确断言。 | `m1WorkbenchBridge.test.ts` → `P1-1：applyAuthoritativeScopeEpochSync 同步新 scopeEpoch 时重置 writerEpoch 基线为 0，放行新 scope 的低 writerEpoch 快照并继续拒绝旧 scope 事件`<br>`ProjectAgentM1Workbench.test.tsx` → `M1-BE-02D B3：subscribeM1WorkbenchEvents 消费 snapshot_required 重置超前游标并续读后续事件，且重订阅携带 afterSequence`（补齐 `toHaveBeenCalledTimes(2)` 与 `afterSequence: 12` 断言）<br>`ProjectAgentM1Workbench.test.tsx` → `P1-1：AUTH_REQUIRED.detail 同步新 scopeEpoch 时重置 writerEpoch 基线为 0，触发二次订阅携带 afterSequence，放行新 scope 低 writerEpoch 快照并拒绝旧 scope 事件` | PASS |
| **P1-2** | 移除 `availableObjects` / `availableTaskbooks` 的无条件默认值；仅在无真实聊天桥接的演示模式或 props 显式注入夹具时提供默认示例附件/对象；当真实 `sendM1ChatMessage` 桥接可用但未从当前项目上下文（`initialPreviewSnapshot` 或 M2 实时事件中的 `features`/`requirements` 锚点）解析出真实引用 ID 时，严格发 `attachments: []`、`selectedObject: null`，严禁发送硬编码示例 ID（`tb-plate-p1`、`obj-right-hole`）。 | `ProjectAgentM1Workbench.test.tsx` → `P1-2：真实 sendM1ChatMessage 桥接可用但无当前项目真实引用时严禁发送硬编码示例 ID（attachments=[], selectedObject=null），注入真实项目上下文后仅发送真实 ID` | PASS |
| **P1-3** | `m1WorkbenchBridge.ts` 导出 `MAX_M1_CHAT_HISTORY = 32`、`MAX_M1_CHAT_ATTACHMENTS = 8` 及纯函数 `trimM1ChatHistory`、`trimM1ChatAttachments`；`ProjectAgentM1Workbench.tsx` 在 `toggleTaskbookAttachment` 中对超过 8 条的附加操作阻断并在 UI 给出清晰上限提示及 `已选 X/8` 计数，在 `dispatchChatTurn` 发送前严格裁剪 `history` 为最近 32 条有效消息、`attachments` 最多 8 条，杜绝触发后端 Zod `INVALID_REQUEST`。 | `m1WorkbenchBridge.test.ts` → `P1-3：trimM1ChatHistory 与 trimM1ChatAttachments 严格对齐后端 Zod 上限（history<=32, attachments<=8）`<br>`ProjectAgentM1Workbench.test.tsx` → `P1-3：发送聊天前严格裁剪 history<=32，附加任务书引用超出 8 条时在 UI 给出清晰提示并阻止超限` | PASS |
| **P1-4** | `m2WorkbenchBridge.ts` 在 `M2CanvasState` 中新增 `drawingStateGeneration`，在同修订 `drawing_failed` 与 `drawing_ready` 到达时均递增（同时保持 `drawingFailureGeneration` 兼容递增）；`handleRetryDrawing` 发起时捕获 `expectedDrawingStateGeneration`，若重试挂起期间推送了同修订较新的 `drawing_ready`（或新的 `drawing_failed`），迟到的重试成功返回被严格丢弃，不覆盖较新图纸槽与标注，同时正确释放 `retryDrawingPending`。 | `m2WorkbenchBridge.test.ts` → `P1-4：迟到的图纸重试成功因 drawingStateGeneration 不匹配被严格丢弃，严禁覆盖同修订较新 drawing_ready`<br>`ProjectAgentM1Workbench.test.tsx` → `P1-4：重试图纸在途期间收到同修订较新 drawing_ready 时，早先迟到重试成功被严格丢弃不覆盖较新图纸槽且释放 loading 状态` | PASS |
| **P1-5** | 工作台通过 `probeM1ProjectAuthorization` / `resolveWindowM1ProjectAuthorization` 探测 `requestM1ProjectAuthorization`（支持 `window.cunlian` 与 props 注入）；`authorizationState === 'unauthorized'` 时提供内联「申请原生只读授权」按钮与前置提示“须先完成原生只读授权，再申请写入或接管”，禁用并拦截 `takeoverM1Draft`；缺失方法时诚实提示不可用，返回 `AUTH_REQUIRED` 时展示错误且不伪造授权，成功时校验 `EntryScope` 并更新为 `authorized-readonly`；当 `connectionSource === 'none'` 时禁用盲目硬选 `'local-agent'`，要求通过明确下拉控件选择「本地 Agent」或「模型 API」后再发起写入/接管。 | `m1WorkbenchBridge.test.ts` → `P1-5：probeM1ProjectAuthorization 精确探测 requestM1ProjectAuthorization 可用性`<br>`ProjectAgentM1Workbench.test.tsx` → `P1-5：工作台内联衔接原生只读授权前置链，未只读授权严禁触发 takeoverM1Draft，connectionSource=none 时强制明确选择目标入口` | PASS |

---

## 3. 全量验收命令执行结果与冻结边界核查

工作目录：`/Users/aston/DSH/wt/dsh-agent-refactor-m0`（分支 `agent/dsh-agent-refactor-m0`）

| 验收项 | 命令 | 退出码 | 结果摘要 |
| --- | --- | ---: | --- |
| Lint | `npm run lint` | 0 | 0 errors, 0 warnings |
| Typecheck (app/node/mcp) | `npm run typecheck` | 0 | 全部通过 |
| Typecheck (desktop) | `npm run typecheck:desktop` | 0 | 全部通过 |
| 全量前端测试 | `npm test` | 0 | **149 / 149** 测试文件通过，**1552 / 1552** 测试用例通过（较基线 1543 新增 9 项 P1-1 至 P1-5 回归用例） |
| 生产构建 | `npm run build` | 0 | `tsc -b && vite build` 成功（`built in 221ms`） |
| 冻结边界核查 | `git diff --stat -- desktop/shared/contracts.ts desktop/preload desktop/main` | 0 | 输出为空（0 改动） |

---

## 4. 遗留问题与风险

- QA-FE-04 最后 5 项 P1 集成衔接细节（P1-1 至 P1-5）已在前端工作树内全部闭环并通过全量 lint、typecheck、1552 条单测及生产构建验收，无遗留前端阻塞项。
- 真机桌面端与后端主进程 IPC / preload 合流后的端到端联调验收仍待前后端分支合流后执行。
