# UX-CONN-FE-01 完成报告：零手动配置连接体验

## 1. 工作树、分支与变更文件清单

- **隔离工作树**：`/Users/aston/DSH/wt/cunlian-ux-conn-fe`
- **开发分支**：`feat/ux-conn-fe`（基于 `origin/main` `24f1807e`）
- **冻结边界核查**：`desktop/shared/contracts.ts`、`desktop/preload`、`desktop/main` 均为 **0 改动**
- **修改 / 新增文件**：
  - 修改 `src/workspace/project-agent/m1WorkbenchBridge.ts`
  - 修改 `src/workspace/project-agent/ProjectAgentM1Workbench.tsx`
  - 修改 `src/workspace/project-agent/ProjectAgentPanel.css`
  - 修改 `src/workspace/project-agent/m1WorkbenchBridge.test.ts`
  - 修改 `src/workspace/project-agent/ProjectAgentAccessibility.test.tsx`（适配服务商预设默认隐藏 URL 输入框：先选 `custom` 再聚焦 `服务地址`，完整保留断线不抢占输入焦点的 A11y 断言）
  - 新增 `src/workspace/project-agent/ProjectAgentConnectionUx.test.tsx`
  - 新增 `docs/agent-refactor/UX-CONN-FE-01-report.md`

---

## 2. 3 个新窄接口的前端探测与字段对接核对

在 `src/workspace/project-agent/m1WorkbenchBridge.ts` 中新增独立扩展探测层 `M1ConnectionUxBridge`、`M1_CONNECTION_UX_BRIDGE_METHODS`、`probeM1ConnectionUxBridge(candidate)` 与 `resolveWindowM1ConnectionUxBridge()`，并在 `ProjectAgentM1Workbench` 中同时支持从 `props.bridge` 和 `window.cunlian` 读取。

> **兼容性设计**：3 个新方法不侵入既有 9 项 `M1_WORKBENCH_BRIDGE_METHODS` 及 `M1WorkbenchBridge` 接口，既完全兼容既有 9 项桥接探测断言，也保证 `desktop/tests/projectAgentCompatibility.test.ts` 对 `Required<M1WorkbenchBridge & M2WorkbenchBridge & M3WorkbenchBridge>` 与冻结 `CunlianApi` 的类型校验 100% 通过。

| 方法名 | 入参字段 | 出参 `value` 字段 | 探测能力标识 |
| --- | --- | --- | --- |
| `detectM1LocalAgents` | 无 | `{ agents: readonly { id: 'claude-code' \| 'codex' \| 'claude-desktop' \| 'cursor' \| 'windsurf'; name: string; detected: boolean; configured: boolean; method: 'cli' \| 'config-file'; configPath: string \| null; detail?: string }[] }` | `capabilities.detectLocalAgents` |
| `registerM1LocalAgent` | `{ agentId: M1LocalAgentId }` | `{ agentId: M1LocalAgentId; name: string; configured: true; method: 'cli' \| 'config-file'; configPath: string \| null; backupPath: string \| null; message: string; requiresRestart?: boolean }` | `capabilities.registerLocalAgent` |
| `listM1ModelApiModels` | `{ baseUrl: string; apiKey: string; projectId: string; requestId: string; scopeEpoch: number }` | `{ models: readonly string[]; defaultModel: string \| null }` | `capabilities.listModelApiModels` |

---

## 3. 三大体验优化与新增单元测试

### 3.1 本地 Agent 一键自动配置体验
- 打开/切换至「连接本地 Agent」卡片时自动调用 `detectM1LocalAgents()`（带 `detectLocalAgentsEpoch` 与卸载防乱序守卫），并提供轻量「刷新检测」按钮。
- 通过 `sortDetectedLocalAgents()` 将 `detected: true` 的客户端突出置顶展示，`detected: false` 的客户端低调收纳在底部折叠区，维持低视觉密度：
  - `configured: true` 显示「已配置 ✓」徽标；
  - `detected: true && !configured` 仅展示 1 个主按钮「一键配置连接」，调用 `registerM1LocalAgent({ agentId })`；
  - 注册成功立即切换为「已配置 ✓」，并在确认条中展示 `message`、`requiresRestart` 重启提示（「请重启 `<客户端名>` 以加载新配置。」）、`configPath` 与 `backupPath`；
  - 注册失败展示清晰中文错误且绝不伪造成功；
  - 后端未接线自动检测时诚实提示，引导展开底部默认折叠的 `<details>`「其他客户端 / 手动复制 MCP 配置」（完整保留一键复制 MCP JSON 与自然语言连接说明）。

### 3.2 模型 API 10 服务商预设下拉
- 在 `m1WorkbenchBridge.ts` 导出纯数据表 `M1_MODEL_API_PROVIDER_PRESETS`（完整覆盖 DeepSeek、OpenAI、智谱 GLM、通义千问（阿里云百炼）、Moonshot / Kimi、硅基流动（SiliconFlow）、OpenRouter、本地 Ollama、本地 LM Studio、自定义 OpenAI 兼容地址共 10 项）及辅助函数 `getModelApiProviderPreset`、`findModelApiProviderPresetByUrl`、`isValidModelApiBaseUrl`、`canAutoFetchModelApiModels`、`selectPreferredModelFromList`。
- 选中预设服务商时自动填充 `baseUrl` 与推荐默认模型，隐藏冗余 URL 输入框仅保留紧凑只读灰字地址；仅选中「自定义 OpenAI 兼容地址」时展开可编辑的「服务地址」输入框。
- 本地 Ollama / 本地 LM Studio 标注「密钥（可选）」，允许空密钥直接自动拉取模型列表与测试连接。

### 3.3 防抖自动拉取模型下拉、防乱序与 F03 / 降级守卫
- 满足合法 `http://` / `https://` 地址且（非空 `apiKey` 或 `apiKeyOptional`）时，防抖 **400ms** 自动调用 `listM1ModelApiModels`，并在模型字段旁提供轻量手动刷新按钮 `↻`。
- 拉取成功后渲染 `<select>` 模型下拉并按 `defaultModel` → 服务商推荐模型 → 列表首项优先级自动选中（同时支持需要时切回「手动输入」）。
- 切换服务商、修改 URL、修改 Key 或切项目时，立即取消防抖定时器并递增 `modelListFetchEpoch`，丢弃迟到/乱序的旧模型列表响应；严格遵守 **F03** 规则，任何服务商/地址/密钥/模型变更均立即撤销既有测试连接解锁态与在途测试请求。
- `listM1ModelApiModels` 未接线、调用失败或返回空列表时，展示非阻塞提示并自动降级为可手动输入的模型名文本框，绝不卡死「测试连接」流程。

### 3.4 新增单元测试列表（+10 条用例）
- `src/workspace/project-agent/m1WorkbenchBridge.test.ts`（+2）：
  1. `probeM1ConnectionUxBridge` 3 项扩展窄接口探测与既有 9 项 `M1_WORKBENCH_BRIDGE_METHODS` 兼容性测试
  2. 10 个服务商预设完整性、URL 校验、自动拉取资格、模型优先级选择与本地 Agent 排序纯函数测试
- `src/workspace/project-agent/ProjectAgentConnectionUx.test.tsx`（+8）：
  1. 本地 Agent 自动检测排序、已配置 ✓ 徽标、一键配置成功（含 `requiresRestart` / `configPath` / `backupPath`）
  2. 本地 Agent 注册失败清晰中文报错且不伪造成功
  3. 本地 Agent 未接线自动检测诚实提示、底部默认折叠手动配置展开复制及 `window.cunlian` 探测兼容
  4. 10 服务商预设下拉自动填充 URL / 推荐模型、隐藏预设 URL 输入框与自定义地址展开 URL 输入框
  5. 填 Key 防抖 400ms 自动调用 `listM1ModelApiModels` 渲染下拉与优先级选中、及 `↻` 立即刷新
  6. 防乱序丢弃旧模型列表迟到响应 + F03 立即撤销既有测试解锁态
  7. 本地 Ollama / LM Studio 标注密钥可选、空 Key 自动拉取模型并支持空 Key 测试连接
  8. 拉取失败 / 返回空列表 / 后端未接线时优雅降级为手动模型输入框且不阻塞测试连接

---

## 4. 全量校验结果

在 `/Users/aston/DSH/wt/cunlian-ux-conn-fe` 依次执行并全部 exit 0：

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | 通过（0 errors, 0 warnings） |
| `npm run typecheck` | 通过（exit 0） |
| `npm run typecheck:desktop` | 通过（exit 0） |
| `npm test` | 通过（**155 / 155** 测试文件，**1604 / 1604** 条用例 100% 通过） |
| `npm run build` | 通过（`tsc -b && vite build`，1.78s） |
| `git diff --stat -- desktop/shared/contracts.ts desktop/preload desktop/main` | 空（0 改动） |

---

## 5. 遗留问题与合流联调确认点

- **无前端遗留阻塞问题**。
- **合流联调确认点**：待后端 `UX-CONN-BE-01`（`feat/ux-conn-be`）将 `detectM1LocalAgents`、`registerM1LocalAgent`、`listM1ModelApiModels` 接线至 `desktop/shared/contracts.ts`、`desktop/preload` 与 `desktop/main` 合流后，前端会通过 `resolveWindowM1ConnectionUxBridge()` 自动探测启用，无需修改前端业务代码；届时可在 Electron 桌面端做一次真机端到端回归（含本地 Agent 配置文件写入与重启提示、各主流服务商及本地 Ollama/LM Studio 自动拉取模型列表）。
