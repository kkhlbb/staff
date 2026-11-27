# INT-01 寸链前后端合流

- 分支 `agent/refactor-integration`
- 工作树 `/Users/aston/DSH/wt/cunlian-agent-refactor-integration`
- 共同基线 `61d8c435b220cea95c3b06f5435bdf81a6a8dbf9`
- 本地包 `/Users/aston/DSH/wt/cunlian-agent-refactor-integration/out/寸链-darwin-arm64/寸链.app`

## 文件与冲突

两源 HEAD 均为共同基线。通过只读 Git 命令枚举相对基线的完整跟踪差异和未跟踪项目，并按文件字节复核合流结果。

| 来源 | 跟踪修改 | 未跟踪 | 删除 | 复核 |
| --- | ---: | ---: | ---: | --- |
| 后端 `gpt-agent-refactor-m1-entry-20261123-1948` | 16 | 100 | 0 | 112 项字节相同，3 项有合流改动，1 项为排除的 `node_modules` 符号链接 |
| 前端 `dsh-agent-refactor-m0` | 1 | 65 | 0 | 62 项字节相同，4 项有合流改动 |

`desktop/shared/project-agent/` 重叠的 9 份源码和 2 份合成夹具逐字节相同。保留后端独有的 M1 模型、协议、工作台以及 M2、M3 生产契约。独立结构类型校验发现 M1 聊天的只读附件和历史数组在前端与生产 API 的可变类型之间存在偏差。生产输入类型采用只读数组，Zod 解析和 IPC 数据格式保持原行为。后端的另外两项合流改动是契约类型回归与原生冒烟。前端的四项改动涉及 `App`、两个路由测试和授权后恢复事件订阅。

`index.desktop.html` 的实际入口 `src/desktop/main.tsx` 现在挂载 `App`，空 hash 和 `#/desktop` 均进入新工作台。原生菜单与 Finder 打开使用已有会话适配器，并把真实项目标识、文件基线及会话交给工作台。旧工作台可通过顶部链接回到 `#/desktop-legacy`。M2/M3 事件订阅随原生只读授权和 scope 代际重试。M3 成功响应通过项目、草稿、前一基线和检查指纹校验后，直接用 `committedRevision` 更新本地 `baseRevision`，随后投影正式版本和草稿状态。

用 `npm ci --no-audit --no-fund` 在合流树安装 386 个包，`node_modules` 为本树真实目录。原 STEP 打包门禁首轮拦截了新增 M2 的 Replicad 文件。合流门禁仅放行 M2 worker 目录中的声明文件，逐项验证解包状态和源文件字节，并继续校验隔套 narrow STEP 资产及许可证。

## 19 个方法

生产 `CunlianApi` 通过对三组前端探测接口的完整结构类型检查。实际包在 Electron renderer 校验探测数组计数为 9/5/5，运行时 19 项全部存在。105 个公开 IPC 通道和事件字符串无重复。

| 组 | 方法 | 请求、回执与事件 |
| --- | --- | --- |
| M1 | `getM1LocalAgentInstallInfo` | 无参数，返回隔离运行的 app 实际路径和配置 |
| M1 | `getM1ConnectionStatus` | 项目及 scope，返回授权、连接、版本及 writer 状态 |
| M1 | `testM1ModelApiConnection` | scope、请求 ID、模型配置，返回模型和工具往返信息 |
| M1 | `sendM1ChatMessage` | scope、writer、请求 ID、提示、附件、选择及历史，返回消息、工具及版本信息 |
| M1 | `cancelM1ChatMessage` | scope 与请求 ID，返回取消回执 |
| M1 | `getM1ExternalActivities` | 项目及 scope，返回活动和草稿版本 |
| M1 | `subscribeM1WorkbenchEvents` | 项目、scope、可选序号及监听器，返回流 ID 与解除函数。实际包收到代际 2 的 `draft_updated` |
| M1 | `reconnectM1Session` | scope、来源和请求 ID，返回连接快照 |
| M1 | `takeoverM1Draft` | 项目、草稿、请求 ID、前后 scope 和目标来源，原生取消后重试批准，返回新 scope 和 writer |
| M2 | `getM2PreviewSnapshot` | 项目及可选版本，实际包在授权后返回快照 |
| M2 | `locateM2Evidence` | 项目、版本和区分类型的目标，返回定位结果 |
| M2 | `retryM2Drawing` | 项目、版本和请求 ID，返回重试回执 |
| M2 | `submitM2Clarification` | 项目、版本、目标、请求 ID、模式和正文，返回澄清回执 |
| M2 | `subscribeM2PreviewEvents` | 项目和监听器，实际包验证流 ID 和解除函数，preload 回归验证事件和解除 |
| M3 | `commitM3ApprovedDraft` | 项目、基线、草稿、检查指纹、确认令牌及请求 ID，返回正式、前一和提交的草稿版本 |
| M3 | `undoDraftChange` | 项目、草稿和请求 ID，返回上一及恢复的草稿版本与可选快照 |
| M3 | `getMigrationReport` | 项目，实际包在授权后返回报告结果 |
| M3 | `openExternalProjectResult` | 项目、可选草稿及请求 ID，返回名称、版本、恢复状态及可选快照 |
| M3 | `subscribeM3ExternalProjectEvents` | 监听器，实际包验证流 ID 和解除函数，preload 回归验证事件和解除 |

实际包用合法形状调用 13 个未授权请求，全部返回预期 `AUTH_REQUIRED` 或 `UNAUTHORIZED`。三条流在授权后成功返回解除订阅函数，M1 流另验证真实推送。两组 M2/M3 事件的分发和解除通过 preload 测试，M3 跨项目事件还由后端生命周期测试覆盖。

## 验证结果

| 顺序 | 命令 | 退出码 | 实测 |
| ---: | --- | ---: | --- |
| 1 | `npm run lint` | 0 | ESLint |
| 2 | `npm run typecheck` | 0 | app、node、MCP 三个 tsconfig |
| 3 | `npm run typecheck:desktop` | 0 | 桌面类型检查，包含 19 方法结构类型校验 |
| 4 | `npm test` | 0 | 153 文件，1587 测试 |
| 5 | `npm run test:mcp` | 0 | 3 文件，23 测试 |
| 6 | `npm run test:desktop -- desktop/tests/projectAgentM1*.test.ts desktop/tests/projectAgentM2*.test.ts desktop/tests/projectAgentM3*.test.ts desktop/tests/projectAgentCompatibility.test.ts desktop/tests/preloadContract.test.ts desktop/tests/mountingPlateTaskbook.test.ts` | 0 | 22 文件，179 测试 |
| 7 | `node --test desktop/tests/projectAgentM0.node.mjs` | 0 | 28 测试 |
| 8 | `npm run build` | 0 | TypeScript 和 Vite 生产构建。Vite 给出 chunk 大小警告 |
| 9 | `npm run package:desktop -- --arch=arm64` | 0 | Forge、PDF worker、M2 解包资产、隔套 STEP 资产和许可证检查 |
| 10 | `node desktop/tests/e2e/localAgentBridge.mjs` | 0 | 3 组断言，冷启动、stdio、退出清理 |
| 11 | `node desktop/tests/e2e/m1WorkbenchNative.mjs` | 1 → 0 | 首次批准了应取消的接管弹窗，同包按只读授权、取消和批准的顺序重跑通过 |

两个冒烟读取上表所列合流包，复制到各自隔离目录和 profile 后运行。原生测试检查空 hash 是真实默认路由，从实际链接切回旧工作台，再用 `#/desktop` 重开新工作台。随后发送 macOS 打开文件事件，验证真实项目进入新工作台。确认接管后收到代际 2 的事件，夹具字节保持一致。另一个冒烟在含空格的路径下验证随包原生 peer、Unix socket、系统 PATH 的 stdio、未授权读和应用退出清理。

包内主程序及 `m1-peer` 为 Mach-O arm64，大小约 312 MiB。`Contents/Resources/app.asar` SHA-256 为 `cf4794759a1623dccc200412d77586c241b4721f36c3fc5409f3145face13ccd`，主程序 SHA-256 为 `cd2d9352400dc818a8ee9a98dfc1d192e9b5ac549ef887ea1f52029418f8e165`。

命令原始输出在本树 `out/int01-logs/`。早期运行输出在 `out/int01-initial-logs/` 和 `out/int01-second-logs/`。早期失败包括旧桌面入口断言、旧 STEP 打包门禁，以及一次数据库升级提示超时。最终全量测试通过，数据库测试源未改动。

## 剩余验收范围

- Better Design 的 `find-design-system`、`get-ui-principle`、`get-ux-principle`、`get-review-rules`、`check-comprehension` 和 `inspect-spacing` 均返回 HTTP 402 `AGENT_QUOTA_EXHAUSTED`。设计审查保持阻塞，现有界面样式保留。
- 原生冒烟覆盖接口接线、授权、只读请求和 M1 草稿接管。M2 几何及 M3 正式提交、跨项目事件的成功路径由回归测试覆盖，本轮包内未走真实模型服务、完整几何流程或正式版本写盘。旧版菜单中的新建、另存为、V2 导入和 DXF 操作仍通过旧工作台进入。
- 本包用于本机验证。隔套 STEP 检查继续报告来源和 LGPL 源供应未满足发布批准。公证、分发验收、QA-INT-01 和 Windows 均未执行。

暂存检查保留两处来源原样。Git 将任务书 PDF 夹具识别为文本并报告其 PDF 结构空白，另报告 M3 生产契约的 EOF 空行。夹具与契约文件均通过来源字节比对。
