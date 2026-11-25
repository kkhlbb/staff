# M3-BE-01 后端验收报告

在 `gpt-agent-refactor-m1-entry-20261123-1948` 工作树和 `agent/gpt-agent-refactor-m1-entry-20261123-1948` 分支实施。保留了已有改动，前端独立工作树仅核对了 `m3WorkbenchBridge.ts`。环境为 Apple Silicon、macOS 26.4、Node 26.12.1。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `desktop/main/index.ts`、`desktop/main/ipc.ts` | 使用原生确认绑定正式保存，按真实项目文件和当前版本接入引用解析、迁移、跨项目打开和授权窗口检查。 |
| `desktop/main/project-agent/m2/channels.ts`、`pipeline.ts`、`draftStore.ts` | 五个 M3 方法及订阅清理，同版产物和必需项校验、正式基准 CAS、原子回执、草稿撤销和重启恢复。后两文件的路径前缀相同。 |
| `desktop/main/project-agent/m3Migration.ts` | 隔套档案另存、原件保全报告与既有尺寸链复算。 |
| `desktop/main/project-agent/m1LocalAuthority.ts`、`m1ModelApi.ts`、`workbenchReferences.ts` | 外部草稿通知、B 对话读取当前授权 PDF 与特征，以及旧 M1 引用兼容。后两文件的路径前缀相同。 |
| `desktop/shared/contracts.ts`、`desktop/shared/project-agent/m3-lifecycle.ts`、`desktop/preload/index.ts` | 新增独立 M3 通道和 `ok/value` 或 `error` 信封，保持既有 M1/M2 签名及旧 `commitApprovedDraft`。 |
| `desktop/tests/projectAgentM3Lifecycle.test.ts`、`desktop/tests/preloadContract.test.ts`、`src/pages/DesktopWorkspace.test.tsx` | 生命周期验收、preload 通道与迟到消息测试、现有 DesktopWorkspace 测试 mock 同步。 |

## 验收证据

- **A04**：以真实安装板任务书驱动几何和图纸。X=62 时 MP-03 区间为 `[12.75, 13.25] mm`，最差低于 13 mm 阈值 0.25 mm，证据指向 `hole-2`，保存返回 `CHECKS_BLOCKED`。撤销后 X=61，区间为 `[13.75, 14.25] mm` 并通过。撤销产生单调递增的新草稿修订。
- **A09**：同一请求回放返回相同结果，异载荷回放返回 `DUPLICATE_REQUEST`。确认期间撤权后，文件中没有新增正式版本或回执。重新授权并完成两并发调用只落一份正式版本及一份回执。重建 pipeline 后恢复正式历史、独立草稿、PDF 来源和模型/图纸证据，并可回放原提交和修改请求。单写入方与接管行为由既有 M1 回归夹具覆盖。
- **A10**：用真实可解码的 schema 6 隔套档案验收。另存文件解码成功，保留独立草稿、历史和 PDF 修订，源文件逐字节一致。既有计算器给出 12.00 `[0.1500,0.2500]`、12.04 `[0.1100,0.2100]`、12.10 `[0.0500,0.1500]`、12.05 `[0.1000,0.2000]` mm，结论依次通过、通过、失败、边界通过。
- **A11**：模型或图纸未同版就绪、检查集指纹不符时返回 `FINGERPRINT_MISMATCH`。取消原生确认返回 `CONFIRMATION_EXPIRED`。确认成功后，同一原子文件写入正式修订、规范模型、需求和特征快照、求解器版本和检查记录、模型及图纸 SHA-256 清单以及回执。
- **R-B**：实际测试 PDF 的 `revision.id` 对应 `documentRef`，真实的 `hole-2` 与 `plate-1` 从 M2 引用解析进入 B 对话请求。仍接受已确认 M1 `revisionId` 与组成环 `term.id`。旧 PDF 修订、未知对象、其他项目引用返回 `REFERENCE_STALE`。模型传输使用测试适配器。
- **IPC**：五个通道分别覆盖 sender/frame 拒绝，preload 验证通道转发与解除订阅后的迟到监听。跨项目通知要求同一安装主体下两侧真实文件授权仍有效，显式打开才聚焦目标窗口。授权撤销后无法读取目标快照。

## 命令结果

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `npm run test:desktop -- desktop/tests/projectAgentM3Lifecycle.test.ts` | 0 | 1 文件，6 测试 |
| `npm run typecheck` | 0 | 通过 |
| `npm run typecheck:desktop` | 0 | 通过 |
| `npm run lint` | 0 | 通过 |
| `npm run test:mcp` | 0 | 3 文件，23 测试 |
| `npm run test:desktop -- desktop/tests/projectAgentM1*.test.ts desktop/tests/projectAgentM2*.test.ts desktop/tests/projectAgentM3*.test.ts desktop/tests/projectAgentCompatibility.test.ts desktop/tests/preloadContract.test.ts desktop/tests/mountingPlateTaskbook.test.ts` | 0 | 22 文件，178 测试 |
| `node --test desktop/tests/projectAgentM0.node.mjs` | 0 | 28 测试 |
| `npm run test -- --config out/m2-be-02-vitest.config.mts src/pages/DesktopWorkspace.test.tsx` | 0 | 1 文件，53 测试，复用既有 Vite 依赖路径配置 |
| `git diff --check` | 0 | 通过 |

并行启动两个桌面命令时，短暂遇到共享 STEP 预处理缓存的 `spacer.wasm` 校验失败。两个命令顺序执行后均通过。

## 合流与验证边界

- 前端 `createBoundConfirmation` 生成的确定性 token 可被 renderer 自行重算。合流时它继续作为请求标识，正式授权由主进程原生确认和提交前复核提供。首次正式基准来自授权文件指纹。提交后使用 `committedRevision` 或重新读取 M3 项目结果作为下一次基准，保持与后端检查集指纹一致。
- M3 正式历史、安装板草稿和回执存于应用数据目录，与已确认的文件绑定关联。隔套迁移另存副本。跨项目打开复用仍持有效文件授权的现有窗口，当前通知发布源为通过 M1 权限服务提交的外部草稿变更。
- Better Design 已加载现有原生样式、UI/UX 原则和审查规则，文案检查零发现。在隔离 Electron 中运行同配置的 macOS 原生对话框并采集到实际 AXSheet、两段文案及两个按钮。间距工具收到真实 AX 树后返回 HTTP 402 配额用尽，尚无工具测量结论。
- 验收覆盖代码、真实几何夹具、文件往返、授权与模拟模型传输。尚未执行合流后的完整 Electron 工作台流程、安装包验证或真实模型供应商双入口各三次验收。当前报告保留分支上的实现，未开 PR 或合流。
