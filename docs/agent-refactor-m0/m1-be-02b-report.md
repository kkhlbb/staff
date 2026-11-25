# M1-BE-02B 内置模型 API 主进程交付

在 `/Users/aston/DSH/wt/gpt-agent-refactor-m1-entry-20261123-1948` 的 `agent/gpt-agent-refactor-m1-entry-20261123-1948` 分支实现，保留派发前工作树变动。主进程通过真实 HTTP 请求读取可用模型并测试选定模型。模型须实际调用只读探针，并在收到带原始 `tool_call_id` 的探针结果后返回匹配的随机值，连接才可用于对话。配置允许 HTTPS 服务和本地回环 HTTP。格式参考 [OpenAI 模型列表](https://developers.openai.com/api/reference/resources/models/methods/list) 和 [OpenAI Chat Completions 函数调用](https://developers.openai.com/api/docs/guides/function-calling?api-mode=chat)。

## D 接线

从 `desktop/main/project-agent/m1ModelApi.ts` 导入 `M1ModelApi`、`M1ModelScope` 和 `M1ModelAttachment`。每个通过 sender guard 的原生授权代际创建一个实例，跨同一代际的多轮请求复用。构造时传入 A 使用的同一个 `LocalM1Authority`、主进程已创建的 `RealModelRuntime`，以及主进程解析的 scope。导航、授权撤销或会话切换时调用 `dispose()`，同时让旧实例的 `isCurrent()` 返回 false。

```ts
type M1ModelScope = Readonly<{
  sender: SenderInfo
  sessionId: string
  projectId: string
  scopeEpoch: number
  authorizationRef: string
  isCurrent(): boolean
  readAttachment?(ref: string, signal: AbortSignal): Promise<{ excerpt: string; page: number } | null>
  readSelectedObject?(ref: string, signal: AbortSignal): Promise<string | null>
}>

new M1ModelApi(authority: LocalM1Authority, runtime: RealModelRuntime, scope: M1ModelScope)
testM1ModelApiConnection(raw: unknown): Promise<M1ModelResult<M1ModelConnectionResult>>
sendM1ChatMessage(raw: unknown): Promise<M1ModelResult<M1ChatResult>>
cancelM1ChatMessage(raw: unknown): Promise<M1ModelResult<{ cancelled: true }>>
acquireWriter(expectedWriterEpoch: number, confirm: M1WriterConfirmation): Promise<M1ModelResult<{ writerEpoch: number }>>
takeOverWriter(expectedWriterEpoch: number, confirm: M1WriterConfirmation): Promise<M1ModelResult<{ writerEpoch: number }>>
revokeWriter(): Promise<void>
dispose(): Promise<void>
```

`isCurrent()` 同步核对 frame、窗口、项目、会话及可信 scope epoch。写入申请、接管、撤销都由可信主进程操作触发，接管确认沿用 C 的 `M1WriterConfirmation`。Renderer 请求中的 epoch 仅用于匹配可信作用域与租约。附件和选中对象解析器接收不透明 ID，由主进程返回当前已授权的文本摘录或对象摘要。解析器缺失或 ID 失效时返回 `REFERENCE_STALE`。IPC 注册、preload、订阅与 UI 能力标志留给 D。

`desktop/shared/project-agent/m1-model-api.ts` 导出下列类型与运行时 schema，服务在进站时校验完整请求。

```ts
type M1CancelChatRequest = { projectId: string; requestId: string; scopeEpoch: number }
type M1ModelConnectionRequest = M1CancelChatRequest & {
  baseUrl: string; model: string; apiKey: string; contextPreview: boolean
}
type M1ModelConnectionResult = {
  availableModels: string[]; selectedModel: string
  toolCallSupported: boolean; toolRoundTripPassed: boolean
  toolRoundTripName?: string; toolRoundTripLatencyMs?: number; sentContextSummary?: string
}
type M1ChatRequest = M1CancelChatRequest & {
  writerEpoch: number; prompt: string; attachments: string[]; selectedObject: string | null
  history: { role: 'user' | 'assistant'; content: string }[]
}
type M1ChatResult = {
  messageId: string; reply: string; draftRevision?: string
  toolCalls?: { name: string; status: 'awaitingInput' | 'succeeded'; taskId?: string }[]
  scopeEpoch?: number; writerEpoch?: number
}
type M1ModelResult<T> = { ok: true; value: T } |
  { ok: false; error: { code: string; message: string; detail?: string } }
```

- `contextPreview: true` 仅发送当前授权草稿是否存在及隔套尺寸；`sentContextSummary` 是实际发送的摘要文本。试连成功后，非空密钥经现有 safeStorage 存储按规范化服务地址和模型分开加密保存。下次由 D 重传同一地址和模型，`apiKey: ''` 复用对应凭据并重新探针。B 不单独保存地址及模型的明文配置，也不保存供应商响应或完整对话。
- HTTP 401/403 为 `AUTH_FAILED`；缺失或格式无效的密钥为 `INVALID_API_KEY`。`UNAUTHORIZED` 可由可信权限适配层传入，项目作用域和授权失效为 `AUTH_REQUIRED`。无工具支持为 `TOOL_CALL_UNSUPPORTED`，调用及后续确认不匹配为 `TOOL_ROUNDTRIP_FAILED`，网络断开为 `DISCONNECTED`。响应和持久化数据排除密钥和原始供应商错误体。
- 对话仅可调用 `m1_stage_spacer`，使用整数 q 和已授权文档摘录的索引。来源登记、写租约、草稿比较与提交走 C 的端口。C 的 `m1TaskMachine` 持久化活动状态，B 在当前租约内累积尺寸并以 C 发出的同一 `taskId` 续接；接管将清除旧写入方的待答状态。已占用为 `WRITER_HELD`，旧租约为 `WRITER_REVOKED`。
- 取消按当前项目、scope epoch 和请求 ID 定位 HTTP，提交前的文件绑定校验同步检查请求生命周期。取消发生在原子重命名发起之后时，已提交的草稿继续保留。模型关闭或断线后，共享草稿和活动可经项目上下文及 D 的订阅读取。

## 文件清单

| 文件 | 改动 |
| --- | --- |
| `desktop/main/project-agent/m1ModelApi.ts` | 主进程连接、受控工具、多轮状态、取消及租约生命周期 |
| `desktop/shared/project-agent/m1-model-api.ts` | D 可复用的请求 schema 和结果类型 |
| `desktop/main/realModelRuntime.ts` | 按端点及模型绑定的安全凭据、任务适配器与脱敏 |
| `desktop/main/openaiCompatibleAdapter.ts` | 模型列表、严格工具协议、真实服务端 ID、HTTP 中止与鉴权状态 |
| `desktop/main/keychain.ts` | 串行更新共享密文文件，保留不同凭据记录 |
| `desktop/main/project-agent/m1LocalAuthority.ts` | C 的申请、接管、引用登记及 stageChange 支持可选同步请求校验 |
| `desktop/main/project-agent/m1InternalService.ts` | 引用登记和草稿事务在提交前复核，保留取消语义 |
| `desktop/tests/projectAgentM1ModelApi.test.ts` | 真 HTTP 本地 stub、安全存储、同一项目服务及并发生命周期验收 |
| `docs/agent-refactor-m0/m1-be-02b-report.md` | 接线、验收与边界 |

## 验证

| 命令 | 退出码 | 计数 |
| --- | ---: | --- |
| `npm run test:desktop -- desktop/tests/projectAgentM1ModelApi.test.ts` | 0 | 1 文件，12 通过 |
| `npm run typecheck` | 0 | 静态检查 |
| `npm run typecheck:desktop` | 0 | 静态检查 |
| `npm run lint` | 0 | 静态检查 |
| `npm run test:desktop -- desktop/tests/projectAgentM1*.test.ts desktop/tests/projectAgentCompatibility.test.ts desktop/tests/preloadContract.test.ts desktop/tests/mountingPlateTaskbook.test.ts` | 0 | 18 文件，146 通过 |
| `node --test desktop/tests/projectAgentM0.node.mjs` | 0 | 28 通过 |
| `git diff --check` | 0 | 无空白问题 |
| `npm run test:desktop -- desktop/tests/modelAdapter.test.ts desktop/tests/modelConfig.test.ts desktop/tests/modelKeyStore.test.ts desktop/tests/realModelA40.test.ts` | 0 | 4 文件，30 通过，12 跳过 |

本机回环 stub 通过真实 TCP/HTTP 收发，覆盖模型列表、认证、工具往返和原始 ID、脱敏、摘要、多轮、取消、外部租约冲突及接管。使用实际项目授权和落盘服务、实际 safeStorage 文件存储实现以及替换的系统加解密原语。供应商实服务、原生系统钥匙串和 D 接线后的 BrowserWindow UI 未验证。额外供应商回归中的实服务用例按原有密钥门槛跳过。未开 PR。
