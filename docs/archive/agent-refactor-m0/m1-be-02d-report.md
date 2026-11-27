# M1-BE-02D 工作台 IPC、订阅、重连与接管

D 在 `/Users/aston/DSH/wt/gpt-agent-refactor-m1-entry-20261123-1948` 的 `agent/gpt-agent-refactor-m1-entry-20261123-1948` 上交付。A/B/C 与 BE-01 的工作树改动保留。前端工作树仅用于核对契约。后端可作为合流输入，前端适配和联合验收门槛见末节。

## 九项接口

九项方法通过 `window.cunlian` 公开。结果使用 `{ ok: true, value }` 或 `{ ok: false, error: { code, message, detail? } }`。旧只读候选桥、普通保存、`commitApprovedDraft` 与 `locateEvidence` 保持原有方法、签名及返回约定。

| 方法 | 主进程处理 |
| --- | --- |
| `getM1LocalAgentInstallInfo()` | 使用 A 的安装位置和 MCP 配置，在 macOS 打包版检查桥接命令可执行。 |
| `getM1ConnectionStatus({ projectId, scopeEpoch })` | 返回项目、基准／草稿修订、写入代际和所有者。客户端连接态与项目授权分别计算。未授权时只显示连接和打开项目标识，草稿和写入详情为空。 |
| `testM1ModelApiConnection(request)` | 透传 B 的精确请求与工具往返结果。其中 `contextPreview` 是布尔值，`sentContextSummary` 是实际发送的文本。 |
| `sendM1ChatMessage(request)` | 保留 B 的不透明任务书引用、对象 ID、历史与工具回执契约。原生接管后，B 可对当前隔套草稿修改部分尺寸，未修改的尺寸和来源从当前草稿继承。 |
| `cancelM1ChatMessage(request)` | 保留 B 的精确返回 `{ cancelled: true }`，由 B 按当前项目、scope 和请求 ID 取消聊天。 |
| `getM1ExternalActivities({ projectId, scopeEpoch })` | 读取 A 的外部活动和同一批准文件的草稿修订，保留活动字段并补工作台标题。 |
| `subscribeM1WorkbenchEvents(request, listener)` | 返回 `subscriptionId` 和可重复调用的 `unsubscribe`。可选 `afterSequence` 用于显式续读。preload 先安装同订阅 ID 的监听，再请求主进程，回调只收到业务事件。 |
| `reconnectM1Session(request)` | 外部入口核对唯一的已授权客户端及当前文件绑定。连接存在但尚未授权返回 `AUTH_REQUIRED`，实际断线返回 `DISCONNECTED`。模型入口用现有安全存储和配置再做工具往返。成功后返回最新连接与草稿快照。 |
| `takeoverM1Draft(request)` | 核对主进程 scope，仅接受下一代。原生弹窗取得决定后，在 C 的同一文件事务执行 writer epoch 与 draft revision 双 CAS。成功撤旧租约、推进 scope、关闭旧订阅和模型实例并返回新 owner。当前代同参数重试复用回执，旧 writer 的迟到外部请求返回 `WRITER_REVOKED`。 |

项目方法接收主进程 sender guard、当前窗口主 frame、会话、项目和经验证的物理文件绑定。窗口导航、崩溃、关闭、会话切换、重新授权和撤权均撤下旧模型及订阅。同一文档、同一会话撤权后重授时继续推进 epoch。过期 scope 的 `AUTH_REQUIRED.detail` 返回当前可信 epoch 的十进制字符串。新文档或新主进程会话从 1 开始。独立的授权流程仍走原生批准。模型引用从当前快照按不透明 ID 解析，支持活动已确认 PDF 条款修订及尺寸链环 ID。来源过期、缺失或 ID 不匹配会失败。

订阅先从指定游标或本 scope 已投递游标补读，首次无游标时从 0 开始，再每 200 ms 使用同一个持久日志续读。每次推送复核 scope、文件与 writer，按 journal sequence 前进。连接变更使用同一序列空间，旧只读页继续读取兼容的上下文事件。游标失效发出 `snapshot_required`，包含当前状态、活动和重置后的日志游标，然后从该游标续读。该控制帧可重置一个超前游标。聊天回复走 B 直接返回，聊天内容不进持久日志。

D 增加了仅供内置租约的 `updateSpacerDraft`。更新须匹配物理文件基准和当前草稿修订，仍使用隔套尺寸与来源规则、C 的事务与幂等回执。历史回执验证草稿修订链。自动化重放验证正式文件字节保持一致。

## D 文件

| 文件 | 改动 |
| --- | --- |
| `desktop/main/index.ts` | 生产 IPC、生命周期、引用解析、macOS 原生确认 |
| `desktop/main/project-agent/m1WorkbenchChannels.ts` | 九个方法和订阅清理端口、sender guard、代际、投影、重连与接管 |
| `desktop/main/project-agent/m1FileBindings.ts` | 已验证文件指纹按物理身份复用，文件变化时重验 |
| `desktop/main/project-agent/m1InternalService.ts` | 接管草稿 CAS、内部隔套续写、修订链校验和持久连接事件 |
| `desktop/main/project-agent/m1LocalAuthority.ts` | 授权失效通知、快照与文件校验、事件页及共享接管事务 |
| `desktop/main/project-agent/m1LocalEndpoint.ts` | 已绑定客户端选择、实时身份复核与外部租约交接 |
| `desktop/main/project-agent/m1ModelApi.ts` | 同代实例、连接恢复、接管代际转移及合法隔套续写 |
| `desktop/main/project-agent/m1StageContracts.ts` | 声明主进程内部隔套更新操作 |
| `desktop/shared/contracts.ts`、`desktop/shared/project-agent/m1-workbench.ts` | IPC 常量和工作台请求、回执与事件类型 |
| `desktop/preload/index.ts` | 九项具体桥接与订阅监听清理 |
| `desktop/tests/preloadContract.test.ts`、`src/pages/DesktopWorkspace.test.tsx` | 动态 preload 回归及既有工作台 mock |
| `desktop/tests/projectAgentM1Workbench.test.ts` | 守卫、授权、代际、取消、导航、撤权、游标和真实双入口重放 |
| `desktop/tests/e2e/m1WorkbenchNative.mjs` | 原生 BrowserWindow、只读授权、取消／批准接管与代际事件冒烟 |
| `docs/agent-refactor-m0/m1-be-02d-report.md` | 契约、验证和合流清单 |

## 复现与结果

macOS 26.4（25E246）arm64，Electron 45.2.3，Node 26.12.1，npm 11.20.0。

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `npm run test:desktop -- desktop/tests/projectAgentM1Workbench.test.ts desktop/tests/preloadContract.test.ts` | 0 | 2 文件，11 通过 |
| `npm run typecheck` | 0 | 静态检查 |
| `npm run typecheck:desktop` | 0 | 静态检查 |
| `npm run lint` | 0 | 静态检查 |
| `npm run test:mcp` | 0 | 3 文件，23 通过 |
| `npm run test:desktop -- desktop/tests/projectAgentM1*.test.ts desktop/tests/projectAgentCompatibility.test.ts desktop/tests/preloadContract.test.ts desktop/tests/mountingPlateTaskbook.test.ts` | 0 | 19 文件，154 通过 |
| `node --test desktop/tests/projectAgentM0.node.mjs` | 0 | 28 通过 |
| `npm run test -- --config out/m1-d-vitest.config.mts src/pages/DesktopWorkspace.test.tsx` | 0 | 1 文件，53 通过 |
| `git diff --check` | 0 | 无空白错误 |
| `npm run package:desktop -- --arch=arm64` | 0 | 生成本机安装包，PDF worker 与随包 STEP 资产核对通过 |
| `node desktop/tests/e2e/localAgentBridge.mjs` | 0 | 3 组真实安装包／stdio 冒烟断言 |
| `node desktop/tests/e2e/m1WorkbenchNative.mjs` | 0 | 真 BrowserWindow／preload，原生允许读取、取消及批准接管、新代推送和正式文件字节断言 |

直接执行 DesktopWorkspace 测试时 Vite 因符号链接后的 `pdf.worker.min.mjs?url` 超出允许目录退出 1。临时配置在忽略的 `out/`，可在工作树根目录复建。

```ts
// out/m1-d-vitest.config.mts
import { realpathSync } from 'node:fs'
import { mergeConfig } from 'vitest/config'
import base from '../vite.config.ts'
export default mergeConfig(base, {
  server: { fs: { allow: [process.cwd(), realpathSync('node_modules')] } },
})
```

自动化双入口用打包脚本构建实际 MCP stdio 桥及原生 peer helper，运行真实本机 socket／对端凭据检查、真实落盘和 IPC 注册处理器。先由 A 生成隔套，再由 B 对同一文件和草稿链只更新长度。覆盖确认期间 A 改变草稿导致 CAS 拒绝、幂等接管、旧 A 迟到写入被拒、B 模型重新探针、失效游标快照后续读、外部连接断开及新客户端重新授权。HTTP Stub 通过真实回环网络执行工具调用和工具结果往返，测试用存储替代 OS 加解密。该链的 IPC event/原生确认由测试夹具注入，另由真 GUI 脚本独立验证原生批准和实际 preload 推送。

原生界面沿用应用的系统弹窗。Better Design 已读取可访问性、接管和确认文案原则及审阅规则，两种目标文案的理解检查均无阻塞。真机检查了内置接管弹窗的渲染与可访问性树，并实际点击取消和接管。Computer Use 返回角色和标签，未返回 AX 元素几何。系统辅助功能权限也拒绝了 `osascript` 的几何读取，`inspect-spacing` 返回 `incomplete`，没有间距评分。

使用 Electron 的主 frame 发信及父窗口绑定的原生消息框。参考 [IpcMainInvokeEvent](https://www.electronjs.org/docs/latest/api/structures/ipc-main-invoke-event)、[WebFrameMain](https://www.electronjs.org/docs/latest/api/web-frame-main)、[dialog](https://www.electronjs.org/docs/latest/api/dialog)。

## 合流准备

后端九项契约、旧桥兼容、真实 MCP 与本机模型 stub 的双入口链路已验收。合流前需在前端适配以下已核对差异。

- 冻结前端发送结构化 `contextPreview`，接收结构化摘要。B 使用布尔输入和字符串摘要。聊天附件与选择在前端是对象，B 接收不透明 ID。B 工具回执为 `{ name, status, taskId? }`，可含 `awaitingInput`。前端当前使用 `{ toolName, status, summary }`。
- 前端需按主进程 session/scope 建立及重建订阅，处理 `snapshot_required` 并用快照游标续读。当前前端的项目切换会本地增加代际，订阅回调未处理该快照类型。前端还需把连接与原生文件授权分开显示，并提供无草稿时的原生写入申请及明确的接管目标。
- 未验证真实模型供应商、系统凭据存储的真实加解密、第三方成品客户端注册、完整合流工作台端到端、另一 macOS 用户、x64/universal 实机、公证和 DMG 发布。打包检查仍报告已有发布门槛 `BLOCKED_PROVENANCE_AND_LGPL_SOURCE_SUPPLY`。
