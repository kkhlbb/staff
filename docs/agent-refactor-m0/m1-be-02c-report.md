# M1-BE-02C 主进程写入端口交付

工作树 `/Users/aston/DSH/wt/gpt-agent-refactor-m1-entry-20261123-1948`，分支 `agent/gpt-agent-refactor-m1-entry-20261123-1948`。保留派发前的 M1 和 BE-01 工作树变更。依据为 BE-02 接线计划和《寸链_机械制图Agent重构开发文档》第二部分 §3。落盘复用项目内事务队列及临时文件同步、同目录重命名策略。[Node.js File system](https://nodejs.org/api/fs.html#filehandlesync)

## 冻结入口

A/B 从 `desktop/main/project-agent/m1LocalAuthority.ts` 的同一个 `LocalM1Authority` 实例调用。参数和结果类型来自该文件和 `desktop/main/project-agent/m1StageContracts.ts`。

```ts
type M1WriterRequest = {
  windowId: number
  sessionId: string
  projectId: string
  expectedWriterEpoch: number
}
type M1WriterConfirmation = (target: Readonly<{
  windowId: number
  projectId: string
  projectPath: string
  takeover: boolean
}>) => Promise<'approve' | 'deny' | 'cancel'>
// 只接受此实例签发的对象引用。
declare const writerLease: unique symbol
type M1WriterLease = Readonly<{
  writerToken: string
  writerEpoch: number
  baseRevision: string
  draftRevision: string | null
  [writerLease]: true
}>
type M1StageOperation =
  | ({ type: 'createSpacerDraft' } & Partial<Omit<M1CreateSpacerDraft, 'type'>>)
  | ({ type: 'resumeSpacerDraft'; taskId: string } & Partial<Omit<M1CreateSpacerDraft, 'type'>>)
type M1StageChangeRequest = {
  baseRevision: string | null
  expectedDraftRevision: string | null
  idempotencyKey: string
  operation: M1StageOperation
  sources: Partial<M1SpacerDraft['sources']>
}
type M1StageResult =
  | M1SpacerDraft
  | { draftRevision: null; activity: M1Activity }
  | { kind: 'clarification'; code: 'UNSUPPORTED_SCOPE'; question: string }
type M1WriterContext = {
  baseRevision: string
  draftRevision: string | null
  cursor: number
  spacerDraft: M1SpacerDraft | null
}

acquireWriter(request: M1WriterRequest, confirm: M1WriterConfirmation): Promise<M1WriterLease>
takeOverWriter(request: M1WriterRequest, confirm: M1WriterConfirmation): Promise<M1WriterLease>
stageChange(lease: M1WriterLease, request: M1StageChangeRequest): Promise<M1StageResult>
readWriterContext(lease: M1WriterLease): Promise<M1WriterContext>
registerStageReference(lease: M1WriterLease, content: string): Promise<string>
revokeWriter(lease: M1WriterLease): Promise<void>
```

`M1CreateSpacerDraft`、`M1SpacerDraft` 和 `M1Activity` 来自 `desktop/shared/project-agent/m1-fields.ts`。尺寸是 q 整数，来源为 `userInput` 或带指纹和锚点的 `document`，由现有隔套校验和任务状态机处理。底层入口 `desktop/main/project-agent/m1InternalService.ts` 的 `stageChange(id: string, caller: Caller, credentials: Omit<Credentials, 'idempotencyKey'>, raw: unknown, verify: VerifyM1Binding): Promise<M1StageResult>` 供授权所有者调用。A/B 使用上面的授权所有者入口。候选 renderer 契约 `m1-entry-1933.ts` 保留其创建隔套和成功结果形状，A/B 后续负责外层传输 ID、授权封装及错误转换。

## 生命周期、错误与重放

- 先由可信窗口完成现有只读授权。A/B 在主进程验证并维护各自的入口身份，将主进程选定的窗口、会话、项目和可信确认回调交给授权所有者。主进程读取本机主体并分配独立写入调用方及授权引用。确认目标包含经验证的规范路径，确认前后均校验绑定。只读凭据仍保持只读。写入租约须由所属适配器持有，跨进程或模型消息使用各适配器自己的已认证映射。
- 同一文件绑定的 acquire 与 takeover 共用事务和预期 epoch。已占用或 epoch 不符返回 `WRITER_HELD`。成功接管原子禁用先前写授权、替换 token 并增加 epoch。旧租约的排队请求、迟到请求和重放都返回 `WRITER_REVOKED`。`revokeWriter` 支持可信入口断开后主动释放。撤权、导航、会话切换、另存和外部替换沿用文件绑定生命周期，授权或文件校验失效返回 `AUTH_REQUIRED`。
- C 的基准版本选用经验证的项目文件 SHA-256 指纹。普通保存推进同一文件绑定，保留日志及写入租约。保存期间可短暂返回 `AUTH_REQUIRED`，结束后调用 `readWriterContext` 读取新指纹和当前草稿版本。入口允许候选契约里的 `null`，已验证的磁盘项目以真实指纹参加比较。新请求任一版本不符返回 `STALE_BASE`。事务校验后、提交前再验绑定和生命周期。进程外文件变更无法与日志重命名做跨文件原子提交，检查覆盖到重命名发起前。
- 幂等作用域为文件绑定内的项目、用户、写入调用方及 `stageChange`，创建和续接共享键空间。先验当前授权、token、epoch，再查回执。相同逻辑输入重放原结果，不增加修订、活动或序号。已使用的键配不同有效输入返回 `IDEMPOTENCY_CONFLICT`。新授权或重启属于新写入调用方。重启后重新授权、读取草稿和游标，再申请租约。
- 创建仅适用于空草稿，已存在草稿返回 `DRAFT_NOT_EMPTY`。初次缺项保存一条 `awaitingInput` 活动及回执；续接携带该租约拥有的 `taskId` 及完整尺寸和来源。其他调用方的待答任务返回 `TASK_SCOPE_MISMATCH`，同一调用方续接终态任务返回 `INVALID_TRANSITION`。无效形状、尺寸或不完整的续接返回 `INVALID_REQUEST`。文档来源通过已授权引用和指纹校验，失败返回 `REFERENCE_STALE`。
- C 的操作白名单为隔套创建和续接。越界类型返回 `UNSUPPORTED_SCOPE` 澄清结果且无写入，未占用幂等键。有效新草稿、任务变化、来源和回执使用同一记录落盘。C 新落盘事件携带 `projectId`、`baseRevision`、`draftRevision`、`jobId`、`sequence`、`type`，当前无构建 job，故 `jobId` 为 `null`。D 可沿用当前 `readEvents` 和 M1 全事件页校验读取这些事件。写入前的 I/O 失败返回 `SAVE_FAILED`，重命名后的不确定结果以完整记录匹配确认。

## 改动清单

| 文件 | 改动 |
| --- | --- |
| `desktop/main/project-agent/m1LocalAuthority.ts` | 可信写入确认、租约签发、内部写入入口、撤权与完整事件读投影 |
| `desktop/main/project-agent/m1FileBindings.ts` | 重命名前复核路径及文件身份 |
| `desktop/main/project-agent/m1InternalService.ts` | 串行接管与 stageChange、CAS、白名单、回执、完整日志与失败清理 |
| `desktop/main/project-agent/m1StageContracts.ts` | 主进程请求、结果、上下文和绑定校验类型 |
| `desktop/tests/projectAgentM1StageChange.test.ts` | 并发、接管、会话切换、幂等、双 CAS、澄清、引用、保存、失败及重启回归 |
| `docs/agent-refactor-m0/m1-be-02c-report.md` | 接线签名、生命周期和验证记录 |

## 验证

| 命令 | 退出码 | 计数 |
| --- | ---: | --- |
| `npm run test:desktop -- desktop/tests/projectAgentM1StageChange.test.ts` | 0 | 1 文件，11 通过 |
| `npm run typecheck` | 0 | 静态检查 |
| `npm run typecheck:desktop` | 0 | 静态检查 |
| `npm run lint` | 0 | 静态检查 |
| `npm run test:desktop -- desktop/tests/projectAgentM1*.test.ts desktop/tests/projectAgentCompatibility.test.ts desktop/tests/preloadContract.test.ts desktop/tests/mountingPlateTaskbook.test.ts` | 0 | 16 文件，124 通过 |
| `node --test desktop/tests/projectAgentM0.node.mjs` | 0 | 28 通过 |
| `git diff --check` | 0 | 无空白问题 |

首轮桌面类型检查发现测试类型和可空会话收窄问题，首轮组合回归发现临时目录清理与异步撤权竞争。修复后按上表重跑。重启测试用新主进程授权所有者和新服务实例读取原物理文件与落盘记录。真实 Electron GUI 导航、整进程退出和机器掉电恢复、A/B 实际客户端、生产订阅、正式保存与提交属于后续验证。此次未开 PR。
