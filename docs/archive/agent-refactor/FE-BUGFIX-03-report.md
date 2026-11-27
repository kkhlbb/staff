# FE-BUGFIX-03 修复与回归验证报告

- **任务卡**：`FE-BUGFIX-03`（收口 QA-FE-05 仅余的 2 项前端 P1：R-A 与 R-C）
- **工作目录**：`/Users/aston/DSH/wt/dsh-agent-refactor-m0`
- **分支**：`agent/dsh-agent-refactor-m0`

---

## 1. 修改/新增文件清单

### 修改文件（4 个）
1. `src/workspace/project-agent/m2WorkbenchBridge.ts`
2. `src/workspace/project-agent/ProjectAgentM1Workbench.tsx`
3. `src/workspace/project-agent/m2WorkbenchBridge.test.ts`
4. `src/workspace/project-agent/ProjectAgentM1Workbench.test.tsx`

### 新增文件（1 个）
1. `docs/agent-refactor/FE-BUGFIX-03-report.md`（本报告）

---

## 2. 逐条缺陷修复对照与回归测试结果（R-A & R-C）

| 缺陷 | 优先级 | 具体修复点 | 对应回归测试用例及结果 |
| --- | --- | --- | --- |
| **R-A** | P1 | 1. `ProjectAgentM1Workbench.tsx` 新增 `subscriptionRetryNonce` 状态并将其纳入 `subscribeM1WorkbenchEvents` `useEffect` 依赖。<br>2. 在 `handleRequestReadonlyAuthorization` 原生只读授权成功并经 `acceptAuthorizedEntryScope` 校验通过后，递增 `subscriptionRetryNonce`；当页面以未授权态启动且首次 `subscribeM1WorkbenchEvents` 返回无 `detail` 的 `AUTH_REQUIRED`（`scopeEpoch` 未变化）时，授权成功立即自动触发二次订阅恢复活动与推送流，且不引入死循环、不破坏既有 P1-1 / B3 订阅次数断言。 | - `ProjectAgentM1Workbench.test.tsx`：`R-A：首次 subscribeM1WorkbenchEvents 返回无 detail 的 AUTH_REQUIRED 后，点击内联「申请原生只读授权」成功自动重建订阅并正常渲染新推送事件与活动`（**PASS**） |
| **R-C** | P1 | 1. `m2WorkbenchBridge.ts` 新增导出类型 `M2DrawingRetryRejectionReason`、`M2ApplyDrawingRetryResultStatus` 与纯函数 `applyM2DrawingRetryResultWithStatus`，明确返回 `{ state, applied, rejectedReason? }`（区分 `project_mismatch` / `drawing_failure_generation_mismatch` / `drawing_state_generation_mismatch` / `stale_revision` / `opaque_revision` / `revision_order_collision`），并保留 `applyM2DrawingRetryResult` 原签名委托调用以保持向后兼容。<br>2. `ProjectAgentM1Workbench.tsx` 新增 `canvasStateRef` 与 `canvasState` 同步，在 `handleRetryDrawing` 中调用 `applyM2DrawingRetryResultWithStatus` 精确判定采纳状态（覆盖常规路径及同 tick 竞态）；当旧修订（如草稿 8）重试挂起期间模型推进至新修订（如草稿 9，`drawingStateGeneration` 未变）导致 `applied === false` 时，不覆盖画布、释放 `retryDrawingPending`、递增 `discardedStaleCount`，**严禁**展示“图纸重试成功，已同步更新”，改为清晰提示“旧修订（草稿 8）的图纸重试结果已过期丢弃，当前已推进至新修订（草稿 9）。”。 | - `m2WorkbenchBridge.test.ts`：`R-C：草稿 8 图纸重试挂起期间模型推进至草稿 9（drawingStateGeneration 未变）时，applyM2DrawingRetryResultWithStatus 返回 applied=false 与 stale_revision 且不覆盖画布`（**PASS**）<br>- `ProjectAgentM1Workbench.test.tsx`：`R-C：草稿 8 重试图纸挂起期间模型推进至草稿 9（drawingStateGeneration 未变），迟到草稿 8 重试返回时不覆盖画布、释放 loading、不误报成功且展示过期丢弃提示`（**PASS**） |

---

## 3. 全部验收命令执行结果与冻结边界核查

在 `/Users/aston/DSH/wt/dsh-agent-refactor-m0` 下全部执行并均以退出码 `0` 通过：

1. 新增 R-A / R-C 自动化回归单元测试（`npx vitest run src/workspace/project-agent/m2WorkbenchBridge.test.ts src/workspace/project-agent/ProjectAgentM1Workbench.test.tsx`）：**PASS**（2 个测试文件，46 条用例全部通过）
2. `npm run lint`：**PASS**（0 errors, 0 warnings）
3. `npm run typecheck`：**PASS**（`tsconfig.app.json` + `tsconfig.node.json` + `tsconfig.mcp.json` 全通过）
4. `npm run typecheck:desktop`：**PASS**（`tsconfig.desktop.json` 通过）
5. `npm test`：**PASS**（**153 个测试文件全部通过，1586 条测试用例全部通过**；在原有 153 文件 / 1583 用例基础上新增 3 条 R-A / R-C 回归用例）
6. `npm run build`：**PASS**（`tsc -b && vite build` 成功产出 `dist/`）
7. `git diff --stat -- desktop/shared/contracts.ts desktop/preload desktop/main`：**空输出（0 改动）**，冻结边界严格保持不变。

---

## 4. 遗留问题与风险

- **无遗留问题与阻塞风险**。QA-FE-05 仅余的 2 项前端 P1（R-A 与 R-C）已全部修复并完成纯函数与组件级自动化回归验证及全量前端校验。
