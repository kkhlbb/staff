# M1-BE-02A 本地 stdio MCP 桥接交付

工作树 `/Users/aston/DSH/wt/gpt-agent-refactor-m1-entry-20261123-1948`，分支 `agent/gpt-agent-refactor-m1-entry-20261123-1948`。主进程在本机 macOS 安装包启用桥接。按接线计划仅交付 A，保留已有工作树变更。

## 可安装的 MCP 入口

从当前安装位置导出 `getLocalAgentInstallInfo(executable, resourcesPath)`。参数是桌面主进程的 `process.execPath` 和 `process.resourcesPath`。

| 字段 | 约定 |
| --- | --- |
| `installPath` | 当前 `.app` 的绝对路径 |
| `bridgeCommand` | `<installPath>/Contents/Resources/cunlian-agent/cunlian-mcp`，作为一个可执行路径传入 |
| `bridgeArgs` | `[]` |
| `mcpServerName` | `cunlian-local` |
| `mcpConfigJson` | 完整 JSON 字符串，形状如下 |

```json
{
  "mcpServers": {
    "cunlian-local": {
      "command": "/Applications/Cunlian Tools/寸链.app/Contents/Resources/cunlian-agent/cunlian-mcp",
      "args": []
    }
  }
}
```

Forge 在签名前把可执行入口、`local-bridge.mjs` 和目标架构的 `m1-peer` 放入 macOS Resources。入口使用随包 Electron 的 Node 模式。桌面冷启动使用绝对的 `<installPath>/Contents/MacOS/寸链` 和单独的参数数组 `["--cunlian-local-agent"]`。未找到端点或连接被拒绝时，单次连接尝试只发起一次启动，并在 10 秒内完成就绪握手。运行中的连接丢失后，下一次工具调用重新握手和发现能力，项目授权须重新申请。原请求不会自动重发。桌面启动输出不转入 stdio，桥接诊断仅进入 stderr。

原 `node mcp/server.mjs` 继续提供 `read_taskbook`、`calc_chain`、`check_requirement`、`render_drawing`、`describe_project`，保留工具清单、参数和返回形状。随包 `cunlian-local` 的工具清单仅包含项目授权及隔套草稿操作，旧工具的文件路径参数不进入该入口。两个入口复用 JSON-RPC stdio 编解码。

## 主进程复用点

- `desktop/main/index.ts` 在取得 Electron 单实例锁后，以与原生窗口共用的 `LocalM1Authority` 实例启动 `startM1LocalEndpoint`。端点在应用退出时断开连接、等待事务和撤权、移除 socket。作用域跟随窗口关闭、导航、会话切换和项目文件身份。
- 地址按实际可执行路径散列及有效 UID 隔离。macOS 本机 `/private/tmp/cunlian-m1-<uid>-<hash>/agent.sock` 使用同 UID 的 `0700` 目录和 `0600` socket。双方以 `getpeereid` 核对对等方有效 UID。目录和 socket 拒绝错误所有权、权限和符号链接。内核 `flock` 在主进程持有的文件描述符上串行化启动。持锁后，仅在探测得到 `ECONNREFUSED` 并复核 inode 时移除陈旧 socket。
- `hello` 记录 MCP `initialize.clientInfo.name`。成功读取 `capabilities` 后，`connections()` 返回 `{ clientName, state: 'connected' }`。成功握手但尚未读取能力时为 `connecting`，断线后从当前列表移除。客户端名用于显示，项目访问需要另行确认。
- `authorizeProject({ projectId })` 只考虑已打开的同 ID 项目。多个窗口命中时优先用当前聚焦窗口，无聚焦且存在歧义时拒绝。可信原生确认提示客户端名称和经验证的规范项目路径。每条连接最多绑定一个已确认文件。项目级读取、写入确认及事务在异步边界复核授权和文件绑定。
- `getContext({ projectId })` 返回 `{ baseRevision, snapshot, activities }`。快照含游标、草稿修订、隔套草稿、授权及 writer epoch 和占用状态。外部 `getExternalActivities({ projectId })` 返回 `{ activities, draftRevision }`，活动筛选为 `source: 'external'`。
- `acquireWriter` 和 `takeOverWriter` 接受 `{ projectId, expectedWriterEpoch }`，经可信二次确认后只返回 `{ writerEpoch, baseRevision, draftRevision }`。桥接适配器持有共享授权服务发出的租约。后续 `readWriterContext({ projectId })`、`stageChange({ projectId, change })` 和 `revokeWriter({ projectId })` 使用当前连接内的租约。外部写入允许 `userInput` 来源，尺寸使用 q 整数，隔套的两种操作和版本/幂等信封沿用 C。
- 断线和导航撤销待确认请求，封住进入事务提交前的迟到操作。已在断线前提交的草稿继续保留。重复请求复用原回执，作用域与 C 的 writer 身份一致。重连重新授权及读上下文，待澄清任务由 C 保持原 writer 所有权。

### B 和 D 的交接

B 可继续调用同一个 `LocalM1Authority` 的 C 端口，内部适配器沿用现有调用签名。外部适配器使用实例签发的 `M1ExternalScope`，并在共享事务中记录 `source: 'external'`。事务的写入、源引用、草稿 CAS 和落盘规则由 C 维护。

D 可在主进程导入 `m1LocalAgent.ts` 的 `getLocalAgentInstallInfo(process.execPath, process.resourcesPath)` 和 `getExternalActivities(authority, windowId, { sessionId, projectId }, authorizationRef)`。后者需要经 sender guard 取得的窗口身份和有效的原生只读授权，返回同一项目文件绑定的外部活动及草稿修订。`localAgentEndpoint` 就绪后可通过 `connections()` 读取客户端显示状态。preload 和订阅续接在 D 接线。

## 本卡文件

| 文件 | 用途 |
| --- | --- |
| `desktop/main/index.ts` | 主进程启动/退出接线，项目窗口选择和原生授权 |
| `desktop/main/project-agent/m1LocalAuthority.ts` | 外部文件授权及生命周期，共用 C 的写入租约 |
| `desktop/main/project-agent/m1InternalService.ts` | 共享事务保存外部活动来源 |
| `desktop/main/project-agent/m1LocalEndpoint.ts` | socket 监听、连接状态、授权和事务派发 |
| `desktop/main/project-agent/m1LocalTransport.ts` | 安全路径和文件检查、帧、原生凭据核验 |
| `desktop/main/project-agent/native/m1-peer.c` | macOS 对等方有效 UID 和端点排他锁 |
| `desktop/main/project-agent/m1LocalAgent.ts` | 安装信息和供 D 使用的活动读取函数 |
| `mcp/main.ts`、`mcp/stdio.ts` | 旧入口接入复用的 stdio 协议 |
| `mcp/localBridge.ts`、`mcp/localClient.ts`、`mcp/cunlian-mcp.sh` | 随包入口、工具、限时启动和 UDS 客户端 |
| `forge.config.ts`、`scripts/build-local-agent.mjs`、`scripts/build-local-agent.d.mts` | 签名前打包桥接资源 |
| `desktop/tests/projectAgentM1LocalEndpoint.test.ts` | 实际 macOS UDS 凭据/锁、文件授权和共享事务回归 |
| `desktop/tests/e2e/localAgentBridge.mjs` | 安装包原生 GUI 和真实 stdio 冒烟，`--interactive` 增加原生授权和草稿回归 |
| `mcp/tests/protocol.test.ts` | 经原 stdio 入口实际调用五个兼容工具 |
| `docs/agent-refactor-m0/m1-be-02a-report.md` | 契约、回归验证、交接说明 |

## 验证结果

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `npm run test:desktop -- desktop/tests/projectAgentM1LocalEndpoint.test.ts` | 0 | 1 文件，10 通过 |
| `npm run test:mcp` | 0 | 3 文件，23 通过 |
| `npm run typecheck` | 0 | 静态检查 |
| `npm run typecheck:desktop` | 0 | 静态检查 |
| `npm run lint` | 0 | 静态检查 |
| `npm run test:desktop -- desktop/tests/projectAgentM1*.test.ts desktop/tests/projectAgentCompatibility.test.ts desktop/tests/preloadContract.test.ts desktop/tests/mountingPlateTaskbook.test.ts` | 0 | 17 文件，134 通过 |
| `node --test desktop/tests/projectAgentM0.node.mjs` | 0 | 28 通过 |
| `git diff --check` | 0 | 无空白错误 |
| `npm run package:desktop -- --arch=arm64` | 0 | 本机 Electron ZIP 缓存，生成 `out/寸链-darwin-arm64/寸链.app` |
| `node desktop/tests/e2e/localAgentBridge.mjs` | 0 | 3 组真实安装包断言 |
| `node desktop/tests/e2e/localAgentBridge.mjs --interactive` | 0 | 另验证原生拒绝、允许读取、允许写入、澄清、同键重发、续接和活动 |

验证机器为 arm64 macOS 26.4（25E246），Aqua 交互会话，Electron 45.2.3。安装包拷贝到带空格的 `out/Local Agent Smoke …/寸链.app`。冷启动通过注入的启动器启动真实桌面并附带隔离配置目录和测试调试端口。热启动使用实际随包入口，运行环境 `PATH=/usr/bin:/bin`，客户端为本仓库真实 stdio 测试进程。Electron 退出时确认 socket 被移除。原生读取和写入授权弹窗已通过可访问性树、截图及点击检查。Better Design 文案检查通过，实测布局无 critical 或 serious 项，系统按钮高度产生 4 项 moderate 触控尺寸提示。

未验证第三方发布客户端注册、另一 macOS 账户、x64/universal 实机、正式签名/公证和 DMG 分发。签名前的本机安装包与测试环境仍在同一开发机。构建后检查继续报告仓库既有 STEP 发布门槛 `BLOCKED_PROVENANCE_AND_LGPL_SOURCE_SUPPLY`。无需 PR。B/D 的生产验证留给各自任务。

平台参考：[Apple getpeereid](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/getpeereid.3.html)、[Electron Node 模式](https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node)、[Electron Node fuse](https://www.electronjs.org/docs/latest/tutorial/fuses#runasnode)。
