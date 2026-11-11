# V4.0 阶段 3 交付与证据：用户授权与工作台

## 范围与基线

开工实测 `HEAD=b4f2a53`（阶段 2 合并提交），`git status --short` 为空；从 main 建分支 `agent/v40-stage3`。本阶段只做**一次性授权、重算提交、来源定位、任务侧栏 UI**，用阶段 2 的 `fake-1` 假模型驱动；没有真实模型调用、没有 Keychain 写入、没有导出（阶段 4）。未 merge、未 push、未删除分支。交付提交见 `agent/v40-stage3` 分支 HEAD（哈希由交付说明记录，避免把哈希写进被提交的文件本身）。

## 实现清单

- `desktop/main/approvalStore.ts`：`ApprovalRecord` 主进程签发、应用工作区原子落盘（`workspace/approvals/<sha256(id)>.json`），一次性消费、有效期 10 分钟、窗口/项目/草稿/条款/预览指纹/基准绑定。模型与项目文件都拿不到 approvalId。
- `desktop/main/agentToolService.ts`：
  - `preview` 在主进程保存预览记录（`previewId` + `previewFingerprint`），渲染进程只拿到摘要；
  - `issueApproval` 仅由界面确认动作调用，按服务端预览记录签发；
  - `commitApprovedDraft` 校验授权 → 基准 → 从磁盘草稿**重新计算** `computeChange` + 条款检查 → 与授权绑定的预览指纹逐字比较 → `commitRecomputedChange` 条款门禁 → 原子提交；
  - `locateEvidence` 只读定位条款来源/检查/参数与环；
  - `prepareDemoDraft` 只为侧栏离线演示准备“与正式参数相同”的草稿，只写应用工作区。
- `desktop/main/agentSessionChannels.ts`：每窗口装配 AgentScheduler、`agent:start/cancel/resume/task-state/preview-summary/issue-approval/commit-approved-draft/locate-evidence/provider-status` 通道与 `agent:event` 推送；全部做 sender 白名单与严格 schema。
- `desktop/main/agentScheduler.ts`：新增可选 `onUpdate`，任务/步骤落盘后通知侧栏；调度判定不变。
- `desktop/main/index.ts` / `desktop/preload/index.ts` / `desktop/shared/contracts.ts`：装配、桥接与新通道类型（旧函数只增不改）。
- `src/components/AgentSidebar.tsx` + `.css`：可折叠覆盖式侧栏（任务输入、活动项目、执行步骤、待答问题、最近工具结果、预览摘要与确认保存）。只渲染工具名 + 结果码；模型文本不进入步骤或结论位。
- `src/pages/DesktopWorkspace.tsx`：接入侧栏、定位回调与 `localStorage` 折叠状态。
- 测试：`desktop/tests/agentApproval.test.ts`（S3-01～08 状态级）、`src/components/AgentSidebar.test.tsx`（S3-09～11 渲染契约）、`desktop/tests/e2e/v40stage3.mjs`（打包真点击）。

## 授权记录与令牌策略

```ts
interface ApprovalRecord {
  approvalId: string
  windowId: number
  projectId: string
  draftId: string
  draftRevision: number
  requirementRevisionId: string | null
  previewFingerprint: string
  baseRevisionId: string   // 阶段 3 为 STALE_BASE 判定增加的审计字段
  createdAt: string
  expiresAt: string        // 10 分钟
  consumedAt: string | null
}
```

签发路径只有一条：`AgentSidebar` 点击「确认保存」→ `agent:issue-approval` → `AgentToolService.issueApproval` → `ApprovalStore.issue`。`approvalId` 不回传到工具参数、不写项目文件、不下发模型。

**令牌策略：选择“失败也消费”**（更准确：通过授权身份、基准、重算与预览指纹校验后，在项目原子写入之前消费；此后的任何失败都不退还授权）。

理由：

1. 消费落盘发生在正式写入之前，消除了“项目已提交但 consumedAt 还没落库”的窗口；重启后不可能用同一授权再提交一次。
2. 项目写入本身仍是 `saveAtomic`（临时文件 → 回读校验 → rename），失败不会半提交；但此时授权已消费，用户必须重新预览确认，避免在失败后沿用旧授权静默重试。
3. 若校验或重算失败（授权过期、指纹不符、条款不满足），尚未消费，授权保持原状态；这类失败不会产生任何项目写入。

`reserve` 在第一个 `await` 之前占用 `claims`，并发双击的第二个调用直接 `INVALID_INPUT`；成功消费后缓存中的 `consumedAt` 也阻止任何后续占用。ENOSPC 场景（S3-06）实测：项目/历史字节不变、`consumedAt` 已落库、同一 approvalId 重试返回 `INVALID_INPUT / APPROVAL_CONSUMED`。

## `commitApprovedDraft` 的校验顺序

1. `reserve`：存在、未消费、未过期、窗口相符（`INVALID_INPUT` / `NOT_CONFIRMED`）。
2. 项目、草稿身份、请求预览指纹与授权记录一致（`NOT_CONFIRMED`）。
3. 授权签发的 `baseRevisionId` = 当前正式版本（`STALE_BASE`）。
4. 读磁盘草稿：身份、工程基准、来源决定与来源字节（`STALE_BASE` / `NOT_CONFIRMED`）。
5. **重新计算**：`computeChange` + `computeCandidateRequirementCheck`；重建预览指纹。
6. 重算指纹 ≠ 授权指纹 → `STALE_PREVIEW`（M14 锚点）。
7. 草稿版本、条款版本防御性校验（`NOT_CONFIRMED`）。
8. `commitRecomputedChange` 条款门禁（不满足 → `CONSTRAINT_VIOLATED / REQUIREMENT_NOT_SATISFIED`）。
9. 消费授权 → `ProjectService.commitCandidate` 原子写入（失败 → `SAVE_FAILED`，无半提交）。

错误码映射：`STALE_DRAFT`/`STALE_REQUIREMENT` → `STALE_PREVIEW`；`REQUIREMENT_PENDING_CONFIRMATION`/`REQUIREMENT_UNCHECKED` → `NOT_CONFIRMED`；其余工程输入错误 → `CONSTRAINT_VIOLATED`。

## 实际验收结果

`docs/evidence/v40-stage3/logs/s3-tests.log`（8/8）：

| 编号 | 场景 | 实际断言结果 |
|---|---|---|
| S3-01 | 正常：预览 → 用户确认 → 提交 | 新版本 `rev-a-*`；`fileRevisions` +1；`currentRevisionId` = 回执版本；`consumedAt` 已落库；提交后 `previewSummary` 为 null |
| S3-02 | 未授权直接调 commit | `INVALID_INPUT`；项目文件字节完全一致 |
| S3-03 | 伪造/过期/跨窗口/跨项目/跨草稿 | 伪造 `INVALID_INPUT`；跨草稿 `NOT_CONFIRMED / DRAFT_MISMATCH`；请求指纹不符 `NOT_CONFIRMED / PREVIEW_MISMATCH`；跨窗口 `NOT_CONFIRMED / WINDOW_MISMATCH`；跨项目 `NOT_CONFIRMED / PROJECT_MISMATCH`；过期 `NOT_CONFIRMED / APPROVAL_EXPIRED`；项目字节不变 |
| S3-04 | 同一令牌双击/重试 | 并发两次恰 1 成功、1 `INVALID_INPUT`；`fileRevisions` 只 +1；已消费记录再 `reserve` 返回 `APPROVAL_CONSUMED`；顺序重试拒绝且 `consumedAt` 不变 |
| S3-05 | 预览后改参数再提交 | `STALE_PREVIEW / PREVIEW_STALE`；项目字节不变；重新预览 + 新授权后才成功 |
| S3-06 | 提交注入 ENOSPC | `SAVE_FAILED / NO_SPACE`；项目字节、正式版本数不变；`consumedAt` 已落库；重试 `INVALID_INPUT / APPROVAL_CONSUMED` |
| S3-07 | 条款不满足时授权提交 | 预览 `requirement.status=unsatisfied`；提交 `CONSTRAINT_VIOLATED / REQUIREMENT_NOT_SATISFIED`；正式版本不变 |
| S3-08 | `locateEvidence` | 条款版本 → 第 2 页 `sr-1`；`checkId` → 同一条款版本；参数 → `t-s` 绑定；调用前后项目字节完全一致；不存在/多参数 → `INVALID_INPUT` |

`docs/evidence/v40-stage3/logs/s3-ui-tests.log`（4/4）：

| 编号 | 场景 | 实际断言结果 |
|---|---|---|
| S3-09 | 侧栏工具失败 | 显示 `failed · INVALID_INPUT`、`stage · INVALID_INPUT` 与待答问题 `INVALID_INPUT`；无“已完成/已保存”；无预览时不出现「确认保存」 |
| S3-10 | 折叠/展开与状态保留 | 收起时只有侧栏轨；点击回调一次；`localStorage` 写入/读取往返保持；重新渲染展开 |
| S3-11 | 模型声称成功但工具失败 | 状态与步骤以回执为准（`failed · CONSTRAINT_VIOLATED`、`stage · CONSTRAINT_VIOLATED`）；模型步骤只显示 `model`；无成功文案 |
| S3-09/01 | 提交回执成功才显示成功 | 只有 `commitApprovedDraft.ok` 后出现“已提交（工具回执） · 版本 rev-a77”；调用参数与预览记录一致 |

打包应用真点击（`docs/evidence/v40-stage3/e2e-result.json`，verdict=pass）：
- 侧栏展开并识别“真实模型：未配置（阶段 4）/ 离线演示（假模型，不联网）”；
- 正常演示出现可点击「确认保存」，点击后出现真实提交回执；
- 锁定参数演示显示 `CONSTRAINT_VIOLATED` 与待答问题，侧栏无模型自述成功文案；
- 非法数值演示显示 `failed · INVALID_INPUT`，侧栏无“已完成/已保存”；
- 960×640 下中央画布 `canvasWidth=404`（侧栏为覆盖层，不改变网格列宽）、`canvasHeight≈394`；折叠后 `Page.reload` 仍保持收起。

## 变异（红 → 恢复绿）

`node scripts/v40-stage3-mutations.mjs`，patch 与红/绿日志在 `mutations/`：

| 变异 | 内容 | 红 | 恢复绿 |
|---|---|---|---|
| M13 | 移除 `reserve` 的一次性/占用/窗口/有效期门禁 | S3-04：第二个并发提交返回 `STALE_BASE` 而非 `INVALID_INPUT`（一次性消费不再被识别；基准绑定仍独立阻止第二个版本） | exit 0 |
| M14 | 提交时不比较重算指纹 | S3-05：期望 `STALE_PREVIEW / PREVIEW_STALE`，实际 `NOT_CONFIRMED / DRAFT_REVISION_MISMATCH` | exit 0 |
| M15 | 侧栏用成功文案/模型自述替代工具回执 | S3-09 与 S3-11：找不到失败码、出现“已完成” | exit 0 |

脚本结束前逐文件校验源文件与原始字节一致。

M13 的说明：本实现有**两层**保护——一次性消费（reserve）与基准绑定（提交前比对 `baseRevisionId`）。移除前者后，第二个并发提交被后者拦成 `STALE_BASE`，因此仍然只产生一个版本；S3-04 通过断言“第二次必须是 `INVALID_INPUT`（消费语义）”使变异变红，并在正常路径额外直接断言 `reserve` 返回 `APPROVAL_CONSUMED`。这不是“变异无效”，而是如实记录两层门禁同时存在。

## 命令与原始输出

`node scripts/v40-stage3-verify.mjs`，日志在 `logs/`，汇总在 `verification.json`：

    npm exec -- vitest ... desktop/tests/agentApproval.test.ts   exit 0  (1 文件 / 8 用例)
    npm exec -- vitest ... src/components/AgentSidebar.test.tsx  exit 0  (1 文件 / 4 用例)
    npm run typecheck                exit 0
    npm run typecheck:desktop        exit 0
    npm run lint                     exit 0
    npm run test                     exit 0  (97 文件 / 1019 用例)
    npm run test:desktop             exit 0  (32 文件 / 237 用例)
    npm run build                    exit 0
    npm run package:desktop          exit 0  (打包 pdf worker 校验 PASS)
    node desktop/tests/e2e/v40stage3.mjs  exit 0  (6 项检查全 pass)

单测由阶段 2 的 1013 增至 1019：新增 `AgentSidebar.test.tsx` 4 条；`evidenceRepro.test.ts` 对两份新证据 JSON（`e2e-result.json`、`verification.json`）各增加 1 条覆盖。桌面测试由 229/31 增至 237/32（新增 `agentApproval.test.ts` 8 条）。

## 截图

`docs/evidence/v40-stage3/screenshots/`：

- `v40-stage3-01-sidebar-expanded.png`：侧栏展开、预览摘要、预览指纹与「确认保存」；
- `v40-stage3-02-pending-question.png`：待答问题 `CONSTRAINT_VIOLATED`（锁定参数）；
- `v40-stage3-03-tool-failure.png`：工具失败 `failed · INVALID_INPUT` / `stage · INVALID_INPUT`；
- `v40-stage3-04-commit-success.png`：点击确认后的真实提交回执；
- `v40-stage3-05-960x640.png`：960×640 下侧栏覆盖、画布仍可操作。

## 未做项与已知限制

- **真实模型仍未配置**：只有 `fake-1`；`openai-responses-1` 仍是接口标识，Keychain 读写留阶段 4。
- **导出未做**：`exportApprovedVersion` 属阶段 4/后续。
- **条款提案不落正式版本**：Agent 草稿里的 `requirementEdit` 只作为提案展示；提交门禁只使用**活动条款版本**。当前没有把 Agent 提案确认成新条款的侧栏流程（仍走既有条款向导，且向导只作用于 ChangeService 草稿）；A40-01 的“任务书条款入正式项目”仍需后续接通。
- 预览记录只在主进程内存：应用重启后旧预览与授权都不可用（失败关闭，需重新预览），没有跨重启预览恢复。
- 任务记录与侧栏没有跨重启索引/恢复入口；每次启动只显示本次进程内任务。
- `locateEvidence` 的 `checkId` 只解析当前检查与历史版本 evidence 中的 checkId；没有独立检查索引。
- 演示入口显式标注为假模型；真实模型未配置时按钮仍可用，因为它是离线演示而非真实执行入口。评审如需完全隐藏演示入口，可在阶段 4 配置真实模型后移除。
- 侧栏为覆盖层：960×640 下会遮住属性栏与部分中央画布（画布本身不缩小，仍可滚动操作），这是避免压缩画布的取舍。
