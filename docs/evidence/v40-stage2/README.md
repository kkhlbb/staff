# V4.0 阶段 2 交付与证据：Agent 调度与模型适配器（假模型验通路）

## 范围与基线

开工实际 `HEAD=77a5561`（阶段 1 合并提交），分支 `main`，`git status --short` 无输出；从此创建 `agent/v40-stage2`。只做调度骨架、可替换适配器接口与 `fake` 适配器；**没有真实模型调用、没有 UI、没有正式提交能力**。未 merge、push、删除分支或发布。

## 实现清单

- `src/agent/types.ts`：`ModelAdapter` / `ModelRequest` / `ModelReply` / `ModelEvent` 契约，`AgentTask` / `AgentStep` 记录形状，11 个任务状态。
- `src/agent/stateMachine.ts`：合法迁移表显式定义；非法迁移返回 `INVALID_INPUT` 并保持原状态。`failed → reading` 允许恢复；`cancelled`、`completed` 是终态。
- `src/agent/toolSchemas.ts`：五个 `agent:*` 工具的参数 JSON Schema（`context/confirmed/apply/stage/preview`）与严格子集校验器。缺字段、类型错、未声明字段、非对象、非 JSON、`valueMm`/`deltaMm` 同时出现或同时缺失都拒绝；错误信息只写字段路径，不回显参数值。
- `src/agent/redact.ts`：绝对路径、`sk-*`、Bearer、api key 形式一律替换；长文本截断为短前缀 + 长度 + 指纹。任务记录写盘前还有一道 `sensitiveFindings` 拒绝。
- `desktop/main/agentScheduler.ts`：调度循环、状态迁移、预算、超时、串行写锁、取消、陈旧回包丢弃、恢复、步骤落盘。模型只能发工具调用；参数通过 JSON Schema 后才交给 `AgentToolDispatcher`（生产实现调用阶段 1 `AgentToolService.run`）。
- `desktop/main/agentTaskStore.ts`：`workspace/agent-tasks/<sha256(taskId)>.json` 单任务单文件，临时文件 → 回读 → rename 原子写；不写 `.cunlian`。
- `desktop/main/modelAdapter.ts`：`FakeModelAdapter`（正常、超时、连接失败、非 JSON、延迟回包）、`ModelAdapterRegistry`、`ModelConfig.getProviderStatus()` 固定返回 `{ configured: false, provider: null }`；`OPENAI_RESPONSES_1` 只作为接口标识保留。
- `desktop/main/keychain.ts`：macOS Keychain 预留接口；`read` 固定 `null`，`write` 抛 `KEYCHAIN_WRITE_DEFERRED_TO_STAGE_4`。本阶段不读写任何密钥。
- `desktop/main/agentRuntime.ts`：把调度器接到阶段 1 工具服务的装配工厂，供阶段 3 的 IPC/侧栏调用。
- `desktop/tests/agentScheduler.test.ts`：S2-01 ～ S2-12 十二条状态级验收。
- `scripts/v40-stage2-{verify,mutations}.mjs`：完整命令日志、变异红绿与证据守卫。

### 状态与预算的口径

- 正常路径：`idle → reading → executing → reading → … → checking → ready-to-commit`。阶段 2 停在 `ready-to-commit`，不进入 `committing`。
- 预算触顶进 `awaiting-input`（`BUDGET_EXHAUSTED`）：§7 要求“达到上限时保留状态和证据，让用户决定继续”，属于可继续的人工决策点，不是不可恢复的故障。
- 同一工具连续两次相同失败进 `failed`（`REPEATED_FAILURE`）：自动重试无意义，需人工处理。
- 模型超时进 `failed`（`TIMEOUT`），已完成工具草稿保留；`resumeTask` 从 `failed → reading` 追加新步骤，不复写旧记录。
- 取消时未执行调用丢弃；已进入执行的调用 `await` 到成功/失败边界，`cancelOutcome` 与步骤记录真实结果，不会出现“显示已取消但文件已写”的矛盾。

## 实际验收结果

`desktop/tests/agentScheduler.test.ts` 十二条全部通过：

| 编号 | 场景 | 实际断言结果 |
|---|---|---|
| S2-01 | 假模型正常 context → stage → preview → done | 终态 `ready-to-commit`；8 次合法迁移按表；7 步（model/tool/model/tool/model/tool/model）；工具序列 context/stage/preview；草稿与任务文件落盘 |
| S2-02 | 模型超时 | `TIMEOUT`、`failed`；草稿字节不变；恢复前先经 `context` 读取当前项目并记一步，恢复后 `completed`；步骤由 1 条变 5 条，旧步骤 ID 保留 |
| S2-03 | 连接失败 / 返回非 JSON | 两种均 `TOOL_FAILED`、`failed`；工具调用 0 次；任务记录落盘 |
| S2-04 | 缺字段 / 类型错 / 多字段 / 非 JSON 参数 | 4 条均 `INVALID_INPUT`；调度器未调用任何工具；参数值未回显到记录 |
| S2-05 | 模型说“已保存”但工具 `STALE_BASE` | 终态 `failed`，不是 `completed`；错误码取工具回执；磁盘无草稿 |
| S2-06 | 21 次工具调用 | 实际执行 20 次；第 21 次记 `BUDGET_EXHAUSTED`；终态 `awaiting-input`；步骤与任务文件保留 |
| S2-07 | 同一工具连续两次相同失败 | 执行 2 次后 `REPEATED_FAILURE`、`failed`；错误信息含“连续 2 次” |
| S2-08 | 取消时仍有回包 / 已进入执行 | 回包未执行、记 `CANCELLED`；已进入执行的 stage 跑到成功边界，草稿已写且 `cancelOutcome={tool:'stage',result:'ok'}` |
| S2-09 | 切换项目后旧任务回包 | 按 taskId+projectId 丢弃，记 `STALE_REPLY`；新项目目录树逐字节不变；旧任务为 `cancelled` |
| S2-10 | 同项目第二个写任务 | `CONSTRAINT_VIOLATED`；只存在 1 个任务文件 |
| S2-11 | 任务记录脱敏 | 记录中无 `/Users/`、无 `sk-live-*`、无 480 字 PDF 片段；保留 `<path>`、`<secret>`、工具名与 `12.04` |
| S2-12 | 未配置模型 | `MODEL_NOT_CONFIGURED`；不创建任务目录；`getProviderStatus()` 严格等于 `{configured:false, provider:null}` |

假模型完整会话脱敏轨迹：`fake-session-trace.json`，由 S2-01 在 `V40_RECORD=1` 时经 `scripts/evidence-json.ts` 的 `serializeEvidence` 生成；实测 `evidenceViolations` 为空。轨迹含 7 步、11 个模型事件、context/stage/preview 三次真实调度参数与草稿字节，机器路径 0 处、`sk-` 0 处。

## 变异（红 → 恢复绿）

`node scripts/v40-stage2-mutations.mjs`，patch 与红绿日志在 `mutations/`：

| 变异 | 内容 | 红（exit 1） | 恢复绿 |
|---|---|---|---|
| M10 | 去掉 `validateToolArguments` 参数 Schema 门禁 | S2-04：`expected [...] to have a length of +0 but got 3`（非法参数被调度） | exit 0 |
| M11 | 模型自述优先于工具回执（有文本即 `completed`） | S2-05：`expected 'completed' to be 'failed'` | exit 0 |
| M12 | 去掉陈旧回包的 projectId 校验 | S2-09：`expected 'completed' to be 'cancelled'`（旧任务继续执行） | exit 0 |

变异脚本结束前校验源文件与原始字节一致，未留下变异代码。

## 命令与原始输出

`node scripts/v40-stage2-verify.mjs`，日志在 `logs/`，汇总在 `verification.json`：

    npm exec -- vitest ... desktop/tests/agentScheduler.test.ts --reporter=verbose  exit 0  (12/12)
    npm run typecheck                 exit 0
    npm run typecheck:desktop         exit 0
    npm run lint                      exit 0
    npm run test                      exit 0  (96 文件 / 1013 用例)
    npm run test:desktop              exit 0  (31 文件 / 229 用例)
    npm run build                     exit 0
    npm run package:desktop           exit 0  (打包 pdf worker 校验 PASS)

单测由阶段 1 的 1008 增至 1013：新增 `src/agent/toolSchemas.test.ts` 3 条（五个工具合法参数、非法参数、状态机迁移），以及两个阶段 2 证据 JSON 使 `evidenceRepro.test.ts` 的 STAGE 2 覆盖各增加 1 条（不是产品测试遗漏）。桌面测试由 217/30 增至 229/31（新增本文件 12 条）。

## 未做项与已知限制

- **没有真实模型调用**：只有 `FakeModelAdapter`；`openai-responses-1` 仅有接口标识。
- **没有 UI**：无任务侧栏、无启动/取消按钮、无 IPC 通道；`agentRuntime.ts` 只提供装配工厂。
- **没有正式提交能力**：任务最多停在 `ready-to-commit`；`commitApprovedDraft`、`ApprovalRecord` 属于阶段 3。
- 调度器尚未在 `desktop/main/index.ts` 实例化，也没有把项目切换事件接到 `setActiveProject`；阶段 3 接侧栏时一并完成。
- 任务记录按任务单文件保存，`AgentTaskStore.load` 已实现，但没有跨重启的任务索引/列表；阶段 3 的恢复入口需要补。
- JSON Schema 校验器只覆盖本仓库使用的子集（无 `$ref`、`format`、递归 schema）；五个工具之外的名字一律 `INVALID_INPUT`。
- 取消期间已进入执行的工具不会强制中止，必须等待真实边界；这是 §7 的明确要求，不是性能遗漏。
- 脱敏保留短前缀（≤80 字）与指纹用于人工比对；完整 PDF、完整提示词不落盘。

## 阶段 3 / 4 依赖

阶段 3（用户授权与工作台）需要：

- `ApprovalRecord` 与一次性授权签名（绑定窗口、项目、草稿、条款、预览指纹、有效期）。
- `commitApprovedDraft`：重新计算 + 原子保存 + 幂等提交；把 `ready-to-commit` 接进 `committing → completed`。
- `locateEvidence` 与任务侧栏 UI（任务输入、步骤、待答问题、最近工具结果）。
- 调度器 IPC：`startTask` / `cancel` / `resume` / 状态订阅；项目切换时调用 `setActiveProject`。
- 跨重启任务索引与恢复入口；`AgentTaskStore.load` 已就绪但未接 UI。

阶段 4（真实模型验收）需要：

- `openai-responses-1` 适配器实现 + 供应商契约测试 + 费用/超时记录。
- macOS Keychain 真实读写（`MacKeychainStore` 现为空实现），密钥不得进入项目文件、日志、证据。
- 在真实模型上跑 A40-01～09，完整建项与超限改图各重复三次并记录波动；打包应用回归。
