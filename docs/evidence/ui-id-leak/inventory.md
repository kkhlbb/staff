# 界面内部 ID 清理：全库清单

基线 fdd200d；行号由 scripts/ui-id-inventory.py 从基线及最终工作树计算。

全库运行代码扫描包括 src、desktop、mcp、scripts 的 TS/TSX/JS/MJS/Python；测试/夹具不是生产展示入口，排除但原文件保留。desktop/main/menu.ts 与 index.ts 的原生菜单/对话框标题均为固定人话，未发现版本身份拼接；MCP 回包、脚本 stdout、诊断与证据明确保留内部身份，它们不是应用界面版本标签。JSON/CSS/HTML 静态资源不产生内部 ID 拼接。

## 规则与审计结论

仅改展示层。正式序号沿用图纸的 append-only fileRevisions 顺序（索引 + 1）；缺少记录为「未命名版本」。草稿显示「草稿 · 第 N 版」。任何版本都不退回 ID，也不显示 ID 前几位。

### 六区域与扩展入口

| 区域 | 实际入口 | 改前 | 改后 / 保留原因 |
|---|---|---|---|
| 主工作台顶栏、属性、项目树 | src/pages/DesktopWorkspace.tsx | Rev/currentRevisionId、模型版本、来源版本、父版本、图纸指纹、参数/标注身份 | 第 N 版、名称；缺记录未命名；完整图纸校验信息保存在文件 |
| Agent 侧栏 | src/components/AgentSidebar.tsx | 正式 revisionId、两种提交回执 revisionId、失败与提问/定位消息可夹带 ID | 正式序号；提交后只读 reattachSession 的真实已提交历史；无序号未命名；诊断仅展示副本映射 |
| 确认面板 | src/components/ExtractionReviewPanel.tsx、ChangeWorkbench.tsx；DesktopWorkspace 关联确认 | 草稿/候选/轮次/批次/父版本/预览/标注身份 | 名称、页范围、真实版本号、候选数量、条目序号；动作与原数据 ID 保留 |
| 图纸面板 | src/components/SpacerDrawingPanel.tsx、DrawingCanvas.tsx | 候选状态回显正式 revisionId；老文件空版本栏回退「草稿 rev-…」 | 草稿/正式版本人话；老文件只替换预览 SVG 的可见版本格，不改 metadata/图纸记录/fingerprint/导出数据 |
| 项目列表 | src/pages/DesktopWorkspace.tsx recent/recovery；ProjectList.tsx | 最近项目 Rev；恢复/导入/备份错误可能夹带 ID | 最近索引没有正式序号，诚实显示未命名版本；异常文案消费端映射；项目名、路径原文保留 |
| DXF 看图信息栏 | src/components/DxfViewer.tsx | 经视口 ${entity.viaViewport} | 经图纸视口；外部 DXF 原始 TEXT/图层/块名不修改 |
| 来源/PDF 与历史条款 | SourcePanel.tsx、PdfViewer.tsx、DesktopSessionViews.tsx、RequirementRevisionHistory.tsx | revisionId / reqrev；短 ID 来源摘要 | 文件名、文档内版本序号、条款版本序号、页码及选区；下拉 option.value 保留 |
| 报告/快照/比较 | PrintReport.tsx、SnapshotList.tsx、Workspace.tsx、ReviewSidebar.tsx、ContributionTable.tsx、ScenarioCompare.tsx | projectId、snapshotId（含页脚短 ID）、revisionId、termId fallback | 项目名、创建时间、来源版本、未命名组成环；冻结快照和路由身份不变 |
| 对话框与异常消费 | SessionDialogs.tsx、ProjectList.tsx、DesktopWorkspace.tsx、AgentSidebar.tsx | 上游错误中的原始身份 | uiDiagnosticText 保留原因与补救文字，替换完整身份 token，不截断 |
| 外部读数依据 | AgentReadEvidenceList.tsx | revisionId、完整 64 位 SHA-256 | 只显示页码/提供者/原话；提示校验信息在文件中；EvidenceRef 完整保留 |

### 故意保留（不属于用户版本身份展示）

1. 业务、IPC、存储、项目文件、日志、证据、源 SVG metadata、React key、data-*、路由、选择控件 value、事件参数：须保留完整身份，禁止因展示清理而删改。
2. 上游诊断产生点（useDesktopSession、requirements/history、history/snapshots、project-file/validation、backup、storage、drawing 等）：不改契约；用户消费处显示人话/展示副本。附表明确列出产生点，不能据其仍含 ID 判定存储应删 ID。
3. 明确标为 SHA-256 / fingerprint 的现有短校验摘要保留；这是校验值，不是版本 ID，绝不作为版本前缀显示的例外。原先完整 64 位读数哈希与属性指纹不再在界面输出。
4. 外部 DXF 文件图形/文字、用户项目名、文件名/路径、原话、人名仍如实展示；不以“清理”为由破坏来源真值。这些不是应用把内部 ID 拼成标签的路径。若用户故意输入禁用串，通用守卫照样拒绝该渲染结果，不静默放行。
5. 模型配置里的供应商模型名（如 deepseek-chat）是用户配置，不是任务实例号。fake-1/任务实例号不回显；工具名/错误码走既有 agentWording 人话映射。

## 文件:行号 / 改前 / 改后 / 保留理由

下表是刻意保守的超集，含用户文本及诊断候选、结构引用。每个改前命中均提供改后所在块；同块可重复以保留逐行可追溯性。“保留结构引用”不授权把身份显示给用户。非可见 ID 另有全量附录，避免只列三处。

| 基线位置 | 最终位置 | 改前源码/文案 | 改后源码/文案 | 处理/保留理由 |
|---|---|---|---|---|
| desktop/main/agentScheduler.ts:218 | desktop/main/agentScheduler.ts:218 | return { ok: false, code: 'MODEL_NOT_CONFIGURED', message: &#96;模型适配器 ${modelId} 未注册&#96; } | return { ok: false, code: 'MODEL_NOT_CONFIGURED', message: &#96;模型适配器 ${modelId} 未注册&#96; } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentScheduler.ts:646 | desktop/main/agentScheduler.ts:646 | try { this.deps.onUpdate?.(entry.task.taskId) } catch { /* UI 通知失败不影响任务记录 */ } | try { this.deps.onUpdate?.(entry.task.taskId) } catch { /* UI 通知失败不影响任务记录 */ } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentSessionChannels.ts:319 | desktop/main/agentSessionChannels.ts:319 | demo: { available: true, modelId: FAKE_MODEL_ID, label: '离线演示（假模型，不联网）' }, | demo: { available: true, modelId: FAKE_MODEL_ID, label: '离线演示（假模型，不联网）' }, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentSessionChannels.ts:333 | desktop/main/agentSessionChannels.ts:333 | data: { real: runtime.status(), demo: { available: true, modelId: FAKE_MODEL_ID, label: '离线演示（假模型，不联网）' } }, | data: { real: runtime.status(), demo: { available: true, modelId: FAKE_MODEL_ID, label: '离线演示（假模型，不联网）' } }, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentSessionChannels.ts:350 | desktop/main/agentSessionChannels.ts:350 | data: { real: runtime.status(), demo: { available: true, modelId: FAKE_MODEL_ID, label: '离线演示（假模型，不联网）' } }, | data: { real: runtime.status(), demo: { available: true, modelId: FAKE_MODEL_ID, label: '离线演示（假模型，不联网）' } }, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentTaskStore.ts:68 | desktop/main/agentTaskStore.ts:68 | if (parsed.schemaVersion !== 1 \|\| parsed.task.taskId !== taskId) throw new Error('任务记录身份不符') | if (parsed.schemaVersion !== 1 \|\| parsed.task.taskId !== taskId) throw new Error('任务记录身份不符') | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolChannels.ts:31 | desktop/main/agentToolChannels.ts:31 | const rejected = (code: 'INVALID_INPUT' \| 'STALE_BASE', message: string): ToolResult<never> => ({ ok: false, code, message, requestId: randomUUID(), objectVersion: 'unavailable' }) | const rejected = (code: 'INVALID_INPUT' \| 'STALE_BASE', message: string): ToolResult<never> => ({ ok: false, code, message, requestId: randomUUID(), objectVersion: 'unavailable' }) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:177 | desktop/main/agentToolService.ts:177 | const stamp = (snapshot: ProjectFileSnapshot) => stableFingerprint({ ...snapshot, attachments: snapshot.attachments.map(a => ({ blobKey: a.blobKey, digest: createHash('sha256').update(a.bytes).digest('hex') })) }) | const stamp = (snapshot: ProjectFileSnapshot) => stableFingerprint({ ...snapshot, attachments: snapshot.attachments.map(a => ({ blobKey: a.blobKey, digest: createHash('sha256').update(a.bytes).digest('hex') })) }) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:284 | desktop/main/agentToolService.ts:284 | return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' } | return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:335 | desktop/main/agentToolService.ts:335 | if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' } | if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:379 | desktop/main/agentToolService.ts:379 | if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion } | if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:382 | desktop/main/agentToolService.ts:382 | return { ok: false, code: 'NOT_CONFIRMED', message: '预览不存在、已过期或不属于当前窗口，请重新预览', requestId, objectVersion } | return { ok: false, code: 'NOT_CONFIRMED', message: '预览不存在、已过期或不属于当前窗口，请重新预览', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:386 | desktop/main/agentToolService.ts:386 | return { ok: false, code: 'INVALID_INPUT', message: '授权服务未装配', requestId, objectVersion } | return { ok: false, code: 'INVALID_INPUT', message: '授权服务未装配', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:425 | desktop/main/agentToolService.ts:425 | if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion } | if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:427 | desktop/main/agentToolService.ts:427 | if (approvals === undefined) return { ok: false, code: 'INVALID_INPUT', message: '授权服务未装配', requestId, objectVersion } | if (approvals === undefined) return { ok: false, code: 'INVALID_INPUT', message: '授权服务未装配', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:451 | desktop/main/agentToolService.ts:451 | if (stored === null \|\| stored.draft.draftId !== approval.draftId) return fail('NOT_CONFIRMED', '工程草稿不存在或身份不符', 'DRAFT_MISSING') | if (stored === null \|\| stored.draft.draftId !== approval.draftId) return fail('NOT_CONFIRMED', '工程草稿不存在或身份不符', 'DRAFT_MISSING') | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:586 | desktop/main/agentToolService.ts:586 | if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' } | if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:589 | desktop/main/agentToolService.ts:589 | if (given.length !== 1) return { ok: false, code: 'INVALID_INPUT', message: '必须且只能提供 requirementRevisionId / checkId / parameterId 之一', requestId, objectVersion } | if (given.length !== 1) return { ok: false, code: 'INVALID_INPUT', message: '必须且只能提供 requirementRevisionId / checkId / parameterId 之一', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:592 | desktop/main/agentToolService.ts:592 | if (parameter === undefined) return { ok: false, code: 'INVALID_INPUT', message: '参数不存在，无法定位', requestId, objectVersion } | if (parameter === undefined) return { ok: false, code: 'INVALID_INPUT', message: '参数不存在，无法定位', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:617 | desktop/main/agentToolService.ts:617 | if (current.requirementRevisionId === null) return { ok: false, code: 'INVALID_INPUT', message: '该检查没有条款来源可定位', requestId, objectVersion } | if (current.requirementRevisionId === null) return { ok: false, code: 'INVALID_INPUT', message: '该检查没有条款来源可定位', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:623 | desktop/main/agentToolService.ts:623 | return { ok: false, code: 'INVALID_INPUT', message: '检查记录不存在，或没有可定位的条款来源', requestId, objectVersion } | return { ok: false, code: 'INVALID_INPUT', message: '检查记录不存在，或没有可定位的条款来源', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:631 | desktop/main/agentToolService.ts:631 | return { ok: false, code: 'INVALID_INPUT', message: resolved.issue?.message ?? '条款版本不存在，无法定位', requestId, objectVersion } | return { ok: false, code: 'INVALID_INPUT', message: resolved.issue?.message ?? '条款版本不存在，无法定位', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:662 | desktop/main/agentToolService.ts:662 | if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion } | if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:664 | desktop/main/agentToolService.ts:664 | if (ports === undefined) return { ok: false, code: 'UNSUPPORTED_SCOPE', message: '导出端口未装配', requestId, objectVersion } | if (ports === undefined) return { ok: false, code: 'UNSUPPORTED_SCOPE', message: '导出端口未装配', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:666 | desktop/main/agentToolService.ts:666 | return { ok: false, code: 'SAVE_FAILED', message: '当前项目尚未保存到磁盘，只能导出已保存版本', requestId, objectVersion } | return { ok: false, code: 'SAVE_FAILED', message: '当前项目尚未保存到磁盘，只能导出已保存版本', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:670 | desktop/main/agentToolService.ts:670 | if (current !== session) return { ok: false, code: 'STALE_BASE', message: '活动项目已切换', requestId, objectVersion } | if (current !== session) return { ok: false, code: 'STALE_BASE', message: '活动项目已切换', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:674 | desktop/main/agentToolService.ts:674 | return { ok: false, code: 'TOOL_FAILED', message: &#96;图纸无法重建：${rebuilt.message}&#96;, requestId, objectVersion: revisionId } | return { ok: false, code: 'TOOL_FAILED', message: &#96;图纸无法重建：${rebuilt.message}&#96;, requestId, objectVersion: revisionId } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:683 | desktop/main/agentToolService.ts:683 | return { ok: false, code: 'UNSUPPORTED_SCOPE', message: 'PDF 渲染端口未装配，改用 svg', requestId, objectVersion: revisionId } | return { ok: false, code: 'UNSUPPORTED_SCOPE', message: 'PDF 渲染端口未装配，改用 svg', requestId, objectVersion: revisionId } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:688 | desktop/main/agentToolService.ts:688 | return { ok: false, code: 'TOOL_FAILED', message: 'PDF 渲染失败，未产生文件', requestId, objectVersion: revisionId } | return { ok: false, code: 'TOOL_FAILED', message: 'PDF 渲染失败，未产生文件', requestId, objectVersion: revisionId } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:696 | desktop/main/agentToolService.ts:696 | return { ok: false, code: 'CANCELLED', message: '已在系统对话框中取消导出；没有产生文件', requestId, objectVersion: revisionId } | return { ok: false, code: 'CANCELLED', message: '已在系统对话框中取消导出；没有产生文件', requestId, objectVersion: revisionId } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:775 | desktop/main/agentToolService.ts:775 | return { ok: false, code: 'TOOL_FAILED', message: '新会话建立后无法读取', requestId, objectVersion } | return { ok: false, code: 'TOOL_FAILED', message: '新会话建立后无法读取', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:931 | desktop/main/agentToolService.ts:931 | return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' } | return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:962 | desktop/main/agentToolService.ts:962 | return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' } | return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1003 | desktop/main/agentToolService.ts:1003 | return { ok: false, code: 'TOOL_FAILED', message: '意图草稿写入后无法读取', requestId, objectVersion } | return { ok: false, code: 'TOOL_FAILED', message: '意图草稿写入后无法读取', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1016 | desktop/main/agentToolService.ts:1016 | if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion } | if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1030 | desktop/main/agentToolService.ts:1030 | revisions: session.snapshot.revisions.map((r) => ({ revisionId: r.id, sha256: r.sha256 })), | revisions: session.snapshot.revisions.map((r) => ({ revisionId: r.id, sha256: r.sha256 })), | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1097 | desktop/main/agentToolService.ts:1097 | return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' } | return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1102 | desktop/main/agentToolService.ts:1102 | return { ok: false, code: 'UNSUPPORTED_SCOPE', message: '当前项目不是无任务书项目', requestId, objectVersion } | return { ok: false, code: 'UNSUPPORTED_SCOPE', message: '当前项目不是无任务书项目', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1106 | desktop/main/agentToolService.ts:1106 | return { ok: false, code: 'INVALID_INPUT', message: '意图草稿不存在', requestId, objectVersion } | return { ok: false, code: 'INVALID_INPUT', message: '意图草稿不存在', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1144 | desktop/main/agentToolService.ts:1144 | return { ok: false, code: 'TOOL_FAILED', message: '确认后无法读取意图草稿', requestId, objectVersion } | return { ok: false, code: 'TOOL_FAILED', message: '确认后无法读取意图草稿', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1154 | desktop/main/agentToolService.ts:1154 | return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' } | return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1296 | desktop/main/agentToolService.ts:1296 | if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion } | if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1298 | desktop/main/agentToolService.ts:1298 | if (this.deps.controller.sessionFor(windowId) !== session) return { ok: false, code: 'STALE_BASE', message: '活动项目已切换', requestId, objectVersion } | if (this.deps.controller.sessionFor(windowId) !== session) return { ok: false, code: 'STALE_BASE', message: '活动项目已切换', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1328 | desktop/main/agentToolService.ts:1328 | return { ok: false, code: 'INVALID_INPUT', message: '建项参数只接受名称与零件类型 spacer', requestId, objectVersion } | return { ok: false, code: 'INVALID_INPUT', message: '建项参数只接受名称与零件类型 spacer', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1337 | desktop/main/agentToolService.ts:1337 | if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion } | if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1340 | desktop/main/agentToolService.ts:1340 | return { ok: false, code: 'INVALID_INPUT', message: '缺少本轮用户原话，不能校验数值来源', requestId, objectVersion } | return { ok: false, code: 'INVALID_INPUT', message: '缺少本轮用户原话，不能校验数值来源', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1349 | desktop/main/agentToolService.ts:1349 | if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion } | if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1354 | desktop/main/agentToolService.ts:1354 | return { ok: false, code: 'INVALID_INPUT', message: '导出格式只支持 pdf 或 svg', requestId, objectVersion } | return { ok: false, code: 'INVALID_INPUT', message: '导出格式只支持 pdf 或 svg', requestId, objectVersion } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1366 | desktop/main/agentToolService.ts:1366 | return { ok: false, code: known ? error.code : 'TOOL_FAILED', message: known ? error.message : '工程工具执行失败', details: known ? error.details : undefined, requestId, objectVersion: session.snapshot.project.currentRevisionId } | return { ok: false, code: known ? error.code : 'TOOL_FAILED', message: known ? error.message : '工程工具执行失败', details: known ? error.details : undefined, requestId, objectVersion: session.snapshot.project.currentRevisionId } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1417 | desktop/main/agentToolService.ts:1417 | const draft = session.snapshot.project.extractionDrafts.find(d => d.draftId === (input as { draftId: string }).draftId) | const draft = session.snapshot.project.extractionDrafts.find(d => d.draftId === (input as { draftId: string }).draftId) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1492 | desktop/main/agentToolService.ts:1492 | if (!credential \|\| credential.windowId !== windowId \|\| credential.sessionId !== session.sessionId \|\| credential.expires < Date.now()) throw new MappingError('NOT_CONFIRMED', '计划凭据不存在、过期或不属于本窗口') | if (!credential \|\| credential.windowId !== windowId \|\| credential.sessionId !== session.sessionId \|\| credential.expires < Date.now()) throw new MappingError('NOT_CONFIRMED', '计划凭据不存在、过期或不属于本窗口') | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1500 | desktop/main/agentToolService.ts:1500 | if (stableFingerprint(draft) !== stableFingerprint(current) \|\| stableFingerprint(draft) !== credential.draftDigest) throw new MappingError('NOT_CONFIRMED', '候选决定代数已变化', { causeCode: 'STALE_DECISION' }) | if (stableFingerprint(draft) !== stableFingerprint(current) \|\| stableFingerprint(draft) !== credential.draftDigest) throw new MappingError('NOT_CONFIRMED', '候选决定代数已变化', { causeCode: 'STALE_DECISION' }) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1504 | desktop/main/agentToolService.ts:1504 | revisions: session.snapshot.revisions.map((r) => ({ revisionId: r.id, sha256: r.sha256 })) }) | revisions: session.snapshot.revisions.map((r) => ({ revisionId: r.id, sha256: r.sha256 })) }) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1528 | desktop/main/agentToolService.ts:1528 | if (!stored \|\| stored.draft.draftId !== req.draftId \|\| stored.draft.baseRevisionId !== revisionId) throw new MappingError('STALE_PREVIEW', '工程草稿不存在或已过期') | if (!stored \|\| stored.draft.draftId !== req.draftId \|\| stored.draft.baseRevisionId !== revisionId) throw new MappingError('STALE_PREVIEW', '工程草稿不存在或已过期') | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/agentToolService.ts:1533 | desktop/main/agentToolService.ts:1533 | if (!extraction \|\| stableFingerprint(extraction) !== stored.sourceDigest) throw new MappingError('NOT_CONFIRMED', '来源决定已变化', { causeCode: 'STALE_DECISION' }) | if (!extraction \|\| stableFingerprint(extraction) !== stored.sourceDigest) throw new MappingError('NOT_CONFIRMED', '来源决定已变化', { causeCode: 'STALE_DECISION' }) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/changeService.ts:196 | desktop/main/changeService.ts:196 | return &#96;组成环 ${binding.termId} 存在第二个参数绑定&#96; | return &#96;组成环 ${binding.termId} 存在第二个参数绑定&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/changeService.ts:200 | desktop/main/changeService.ts:200 | return &#96;绑定 ${binding.bindingId} 引用了不存在的组成环&#96; | return &#96;绑定 ${binding.bindingId} 引用了不存在的组成环&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/changeService.ts:204 | desktop/main/changeService.ts:204 | return &#96;绑定 ${binding.bindingId} 引用了不存在的参数&#96; | return &#96;绑定 ${binding.bindingId} 引用了不存在的参数&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/changeService.ts:207 | desktop/main/changeService.ts:207 | return &#96;绑定 ${binding.bindingId} 的部件与参数不一致&#96; | return &#96;绑定 ${binding.bindingId} 的部件与参数不一致&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/changeService.ts:210 | desktop/main/changeService.ts:210 | return &#96;绑定 ${binding.bindingId} 指向不支持的部件&#96; | return &#96;绑定 ${binding.bindingId} 指向不支持的部件&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/changeService.ts:247 | desktop/main/changeService.ts:247 | diffs.push(&#96;参数 ${item.parameterId} 在预览中不存在&#96;) | diffs.push(&#96;参数 ${item.parameterId} 在预览中不存在&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/changeService.ts:256 | desktop/main/changeService.ts:256 | diffs.push(&#96;参数 ${item.parameterId} 与预览不一致&#96;) | diffs.push(&#96;参数 ${item.parameterId} 与预览不一致&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/changeService.ts:263 | desktop/main/changeService.ts:263 | diffs.push(&#96;组成环 ${item.termId} 与预览不一致&#96;) | diffs.push(&#96;组成环 ${item.termId} 与预览不一致&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/changeService.ts:1042 | desktop/main/changeService.ts:1042 | reason: request.reason.trim() \|\| &#96;从版本 ${request.sourceRevisionId} 恢复&#96;, | reason: request.reason.trim() \|\| &#96;从版本 ${request.sourceRevisionId} 恢复&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/changeService.ts:1128 | desktop/main/changeService.ts:1128 | }, &#96;版本 ${leftRevisionId} 没有图纸记录&#96;), | }, &#96;版本 ${leftRevisionId} 没有图纸记录&#96;), | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/changeService.ts:1141 | desktop/main/changeService.ts:1141 | }, &#96;版本 ${leftRevisionId} 缺少隔套参数，不能重建旧图&#96;), | }, &#96;版本 ${leftRevisionId} 缺少隔套参数，不能重建旧图&#96;), | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/changeService.ts:1176 | desktop/main/changeService.ts:1176 | value: compareDrawings(null, rightSide, &#96;${rebuiltLeft.reason}（版本 ${leftRevisionId}）&#96;), | value: compareDrawings(null, rightSide, &#96;${rebuiltLeft.reason}（版本 ${leftRevisionId}）&#96;), | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/changeService.ts:1183 | desktop/main/changeService.ts:1183 | label: &#96;版本 ${leftRevisionId}&#96;, | label: &#96;版本 ${leftRevisionId}&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/channels.ts:89 | desktop/main/channels.ts:89 | { message: 'revisionId 不能是路径' }, | { message: 'revisionId 不能是路径' }, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/extractionChannels.ts:119 | desktop/main/extractionChannels.ts:119 | { message: 'batchId 与 candidateId 必须二选一' }, | { message: 'batchId 与 candidateId 必须二选一' }, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/extractionService.ts:448 | desktop/main/extractionService.ts:448 | return failure('NOT_FOUND', '提取草稿不存在或已被替换', &#96;draftId=${request.draftId}&#96;) | return failure('NOT_FOUND', '提取草稿不存在或已被替换', &#96;draftId=${request.draftId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/extractionService.ts:461 | desktop/main/extractionService.ts:461 | return failure('NOT_FOUND', '候选不存在', &#96;candidateId=${request.candidateId}&#96;) | return failure('NOT_FOUND', '候选不存在', &#96;candidateId=${request.candidateId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/extractionService.ts:846 | desktop/main/extractionService.ts:846 | result.value.candidateIds.map((candidateId) => &#96;candidate:${candidateId}:unit&#96;), | result.value.candidateIds.map((candidateId) => &#96;candidate:${candidateId}:unit&#96;), | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/extractionService.ts:912 | desktop/main/extractionService.ts:912 | return failure('NOT_FOUND', '提取草稿不存在或已被删除', &#96;draftId=${request.draftId}&#96;) | return failure('NOT_FOUND', '提取草稿不存在或已被删除', &#96;draftId=${request.draftId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/fileStore.ts:324 | desktop/main/fileStore.ts:324 | : &#96;期望 ${options.expectedFingerprint ?? '不存在'}，实际 ${currentFingerprint}&#96;, | : &#96;期望 ${options.expectedFingerprint ?? '不存在'}，实际 ${currentFingerprint}&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/ingestReadings.ts:40 | desktop/main/ingestReadings.ts:40 | !attachment \|\| createHash('sha256').update(attachment.bytes).digest('hex') !== source.sha256) return fail('SOURCE_CHANGED', '读数来源页不存在、越界或哈希不一致') | !attachment \|\| createHash('sha256').update(attachment.bytes).digest('hex') !== source.sha256) return fail('SOURCE_CHANGED', '读数来源页不存在、越界或哈希不一致') | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/migrationBackup.ts:185 | desktop/main/migrationBackup.ts:185 | return &#96;迁移前已创建可恢复副本：${record.backupPath}（SHA-256 ${record.sha256}，${record.byteSize} 字节），原文件 ${record.originalPath}。&#96; | return &#96;迁移前已创建可恢复副本：${record.backupPath}（SHA-256 ${record.sha256}，${record.byteSize} 字节），原文件 ${record.originalPath}。&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/realModelRuntime.ts:86 | desktop/main/realModelRuntime.ts:86 | return { ok: false, code: 'UNSUPPORTED_SCOPE', model: null, latencyMs: 0, message: &#96;暂不支持适配器 ${settings.adapterId}&#96; } | return { ok: false, code: 'UNSUPPORTED_SCOPE', model: null, latencyMs: 0, message: &#96;暂不支持适配器 ${settings.adapterId}&#96; } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| desktop/main/sourceChannels.ts:114 | desktop/main/sourceChannels.ts:114 | reject('SOURCE_NOT_FOUND', '要换版的来源文档不属于当前项目', params.documentId ?? '') | reject('SOURCE_NOT_FOUND', '要换版的来源文档不属于当前项目', params.documentId ?? '') | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| mcp/tools/read-taskbook.ts:242 | mcp/tools/read-taskbook.ts:242 | message: &#96;候选 ${String(symbolOf(candidate) ?? candidate.candidateId)} 的 ${incomplete | message: &#96;候选 ${String(symbolOf(candidate) ?? candidate.candidateId)} 的 ${incomplete | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/confirm-efficiency-report.mjs:117 | scripts/confirm-efficiency-report.mjs:117 | &#96;${row.id} ${row.file}: 候选 ${row.candidates}（pending ${row.pending}｜blocked ${row.blocked}）&#96; + | &#96;${row.id} ${row.file}: 候选 ${row.candidates}（pending ${row.pending}｜blocked ${row.blocked}）&#96; + | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/confirm-efficiency-seed.ts:40 | scripts/confirm-efficiency-seed.ts:40 | expect(sha256, &#96;语料 ${doc.file} 与 manifest sha256 不一致&#96;).toBe(doc.sha256) | expect(sha256, &#96;语料 ${doc.file} 与 manifest sha256 不一致&#96;).toBe(doc.sha256) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/evidence-ref-candidates.mjs:132 | scripts/evidence-ref-candidates.mjs:132 | process.stderr.write(&#96;${entry.doc.id}: ${candidates.length} 候选\n&#96;) | process.stderr.write(&#96;${entry.doc.id}: ${candidates.length} 候选\n&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/evidence-ref-candidates.mjs:159 | scripts/evidence-ref-candidates.mjs:159 | console.log(&#96;${doc.id} 候选=${doc.candidateCount} draft=${doc.draftId} sha=${doc.candidateArraySha256}&#96;) | console.log(&#96;${doc.id} 候选=${doc.candidateCount} draft=${doc.draftId} sha=${doc.candidateArraySha256}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/evidence-ref-record.mjs:35 | scripts/evidence-ref-record.mjs:35 | throw new Error(&#96;缺少候选身份快照：${row.id}&#96;) | throw new Error(&#96;缺少候选身份快照：${row.id}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/ingest-readings-evidence.ts:101 | scripts/ingest-readings-evidence.ts:101 | identity: { actorId: '验收转录', sessionLabel: '合成装配；读数来自扫描页' }, appVersion: 'evidence', electronVersion: 'evidence' }) } } | identity: { actorId: '验收转录', sessionLabel: '合成装配；读数来自扫描页' }, appVersion: 'evidence', electronVersion: 'evidence' }) } } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/ingest-readings-evidence.ts:122 | scripts/ingest-readings-evidence.ts:122 | const imported = await h.invoke<SourceImportValue>(IPC_CHANNELS.sourceImport, { sessionId: opened.sessionId, baseEditSeq: session.acceptedSeq }) | const imported = await h.invoke<SourceImportValue>(IPC_CHANNELS.sourceImport, { sessionId: opened.sessionId, baseEditSeq: session.acceptedSeq }) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/intent-record.mjs:40 | scripts/intent-record.mjs:40 | if (now === undefined \|\| before === undefined) throw new Error(&#96;缺少候选身份快照：${row.id}&#96;) | if (now === undefined \|\| before === undefined) throw new Error(&#96;缺少候选身份快照：${row.id}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/intent-seed.ts:22 | scripts/intent-seed.ts:22 | identity: { actorId: '老王', sessionLabel: '2026-11-12 走查' }, | identity: { actorId: '老王', sessionLabel: '2026-11-12 走查' }, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/real-doc-metrics.mjs:89 | scripts/real-doc-metrics.mjs:89 | console.log(&#96;${doc.id} 阻塞原因码：${reasonCodes}&#96;) | console.log(&#96;${doc.id} 阻塞原因码：${reasonCodes}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/real-doc-metrics.mjs:90 | scripts/real-doc-metrics.mjs:90 | console.log(&#96;${doc.id} 问题码：${issues}；无文本层页：${doc.issues.noTextLayerPages.join(',') \|\| '无'}&#96;) | console.log(&#96;${doc.id} 问题码：${issues}；无文本层页：${doc.issues.noTextLayerPages.join(',') \|\| '无'}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/real-doc-metrics.mjs:113 | scripts/real-doc-metrics.mjs:113 | &#96;页范围探针 ${probe.id}：候选 ${probe.candidates.total}（pending ${probe.candidates.pending}｜&#96; + | &#96;页范围探针 ${probe.id}：候选 ${probe.candidates.total}（pending ${probe.candidates.pending}｜&#96; + | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/real-doc-metrics.mjs:176 | scripts/real-doc-metrics.mjs:176 | &#96;${doc.id} 声明「${unit.statement}」｜actor=${unit.actor}｜sessionSeq=${unit.sessionSeq}｜turnId=${unit.turnId}&#96; + | &#96;${doc.id} 声明「${unit.statement}」｜actor=${unit.actor}｜sessionSeq=${unit.sessionSeq}｜turnId=${unit.turnId}&#96; + | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/real-doc-metrics.mjs:177 | scripts/real-doc-metrics.mjs:177 | &#96;｜batchId=${unit.batchId.slice(0, 24)}…｜决定 ${unit.decisionCount} 条｜三类不支持保持：${preserved}&#96;, | &#96;｜batchId=${unit.batchId.slice(0, 24)}…｜决定 ${unit.decisionCount} 条｜三类不支持保持：${preserved}&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/real-docs/metrics.mjs:80 | scripts/real-docs/metrics.mjs:80 | throw new CorpusError('CORPUS_MANIFEST_INVALID', &#96;${doc.file} 的 sha256 不是 64 位小写十六进制&#96;) | throw new CorpusError('CORPUS_MANIFEST_INVALID', &#96;${doc.file} 的 sha256 不是 64 位小写十六进制&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/real-docs/metrics.mjs:89 | scripts/real-docs/metrics.mjs:89 | throw new CorpusError('CORPUS_MANIFEST_INVALID', &#96;manifest 里 id 重复：${doc.id}&#96;) | throw new CorpusError('CORPUS_MANIFEST_INVALID', &#96;manifest 里 id 重复：${doc.id}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/supersub-report.mjs:12 | scripts/supersub-report.mjs:12 | const comparison=after.map((row,i)=>({index:i+1,...row,before:before.flatMap(d=>d.details).find(d=>d.docId===row.docId&&d.cropFile===row.cropFile)?.matches})) | const comparison=after.map((row,i)=>({index:i+1,...row,before:before.flatMap(d=>d.details).find(d=>d.docId===row.docId&&d.cropFile===row.cropFile)?.matches})) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/supersub-report.mjs:20 | scripts/supersub-report.mjs:20 | for(const r of comparison) lines.push(&#96;\| ${r.index} \| ${r.docId}/p${r.page} \| ${r.originalText} \| ${r.before.map(m=>m.nominal).join(', ')} \| ${r.matches.map(m=>m.nominal).join(', ')} \| ${r.matches.map(m=>&#96;${m.upperDeviation??'无'}/${m.lowerDeviation??'无'}&#96;).join('; ')} \| ${r.matches.map(m=>m.status).join(', ')} \|&#96;) | for(const r of comparison) lines.push(&#96;\| ${r.index} \| ${r.docId}/p${r.page} \| ${r.originalText} \| ${r.before.map(m=>m.nominal).join(', ')} \| ${r.matches.map(m=>m.nominal).join(', ')} \| ${r.matches.map(m=>&#96;${m.upperDeviation??'无'}/${m.lowerDeviation??'无'}&#96;).join('; ')} \| ${r.matches.map(m=>m.status).join(', ')} \|&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/supersub-report.mjs:26 | scripts/supersub-report.mjs:26 | writeFileSync('docs/evidence/supersub-fix/index.html',&#96;<!doctype html><html lang="zh"><meta charset="utf-8"><title>上下标修复裁片与真值对照</title><style>body{font:16px system-ui;margin:32px;max-width:1200px}img{max-width:100%;border:1px solid #bbb}figure{padding:16px;background:#f7f7f7}td,th{border:1px solid #ccc;padding:8px}table{border-collapse:collapse}code{white-space:pre-wrap}</style><h1>上下标与公差粘连修复</h1><p>${escape(JSON.stringify(metrics.summary.correctness))}</p><h2>三张原件裁片示例</h2>${examples.map(t=>&#96;<figure><figcaption>${escape(t.docId+' p'+t.page+' '+t.originalText)}</figcaption><img src="../ground-truth/${t.cropFile}"></figure>&#96;).join('')}<h2>19 条逐条对照</h2><table><tr><th>文档/页</th><th>原文</th><th>改前 nominal</th><th>改后 nominal</th><th>状态</th></tr>${comparison.map(r=>&#96;<tr><td>${r.docId} p${r.page}</td><td>${escape(r.originalText)}</td><td>${escape(r.before.map(m=>m.nominal).join(','))}</td><td>${escape(r.matches.map(m=>m.nominal).join(','))}</td><td>${r.matches.map(m=>m.status).join(',')}</td></tr>&#96;).join('')}</table></html>&#96;) | writeFileSync('docs/evidence/supersub-fix/index.html',&#96;<!doctype html><html lang="zh"><meta charset="utf-8"><title>上下标修复裁片与真值对照</title><style>body{font:16px system-ui;margin:32px;max-width:1200px}img{max-width:100%;border:1px solid #bbb}figure{padding:16px;background:#f7f7f7}td,th{border:1px solid #ccc;padding:8px}table{border-collapse:collapse}code{white-space:pre-wrap}</style><h1>上下标与公差粘连修复</h1><p>${escape(JSON.stringify(metrics.summary.correctness))}</p><h2>三张原件裁片示例</h2>${examples.map(t=>&#96;<figure><figcaption>${escape(t.docId+' p'+t.page+' '+t.originalText)}</figcaption><img src="../ground-truth/${t.cropFile}"></figure>&#96;).join('')}<h2>19 条逐条对照</h2><table><tr><th>文档/页</th><th>原文</th><th>改前 nominal</th><th>改后 nominal</th><th>状态</th></tr>${comparison.map(r=>&#96;<tr><td>${r.docId} p${r.page}</td><td>${escape(r.originalText)}</td><td>${escape(r.before.map(m=>m.nominal).join(','))}</td><td>${escape(r.matches.map(m=>m.nominal).join(','))}</td><td>${r.matches.map(m=>m.status).join(',')}</td></tr>&#96;).join('')}</table></html>&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/unit-attest-state-seed.ts:62 | scripts/unit-attest-state-seed.ts:62 | expect(sha256, &#96;语料 ${doc.file} 与 manifest sha256 不一致&#96;).toBe(doc.sha256) | expect(sha256, &#96;语料 ${doc.file} 与 manifest sha256 不一致&#96;).toBe(doc.sha256) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/unit-attest-state-seed.ts:104 | scripts/unit-attest-state-seed.ts:104 | expect(candidate, &#96;${candidateId} 不在补单位后的草稿里&#96;).toBeDefined() | expect(candidate, &#96;${candidateId} 不在补单位后的草稿里&#96;).toBeDefined() | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/unit-attest-state-seed.ts:114 | scripts/unit-attest-state-seed.ts:114 | expect(ref, &#96;${candidateId} 缺少 user-attestation&#96;).toBeDefined() | expect(ref, &#96;${candidateId} 缺少 user-attestation&#96;).toBeDefined() | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/v40-stage1-mutations.mjs:8 | scripts/v40-stage1-mutations.mjs:8 | ['M08', 'const plan = planApplication(draft, { source: draft.sourceIdentity, candidateIds: req.candidateIds })', &#96;const plan = { ok: true as const, value: { applied: false as const, items: draft.candidates.filter(c => req.candidateIds.includes(c.candidateId)).map(c => ({ candidateId: c.candidateId, kind: c.kind, groupId: c.groupId, fields: candidateNumericFields(c).map(({ field, value }) => ({ field, text: value.text, valueQ: value.valueQ, unit: value.unit })), evidence: c.evidence })) } }&#96;, '02 伪造'], | ['M08', 'const plan = planApplication(draft, { source: draft.sourceIdentity, candidateIds: req.candidateIds })', &#96;const plan = { ok: true as const, value: { applied: false as const, items: draft.candidates.filter(c => req.candidateIds.includes(c.candidateId)).map(c => ({ candidateId: c.candidateId, kind: c.kind, groupId: c.groupId, fields: candidateNumericFields(c).map(({ field, value }) => ({ field, text: value.text, valueQ: value.valueQ, unit: value.unit })), evidence: c.evidence })) } }&#96;, '02 伪造'], | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/v40-stage1-packaged.mjs:40 | scripts/v40-stage1-packaged.mjs:40 | socket.addEventListener('message', e => { const r = JSON.parse(e.data); if (pending.has(r.id)) { pending.get(r.id)(r); pending.delete(r.id) } }) | socket.addEventListener('message', e => { const r = JSON.parse(e.data); if (pending.has(r.id)) { pending.get(r.id)(r); pending.delete(r.id) } }) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/v40-stage1-packaged.mjs:79 | scripts/v40-stage1-packaged.mjs:79 | const run = await call('runExtraction', { sessionId, baseEditSeq: seq, revisionId: 'sr-1', pageFrom: 1, pageTo: 2, requestId: crypto.randomUUID() }, r => ({ ok: r.ok, candidateCount: r.value?.candidateCount, draftId: r.value?.draftId, acceptedSeq: r.value?.acceptedSeq })) | const run = await call('runExtraction', { sessionId, baseEditSeq: seq, revisionId: 'sr-1', pageFrom: 1, pageTo: 2, requestId: crypto.randomUUID() }, r => ({ ok: r.ok, candidateCount: r.value?.candidateCount, draftId: r.value?.draftId, acceptedSeq: r.value?.acceptedSeq })) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/v40-stage1-packaged.mjs:84 | scripts/v40-stage1-packaged.mjs:84 | const decision = await call('decideExtraction', { sessionId, baseEditSeq: seq, draftId: extraction.draftId, candidateId: c.candidateId, editRevision: c.editRevision, action: 'confirm', confirmed: true }, r => ({ ok: r.ok, status: r.value?.status, decisionId: r.value?.decisionId, planTokenIssued: Boolean(r.value?.planToken), acceptedSeq: r.value?.acceptedSeq })) | const decision = await call('decideExtraction', { sessionId, baseEditSeq: seq, draftId: extraction.draftId, candidateId: c.candidateId, editRevision: c.editRevision, action: 'confirm', confirmed: true }, r => ({ ok: r.ok, status: r.value?.status, decisionId: r.value?.decisionId, planTokenIssued: Boolean(r.value?.planToken), acceptedSeq: r.value?.acceptedSeq })) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/v40-stage1-packaged.mjs:91 | scripts/v40-stage1-packaged.mjs:91 | const summarize = r => ({ ok: r.ok, objectVersion: r.objectVersion, draftId: r.data?.draftId, draftRevision: r.data?.draftRevision, geometry: r.data?.geometry, checkStatus: r.data?.checkStatus, result: r.data?.computation?.result, requirementPreview: r.data?.requirementPreview, missing: r.data?.missing }) | const summarize = r => ({ ok: r.ok, objectVersion: r.objectVersion, draftId: r.data?.draftId, draftRevision: r.data?.draftRevision, geometry: r.data?.geometry, checkStatus: r.data?.checkStatus, result: r.data?.computation?.result, requirementPreview: r.data?.requirementPreview, missing: r.data?.missing }) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/v40-stage1-packaged.mjs:95 | scripts/v40-stage1-packaged.mjs:95 | const context = await call('getProjectContext', undefined, r => ({ ok: r.ok, objectVersion: r.objectVersion, projectId: r.data?.projectId, revisionId: r.data?.revisionId, draftId: r.data?.draft?.draftId, formalParameters: r.data?.parameters })) | const context = await call('getProjectContext', undefined, r => ({ ok: r.ok, objectVersion: r.objectVersion, projectId: r.data?.projectId, revisionId: r.data?.revisionId, draftId: r.data?.draft?.draftId, formalParameters: r.data?.parameters })) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/v40-stage1-packaged.mjs:119 | scripts/v40-stage1-packaged.mjs:119 | const draftPath = path.join(isolatedHome ?? process.env.HOME, 'Library/Application Support/寸链/workspace/agent-inputs', &#96;${createHash('sha256').update('v40-stage1-seed').digest('hex')}.json&#96;) | const draftPath = path.join(isolatedHome ?? process.env.HOME, 'Library/Application Support/寸链/workspace/agent-inputs', &#96;${createHash('sha256').update('v40-stage1-seed').digest('hex')}.json&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| scripts/v40-stage4-metrics.mjs:65 | scripts/v40-stage4-metrics.mjs:65 | - 供应商回执模型：${data.providerProbe?.model ?? 'n/a'}（请求 ${data.adapter?.modelRequested}，适配器 ${data.adapter?.id}） | - 供应商回执模型：${data.providerProbe?.model ?? 'n/a'}（请求 ${data.adapter?.modelRequested}，适配器 ${data.adapter?.id}） | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/agent/toolSchemas.ts:209 | src/agent/toolSchemas.ts:209 | confirmed: { name: 'confirmed', description: '读取提取草稿的已确认候选（紧凑视图：candidateId、kind、summary、原文摘录）与冲突问题。只读。', parameters: confirmed }, | confirmed: { name: 'confirmed', description: '读取提取草稿的已确认候选（紧凑视图：candidateId、kind、summary、原文摘录）与冲突问题。只读。', parameters: confirmed }, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/agent-tools/mapConfirmed.ts:64 | src/agent-tools/mapConfirmed.ts:64 | throw new MappingError('CONSTRAINT_VIOLATED', &#96;字段重复：${field}&#96;, { candidateId: item.candidateId }) | throw new MappingError('CONSTRAINT_VIOLATED', &#96;字段重复：${field}&#96;, { candidateId: item.candidateId }) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/agent-tools/mapConfirmed.ts:95 | src/agent-tools/mapConfirmed.ts:95 | throw new MappingError('INVALID_INPUT', '计划引用的候选不存在或类型不符', { candidateId: item.candidateId }) | throw new MappingError('INVALID_INPUT', '计划引用的候选不存在或类型不符', { candidateId: item.candidateId }) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/agent-tools/mapConfirmed.ts:209 | src/agent-tools/mapConfirmed.ts:209 | if (!changed.has(term.id)) lack(&#96;bindings.${term.symbol}&#96;, '长度绑定需要完整的已映射环数值与方向') | if (!changed.has(term.id)) lack(&#96;bindings.${term.symbol}&#96;, '长度绑定需要完整的已映射环数值与方向') | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/agent-tools/mapConfirmed.ts:227 | src/agent-tools/mapConfirmed.ts:227 | throw new MappingError('CONSTRAINT_VIOLATED', '参数绑定与组成环基本尺寸不相等', { bindingId: binding.bindingId }) | throw new MappingError('CONSTRAINT_VIOLATED', '参数绑定与组成环基本尺寸不相等', { bindingId: binding.bindingId }) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/agent-tools/mapIntent.ts:28 | src/agent-tools/mapIntent.ts:28 | throw new MappingError('CONSTRAINT_VIOLATED', &#96;字段重复：${field}&#96;, { candidateId: item.candidateId }) | throw new MappingError('CONSTRAINT_VIOLATED', &#96;字段重复：${field}&#96;, { candidateId: item.candidateId }) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/agent-tools/mapIntent.ts:64 | src/agent-tools/mapIntent.ts:64 | throw new MappingError('INVALID_INPUT', '计划引用的候选不存在或类型不符', { candidateId: item.candidateId }) | throw new MappingError('INVALID_INPUT', '计划引用的候选不存在或类型不符', { candidateId: item.candidateId }) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/projectBundle.ts:284 | src/backup/projectBundle.ts:284 | &#96;未迁移项目：${legacy.id}&#96;, | &#96;未迁移项目：${legacy.id}&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:643 | src/backup/restoreParser.ts:643 | const prefix = &#96;分析快照 ${snapshotId} 的结果&#96; | const prefix = &#96;分析快照 ${snapshotId} 的结果&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:683 | src/backup/restoreParser.ts:683 | const prefix = &#96;分析快照 ${snapshot.id} 的审查结果&#96; | const prefix = &#96;分析快照 ${snapshot.id} 的审查结果&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:713 | src/backup/restoreParser.ts:713 | return &#96;${prefix}中 ${finding.ruleId} 的规则版本不一致&#96; | return &#96;${prefix}中 ${finding.ruleId} 的规则版本不一致&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:717 | src/backup/restoreParser.ts:717 | return &#96;${prefix}中 ${finding.ruleId} 的作用域无效&#96; | return &#96;${prefix}中 ${finding.ruleId} 的作用域无效&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:720 | src/backup/restoreParser.ts:720 | return &#96;${prefix}中 ${finding.ruleId} 已通过却要求人工动作&#96; | return &#96;${prefix}中 ${finding.ruleId} 已通过却要求人工动作&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:725 | src/backup/restoreParser.ts:725 | return &#96;${prefix}中 ${finding.ruleId} 的链级对象无效&#96; | return &#96;${prefix}中 ${finding.ruleId} 的链级对象无效&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:732 | src/backup/restoreParser.ts:732 | return &#96;${prefix}中 ${finding.ruleId} 的定位目标无效&#96; | return &#96;${prefix}中 ${finding.ruleId} 的定位目标无效&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:742 | src/backup/restoreParser.ts:742 | return &#96;${prefix}中 ${finding.ruleId} 的组成环对象无效&#96; | return &#96;${prefix}中 ${finding.ruleId} 的组成环对象无效&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:754 | src/backup/restoreParser.ts:754 | return &#96;${prefix}中 ${finding.ruleId} 的绑定对象无效&#96; | return &#96;${prefix}中 ${finding.ruleId} 的绑定对象无效&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:764 | src/backup/restoreParser.ts:764 | return &#96;${prefix}中 ${finding.ruleId} 的定位目标与绑定对象不一致&#96; | return &#96;${prefix}中 ${finding.ruleId} 的定位目标与绑定对象不一致&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:825 | src/backup/restoreParser.ts:825 | const prefix = &#96;分析快照 ${snapshot.id} 的来源清单&#96; | const prefix = &#96;分析快照 ${snapshot.id} 的来源清单&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:830 | src/backup/restoreParser.ts:830 | return &#96;${prefix}包含重复的来源文档 ${document.id}&#96; | return &#96;${prefix}包含重复的来源文档 ${document.id}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:833 | src/backup/restoreParser.ts:833 | return &#96;${prefix}的来源文档 ${document.id} 属于其它项目&#96; | return &#96;${prefix}的来源文档 ${document.id} 属于其它项目&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:836 | src/backup/restoreParser.ts:836 | return &#96;${prefix}的来源文档 ${document.id} 在备份中不存在&#96; | return &#96;${prefix}的来源文档 ${document.id} 在备份中不存在&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:843 | src/backup/restoreParser.ts:843 | return &#96;${prefix}包含重复的来源版本 ${revision.id}&#96; | return &#96;${prefix}包含重复的来源版本 ${revision.id}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:846 | src/backup/restoreParser.ts:846 | return &#96;${prefix}的来源版本 ${revision.id} 属于其它项目&#96; | return &#96;${prefix}的来源版本 ${revision.id} 属于其它项目&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:850 | src/backup/restoreParser.ts:850 | return &#96;${prefix}的来源版本 ${revision.id} 的文档不存在&#96; | return &#96;${prefix}的来源版本 ${revision.id} 的文档不存在&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:854 | src/backup/restoreParser.ts:854 | return &#96;${prefix}的来源版本 ${revision.id} 与备份记录不一致&#96; | return &#96;${prefix}的来源版本 ${revision.id} 与备份记录不一致&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:858 | src/backup/restoreParser.ts:858 | return &#96;${prefix}的来源文档 ${document.id} 与备份记录不一致&#96; | return &#96;${prefix}的来源文档 ${document.id} 与备份记录不一致&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:864 | src/backup/restoreParser.ts:864 | return &#96;${prefix}的来源文档 ${document.id} 最新版本不在清单内&#96; | return &#96;${prefix}的来源文档 ${document.id} 最新版本不在清单内&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:872 | src/backup/restoreParser.ts:872 | return &#96;${prefix}包含重复的绑定 ${entry.bindingId}&#96; | return &#96;${prefix}包含重复的绑定 ${entry.bindingId}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:878 | src/backup/restoreParser.ts:878 | return &#96;${prefix}的绑定 ${entry.bindingId} 引用的版本不在清单内&#96; | return &#96;${prefix}的绑定 ${entry.bindingId} 引用的版本不在清单内&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:881 | src/backup/restoreParser.ts:881 | return &#96;${prefix}的绑定 ${entry.bindingId} 引用的文档不在清单内&#96; | return &#96;${prefix}的绑定 ${entry.bindingId} 引用的文档不在清单内&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:891 | src/backup/restoreParser.ts:891 | return &#96;${prefix}的绑定 ${entry.bindingId} 与版本/文档元数据不一致&#96; | return &#96;${prefix}的绑定 ${entry.bindingId} 与版本/文档元数据不一致&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:894 | src/backup/restoreParser.ts:894 | return &#96;${prefix}的绑定 ${entry.bindingId} 页码超出页数&#96; | return &#96;${prefix}的绑定 ${entry.bindingId} 页码超出页数&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:897 | src/backup/restoreParser.ts:897 | return &#96;${prefix}的绑定 ${entry.bindingId} 声称附件可用，但备份中没有该附件&#96; | return &#96;${prefix}的绑定 ${entry.bindingId} 声称附件可用，但备份中没有该附件&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:902 | src/backup/restoreParser.ts:902 | return &#96;${prefix}的绑定 ${entry.bindingId} 指向已删除组成环却保留了环信息&#96; | return &#96;${prefix}的绑定 ${entry.bindingId} 指向已删除组成环却保留了环信息&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:912 | src/backup/restoreParser.ts:912 | return &#96;${prefix}的绑定 ${entry.bindingId} 的环信息与冻结定义不一致&#96; | return &#96;${prefix}的绑定 ${entry.bindingId} 的环信息与冻结定义不一致&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:945 | src/backup/restoreParser.ts:945 | return &#96;分析快照 ${snapshot.id} 有冻结对比结果却没有基线&#96; | return &#96;分析快照 ${snapshot.id} 有冻结对比结果却没有基线&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:948 | src/backup/restoreParser.ts:948 | const prefix = &#96;分析快照 ${snapshot.id} 的冻结基线对比&#96; | const prefix = &#96;分析快照 ${snapshot.id} 的冻结基线对比&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:980 | src/backup/restoreParser.ts:980 | return &#96;分析快照 ${snapshot.id} 的草稿无法转换为尺寸链&#96; | return &#96;分析快照 ${snapshot.id} 的草稿无法转换为尺寸链&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:983 | src/backup/restoreParser.ts:983 | return &#96;分析快照 ${snapshot.id} 的草稿与冻结定义不一致&#96; | return &#96;分析快照 ${snapshot.id} 的草稿与冻结定义不一致&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1177 | src/backup/restoreParser.ts:1177 | throw new BackupRecordError(&#96;草稿文件名与 projectId 不一致：${path}&#96;) | throw new BackupRecordError(&#96;草稿文件名与 projectId 不一致：${path}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1381 | src/backup/restoreParser.ts:1381 | return &#96;manifest 声明的缺失附件版本不存在：${missing.revisionId}&#96; | return &#96;manifest 声明的缺失附件版本不存在：${missing.revisionId}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1387 | src/backup/restoreParser.ts:1387 | return &#96;manifest 声明的缺失附件 ${missing.revisionId} 与版本记录不一致&#96; | return &#96;manifest 声明的缺失附件 ${missing.revisionId} 与版本记录不一致&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1390 | src/backup/restoreParser.ts:1390 | return &#96;manifest 重复声明缺失附件：${missing.revisionId}&#96; | return &#96;manifest 重复声明缺失附件：${missing.revisionId}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1400 | src/backup/restoreParser.ts:1400 | return &#96;草稿引用的项目不存在：${draft.projectId}&#96; | return &#96;草稿引用的项目不存在：${draft.projectId}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1406 | src/backup/restoreParser.ts:1406 | return &#96;来源文档引用的项目既不存在也不是已退役作用域：${document.projectId}&#96; | return &#96;来源文档引用的项目既不存在也不是已退役作用域：${document.projectId}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1410 | src/backup/restoreParser.ts:1410 | return &#96;来源文档 ${document.id} 的最新版本不存在：${document.latestRevisionId}&#96; | return &#96;来源文档 ${document.id} 的最新版本不存在：${document.latestRevisionId}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1413 | src/backup/restoreParser.ts:1413 | return &#96;来源文档 ${document.id} 的最新版本属于其它文档：${latest.id}&#96; | return &#96;来源文档 ${document.id} 的最新版本属于其它文档：${latest.id}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1420 | src/backup/restoreParser.ts:1420 | return &#96;来源版本 ${revision.id} 引用的文档不存在：${revision.documentId}&#96; | return &#96;来源版本 ${revision.id} 引用的文档不存在：${revision.documentId}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1423 | src/backup/restoreParser.ts:1423 | return &#96;来源版本 ${revision.id} 与文档 ${document.id} 的项目作用域不一致&#96; | return &#96;来源版本 ${revision.id} 与文档 ${document.id} 的项目作用域不一致&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1431 | src/backup/restoreParser.ts:1431 | return &#96;来源版本 ${revision.id} 的附件不存在，且 manifest 未声明缺失：${revision.blobKey}&#96; | return &#96;来源版本 ${revision.id} 的附件不存在，且 manifest 未声明缺失：${revision.blobKey}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1436 | src/backup/restoreParser.ts:1436 | return &#96;来源版本 ${revision.id} 在 manifest 中声明附件缺失，但备份中存在附件&#96; | return &#96;来源版本 ${revision.id} 在 manifest 中声明附件缺失，但备份中存在附件&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1439 | src/backup/restoreParser.ts:1439 | return &#96;来源版本 ${revision.id} 与附件 ${revision.blobKey} 的项目作用域不一致（拒绝跨项目附件引用）&#96; | return &#96;来源版本 ${revision.id} 与附件 ${revision.blobKey} 的项目作用域不一致（拒绝跨项目附件引用）&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1442 | src/backup/restoreParser.ts:1442 | return &#96;来源版本 ${revision.id} 与附件 ${revision.blobKey} 的哈希或大小不一致&#96; | return &#96;来源版本 ${revision.id} 与附件 ${revision.blobKey} 的哈希或大小不一致&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1448 | src/backup/restoreParser.ts:1448 | return &#96;来源附件引用的项目既不存在也不是已退役作用域：${blob.projectId}&#96; | return &#96;来源附件引用的项目既不存在也不是已退役作用域：${blob.projectId}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1454 | src/backup/restoreParser.ts:1454 | return &#96;绑定引用的项目既不存在也不是已退役作用域：${binding.projectId}&#96; | return &#96;绑定引用的项目既不存在也不是已退役作用域：${binding.projectId}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1458 | src/backup/restoreParser.ts:1458 | return &#96;绑定 ${binding.id} 引用的来源文档不存在：${binding.documentId}&#96; | return &#96;绑定 ${binding.id} 引用的来源文档不存在：${binding.documentId}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1462 | src/backup/restoreParser.ts:1462 | return &#96;绑定 ${binding.id} 引用的来源版本不存在：${binding.revisionId}&#96; | return &#96;绑定 ${binding.id} 引用的来源版本不存在：${binding.revisionId}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1465 | src/backup/restoreParser.ts:1465 | return &#96;绑定 ${binding.id} 的版本与文档不匹配&#96; | return &#96;绑定 ${binding.id} 的版本与文档不匹配&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1468 | src/backup/restoreParser.ts:1468 | return &#96;绑定 ${binding.id} 与来源文档的项目作用域不一致&#96; | return &#96;绑定 ${binding.id} 与来源文档的项目作用域不一致&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1471 | src/backup/restoreParser.ts:1471 | return &#96;绑定 ${binding.id} 的页码 ${binding.page} 超出 ${revision.pageCount} 页&#96; | return &#96;绑定 ${binding.id} 的页码 ${binding.page} 超出 ${revision.pageCount} 页&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1477 | src/backup/restoreParser.ts:1477 | return &#96;事件引用的项目既不存在也不是已退役作用域：${event.projectId}&#96; | return &#96;事件引用的项目既不存在也不是已退役作用域：${event.projectId}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1483 | src/backup/restoreParser.ts:1483 | return &#96;分析快照引用的项目不存在：${snapshot.projectId}&#96; | return &#96;分析快照引用的项目不存在：${snapshot.projectId}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/backup/restoreParser.ts:1489 | src/backup/restoreParser.ts:1489 | return &#96;替换前快照引用的项目不存在：${snapshot.projectId}&#96; | return &#96;替换前快照引用的项目不存在：${snapshot.projectId}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/components/AgentReadEvidenceList.tsx:11 | src/components/AgentReadEvidenceList.tsx:11 | <small>{reading.source.kind === 'pdf-page' ? reading.source.revisionId : reading.source.imageId} · SHA-256 {reading.source.sha256}</small> | <small>{reading.source.kind === 'pdf-page' ? &#96;来源 PDF · 第 ${reading.source.page} 页&#96; : '来源图片'} · 校验信息保存在项目文件中</small> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/AgentSidebar.tsx:112 | src/components/AgentSidebar.tsx:114 | useEffect(() => { taskIdRef.current = taskId }, [taskId]) | useEffect(() => { taskIdRef.current = taskId }, [taskId]) | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/AgentSidebar.tsx:214 | src/components/AgentSidebar.tsx:216 | setCommit({ ok: true, code: null, message: &#96;已提交（工具回执） · 版本 ${committed.data.revisionId}&#96; }) | setCommit({ ok: true, code: null, message: &#96;已提交（工具回执） · ${await committedVersionLabel(committed.data.revisionId)}&#96; }) | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/AgentSidebar.tsx:227 | src/components/AgentSidebar.tsx:242 | ? &#96;已定位参数 ${parameterLabel(result.data.key)} · 绑定环 ${result.data.termIds.join('、') \|\| '无'}&#96; | ? &#96;已定位参数 ${parameterLabel(result.data.key)} · 关联组成环 ${result.data.termIds.length} 个&#96; | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/AgentSidebar.tsx:238 | src/components/AgentSidebar.tsx:253 | setNotice(&#96;已启动真实模型 · ${result.data.modelId}&#96;) | setNotice(&#96;已启动真实模型 · ${result.data.modelId}&#96;) | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/AgentSidebar.tsx:289 | src/components/AgentSidebar.tsx:304 | ? &#96;已导出 · ${result.data.fileName} · ${result.data.byteSize} B · ${result.data.sha256?.slice(0, 12)}…&#96; | ? &#96;已导出 · ${result.data.fileName} · ${result.data.byteSize} B · ${result.data.sha256?.slice(0, 12)}…&#96; | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/AgentSidebar.tsx:313 | src/components/AgentSidebar.tsx:328 | setIntentNote(&#96;已建立无任务书项目：责任人 ${result.data.actorId} · 第 ${result.data.sessionSeq} 次输入&#96;) | setIntentNote(&#96;已建立无任务书项目：责任人 ${result.data.actorId} · 第 ${result.data.sessionSeq} 次输入&#96;) | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/AgentSidebar.tsx:323 | src/components/AgentSidebar.tsx:338 | if (actorId.trim() === '') { setIntentNote('先在“你的称呼”里填一个名字：出处要写清是谁说的'); return } | if (actorId.trim() === '') { setIntentNote('先在“你的称呼”里填一个名字：出处要写清是谁说的'); return } | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/AgentSidebar.tsx:391 | src/components/AgentSidebar.tsx:406 | ? { ok: true, message: &#96;已保存为新版本（工具回执） · ${committed.data.revisionId}&#96; } | ? { ok: true, message: &#96;已保存为新版本（工具回执） · ${await committedVersionLabel(committed.data.revisionId)}&#96; } | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/AgentSidebar.tsx:428 | src/components/AgentSidebar.tsx:443 | <div><dt>正式版本</dt><dd>{revisionId ?? '—'}</dd></div> | <div><dt>正式版本</dt><dd>{uiVersionLabel(revisionSequence)}</dd></div> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/AgentSidebar.tsx:470 | src/components/AgentSidebar.tsx:485 | <input value={actorId} maxLength={40} onChange={event => setActorId(event.target.value)} aria-label="责任人称呼" placeholder="例如 老王" /> | <input value={actorId} maxLength={40} onChange={event => setActorId(event.target.value)} aria-label="责任人称呼" placeholder="例如 老王" /> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/AgentSidebar.tsx:479 | src/components/AgentSidebar.tsx:494 | <button type="button" disabled={busy \|\| !installed \|\| actorId.trim() === ''} onClick={() => void createIntent()}>建立无任务书项目</button> | <button type="button" disabled={busy \|\| !installed \|\| actorId.trim() === ''} onClick={() => void createIntent()}>建立无任务书项目</button> | 故意保留：React key / DOM-data 属性 / IPC 参数 / 结构标识，不是用户可见文本 |
| src/components/AgentSidebar.tsx:480 | src/components/AgentSidebar.tsx:495 | <button type="button" disabled={busy \|\| !installed \|\| actorId.trim() === ''} title="假模型只把你说过的数字写进草稿；确认与提交仍由你完成" onClick={() => void startIntentDemo()}>对话建件（离线演示）</button> | <button type="button" disabled={busy \|\| !installed \|\| actorId.trim() === ''} title="假模型只把你说过的数字写进草稿；确认与提交仍由你完成" onClick={() => void startIntentDemo()}>对话建件（离线演示）</button> | 故意保留：React key / DOM-data 属性 / IPC 参数 / 结构标识，不是用户可见文本 |
| src/components/AgentSidebar.tsx:486 | src/components/AgentSidebar.tsx:501 | {intent.candidates.some((c) => agentReadSources(c.provenance ?? []).length > 0) ? '依据：外部读数，须对照来源逐条核对' : '依据：用户输入，无外部原文件'} · {intent.actorId ?? '未填责任人'} · 第 {intent.sessionSeq} 次输入 | {intent.candidates.some((c) => agentReadSources(c.provenance ?? []).length > 0) ? '依据：外部读数，须对照来源逐条核对' : '依据：用户输入，无外部原文件'} · {intent.actorId ?? '未填责任人'} · 第 {intent.sessionSeq} 次输入 | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/AgentSidebar.tsx:504 | src/components/AgentSidebar.tsx:519 | : <button type="button" disabled={busy} onClick={() => void confirmIntentCandidate(candidate.candidateId, candidate.editRevision)}>确认这条</button>} | : <button type="button" disabled={busy} onClick={() => void confirmIntentCandidate(candidate.candidateId, candidate.editRevision)}>确认这条</button>} | 故意保留：React key / DOM-data 属性 / IPC 参数 / 结构标识，不是用户可见文本 |
| src/components/AgentSidebar.tsx:551 | src/components/AgentSidebar.tsx:566 | <button type="button" disabled={busy \|\| revisionId === null} onClick={() => void exportSaved('svg')}>导出已保存版本 SVG</button> | <button type="button" disabled={busy \|\| revisionId === null} onClick={() => void exportSaved('svg')}>导出已保存版本 SVG</button> | 故意保留：React key / DOM-data 属性 / IPC 参数 / 结构标识，不是用户可见文本 |
| src/components/AgentSidebar.tsx:552 | src/components/AgentSidebar.tsx:567 | <button type="button" disabled={busy \|\| revisionId === null} onClick={() => void exportSaved('pdf')}>导出 PDF</button> | <button type="button" disabled={busy \|\| revisionId === null} onClick={() => void exportSaved('pdf')}>导出 PDF</button> | 故意保留：React key / DOM-data 属性 / IPC 参数 / 结构标识，不是用户可见文本 |
| src/components/AgentSidebar.tsx:611 | src/components/AgentSidebar.tsx:626 | <div><dt>预览指纹</dt><dd className="agent-sidebar__mono">{preview.previewFingerprint.slice(0, 16)}…</dd></div> | <div><dt>预览指纹</dt><dd className="agent-sidebar__mono">{preview.previewFingerprint.slice(0, 16)}…</dd></div> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/AgentSidebar.tsx:625 | src/components/AgentSidebar.tsx:640 | {preview.requirement !== null && <button type="button" disabled={busy} onClick={() => void locate({ requirementRevisionId: preview.requirementRevisionId ?? undefined })}>定位条款来源</button>} | {preview.requirement !== null && <button type="button" disabled={busy} onClick={() => void locate({ requirementRevisionId: preview.requirementRevisionId ?? undefined })}>定位条款来源</button>} | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/ChangeWorkbench.tsx:330 | src/components/ChangeWorkbench.tsx:331 | <span>Rev {revision.revisionId} · {revision.reason} · 父 {revision.parentId ?? '无'}</span> | <span>{uiFileVersionLabel(snapshot.fileRevisions, revision.revisionId)} · {uiDiagnosticText(revision.reason)} · 父版本：{revision.parentId === null ? '无' : uiFileVersionLabel(snapshot.fileRevisions, revision.parentId)}</span> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ChangeWorkbench.tsx:363 | src/components/ChangeWorkbench.tsx:363 | {row.revisionId ? &#96;（版本 ${row.revisionId} 第 ${row.page ?? '?'} 页）&#96; : ''} | {row.ruleId}：{uiDiagnosticText(row.reason)}                   {row.revisionId ? &#96;（${uiSourceVersionLabel(snapshot.revisions, row.revisionId)} 第 ${row.page ?? '?'} 页）&#96; : ''} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ChangeWorkbench.tsx:402 | src/components/ChangeWorkbench.tsx:403 | <h3>预览：{preview.drawing.record.revisionId}</h3> | <h3>预览：草稿 · {uiVersionLabel(snapshot.fileRevisions.length + 1)}</h3> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ChangeWorkbench.tsx:430 | src/components/ChangeWorkbench.tsx:431 | 绑定标注：{preview.drawing.right.annotations.map((item) => &#96;${item.annotationId}（${item.parameterId}）&#96;).join('、') \|\| '无'} | 绑定标注：{preview.drawing.right.annotations.map((_, index) => &#96;标注 ${index + 1}&#96;).join('、') \|\| '无'} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ChangeWorkbench.tsx:437 | src/components/ChangeWorkbench.tsx:438 | <figcaption>旧版本 {preview.drawing.left?.revisionId ?? '不可用'} · {preview.drawing.left ? &#96;${preview.drawing.left.scale.numerator}:${preview.drawing.left.scale.denominator}&#96; : '—'}</figcaption> | <figcaption>旧版本 {preview.drawing.left ? uiFileVersionLabel(snapshot.fileRevisions, preview.drawing.left.revisionId) : '不可用'} · {preview.drawing.left ? &#96;${preview.drawing.left.scale.numerator}:${preview.drawing.left.scale.denominator}&#96; : '—'}</figcaption> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ChangeWorkbench.tsx:447 | src/components/ChangeWorkbench.tsx:449 | <figcaption>当前草稿 {preview.drawing.right.revisionId} · {preview.drawing.right.scale.numerator}:{preview.drawing.right.scale.denominator}</figcaption> | <figcaption>当前草稿 · {uiVersionLabel(snapshot.fileRevisions.length + 1)} · {preview.drawing.right.scale.numerator}:{preview.drawing.right.scale.denominator}</figcaption> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/DesktopSessionViews.tsx:38 | src/components/DesktopSessionViews.tsx:39 | <tbody>{draft.terms.map((term, index) => <tr key={term.id}> | <tbody>{draft.terms.map((term, index) => <tr key={term.id}> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/DesktopSessionViews.tsx:45 | src/components/DesktopSessionViews.tsx:46 | onChange={event => edit({ type: 'updateField', termId: term.id, field, value: event.target.value })} /> | onChange={event => edit({ type: 'updateField', termId: term.id, field, value: event.target.value })} /> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/DesktopSessionViews.tsx:48 | src/components/DesktopSessionViews.tsx:49 | <td><select aria-label={&#96;第 ${index + 1} 行 ${term.symbol} 方向&#96;} value={term.sign} disabled={disabled} onChange={event => edit({ type: 'updateField', termId: term.id, field: 'sign', value: event.target.value === '1' ? 1 : -1 })}><option value="1">增环 (+)</option><option value="-1">减环 (−)</option></select></td> | <td><select aria-label={&#96;第 ${index + 1} 行 ${term.symbol} 方向&#96;} value={term.sign} disabled={disabled} onChange={event => edit({ type: 'updateField', termId: term.id, field: 'sign', value: event.target.value === '1' ? 1 : -1 })}><option value="1">增环 (+)</option><option value="-1">减环 (−)</option></select></td> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/DesktopSessionViews.tsx:125 | src/components/DesktopSessionViews.tsx:126 | note: &#96;任务书条款选区 · ${highlightRequirement.requirementRevisionId}&#96;, | note: '任务书条款选区', | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/DesktopSessionViews.tsx:141 | src/components/DesktopSessionViews.tsx:142 | {snapshot.revisions.length === 0 && location.revisionId === '' ? null : <label>来源版本 <select aria-label="来源版本" value={location.revisionId} onChange={event => setLocation({ revisionId: event.target.value, page: 1, termId: null, requirementRevisionId: null })}>{revision === undefined && location.revisionId !== '' ? <option value={location.revisionId}>{location.revisionId}（不在项目文件中）</option> : null}{snapshot.revisions.map(rev => <option key={rev.id} value={rev.id}>{rev.fileName} · {rev.id}</option>)}</select></label>} | {snapshot.revisions.length === 0 && location.revisionId === '' ? null : <label>来源版本 <select aria-label="来源版本" value={location.revisionId} onChange={event => setLocation({ revisionId: event.target.value, page: 1, termId: null, requirementRevisionId: null })}>{revision === undefined && location.revisionId !== '' ? <option value={location.revisionId}>未命名版本（不在项目文件中）</option> : null}{snapshot.revisions.map(rev => <option key={rev.id} value={rev.id}>{rev.fileName} · {uiSourceVersionLabel(snapshot.revisions, rev.id)}</option>)}</select></label>} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/DesktopSessionViews.tsx:142 | src/components/DesktopSessionViews.tsx:143 | {snapshot.documents.map(doc => <button key={doc.id} type="button" onClick={() => onImportVersion(doc.id)}>导入「{doc.title}」新版…</button>)} | {snapshot.documents.map(doc => <button key={doc.id} type="button" onClick={() => onImportVersion(doc.id)}>导入「{doc.title}」新版…</button>)} | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/DesktopSessionViews.tsx:143 | src/components/DesktopSessionViews.tsx:144 | <ul className="desktop-workspace__locations">{snapshot.bindings.map(binding => <li key={binding.id}><span>{snapshot.project.dimensionChain.terms.find(term => term.id === binding.termId)?.symbol ?? binding.termId} · 第 {binding.page} 页 · {binding.revisionId} </span><button disabled={!snapshot.revisions.some(rev => rev.id === binding.revisionId)} onClick={() => { setLocation({ revisionId: binding.revisionId, page: binding.page, termId: binding.termId, requirementRevisionId: null }); setZoom(1); setRotation(0) }}>查看原图位置</button></li>)} | <ul className="desktop-workspace__locations">{snapshot.bindings.map(binding => <li key={binding.id}><span>{snapshot.project.dimensionChain.terms.find(term => term.id === binding.termId)?.symbol ?? '未命名组成环'} · 第 {binding.page} 页 · {uiSourceVersionLabel(snapshot.revisions, binding.revisionId)} </span><button disabled={!snapshot.revisions.some(rev => rev.id === binding.revisionId)} onClick={() => { setLocation({ revisionId: binding.revisionId, page: binding.page, termId: binding.termId, requirementRevisionId: null }); setZoom(1); setRotation(0) }}>查看原图位置</button></li>)}         {requirementSource && <li><span>任务书条款（活动）· 第 {requirementSource.page} 页 · {uiSourceVersionLabel(snapshot.revisions, requirementSource.revisionId)}</span><button onClick={() => { setLocation({ revisionId: requirementSource.revisionId, page: requirementSource.page, termId: '__requirement__', requirementRevisionId: requirementSource.requirementRevisionId }); setZoom(1); setRotation(0) }}>定位任务书</button></li>}         {locate && locate.requirementRevisionId !== requirementSource?.requirementRevisionId && <li><span>任务书条款历史版本 · 第 {locate.page} 页 · {uiSourceVersionLabel(snapshot.revisions, locate.revisionId)}</span><button onClick={() => { setLocation({ revisionId: locate.revisionId, page: locate.page, termId: '__requirement__', requirementRevisionId: locate.requirementRevisionId }); setZoom(1); setRotation(0) }}>定位此历史版本</button></li>} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/DesktopSessionViews.tsx:144 | src/components/DesktopSessionViews.tsx:144 | {requirementSource && <li><span>任务书条款（活动）· 第 {requirementSource.page} 页 · {requirementSource.revisionId}（{requirementSource.label}）</span><button onClick={() => { setLocation({ revisionId: requirementSource.revisionId, page: requirementSource.page, termId: '__requirement__', requirementRevisionId: requirementSource.requirementRevisionId }); setZoom(1); setRotation(0) }}>定位任务书</button></li>} | <ul className="desktop-workspace__locations">{snapshot.bindings.map(binding => <li key={binding.id}><span>{snapshot.project.dimensionChain.terms.find(term => term.id === binding.termId)?.symbol ?? '未命名组成环'} · 第 {binding.page} 页 · {uiSourceVersionLabel(snapshot.revisions, binding.revisionId)} </span><button disabled={!snapshot.revisions.some(rev => rev.id === binding.revisionId)} onClick={() => { setLocation({ revisionId: binding.revisionId, page: binding.page, termId: binding.termId, requirementRevisionId: null }); setZoom(1); setRotation(0) }}>查看原图位置</button></li>)}         {requirementSource && <li><span>任务书条款（活动）· 第 {requirementSource.page} 页 · {uiSourceVersionLabel(snapshot.revisions, requirementSource.revisionId)}</span><button onClick={() => { setLocation({ revisionId: requirementSource.revisionId, page: requirementSource.page, termId: '__requirement__', requirementRevisionId: requirementSource.requirementRevisionId }); setZoom(1); setRotation(0) }}>定位任务书</button></li>}         {locate && locate.requirementRevisionId !== requirementSource?.requirementRevisionId && <li><span>任务书条款历史版本 · 第 {locate.page} 页 · {uiSourceVersionLabel(snapshot.revisions, locate.revisionId)}</span><button onClick={() => { setLocation({ revisionId: locate.revisionId, page: locate.page, termId: '__requirement__', requirementRevisionId: locate.requirementRevisionId }); setZoom(1); setRotation(0) }}>定位此历史版本</button></li>} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/DesktopSessionViews.tsx:145 | src/components/DesktopSessionViews.tsx:144 | {locate && locate.requirementRevisionId !== requirementSource?.requirementRevisionId && <li><span>任务书条款历史版本 · 第 {locate.page} 页 · {locate.revisionId}（{locate.label}）</span><button onClick={() => { setLocation({ revisionId: locate.revisionId, page: locate.page, termId: '__requirement__', requirementRevisionId: locate.requirementRevisionId }); setZoom(1); setRotation(0) }}>定位此历史版本</button></li>} | <ul className="desktop-workspace__locations">{snapshot.bindings.map(binding => <li key={binding.id}><span>{snapshot.project.dimensionChain.terms.find(term => term.id === binding.termId)?.symbol ?? '未命名组成环'} · 第 {binding.page} 页 · {uiSourceVersionLabel(snapshot.revisions, binding.revisionId)} </span><button disabled={!snapshot.revisions.some(rev => rev.id === binding.revisionId)} onClick={() => { setLocation({ revisionId: binding.revisionId, page: binding.page, termId: binding.termId, requirementRevisionId: null }); setZoom(1); setRotation(0) }}>查看原图位置</button></li>)}         {requirementSource && <li><span>任务书条款（活动）· 第 {requirementSource.page} 页 · {uiSourceVersionLabel(snapshot.revisions, requirementSource.revisionId)}</span><button onClick={() => { setLocation({ revisionId: requirementSource.revisionId, page: requirementSource.page, termId: '__requirement__', requirementRevisionId: requirementSource.requirementRevisionId }); setZoom(1); setRotation(0) }}>定位任务书</button></li>}         {locate && locate.requirementRevisionId !== requirementSource?.requirementRevisionId && <li><span>任务书条款历史版本 · 第 {locate.page} 页 · {uiSourceVersionLabel(snapshot.revisions, locate.revisionId)}</span><button onClick={() => { setLocation({ revisionId: locate.revisionId, page: locate.page, termId: '__requirement__', requirementRevisionId: locate.requirementRevisionId }); setZoom(1); setRotation(0) }}>定位此历史版本</button></li>} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/DesktopSessionViews.tsx:147 | src/components/DesktopSessionViews.tsx:148 | {selectedRequirement !== null && <p data-testid="requirement-locate-summary">已定位 {selectedRequirement.label} · 来源 PDF {selectedRequirement.revisionId} 第 {selectedRequirement.page} 页 · 选区 PDF 点 {formatRequirementRect(selectedRequirement.rectPdf)}</p>} | {selectedRequirement !== null && <p data-testid="requirement-locate-summary">已定位任务书条款 · 来源 PDF {uiSourceVersionLabel(snapshot.revisions, selectedRequirement.revisionId)} 第 {selectedRequirement.page} 页 · 选区 PDF 点 {formatRequirementRect(selectedRequirement.rectPdf)}</p>}       {requirementIssue !== null ? <p role="alert" data-testid="requirement-locate-error">来源缺失：{uiDiagnosticText(requirementIssue.message)}</p> : missing ? <p role="alert">附件不可用：此版本已声明缺失，无法显示原图。</p> : revision ? <PdfViewer readOnly revision={revision} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/DesktopSessionViews.tsx:170 | src/components/DesktopSessionViews.tsx:172 | {snapshot.analysisSnapshots.map(item => <article key={item.id} className="desktop-workspace__history-item" aria-label={&#96;历史报告 ${item.id}&#96;}> | {snapshot.analysisSnapshots.map(item => <article key={item.id} className="desktop-workspace__history-item" aria-label={&#96;历史报告 ${item.projectName} · ${item.createdAt}&#96;}>       <h3>{item.projectName} · 分析快照</h3><p>{item.createdAt} · 引擎 {item.engineVersion} · 规则 {item.reviewRulesVersion}</p> | 故意保留：React key / DOM-data 属性 / IPC 参数 / 结构标识，不是用户可见文本 |
| src/components/DesktopSessionViews.tsx:171 | src/components/DesktopSessionViews.tsx:172 | <h3>{item.projectName} · {item.id}</h3><p>{item.createdAt} · 引擎 {item.engineVersion} · 规则 {item.reviewRulesVersion}</p> | {snapshot.analysisSnapshots.map(item => <article key={item.id} className="desktop-workspace__history-item" aria-label={&#96;历史报告 ${item.projectName} · ${item.createdAt}&#96;}>       <h3>{item.projectName} · 分析快照</h3><p>{item.createdAt} · 引擎 {item.engineVersion} · 规则 {item.reviewRulesVersion}</p> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/DimensionTable.tsx:390 | src/components/DimensionTable.tsx:390 | ? &#96;已绑定 ${sourceBindingCounts[term.id]} 处来源&#96; | ? &#96;已绑定 ${sourceBindingCounts[term.id]} 处来源&#96; | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/DimensionTable.tsx:393 | src/components/DimensionTable.tsx:393 | ? &#96; · ${sourceReviewPendingCounts?.[term.id]} 处待复核&#96; | ? &#96; · ${sourceReviewPendingCounts?.[term.id]} 处待复核&#96; | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/DxfViewer.tsx:116 | src/components/DxfViewer.tsx:116 | {viaViewport === null ? '' : &#96;（经视口 ${viaViewport}）&#96;} | {viaViewport === null ? '' : '（经图纸视口）'} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ExtractionReviewPanel.tsx:313 | src/components/ExtractionReviewPanel.tsx:314 | ? &#96;已确认候选 ${candidate.candidateId}（仅记录决定，不自动写入尺寸链/条款）。&#96; | ? '已确认此候选（仅记录决定，不自动写入尺寸链/条款）。' | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ExtractionReviewPanel.tsx:315 | src/components/ExtractionReviewPanel.tsx:316 | ? &#96;已拒绝候选 ${candidate.candidateId}；不会复活，也不进入项目。&#96; | ? '已拒绝此候选；不会复活，也不进入项目。' | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ExtractionReviewPanel.tsx:317 | src/components/ExtractionReviewPanel.tsx:318 | ? &#96;已撤销候选 ${candidate.candidateId} 的确认；该候选回到待确认，同一符号其它处恢复可选。&#96; | ? '已撤销此候选的确认；该候选回到待确认，同一符号其它处恢复可选。' | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ExtractionReviewPanel.tsx:346 | src/components/ExtractionReviewPanel.tsx:347 | setMessage(&#96;已批量拒绝 ${selectedIds.length} 条候选（逐条记录理由）。&#96;) | setMessage(&#96;已批量拒绝 ${selectedIds.length} 条候选（逐条记录理由）。&#96;) | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/ExtractionReviewPanel.tsx:463 | src/components/ExtractionReviewPanel.tsx:464 | &#96;已删除旧草稿 ${target.draftId}（${target.extractorVersion}）：只删了这一份草稿，来源 PDF、条款、绑定与图纸未改动；保存项目后写入文件。&#96;, | &#96;已删除旧草稿（${target.extractorVersion}）：只删了这一份草稿，来源 PDF、条款、绑定与图纸未改动；保存项目后写入文件。&#96;, | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ExtractionReviewPanel.tsx:504 | src/components/ExtractionReviewPanel.tsx:505 | aria-label={&#96;选择候选 ${candidate.candidateId}&#96;} | aria-label={&#96;选择候选 ${candidate.kind === 'ring' ? candidate.data.symbol : candidate.kind}&#96;} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ExtractionReviewPanel.tsx:543 | src/components/ExtractionReviewPanel.tsx:544 | <p>{reading.source.kind === 'pdf-page' ? &#96;来源版本：${reading.source.revisionId}&#96; : &#96;图片：${reading.source.imageId}&#96;} · SHA-256 {reading.source.sha256}</p> | <p>{reading.source.kind === 'pdf-page' ? &#96;来源 PDF · 第 ${reading.source.page} 页&#96; : '来源图片'} · 校验信息保存在项目文件中</p> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ExtractionReviewPanel.tsx:565 | src/components/ExtractionReviewPanel.tsx:566 | （{unitAttestation.actorId} · {unitAttestation.turnId ?? '无轮次'}） | （{unitAttestation.actorId} · 用户声明） | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ExtractionReviewPanel.tsx:649 | src/components/ExtractionReviewPanel.tsx:650 | onClick={() => void revokeUnits({ candidateId: candidate.candidateId })} | onClick={() => void revokeUnits({ candidateId: candidate.candidateId })} | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/ExtractionReviewPanel.tsx:658 | src/components/ExtractionReviewPanel.tsx:659 | onClick={() => { setRejecting(candidate.candidateId); setRejectReason('') }} | onClick={() => { setRejecting(candidate.candidateId); setRejectReason('') }} | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/ExtractionReviewPanel.tsx:778 | src/components/ExtractionReviewPanel.tsx:779 | {item.fileName} · {item.id} · {item.pageCount} 页 | {item.fileName} · {uiSourceVersionLabel(revisions, item.id)} · {item.pageCount} 页 | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ExtractionReviewPanel.tsx:823 | src/components/ExtractionReviewPanel.tsx:824 | 当前选择的是旧版本（latest 为 {sourceDocument?.latestRevisionId}）。提取只读这个确切版本，不会自动改用 latest。 | 当前选择的是旧版本（最新为 {uiSourceVersionLabel(revisions, sourceDocument?.latestRevisionId)}）。提取只读这个确切版本，不会自动改用最新版。 | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ExtractionReviewPanel.tsx:843 | src/components/ExtractionReviewPanel.tsx:844 | 草稿 {scope.current.draftId.slice(0, 14)} · {extractorVersionLabel(scope.current.extractorVersion)} · 第 {scope.current.pageRange.from}–{scope.current.pageRange.to} 页 | 草稿 · {extractorVersionLabel(scope.current.extractorVersion)} · 第 {scope.current.pageRange.from}–{scope.current.pageRange.to} 页 | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ExtractionReviewPanel.tsx:849 | src/components/ExtractionReviewPanel.tsx:850 | 当前显示：<code>{draft.extractorVersion}</code> · 草稿 <code>{draft.draftId}</code> · 第 {draft.pageRange.from}–{draft.pageRange.to} 页 | 当前显示：<code>{draft.extractorVersion}</code> · 提取草稿 · 第 {draft.pageRange.from}–{draft.pageRange.to} 页 | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ExtractionReviewPanel.tsx:855 | src/components/ExtractionReviewPanel.tsx:856 | 确切 PDF 版本 <code>{draft.sourceIdentity.revisionId}</code> · SHA-256{' '} | 确切 PDF 版本 <span>{uiSourceVersionLabel(revisions, draft.sourceIdentity.revisionId)}</span> · SHA-256{' '} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ExtractionReviewPanel.tsx:856 | src/components/ExtractionReviewPanel.tsx:857 | <code>{draft.sourceIdentity.sha256.slice(0, 12)}…</code> · 页范围 {draft.pageRange.from}–{draft.pageRange.to} | <code>{draft.sourceIdentity.sha256.slice(0, 12)}…</code> · 页范围 {draft.pageRange.from}–{draft.pageRange.to} | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/ExtractionReviewPanel.tsx:903 | src/components/ExtractionReviewPanel.tsx:904 | 批量补单位（{unitOnlyIds.length} 条）… | 批量补单位（{unitOnlyIds.length} 条）… | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/ExtractionReviewPanel.tsx:921 | src/components/ExtractionReviewPanel.tsx:922 | 确认补单位（{unitOnlyIds.length} 条） | 确认补单位（{unitOnlyIds.length} 条） | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/ExtractionReviewPanel.tsx:950 | src/components/ExtractionReviewPanel.tsx:951 | 补单位批次 {batch.batchId.slice(0, 18)}… · {batch.candidateIds.length} 条 · 单位来源： | 补单位批次 · {batch.candidateIds.length} 条 · 单位来源： | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ExtractionReviewPanel.tsx:957 | src/components/ExtractionReviewPanel.tsx:958 | onClick={() => void revokeUnits({ batchId: batch.batchId })} | onClick={() => void revokeUnits({ batchId: batch.batchId })} | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/ExtractionReviewPanel.tsx:969 | src/components/ExtractionReviewPanel.tsx:970 | <span>已选 {selectedIds.length} 项</span> | <span>已选 {selectedIds.length} 项</span> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/ExtractionReviewPanel.tsx:979 | src/components/ExtractionReviewPanel.tsx:980 | <button type="button" onClick={() => void rejectSelected()} disabled={busy \|\| selectedIds.length === 0}> | <button type="button" onClick={() => void rejectSelected()} disabled={busy \|\| selectedIds.length === 0}> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/ExtractionReviewPanel.tsx:1017 | src/components/ExtractionReviewPanel.tsx:1018 | 本组全部确认（{batchIds.length} 条） | 本组全部确认（{batchIds.length} 条） | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/ExtractionReviewPanel.tsx:1085 | src/components/ExtractionReviewPanel.tsx:1086 | <button type="button" onClick={() => setConfirmDeleteId(null)}>取消</button> | <button type="button" onClick={() => setConfirmDeleteId(null)}>取消</button> | 故意保留：React key / DOM-data 属性 / IPC 参数 / 结构标识，不是用户可见文本 |
| src/components/ExtractionReviewPanel.tsx:1091 | src/components/ExtractionReviewPanel.tsx:1092 | aria-label={&#96;旧草稿候选列表 ${old.draftId}&#96;} | aria-label={&#96;旧草稿候选列表 ${old.extractorVersion}&#96;} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ExtractionReviewPanel.tsx:1107 | src/components/ExtractionReviewPanel.tsx:1108 | 已定位 {locate.label} · 来源 PDF {locate.revisionId} 第 {locate.page} 页 · 选区 PDF 点 {formatRect(locate.rectPdf)} | 已定位 {uiDiagnosticText(locate.label)} · 来源 PDF {uiSourceVersionLabel(revisions, locate.revisionId)} 第 {locate.page} 页 · 选区 PDF 点 {formatRect(locate.rectPdf)} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/PdfViewer.tsx:52 | src/components/PdfViewer.tsx:53 | /** &#96;${revisionId}::${page}::${zoom}::${rotation}&#96;；与当前请求不一致即不可交互。 */ | /** &#96;${revisionId}::${page}::${zoom}::${rotation}&#96;；与当前请求不一致即不可交互。 */ | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/PdfViewer.tsx:486 | src/components/PdfViewer.tsx:487 | {revision.sha256.slice(0, 12)}… · 打开的是这个确切版本，不跟随同名最新版 | {revision.sha256.slice(0, 12)}… · 打开的是这个确切版本，不跟随同名最新版 | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/RequirementRevisionHistory.tsx:68 | src/components/RequirementRevisionHistory.tsx:71 | <code className="requirement-history__id">{item.revisionId}</code> | <span>{uiVersionLabel(index + 1)}</span> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/RequirementRevisionHistory.tsx:74 | src/components/RequirementRevisionHistory.tsx:77 | <code className="requirement-history__id">{item.parentRevisionId}</code> | <span>{uiVersionLabel(items.findIndex(parent => parent.revisionId === item.parentRevisionId) + 1)}</span> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/RequirementRevisionHistory.tsx:89 | src/components/RequirementRevisionHistory.tsx:92 | <code className="requirement-history__id">{item.sourceRevisionId}</code> | <span>{uiSourceVersionLabel(sourceRevisions, item.sourceRevisionId)}</span> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/RequirementRevisionHistory.tsx:119 | src/components/RequirementRevisionHistory.tsx:122 | aria-label={&#96;定位条款版本 ${item.revisionId} 的来源 PDF&#96;} | aria-label={&#96;定位${uiVersionLabel(index + 1)}的来源 PDF&#96;} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/RequirementStatusPanel.tsx:83 | src/components/RequirementStatusPanel.tsx:84 | 条款版本 {revision.revisionId}（父 {revision.parentRevisionId ?? '无'}）· 来源{' '} | 条款：未命名版本（父版本：{revision.parentRevisionId === null ? '无' : '未命名版本'}）· 来源 PDF{' '}               第 {revision.source.page} 页 · SHA-256{' '} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/RequirementStatusPanel.tsx:84 | src/components/RequirementStatusPanel.tsx:84 | {revision.source.revisionId} 第 {revision.source.page} 页 · SHA-256{' '} | 条款：未命名版本（父版本：{revision.parentRevisionId === null ? '无' : '未命名版本'}）· 来源 PDF{' '}               第 {revision.source.page} 页 · SHA-256{' '} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/RequirementStatusPanel.tsx:89 | src/components/RequirementStatusPanel.tsx:90 | 条款版本 {revision.revisionId}（父 {revision.parentRevisionId ?? '无'}）· 来源：用户输入（第{' '} | 条款：未命名版本（父版本：{revision.parentRevisionId === null ? '无' : '未命名版本'}）· 来源：用户输入（第{' '} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/RequirementWizard.tsx:282 | src/components/RequirementWizard.tsx:282 | {item.fileName} · {item.id} · {item.pageCount} 页 · {item.sha256.slice(0, 12)}… | {item.fileName} · 未命名版本 · {item.pageCount} 页 · {item.sha256.slice(0, 12)}… | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ResultPanel.tsx:145 | src/components/ResultPanel.tsx:145 | <title id={titleId}>结果区间与允许区间示意</title> | <title id={titleId}>结果区间与允许区间示意</title> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/ResultPanel.tsx:339 | src/components/ResultPanel.tsx:339 | <label htmlFor={targetMinId}>目标下限</label> | <label htmlFor={targetMinId}>目标下限</label> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/ResultPanel.tsx:364 | src/components/ResultPanel.tsx:364 | <label htmlFor={targetMaxId}>目标上限</label> | <label htmlFor={targetMaxId}>目标上限</label> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/ReviewSidebar.tsx:103 | src/components/ReviewSidebar.tsx:104 | aria-label={&#96;定位：${REVIEW_RULE_LABEL[finding.ruleId]}，${finding.subject.label}&#96;} | aria-label={&#96;定位：${REVIEW_RULE_LABEL[finding.ruleId]}，${uiDiagnosticText(finding.subject.label)}&#96;} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/ReviewSidebar.tsx:105 | src/components/ReviewSidebar.tsx:106 | <span className="review-sidebar__rule">{REVIEW_RULE_LABEL[finding.ruleId]}</span> | <span className="review-sidebar__rule">{REVIEW_RULE_LABEL[finding.ruleId]}</span> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/ReviewSidebar.tsx:106 | src/components/ReviewSidebar.tsx:107 | <code className="review-sidebar__rule-id">{finding.ruleId}</code> | <code className="review-sidebar__rule-id">{finding.ruleId}</code> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/ReviewSidebar.tsx:144 | src/components/ReviewSidebar.tsx:145 | <code className="review-sidebar__rule-id">{finding.ruleId}</code> | <code className="review-sidebar__rule-id">{finding.ruleId}</code> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/ScenarioCompare.tsx:193 | src/components/ScenarioCompare.tsx:193 | 新增组成环：{diff.addedTermIds.join('、')} | 新增组成环：{diff.addedTermIds.join('、')} | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/ScenarioCompare.tsx:198 | src/components/ScenarioCompare.tsx:198 | 移除组成环：{diff.removedTermIds.join('、')} | 移除组成环：{diff.removedTermIds.join('、')} | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/SessionDialogs.tsx:32 | src/components/SessionDialogs.tsx:33 | {session.preview?.projects.map(project => <div key={project.id}><h3>{project.name}</h3><p>附件 {project.attachmentCount} · 缺失 {project.missingItems}</p><button disabled={session.busy} onClick={() => void session.commit(project.id)}>导入并另存为…</button></div>)} | {session.preview?.projects.map(project => <div key={project.id}><h3>{project.name}</h3><p>附件 {project.attachmentCount} · 缺失 {project.missingItems}</p><button disabled={session.busy} onClick={() => void session.commit(project.id)}>导入并另存为…</button></div>)} | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/SourcePanel.tsx:434 | src/components/SourcePanel.tsx:435 | &#96;生成不可变版本 ${imported.value.revision.id}（SHA-256 ${imported.value.revision.sha256.slice(0, 12)}…）。&#96;, | '已生成不可变来源版本，可在文件与版本列表查看。', | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/SourcePanel.tsx:934 | src/components/SourcePanel.tsx:935 | 版本 {binding.revisionId.slice(0, 8)}… · 区域{' '} | {uiSourceVersionLabel(revisions, binding.revisionId)} · 区域{' '} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/components/SpacerDrawingPanel.tsx:172 | src/components/SpacerDrawingPanel.tsx:175 | setNotice(&#96;图纸已更新 · 指纹 ${result.value.drawingFingerprint.slice(0, 12)}…&#96;) | setNotice(&#96;图纸已更新 · 指纹 ${result.value.drawingFingerprint.slice(0, 12)}…&#96;) | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/SpacerDrawingPanel.tsx:208 | src/components/SpacerDrawingPanel.tsx:211 | &#96;已导出 ${result.value.fileName} · ${result.value.byteSize} 字节 · SHA-256 ${result.value.sha256.slice(0, 12)}…&#96;, | &#96;已导出 ${result.value.fileName} · ${result.value.byteSize} 字节 · SHA-256 ${result.value.sha256.slice(0, 12)}…&#96;, | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/components/SpacerDrawingPanel.tsx:245 | src/components/SpacerDrawingPanel.tsx:248 | 候选参数预览（未提交）：标注与图形按当前参数联动草稿重画；正式图纸仍为 Rev {record?.revisionId ?? '—'}， | 候选参数预览（未提交）：标注与图形按当前参数联动草稿重画；正式图纸仍为{record ? props.committedVersionLabel ?? '未命名版本' : '未生成'}， | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/desktop/ShellApp.tsx:71 | src/desktop/ShellApp.tsx:71 | setFlushLog(&#96;已收到 requestId=${payload.requestId}，并已回复 flushed&#96;) | setFlushLog(&#96;已收到 requestId=${payload.requestId}，并已回复 flushed&#96;) | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/document-extraction/batch.ts:155 | src/document-extraction/batch.ts:155 | invalid.push(&#96;${candidateId}（不存在）&#96;) | invalid.push(&#96;${candidateId}（不存在）&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/batch.ts:201 | src/document-extraction/batch.ts:201 | return extractionFailure('CANDIDATE_NOT_FOUND', &#96;找不到候选 ${candidateId}&#96;) | return extractionFailure('CANDIDATE_NOT_FOUND', &#96;找不到候选 ${candidateId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/batch.ts:319 | src/document-extraction/batch.ts:319 | ineligible.push(&#96;${candidateId}（不存在）&#96;) | ineligible.push(&#96;${candidateId}（不存在）&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/batch.ts:354 | src/document-extraction/batch.ts:354 | return extractionFailure('CANDIDATE_NOT_FOUND', &#96;找不到候选 ${candidateId}&#96;) | return extractionFailure('CANDIDATE_NOT_FOUND', &#96;找不到候选 ${candidateId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/batch.ts:422 | src/document-extraction/batch.ts:422 | &#96;候选 ${candidateId} 补单位失败，整批未执行：${error instanceof Error ? error.message : String(error)}&#96;, | &#96;候选 ${candidateId} 补单位失败，整批未执行：${error instanceof Error ? error.message : String(error)}&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/batch.ts:432 | src/document-extraction/batch.ts:432 | &#96;候选 ${candidateId} 补单位后出处仍不完整（字段 ${stillMissing}），整批未执行（0 条写入）&#96;, | &#96;候选 ${candidateId} 补单位后出处仍不完整（字段 ${stillMissing}），整批未执行（0 条写入）&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/batch.ts:591 | src/document-extraction/batch.ts:591 | hasBatch ? &#96;找不到仍有效的补单位批次 ${request.batchId}&#96; : &#96;候选 ${request.candidateId} 没有仍有效的补单位决定&#96;, | hasBatch ? &#96;找不到仍有效的补单位批次 ${request.batchId}&#96; : &#96;候选 ${request.candidateId} 没有仍有效的补单位决定&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/draft.ts:178 | src/document-extraction/draft.ts:178 | return extractionFailure('CANDIDATE_NOT_FOUND', &#96;找不到候选 ${request.candidateId}&#96;) | return extractionFailure('CANDIDATE_NOT_FOUND', &#96;找不到候选 ${request.candidateId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/draft.ts:223 | src/document-extraction/draft.ts:223 | &#96;同一符号 ${candidate.data.symbol ?? '?'} 已确认第 ${occurrenceLabel(conflict)} 处（候选 ${conflict.candidateId}）；同一符号只能确认一处，请先撤销该确认&#96;, | &#96;同一符号 ${candidate.data.symbol ?? '?'} 已确认第 ${occurrenceLabel(conflict)} 处（候选 ${conflict.candidateId}）；同一符号只能确认一处，请先撤销该确认&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/draft.ts:277 | src/document-extraction/draft.ts:277 | return extractionFailure('CANDIDATE_NOT_FOUND', &#96;找不到候选 ${request.candidateId}&#96;) | return extractionFailure('CANDIDATE_NOT_FOUND', &#96;找不到候选 ${request.candidateId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/draft.ts:339 | src/document-extraction/draft.ts:339 | return extractionFailure('CANDIDATE_NOT_FOUND', &#96;找不到候选 ${request.candidateId}&#96;) | return extractionFailure('CANDIDATE_NOT_FOUND', &#96;找不到候选 ${request.candidateId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/draft.ts:503 | src/document-extraction/draft.ts:503 | return extractionFailure('CANDIDATE_NOT_FOUND', &#96;找不到候选 ${request.candidateId}&#96;) | return extractionFailure('CANDIDATE_NOT_FOUND', &#96;找不到候选 ${request.candidateId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/draft.ts:664 | src/document-extraction/draft.ts:664 | message: &#96;候选 ${candidateId} 的字段 ${field} 缺少出处，不能送入项目草稿&#96;, | message: &#96;候选 ${candidateId} 的字段 ${field} 缺少出处，不能送入项目草稿&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/draft.ts:671 | src/document-extraction/draft.ts:671 | message: &#96;候选 ${candidateId} 的字段 ${field} 出处不完整（版本/页/选区/原文），不能送入项目草稿&#96;, | message: &#96;候选 ${candidateId} 的字段 ${field} 出处不完整（版本/页/选区/原文），不能送入项目草稿&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/draft.ts:680 | src/document-extraction/draft.ts:680 | message: &#96;候选 ${candidateId} 的字段 ${field} 出处已被用户显式撤销，不能再作为依据&#96;, | message: &#96;候选 ${candidateId} 的字段 ${field} 出处已被用户显式撤销，不能再作为依据&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/draft.ts:686 | src/document-extraction/draft.ts:686 | message: &#96;候选 ${candidateId} 的字段 ${field} 出处已失效（来源文件变化），需按新文件重新确认&#96;, | message: &#96;候选 ${candidateId} 的字段 ${field} 出处已失效（来源文件变化），需按新文件重新确认&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/draft.ts:698 | src/document-extraction/draft.ts:698 | message: &#96;候选 ${candidateId} 的字段 ${field} 出处不属于当前会话（跨会话断言一律拒绝）&#96;, | message: &#96;候选 ${candidateId} 的字段 ${field} 出处不属于当前会话（跨会话断言一律拒绝）&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/draft.ts:714 | src/document-extraction/draft.ts:714 | return extractionFailure('CANDIDATE_NOT_FOUND', &#96;找不到候选 ${candidateId}&#96;) | return extractionFailure('CANDIDATE_NOT_FOUND', &#96;找不到候选 ${candidateId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/draft.ts:719 | src/document-extraction/draft.ts:719 | &#96;候选 ${candidateId} 状态为 ${candidate.status}，未经逐条确认不能送入项目草稿&#96;, | &#96;候选 ${candidateId} 状态为 ${candidate.status}，未经逐条确认不能送入项目草稿&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/draft.ts:728 | src/document-extraction/draft.ts:728 | &#96;同一符号 ${candidate.data.symbol ?? '?'} 有两条已确认候选（${already}、${candidateId}）；同一符号只能确认一处&#96;, | &#96;同一符号 ${candidate.data.symbol ?? '?'} 有两条已确认候选（${already}、${candidateId}）；同一符号只能确认一处&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/draft.ts:739 | src/document-extraction/draft.ts:739 | return extractionFailure('STALE_DECISION', &#96;候选 ${candidateId} 的确认已失效，需重新确认&#96;) | return extractionFailure('STALE_DECISION', &#96;候选 ${candidateId} 的确认已失效，需重新确认&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/document-extraction/draft.ts:742 | src/document-extraction/draft.ts:742 | return extractionFailure('STALE_DECISION', &#96;候选 ${candidateId} 的数值在确认后被改动&#96;) | return extractionFailure('STALE_DECISION', &#96;候选 ${candidateId} 的数值在确认后被改动&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/dxfExport.ts:365 | src/drawing/dxfExport.ts:365 | if (layer === undefined) fail('INVALID_DRAWING', &#96;未知线型样式：${styleId}&#96;) | if (layer === undefined) fail('INVALID_DRAWING', &#96;未知线型样式：${styleId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/dxfExport.ts:371 | src/drawing/dxfExport.ts:371 | if (layer === undefined) fail('INVALID_DRAWING', &#96;未知文字样式：${styleId}&#96;) | if (layer === undefined) fail('INVALID_DRAWING', &#96;未知文字样式：${styleId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/dxfExport.ts:378 | src/drawing/dxfExport.ts:378 | if (fixed === undefined) fail('INVALID_DRAWING', &#96;未知文字样式：${styleId}&#96;) | if (fixed === undefined) fail('INVALID_DRAWING', &#96;未知文字样式：${styleId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/dxfExport.ts:403 | src/drawing/dxfExport.ts:403 | fail('INVALID_DRAWING', &#96;折线 ${primitive.primitiveId} 顶点不足&#96;) | fail('INVALID_DRAWING', &#96;折线 ${primitive.primitiveId} 顶点不足&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/dxfExport.ts:417 | src/drawing/dxfExport.ts:417 | if (radius <= 0) fail('INVALID_DRAWING', &#96;圆 ${primitive.primitiveId} 半径非正&#96;) | if (radius <= 0) fail('INVALID_DRAWING', &#96;圆 ${primitive.primitiveId} 半径非正&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/dxfExport.ts:459 | src/drawing/dxfExport.ts:459 | if (!resolved.ok) fail('INVALID_DRAWING', &#96;标注数字无法解析：${resolved.message}&#96;, annotation.annotationId) | if (!resolved.ok) fail('INVALID_DRAWING', &#96;标注数字无法解析：${resolved.message}&#96;, annotation.annotationId) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/dxfExport.ts:562 | src/drawing/dxfExport.ts:562 | if (!resolved.ok) fail('INVALID_DRAWING', &#96;标注数字无法解析：${resolved.message}&#96;, annotation.annotationId) | if (!resolved.ok) fail('INVALID_DRAWING', &#96;标注数字无法解析：${resolved.message}&#96;, annotation.annotationId) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/dxfExport.ts:564 | src/drawing/dxfExport.ts:564 | if (geometry.lines.length === 0) fail('INVALID_DRAWING', &#96;标注 ${annotation.annotationId} 没有几何&#96;, annotation.annotationId) | if (geometry.lines.length === 0) fail('INVALID_DRAWING', &#96;标注 ${annotation.annotationId} 没有几何&#96;, annotation.annotationId) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/dxfExport.ts:576 | src/drawing/dxfExport.ts:576 | if (!(radiusPaperMm > 0)) fail('INVALID_DRAWING', &#96;标注 ${annotation.annotationId} 半径非正&#96;) | if (!(radiusPaperMm > 0)) fail('INVALID_DRAWING', &#96;标注 ${annotation.annotationId} 半径非正&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/dxfExport.ts:647 | src/drawing/dxfExport.ts:647 | if (height === undefined) fail('INVALID_DRAWING', &#96;未知文字样式：${styleId}&#96;) | if (height === undefined) fail('INVALID_DRAWING', &#96;未知文字样式：${styleId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/formatDimension.ts:59 | src/drawing/formatDimension.ts:59 | return { ok: false, message: &#96;标注引用了不存在的参数：${parameterId}&#96; } | return { ok: false, message: &#96;标注引用了不存在的参数：${parameterId}&#96; } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/formatDimension.ts:62 | src/drawing/formatDimension.ts:62 | return { ok: false, message: &#96;参数快照里 parameterId 重复：${parameterId}&#96; } | return { ok: false, message: &#96;参数快照里 parameterId 重复：${parameterId}&#96; } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/layout.ts:176 | src/drawing/layout.ts:176 | conflicts.push(&#96;图元超出可用区：${primitive.primitiveId}&#96;) | conflicts.push(&#96;图元超出可用区：${primitive.primitiveId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/layout.ts:185 | src/drawing/layout.ts:185 | conflicts.push(&#96;尺寸线超出可用区：${annotation.annotationId}&#96;) | conflicts.push(&#96;尺寸线超出可用区：${annotation.annotationId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/layout.ts:190 | src/drawing/layout.ts:190 | conflicts.push(&#96;标注文字未解析：${annotation.annotationId}&#96;) | conflicts.push(&#96;标注文字未解析：${annotation.annotationId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/layout.ts:203 | src/drawing/layout.ts:203 | conflicts.push(&#96;标注文字超出可用区：${annotation.annotationId}&#96;) | conflicts.push(&#96;标注文字超出可用区：${annotation.annotationId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/layout.ts:210 | src/drawing/layout.ts:210 | conflicts.push(&#96;文字重叠：${textBoxes[i].id} / ${textBoxes[j].id}&#96;) | conflicts.push(&#96;文字重叠：${textBoxes[i].id} / ${textBoxes[j].id}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/renderDrawingSvg.ts:68 | src/drawing/renderDrawingSvg.ts:68 | throw new Error(&#96;未知线型样式：${styleId}&#96;) | throw new Error(&#96;未知线型样式：${styleId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/renderDrawingSvg.ts:90 | src/drawing/renderDrawingSvg.ts:90 | throw new Error(&#96;未知文字样式：${primitive.styleId}&#96;) | throw new Error(&#96;未知文字样式：${primitive.styleId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/renderDrawingSvg.ts:123 | src/drawing/renderDrawingSvg.ts:123 | return &#96;<g class="${className}" data-annotation-id="${escapeXml(annotation.annotationId)}" data-parameter-id="${escapeXml(annotation.parameterId)}" data-kind="${annotation.kind}" tabindex="0" role="button" aria-label="${escapeXml(&#96;${label}标注 ${text}，点击定位参数&#96;)}"><title>${escapeXml(&#96;${label} ${text}（点击定位参数）&#96;)}</title>${lines}${arrows}<text x="${number(annotation.textPositionMm.x)}" y="${number(annotation.textPositionMm.y)}" text-anchor="${annotation.textAnchor}" dominant-baseline="alphabetic" class="t-dim">${escapeXml(text)}</text></g>&#96; | return &#96;<g class="${className}" data-annotation-id="${escapeXml(annotation.annotationId)}" data-parameter-id="${escapeXml(annotation.parameterId)}" data-kind="${annotation.kind}" tabindex="0" role="button" aria-label="${escapeXml(&#96;${label}标注 ${text}，点击定位参数&#96;)}"><title>${escapeXml(&#96;${label} ${text}（点击定位参数）&#96;)}</title>${lines}${arrows}<text x="${number(annotation.textPositionMm.x)}" y="${number(annotation.textPositionMm.y)}" text-anchor="${annotation.textAnchor}" dominant-baseline="alphabetic" class="t-dim">${escapeXml(text)}</text></g>&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/renderDrawingSvg.ts:235 | src/drawing/renderDrawingSvg.ts:235 | errors.push(&#96;SVG 缺少标注文字：${annotation.annotationId}&#96;) | errors.push(&#96;SVG 缺少标注文字：${annotation.annotationId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/renderDrawingSvg.ts:238 | src/drawing/renderDrawingSvg.ts:238 | errors.push(&#96;SVG 缺少参数绑定：${annotation.annotationId}&#96;) | errors.push(&#96;SVG 缺少参数绑定：${annotation.annotationId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/spacerDrawing.ts:168 | src/drawing/spacerDrawing.ts:168 | const version = fields.version.trim() === '' ? &#96;草稿 ${revisionId}&#96; : fields.version.trim() | const version = fields.version.trim() === '' ? &#96;草稿 ${revisionId}&#96; : fields.version.trim() | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/drawing/spacerDrawing.ts:381 | src/drawing/spacerDrawing.ts:381 | throw new DrawingBuildError('INVALID_PARAMETER', &#96;图纸部件必须是隔套：${input.partId}&#96;) | throw new DrawingBuildError('INVALID_PARAMETER', &#96;图纸部件必须是隔套：${input.partId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/dxf-view/parse.ts:682 | src/dxf-view/parse.ts:682 | notes.push(&#96;视口 ${viewport.id} 带 ${viewport.twistDeg}° 旋转；按 0° 渲染。&#96;) | notes.push(&#96;视口 ${viewport.id} 带 ${viewport.twistDeg}° 旋转；按 0° 渲染。&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/history/events.ts:116 | src/history/events.ts:116 | * **不保证唯一**：调用方常把毫秒级时间戳拼进 subject（如 &#96;${bindingId}:${reviewedAt}&#96;）， | * **不保证唯一**：调用方常把毫秒级时间戳拼进 subject（如 &#96;${bindingId}:${reviewedAt}&#96;）， | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/history/snapshots.ts:597 | src/history/snapshots.ts:597 | message: &#96;已创建分析快照 ${snapshot.id}；审查状态：${ | message: &#96;已创建分析快照 ${snapshot.id}；审查状态：${ | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/pages/DesktopWorkspace.tsx:95 | src/pages/DesktopWorkspace.tsx:103 | setLocateError(resolved.issue?.message ?? &#96;条款版本 ${revisionId} 无法定位来源。&#96;) | setLocateError(uiDiagnosticText(resolved.issue?.message ?? '条款版本无法定位来源。')) | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/DesktopWorkspace.tsx:143 | src/pages/DesktopWorkspace.tsx:156 | const [selectionState, setSelectionState] = useState<{ sessionId: string \| null; value: string \| null }>({ sessionId: null, value: null }) | const [selectionState, setSelectionState] = useState<{ sessionId: string \| null; value: string \| null }>({ sessionId: null, value: null }) | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/DesktopWorkspace.tsx:145 | src/pages/DesktopWorkspace.tsx:158 | const setSelection = (value: string \| null) => setSelectionState({ sessionId, value }) | const setSelection = (value: string \| null) => setSelectionState({ sessionId, value }) | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/DesktopWorkspace.tsx:183 | src/pages/DesktopWorkspace.tsx:196 | if (sessionId === null \|\| window.cunlian === undefined) throw new Error('window.cunlian 不可用') | if (sessionId === null \|\| window.cunlian === undefined) throw new Error('window.cunlian 不可用') | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/DesktopWorkspace.tsx:249 | src/pages/DesktopWorkspace.tsx:262 | ['当前模型版本', part.currentModelRevisionId ?? '无'], | ['当前模型版本', modelVersionLabel(part.currentModelRevisionId)], | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/DesktopWorkspace.tsx:257 | src/pages/DesktopWorkspace.tsx:270 | ...(demo.active ? DEMO_PARTS.map(part => ({ id: part.id, label: part.name, properties: partPropertyRows(part.id, demo.explodeT) })) : []), | ...(demo.active ? DEMO_PARTS.map(part => ({ id: part.id, label: part.name, properties: partPropertyRows(part.id, demo.explodeT) })) : []), | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/DesktopWorkspace.tsx:265 | src/pages/DesktopWorkspace.tsx:278 | ['模板', &#96;${record.templateId} v${record.templateVersion}&#96;], | ['模板', &#96;${record.templateId} v${record.templateVersion}&#96;], | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/DesktopWorkspace.tsx:280 | src/pages/DesktopWorkspace.tsx:293 | ['绑定标注', effectiveDrawing?.annotations.filter(item => item.parameterId === parameter.parameterId).map(item => item.kind === 'diameter' ? '直径' : '长度').join('、') \|\| '无'], | ['绑定标注', effectiveDrawing?.annotations.filter(item => item.parameterId === parameter.parameterId).map(item => item.kind === 'diameter' ? '直径' : '长度').join('、') \|\| '无'], | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/DesktopWorkspace.tsx:298 | src/pages/DesktopWorkspace.tsx:311 | 尺寸链: project ? [{ id: 'chain', label: '当前尺寸链', properties: [['组成环', String(project.dimensionChain.terms.length)], ['计算预览', calculation]] }, ...project.dimensionChain.terms.map(term => ({ id: &#96;term:${term.id}&#96;, label: &#96;${term.symbol} · ${term.name}&#96;, properties: [['基本尺寸', &#96;${formatMm(term.nominalQ)} mm&#96;], ['下偏差', &#96;${formatMm(term.lowerDeviationQ)} mm&#96;], ['上偏差', &#96;${formatMm(term.upperDeviationQ)} mm&#96;], ['方向', term.sign === 1 ? '增环' : '减环'], ['来源备注', term.sourceNote \|\| '无']] as [string, string][] }))] : [], | 尺寸链: project ? [{ id: 'chain', label: '当前尺寸链', properties: [['组成环', String(project.dimensionChain.terms.length)], ['计算预览', calculation]] }, ...project.dimensionChain.terms.map(term => ({ id: &#96;term:${term.id}&#96;, label: &#96;${term.symbol} · ${term.name}&#96;, properties: [['基本尺寸', &#96;${formatMm(term.nominalQ)} mm&#96;], ['下偏差', &#96;${formatMm(term.lowerDeviationQ)} mm&#96;], ['上偏差', &#96;${formatMm(term.upperDeviationQ)} mm&#96;], ['方向', term.sign === 1 ? '增环' : '减环'], ['来源备注', term.sourceNote \|\| '无']] as [string, string][] }))] : [], | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/DesktopWorkspace.tsx:299 | src/pages/DesktopWorkspace.tsx:312 | 来源资料: snapshot?.documents.map(doc => { const rev = snapshot.revisions.find(rev => rev.id === doc.latestRevisionId); return { id: &#96;source:${doc.id}&#96;, label: doc.title, properties: [['当前版本', doc.latestRevisionId], ['文件名', rev?.fileName ?? '缺失版本'], ['页数', String(rev?.pageCount ?? '未知')], ['附件状态', snapshot.missingAttachments.some(item => item.documentId === doc.id) ? '声明缺失' : '有元数据，未读取附件']] } }) ?? [], | 来源资料: snapshot?.documents.map(doc => { const rev = snapshot.revisions.find(rev => rev.id === doc.latestRevisionId); return { id: &#96;source:${doc.id}&#96;, label: doc.title, properties: [['当前版本', uiSourceVersionLabel(snapshot.revisions, doc.latestRevisionId)], ['文件名', rev?.fileName ?? '缺失版本'], ['页数', String(rev?.pageCount ?? '未知')], ['附件状态', snapshot.missingAttachments.some(item => item.documentId === doc.id) ? '声明缺失' : '有元数据，未读取附件']] } }) ?? [],     版本历史: snapshot?.fileRevisions.map(rev => ({ id: &#96;rev:${rev.revisionId}&#96;, label: uiFileVersionLabel(snapshot.fileRevisions, rev.revisionId), properties: [['创建时间', rev.createdAt], ['原因', uiDiagnosticText(rev.reason)], ['父版本', rev.parentId ? uiFileVersionLabel(snapshot.fileRevisions, rev.parentId) : '无'], ['项目 schema', String(rev.project.schemaVersion)]] })) ?? [], | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/DesktopWorkspace.tsx:300 | src/pages/DesktopWorkspace.tsx:312 | 版本历史: snapshot?.fileRevisions.map(rev => ({ id: &#96;rev:${rev.revisionId}&#96;, label: &#96;Rev ${rev.revisionId}&#96;, properties: [['创建时间', rev.createdAt], ['原因', rev.reason], ['父版本', rev.parentId ?? '无'], ['项目 schema', String(rev.project.schemaVersion)]] })) ?? [], | 来源资料: snapshot?.documents.map(doc => { const rev = snapshot.revisions.find(rev => rev.id === doc.latestRevisionId); return { id: &#96;source:${doc.id}&#96;, label: doc.title, properties: [['当前版本', uiSourceVersionLabel(snapshot.revisions, doc.latestRevisionId)], ['文件名', rev?.fileName ?? '缺失版本'], ['页数', String(rev?.pageCount ?? '未知')], ['附件状态', snapshot.missingAttachments.some(item => item.documentId === doc.id) ? '声明缺失' : '有元数据，未读取附件']] } }) ?? [],     版本历史: snapshot?.fileRevisions.map(rev => ({ id: &#96;rev:${rev.revisionId}&#96;, label: uiFileVersionLabel(snapshot.fileRevisions, rev.revisionId), properties: [['创建时间', rev.createdAt], ['原因', uiDiagnosticText(rev.reason)], ['父版本', rev.parentId ? uiFileVersionLabel(snapshot.fileRevisions, rev.parentId) : '无'], ['项目 schema', String(rev.project.schemaVersion)]] })) ?? [], | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/DesktopWorkspace.tsx:347 | src/pages/DesktopWorkspace.tsx:360 | {session.recovery.length > 0 && <section className="desktop-workspace__recovery"><h3>有尚未保存的恢复草稿</h3>{session.recovery.map(item => <div key={item.recoveryId}><span>{item.name} · {item.savedAt}</span>{item.error ? <p role="alert">{item.error}</p> : <button disabled={session.busy} onClick={() => void session.restore(item.recoveryId)}>恢复为未保存副本</button>}</div>)}</section>} | {session.recovery.length > 0 && <section className="desktop-workspace__recovery"><h3>有尚未保存的恢复草稿</h3>{session.recovery.map(item => <div key={item.recoveryId}><span>{item.name} · {item.savedAt}</span>{item.error ? <p role="alert">{uiDiagnosticText(item.error)}</p> : <button disabled={session.busy} onClick={() => void session.restore(item.recoveryId)}>恢复为未保存副本</button>}</div>)}</section>} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/DesktopWorkspace.tsx:350 | src/pages/DesktopWorkspace.tsx:363 | <ul className="desktop-workspace__recent">{session.recent.map(item => <li key={item.recentId}><div><strong>{item.name}</strong>{item.sourceKind === 'user-intent' && <span className="desktop-workspace__source-badge" data-testid="recent-no-external-source">无外部来源</span>}<p>{item.rev ? &#96;Rev ${item.rev}&#96; : 'Rev 不可用'} · 上次打开 {item.lastOpenedAt}</p><p>{item.path}</p></div><button disabled={session.busy} onClick={() => void session.openRecent(item)}>{item.missing ? '重新定位' : '打开'}</button></li>)}</ul> | <ul className="desktop-workspace__recent">{session.recent.map(item => <li key={item.recentId}><div><strong>{item.name}</strong>{item.sourceKind === 'user-intent' && <span className="desktop-workspace__source-badge" data-testid="recent-no-external-source">无外部来源</span>}<p>未命名版本 · 上次打开 {item.lastOpenedAt}</p><p>{item.path}</p></div><button disabled={session.busy} onClick={() => void session.openRecent(item)}>{item.missing ? '重新定位' : '打开'}</button></li>)}</ul>       <p role="status">{uiDiagnosticText(session.notice \|\| (window.cunlian ? '文件操作由桌面应用处理。' : 'window.cunlian 不可用，请在桌面应用中执行文件操作。'))}</p> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/DesktopWorkspace.tsx:356 | src/pages/DesktopWorkspace.tsx:369 | <h1>寸链 · {project.name}</h1><span>Rev {project.currentRevisionId}</span><span className="desktop-workspace__pending">{saveState}</span> | <h1>寸链 · {project.name} · {versionLabel}</h1><span className="desktop-workspace__pending">{saveState}</span> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/DesktopWorkspace.tsx:376 | src/pages/DesktopWorkspace.tsx:389 | {model.partId && <button disabled={model.busy \|\| session.busy} onClick={() => void model.beginImport(true)}>替换模型…</button>} | {model.partId && <button disabled={model.busy \|\| session.busy} onClick={() => void model.beginImport(true)}>替换模型…</button>} | 故意保留：React key / DOM-data 属性 / IPC 参数 / 结构标识，不是用户可见文本 |
| src/pages/DesktopWorkspace.tsx:407 | src/pages/DesktopWorkspace.tsx:420 | 组成环 <strong>{project.dimensionChain.terms.find(term => term.id === linkDialog.termId)?.symbol ?? linkDialog.termId}</strong> | 组成环 <strong>{project.dimensionChain.terms.find(term => term.id === linkDialog.termId)?.symbol ?? '未命名组成环'}</strong> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/DesktopWorkspace.tsx:408 | src/pages/DesktopWorkspace.tsx:421 | {' '}↔ {linkDialog.granularity === 'model' ? '整体模型' : '已登记部件'}「{selectedModelPart?.name ?? modelParts.find(part => part.partId === model.partId)?.name ?? '—'}」 | {' '}↔ {linkDialog.granularity === 'model' ? '整体模型' : '已登记部件'}「{selectedModelPart?.name ?? modelParts.find(part => part.partId === model.partId)?.name ?? '—'}」 | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/DesktopWorkspace.tsx:409 | src/pages/DesktopWorkspace.tsx:422 | {linkDialog.granularity === 'model' && model.revisionId ? &#96;（版本 ${model.revisionId}）&#96; : ''}。 | {linkDialog.granularity === 'model' && model.revisionId ? &#96;（${modelVersionLabel(model.revisionId)}）&#96; : ''}。 | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/DesktopWorkspace.tsx:411 | src/pages/DesktopWorkspace.tsx:424 | {linkTargetName(linkDialog.link)}：旧版 {linkDialog.link.target.modelRevisionId ?? '无版本'} → 当前新版 {model.revisionId ?? '—'}。 | {linkTargetName(linkDialog.link)}：旧版 {modelVersionLabel(linkDialog.link.target.modelRevisionId)} → 当前新版 {modelVersionLabel(model.revisionId)}。 | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/DesktopWorkspace.tsx:443 | src/pages/DesktopWorkspace.tsx:456 | {entries[group].length ? entries[group].map(item => <button key={item.id} aria-pressed={selected?.id === item.id} onClick={() => { setSelection(item.id); if (group === '尺寸链') setTab(3); if (group === '版本历史') setTab(4) }}>{item.label}</button>) : <p>{group === '零件' ? '尚未打开轴系示例 · B1' : group === '工程图' ? '暂无工程图' : &#96;暂无${group}&#96;}</p>} | {entries[group].length ? entries[group].map(item => <button key={item.id} aria-pressed={selected?.id === item.id} onClick={() => { setSelection(item.id); if (group === '尺寸链') setTab(3); if (group === '版本历史') setTab(4) }}>{item.label}</button>) : <p>{group === '零件' ? '尚未打开轴系示例 · B1' : group === '工程图' ? '暂无工程图' : &#96;暂无${group}&#96;}</p>} | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/DesktopWorkspace.tsx:487 | src/pages/DesktopWorkspace.tsx:502 | onSelectParameter={parameterId => setSelection(parameterId === null ? null : &#96;param:${parameterId}&#96;)} | onSelectParameter={parameterId => setSelection(parameterId === null ? null : &#96;param:${parameterId}&#96;)} | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/DesktopWorkspace.tsx:488 | src/pages/DesktopWorkspace.tsx:503 | onSelectAnnotation={annotationId => setSelection(&#96;annotation:${annotationId}&#96;)} | onSelectAnnotation={annotationId => setSelection(&#96;annotation:${annotationId}&#96;)} | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/DesktopWorkspace.tsx:542 | src/pages/DesktopWorkspace.tsx:557 | <dl><dt>项目版本</dt><dd>{project.currentRevisionId}</dd>{selected?.properties.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl> | <dl><dt>项目版本</dt><dd>{versionLabel}</dd>{selected?.properties.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{uiDiagnosticText(value)}</dd></div>)}</dl> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/DesktopWorkspace.tsx:551 | src/pages/DesktopWorkspace.tsx:566 | <button type="button" disabled={model.busy \|\| !model.revisionId} onClick={() => void model.beginImport(true)}>替换当前模型…</button> | <button type="button" disabled={model.busy \|\| !model.revisionId} onClick={() => void model.beginImport(true)}>替换当前模型…</button> | 故意保留：React key / DOM-data 属性 / IPC 参数 / 结构标识，不是用户可见文本 |
| src/pages/DesktopWorkspace.tsx:554 | src/pages/DesktopWorkspace.tsx:569 | {selectedTermId && project && <section className="desktop-workspace__part-note" aria-label="外形资料来源关联"> | {selectedTermId && project && <section className="desktop-workspace__part-note" aria-label="外形资料来源关联"> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/DesktopWorkspace.tsx:564 | src/pages/DesktopWorkspace.tsx:579 | {link.target.modelRevisionId ? &#96; · 版本 ${link.target.modelRevisionId}&#96; : ''} | {link.target.modelRevisionId ? &#96; · ${modelVersionLabel(link.target.modelRevisionId)}&#96; : ''} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/DesktopWorkspace.tsx:568 | src/pages/DesktopWorkspace.tsx:583 | {stale && link.reviewStatus === 'pending' && current && <p>旧版 {link.target.modelRevisionId ?? '无'} → 当前新版 {current}</p>} | {stale && link.reviewStatus === 'pending' && current && <p>旧版 {modelVersionLabel(link.target.modelRevisionId)} → 当前新版 {modelVersionLabel(current)}</p>} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/DesktopWorkspace.tsx:573 | src/pages/DesktopWorkspace.tsx:588 | <button type="button" disabled={model.busy} onClick={() => setLinkDialog({ kind: 'bind', termId: selectedTermId, granularity: 'model' })}>关联整体模型…</button> | <button type="button" disabled={model.busy} onClick={() => setLinkDialog({ kind: 'bind', termId: selectedTermId, granularity: 'model' })}>关联整体模型…</button> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/DesktopWorkspace.tsx:574 | src/pages/DesktopWorkspace.tsx:589 | <button type="button" disabled={model.busy} onClick={() => setLinkDialog({ kind: 'bind', termId: selectedTermId, granularity: 'part' })}>关联部件（记录版本）…</button> | <button type="button" disabled={model.busy} onClick={() => setLinkDialog({ kind: 'bind', termId: selectedTermId, granularity: 'part' })}>关联部件（记录版本）…</button> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/DesktopWorkspace.tsx:576 | src/pages/DesktopWorkspace.tsx:591 | {!model.partId && <p>先导入或打开含模型的部件后才能建立关联。</p>} | {!model.partId && <p>先导入或打开含模型的部件后才能建立关联。</p>} | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/DesktopWorkspace.tsx:591 | src/pages/DesktopWorkspace.tsx:606 | {bound.map(annotation => <button key={annotation.annotationId} type="button" onClick={() => setSelection(&#96;annotation:${annotation.annotationId}&#96;)}> | {bound.map(annotation => <button key={annotation.annotationId} type="button" onClick={() => setSelection(&#96;annotation:${annotation.annotationId}&#96;)}> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/DesktopWorkspace.tsx:592 | src/pages/DesktopWorkspace.tsx:607 | 定位标注 · {annotation.kind === 'diameter' ? '直径' : '长度'} · {annotation.annotationId} | 定位标注 · {annotation.kind === 'diameter' ? '直径' : '长度'} | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/DesktopWorkspace.tsx:604 | src/pages/DesktopWorkspace.tsx:619 | <section><h3>变更</h3>{session.change.preview ? <><p>预览 {session.change.preview.drawing.record.revisionId}：受影响环 {session.change.preview.affectedTermIds.length} 个；旧结果 {formatMm(session.change.preview.previousResult.minQ)} ～ {formatMm(session.change.preview.previousResult.maxQ)} mm → 新结果 {formatMm(session.change.preview.result.minQ)} ～ {formatMm(session.change.preview.result.maxQ)} mm。</p><p>受影响环不是错误；确认前可在“工程图”页查看逐环 diff。</p></> : <p>尚无变更预览。</p>}{session.change.staleReason && <p role="alert">预览已过期：{session.change.staleReason}</p>}</section> | <section><h3>变更</h3>{session.change.preview ? <><p>预览（草稿 · {uiVersionLabel(snapshot.fileRevisions.length + 1)}）：受影响环 {session.change.preview.affectedTermIds.length} 个；旧结果 {formatMm(session.change.preview.previousResult.minQ)} ～ {formatMm(session.change.preview.previousResult.maxQ)} mm → 新结果 {formatMm(session.change.preview.result.minQ)} ～ {formatMm(session.change.preview.result.maxQ)} mm。</p><p>受影响环不是错误；确认前可在“工程图”页查看逐环 diff。</p></> : <p>尚无变更预览。</p>}{session.change.staleReason && <p role="alert">预览已过期：{uiDiagnosticText(session.change.staleReason)}</p>}</section>         <section><h3>校核</h3><p>{uiDiagnosticText(resolveDraft(snapshot).message ?? '')}</p><p>{calculation}</p>{result && <p>极限范围 {formatMm(result.minQ)} 至 {formatMm(result.maxQ)} mm</p>}{parsed && !parsed.ok && Object.entries(parsed.cellErrors).map(([field, message]) => <p key={field}>{field}：{message}</p>)}</section> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/DesktopWorkspace.tsx:609 | src/pages/DesktopWorkspace.tsx:624 | <p>活动条款 {activeRequirement.requirementId} · 版本 {activeRequirement.revisionId} · {formatMm(activeRequirement.lowerQ)} ～ {formatMm(activeRequirement.upperQ)} mm（闭区间）</p> | <p>活动条款 · {uiVersionLabel(project.requirementRevisions.findIndex(item => item.revisionId === activeRequirement.revisionId) + 1)} · {formatMm(activeRequirement.lowerQ)} ～ {formatMm(activeRequirement.upperQ)} mm（闭区间）</p> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/DesktopWorkspace.tsx:611 | src/pages/DesktopWorkspace.tsx:626 | <p>来源 {activeRequirement.source.revisionId} 第 {activeRequirement.source.page} 页 · SHA-256 {activeRequirement.source.sha256.slice(0, 12)}…</p> | <p>来源 {uiSourceVersionLabel(snapshot.revisions, activeRequirement.source.revisionId)} 第 {activeRequirement.source.page} 页 · SHA-256 {activeRequirement.source.sha256.slice(0, 12)}…</p> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/PrintReport.tsx:157 | src/pages/PrintReport.tsx:157 | <span className="print-report__rule-id">{finding.ruleId}</span> | <span className="print-report__rule-id">{finding.ruleId}</span> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/PrintReport.tsx:203 | src/pages/PrintReport.tsx:200 | const pageRule = &#96;@page { @bottom-center { content: "第 " counter(page) " 页 / 共 " counter(pages) " 页 · 快照 ${shortId}"; font-size: 8pt; color: #555; } }&#96; | // 页脚只显示报告类型与页码；内部快照标识保留在项目文件。   const pageRule = '@page { @bottom-center { content: "第 " counter(page) " 页 / 共 " counter(pages) " 页 · 分析快照"; font-size: 8pt; color: #555; } }' | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/PrintReport.tsx:225 | src/pages/PrintReport.tsx:222 | <dd className="print-report__mono">{snapshot.projectId}</dd> | <dt>项目</dt>             <dd>{snapshot.projectName}</dd> | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/PrintReport.tsx:277 | src/pages/PrintReport.tsx:275 | <h2 id={methodId}>分析方法与适用范围</h2> | <h2 id={methodId}>分析方法与适用范围</h2> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/PrintReport.tsx:305 | src/pages/PrintReport.tsx:303 | <h2 id={inputId}>完整输入（快照冻结）</h2> | <h2 id={inputId}>完整输入（快照冻结）</h2> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/PrintReport.tsx:350 | src/pages/PrintReport.tsx:348 | <h2 id={expressionId}>尺寸链表达式与计算公式</h2> | <h2 id={expressionId}>尺寸链表达式与计算公式</h2> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/PrintReport.tsx:370 | src/pages/PrintReport.tsx:368 | <h2 id={resultId}>计算结果与判定</h2> | <h2 id={resultId}>计算结果与判定</h2> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/PrintReport.tsx:423 | src/pages/PrintReport.tsx:421 | <h2 id={sourceId}>来源清单（快照冻结）</h2> | <h2 id={sourceId}>来源清单（快照冻结）</h2> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/PrintReport.tsx:513 | src/pages/PrintReport.tsx:511 | <h2 id={reviewId}>审查结果与未完成项（快照冻结）</h2> | <h2 id={reviewId}>审查结果与未完成项（快照冻结）</h2> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/PrintReport.tsx:534 | src/pages/PrintReport.tsx:532 | <h2 id={baselineId}>基线对比（快照冻结）</h2> | <h2 id={baselineId}>基线对比（快照冻结）</h2> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/PrintReport.tsx:555 | src/pages/PrintReport.tsx:553 | <h2 id={notesId}>假设与待确认事项</h2> | <h2 id={notesId}>假设与待确认事项</h2> | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/PrintReport.tsx:588 | src/pages/PrintReport.tsx:585 | <span className="print-report__mono">{snapshot.id}</span>） | 轴系轴向公差链分析与修改追踪工具 · 报告由不可变分析快照生成（创建时间：         <span>{formatTime(snapshot.createdAt)}</span>） | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/PrintReport.tsx:629 | src/pages/PrintReport.tsx:627 | message: &#96;分析快照不存在：${snapshotId}&#96;, | message: '分析快照不存在，请返回快照列表重新选择。', | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/ProjectList.tsx:476 | src/pages/ProjectList.tsx:477 | .map((item) => &#96;「${item.name}」（新 ID ${item.newProjectId.slice(0, 8)}…）&#96;) | .map((item) => &#96;「${item.name}」（新 ID ${item.newProjectId.slice(0, 8)}…）&#96;) | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/SnapshotList.tsx:73 | src/pages/SnapshotList.tsx:74 | message: &#96;项目不存在：${projectId}&#96;, | message: '项目不存在，请返回项目列表重新选择。', | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/pages/Workspace.tsx:305 | src/pages/Workspace.tsx:306 | &#96;已创建分析快照 ${created.value.id.slice(0, 8)}…；审查状态：${ | &#96;已创建分析快照 ${created.value.id.slice(0, 8)}…；审查状态：${ | 保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写 |
| src/pages/Workspace.tsx:801 | src/pages/Workspace.tsx:801 | <span className="workspace__mono">{projectId}</span> | 发生了什么：找不到所选项目。                 它可能已被删除，或链接中的项目位置 | 已改展示；新块仍保留完整调用/关联参数，不改业务数据 |
| src/parts/shaftDemoGeometry.ts:280 | src/parts/shaftDemoGeometry.ts:280 | if (!DEMO_PARTS.some((item) => item.id === id)) throw new RangeError(&#96;未知部件 ${id}&#96;) | if (!DEMO_PARTS.some((item) => item.id === id)) throw new RangeError(&#96;未知部件 ${id}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/parts/spacerParameters.ts:205 | src/parts/spacerParameters.ts:205 | return { ok: false, message: &#96;参数不属于隔套部件：${String(item.partId)}&#96; } | return { ok: false, message: &#96;参数不属于隔套部件：${String(item.partId)}&#96; } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/migrateV2.ts:183 | src/project-file/migrateV2.ts:183 | ...result.contributions.map((item) => &#96;${item.termId}:${item.toleranceQ}&#96;), | ...result.contributions.map((item) => &#96;${item.termId}:${item.toleranceQ}&#96;), | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/migrateV2.ts:524 | src/project-file/migrateV2.ts:524 | &#96;版本 ${revision.id} 既没有附件字节也没有缺失声明&#96;, | &#96;版本 ${revision.id} 既没有附件字节也没有缺失声明&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/migrateV2.ts:541 | src/project-file/migrateV2.ts:541 | return fail('INVALID_RECORD', &#96;分析快照 ID 重复：${snapshot.id}&#96;) | return fail('INVALID_RECORD', &#96;分析快照 ID 重复：${snapshot.id}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/migrateV2.ts:550 | src/project-file/migrateV2.ts:550 | &#96;历史快照 ${snapshot.id} 引用的来源版本不在所选项目闭包内&#96;, | &#96;历史快照 ${snapshot.id} 引用的来源版本不在所选项目闭包内&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/migrateV2.ts:714 | src/project-file/migrateV2.ts:714 | ((revisionId: string) => newId(&#96;legacy-json-${revisionId.slice(0, 12)}&#96;)) | ((revisionId: string) => newId(&#96;legacy-json-${revisionId.slice(0, 12)}&#96;)) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2020 | src/project-file/validation.ts:2020 | return fail('MISSING_REFERENCE', &#96;提取草稿 ${draft.draftId} 不属于当前项目&#96;) | return fail('MISSING_REFERENCE', &#96;提取草稿 ${draft.draftId} 不属于当前项目&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2023 | src/project-file/validation.ts:2023 | return fail('INVALID_RECORD', &#96;提取草稿 ID 重复：${draft.draftId}&#96;) | return fail('INVALID_RECORD', &#96;提取草稿 ID 重复：${draft.draftId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2038 | src/project-file/validation.ts:2038 | &#96;提取草稿 ${draft.draftId} 引用的 PDF 版本不存在&#96;, | &#96;提取草稿 ${draft.draftId} 引用的 PDF 版本不存在&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2043 | src/project-file/validation.ts:2043 | return fail('MISSING_REFERENCE', &#96;提取草稿 ${draft.draftId} 的文档与版本不一致&#96;) | return fail('MISSING_REFERENCE', &#96;提取草稿 ${draft.draftId} 的文档与版本不一致&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2046 | src/project-file/validation.ts:2046 | return fail('HASH_MISMATCH', &#96;提取草稿 ${draft.draftId} 的版本哈希/blobKey 与来源不一致&#96;) | return fail('HASH_MISMATCH', &#96;提取草稿 ${draft.draftId} 的版本哈希/blobKey 与来源不一致&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2049 | src/project-file/validation.ts:2049 | return fail('INVALID_RECORD', &#96;提取草稿 ${draft.draftId} 的页数与来源版本不一致&#96;) | return fail('INVALID_RECORD', &#96;提取草稿 ${draft.draftId} 的页数与来源版本不一致&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2054 | src/project-file/validation.ts:2054 | &#96;提取草稿 ${draft.draftId} 的页范围越界&#96;, | &#96;提取草稿 ${draft.draftId} 的页范围越界&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2064 | src/project-file/validation.ts:2064 | return fail('INVALID_RECORD', &#96;提取候选 ID 重复：${candidate.candidateId}&#96;) | return fail('INVALID_RECORD', &#96;提取候选 ID 重复：${candidate.candidateId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2071 | src/project-file/validation.ts:2071 | &#96;提取候选 ${candidate.candidateId} 的页码不在提取页范围内&#96;, | &#96;提取候选 ${candidate.candidateId} 的页码不在提取页范围内&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2078 | src/project-file/validation.ts:2078 | &#96;提取候选 ${candidate.candidateId} 的出处与草稿来源不一致&#96;, | &#96;提取候选 ${candidate.candidateId} 的出处与草稿来源不一致&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2088 | src/project-file/validation.ts:2088 | &#96;提取候选 ${candidate.candidateId} 的 ${field} 缺少出处&#96;, | &#96;提取候选 ${candidate.candidateId} 的 ${field} 缺少出处&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2095 | src/project-file/validation.ts:2095 | &#96;提取候选 ${candidate.candidateId} 的 ${field} 出处不完整&#96;, | &#96;提取候选 ${candidate.candidateId} 的 ${field} 出处不完整&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2101 | src/project-file/validation.ts:2101 | &#96;提取候选 ${candidate.candidateId} 的 ${field} 出处指向其它版本&#96;, | &#96;提取候选 ${candidate.candidateId} 的 ${field} 出处指向其它版本&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2111 | src/project-file/validation.ts:2111 | return fail('INVALID_RECORD', &#96;提取决定 ID 重复：${decision.decisionId}&#96;) | return fail('INVALID_RECORD', &#96;提取决定 ID 重复：${decision.decisionId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2118 | src/project-file/validation.ts:2118 | &#96;提取决定 ${decision.decisionId} 引用了不存在的候选&#96;, | &#96;提取决定 ${decision.decisionId} 引用了不存在的候选&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2125 | src/project-file/validation.ts:2125 | &#96;提取决定 ${decision.decisionId} 的代数为未来代数&#96;, | &#96;提取决定 ${decision.decisionId} 的代数为未来代数&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2145 | src/project-file/validation.ts:2145 | &#96;候选 ${candidate.candidateId} 标记为已确认，但没有当前代数的确认决定&#96;, | &#96;候选 ${candidate.candidateId} 标记为已确认，但没有当前代数的确认决定&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2151 | src/project-file/validation.ts:2151 | &#96;候选 ${candidate.candidateId} 的数值与确认时的快照不一致&#96;, | &#96;候选 ${candidate.candidateId} 的数值与确认时的快照不一致&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2158 | src/project-file/validation.ts:2158 | &#96;候选 ${candidate.candidateId} 标记为已拒绝，但没有当前代数的拒绝决定&#96;, | &#96;候选 ${candidate.candidateId} 标记为已拒绝，但没有当前代数的拒绝决定&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2164 | src/project-file/validation.ts:2164 | &#96;候选 ${candidate.candidateId} 存在确认决定，但状态不是已确认&#96;, | &#96;候选 ${candidate.candidateId} 存在确认决定，但状态不是已确认&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2194 | src/project-file/validation.ts:2194 | &#96;projectId=${record.projectId}，当前项目=${projectId}&#96;, | &#96;projectId=${record.projectId}，当前项目=${projectId}&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2220 | src/project-file/validation.ts:2220 | return fail('INVALID_RECORD', &#96;partId 重复：${partDuplicate}&#96;) | return fail('INVALID_RECORD', &#96;partId 重复：${partDuplicate}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2224 | src/project-file/validation.ts:2224 | return fail('INVALID_RECORD', &#96;modelRevisionId 重复：${modelDuplicate}&#96;) | return fail('INVALID_RECORD', &#96;modelRevisionId 重复：${modelDuplicate}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2255 | src/project-file/validation.ts:2255 | &#96;文档 ${document.id} 的 latestRevisionId 无对应版本&#96;, | &#96;文档 ${document.id} 的 latestRevisionId 无对应版本&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2262 | src/project-file/validation.ts:2262 | &#96;文档 ${document.id} 的最新版本属于其它文档&#96;, | &#96;文档 ${document.id} 的最新版本属于其它文档&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2271 | src/project-file/validation.ts:2271 | return fail('MISSING_REFERENCE', &#96;版本 ${revision.id} 引用了不存在的文档&#96;, revision.documentId) | return fail('MISSING_REFERENCE', &#96;版本 ${revision.id} 引用了不存在的文档&#96;, revision.documentId) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2279 | src/project-file/validation.ts:2279 | return fail('MISSING_REFERENCE', &#96;版本 ${revision.id} 缺少 blob 元数据&#96;, revision.blobKey) | return fail('MISSING_REFERENCE', &#96;版本 ${revision.id} 缺少 blob 元数据&#96;, revision.blobKey) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2282 | src/project-file/validation.ts:2282 | return fail('INVALID_RECORD', &#96;版本 ${revision.id} 既声明缺失又存在 blob 元数据&#96;) | return fail('INVALID_RECORD', &#96;版本 ${revision.id} 既声明缺失又存在 blob 元数据&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2287 | src/project-file/validation.ts:2287 | &#96;版本 ${revision.id} 与 blob 元数据的大小/哈希不一致&#96;, | &#96;版本 ${revision.id} 与 blob 元数据的大小/哈希不一致&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2307 | src/project-file/validation.ts:2307 | &#96;部件 ${part.partId} 的当前模型版本不存在&#96;, | &#96;部件 ${part.partId} 的当前模型版本不存在&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2314 | src/project-file/validation.ts:2314 | &#96;部件 ${part.partId} 的当前模型版本属于其它部件&#96;, | &#96;部件 ${part.partId} 的当前模型版本属于其它部件&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2321 | src/project-file/validation.ts:2321 | return fail('MISSING_REFERENCE', &#96;模型版本 ${model.modelRevisionId} 引用了不存在的部件&#96;, model.partId) | return fail('MISSING_REFERENCE', &#96;模型版本 ${model.modelRevisionId} 引用了不存在的部件&#96;, model.partId) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2328 | src/project-file/validation.ts:2328 | &#96;模型版本 ${model.modelRevisionId} 的父版本不存在&#96;, | &#96;模型版本 ${model.modelRevisionId} 的父版本不存在&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2335 | src/project-file/validation.ts:2335 | &#96;模型版本 ${model.modelRevisionId} 的父版本属于其它部件&#96;, | &#96;模型版本 ${model.modelRevisionId} 的父版本属于其它部件&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2342 | src/project-file/validation.ts:2342 | return fail('MISSING_REFERENCE', &#96;模型版本 ${model.modelRevisionId} 缺少 blob 元数据&#96;, model.blobKey) | return fail('MISSING_REFERENCE', &#96;模型版本 ${model.modelRevisionId} 缺少 blob 元数据&#96;, model.blobKey) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2347 | src/project-file/validation.ts:2347 | &#96;模型版本 ${model.modelRevisionId} 与 blob 元数据的大小/哈希不一致&#96;, | &#96;模型版本 ${model.modelRevisionId} 与 blob 元数据的大小/哈希不一致&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2353 | src/project-file/validation.ts:2353 | &#96;模型版本 ${model.modelRevisionId} 的字节缺失（模型版本不允许缺附件声明）&#96;, | &#96;模型版本 ${model.modelRevisionId} 的字节缺失（模型版本不允许缺附件声明）&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2364 | src/project-file/validation.ts:2364 | return fail('INVALID_RECORD', &#96;模型版本父链存在环：${model.modelRevisionId}&#96;) | return fail('INVALID_RECORD', &#96;模型版本父链存在环：${model.modelRevisionId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2390 | src/project-file/validation.ts:2390 | return fail('MISSING_REFERENCE', &#96;关联 ${linkKindId(link)} 引用了不存在的组成环&#96;, link.termId) | return fail('MISSING_REFERENCE', &#96;关联 ${linkKindId(link)} 引用了不存在的组成环&#96;, link.termId) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2394 | src/project-file/validation.ts:2394 | return fail('MISSING_REFERENCE', &#96;关联 ${link.linkId} 引用了不存在的部件&#96;, link.target.partId) | return fail('MISSING_REFERENCE', &#96;关联 ${link.linkId} 引用了不存在的部件&#96;, link.target.partId) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2397 | src/project-file/validation.ts:2397 | return fail('INVALID_RECORD', &#96;关联 ${link.linkId} 使用模型粒度但没有具体版本&#96;) | return fail('INVALID_RECORD', &#96;关联 ${link.linkId} 使用模型粒度但没有具体版本&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2406 | src/project-file/validation.ts:2406 | return fail('MISSING_REFERENCE', &#96;关联 ${link.linkId} 的${label}不存在&#96;, revisionId) | return fail('MISSING_REFERENCE', &#96;关联 ${link.linkId} 的${label}不存在&#96;, revisionId) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2411 | src/project-file/validation.ts:2411 | &#96;关联 ${link.linkId} 的${label}属于其它部件&#96;, | &#96;关联 ${link.linkId} 的${label}属于其它部件&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2422 | src/project-file/validation.ts:2422 | &#96;组成环 ${link.termId} 存在第二个参数绑定&#96;, | &#96;组成环 ${link.termId} 存在第二个参数绑定&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2428 | src/project-file/validation.ts:2428 | return fail('MISSING_REFERENCE', &#96;参数绑定 ${link.bindingId} 引用了不存在的部件&#96;, link.partId) | return fail('MISSING_REFERENCE', &#96;参数绑定 ${link.bindingId} 引用了不存在的部件&#96;, link.partId) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2436 | src/project-file/validation.ts:2436 | &#96;参数绑定 ${link.bindingId} 引用了不存在的参数&#96;, | &#96;参数绑定 ${link.bindingId} 引用了不存在的参数&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2443 | src/project-file/validation.ts:2443 | &#96;参数绑定 ${link.bindingId} 的部件与参数不一致&#96;, | &#96;参数绑定 ${link.bindingId} 的部件与参数不一致&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2448 | src/project-file/validation.ts:2448 | return fail('MISSING_REFERENCE', &#96;参数绑定 ${link.bindingId} 指向不支持的部件&#96;) | return fail('MISSING_REFERENCE', &#96;参数绑定 ${link.bindingId} 指向不支持的部件&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2458 | src/project-file/validation.ts:2458 | return fail('INVALID_RECORD', &#96;条款版本 ID 重复：${requirement.revisionId}&#96;) | return fail('INVALID_RECORD', &#96;条款版本 ID 重复：${requirement.revisionId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2467 | src/project-file/validation.ts:2467 | &#96;条款 ${requirement.revisionId} 不属于当前项目&#96;, | &#96;条款 ${requirement.revisionId} 不属于当前项目&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2475 | src/project-file/validation.ts:2475 | return fail('MISSING_REFERENCE', &#96;条款 ${requirement.revisionId} 的链引用不合法&#96;) | return fail('MISSING_REFERENCE', &#96;条款 ${requirement.revisionId} 的链引用不合法&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2478 | src/project-file/validation.ts:2478 | return fail('INVALID_RECORD', &#96;条款 ${requirement.revisionId} 的上下限必须是整数 q&#96;) | return fail('INVALID_RECORD', &#96;条款 ${requirement.revisionId} 的上下限必须是整数 q&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2481 | src/project-file/validation.ts:2481 | return fail('INVALID_RECORD', &#96;条款 ${requirement.revisionId} 的下限大于上限&#96;) | return fail('INVALID_RECORD', &#96;条款 ${requirement.revisionId} 的下限大于上限&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2490 | src/project-file/validation.ts:2490 | &#96;条款 ${requirement.revisionId} 的父版本不存在&#96;, | &#96;条款 ${requirement.revisionId} 的父版本不存在&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2497 | src/project-file/validation.ts:2497 | &#96;条款 ${requirement.revisionId} 的父版本属于其它条款&#96;, | &#96;条款 ${requirement.revisionId} 的父版本属于其它条款&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2506 | src/project-file/validation.ts:2506 | &#96;条款 ${requirement.revisionId} 的用户断言出处不完整&#96;, | &#96;条款 ${requirement.revisionId} 的用户断言出处不完整&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2515 | src/project-file/validation.ts:2515 | &#96;条款 ${requirement.revisionId} 引用的任务书版本不存在&#96;, | &#96;条款 ${requirement.revisionId} 引用的任务书版本不存在&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2521 | src/project-file/validation.ts:2521 | &#96;条款 ${requirement.revisionId} 的文档与版本不一致&#96;, | &#96;条款 ${requirement.revisionId} 的文档与版本不一致&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2527 | src/project-file/validation.ts:2527 | &#96;条款 ${requirement.revisionId} 的 PDF 哈希与来源版本不一致&#96;, | &#96;条款 ${requirement.revisionId} 的 PDF 哈希与来源版本不一致&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2533 | src/project-file/validation.ts:2533 | &#96;条款 ${requirement.revisionId} 的页码越界&#96;, | &#96;条款 ${requirement.revisionId} 的页码越界&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2544 | src/project-file/validation.ts:2544 | &#96;条款 ${requirement.revisionId} 的选区不合法&#96;, | &#96;条款 ${requirement.revisionId} 的选区不合法&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2617 | src/project-file/validation.ts:2617 | return fail('INVALID_RECORD', &#96;隔套参数 ID 重复：${parameter.parameterId}&#96;) | return fail('INVALID_RECORD', &#96;隔套参数 ID 重复：${parameter.parameterId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2627 | src/project-file/validation.ts:2627 | &#96;隔套参数修订号必须是 ≥1 的整数：${parameter.parameterId}&#96;, | &#96;隔套参数修订号必须是 ≥1 的整数：${parameter.parameterId}&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2631 | src/project-file/validation.ts:2631 | return fail('MISSING_REFERENCE', &#96;隔套参数引用了不支持的部件：${parameter.partId}&#96;) | return fail('MISSING_REFERENCE', &#96;隔套参数引用了不支持的部件：${parameter.partId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2644 | src/project-file/validation.ts:2644 | return fail('INVALID_RECORD', &#96;图纸 ID 重复：${drawing.drawingId}&#96;) | return fail('INVALID_RECORD', &#96;图纸 ID 重复：${drawing.drawingId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2648 | src/project-file/validation.ts:2648 | return fail('MISSING_REFERENCE', &#96;图纸引用了不支持的部件：${drawing.partId}&#96;) | return fail('MISSING_REFERENCE', &#96;图纸引用了不支持的部件：${drawing.partId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2651 | src/project-file/validation.ts:2651 | return fail('MISSING_REFERENCE', &#96;图纸 ${drawing.drawingId} 的生成基准版本不存在&#96;, drawing.revisionId) | return fail('MISSING_REFERENCE', &#96;图纸 ${drawing.drawingId} 的生成基准版本不存在&#96;, drawing.revisionId) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2654 | src/project-file/validation.ts:2654 | return fail('MISSING_REFERENCE', &#96;图纸 ${drawing.drawingId} 缺少隔套参数&#96;) | return fail('MISSING_REFERENCE', &#96;图纸 ${drawing.drawingId} 缺少隔套参数&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2658 | src/project-file/validation.ts:2658 | return fail('INVALID_RECORD', &#96;图纸 ${drawing.drawingId} 的参数引用重复&#96;) | return fail('INVALID_RECORD', &#96;图纸 ${drawing.drawingId} 的参数引用重复&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2664 | src/project-file/validation.ts:2664 | &#96;图纸 ${drawing.drawingId} 缺少参数引用&#96;, | &#96;图纸 ${drawing.drawingId} 缺少参数引用&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2670 | src/project-file/validation.ts:2670 | return fail('MISSING_REFERENCE', &#96;图纸 ${drawing.drawingId} 引用了多余的参数&#96;) | return fail('MISSING_REFERENCE', &#96;图纸 ${drawing.drawingId} 引用了多余的参数&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2687 | src/project-file/validation.ts:2687 | &#96;图纸 ${drawing.drawingId} 无法按保存的参数重建：${error.message}&#96;, | &#96;图纸 ${drawing.drawingId} 无法按保存的参数重建：${error.message}&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2696 | src/project-file/validation.ts:2696 | &#96;图纸 ${drawing.drawingId} 的重建指纹与保存的 dataFingerprint 不一致&#96;, | &#96;图纸 ${drawing.drawingId} 的重建指纹与保存的 dataFingerprint 不一致&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2722 | src/project-file/validation.ts:2722 | &#96;版本 ${revision.id} 既没有附件字节也没有缺附件声明&#96;, | &#96;版本 ${revision.id} 既没有附件字节也没有缺附件声明&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2737 | src/project-file/validation.ts:2737 | return fail('MISSING_REFERENCE', &#96;绑定 ${binding.id} 引用了不存在的版本&#96;, binding.revisionId) | return fail('MISSING_REFERENCE', &#96;绑定 ${binding.id} 引用了不存在的版本&#96;, binding.revisionId) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2740 | src/project-file/validation.ts:2740 | return fail('MISSING_REFERENCE', &#96;绑定 ${binding.id} 的文档与版本不一致&#96;) | return fail('MISSING_REFERENCE', &#96;绑定 ${binding.id} 的文档与版本不一致&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2745 | src/project-file/validation.ts:2745 | &#96;绑定 ${binding.id} 的页码越界&#96;, | &#96;绑定 ${binding.id} 的页码越界&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2752 | src/project-file/validation.ts:2752 | &#96;绑定 ${binding.id} 引用了当前方案中不存在的组成环&#96;, | &#96;绑定 ${binding.id} 引用了当前方案中不存在的组成环&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2758 | src/project-file/validation.ts:2758 | return fail('INVALID_RECORD', &#96;绑定 ${binding.id} 的区域不合法&#96;, regionError) | return fail('INVALID_RECORD', &#96;绑定 ${binding.id} 的区域不合法&#96;, regionError) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2764 | src/project-file/validation.ts:2764 | &#96;绑定 ${binding.id} 的历史接受凭据引用了不存在的版本&#96;, | &#96;绑定 ${binding.id} 的历史接受凭据引用了不存在的版本&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2805 | src/project-file/validation.ts:2805 | return fail('INVALID_RECORD', &#96;文件版本 ${revision.revisionId} 属于其它项目&#96;) | return fail('INVALID_RECORD', &#96;文件版本 ${revision.revisionId} 属于其它项目&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2810 | src/project-file/validation.ts:2810 | &#96;文件版本 ${revision.revisionId} 的父版本不存在&#96;, | &#96;文件版本 ${revision.revisionId} 的父版本不存在&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2821 | src/project-file/validation.ts:2821 | return fail('INVALID_RECORD', &#96;文件版本父链存在环：${revision.revisionId}&#96;) | return fail('INVALID_RECORD', &#96;文件版本父链存在环：${revision.revisionId}&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2839 | src/project-file/validation.ts:2839 | &#96;版本 ${revision.revisionId} 的证据引用了不存在的分析快照&#96;, | &#96;版本 ${revision.revisionId} 的证据引用了不存在的分析快照&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2847 | src/project-file/validation.ts:2847 | &#96;版本 ${revision.revisionId} 的证据引用了不存在的事件&#96;, | &#96;版本 ${revision.revisionId} 的证据引用了不存在的事件&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2856 | src/project-file/validation.ts:2856 | &#96;版本 ${revision.revisionId} 的来源清单引用了不存在的来源版本&#96;, | &#96;版本 ${revision.revisionId} 的来源清单引用了不存在的来源版本&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/project-file/validation.ts:2867 | src/project-file/validation.ts:2867 | &#96;版本 ${revision.revisionId} 的恢复来源不存在&#96;, | &#96;版本 ${revision.revisionId} 的恢复来源不存在&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/requirements/check.ts:223 | src/requirements/check.ts:223 | revisions: snapshot.revisions.map((item) => ({ revisionId: item.id, sha256: item.sha256 })), | revisions: snapshot.revisions.map((item) => ({ revisionId: item.id, sha256: item.sha256 })), | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/requirements/confirm.ts:279 | src/requirements/confirm.ts:279 | changeReason: activeId === null ? reason \|\| '建立条款' : reason, | changeReason: activeId === null ? reason \|\| '建立条款' : reason, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/requirements/confirm.ts:334 | src/requirements/confirm.ts:334 | : &#96;更新任务书条款版本（原版本 ${revisionRecord.parentRevisionId}）。&#96;, | : &#96;更新任务书条款版本（原版本 ${revisionRecord.parentRevisionId}）。&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/requirements/history.ts:96 | src/requirements/history.ts:96 | &#96;条款版本 ${revision.revisionId} 引用的来源 PDF 版本 ${source.revisionId} 不在项目文件中（可能已删除），无法定位。&#96;, | &#96;条款版本 ${revision.revisionId} 引用的来源 PDF 版本 ${source.revisionId} 不在项目文件中（可能已删除），无法定位。&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/requirements/history.ts:108 | src/requirements/history.ts:108 | &#96;条款版本 ${revision.revisionId} 引用的来源 ${sourceRevision.id} 已声明缺失（${declaredMissing.reason}），无法打开 PDF。&#96;, | &#96;条款版本 ${revision.revisionId} 引用的来源 ${sourceRevision.id} 已声明缺失（${declaredMissing.reason}），无法打开 PDF。&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/requirements/history.ts:118 | src/requirements/history.ts:118 | &#96;条款版本 ${revision.revisionId} 引用的来源附件 ${source.blobKey} 不在项目文件中（可能已删除），无法打开 PDF。&#96;, | &#96;条款版本 ${revision.revisionId} 引用的来源附件 ${source.blobKey} 不在项目文件中（可能已删除），无法打开 PDF。&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/requirements/history.ts:128 | src/requirements/history.ts:128 | &#96;条款版本 ${revision.revisionId} 引用的来源 ${sourceRevision.id} 哈希与确认时不一致，不能打开可能已替换的 PDF。&#96;, | &#96;条款版本 ${revision.revisionId} 引用的来源 ${sourceRevision.id} 哈希与确认时不一致，不能打开可能已替换的 PDF。&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/requirements/history.ts:139 | src/requirements/history.ts:139 | &#96;条款版本 ${revision.revisionId} 保存的第 ${source.page} 页超出 ${sourceRevision.id} 的页数（${sourceRevision.pageCount} 页），无法定位选区。&#96;, | &#96;条款版本 ${revision.revisionId} 保存的第 ${source.page} 页超出 ${sourceRevision.id} 的页数（${sourceRevision.pageCount} 页），无法定位选区。&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/requirements/history.ts:163 | src/requirements/history.ts:163 | &#96;条款版本 ${revisionId} 不在项目文件中（可能已删除），无法定位来源 PDF。&#96;, | &#96;条款版本 ${revisionId} 不在项目文件中（可能已删除），无法定位来源 PDF。&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/requirements/history.ts:185 | src/requirements/history.ts:185 | label: &#96;条款 ${revision.revisionId}&#96;, | label: &#96;条款 ${revision.revisionId}&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/review/rules.ts:218 | src/review/rules.ts:218 | return { kind: 'term', id: term.id, label: &#96;组成环 ${termLabel(term)}&#96;, termId: term.id } | return { kind: 'term', id: term.id, label: &#96;组成环 ${termLabel(term)}&#96;, termId: term.id } | 故意保留：React key / DOM-data 属性 / IPC 参数 / 结构标识，不是用户可见文本 |
| src/review/rules.ts:280 | src/review/rules.ts:280 | label: &#96;${termId} 的${fieldLabel[field] ?? field}&#96;, | label: &#96;${termId} 的${fieldLabel[field] ?? field}&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/review/rules.ts:602 | src/review/rules.ts:602 | basis: &#96;绑定引用的版本 ${truncateId(binding.revisionId)} 在来源版本记录中不存在。&#96;, | basis: &#96;绑定引用的版本 ${truncateId(binding.revisionId)} 在来源版本记录中不存在。&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/review/rules.ts:660 | src/review/rules.ts:660 | basis: &#96;绑定指向文档「${document.title}」的当前最新版本 ${truncateId(binding.revisionId)}。&#96;, | basis: &#96;绑定指向文档「${document.title}」的当前最新版本 ${truncateId(binding.revisionId)}。&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/review/rules.ts:678 | src/review/rules.ts:678 | &#96;使用历史来源（已说明）：绑定仍指向旧版本 ${truncateId(binding.revisionId)}，&#96; + | &#96;使用历史来源（已说明）：绑定仍指向旧版本 ${truncateId(binding.revisionId)}，&#96; + | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/review/rules.ts:679 | src/review/rules.ts:679 | &#96;文档最新版本为 ${truncateId(document.latestRevisionId)}；&#96; + | &#96;文档最新版本为 ${truncateId(document.latestRevisionId)}；&#96; + | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/review/rules.ts:687 | src/review/rules.ts:687 | const previous = acceptance === null ? '' : &#96;此前接受的是 ${truncateId(acceptance.latestRevisionId)}，之后又导入了更新版本；&#96; | const previous = acceptance === null ? '' : &#96;此前接受的是 ${truncateId(acceptance.latestRevisionId)}，之后又导入了更新版本；&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/review/rules.ts:695 | src/review/rules.ts:695 | &#96;文档「${document.title}」已导入更新版本 ${truncateId(document.latestRevisionId)}，&#96; + | &#96;文档「${document.title}」已导入更新版本 ${truncateId(document.latestRevisionId)}，&#96; + | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/review/rules.ts:696 | src/review/rules.ts:696 | &#96;当前绑定仍指向旧版本 ${truncateId(binding.revisionId)}。${previous}&#96; + | &#96;当前绑定仍指向旧版本 ${truncateId(binding.revisionId)}。${previous}&#96; + | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/revisions/commit.ts:150 | src/revisions/commit.ts:150 | message: &#96;确认参数 ${credential.parameterId} 与环 ${credential.termId} 的 nominal 同步。&#96;, | message: &#96;确认参数 ${credential.parameterId} 与环 ${credential.termId} 的 nominal 同步。&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/revisions/commit.ts:163 | src/revisions/commit.ts:163 | : &#96;从版本 ${options.restoredFromRevisionId} 恢复生成新版本。&#96;, | : &#96;从版本 ${options.restoredFromRevisionId} 恢复生成新版本。&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/revisions/compare.ts:94 | src/revisions/compare.ts:94 | diff.push({ scope: 'meta', id: view.viewId, field: '视图', before: null, after: view.kind, kind: 'added' }) | diff.push({ scope: 'meta', id: view.viewId, field: '视图', before: null, after: view.kind, kind: 'added' }) | 故意保留：React key / DOM-data 属性 / IPC 参数 / 结构标识，不是用户可见文本 |
| src/revisions/compare.ts:124 | src/revisions/compare.ts:124 | push('parameter', parameterId, '来源备注', before.sourceNote ?? '', after.sourceNote ?? '') | push('parameter', parameterId, '来源备注', before.sourceNote ?? '', after.sourceNote ?? '') | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/revisions/compare.ts:191 | src/revisions/compare.ts:191 | push('primitive', primitiveId, '视图', before.viewId ?? '', after.viewId ?? '') | push('primitive', primitiveId, '视图', before.viewId ?? '', after.viewId ?? '') | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/revisions/compute.ts:98 | src/revisions/compute.ts:98 | &#96;组成环 ${binding.termId} 存在第二个参数绑定&#96;, | &#96;组成环 ${binding.termId} 存在第二个参数绑定&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/revisions/compute.ts:107 | src/revisions/compute.ts:107 | &#96;参数绑定 ${binding.bindingId} 引用了不存在的组成环&#96;, | &#96;参数绑定 ${binding.bindingId} 引用了不存在的组成环&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/revisions/compute.ts:115 | src/revisions/compute.ts:115 | &#96;参数绑定 ${binding.bindingId} 引用了不存在的参数&#96;, | &#96;参数绑定 ${binding.bindingId} 引用了不存在的参数&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/revisions/compute.ts:122 | src/revisions/compute.ts:122 | &#96;参数绑定 ${binding.bindingId} 的部件与参数不一致&#96;, | &#96;参数绑定 ${binding.bindingId} 的部件与参数不一致&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/revisions/compute.ts:127 | src/revisions/compute.ts:127 | throw new ChangeError('INVALID_BINDING', &#96;参数绑定 ${binding.bindingId} 指向不支持的部件&#96;) | throw new ChangeError('INVALID_BINDING', &#96;参数绑定 ${binding.bindingId} 指向不支持的部件&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/revisions/compute.ts:341 | src/revisions/compute.ts:341 | throw new ChangeError('MISSING_REFERENCE', &#96;绑定 ${binding.bindingId} 的引用不完整&#96;) | throw new ChangeError('MISSING_REFERENCE', &#96;绑定 ${binding.bindingId} 的引用不完整&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/revisions/rebuild.ts:21 | src/revisions/rebuild.ts:21 | return { ok: false, reason: &#96;未知图纸模板：${String(input.templateId)}，不能重建&#96; } | return { ok: false, reason: &#96;未知图纸模板：${String(input.templateId)}，不能重建&#96; } | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/revisions/status.ts:150 | src/revisions/status.ts:150 | if (term === null) reasons.push(&#96;组成环 ${link.termId} 不存在（悬空引用）&#96;) | if (term === null) reasons.push(&#96;组成环 ${link.termId} 不存在（悬空引用）&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/revisions/status.ts:151 | src/revisions/status.ts:151 | if (parameter === null) reasons.push(&#96;参数 ${link.parameterId} 不存在（悬空引用）&#96;) | if (parameter === null) reasons.push(&#96;参数 ${link.parameterId} 不存在（悬空引用）&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/revisions/status.ts:308 | src/revisions/status.ts:308 | if (term === null) reasons.push(&#96;组成环 ${binding.termId} 不存在（悬空引用）&#96;) | if (term === null) reasons.push(&#96;组成环 ${binding.termId} 不存在（悬空引用）&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/revisions/status.ts:309 | src/revisions/status.ts:309 | if (parameter === null) reasons.push(&#96;参数 ${binding.parameterId} 不存在（悬空引用）&#96;) | if (parameter === null) reasons.push(&#96;参数 ${binding.parameterId} 不存在（悬空引用）&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/sources/agentReadDisplay.ts:38 | src/sources/agentReadDisplay.ts:38 | return &#96;${reading.source.kind === 'pdf-page' ? &#96;第 ${reading.source.page} 页&#96; : '图片'}，${reading.actorId} 提供&#96; | return &#96;${reading.source.kind === 'pdf-page' ? &#96;第 ${reading.source.page} 页&#96; : '图片'}，${reading.actorId} 提供&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/storage/projectJson.ts:493 | src/storage/projectJson.ts:493 | message: &#96;绑定指向的组成环 ${termId} 不在导入的尺寸链中&#96;, | message: &#96;绑定指向的组成环 ${termId} 不在导入的尺寸链中&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/storage/projectJson.ts:542 | src/storage/projectJson.ts:542 | message: &#96;来源文档 ${document.id} 的最新版本 ${document.latestRevisionId} 不在文件中&#96;, | message: &#96;来源文档 ${document.id} 的最新版本 ${document.latestRevisionId} 不在文件中&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/storage/projectJson.ts:551 | src/storage/projectJson.ts:551 | message: &#96;来源版本 ${revision.id} 的文档 ${revision.documentId} 不在文件中&#96;, | message: &#96;来源版本 ${revision.id} 的文档 ${revision.documentId} 不在文件中&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/storage/projectJson.ts:560 | src/storage/projectJson.ts:560 | message: &#96;绑定 ${binding.id} 的来源版本 ${binding.revisionId} 不在文件中&#96;, | message: &#96;绑定 ${binding.id} 的来源版本 ${binding.revisionId} 不在文件中&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/storage/projects.ts:295 | src/storage/projects.ts:295 | &#96;项目 ${projectId} 无法从 V1 升级：${migrated.error.message}。&#96; + | &#96;项目 ${projectId} 无法从 V1 升级：${migrated.error.message}。&#96; + | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/storage/projects.ts:582 | src/storage/projects.ts:582 | &#96;备份中的项目 ${projectId} 无法恢复：${preflight.error.message}&#96;, | &#96;备份中的项目 ${projectId} 无法恢复：${preflight.error.message}&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/storage/projects.ts:617 | src/storage/projects.ts:617 | ? &#96;备份恢复失败：${failed.map((item) => &#96;${item.id}（${item.message}）&#96;).join('；')}&#96; | ? &#96;备份恢复失败：${failed.map((item) => &#96;${item.id}（${item.message}）&#96;).join('；')}&#96; | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/workspace/draft.ts:41 | src/workspace/draft.ts:41 | /** 键为 &#96;${termId}.${field}&#96;、&#96;target.min&#96; 或 &#96;target.max&#96;。 */ | /** 键为 &#96;${termId}.${field}&#96;、&#96;target.min&#96; 或 &#96;target.max&#96;。 */ | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/workspace/useBuiltinAssemblyView.ts:33 | src/workspace/useBuiltinAssemblyView.ts:33 | const [state, setState] = useState<ScopedState>({ sessionId: null, ...BLANK }) | const [state, setState] = useState<ScopedState>({ sessionId: null, ...BLANK }) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/workspace/useDesktopSession.ts:239 | src/workspace/useDesktopSession.ts:239 | openRecent: (item: RecentProjectItem) => run(async session => { report(await (item.missing ? session.relinkRecent(item.recentId) : session.openProject(item.recentId))) }), | openRecent: (item: RecentProjectItem) => run(async session => { report(await (item.missing ? session.relinkRecent(item.recentId) : session.openProject(item.recentId))) }), | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/workspace/useDesktopSession.ts:555 | src/workspace/useDesktopSession.ts:555 | notice: &#96;已确认条款版本 ${result.value.requirementRevisionId}（基线检查：${result.value.baselineCheck.status}）。&#96;, | notice: &#96;已确认条款版本 ${result.value.requirementRevisionId}（基线检查：${result.value.baselineCheck.status}）。&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/workspace/useDesktopSession.ts:559 | src/workspace/useDesktopSession.ts:559 | setNotice(&#96;任务书要求已保存为条款版本 ${result.value.requirementRevisionId}。&#96;) | setNotice(&#96;任务书要求已保存为条款版本 ${result.value.requirementRevisionId}。&#96;) | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/workspace/useDesktopSession.ts:603 | src/workspace/useDesktopSession.ts:603 | notice: &#96;已提交新版本 ${result.value.revisionId}（一次写入参数/图纸/链/事件/快照/版本）。&#96;, | notice: &#96;已提交新版本 ${result.value.revisionId}（一次写入参数/图纸/链/事件/快照/版本）。&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/workspace/useDesktopSession.ts:696 | src/workspace/useDesktopSession.ts:696 | reason: &#96;从版本 ${sourceRevisionId} 恢复&#96;, | reason: &#96;从版本 ${sourceRevisionId} 恢复&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |
| src/workspace/usePersistedWorkspace.ts:115 | src/workspace/usePersistedWorkspace.ts:115 | message: &#96;项目不存在：${projectId}&#96;, | message: &#96;项目不存在：${projectId}&#96;, | 保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射 |

## 全量 ID 引用附录（含非可见结构，故意保留）

下面保留所有基线匹配行，不删业务/存储引用；测试与夹具排除，因其不是生产展示入口。

### desktop/main/agentRuntime.ts

```text
15:   windowId: number
17:   activeProjectId: string
24: export function createAgentToolDispatcher(service: AgentToolService, windowId: number): AgentToolDispatcher {
27:       return service.run(windowId, call.command, call.arguments)
35:     dispatch: createAgentToolDispatcher(deps.service, deps.windowId),
38:     activeProjectId: deps.activeProjectId,
```

### desktop/main/agentScheduler.ts

```text
8:  * - 陈旧回包按 taskId + projectId 丢弃；切换项目后不得写入新项目。
46:   taskId: string
47:   projectId: string
53:   intentIdentity?: { actorId: string; sessionLabel: string | null }
67:   if (typeof value.draftId !== 'string') return data
77:     draftId: value.draftId,
79:     baseRevisionId: value.baseRevisionId,
89:     ...(typeof value.previewId === 'string' ? { previewId: value.previewId } : {}),
90:     ...(typeof value.previewFingerprint === 'string' ? { previewFingerprint: value.previewFingerprint } : {}),
118:   projectId: string
119:   baseRevisionId: string
121:   modelId?: string
125:   taskId?: string
127:   intentIdentity?: { actorId: string; sessionLabel: string | null }
137:   | { ok: true; taskId: string; completion: Promise<AgentTaskRecord> }
153:   activeProjectId: string
157:   onUpdate?: (taskId: string) => void
181:   private activeProjectId: string
185:     this.activeProjectId = deps.activeProjectId
188:   getActiveProjectId(): string {
189:     return this.activeProjectId
192:   setActiveProject(projectId: string): void {
193:     if (projectId === this.activeProjectId) return
194:     this.activeProjectId = projectId
195:     // 只是取消旧任务的模型等待；晚到回包由 isStaleReply 的 taskId+projectId 身份检查丢弃。
197:       if (entry.task.projectId !== projectId && !isTerminal(entry.task.state)) {
198:         entry.adapter.cancel(entry.task.taskId)
208:     if (options.projectId !== this.activeProjectId) {
212:     if (writes && this.writeLocks.has(options.projectId)) {
215:     const modelId = options.modelId ?? 'fake-1'
216:     const adapter = this.deps.adapters.get(modelId)
218:       return { ok: false, code: 'MODEL_NOT_CONFIGURED', message: `模型适配器 ${modelId} 未注册` }
220:     const taskId = options.taskId ?? randomUUID()
223:       taskId,
224:       projectId: options.projectId,
225:       baseRevisionId: options.baseRevisionId,
227:       modelId,
247:     this.tasks.set(taskId, entry)
248:     if (writes) this.writeLocks.set(options.projectId, taskId)
252:     return { ok: true, taskId, completion }
255:   async resumeTask(taskId: string): Promise<ResumeAgentTaskResult> {
256:     const entry = this.tasks.get(taskId)
261:     if (entry.task.projectId !== this.activeProjectId) {
264:     const holder = this.writeLocks.get(entry.task.projectId)
265:     if (entry.task.writes && holder !== undefined && holder !== taskId) {
268:     if (entry.task.writes) this.writeLocks.set(entry.task.projectId, taskId)
291:   async cancel(taskId: string): Promise<CancelAgentTaskResult> {
292:     const entry = this.tasks.get(taskId)
296:     entry.adapter.cancel(taskId)
301:   getTask(taskId: string): AgentTaskRecord | null {
302:     const entry = this.tasks.get(taskId)
306:   getSteps(taskId: string): AgentStepRecord[] {
307:     const entry = this.tasks.get(taskId)
311:   getTrace(taskId: string): { task: AgentTaskRecord; steps: AgentStepRecord[]; events: ModelEvent[] } | null {
312:     const entry = this.tasks.get(taskId)
333:           taskId: entry.task.taskId,
346:             () => entry.adapter.cancel(entry.task.taskId),
438:               taskId: entry.task.taskId,
439:               projectId: entry.task.projectId,
452:               requestId: randomUUID(),
460:             outputRef: result.ok ? `tool:${result.requestId}:${result.objectVersion}` : `tool:${result.requestId}:${result.code}`,
500:             toolCallId: call.id,
528:         taskId: entry.task.taskId,
529:         projectId: entry.task.projectId,
539:         requestId: randomUUID(),
546:       outputRef: result.ok ? `tool:${result.requestId}:${result.objectVersion}` : `tool:${result.requestId}:${result.code}`,
562:     return entry.task.projectId !== this.activeProjectId
570:           taskId: entry.task.taskId,
571:           projectId: entry.task.projectId,
572:           activeProjectId: this.activeProjectId,
579:     return await this.finish(entry, 'cancelled', 'STALE_REPLY', '项目已切换，旧任务回包按 taskId+projectId 丢弃')
607:     step: Omit<AgentStepRecord, 'stepId' | 'taskId' | 'at' | 'idempotencyKey'>,
610:       stepId: `step-${randomUUID()}`,
611:       taskId: entry.task.taskId,
618:         taskId: entry.task.taskId,
646:     try { this.deps.onUpdate?.(entry.task.taskId) } catch { /* UI 通知失败不影响任务记录 */ }
650:     if (this.writeLocks.get(entry.task.projectId) === entry.task.taskId) {
651:       this.writeLocks.delete(entry.task.projectId)
```

### desktop/main/agentSessionChannels.ts

```text
8:  *   重算提交在 AgentToolService / ApprovalStore 内，模型永远拿不到 approvalId。
39:   emit: (windowId: number, view: AgentTaskView) => void
53:     extractionDraftId: z.string().min(1).max(240).optional(),
56:       actorId: z.string().min(1).max(200),
60:   cancel: z.object({ taskId: id }).strict(),
61:   resume: z.object({ taskId: id }).strict(),
62:   taskState: z.object({ taskId: id }).strict(),
63:   issueApproval: z.object({ previewId: id, userAttestationAcknowledged: z.boolean().optional() }).strict(),
64:   commit: z.object({ approvalId: id, draftId: id, previewFingerprint: z.string().min(8).max(128) }).strict(),
65:   locate: z.object({ requirementRevisionId: id.optional(), checkId: id.optional(), parameterId: id.optional() }).strict(),
84:   'apply 成功后，后续 stage/preview 必须使用 apply 回执里的 draftId（不是提取草稿 ID）。',
94:   projectId: string
95:   baseRevisionId: string
96:   draftId?: string
98:   extractionDraftId?: string
102:     `- projectId: ${input.projectId}`,
103:     `- baseRevisionId: ${input.baseRevisionId}`,
105:   if (input.draftId !== undefined && input.draftId !== '') {
106:     lines.push(`- draftId: ${input.draftId}`)
111:   if (input.extractionDraftId !== undefined) {
112:     lines.push(`- extractionDraftId: ${input.extractionDraftId}`)
113:     lines.push('先调用 confirmed（参数 draftId=extractionDraftId）读取已确认候选、原因码与原文摘录。')
116:       lines.push('apply 需要 planToken + candidateIds + mapping。')
117:       lines.push('apply.mapping 需要 ringSymbols（组成环符号，例如 H/B1/S/B2）、formulaId（公式候选的 candidateId）、requirement=true、linkLengthToSymbol="S"。')
124:   return { ok: false, code, message, requestId: randomUUID(), objectVersion: 'unavailable', ...(details === undefined ? {} : { details }) }
183: function demoScript(scenario: 'normal' | 'ask' | 'failure', draftId: string, baseRevisionId: string): FakeModelStep[] {
184:   const basis = { toolMode: 'agent' as const, draftId, baseRevisionId }
246:   const viewOf = (windowId: number, taskId: string): AgentTaskView | null => {
247:     const scheduler = schedulers.get(windowId)
249:     const trace = scheduler.getTrace(taskId)
259:   const notify = (windowId: number, taskId: string): void => {
260:     const view = viewOf(windowId, taskId)
261:     if (view !== null) deps.emit(windowId, view)
264:   const schedulerFor = (windowId: number): AgentScheduler | null => {
265:     const cached = schedulers.get(windowId)
267:       const session = deps.controller.sessionFor(windowId)
268:       if (session !== null) cached.setActiveProject(session.snapshot.project.id)
271:     const session = deps.controller.sessionFor(windowId)
278:         dispatch: call => deps.service.run(windowId, call.command, call.arguments, {
280:           turnId: call.taskId,
287:       activeProjectId: session.snapshot.project.id,
289:       onUpdate: (taskId) => notify(windowId, taskId),
291:     schedulers.set(windowId, scheduler)
292:     registries.set(windowId, registry)
298:   const install = <P>(channel: string, schema: z.ZodType<P>, run: (windowId: number, params: P, event: unknown) => Promise<ToolResult<unknown>> | ToolResult<unknown>): void => {
305:         return (await run(sender.webContentsId, parsed.data, event)) as never
319:       demo: { available: true, modelId: FAKE_MODEL_ID, label: '离线演示（假模型，不联网）' },
321:     return { ok: true, data: value, requestId: randomUUID(), objectVersion: 'n/a' }
326:   install(IPC_CHANNELS.agentProviderSave, schemas.providerSave, async (_windowId, request) => {
333:       data: { real: runtime.status(), demo: { available: true, modelId: FAKE_MODEL_ID, label: '离线演示（假模型，不联网）' } },
334:       requestId: randomUUID(),
341:     return { ok: true, data: await runtime.testConnection(), requestId: randomUUID(), objectVersion: 'n/a' }
350:       data: { real: runtime.status(), demo: { available: true, modelId: FAKE_MODEL_ID, label: '离线演示（假模型，不联网）' } },
351:       requestId: randomUUID(),
356:   install(IPC_CHANNELS.agentExportApprovedVersion, schemas.export, async (windowId, request) => {
358:     return deps.service.exportApprovedVersion(windowId, request.format) as never
361:   install(IPC_CHANNELS.agentStart, schemas.start, async (windowId, request) => {
362:     const session = deps.controller.sessionFor(windowId)
364:     const scheduler = schedulerFor(windowId)
367:     const registry = registries.get(windowId)!
368:     const projectId = session.snapshot.project.id
369:     const baseRevisionId = session.snapshot.project.currentRevisionId
379:       let draftId = ''
381:       let extractionDraftId: string | undefined
384:         extractionDraftId = request.extractionDraftId
387:         const draft = await deps.service.prepareDemoDraft(windowId)
389:         draftId = draft.data.draftId
392:         projectId,
393:         baseRevisionId,
394:         ...(draftId === '' ? {} : { draftId }),
395:         ...(planToken === undefined || extractionDraftId === undefined ? {} : { planToken, extractionDraftId }),
398:         projectId,
399:         baseRevisionId,
401:         modelId: adapter.id,
409:                 actorId: request.intent.actorId,
416:       notify(windowId, started.taskId)
417:       const value: AgentStartValue = { taskId: started.taskId, demo: request.demo ?? 'normal', modelId: adapter.id }
418:       return { ok: true, data: value, requestId: randomUUID(), objectVersion: baseRevisionId }
427:         projectId,
428:         baseRevisionId,
430:         modelId: FAKE_MODEL_ID,
436:                 actorId: request.intent.actorId,
443:       notify(windowId, started.taskId)
444:       const value: AgentStartValue = { taskId: started.taskId, demo: scenario, modelId: FAKE_MODEL_ID }
445:       return { ok: true, data: value, requestId: randomUUID(), objectVersion: baseRevisionId }
448:     const draft = await deps.service.prepareDemoDraft(windowId)
450:     registry.register(new FakeModelAdapter(FAKE_MODEL_ID, demoScript(scenario, draft.data.draftId, draft.data.baseRevisionId)))
452:       projectId,
453:       baseRevisionId,
455:       modelId: FAKE_MODEL_ID,
461:               actorId: request.intent.actorId,
469:     notify(windowId, started.taskId)
470:     const value: AgentStartValue = { taskId: started.taskId, demo: scenario, modelId: FAKE_MODEL_ID }
471:     return { ok: true, data: value, requestId: randomUUID(), objectVersion: baseRevisionId }
474:   install(IPC_CHANNELS.agentTaskState, schemas.taskState, (windowId, request) => {
475:     const view = viewOf(windowId, request.taskId)
477:     return { ok: true, data: view, requestId: randomUUID(), objectVersion: view.task.baseRevisionId }
480:   install(IPC_CHANNELS.agentCancel, schemas.cancel, async (windowId, request) => {
481:     const scheduler = schedulers.get(windowId)
483:     const result = await scheduler.cancel(request.taskId)
485:     return { ok: true, data: { cancelled: true }, requestId: randomUUID(), objectVersion: 'n/a' }
488:   install(IPC_CHANNELS.agentResume, schemas.resume, async (windowId, request) => {
489:     const scheduler = schedulers.get(windowId)
491:     const result = await scheduler.resumeTask(request.taskId)
494:     notify(windowId, request.taskId)
495:     return { ok: true, data: { resumed: true }, requestId: randomUUID(), objectVersion: 'n/a' }
498:   install(IPC_CHANNELS.agentPreviewSummary, z.object({}).strict(), (windowId) => deps.service.previewSummary(windowId))
500:   install(IPC_CHANNELS.agentIssueApproval, schemas.issueApproval, (windowId, request) =>
501:     deps.service.issueApproval(windowId, request.previewId, {
511:     actorId: z.string().min(1).max(200),
513:   }).strict(), (windowId, request) =>
514:     deps.service.createIntentProject(windowId, {
516:       actorId: request.actorId,
520:   install(IPC_CHANNELS.intentState, z.object({}).strict(), (windowId) => deps.service.intentState(windowId))
521:   install(IPC_CHANNELS.intentApply, z.object({}).strict(), (windowId) => deps.service.applyIntentDraft(windowId))
522:   install(IPC_CHANNELS.intentPreview, z.object({}).strict(), (windowId) => deps.service.previewLatestDraft(windowId))
524:     candidateId: z.string().min(1).max(240),
526:   }).strict(), (windowId, request) => deps.service.confirmIntentCandidate(windowId, request))
527:   install(IPC_CHANNELS.intentIssueApproval, schemas.issueApproval, (windowId, request) =>
528:     deps.service.issueApproval(windowId, request.previewId, {
533:   install(IPC_CHANNELS.agentCommitApprovedDraft, schemas.commit, (windowId, request) => deps.service.commitApprovedDraft(windowId, request))
535:   install(IPC_CHANNELS.agentLocateEvidence, schemas.locate, (windowId, request) => deps.service.locateEvidence(windowId, request))
```

### desktop/main/agentTaskStore.ts

```text
20: const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
35:   filePath(taskId: string): string {
36:     return path.join(this.directory(), `${sha256(taskId)}.json`)
48:     const target = this.filePath(task.taskId)
62:   async load(taskId: string): Promise<AgentTaskFile | null> {
63:     const target = this.filePath(taskId)
68:     if (parsed.schemaVersion !== 1 || parsed.task.taskId !== taskId) throw new Error('任务记录身份不符')
```

### desktop/main/agentToolChannels.ts

```text
9: const basis = { draftId: id, baseRevisionId: id }
13:   confirmed: z.object({ draftId: id }).strict(),
18:   }, z.object({ planToken: id, baseRevisionId: id, candidateIds: z.array(id).min(1).max(200), mapping: z.object({
20:     formulaId: id.optional(), requirement: z.boolean().optional(), linkLengthToSymbol: id.optional(),
31:   const rejected = (code: 'INVALID_INPUT' | 'STALE_BASE', message: string): ToolResult<never> => ({ ok: false, code, message, requestId: randomUUID(), objectVersion: 'unavailable' })
35:   return deps.service.run(sender.webContentsId, command, parsed.data)
```

### desktop/main/agentToolService.ts

```text
7: import { stableFingerprint } from '../../src/revisions/canonical'
56:   validateActorId,
60: import { intentDraftId } from '../../src/intent/draft'
64:   windowId: number; sessionId: string; draftId: string; draftDigest: string; baseDigest: string; expires: number
68:   projectId: string
72:   sourceDraftId: string
75:   recovery: { basePath: string | null; baseFingerprint: string | null }
81:   previewId: string
82:   previewFingerprint: string
83:   windowId: number
84:   sessionId: string
85:   projectId: string
86:   draftId: string
88:   baseRevisionId: string
89:   requirementRevisionId: string | null
122:     draftId: draft.draftId,
136:         candidateId: candidate.candidateId,
151:   pickTarget: (windowId: number, suggestedName: string) => Promise<string | null>
153:   renderPdf?: (windowId: number, svg: string, drawing: DrawingData) => Promise<Uint8Array>
172: const hash = (value: string) => createHash('sha256').update(value).digest('hex')
175:   return stableFingerprint({ revisionId: p.currentRevisionId, chain: p.dimensionChain, parameters: p.parameters, links: p.dimensionLinks, parts: p.parts, drawings: p.drawings, requirements: p.requirementRevisions, activeRequirement: p.activeRequirementRevisionId })
177: const stamp = (snapshot: ProjectFileSnapshot) => stableFingerprint({ ...snapshot, attachments: snapshot.attachments.map(a => ({ blobKey: a.blobKey, digest: createHash('sha256').update(a.bytes).digest('hex') })) })
180:  * 预览指纹：覆盖提交所需的全部身份与数值，不含每次生成都会变的 previewId/时间。
184:   projectId: string
185:   draftId: string
187:   baseRevisionId: string
191:   return stableFingerprint({
192:     projectId: input.projectId,
193:     draftId: input.draftId,
195:     baseRevisionId: input.baseRevisionId,
197:       parameterId: parameter.parameterId,
205:       id: term.id,
218:     // 不包含 drawingFingerprint：图纸 record 带每次提交都会变的 revisionId；
220:     requirementRevisionId: input.check.requirementRevisionId,
222:     requirementInputFingerprint: input.check.inputFingerprint,
243:   async issueAfterDecision(windowId: number, draftId: string): Promise<string | null> {
244:     const session = this.deps.controller.sessionFor(windowId)
246:     const flushed = await this.deps.recovery.flush(session.sessionId)
250:     const draft = saved.value.project.extractionDrafts.find(d => d.draftId === draftId)
251:     const current = session.snapshot.project.extractionDrafts.find(d => d.draftId === draftId)
252:     if (!draft || !current || stableFingerprint(draft) !== stableFingerprint(current)) return null
257:     this.credentials.set(token, { windowId, sessionId: session.sessionId, draftId, draftDigest: stableFingerprint(draft), baseDigest: engineeringBasis(session.snapshot), expires: Date.now() + 600_000 })
262:     const recovery = await this.deps.recovery.readPersisted(session.sessionId)
274:   filePath(projectId: string): string { return path.join(this.deps.rootDir, 'agent-inputs', `${hash(projectId)}.json`) }
280:   async prepareDemoDraft(windowId: number): Promise<ToolResult<{ draftId: string; baseRevisionId: string }>> {
281:     const requestId = randomUUID()
282:     const session = this.deps.controller.sessionFor(windowId)
284:       return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' }
286:     const objectVersion = session.snapshot.project.currentRevisionId
287:     const task = async (): Promise<ToolResult<{ draftId: string; baseRevisionId: string }>> => {
289:         if (this.deps.controller.sessionFor(windowId) !== session) throw new MappingError('STALE_BASE', '活动项目已切换')
290:         const revisionId = session.snapshot.project.currentRevisionId
292:         if (stored !== null && stored.draft.baseRevisionId === revisionId && stored.baseDigest === engineeringBasis(session.snapshot)) {
293:           return { ok: true, data: { draftId: stored.draft.draftId, baseRevisionId: revisionId }, requestId, objectVersion }
305:         const draftId = `agent-draft-${randomUUID()}`
306:         const computation = computeChange(session.snapshot, { parameters, bindings }, { revisionId: draftId, now: new Date().toISOString() })
309:         const value = this.value({ chain: computation.chain, parameters: computation.parameters, bindings: computation.bindings, requirementEdit: null, missing: [], computation }, draftId, revisionId)
312:           projectId: project.id,
316:           sourceDraftId: 'demo',
319:           recovery: { basePath: session.path, baseFingerprint: session.fingerprint },
321:         }, () => this.deps.controller.sessionFor(windowId) === session && stamp(session.snapshot) === before)
322:         return { ok: true, data: { draftId, baseRevisionId: revisionId }, requestId, objectVersion }
325:         return { ok: false, code: mapped.code, message: mapped.message, requestId, objectVersion, details: mapped.causeCode === undefined ? undefined : { causeCode: mapped.causeCode } }
328:     return this.enqueue(session.sessionId, task)
332:   previewSummary(windowId: number): ToolResult<AgentPreviewSummary | null> {
333:     const requestId = randomUUID()
334:     const session = this.deps.controller.sessionFor(windowId)
335:     if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' }
336:     const previewId = this.latestPreviewBySession.get(session.sessionId)
337:     const record = previewId === undefined ? undefined : this.previews.get(previewId)
338:     if (record === undefined) return { ok: true, data: null, requestId, objectVersion: session.snapshot.project.currentRevisionId }
340:       this.previews.delete(record.previewId)
341:       this.latestPreviewBySession.delete(session.sessionId)
342:       return { ok: true, data: null, requestId, objectVersion: session.snapshot.project.currentRevisionId }
344:     return { ok: true, data: this.summaryOf(record), requestId, objectVersion: session.snapshot.project.currentRevisionId }
351:       previewId: record.previewId,
352:       previewFingerprint: record.previewFingerprint,
353:       draftId: record.draftId,
355:       baseRevisionId: record.baseRevisionId,
356:       requirementRevisionId: record.requirementRevisionId,
359:       requirement: record.requirementRevisionId === null ? null : {
370:   /** 界面确认动作签发授权；只返回 approvalId，不下发模型。 */
372:     windowId: number,
373:     previewId: string,
375:   ): Promise<ToolResult<{ approvalId: string; expiresAt: string }>> {
376:     const requestId = randomUUID()
377:     const session = this.deps.controller.sessionFor(windowId)
378:     const objectVersion = session?.snapshot.project.currentRevisionId ?? 'unavailable'
379:     if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion }
380:     const record = this.previews.get(previewId)
381:     if (record === undefined || record.sessionId !== session.sessionId || record.windowId !== windowId || Date.parse(record.expiresAt) <= Date.now()) {
382:       return { ok: false, code: 'NOT_CONFIRMED', message: '预览不存在、已过期或不属于当前窗口，请重新预览', requestId, objectVersion }
386:       return { ok: false, code: 'INVALID_INPUT', message: '授权服务未装配', requestId, objectVersion }
397:         requestId,
402:       windowId,
403:       projectId: record.projectId,
404:       draftId: record.draftId,
406:       requirementRevisionId: record.requirementRevisionId,
407:       previewFingerprint: record.previewFingerprint,
408:       baseRevisionId: record.baseRevisionId,
412:       return { ok: false, code: issued.code, message: issued.message, requestId, objectVersion, details: issued.causeCode === undefined ? undefined : { causeCode: issued.causeCode } }
414:     return { ok: true, data: { approvalId: issued.record.approvalId, expiresAt: issued.record.expiresAt }, requestId, objectVersion }
421:   async commitApprovedDraft(windowId: number, request: CommitApprovedDraftRequest): Promise<ToolResult<CommitApprovedDraftValue>> {
422:     const requestId = randomUUID()
423:     const session = this.deps.controller.sessionFor(windowId)
424:     const objectVersion = session?.snapshot.project.currentRevisionId ?? 'unavailable'
425:     if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion }
427:     if (approvals === undefined) return { ok: false, code: 'INVALID_INPUT', message: '授权服务未装配', requestId, objectVersion }
431:         ({ ok: false, code, message, requestId, objectVersion: session.snapshot.project.currentRevisionId, details: causeCode === undefined ? undefined : { causeCode } })
432:       const reserved = await approvals.reserve(request.approvalId, windowId)
437:         if (this.deps.controller.sessionFor(windowId) !== session) return fail('STALE_BASE', '活动项目已切换', 'SESSION_CHANGED')
438:         if (approval.projectId !== session.snapshot.project.id) return fail('NOT_CONFIRMED', '授权属于其他项目', 'PROJECT_MISMATCH')
439:         if (approval.draftId !== request.draftId) return fail('NOT_CONFIRMED', '授权对应的草稿身份不符', 'DRAFT_MISMATCH')
440:         if (approval.previewFingerprint !== request.previewFingerprint) return fail('NOT_CONFIRMED', '请求的预览指纹与授权记录不符', 'PREVIEW_MISMATCH')
441:         const revisionId = session.snapshot.project.currentRevisionId
442:         if (approval.baseRevisionId !== revisionId) return fail('STALE_BASE', '授权签发的正式基准已变化，请重新预览', 'BASE_CHANGED')
451:         if (stored === null || stored.draft.draftId !== approval.draftId) return fail('NOT_CONFIRMED', '工程草稿不存在或身份不符', 'DRAFT_MISSING')
453:         const extraction = session.snapshot.project.extractionDrafts.find(item => item.draftId === stored.sourceDraftId)
455:           if (stableFingerprint(extraction) !== stored.sourceDigest) return fail('NOT_CONFIRMED', '来源决定已变化', 'STALE_DECISION')
462:         const commitRevisionId = `rev-a-${randomUUID()}`
467:         const computation = computeChange(candidateSnapshot, { parameters: stored.draft.parameters, bindings: stored.draft.bindings }, { revisionId: commitRevisionId, now })
473:           activeRequirementRevisionId: candidateSnapshot.project.activeRequirementRevisionId,
476:           draft: { draftId: stored.draft.draftId, draftRevision: stored.draft.draftRevision, parameters: stored.draft.parameters, bindings: stored.draft.bindings },
477:           baseRevisionId: revisionId,
481:           checkId: `check-a-${randomUUID()}`,
488:         const recomputedFingerprint = previewFingerprintOf({
489:           projectId: session.snapshot.project.id,
490:           draftId: stored.draft.draftId,
492:           baseRevisionId: revisionId,
497:         if (recomputedFingerprint !== approval.previewFingerprint) {
502:         if (approval.requirementRevisionId !== checkResult.value.check.requirementRevisionId) return fail('NOT_CONFIRMED', '条款版本与授权不符', 'REQUIREMENT_REVISION_MISMATCH')
506:           draft: { draftId: stored.draft.draftId, draftRevision: stored.draft.draftRevision, parameters: stored.draft.parameters, bindings: stored.draft.bindings },
508:           activeRequirementRevisionId: candidateSnapshot.project.activeRequirementRevisionId,
511:           baseRevisionId: revisionId,
515:           checkId: `check-a-${randomUUID()}`,
516:           revisionId: commitRevisionId,
517:           analysisSnapshotId: `snapshot-a-${randomUUID()}`,
519:           restoredFromRevisionId: null,
530:         const eaten = await approvals.consume(approval.approvalId)
537:         const committed = await this.deps.projectService.commitCandidate(session.sessionId, {
541:             if (this.deps.controller.sessionFor(windowId) !== session) return '活动项目已切换'
544:             const current = this.previews.get(approval.approvalId)
554:           if (preview.previewFingerprint === approval.previewFingerprint) this.previews.delete(key)
556:         const latest = this.latestPreviewBySession.get(session.sessionId)
557:         if (latest !== undefined && this.previews.get(latest) === undefined) this.latestPreviewBySession.delete(session.sessionId)
561:             revisionId: commitRevisionId,
565:             analysisSnapshotId: commit.value.candidate.analysisSnapshot.id,
569:           requestId,
570:           objectVersion: commitRevisionId,
576:         if (!consumed) approvals.release(approval.approvalId)
579:     return this.enqueue(session.sessionId, task)
583:   locateEvidence(windowId: number, request: LocateEvidenceRequest): ToolResult<LocateEvidenceValue> {
584:     const requestId = randomUUID()
585:     const session = this.deps.controller.sessionFor(windowId)
586:     if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' }
587:     const objectVersion = session.snapshot.project.currentRevisionId
588:     const given = [request.requirementRevisionId, request.checkId, request.parameterId].filter(value => value !== undefined)
589:     if (given.length !== 1) return { ok: false, code: 'INVALID_INPUT', message: '必须且只能提供 requirementRevisionId / checkId / parameterId 之一', requestId, objectVersion }
590:     if (request.parameterId !== undefined) {
591:       const parameter = session.snapshot.project.parameters.find(item => item.parameterId === request.parameterId)
592:       if (parameter === undefined) return { ok: false, code: 'INVALID_INPUT', message: '参数不存在，无法定位', requestId, objectVersion }
593:       const termIds = session.snapshot.project.dimensionLinks.filter(link => link.kind === 'parameter-binding' && link.parameterId === parameter.parameterId).map(link => link.termId)
594:       const annotationIds: string[] = []
595:       let drawingId: string | null = null
598:         if (!drawing.parameterIds.includes(parameter.parameterId)) continue
599:         drawingId ??= drawing.drawingId
603:           if (annotation.parameterId === parameter.parameterId) annotationIds.push(annotation.annotationId)
606:       return { ok: true, data: { kind: 'parameter', parameterId: parameter.parameterId, key: parameter.key, valueQ: parameter.valueQ, termIds, annotationIds, drawingId }, requestId, objectVersion }
609:     let revisionId: string
610:     let checkId: string | null = null
611:     if (request.requirementRevisionId !== undefined) {
612:       revisionId = request.requirementRevisionId
614:       const wanted = request.checkId!
616:       if (current !== null && current.checkId === wanted) {
617:         if (current.requirementRevisionId === null) return { ok: false, code: 'INVALID_INPUT', message: '该检查没有条款来源可定位', requestId, objectVersion }
618:         revisionId = current.requirementRevisionId
619:         checkId = current.checkId
621:         const revision = session.snapshot.fileRevisions.find(item => item.evidence?.checkId === wanted)
622:         if (revision === undefined || revision.evidence?.requirementRevisionId == null) {
623:           return { ok: false, code: 'INVALID_INPUT', message: '检查记录不存在，或没有可定位的条款来源', requestId, objectVersion }
625:         revisionId = revision.evidence.requirementRevisionId
626:         checkId = wanted
629:     const resolved = resolveRequirementRevisionSource(session.snapshot, revisionId)
631:       return { ok: false, code: 'INVALID_INPUT', message: resolved.issue?.message ?? '条款版本不存在，无法定位', requestId, objectVersion }
634:       return { ok: false, code: 'INVALID_INPUT', message: resolved.location.issue.message, requestId, objectVersion }
640:         requirementRevisionId: revisionId,
641:         checkId,
642:         revisionId: resolved.location.revisionId,
649:       requestId,
658:   async exportApprovedVersion(windowId: number, format: 'pdf' | 'svg'): Promise<ToolResult<AgentExportValue>> {
659:     const requestId = randomUUID()
660:     const session = this.deps.controller.sessionFor(windowId)
661:     const objectVersion = session?.snapshot.project.currentRevisionId ?? 'unavailable'
662:     if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion }
664:     if (ports === undefined) return { ok: false, code: 'UNSUPPORTED_SCOPE', message: '导出端口未装配', requestId, objectVersion }
666:       return { ok: false, code: 'SAVE_FAILED', message: '当前项目尚未保存到磁盘，只能导出已保存版本', requestId, objectVersion }
669:       const current = this.deps.controller.sessionFor(windowId)
670:       if (current !== session) return { ok: false, code: 'STALE_BASE', message: '活动项目已切换', requestId, objectVersion }
671:       const revisionId = session.snapshot.project.currentRevisionId
674:         return { ok: false, code: 'TOOL_FAILED', message: `图纸无法重建：${rebuilt.message}`, requestId, objectVersion: revisionId }
683:           return { ok: false, code: 'UNSUPPORTED_SCOPE', message: 'PDF 渲染端口未装配，改用 svg', requestId, objectVersion: revisionId }
686:           bytes = await ports.renderPdf(windowId, svg, drawing)
688:           return { ok: false, code: 'TOOL_FAILED', message: 'PDF 渲染失败，未产生文件', requestId, objectVersion: revisionId }
693:       const suggested = `${session.snapshot.project.name}${intentSuffix}-${revisionId.slice(0, 8)}.${format}`
694:       const target = await ports.pickTarget(windowId, suggested)
696:         return { ok: false, code: 'CANCELLED', message: '已在系统对话框中取消导出；没有产生文件', requestId, objectVersion: revisionId }
704:         expectedFingerprint: existing,
715:         return { ok: false, code: 'SAVE_FAILED', message: `${saved.error.message}（${saved.error.code}）`, requestId, objectVersion: revisionId }
723:           sha256: saved.value.fingerprint,
724:           revisionId,
726:         requestId,
727:         objectVersion: revisionId,
730:     return this.enqueue(session.sessionId, task)
734:   private enqueue<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
735:     const previous = this.queues.get(sessionId) ?? Promise.resolve()
737:     this.queues.set(sessionId, next)
746:   /** 无任务书项目：建立（无会话时新建并挂接；空白项目就地转换，projectId 不变）。 */
748:     windowId: number,
749:     input: { name: string; actorId: string; sessionLabel?: string | null },
751:     const requestId = randomUUID()
752:     const session = this.deps.controller.sessionFor(windowId)
753:     const objectVersion = session?.snapshot.project.currentRevisionId ?? 'unavailable'
754:     const actor = validateActorId(input.actorId)
756:       return { ok: false, code: 'INVALID_INPUT', message: actor.message, requestId, objectVersion }
760:       actorId: actor.value,
770:           return { ok: false, code: 'SAVE_FAILED', message: opened.error.message, requestId, objectVersion }
772:         await this.deps.controller.attach(windowId, opened.value.sessionId)
773:         const created = this.deps.controller.sessionFor(windowId)
775:           return { ok: false, code: 'TOOL_FAILED', message: '新会话建立后无法读取', requestId, objectVersion }
781:             projectId: created.snapshot.project.id,
782:             draftId: draft?.draftId ?? '',
783:             actorId: identity.actorId,
787:           requestId,
788:           objectVersion: created.snapshot.project.currentRevisionId,
796:             projectId: session.snapshot.project.id,
797:             draftId: draft?.draftId ?? '',
798:             actorId: session.snapshot.project.actorId ?? identity.actorId,
802:           requestId,
811:           requestId,
818:         session.sessionId,
828:           projectId: session.snapshot.project.id,
829:           draftId: draft?.draftId ?? '',
830:           actorId: identity.actorId,
834:         requestId,
835:         objectVersion: session.snapshot.project.currentRevisionId,
842:         requestId,
849:     actorId: string
854:       actorId: project.actorId ?? '',
891:         candidateId: candidate.candidateId,
903:       projectId: project.id,
904:       draftId: draft.draftId,
907:       actorId: project.actorId,
927:   intentState(windowId: number): ToolResult<IntentDraftView | null> {
928:     const requestId = randomUUID()
929:     const session = this.deps.controller.sessionFor(windowId)
931:       return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' }
936:       requestId,
937:       objectVersion: session.snapshot.project.currentRevisionId,
954:     windowId: number,
957:     turn: { userText: string; turnId: string; at: string },
959:     const requestId = randomUUID()
960:     const session = this.deps.controller.sessionFor(windowId)
962:       return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' }
964:     const objectVersion = session.snapshot.project.currentRevisionId
971:         requestId,
987:         requestId,
995:       session.sessionId,
1003:       return { ok: false, code: 'TOOL_FAILED', message: '意图草稿写入后无法读取', requestId, objectVersion }
1005:     return { ok: true, data: view, requestId, objectVersion }
1012:   async applyIntentDraft(windowId: number): Promise<ToolResult<AgentDraftValue>> {
1013:     const requestId = randomUUID()
1014:     const session = this.deps.controller.sessionFor(windowId)
1015:     const objectVersion = session?.snapshot.project.currentRevisionId ?? 'unavailable'
1016:     if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion }
1020:         ok: false, code, message, requestId, objectVersion: session.snapshot.project.currentRevisionId,
1030:         revisions: session.snapshot.revisions.map((r) => ({ revisionId: r.id, sha256: r.sha256 })),
1031:         candidateIds: draft.candidates.map((candidate) => candidate.candidateId),
1044:       const draftId = `agent-draft-${randomUUID()}`
1049:           ...(formula === undefined ? {} : { formulaId: formula.candidateId }),
1058:           draftId,
1061:         const value = this.value(mapped, draftId, session.snapshot.project.currentRevisionId)
1065:           projectId: project.id,
1067:           requestKey: stableFingerprint({ intent: draft.draftId, draftRevision: draft.draftRevision }),
1069:           sourceDraftId: draft.draftId,
1070:           sourceDigest: stableFingerprint(draft),
1072:           recovery: { basePath: session.path, baseFingerprint: session.fingerprint },
1076:         await this.write(session, payload, () => this.deps.controller.sessionFor(windowId) === session)
1077:         return { ok: true, data: value, requestId, objectVersion: session.snapshot.project.currentRevisionId }
1083:     return this.enqueue(session.sessionId, task)
1091:     windowId: number,
1092:     request: { candidateId: string; editRevision: number },
1094:     const requestId = randomUUID()
1095:     const session = this.deps.controller.sessionFor(windowId)
1097:       return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' }
1099:     const objectVersion = session.snapshot.project.currentRevisionId
1102:       return { ok: false, code: 'UNSUPPORTED_SCOPE', message: '当前项目不是无任务书项目', requestId, objectVersion }
1106:       return { ok: false, code: 'INVALID_INPUT', message: '意图草稿不存在', requestId, objectVersion }
1109:       candidateId: request.candidateId,
1112:       actor: project.actorId ?? 'local',
1120:         requestId,
1130:           item.draftId === draft.draftId ? confirmed.value : item,
1136:       session.sessionId,
1144:       return { ok: false, code: 'TOOL_FAILED', message: '确认后无法读取意图草稿', requestId, objectVersion }
1146:     return { ok: true, data: view, requestId, objectVersion }
1150:   async previewLatestDraft(windowId: number): Promise<ToolResult<unknown>> {
1151:     const requestId = randomUUID()
1152:     const session = this.deps.controller.sessionFor(windowId)
1154:       return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' }
1162:         requestId,
1163:         objectVersion: session.snapshot.project.currentRevisionId,
1166:     return this.run(windowId, 'preview', {
1168:       draftId: stored.draft.draftId,
1169:       baseRevisionId: session.snapshot.project.currentRevisionId,
1183:     const intent = project.extractionDrafts.find((item) => item.draftId === intentDraftId(project.id))
1191:         (revision) => revision.revisionId === project.activeRequirementRevisionId,
1194:       projectId: project.id,
1199:       requirementId: previous?.requirementId ?? null,
1202:     const next = previous === null ? revision : { ...revision, parentRevisionId: previous.revisionId }
1208:           ...project.requirementRevisions.filter((item) => item.revisionId !== next.revisionId),
1211:         activeRequirementRevisionId: next.revisionId,
1217:     const target = this.filePath(session.snapshot.project.id)
1224:     if (!stored.payload || stored.digest !== hash(JSON.stringify(stored.payload)) || stored.payload.schemaVersion !== 1 || stored.payload.projectId !== session.snapshot.project.id) {
1232:     const target = this.filePath(session.snapshot.project.id)
1254:   private value(mapped: AgentDraftValue | ReturnType<typeof mapConfirmed>, draftId: string, revision: string, generation = 1): AgentDraftValue {
1260:     return { ...mapped, draftId, draftRevision: generation, baseRevisionId: revision,
1270:     windowId: number,
1286:       turnId?: string
1287:       intentIdentity?: { actorId: string; sessionLabel: string | null }
1290:     const requestId = randomUUID()
1291:     const session = this.deps.controller.sessionFor(windowId)
1292:     const objectVersion = session?.snapshot.project.currentRevisionId ?? 'unavailable'
1296:       if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion }
1298:         if (this.deps.controller.sessionFor(windowId) !== session) return { ok: false, code: 'STALE_BASE', message: '活动项目已切换', requestId, objectVersion }
1300:           userText: context?.userText ?? '', turnId: context?.turnId ?? requestId, at: new Date().toISOString(),
1301:           actorId: context?.intentIdentity?.actorId,
1303:         if (!result.ok) return { ...result, requestId, objectVersion }
1305:         await this.deps.recovery.stage(session.sessionId, result.snapshot, acceptedSeq,
1309:         return { ok: true, data: result.data, requestId, objectVersion }
1311:       const previous = this.queues.get(session.sessionId) ?? Promise.resolve()
1313:       this.queues.set(session.sessionId, next)
1322:           requestId,
1328:         return { ok: false, code: 'INVALID_INPUT', message: '建项参数只接受名称与零件类型 spacer', requestId, objectVersion }
1330:       return this.createIntentProject(windowId, {
1332:         actorId: context.intentIdentity.actorId,
1337:       if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion }
1340:         return { ok: false, code: 'INVALID_INPUT', message: '缺少本轮用户原话，不能校验数值来源', requestId, objectVersion }
1342:       return this.runIntentTool(windowId, command, input, {
1344:         turnId: context?.turnId ?? requestId,
1349:     if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion }
1354:         return { ok: false, code: 'INVALID_INPUT', message: '导出格式只支持 pdf 或 svg', requestId, objectVersion }
1356:       return this.exportApprovedVersion(windowId, format)
1360:         if (this.deps.controller.sessionFor(windowId) !== session) throw new MappingError('STALE_BASE', '活动项目已切换')
1361:         const data = await this.execute(windowId, session, command, input)
1362:         return { ok: true, data, requestId, objectVersion: session.snapshot.project.currentRevisionId }
1366:         return { ok: false, code: known ? error.code : 'TOOL_FAILED', message: known ? error.message : '工程工具执行失败', details: known ? error.details : undefined, requestId, objectVersion: session.snapshot.project.currentRevisionId }
1369:     const previous = this.queues.get(session.sessionId) ?? Promise.resolve()
1371:     this.queues.set(session.sessionId, next)
1380:     const doc = session.snapshot.documents.find(d => d.id === draft.sourceIdentity.documentId)
1381:     const revision = session.snapshot.revisions.find(r => r.id === draft.sourceIdentity.revisionId)
1382:     if (!doc || !revision || revision.id !== draft.sourceIdentity.revisionId) return null
1385:     const cached = this.excerpts.get(revision.sha256)
1398:       this.excerpts.set(revision.sha256, value)
1406:     const doc = session.snapshot.documents.find(d => d.id === draft.sourceIdentity.documentId)
1407:     const revision = session.snapshot.revisions.find(r => r.id === doc?.latestRevisionId)
1409:     if (!revision || revision.id !== draft.sourceIdentity.revisionId || revision.sha256 !== draft.sourceIdentity.sha256 || !bytes || createHash('sha256').update(bytes).digest('hex') !== revision.sha256) {
1414:   private async execute(windowId: number, session: ProjectSession, command: string, input: unknown): Promise<unknown> {
1415:     const revisionId = session.snapshot.project.currentRevisionId
1417:       const draft = session.snapshot.project.extractionDrafts.find(d => d.draftId === (input as { draftId: string }).draftId)
1428:         const extraction = session.snapshot.project.extractionDrafts.find(d => d.draftId === stored.sourceDraftId)
1429:         const demo = stored.sourceDraftId === 'demo' && stored.sourceDigest === 'demo'
1430:         let stale = stored.baseDigest !== engineeringBasis(session.snapshot) || (!demo && (!extraction || stableFingerprint(extraction) !== stored.sourceDigest))
1437:         draftId: visibleDraft.draftId,
1439:         baseRevisionId: visibleDraft.baseRevisionId,
1457:         projectId: p.id,
1458:         revisionId,
1473:             revisionId: revision.revisionId,
1488:     const guard = () => this.deps.controller.sessionFor(windowId) === session && stamp(session.snapshot) === before
1492:       if (!credential || credential.windowId !== windowId || credential.sessionId !== session.sessionId || credential.expires < Date.now()) throw new MappingError('NOT_CONFIRMED', '计划凭据不存在、过期或不属于本窗口')
1495:       const draft = saved.value.project.extractionDrafts.find(d => d.draftId === credential.draftId)
1496:       const current = session.snapshot.project.extractionDrafts.find(d => d.draftId === credential.draftId)
1500:       if (stableFingerprint(draft) !== stableFingerprint(current) || stableFingerprint(draft) !== credential.draftDigest) throw new MappingError('NOT_CONFIRMED', '候选决定代数已变化', { causeCode: 'STALE_DECISION' })
1502:       const plan = planApplication(draft, { source: draft.sourceIdentity, candidateIds: req.candidateIds,
1504:         revisions: session.snapshot.revisions.map((r) => ({ revisionId: r.id, sha256: r.sha256 })) })
1507:       if (req.baseRevisionId !== revisionId) throw new MappingError('STALE_BASE', '计划正式基准已过期')
1509:       const planKey = hash(JSON.stringify([req.planToken, req.baseRevisionId]))
1510:       const requestKey = stableFingerprint({ candidateIds: [...new Set(req.candidateIds)].sort(), mapping: req.mapping })
1511:       const applications = stored?.draft.baseRevisionId === revisionId ? stored.applications : {}
1518:       const draftId = `agent-draft-${randomUUID()}`
1519:       const mapped = mapConfirmed(session.snapshot, draft, plan.value, req.mapping, { draftId, now: new Date().toISOString() })
1520:       const value = this.value(mapped, draftId, revisionId)
1522:       const payload: DraftFile = { schemaVersion: 1, projectId: session.snapshot.project.id, planKey, requestKey, applications: { ...applications, [planKey]: { requestKey, value } }, sourceDraftId: draft.draftId, sourceDigest: stableFingerprint(draft), baseDigest: engineeringBasis(session.snapshot), recovery: { basePath: session.path, baseFingerprint: session.fingerprint }, draft: value }
1527:     if (req.baseRevisionId !== revisionId) throw new MappingError('STALE_BASE', '工程草稿正式基准已过期')
1528:     if (!stored || stored.draft.draftId !== req.draftId || stored.draft.baseRevisionId !== revisionId) throw new MappingError('STALE_PREVIEW', '工程草稿不存在或已过期')
1530:     const extraction = session.snapshot.project.extractionDrafts.find(d => d.draftId === stored.sourceDraftId)
1531:     const demoDraft = stored.sourceDraftId === 'demo' && stored.sourceDigest === 'demo'
1533:       if (!extraction || stableFingerprint(extraction) !== stored.sourceDigest) throw new MappingError('NOT_CONFIRMED', '来源决定已变化', { causeCode: 'STALE_DECISION' })
1544:         { parameters: stored.draft.parameters, bindings: stored.draft.bindings }, { revisionId: stored.draft.draftId, now: nowIso })
1550:         activeRequirementRevisionId: candidateSnapshot.project.activeRequirementRevisionId,
1552:         draft: { draftId: stored.draft.draftId, draftRevision: stored.draft.draftRevision, parameters: stored.draft.parameters, bindings: stored.draft.bindings },
1553:         baseRevisionId: revisionId,
1557:         checkId: `check-p-${randomUUID()}`,
1563:       const previewId = `preview-${randomUUID()}`
1564:       const previewFingerprint = previewFingerprintOf({
1565:         projectId: session.snapshot.project.id,
1566:         draftId: stored.draft.draftId,
1568:         baseRevisionId: revisionId,
1574:       this.previews.set(previewId, {
1575:         previewId,
1576:         previewFingerprint,
1577:         windowId,
1578:         sessionId: session.sessionId,
1579:         projectId: session.snapshot.project.id,
1580:         draftId: stored.draft.draftId,
1582:         baseRevisionId: revisionId,
1583:         requirementRevisionId: checkResult.value.check.requirementRevisionId,
1590:       this.latestPreviewBySession.set(session.sessionId, previewId)
1591:       return { ...this.value({ ...stored.draft, computation }, stored.draft.draftId, revisionId, stored.draft.draftRevision), previewId, previewFingerprint }
1606:     const computation = computeChange(candidate, { parameters, bindings: stored.draft.bindings }, { revisionId: stored.draft.draftId, now: new Date().toISOString() })
1609:     const next = this.value({ ...stored.draft, chain: computation.chain, parameters: computation.parameters, computation }, stored.draft.draftId, revisionId, stored.draft.draftRevision + 1)
```

### desktop/main/approvalStore.ts

```text
12:  *   所以同一 approvalId 最多走到一次提交。
34:   newId?: () => string
38: const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
44:     typeof record.approvalId === 'string' && record.approvalId.length > 0 &&
45:     Number.isSafeInteger(record.windowId) &&
46:     typeof record.projectId === 'string' &&
47:     typeof record.draftId === 'string' &&
49:     (record.requirementRevisionId === null || typeof record.requirementRevisionId === 'string') &&
50:     typeof record.previewFingerprint === 'string' && record.previewFingerprint.length > 0 &&
51:     typeof record.baseRevisionId === 'string' &&
62:   private readonly newId: () => string
66:   /** 已在处理中的 approvalId：在第一个 await 之前占用，防止并发双提交。 */
73:     this.newId = deps.newId ?? randomUUID
81:   filePath(approvalId: string): string {
82:     return path.join(this.directory(), `${sha256(approvalId)}.json`)
91:     windowId: number
92:     projectId: string
93:     draftId: string
95:     requirementRevisionId: string | null
96:     previewFingerprint: string
97:     baseRevisionId: string
102:       approvalId: this.newId(),
103:       windowId: input.windowId,
104:       projectId: input.projectId,
105:       draftId: input.draftId,
107:       requirementRevisionId: input.requirementRevisionId,
108:       previewFingerprint: input.previewFingerprint,
109:       baseRevisionId: input.baseRevisionId,
115:     const written = await writeJsonIndex(this.ops, this.filePath(record.approvalId), { schemaVersion: 1, record })
119:     this.cache.set(record.approvalId, record)
123:   private async load(approvalId: string): Promise<ApprovalLookup> {
124:     const read = await readJsonIndex(this.ops, this.filePath(approvalId))
129:     if (payload.schemaVersion !== 1 || !isRecord(payload.record) || payload.record.approvalId !== approvalId) {
132:     this.cache.set(approvalId, payload.record)
140:   async reserve(approvalId: string, windowId: number): Promise<ApprovalLookup> {
141:     const cached = this.cache.get(approvalId)
145:     if (this.claims.has(approvalId)) {
148:     this.claims.add(approvalId)
151:       loaded = cached === undefined ? await this.load(approvalId) : { ok: true, record: cached }
153:       this.claims.delete(approvalId)
157:       this.claims.delete(approvalId)
162:       this.claims.delete(approvalId)
165:     if (record.windowId !== windowId) {
166:       this.claims.delete(approvalId)
171:       this.claims.delete(approvalId)
178:   release(approvalId: string): void {
179:     this.claims.delete(approvalId)
187:   async consume(approvalId: string): Promise<{ ok: true; record: ApprovalRecord } | ApprovalFailure> {
188:     const record = this.cache.get(approvalId)
190:       this.claims.delete(approvalId)
194:     const written = await writeJsonIndex(this.ops, this.filePath(approvalId), { schemaVersion: 1, record: consumed })
196:       this.claims.delete(approvalId)
199:     this.cache.set(approvalId, consumed)
201:     this.claims.delete(approvalId)
206:   peek(approvalId: string): ApprovalRecord | null {
207:     const record = this.cache.get(approvalId)
```

### desktop/main/changeChannels.ts

```text
36:     termId: idLike,
37:     partId: idLike,
38:     parameterId: idLike,
45:       sessionId: z.string().min(1).max(200),
68:       sessionId: z.string().min(1).max(200),
75:       sessionId: z.string().min(1).max(200),
78:       previewId: idLike,
80:       requestId: idLike,
86:       sessionId: z.string().min(1).max(200),
88:       termId: idLike,
89:       partId: idLike,
90:       parameterId: idLike,
91:       replaceBindingId: idLike.optional(),
97:       sessionId: z.string().min(1).max(200),
99:       bindingId: idLike,
105:       sessionId: z.string().min(1).max(200),
106:       leftRevisionId: idLike.optional(),
108:       drawingId: idLike.optional(),
113:       sessionId: z.string().min(1).max(200),
115:       sourceRevisionId: idLike,
142:   function requireActive(windowId: number, sessionId: string): void {
143:     if (deps.controller.sessionIdFor(windowId) !== sessionId) {
154:         requireActive(sender.webContentsId, params.sessionId)
155:         return unwrap(await deps.changeService.stage(params.sessionId, params))
167:         requireActive(sender.webContentsId, params.sessionId)
169:           await deps.changeService.preview(params.sessionId, params.baseToken, params.draftToken),
182:         requireActive(sender.webContentsId, params.sessionId)
195:         requireActive(sender.webContentsId, params.sessionId)
196:         return unwrap(await deps.changeService.bind(params.sessionId, params))
208:         requireActive(sender.webContentsId, params.sessionId)
209:         return unwrap(await deps.changeService.unbind(params.sessionId, params))
221:         requireActive(sender.webContentsId, params.sessionId)
222:         return unwrap(await deps.changeService.compare(params.sessionId, params))
234:         requireActive(sender.webContentsId, params.sessionId)
235:         return unwrap(await deps.changeService.restore(params.sessionId, params))
```

### desktop/main/changeService.ts

```text
39: import { stableFingerprint } from '../../src/revisions/canonical'
76:   draftId: string
81:   restoredFromRevisionId: string | null
82:   sourceRevisionId: string | null
84:   requirementRevisionId: string | null
88:   parameters: { parameterId: string; valueQ: number; inputDecimals: number; parameterRevision: number; sourceNote: string }[]
89:   terms: { termId: string; nominalQ: number; termRevision: number }[]
91:   drawingFingerprint: string
96:   previewId: string
100:   draftId: string
102:   revisionId: string
129:   newId?: () => string
163:   return stableFingerprint({
191:   const termIds = new Set(snapshot.project.dimensionChain.terms.map((term) => term.id))
192:   const parameterById = new Map(parameters.map((parameter) => [parameter.parameterId, parameter]))
195:     if (seen.has(binding.termId)) {
196:       return `组成环 ${binding.termId} 存在第二个参数绑定`
198:     seen.add(binding.termId)
199:     if (!termIds.has(binding.termId)) {
200:       return `绑定 ${binding.bindingId} 引用了不存在的组成环`
202:     const parameter = parameterById.get(binding.parameterId)
204:       return `绑定 ${binding.bindingId} 引用了不存在的参数`
206:     if (parameter.partId !== binding.partId) {
207:       return `绑定 ${binding.bindingId} 的部件与参数不一致`
209:     if (parameter.partId !== SPACER_PART_ID) {
210:       return `绑定 ${binding.bindingId} 指向不支持的部件`
219:       parameterId: parameter.parameterId,
226:       termId: term.id,
236:     drawingFingerprint: computation.drawing.record.dataFingerprint,
243:   const beforeParam = new Map(before.parameters.map((item) => [item.parameterId, item]))
245:     const old = beforeParam.get(item.parameterId)
247:       diffs.push(`参数 ${item.parameterId} 在预览中不存在`)
256:       diffs.push(`参数 ${item.parameterId} 与预览不一致`)
259:   const beforeTerms = new Map(before.terms.map((item) => [item.termId, item]))
261:     const old = beforeTerms.get(item.termId)
263:       diffs.push(`组成环 ${item.termId} 与预览不一致`)
274:   if (before.drawingFingerprint !== after.drawingFingerprint) {
294:     return (this.deps.newId ?? (() => randomUUID()))()
297:   private stateOf(sessionId: string): ChangeSessionState {
298:     let state = this.states.get(sessionId)
301:       this.states.set(sessionId, state)
309:       sessionId: session.sessionId,
316:         sessionId: session.sessionId,
339:       draftId: draft.draftId,
347:   private requireSession(sessionId: string): { session: ProjectSession } | { error: ChangeFailure } {
348:     const session = this.deps.projectService.getSession(sessionId)
363:       draftId: draft.draftId,
397:       draftId: `draft:${this.id()}`,
402:       restoredFromRevisionId: null,
403:       sourceRevisionId: null,
404:       requirementRevisionId: session.snapshot.project.activeRequirementRevisionId,
410:   async stage(sessionId: string, request: ChangeStageRequest): Promise<ChangeResult<ChangeDraftValue>> {
411:     const found = this.requireSession(sessionId)
421:     const state = this.stateOf(sessionId)
439:         parameterId: item.parameterId,
440:         partId: item.partId,
466:           (binding) => binding.termId === input.termId && binding.parameterId === input.parameterId,
469:           (binding) => binding.termId === input.termId && binding.parameterId === input.parameterId,
473:           bindingId:
474:             fromDraft?.bindingId ?? previous?.bindingId ?? `binding:${this.id()}`,
475:           termId: input.termId,
476:           partId: input.partId,
477:           parameterId: input.parameterId,
490:       draftId: existing?.draftId ?? `draft:${this.id()}`,
495:       restoredFromRevisionId: existing?.restoredFromRevisionId ?? null,
496:       sourceRevisionId: existing?.sourceRevisionId ?? null,
497:       requirementRevisionId: session.snapshot.project.activeRequirementRevisionId,
507:         existing?.restoredFromRevisionId !== null && existing?.restoredFromRevisionId !== undefined,
526:   async preview(sessionId: string, baseToken: string, draftToken: string): Promise<ChangeResult<ChangePreviewValue>> {
527:     const found = this.requireSession(sessionId)
530:     const state = this.stateOf(sessionId)
552:     const revisionId = `rev-d-${this.id()}`
558:         { revisionId, now: this.nowIso() },
571:     const previewId = `preview:${this.id()}`
576:       activeRequirementRevisionId: session.snapshot.project.activeRequirementRevisionId,
579:         draftId: draft.draftId,
584:       baseRevisionId: session.snapshot.project.currentRevisionId,
588:       checkId: `check-d-${revisionId}`,
600:       revisionId,
601:       analysisSnapshotId: `snapshot-d-${revisionId}`,
604:       restoredFromRevisionId: draft.restoredFromRevisionId,
610:     const previewToken = stableFingerprint({
611:       previewId,
614:       revisionId,
616:       drawingId: computation.drawing.record.drawingId,
618:         revisionId: check.requirementRevisionId,
620:         fingerprint: check.inputFingerprint,
624:     state.previews.set(previewId, {
625:       previewId,
629:       draftId: draft.draftId,
631:       revisionId,
640:       previewId,
644:       revisionId,
652:       affectedTermIds: computation.affectedTermIds,
653:       unboundTermIds: computation.unboundTermIds,
678:     const revisionId = checkValue.check.requirementRevisionId
680:       revisionId === null
683:             (item) => item.revisionId === revisionId,
695:   private enqueue<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
696:     const previous = this.queues.get(sessionId) ?? Promise.resolve()
699:       sessionId,
709:     sessionId: string
712:     previewId: string
714:     requestId: string
717:     return this.enqueue(request.sessionId, async () => {
718:       const found = this.requireSession(request.sessionId)
721:       const state = this.stateOf(session.sessionId)
722:       const committed = state.committed.get(request.requestId)
750:       const preview = state.previews.get(request.previewId)
758:         preview.draftId !== draft.draftId ||
771:           draftId: draft.draftId,
777:         activeRequirementRevisionId: session.snapshot.project.activeRequirementRevisionId,
781:         baseRevisionId: session.snapshot.project.currentRevisionId,
785:         checkId: `check-commit-${preview.revisionId}`,
786:         revisionId: preview.revisionId,
787:         analysisSnapshotId: `snapshot-d-${preview.revisionId}`,
789:         restoredFromRevisionId: draft.restoredFromRevisionId,
813:       let overwriteFingerprint: string | null = null
829:         overwriteFingerprint = existing
850:       const committedResult = await this.deps.projectService.commitCandidate(session.sessionId, {
854:         overwriteFingerprint,
875:       const current = this.deps.projectService.getSession(session.sessionId)
880:       await this.deps.recovery.discard(current.sessionId)
883:         revisionId: preview.revisionId,
889:         analysisSnapshotId: candidate.analysisSnapshot.id,
893:       state.committed.set(request.requestId, value)
902:   async bind(sessionId: string, request: ChangeBindRequest): Promise<ChangeResult<ChangeDraftValue>> {
903:     const found = this.requireSession(sessionId)
909:     if (request.partId !== SPACER_PART_ID) {
912:     const state = this.stateOf(sessionId)
914:     const parameter = draft.parameters.find((item) => item.parameterId === request.parameterId)
916:       return failure('INVALID_BINDING', '参数不存在', request.parameterId)
918:     if (parameter.partId !== request.partId) {
921:     if (!session.snapshot.project.dimensionChain.terms.some((term) => term.id === request.termId)) {
922:       return failure('INVALID_BINDING', '组成环不存在', request.termId)
924:     const existing = draft.bindings.find((binding) => binding.termId === request.termId)
926:       if (existing.parameterId === request.parameterId && existing.partId === request.partId) {
933:       if (request.replaceBindingId !== existing.bindingId) {
936:           '该组成环已绑定参数；替换必须显式给出旧 bindingId',
937:           existing.bindingId,
943:       bindingId: existing?.bindingId ?? `binding:${this.id()}`,
944:       termId: request.termId,
945:       partId: request.partId,
946:       parameterId: request.parameterId,
951:       ...draft.bindings.filter((item) => item.termId !== request.termId),
963:   async unbind(sessionId: string, request: ChangeUnbindRequest): Promise<ChangeResult<ChangeDraftValue>> {
964:     const found = this.requireSession(sessionId)
970:     const state = this.stateOf(sessionId)
972:     if (!draft.bindings.some((binding) => binding.bindingId === request.bindingId)) {
973:       return failure('INVALID_BINDING', '绑定不存在', request.bindingId)
975:     draft.bindings = draft.bindings.filter((binding) => binding.bindingId !== request.bindingId)
982:   async restore(sessionId: string, request: ChangeRestoreRequest): Promise<ChangeResult<ChangeRestoreValue>> {
983:     const found = this.requireSession(sessionId)
986:     const state = this.stateOf(sessionId)
999:       (revision) => revision.revisionId === request.sourceRevisionId,
1002:       return failure('NOT_FOUND', '来源版本不存在', request.sourceRevisionId)
1038:       draftId: `draft:${this.id()}`,
1042:       reason: request.reason.trim() || `从版本 ${request.sourceRevisionId} 恢复`,
1043:       restoredFromRevisionId: request.sourceRevisionId,
1044:       sourceRevisionId: request.sourceRevisionId,
1045:       requirementRevisionId: session.snapshot.project.activeRequirementRevisionId,
1054:         draftId: draft.draftId,
1058:         restoredFromRevisionId: request.sourceRevisionId,
1067:   async compare(sessionId: string, request: ChangeCompareRequest): Promise<ChangeResult<ChangeCompareValueResponse>> {
1068:     const found = this.requireSession(sessionId)
1075:       const state = this.stateOf(sessionId)
1084:           projectId: snapshot.project.id,
1085:           revisionId: `compare-draft-${state.draft.draftRevision}`,
1086:           drawingId: snapshot.project.drawings[0]?.drawingId ?? `drawing:${snapshot.project.id}:spacer`,
1102:     const leftRevisionId = request.leftRevisionId ?? snapshot.project.currentRevisionId
1104:       (revision) => revision.revisionId === leftRevisionId,
1107:       return failure('NOT_FOUND', '左图版本不存在', leftRevisionId)
1123:           revisionId: right.revisionId,
1124:           drawingId: right.drawingId,
1128:         }, `版本 ${leftRevisionId} 没有图纸记录`),
1136:           revisionId: right.revisionId,
1137:           drawingId: right.drawingId,
1141:         }, `版本 ${leftRevisionId} 缺少隔套参数，不能重建旧图`),
1145:       drawingId: leftRecord.drawingId,
1146:       partId: leftRecord.partId,
1147:       templateId: leftRecord.templateId,
1150:       projectId: leftProject.id,
1151:       revisionId: leftRecord.revisionId,
1153:         parameterId: parameter.parameterId,
1154:         partId: parameter.partId,
1164:     const rebuiltLeft = rebuildFromGenerationInput(input, leftRecord.dataFingerprint)
1167:       revisionId: right.revisionId,
1168:       drawingId: right.drawingId,
1176:         value: compareDrawings(null, rightSide, `${rebuiltLeft.reason}（版本 ${leftRevisionId}）`),
1183:           label: `版本 ${leftRevisionId}`,
1184:           revisionId: leftRevisionId,
1185:           drawingId: rebuiltLeft.data.drawingId,
1203:     sessionId: string,
1206:     const found = this.requireSession(sessionId)
1216:     const state = this.stateOf(sessionId)
1232:         requirementId: request.edit.requirementId,
1238:           documentId: request.edit.source.documentId,
1239:           revisionId: request.edit.source.revisionId,
1265:         activeRequirementRevisionId: session.snapshot.project.activeRequirementRevisionId,
1276:     sessionId: string,
1279:     return this.enqueue(sessionId, async () => {
1280:       const found = this.requireSession(sessionId)
1283:       const state = this.stateOf(sessionId)
1299:       const newRequirementId = `req-${this.id()}`
1300:       const newRevisionId = `reqrev-${this.id()}`
1301:       const newCheckId = `check-req-${this.id()}`
1302:       const newConfigRevisionId = `rev-req-${this.id()}`
1307:         expectedActiveRequirementRevisionId: request.expectedActiveRequirementRevisionId,
1308:         requirementId: request.requirementId,
1309:         newRequirementId,
1310:         newRevisionId,
1311:         newCheckId,
1312:         newConfigRevisionId,
1318:           projectId: session.snapshot.project.id,
1336:       let overwriteFingerprint: string | null = null
1352:         overwriteFingerprint = existing
1358:       const expectedActive = session.snapshot.project.activeRequirementRevisionId
1367:         if (session.snapshot.project.activeRequirementRevisionId !== expectedActive) {
1376:       const committedResult = await this.deps.projectService.commitCandidate(session.sessionId, {
1380:         overwriteFingerprint,
1397:       const current = this.deps.projectService.getSession(session.sessionId)
1401:       await this.deps.recovery.discard(current.sessionId)
1408:         requirementId: confirmed.value.revision.requirementId,
1409:         requirementRevisionId: confirmed.value.revision.revisionId,
1410:         configRevisionId: newConfigRevisionId,
1424:   resetSession(sessionId: string): void {
1425:     this.states.delete(sessionId)
1426:     this.queues.delete(sessionId)
```

### desktop/main/channels.ts

```text
29: import { sha256Hex } from '../../src/sources/hash'
49:     .object({ recentId: z.string().min(1).max(120).optional() })
53:       sessionId: z.string().min(1).max(200),
60:       sessionId: z.string().min(1).max(200),
62:       expectedFingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
67:       sessionId: z.string().min(1).max(200),
71:   relinkRecent: z.object({ recentId: z.string().min(1).max(120) }).strict(),
72:   restoreRecovery: z.object({ recoveryId: z.string().min(1).max(120) }).strict(),
75:       sessionId: z.string().min(1).max(200),
76:       // revisionId 只是内存聚合里的键，不允许任何路径形态；含分隔符/空字节
78:       revisionId: z
89:           { message: 'revisionId 不能是路径' },
94:     .object({ sessionId: z.string().min(1).max(200) })
106:   pickOpenPath: (windowId: number) => Promise<string | null>
108:   pickRelinkPath: (windowId: number) => Promise<string | null>
129:   windowId: number,
130:   sessionId: string,
132:   const active = controller.sessionIdFor(windowId)
133:   if (active === null || active !== sessionId) {
136:   const session = controller.sessionFor(windowId)
180:   sha256: string
198:   revisionId: string,
200:   const current = snapshot.revisions.find((revision) => revision.id === revisionId)
203:       id: current.id,
205:       sha256: current.sha256,
218:     if (record === null || record.id !== revisionId) {
221:     const { fileName, sha256, byteSize, blobKey } = record
224:       typeof sha256 !== 'string' ||
233:     return { id: revisionId, fileName, sha256, byteSize, blobKey, origin: 'legacy-archive' }
241:   windowId: number,
245:   const result = await controller.withGate(windowId, purpose, async (decision) => ({
265:     projectId: session.snapshot.project.id,
286:         const windowId = sender.webContentsId
287:         return gated(controller, windowId, 'new', async () => {
298:           await controller.attach(windowId, opened.value.sessionId)
299:           const session = controller.sessionFor(windowId)
317:         const windowId = sender.webContentsId
319:         if (params.recentId !== undefined) {
320:           const record = await recent.get(params.recentId)
326:           const picked = await deps.pickOpenPath(windowId)
340:         return gated(controller, windowId, 'open', async () => {
350:           await controller.attach(windowId, opened.value.sessionId)
351:           const session = controller.sessionFor(windowId)
370:         const windowId = sender.webContentsId
371:         const session = requireActive(controller, windowId, params.sessionId)
376:           session.sessionId,
383:         const current = projectService.getSession(session.sessionId)
388:           session.sessionId,
412:         const windowId = sender.webContentsId
413:         const session = requireActive(controller, windowId, params.sessionId)
434:         const saved = await projectService.save(session.sessionId, {
436:           expectedFingerprint: params.expectedFingerprint,
454:         const windowId = sender.webContentsId
455:         const session = requireActive(controller, windowId, params.sessionId)
468:         const saved = await projectService.saveAs(session.sessionId, {
470:           expectedFingerprint: null,
472:           overwriteFingerprint: existing,
506:         const windowId = sender.webContentsId
507:         const record = await recent.get(params.recentId)
511:         const picked = await deps.pickRelinkPath(windowId)
522:           recentId: params.recentId,
524:           projectId: decoded.value.snapshot.project.id,
558:         const windowId = sender.webContentsId
559:         const draft = await recovery.readDraft(params.recoveryId)
563:         return gated(controller, windowId, 'restore', async () => {
569:           await controller.attach(windowId, opened.value.sessionId)
570:           const session = controller.sessionFor(windowId)
581:             session.sessionId,
586:           const flushed = await recovery.flush(session.sessionId)
605:         const session = controller.sessionFor(sender.webContentsId)
610:           sessionId: session.sessionId,
616:           recovery: recovery.stateOf(session.sessionId),
629:         const windowId = sender.webContentsId
630:         const session = requireActive(controller, windowId, params.sessionId)
631:         const revision = resolveSourceRevision(session.snapshot, params.revisionId)
636:             `revisionId=${params.revisionId}`,
657:           (item) => item.revisionId === revision.id && item.blobKey === revision.blobKey,
670:             `revisionId=${revision.id}, blobKey=${revision.blobKey}`,
683:         const digest = await sha256Hex(bytes)
684:         if (digest !== revision.sha256) {
688:             `declared=${revision.sha256}, actual=${digest}`,
691:         return { bytes, sha256: digest, fileName: revision.fileName }
703:         const windowId = sender.webContentsId
704:         const session = requireActive(controller, windowId, params.sessionId)
```

### desktop/main/closeGuard.ts

```text
16:   newRequestId?: () => string
18:   sendFlush: (webContentsId: number, payload: EditorFlushRequest) => void
32:   private readonly newRequestId: () => string
36:     { webContentsId: number; finish: (outcome: FlushOutcome) => void; timer: NodeJS.Timeout }
42:     this.newRequestId = options.newRequestId ?? (() => randomUUID())
47:   beginClose(webContentsId: number): boolean {
48:     if (this.closing.has(webContentsId)) {
51:     this.closing.add(webContentsId)
55:   endClose(webContentsId: number): void {
56:     this.closing.delete(webContentsId)
59:   isClosing(webContentsId: number): boolean {
60:     return this.closing.has(webContentsId)
64:   requestFlush(webContentsId: number): Promise<FlushOutcome> {
65:     const requestId = this.newRequestId()
68:         const entry = this.pending.get(requestId)
71:           this.pending.delete(requestId)
77:         const entry = this.pending.get(requestId)
81:         this.pending.delete(requestId)
87:             detail: `requestId=${requestId}`,
93:       this.pending.set(requestId, { webContentsId, finish, timer })
96:         this.sendFlush(webContentsId, { requestId })
113:    * 只接受“待处理 requestId + 同一 WebContents”；过期或伪造回复返回错误，
117:     webContentsId: number,
120:     const entry = this.pending.get(payload.requestId)
127:           detail: `requestId=${payload.requestId}`,
131:     if (entry.webContentsId !== webContentsId) {
157:     for (const [requestId, entry] of this.pending) {
164:           detail: `requestId=${requestId}`,
```

### desktop/main/drawingChannels.ts

```text
44:       sessionId: z.string().min(1).max(200),
46:       partId: idLike,
76:       sessionId: z.string().min(1).max(200),
78:       drawingId: idLike,
79:       drawingFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
92:     windowId: number,
97:   confirmOverwrite: (windowId: number, targetPath: string) => Promise<boolean>
141:     drawingId: data.drawingId,
143:     templateId: data.templateId,
145:     partId: data.partId,
146:     revisionId: data.revisionId,
147:     parameterIds: data.parameterSnapshot.map((item) => item.parameterId),
152:     dataFingerprint: data.fingerprint,
160:   function requireActive(windowId: number, sessionId: string) {
161:     if (deps.controller.sessionIdFor(windowId) !== sessionId) {
164:     const session = deps.projectService.getSession(sessionId)
172:     projectId: string,
175:     revisionId: string,
179:         projectId,
180:         revisionId,
181:         drawingId: record.drawingId,
197:         const windowId = sender.webContentsId
198:         const session = requireActive(windowId, params.sessionId)
199:         if (params.partId !== SPACER_PART_ID) {
200:           reject('INVALID_PARAMETER', '只支持隔套部件', params.partId)
218:         const drawingId = `drawing:${project.id}:spacer`
230:             projectId: project.id,
231:             revisionId: project.currentRevisionId,
232:             drawingId,
241:           project.parameters.map((item) => [item.parameterId, item.parameterRevision]),
246:           parameterRevision: previous.get(item.parameterId) ?? 1,
250:           session.sessionId,
258:         const current = deps.projectService.getSession(session.sessionId)
263:           session.sessionId,
270:           drawingId,
271:           drawingFingerprint: data.fingerprint,
284:     windowId: number,
288:     const session = requireActive(windowId, params.sessionId)
296:     if (busySessions.has(session.sessionId)) {
300:     const record = project.drawings.find((item) => item.drawingId === params.drawingId)
304:     if (record.dataFingerprint !== params.drawingFingerprint) {
307:     const data = rebuildAuthoritative(project.id, record, project.parameters, record.revisionId)
308:     if (data.fingerprint !== params.drawingFingerprint) {
338:     busySessions.add(session.sessionId)
346:         windowId,
355:         const confirmed = await deps.confirmOverwrite(windowId, target)
383:         expectedFingerprint: existing,
408:         sha256: saved.value.fingerprint,
409:         drawingId: data.drawingId,
410:         drawingFingerprint: data.fingerprint,
413:       busySessions.delete(session.sessionId)
422:       handle: async ({ sender }, params) => exportDrawing(sender.webContentsId, 'pdf', params),
432:       handle: async ({ sender }, params) => exportDrawing(sender.webContentsId, 'svg', params),
442:       handle: async ({ sender }, params) => exportDrawing(sender.webContentsId, 'dxf-r12', params),
452:       handle: async ({ sender }, params) => exportDrawing(sender.webContentsId, 'dxf-2000', params),
```

### desktop/main/drawingExportStore.ts

```text
12: import { nodeFileOps, sha256Bytes, type FileOps, type SaveError } from './fileStore'
28:   expectedFingerprint: string | null
70:     return sha256Bytes(await this.ops.readFile(targetPath))
93:     const currentFingerprint =
94:       targetKind === 'file' ? await sha256Bytes(await ops.readFile(options.targetPath)) : null
95:     if (options.expectedFingerprint !== currentFingerprint) {
101:           detail: `expected=${options.expectedFingerprint ?? 'null'}, actual=${currentFingerprint ?? 'null'}`,
135:       const digest = await sha256Bytes(options.bytes)
136:       if ((await sha256Bytes(tempBytes)) !== digest) {
156:       const beforeFingerprint =
157:         beforeKind === 'file' ? await sha256Bytes(await ops.readFile(options.targetPath)) : null
158:       if (beforeFingerprint !== currentFingerprint) {
188:         if ((await sha256Bytes(committed)) !== digest) {
```

### desktop/main/drawingPdf.ts

```text
18:   drawingId: string
47:   drawingId: string
49:   svgFingerprint: string | null
102:         drawingId: options.drawingId,
133:     if (ready.drawingId !== options.drawingId || ready.fingerprint !== options.fingerprint) {
136:     if (ready.svgFingerprint !== options.fingerprint) {
```

### desktop/main/dxfChannels.ts

```text
23:   pickDxfPath: (windowId: number) => Promise<string | null>
44:         const target = await deps.pickDxfPath(sender.webContentsId)
```

### desktop/main/extractionChannels.ts

```text
6:  * blobKey、sha256、actor、decidedAt 或最终状态。
44:       sessionId: z.string().min(1).max(200),
46:       revisionId: idLike,
49:       requestId: requestIdSchema,
54:       sessionId: z.string().min(1).max(200),
56:       draftId: idLike,
57:       candidateId: idLike,
79:       sessionId: z.string().min(1).max(200),
80:       requestId: requestIdSchema,
85:       sessionId: z.string().min(1).max(200),
87:       draftId: idLike,
92:       sessionId: z.string().min(1).max(200),
94:       draftId: idLike,
95:       candidateIds: z.array(idLike).min(1).max(200),
100:       sessionId: z.string().min(1).max(200),
102:       draftId: idLike,
103:       candidateIds: z.array(idLike).min(1).max(200),
109:       sessionId: z.string().min(1).max(200),
111:       draftId: idLike,
112:       batchId: idLike.optional(),
113:       candidateId: idLike.optional(),
118:         (value.batchId === undefined) !== (value.candidateId === undefined),
119:       { message: 'batchId 与 candidateId 必须二选一' },
127:   issuePlanToken?: (windowId: number, draftId: string) => Promise<string | null>
146:   function requireActive(windowId: number, sessionId: string): void {
147:     if (deps.controller.sessionIdFor(windowId) !== sessionId) {
158:         requireActive(sender.webContentsId, params.sessionId)
159:         return unwrap(await deps.service.run(sender.webContentsId, params))
171:         requireActive(sender.webContentsId, params.sessionId)
174:           const token = await deps.issuePlanToken(sender.webContentsId, params.draftId)
190:         requireActive(sender.webContentsId, params.sessionId)
191:         return unwrap(deps.service.cancel(sender.webContentsId, params))
203:         requireActive(sender.webContentsId, params.sessionId)
216:         requireActive(sender.webContentsId, params.sessionId)
229:         requireActive(sender.webContentsId, params.sessionId)
242:         requireActive(sender.webContentsId, params.sessionId)
```

### desktop/main/extractionService.ts

```text
5:  * 1. 只读“确切 PDF 版本”：revisionId 必须存在于当前会话快照，main 从版本记录
36: import { sha256Hex } from '../../src/sources/hash'
135:   sessionId: string
178:   private enqueue<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
179:     const previous = this.chains.get(sessionId) ?? Promise.resolve()
182:       sessionId,
188:   cancel(windowId: number, request: ExtractionCancelRequest): IpcResult<ExtractionCancelValue> {
189:     const active = this.running.get(windowId)
190:     if (active !== request.requestId) {
193:     const token = this.tokens.get(request.requestId)
194:     if (token === undefined || token.sessionId !== request.sessionId) {
202:     windowId: number,
207:     if (this.running.has(windowId)) {
210:     return this.enqueue(request.sessionId, () => this.runInner(windowId, request))
214:     windowId: number,
217:     const session = this.deps.controller.sessionFor(windowId)
218:     if (session === null || session.sessionId !== request.sessionId) {
228:     if (this.running.has(windowId)) {
243:     const revision = session.snapshot.revisions.find((item) => item.id === request.revisionId)
248:         `revisionId=${request.revisionId}`,
265:         `revisionId=${revision.id}`,
269:     const digest = await sha256Hex(bytes)
270:     if (digest !== revision.sha256) {
274:         `declared=${revision.sha256}, actual=${digest}`,
278:     const token: CancelToken = { sessionId: session.sessionId, cancelled: false }
279:     this.tokens.set(request.requestId, token)
280:     this.running.set(windowId, request.requestId)
306:       this.running.delete(windowId)
307:       this.tokens.delete(request.requestId)
315:       projectId: session.snapshot.project.id,
317:       baseToken: `base-${session.snapshot.project.id}`,
319:         documentId: revision.documentId,
320:         revisionId: revision.id,
321:         sha256: revision.sha256,
362:       if (existing.sourceIdentity.documentId !== incoming.sourceIdentity.documentId) {
388:           draftId: nextDraft.draftId,
394:           recovery: this.deps.recovery.stateOf(session.sessionId),
407:       session.sessionId,
414:       draftId: nextDraft.draftId,
427:     return this.enqueue(request.sessionId, () => this.decideInner(request))
433:     const found = this.deps.projectService.getSession(request.sessionId)
446:     const draft = drafts.find((item) => item.draftId === request.draftId)
448:       return failure('NOT_FOUND', '提取草稿不存在或已被替换', `draftId=${request.draftId}`)
456:         `draftId=${draft.draftId}, extractorVersion=${draft.extractorVersion}`,
459:     const candidate = findCandidate(draft, request.candidateId)
461:       return failure('NOT_FOUND', '候选不存在', `candidateId=${request.candidateId}`)
478:         candidateId: request.candidateId,
494:         candidateId: request.candidateId,
506:         candidateId: request.candidateId,
537:         candidateId: request.candidateId,
558:           extractionDrafts: drafts.map((item) => (item.draftId === updated.draftId ? updated : item)),
560:     const nextCandidate = findCandidate(updated, request.candidateId)
562:       .filter((item) => item.candidateId === request.candidateId)
566:     let recovery = this.deps.recovery.stateOf(session.sessionId)
572:         session.sessionId,
580:         draftId: updated.draftId,
581:         candidateId: request.candidateId,
583:         decisionId: decision?.decisionId ?? null,
594:         draftId: updated.draftId,
595:         candidateId: request.candidateId,
597:         decisionId: decision?.decisionId ?? null,
627:           item.draftId === updated.draftId ? updated : item,
652:         session.sessionId,
676:   /** 批量结果的逐条回执：每条候选自己的 decisionId 与动作后状态。 */
679:     candidateIds: readonly string[],
682:     return candidateIds.map((candidateId) => {
683:       const candidate = findCandidate(draft, candidateId)
685:         .filter((item) => item.candidateId === candidateId && item.decidedAt === decidedAt)
688:         candidateId,
689:         decisionId: decision?.decisionId ?? '',
699:     return this.enqueue(request.sessionId, () => this.confirmBatchInner(request))
705:     const session = this.deps.projectService.getSession(request.sessionId)
715:     const draft = drafts.find((item) => item.draftId === request.draftId)
725:       candidateIds: request.candidateIds,
735:       draftId: result.value.draft.draftId,
736:       candidateIds: [...result.value.candidateIds],
737:       decisions: this.batchDecisions(result.value.draft, result.value.candidateIds, decidedAt),
749:     return this.enqueue(request.sessionId, () => this.attestUnitsInner(request))
755:     const session = this.deps.projectService.getSession(request.sessionId)
765:     const draft = drafts.find((item) => item.draftId === request.draftId)
775:     const actorId = project.actorId ?? EXTRACTION_ACTOR
777:     // 面板的一次提交就是一轮输入：turnId 由 main 生成（renderer/模型不能提供），
779:     const turnId = `extraction-panel-${sessionSeq}`
782:       candidateIds: request.candidateIds,
784:       actor: actorId,
788:       turnId,
798:       draftId: result.value.draft.draftId,
799:       batchId: result.value.batchId,
801:       candidateIds: [...result.value.candidateIds],
802:       decisions: this.batchDecisions(result.value.draft, result.value.candidateIds, decidedAt),
814:     return this.enqueue(request.sessionId, () => this.revokeUnitsInner(request))
820:     const session = this.deps.projectService.getSession(request.sessionId)
830:     const draft = drafts.find((item) => item.draftId === request.draftId)
837:       batchId: request.batchId ?? null,
838:       candidateId: request.candidateId ?? null,
846:       result.value.candidateIds.map((candidateId) => `candidate:${candidateId}:unit`),
871:       draftId: result.value.draft.draftId,
872:       candidateIds: [...result.value.candidateIds],
873:       decisions: this.batchDecisions(result.value.draft, result.value.candidateIds, decidedAt),
892:     return this.enqueue(request.sessionId, () => this.deleteDraftInner(request))
898:     const session = this.deps.projectService.getSession(request.sessionId)
910:     const draft = drafts.find((item) => item.draftId === request.draftId)
912:       return failure('NOT_FOUND', '提取草稿不存在或已被删除', `draftId=${request.draftId}`)
918:         `draftId=${draft.draftId}, extractorVersion=${draft.extractorVersion}`,
922:     const nextDrafts = drafts.filter((item) => item.draftId !== draft.draftId)
951:         session.sessionId,
969:       draftId: draft.draftId,
980:     const document = snapshot.documents.find((item) => item.id === revision.documentId)
981:     return document !== undefined && document.latestRevisionId !== revision.id
985:   static revisionOf(snapshot: ProjectFileSnapshot, revisionId: string): SourceRevision | null {
986:     return snapshot.revisions.find((item) => item.id === revisionId) ?? null
```

### desktop/main/fileStore.ts

```text
171: export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
172:   return createHash('sha256').update(bytes).digest('hex')
184:   expectedFingerprint: string | null
246:     return { ok: true, value: { bytes, fingerprint: await sha256Bytes(bytes) } }
254:     return sha256Bytes(await this.ops.readFile(targetPath))
300:     let currentFingerprint: string | null = null
303:         currentFingerprint = await sha256Bytes(await ops.readFile(targetPath))
315:     if (options.expectedFingerprint !== currentFingerprint) {
322:             currentFingerprint === null
324:               : `期望 ${options.expectedFingerprint ?? '不存在'}，实际 ${currentFingerprint}`,
352:       const expectedDigest = await sha256Bytes(options.bytes)
353:       if ((await sha256Bytes(tempBytes)) !== expectedDigest) {
372:       let beforeRenameFingerprint: string | null = null
375:         beforeRenameFingerprint = await sha256Bytes(await ops.readFile(targetPath))
377:       if (beforeRenameFingerprint !== currentFingerprint) {
405:         if ((await sha256Bytes(committedBytes)) !== expectedDigest) {
```

### desktop/main/index.ts

```text
94:   sendFlush: (webContentsId, payload) => {
95:     const target = webContents.fromId(webContentsId)
104:   const outcome = await closeGuard.requestFlush(window.webContents.id)
122:     onClosed: (webContentsId) => {
123:       windows.delete(webContentsId)
126:   const webContentsId = handle.window.webContents.id
127:   windows.set(webContentsId, handle)
136:     void withCloseGate(webContentsId, 'close').then((result) => {
328:     defaultId: 0,
329:     cancelId: 2,
362: async function pickModelFileFor(windowId: number): Promise<string | null> {
363:   const owner = BrowserWindow.fromId(windowId) ?? BrowserWindow.getFocusedWindow()
379: async function pickSourcePdfFor(windowId: number): Promise<string | null> {
380:   const owner = BrowserWindow.fromId(windowId) ?? BrowserWindow.getFocusedWindow()
398:   windowId: number,
402:   const owner = BrowserWindow.fromId(windowId) ?? BrowserWindow.getFocusedWindow()
431: async function confirmDrawingOverwrite(windowId: number, targetPath: string): Promise<boolean> {
432:   const owner = BrowserWindow.fromId(windowId) ?? BrowserWindow.getFocusedWindow()
438:     defaultId: 1,
439:     cancelId: 1,
454:     defaultId: 1,
455:     cancelId: 1,
501:     drawingId: data.drawingId,
521:       flushEditor: async (windowId) => {
522:         const handle = windows.get(windowId)
606:       pickTarget: (windowId, suggestedName) => pickDrawingExportPath(
607:         windowId,
612:       renderPdf: async (_windowId, _svg, drawing) => printDrawingPdf(drawing),
623:     emit: (windowId, view) => {
624:       const handle = windows.get(windowId)
664:     issuePlanToken: (windowId, draftId) => agentTools.issueAfterDecision(windowId, draftId),
673:     dirtyGateDetailed: async (windowId) => {
674:       const result = await controller.withGate(windowId, 'migrate', async () => ({
690:         migrationService.inspect(sender.webContentsId, params),
702:           projectId: z.string().min(1).max(240),
706:         const value = await migrationService.commit(sender.webContentsId, params)
708:         await controller.attach(sender.webContentsId, value.sessionId)
720:         .object({ sessionId: z.string().min(1).max(200).optional() })
723:         const handle = windows.get(sender.webContentsId)
727:         const result = await withCloseGate(sender.webContentsId, 'close')
748:           requestId: z.string().min(1).max(200),
749:           sessionId: z.string().min(1).max(200).optional(),
754:         const session = controller.sessionFor(sender.webContentsId)
758:             payload.sessionId !== undefined &&
759:             payload.sessionId !== session.sessionId
777:         const verdict = closeGuard.acceptFlushed(sender.webContentsId, payload)
796:   webContentsId: number,
799:   return runCloseGate(controllerForClose, webContentsId, purpose)
859:         const id = window.webContents.id
```

### desktop/main/ingestReadings.ts

```text
5: import { stableId } from '../../src/document-extraction/ids'
6: import { intentDraftOf, validateActorId } from './intentProject'
12:   projectId: id.optional(), draftId: id.optional(),
14:     z.object({ kind: z.literal('pdf-page'), revisionId: id, sha256: sha, page: z.number().int().positive() }).strict(),
15:     z.object({ kind: z.literal('image'), imageId: id, sha256: sha }).strict(),
21: }).strict().refine((v) => v.projectId !== undefined || v.draftId !== undefined)
25:   context: { userText: string; turnId: string; at: string; actorId?: string }) {
28:   if (!parsed.success) return fail('INVALID_INPUT', '读数参数不合法（需 projectId 或 draftId、source、statement、整数 q 读数）')
32:   if (input.projectId !== undefined && input.projectId !== project.id) return fail('INVALID_INPUT', '项目不匹配')
33:   const actor = validateActorId(project.actorId ?? context.actorId)
37:   const revision = snapshot.revisions.find((r) => r.id === source.revisionId)
39:   if (!revision || revision.sha256 !== source.sha256 || source.page > revision.pageCount ||
40:     !attachment || createHash('sha256').update(attachment.bytes).digest('hex') !== source.sha256) return fail('SOURCE_CHANGED', '读数来源页不存在、越界或哈希不一致')
41:   let draft = input.draftId === undefined ? intentDraftOf(project) : project.extractionDrafts.find((d) => d.draftId === input.draftId)
42:   if (input.draftId !== undefined && draft == null) return fail('INVALID_INPUT', '读数草稿不存在')
44:     const draftId = stableId('readings', [project.id, revision.id])
45:     draft = project.extractionDrafts.find((d) => d.draftId === draftId) ?? {
46:       draftId, draftRevision: 1, status: 'draft' as const, projectId: project.id,
47:       baseToken: project.currentRevisionId,
48:       sourceIdentity: { documentId: revision.documentId, revisionId: revision.id, sha256: revision.sha256,
51:       idempotencyKey: stableId('readings-key', [project.id, revision.id]), candidates: [], issues: [], decisions: [],
54:   const result = ingestReadings(draft, { ...input, actorId: actor.value,
55:     sessionSeq: Math.max(1, project.sessionSeq), at: context.at, turnId: context.turnId, modelId: null })
58:   return { ok: true as const, snapshot: { ...snapshot, project: { ...project, actorId: actor.value,
60:     extractionDrafts: [...project.extractionDrafts.filter((d) => d.draftId !== nextDraft.draftId), nextDraft] } },
62:       draftId: nextDraft.draftId, candidates: nextDraft.candidates.filter((c) => c.kind === 'ring' && input.readings.some((r) => r.symbol === c.data.symbol)) } }
```

### desktop/main/intentProject.ts

```text
15:   intentDraftId,
35:   readonly actorId: string
50: export function validateActorId(value: unknown): { ok: true; value: string } | { ok: false; message: string } {
97:   readonly newId?: () => string
110:   const newId = options.newId ?? (() => randomUUID())
117:     newId,
121:     actorId: options.identity.actorId,
126:     projectId: base.project.id,
128:     turn: { userText: '', turnId: 'create-project', at: createdAt },
133:     actorId: session.actorId,
152: /** 把一个空白的新建项目就地转成无任务书项目（保持 projectId，不切会话）。 */
163:     actorId: options.identity.actorId,
168:     projectId: project.id,
170:     turn: { userText: '', turnId: 'create-project', at: now },
176:     actorId: session.actorId,
191:       revision.revisionId === snapshot.project.currentRevisionId
199:   return project.extractionDrafts.find((draft) => draft.draftId === intentDraftId(project.id)) ?? null
202: function nextSessionSeq(project: ProjectFileProject, turnId: string): number {
206:   return last.turnId !== turnId ? current + 1 : current
247:   if (project.sourceKind !== 'user-intent' || project.actorId === null) {
254:   const sessionSeq = nextSessionSeq(project, input.turn.turnId)
256:     actorId: project.actorId,
324:       item.draftId === nextDraft.draftId ? nextDraft : item,
```

### desktop/main/ipc.ts

```text
63:     webContentsId: sender.id,
```

### desktop/main/migrationBackup.ts

```text
14: import { sha256Bytes, type FileOps } from './fileStore'
32:   sha256: string
45:   expectedFingerprint: string | null
94:   const sha256 = await sha256Bytes(bytes)
95:   if (options.expectedFingerprint !== null && sha256 !== options.expectedFingerprint) {
101:         detail: `expected=${options.expectedFingerprint}, actual=${sha256}`,
147:     const readBackSha = await sha256Bytes(readBack)
148:     if (readBackSha !== sha256 || readBack.byteLength !== bytes.byteLength) {
154:           detail: `source=${sha256}, backup=${readBackSha}`,
176:       sha256,
185:   return `迁移前已创建可恢复副本：${record.backupPath}（SHA-256 ${record.sha256}，${record.byteSize} 字节），原文件 ${record.originalPath}。`
```

### desktop/main/migrationService.ts

```text
62:   projectId: string
76:   dirtyGate?: (windowId: number) => Promise<'proceed' | 'cancel'>
82:     windowId: number,
92:   windowId: number
125:     windowId: number,
157:       windowId,
171:         id: project.id,
182:     windowId: number,
186:     if (token === undefined || token.windowId !== windowId) {
194:       (project) => project.id === request.projectId,
201:       const verdict = await this.deps.dirtyGateDetailed(windowId)
210:       const verdict = await this.deps.dirtyGate(windowId)
229:             { bytes: token.bytes, projectId: request.projectId },
242:     if (migrated.value.snapshot.project.id !== request.projectId) {
251:     const expectedProjectId = migrated.value.snapshot.project.id
256:       expectedFingerprint: null,
267:         if (decoded.value.snapshot.project.id !== expectedProjectId) {
```

### desktop/main/modelAdapter.ts

```text
40:     this.id = id
55:     this.cancelled.delete(request.taskId)
67:         // 取消只作为提示；在途回包仍会到达，由调度层按 taskId+projectId 与取消标志丢弃。
91:   cancel(taskId: string): void {
92:     this.cancelled.add(taskId)
100:     this.adapters.set(adapter.id, adapter)
```

### desktop/main/modelChannels.ts

```text
8:  * - commit 由 main 用共享纯解析器重新校验并自算 sha256/面数/包围盒；
34: import { sha256Hex } from '../../src/sources/hash'
55:   windowId: number
56:   sessionId: string
58:   replacePartId: string | null
61:   sha256: string
69:       sessionId: z.string().min(1).max(200),
71:       replacePartId: z.string().min(1).max(240).optional(),
76:       sessionId: z.string().min(1).max(200),
80:           .object({ kind: z.literal('revision'), modelRevisionId: z.string().min(1).max(240) })
87:       sessionId: z.string().min(1).max(200),
90:       expectedCurrentModelRevisionId: z.string().min(1).max(240).nullable(),
97:       sessionId: z.string().min(1).max(200),
103:       sessionId: z.string().min(1).max(200),
106:       linkId: z.string().min(1).max(240).optional(),
107:       termId: z.string().min(1).max(240),
111:           partId: z.string().min(1).max(240),
112:           modelRevisionId: z.string().min(1).max(240).nullable(),
115:       expectedCurrentModelRevisionId: z.string().min(1).max(240).nullable(),
126:   pickModelPath: (windowId: number) => Promise<string | null>
130:   newId?: () => string
139:   windowId: number,
140:   sessionId: string,
142:   const active = controller.sessionIdFor(windowId)
143:   if (active === null || active !== sessionId) {
146:   const session = controller.sessionFor(windowId)
160:   private readonly newId: () => string
162:   constructor(now: () => number, newId: () => string = () => randomUUID()) {
164:     this.newId = newId
170:       if (item.windowId === input.windowId && item.sessionId === input.sessionId) {
176:       token: this.newId(),
183:   get(token: string, windowId: number, sessionId: string): Candidate | null {
186:     if (item.windowId !== windowId || item.sessionId !== sessionId) return null
195:   take(token: string, windowId: number, sessionId: string): Candidate | null {
196:     const item = this.get(token, windowId, sessionId)
200:   release(token: string, windowId: number, sessionId: string): boolean {
202:     if (item === undefined || item.windowId !== windowId || item.sessionId !== sessionId) {
209:   clearSession(sessionId: string): void {
211:       if (item.sessionId === sessionId) this.items.delete(token)
224:   const newId = deps.newId ?? (() => randomUUID())
225:   const candidates = new ModelCandidates(now, newId)
233:       session.sessionId,
249:         const windowId = sender.webContentsId
250:         const session = requireSession(controller, windowId, params.sessionId)
258:         if (params.replacePartId !== undefined) {
260:             (item) => item.partId === params.replacePartId,
263:             reject('INVALID_REQUEST', '要替换的部件不存在', params.replacePartId)
266:         const picked = await deps.pickModelPath(windowId)
310:         const digest = await sha256Hex(bytes)
312:           windowId,
313:           sessionId: session.sessionId,
315:           replacePartId: params.replacePartId ?? null,
318:           sha256: digest,
325:           sha256: candidate.sha256,
338:         const windowId = sender.webContentsId
339:         const session = requireSession(controller, windowId, params.sessionId)
341:           const candidate = candidates.get(params.ref.token, windowId, session.sessionId)
350:             sha256: candidate.sha256,
360:           (item) => item.modelRevisionId === revisionRef.modelRevisionId,
363:           reject('ATTACHMENT_MISSING', '模型版本不存在或不属于当前项目', revisionRef.modelRevisionId)
379:         const digest = await sha256Hex(attachment.bytes)
389:           sha256: digest,
404:         const windowId = sender.webContentsId
405:         const session = requireSession(controller, windowId, params.sessionId)
406:         return { released: candidates.release(params.candidateToken, windowId, session.sessionId) }
418:         const windowId = sender.webContentsId
419:         const session = requireSession(controller, windowId, params.sessionId)
427:         const candidate = candidates.get(params.candidateToken, windowId, session.sessionId)
432:           candidate.replacePartId === null
435:                 (item) => item.partId === candidate.replacePartId,
437:         if (candidate.replacePartId !== null && existingPart === undefined) {
438:           reject('INVALID_REQUEST', '要替换的部件不存在', candidate.replacePartId)
440:         const currentModelRevisionId = existingPart?.currentModelRevisionId ?? null
441:         if (currentModelRevisionId !== params.expectedCurrentModelRevisionId) {
445:             `expected=${params.expectedCurrentModelRevisionId ?? 'null'}，current=${
446:               currentModelRevisionId ?? 'null'
457:         const partId = existingPart?.partId ?? `part-${newId()}`
458:         const modelRevisionId = `model-${newId()}`
460:           (blob) => blob.sha256 === candidate.sha256 && blob.byteSize === candidate.byteSize,
462:         const blobKey = existingBlob?.blobKey ?? `blob-${newId()}`
470:           modelRevisionId,
471:           partId,
473:           parentModelRevisionId: currentModelRevisionId,
478:           attachmentSha256: candidate.sha256,
490:               part.partId === partId
491:                 ? { ...part, currentModelRevisionId: modelRevisionId }
497:                 partId,
500:                 currentModelRevisionId: modelRevisionId,
508:           if (link.target.partId !== partId) return link
529:                   projectId: snapshot.project.id,
530:                   sha256: candidate.sha256,
561:         candidates.release(candidate.token, windowId, session.sessionId)
565:           modelRevisionId,
585:         const windowId = sender.webContentsId
586:         const session = requireSession(controller, windowId, params.sessionId)
596:           (item) => item.id === params.termId,
599:           reject('MISSING_REFERENCE', '组成环不存在', params.termId)
601:         const part = snapshot.project.parts.find((item) => item.partId === params.target.partId)
603:           reject('MISSING_REFERENCE', '部件不存在', params.target.partId)
605:         if (params.target.granularity === 'model' && params.target.modelRevisionId === null) {
608:         if (params.target.modelRevisionId !== null) {
610:             (item) => item.modelRevisionId === params.target.modelRevisionId,
612:           if (model === undefined || model.partId !== part.partId) {
613:             reject('MISSING_REFERENCE', '模型版本不属于该部件', params.target.modelRevisionId)
616:         if (part.currentModelRevisionId !== params.expectedCurrentModelRevisionId) {
620:             `expected=${params.expectedCurrentModelRevisionId ?? 'null'}，current=${
621:               part.currentModelRevisionId ?? 'null'
632:               linkId: `link-${newId()}`,
633:               termId: params.termId,
636:               reviewedModelRevisionId: params.target.modelRevisionId,
642:           if (params.linkId === undefined) {
643:             reject('INVALID_REQUEST', '核对新版需要给出 linkId')
646:             (item) => item.kind === 'visual-reference' && item.linkId === params.linkId,
649:             reject('MISSING_REFERENCE', '待核对的关联不存在', params.linkId)
654:           if (existing.target.partId !== params.target.partId) {
657:           if (params.target.modelRevisionId === null) {
661:             item.kind === 'visual-reference' && item.linkId === params.linkId
666:                   reviewedModelRevisionId: params.target.modelRevisionId,
```

### desktop/main/modelConfig.ts

```text
4:  * 存什么：adapterId / baseUrl / model / keySource / keyEnvVar，写到应用工作区的
8:  * - configured 只表示“adapterId、baseUrl、model 齐全且能取到密钥”，不代表连接可用；
10:  * - provider 只回显 `<adapterId>:<model>`，不含密钥、不含完整 URL 的路径。
21:   adapterId: string
31:   adapterId: OPENAI_COMPATIBLE_1,
46:   adapterId: string | null
111:         adapterId: typeof raw.adapterId === 'string' && raw.adapterId !== '' ? raw.adapterId : OPENAI_COMPATIBLE_1,
120:     this.keyPresent = (await this.deps.keychain.read(this.settings.adapterId)) !== null
129:       adapterId: this.settings.adapterId === '' ? OPENAI_COMPATIBLE_1 : this.settings.adapterId,
136:       await this.deps.keychain.write(next.adapterId, input.apiKey)
150:     await this.deps.keychain.remove(this.settings.adapterId)
157:     const fromKeychain = await this.deps.keychain.read(this.settings.adapterId)
175:       provider: usable ? `${this.settings.adapterId}:${this.settings.model}` : null,
176:       adapterId: usable ? this.settings.adapterId : null,
```

### desktop/main/newProject.ts

```text
30:   newId?: () => string
82:       id: item.id,
101:   const newId = options.newId ?? (() => randomUUID())
104:   const projectId = `project-${newId()}`
105:   const revisionId = `rev-${newId()}`
108:     id: projectId,
111:     currentRevisionId: revisionId,
127:     activeRequirementRevisionId: null,
131:     actorId: null,
151:         revisionId,
152:         parentId: null,
```

### desktop/main/openaiCompatibleAdapter.ts

```text
78:         tool_call_id: message.toolCallId ?? 'call_unknown',
87:           id: call.id ?? `call_local_${index}`,
117:     this.cancelled.delete(request.taskId)
119:     this.controllers.set(request.taskId, controller)
132:           if (this.cancelled.has(request.taskId) || (error instanceof Error && error.name === 'AbortError')) {
148:       this.controllers.delete(request.taskId)
152:   cancel(taskId: string): void {
153:     this.cancelled.add(taskId)
154:     this.controllers.get(taskId)?.abort()
226:       return this.readStream(response.body, request.taskId, onEvent)
229:     return this.readJson(body, request.taskId, onEvent, key)
234:     taskId: string,
282:           const current = calls.get(index) ?? { id: wire.id, name: '', argumentsJson: '', emittedStart: false }
283:           if (wire.id !== undefined) current.id = wire.id
299:         return { id: call.id ?? `call_${taskId.slice(0, 8)}_${index}`, name: call.name, argumentsJson: call.argumentsJson === '' ? '{}' : call.argumentsJson }
308:     taskId: string,
333:       return { id: call.id ?? `call_${taskId.slice(0, 8)}_${index}`, name, argumentsJson }
```

### desktop/main/projectService.ts

```text
33:   sessionId: string
51:   sessionId: string
67:   expectedFingerprint: string | null
73:   overwriteFingerprint?: string | null
81:   overwriteFingerprint?: string | null
95:   newSessionId?: () => string
112:   private readonly newSessionId: () => string
120:     this.newSessionId = options.newSessionId ?? (() => randomUUID())
126:   getSession(sessionId: string): ProjectSession | null {
127:     return this.sessions.get(sessionId) ?? null
130:   closeSession(sessionId: string): void {
131:     this.sessions.delete(sessionId)
132:     this.queues.delete(sessionId)
186:     const sessionId = this.newSessionId()
188:       sessionId,
201:     this.sessions.set(sessionId, session)
205:         sessionId,
221:     sessionId: string,
225:     const session = this.sessions.get(sessionId)
239:     if (snapshot.project.id !== session.snapshot.project.id) {
256:     sessionId: string,
260:     const session = this.sessions.get(sessionId)
284:       currentRevisionId: authoritative.project.currentRevisionId,
319:     if (assembled.value.project.id !== session.snapshot.project.id) {
326:         link.kind === 'parameter-binding' ? [link.termId] : [],
331:         const before = authoritative.project.dimensionChain.terms.find((item) => item.id === term.id)
332:         if (before !== undefined && boundTerms.has(term.id) && before.nominalQ !== term.nominalQ) {
336:             `termId=${term.id}`,
354:     sessionId: string,
359:     const session = this.sessions.get(sessionId)
373:     if (drawing.partId !== parameters[0]?.partId) {
398:     sessionId: string,
401:     const session = this.sessions.get(sessionId)
437:     const overwriteFingerprint =
439:         ? (request.overwriteFingerprint ?? (await this.store.fingerprint(targetPath)))
445:       expectedFingerprint: overwriteFingerprint,
460:         if (decoded.value.snapshot.project.id !== session.snapshot.project.id) {
518:       expectedFingerprint: session.fingerprint,
545:   async save(sessionId: string, request: SaveRequest): Promise<IpcResult<SaveValue>> {
546:     const session = this.sessions.get(sessionId)
553:     return this.enqueue(sessionId, async () => {
563:   async saveAs(sessionId: string, request: SaveAsRequest): Promise<IpcResult<SaveValue>> {
564:     const session = this.sessions.get(sessionId)
568:     return this.enqueue(sessionId, async () => {
574:       if (existing !== null && existing !== request.overwriteFingerprint) {
578:           `targetFingerprint=${existing}`,
593:     requireSessionFingerprint: boolean,
607:     if (requireSessionFingerprint && request.expectedFingerprint !== session.fingerprint) {
611:         `expected=${request.expectedFingerprint ?? 'null'}, session=${
623:     overwriteFingerprint: string | null,
627:       newRevisionId: () => `rev-${randomUUID()}`,
652:       expectedFingerprint: overwriteFingerprint,
663:         if (decoded.value.snapshot.project.id !== session.snapshot.project.id) {
```

### desktop/main/realModelRuntime.ts

```text
49:       adapterId: status.adapterId,
71:     if (settings.adapterId !== OPENAI_COMPATIBLE_1) return null
85:     if (settings.adapterId !== OPENAI_COMPATIBLE_1) {
86:       return { ok: false, code: 'UNSUPPORTED_SCOPE', model: null, latencyMs: 0, message: `暂不支持适配器 ${settings.adapterId}` }
```

### desktop/main/recentProjects.ts

```text
5:  * 按规范化路径去重（同一 projectId 的不同副本必须都能保留），main 生成
6:  * recentId。路径失效只标 missing，不自动清理记录，也不静默打开其它文件。
26:   recentId: string
27:   projectId: string
46:   newId?: () => string
60:     typeof record.recentId === 'string' &&
61:     record.recentId.length > 0 &&
62:     record.recentId.length <= 120 &&
63:     typeof record.projectId === 'string' &&
64:     record.projectId.length > 0 &&
65:     record.projectId.length <= 240 &&
105:   // 同路径只保留最新的一项；去重不影响同 projectId 的不同副本。
133:   private readonly newId: () => string
140:     this.newId = options.newId ?? (() => randomUUID())
164:    * 读取项目的当前正式版本标识：`project.currentRevisionId` 对应的
165:    * `fileRevisions[].revisionId`。
168:    * 读取失败、不是常规文件、容器损坏或 currentRevisionId 对应不到版本记录时
181:       const currentId = decoded.value.snapshot.project.currentRevisionId
183:         (item) => item.revisionId === currentId,
185:       return revision?.revisionId ?? null
199:   /** dirty gate / relink 用：按 recentId 取原始记录（不读文件内容）。 */
200:   async get(recentId: string): Promise<IpcResult<RecentProjectRecord>> {
205:     const record = loaded.value.find((item) => item.recentId === recentId)
217:     projectId: string
233:         recentId: previous?.recentId ?? this.newId(),
234:         projectId: input.projectId,
263:     recentId: string
265:     projectId: string
273:       const index = loaded.value.findIndex((item) => item.recentId === input.recentId)
278:       if (existing.projectId !== input.projectId) {
282:           `expected=${existing.projectId}, actual=${input.projectId}`,
```

### desktop/main/recovery.ts

```text
4:  * 位置固定在 `<userData>/workspace/recovery/<recoveryId>.cunlian`，配套
28: import { sha256Bytes } from './fileStore'
45:   recoveryId: string
46:   projectId: string
49:   baseFingerprint: string | null
60:   projectId: string
63:   baseFingerprint: string | null
77:   newId?: () => string
81:   recoveryId: string
129:       typeof entry.recoveryId !== 'string' ||
130:       !RECOVERY_ID_PATTERN.test(entry.recoveryId) ||
131:       typeof entry.projectId !== 'string' ||
132:       entry.projectId.length === 0 ||
136:       (entry.baseFingerprint !== null && !isSha256(entry.baseFingerprint)) ||
155:   private readonly newId: () => string
164:     this.newId = options.newId ?? (() => randomUUID())
175:   draftPath(recoveryId: string): string {
176:     if (!RECOVERY_ID_PATTERN.test(recoveryId)) {
179:     return path.join(this.directory, `${recoveryId}.cunlian`)
187:     sessionId: string,
192:     const state = await this.stateFor(sessionId, meta)
197:       this.schedule(sessionId, state)
209:     this.schedule(sessionId, state)
214:   async flush(sessionId: string): Promise<RecoveryWriteOutcome> {
215:     const state = this.sessions.get(sessionId)
240:   hasPending(sessionId: string): boolean {
241:     return this.sessions.get(sessionId)?.pending !== null
248:   stateOf(sessionId: string): RecoveryWriteState | 'none' {
249:     return this.sessions.get(sessionId)?.lastState ?? 'none'
253:   async readPersisted(sessionId: string): Promise<IpcResult<ProjectFileSnapshot>> {
254:     const state = this.sessions.get(sessionId)
259:       const decoded = await decodeProjectFile(await this.ops.readFile(this.draftPath(state.recoveryId)))
267:   async discard(sessionId: string): Promise<void> {
268:     const state = this.sessions.get(sessionId)
277:     this.sessions.delete(sessionId)
278:     await this.removeIndexEntry(state.recoveryId)
280:       await this.ops.remove(this.draftPath(state.recoveryId))
297:       const kind = await this.ops.statKind(this.draftPath(entry.recoveryId))
306:       const read = await this.readDraft(entry.recoveryId)
317:   async readDraft(recoveryId: string): Promise<
324:     const entry = loaded.value.find((item) => item.recoveryId === recoveryId)
328:     const draftPath = this.draftPath(recoveryId)
350:   async remove(recoveryId: string): Promise<IpcResult<null>> {
351:     if (!RECOVERY_ID_PATTERN.test(recoveryId)) {
354:     for (const [sessionId, state] of this.sessions) {
355:       if (state.recoveryId === recoveryId) {
356:         await this.discard(sessionId)
360:     const removed = await this.removeIndexEntry(recoveryId)
365:       await this.ops.remove(this.draftPath(recoveryId))
374:   private async stateFor(sessionId: string, meta: RecoveryMeta): Promise<SessionState> {
375:     const existing = this.sessions.get(sessionId)
379:     const recoveryId = await this.recoveryIdFor(meta)
381:       recoveryId,
390:     this.sessions.set(sessionId, state)
400:           entry.projectId === meta.projectId &&
404:         return match.recoveryId
407:     return this.newId()
410:   private schedule(sessionId: string, state: SessionState): void {
416:       void this.flush(sessionId)
459:     const draftPath = this.draftPath(state.recoveryId)
465:     const tempPath = `${draftPath}.${this.newId()}.tmp`
476:         if ((await sha256Bytes(back)) !== (await sha256Bytes(encoded.value.bytes))) {
513:       recoveryId: state.recoveryId,
514:       projectId: state.meta.projectId,
517:       baseFingerprint: state.meta.baseFingerprint,
587:         ...loaded.value.filter((item) => item.recoveryId !== entry.recoveryId),
600:   private async removeIndexEntry(recoveryId: string): Promise<IpcResult<null>> {
606:       const items = loaded.value.filter((item) => item.recoveryId !== recoveryId)
632:     return sha256Bytes(new TextEncoder().encode(JSON.stringify(rest)))
```

### desktop/main/requirementChannels.ts

```text
36:     documentId: idLike,
37:     revisionId: idLike,
47:       sessionId: z.string().min(1).max(200),
51:           requirementId: idLike.nullable(),
58:               documentId: idLike.nullable(),
59:               revisionId: idLike.nullable(),
72:       sessionId: z.string().min(1).max(200),
74:       expectedActiveRequirementRevisionId: idLike.nullable(),
75:       requirementId: idLike.nullable(),
108:   function requireActive(windowId: number, sessionId: string): void {
109:     if (deps.controller.sessionIdFor(windowId) !== sessionId) {
120:         requireActive(sender.webContentsId, params.sessionId)
121:         return unwrap(await deps.changeService.stageRequirementEdit(params.sessionId, params))
133:         requireActive(sender.webContentsId, params.sessionId)
134:         return unwrap(await deps.changeService.confirmRequirement(params.sessionId, params))
```

### desktop/main/senderGuard.ts

```text
5:   webContentsId: number
16:   webContentsId: number
38:     this.renderers.set(renderer.webContentsId, renderer)
41:   unregister(webContentsId: number): void {
42:     this.renderers.delete(webContentsId)
50:     const renderer = this.renderers.get(sender.webContentsId)
```

### desktop/main/sessionController.ts

```text
40:   flushEditor: (windowId: number) => Promise<IpcResult<null>>
88:   sessionIdFor(windowId: number): string | null {
89:     return this.active.get(windowId) ?? null
92:   sessionFor(windowId: number): ProjectSession | null {
93:     const sessionId = this.active.get(windowId)
94:     return sessionId === undefined ? null : this.projectService.getSession(sessionId)
105:   async gate(windowId: number, purpose: SwitchPurpose): Promise<IpcResult<GateDecision>> {
106:     const barrier = await this.ports.flushEditor(windowId)
113:     const initial = this.sessionFor(windowId)
115:       const flushed = await this.recovery.flush(initial.sessionId)
125:       const session = this.sessionFor(windowId)
166:     windowId: number,
170:     if (this.gateLocks.has(windowId)) {
173:     this.gateLocks.add(windowId)
175:       const gated = await this.gate(windowId, purpose)
181:       this.gateLocks.delete(windowId)
198:       const saved = await this.projectService.saveAs(session.sessionId, {
200:         expectedFingerprint: null,
202:         overwriteFingerprint: existing,
211:     const saved = await this.projectService.save(session.sessionId, {
213:       expectedFingerprint: session.fingerprint,
238:       projectId: session.snapshot.project.id,
250:     await this.recovery.discard(session.sessionId)
257:   async attach(windowId: number, sessionId: string): Promise<void> {
258:     const previous = this.active.get(windowId)
259:     if (previous !== undefined && previous !== sessionId) {
264:     this.active.set(windowId, sessionId)
268:   async detach(windowId: number): Promise<void> {
269:     const sessionId = this.active.get(windowId)
270:     if (sessionId === undefined) {
273:     this.active.delete(windowId)
274:     await this.recovery.discard(sessionId)
275:     this.projectService.closeSession(sessionId)
281:       sessionId: session.sessionId,
296:     baseFingerprint: string | null
298:     if (entry.basePath === null || entry.baseFingerprint === null) {
305:     if (current !== entry.baseFingerprint) {
314:       projectId: snapshot.project.id,
317:       baseFingerprint: session.fingerprint,
328:   windowId: number,
331:   return controller.withGate(windowId, purpose, async () => {
332:     await controller.detach(windowId)
```

### desktop/main/sourceChannels.ts

```text
24: import { sha256Hex } from '../../src/sources/hash'
36:       sessionId: z.string().min(1).max(200),
38:       documentId: z.string().min(1).max(240).nullable().optional(),
49:   pickSourcePath: (windowId: number) => Promise<string | null>
55:   newId?: () => string
64:   windowId: number,
65:   sessionId: string,
67:   if (controller.sessionIdFor(windowId) !== sessionId) {
70:   const session = controller.sessionFor(windowId)
83:   const newId = deps.newId ?? (() => randomUUID())
94:         const windowId = sender.webContentsId
95:         const session = requireSession(controller, windowId, params.sessionId)
107:           params.documentId === undefined || params.documentId === null
109:             : (snapshot.documents.find((item) => item.id === params.documentId) ?? null)
110:         if (params.documentId !== undefined && params.documentId !== null && existingDocument === null) {
111:           reject('SOURCE_NOT_FOUND', '要换版的来源文档不存在或不属于当前项目', params.documentId)
113:         if (existingDocument !== null && existingDocument.projectId !== snapshot.project.id) {
114:           reject('SOURCE_NOT_FOUND', '要换版的来源文档不属于当前项目', params.documentId ?? '')
117:         const picked = await deps.pickSourcePath(windowId)
162:         const digest = await sha256Hex(bytes)
178:         const documentId = existingDocument?.id ?? `doc-${newId()}`
179:         const revisionId = `sr-${newId()}`
180:         const blobKey = `blob-${newId()}`
193:                   id: documentId,
194:                   projectId: snapshot.project.id,
196:                   latestRevisionId: revisionId,
200:                 item.id === documentId ? { ...item, latestRevisionId: revisionId } : item,
205:               id: revisionId,
206:               projectId: snapshot.project.id,
207:               documentId,
209:               sha256: digest,
220:               projectId: snapshot.project.id,
221:               sha256: digest,
230:               id: `source_import:${revisionId}`,
231:               projectId: snapshot.project.id,
234:               documentId,
235:               revisionId,
261:           session.sessionId,
268:           documentId,
269:           revisionId,
272:           sha256: digest,
```

### desktop/main/window.ts

```text
28:   onClosed: (webContentsId: number) => void
76:   const webContentsId = window.webContents.id
78:     webContentsId,
102:     options.guard.unregister(webContentsId)
103:     options.onClosed(webContentsId)
```

### desktop/preload/index.ts

```text
283:   agentCancel: (request: { taskId: string }) =>
285:   agentResume: (request: { taskId: string }) =>
287:   agentTaskState: (request: { taskId: string }) =>
```

### desktop/shared/contracts.ts

```text
139:   requestId: string
143:   requestId: string
144:   sessionId?: string
304:   sessionId: string
335:   sha256: string
358:   sessionId: string
377:   recentId: string
378:   projectId: string
387:    * 磁盘上该项目的当前正式版本标识（`project.currentRevisionId` 对应的
388:    * `fileRevisions[].revisionId`）。
390:    * 路径失效、文件不可读、容器校验失败或 `currentRevisionId` 对应不到版本记录
406:   recoveryId: string
407:   projectId: string
410:   baseFingerprint: string | null
436:   sessionId: string
454:   sha256: string
459:   | { kind: 'revision'; modelRevisionId: string }
463:   sha256: string
480:   modelRevisionId: string
517:   sessionId: string
519:   partId: string
527:   drawingId: string
528:   drawingFingerprint: string
537:   sessionId: string
539:   drawingId: string
540:   drawingFingerprint: string
546:   sha256: string
547:   drawingId: string
548:   drawingFingerprint: string
556:   termId: string
557:   partId: string
558:   parameterId: string
562:   sessionId: string
577:   draftId: string
589:   sessionId: string
595:   previewId: string
599:   revisionId: string
607:   affectedTermIds: string[]
608:   unboundTermIds: string[]
638:   sessionId: string
641:   previewId: string
644:   requestId: string
649:   revisionId: string
655:   analysisSnapshotId: string
661:   sessionId: string
663:   termId: string
664:   partId: string
665:   parameterId: string
666:   /** 替换同环已有绑定时必须回传旧 bindingId；否则拒绝追加第二参数。 */
667:   replaceBindingId?: string
672:   sessionId: string
674:   bindingId: string
681:   sessionId: string
683:   leftRevisionId?: string
686:   drawingId?: string
692:   sessionId: string
694:   sourceRevisionId: string
699:   draftId: string
703:   restoredFromRevisionId: string
724:   sessionId: string
726:   /** 传入既有 documentId 表示同一文档换版；不传/为 null 新建文档。 */
727:   documentId?: string | null
732:   documentId: string
733:   revisionId: string
736:   sha256: string
739:   /** 供框选页身份校验；字节仍只由 readAttachment 按 revisionId 读取。 */
748:   sessionId: string
757:   activeRequirementRevisionId: string | null
762:   documentId: string
763:   revisionId: string
770:   sessionId: string
772:   expectedActiveRequirementRevisionId: string | null
773:   /** 更新既有条款时的 requirementId；首版为 null。 */
774:   requirementId: string | null
785:   requirementId: string
786:   requirementRevisionId: string
787:   configRevisionId: string
807:  * - revisionId 必须是当前会话快照里存在的版本，main 不会自动追随 latest；
808:  * - 不传路径、blobKey、sha256 或字节；main 从版本记录解析并自算哈希；
809:  * - requestId 供 `extraction:cancel` 取消同一次提取。
812:   sessionId: string
814:   revisionId: string
818:   requestId: string
823:   draftId: string
848:   sessionId: string
850:   draftId: string
851:   candidateId: string
868:   draftId: string
869:   candidateId: string
871:   decisionId: string | null
878:   sessionId: string
879:   requestId: string
897:   sessionId: string
899:   draftId: string
905:   draftId: string
917:  * 批量动作的公共结果：**逐条**给出每条候选自己的 decisionId 与动作后状态。
920:  * candidateIds（批量确认/补单位）或命中撤销的候选数。
923:   candidateId: string
924:   decisionId: string
930:   draftId: string
931:   candidateIds: string[]
946:   sessionId: string
948:   draftId: string
949:   candidateIds: string[]
958:  * - actor/sessionSeq 由 main 生成（renderer 不能伪造）；turnId 也由 main 生成
962:   sessionId: string
964:   draftId: string
965:   candidateIds: string[]
970:   batchId: string
976:  * 撤销补单位：`batchId` 整批撤销，`candidateId` 逐条撤销（二选一）。
980:   sessionId: string
982:   draftId: string
983:   batchId?: string
984:   candidateId?: string
1005:   | { ok: true; data: T; requestId: string; objectVersion: string }
1006:   | { ok: false; code: ToolErrorCode; message: string; requestId: string; objectVersion?: string; details?: unknown }
1010:   baseRevisionId: string
1011:   candidateIds: string[]
1016:   draftId: string
1018:   baseRevisionId: string
1027:   previewId?: string
1028:   previewFingerprint?: string
1033:   candidateId: string
1050:   draftId: string
1061:   draftId: string
1063:   baseRevisionId: string
1074:   projectId: string
1075:   revisionId: string
1083:     revisionId: string
1092:   draftId: string
1093:   baseRevisionId: string
1101:   draftId: string
1102:   baseRevisionId: string
1109:  * `baseRevisionId` 是阶段 3 为 STALE_BASE 判定增加的审计字段。
1112:   approvalId: string
1113:   windowId: number
1114:   projectId: string
1115:   draftId: string
1117:   requirementRevisionId: string | null
1118:   previewFingerprint: string
1119:   baseRevisionId: string
1136:   actorId: string
1141:   projectId: string
1142:   draftId: string
1143:   actorId: string
1150:   candidateId: string
1162:   projectId: string
1163:   draftId: string
1166:   actorId: string | null
1187:   extractionDraftId?: string
1192:   intent?: { actorId: string; sessionLabel?: string | null }
1196:   taskId: string
1198:   modelId: string
1221:     adapterId?: string | null
1231:   demo: { available: true; modelId: 'fake-1'; label: string }
1261:   sha256: string | null
1262:   revisionId: string | null
1266:   previewId: string
1267:   previewFingerprint: string
1268:   draftId: string
1270:   baseRevisionId: string
1271:   requirementRevisionId: string | null
1286:   previewId: string
1292:   approvalId: string
1297:   approvalId: string
1298:   draftId: string
1299:   previewFingerprint: string
1303:   revisionId: string
1307:   analysisSnapshotId: string
1314:   requirementRevisionId?: string
1315:   checkId?: string
1316:   parameterId?: string
1322:       requirementRevisionId: string
1323:       checkId: string | null
1324:       revisionId: string
1333:       parameterId: string
1336:       termIds: string[]
1337:       annotationIds: string[]
1338:       drawingId: string | null
1343:   getConfirmedInputs(request: { draftId: string }): Promise<ToolResult<ConfirmedInputsView>>
1352:   /** 打开项目：无 recentId 时用 main 对话框；有 ID 只解析本机索引。 */
1353:   openProject(request?: { recentId?: string }): Promise<IpcResult<ProjectOpenValue>>
1356:     sessionId: string
1362:     sessionId: string
1364:     expectedFingerprint: string | null
1368:     sessionId: string
1374:   relinkRecent(request: { recentId: string }): Promise<IpcResult<{ item: RecentProjectItem }>>
1378:   restoreRecovery(request: { recoveryId: string }): Promise<IpcResult<ProjectOpenValue>>
1386:     sessionId: string
1387:     revisionId: string
1390:   revealProject(request: { sessionId: string }): Promise<IpcResult<ProjectRevealValue>>
1398:     projectId: string
1404:   /** 回复编辑屏障；main 校验 requestId 与编辑序号后才会放行关闭。 */
1410:     sessionId: string
1412:     replacePartId?: string
1416:     sessionId: string
1421:     sessionId: string
1424:     expectedCurrentModelRevisionId: string | null
1430:     sessionId: string
1435:     sessionId: string
1438:     linkId?: string
1439:     termId: string
1442:       partId: string
1443:       modelRevisionId: string | null
1445:     expectedCurrentModelRevisionId: string | null
1509:   /** 取消同一会话中正在进行的提取（按 requestId）。 */
1530:   agentCancel?(request: { taskId: string }): Promise<ToolResult<{ cancelled: boolean }>>
1531:   agentResume?(request: { taskId: string }): Promise<ToolResult<{ resumed: boolean }>>
1532:   agentTaskState?(request: { taskId: string }): Promise<ToolResult<AgentTaskView>>
1548:     candidateId: string
```

### mcp/lib/format.ts

```text
4: import { sha256Hex } from '../../src/sources/hash'
10: export function sha256(bytes: Uint8Array): Promise<string> {
11:   return sha256Hex(bytes)
```

### mcp/lib/spacer.ts

```text
39:     newId: () => 'mcp-readonly',
43:     project: { ...snapshot.project, id: MCP_PROJECT_ID, currentRevisionId: MCP_REVISION_ID },
67:     bindingId: 'binding:mcp:spacer-length',
68:     termId: 't-s',
69:     partId: SPACER_PART_ID,
70:     parameterId: SPACER_PARAMETER_IDS.length,
93:     { revisionId: MCP_REVISION_ID, now: MCP_EPOCH },
```

### mcp/main.ts

```text
79:   const isNotification = request.id === undefined || request.id === null
80:   const id = isNotification ? null : (request.id as string | number)
```

### mcp/tools/calc-chain.ts

```text
103:     id: term.id,
```

### mcp/tools/describe-project.ts

```text
30: import { mm, sha256, success } from '../lib/format'
54:       actorId: attestation.actorId,
65:       imageId: image.imageId,
66:       sha256: image.sha256,
75:     documentId: anchored.documentId,
76:     revisionId: anchored.revisionId,
77:     sha256: anchored.sha256,
93:       actorId: attestation.actorId,
102:     documentId: source.documentId,
103:     revisionId: source.revisionId,
104:     sha256: source.sha256,
125:   const digest = await sha256(bytes)
137:     fileRevisions.find((revision) => revision.revisionId === project.currentRevisionId) ?? null
140:     project.activeRequirementRevisionId === null
143:           (revision) => revision.revisionId === project.activeRequirementRevisionId,
164:     file: { path, byteSize: bytes.byteLength, sha256: digest },
172:       id: project.id,
179:       currentRevisionId: project.currentRevisionId,
185:             revisionId: currentRevision.revisionId,
186:             parentId: currentRevision.parentId,
192:       parameterId: parameter.parameterId,
203:       id: term.id,
220:             requirementId: activeRequirement.requirementId,
221:             revisionId: activeRequirement.revisionId,
237:             checkId: project.currentRequirementCheck.checkId,
```

### mcp/tools/read-taskbook.ts

```text
32: import { mm, sha256, success } from '../lib/format'
80:       actorId: attestation.actorId,
93:       imageId: image.imageId,
94:       sha256: image.sha256,
105:     documentId: anchored.documentId,
106:     revisionId: anchored.revisionId,
107:     sha256: anchored.sha256,
132:     candidateId: candidate.candidateId,
162:   const digest = await sha256(bytes)
194:       file: { path: pdfPath, byteSize: bytes.byteLength, sha256: digest },
207:     documentId: `mcp-doc-${digest.slice(0, 16)}`,
208:     revisionId: `mcp-rev-${digest.slice(0, 16)}`,
209:     sha256: digest,
214:     projectId: 'project-mcp-readonly',
242:         message: `候选 ${String(symbolOf(candidate) ?? candidate.candidateId)} 的 ${incomplete
251:     file: { path: pdfPath, byteSize: bytes.byteLength, sha256: digest },
256:       draftId: draft.draftId,
```

### mcp/tools/render-drawing.ts

```text
31: import { sha256, success } from '../lib/format'
112:     projectId: MCP_PROJECT_ID,
113:     revisionId: MCP_REVISION_ID,
114:     drawingId: MCP_DRAWING_ID,
115:     partId: SPACER_PART_ID,
162:   const digest = await sha256(written)
170:     sha256: digest,
171:     drawingId: drawing.drawingId,
172:     drawingFingerprint: drawing.fingerprint,
```

### scripts/assert-packaged-pdf-worker.mjs

```text
40: function sha256(buffer) {
41:   return createHash('sha256').update(buffer).digest('hex')
131:   const digest = sha256(bytes)
135:     sha256: digest,
148:   const matched = installedWorkers.find((candidate) => sha256(candidate.bytes) === digest)
```

### scripts/confirm-efficiency-report.mjs

```text
57:     projectId: 'confirm-efficiency',
60:       documentId: `real-doc-${entry.doc.id}`,
61:       revisionId: `real-doc-${entry.doc.id}-${entry.sha256.slice(0, 12)}`,
62:       sha256: entry.sha256,
81:     id: entry.doc.id,
117:     `${row.id} ${row.file}: 候选 ${row.candidates}（pending ${row.pending}｜blocked ${row.blocked}）` +
```

### scripts/confirm-efficiency-seed.ts

```text
33:     ) as { documents: { id: string; file: string; sha256: string; pages: number }[] }
34:     const doc = manifest.documents.find((item) => item.id === 'r6')
39:     const sha256 = createHash('sha256').update(bytes).digest('hex')
40:     expect(sha256, `语料 ${doc.file} 与 manifest sha256 不一致`).toBe(doc.sha256)
44:       documentId: base.documents[0]!.id,
45:       revisionId: base.revisions[0]!.id,
46:       sha256,
56:       projectId: base.project.id,
70:           sha256,
75:       blobs: [{ ...base.blobs[0]!, sha256, byteSize: bytes.byteLength }],
```

### scripts/dxf-depth-samples.ts

```text
35:   { parameterId: 'param:spacer:inner-diameter', partId: 'builtin:shaft-demo:spacer', key: 'innerDiameter', valueQ: 200000, inputDecimals: 2, reviewStatus: 'confirmed' },
36:   { parameterId: 'param:spacer:outer-diameter', partId: 'builtin:shaft-demo:spacer', key: 'outerDiameter', valueQ: 320000, inputDecimals: 2, reviewStatus: 'confirmed' },
37:   { parameterId: 'param:spacer:length', partId: 'builtin:shaft-demo:spacer', key: 'length', valueQ: 120500, inputDecimals: 2, reviewStatus: 'confirmed' },
53:     projectId: 'project:dxf-depth',
54:     revisionId: 'rev-dxf-depth-1',
55:     drawingId: 'drawing:dxf-depth',
62: function sha256(bytes: Uint8Array): string {
63:   return createHash('sha256').update(bytes).digest('hex')
169:       expect(sha256(disk)).toBe(sha256(build.bytes))
189:         sha256: sha256(disk),
260:       console.log('SAMPLE', JSON.stringify({ case: entry.key, file: fileName, sha256: record.sha256, bytes: record.byteSize }))
```

### scripts/dxf-export-evidence.ts

```text
38:     parameterId: 'param:spacer:inner-diameter',
39:     partId: 'builtin:shaft-demo:spacer',
46:     parameterId: 'param:spacer:outer-diameter',
47:     partId: 'builtin:shaft-demo:spacer',
54:     parameterId: 'param:spacer:length',
55:     partId: 'builtin:shaft-demo:spacer',
76:     projectId: 'project:dxf-evidence',
77:     revisionId: 'rev-cfg-1',
78:     drawingId: 'drawing:dxf-evidence',
85: function sha256(bytes: Uint8Array): string {
86:   return createHash('sha256').update(bytes).digest('hex')
181:   sha256: string
266:     sha256: sha256(bytes),
314:       expect(sha256(disk)).toBe(sha256(build.bytes))
395:       r12: { sha256: files.r12.sha256, bytes: files.r12.byteSize },
396:       dxf2000: { sha256: files['2000'].sha256, bytes: files['2000'].byteSize },
```

### scripts/evidence-json.ts

```text
15: const generatedKey = /^(?:draftId|sessionId|requestId)$/u
90:     // parse.ts derives draft-<16 hex> with stableId(idempotencyKey), not a random UUID.
91:     const stableDraft = key === 'draftId' && typeof value === 'string' && /^draft-[a-f0-9]{16}$/u.test(value)
```

### scripts/evidence-ref-candidates.mjs

```text
6:  * 输出每份文档的 draftId / idempotencyKey / candidateId 列表 / candidate 级与字段级
30: function sha256(text) {
31:   return createHash('sha256').update(text).digest('hex')
67:     candidateId: candidate.candidateId,
69:     groupId: candidate.groupId,
100:       documentId: `real-doc-${entry.doc.id}`,
101:       revisionId: `real-doc-${entry.doc.id}-${entry.sha256.slice(0, 12)}`,
102:       sha256: entry.sha256,
107:       projectId: 'real-doc-baseline',
115:       id: entry.doc.id,
118:       draftId: draft.draftId,
122:       candidateArraySha256: sha256(JSON.stringify(candidates)),
125:         issueId: issue.issueId,
129:         candidateIds: [...issue.candidateIds],
132:     process.stderr.write(`${entry.doc.id}: ${candidates.length} 候选\n`)
159:     console.log(`${doc.id} 候选=${doc.candidateCount} draft=${doc.draftId} sha=${doc.candidateArraySha256}`)
```

### scripts/evidence-ref-mutations.mjs

```text
9:  * M24：把 user-attestation 当成“总是有效”（跳过 actorId/sessionSeq 一致性校验）。
43:   if (candidate.candidateId !== '') return null
```

### scripts/evidence-ref-record.mjs

```text
28: const beforeByDoc = new Map(before.documents.map((doc) => [doc.id, doc]))
29: const afterByDoc = new Map(after.documents.map((doc) => [doc.id, doc]))
32:   const beforeDoc = beforeByDoc.get(row.id)
33:   const afterDoc = afterByDoc.get(row.id)
35:     throw new Error(`缺少候选身份快照：${row.id}`)
38:     id: row.id,
45:     draftId: { before: beforeDoc.draftId, after: afterDoc.draftId },
51:     candidateIds: afterDoc.candidates.map((candidate) => candidate.candidateId),
```

### scripts/generate-backup-fixtures.mjs

```text
24: const sha256 = async (bytes) => {
106:       sha256: await sha256(bytes),
232:   { id: project.id, name: project.name, updatedAt: project.updatedAt },
249:   manifest.entries[0].sha256 = '0'.repeat(64)
259:   const blobSha = await sha256(blobBytes)
262:     projectId: project.id,
264:     latestRevisionId: 'rev-fixture',
268:     projectId: project.id,
269:     documentId: document.id,
271:     sha256: blobSha,
279:     projectId: project.id,
280:     sha256: blobSha,
285:     projectId: project.id,
286:     termId: 'h',
287:     revisionId: 'rev-missing',
288:     documentId: document.id,
367:   const blobSha = await sha256(blobBytes)
370:     projectId: project.id,
372:     latestRevisionId: 'rev-cross',
376:     projectId: project.id,
377:     documentId: document.id,
379:     sha256: blobSha,
387:     projectId: otherProject.id,
388:     sha256: blobSha,
401:     [...projectSummary, { id: otherProject.id, name: otherProject.name, updatedAt: otherProject.updatedAt }],
424:       { termId: 'h', toleranceQ: 1000 },
425:       { termId: 'b1', toleranceQ: 200 },
459:     ruleId: 'INPUT_VALID',
472:     projectId: project.id,
477:     inputFingerprint: 'fixture-fingerprint',
502:       unboundTermIds: ['h', 'b1'],
528:     snapshot.review.findings = [{ ruleId: 'INPUT_VALID' }]
533:     snapshot.sourceManifest.bindings = [{ bindingId: 123 }]
552:         addedTermIds: [],
553:         removedTermIds: [],
567:   // 冻结指针必须落在冻结清单之内：快照文档的 latestRevisionId 指向清单外版本，
571:     const blobSha = await sha256(blobBytes)
574:       projectId: project.id,
576:       latestRevisionId: 'rev-snapshot',
580:       projectId: project.id,
581:       documentId: document.id,
583:       sha256: blobSha,
592:       documents: [{ ...document, latestRevisionId: 'rev-outside-manifest' }],
594:       unboundTermIds: ['h', 'b1'],
605:           projectId: project.id,
606:           sha256: blobSha,
```

### scripts/ground-truth-crops.mjs

```text
14:   const regions = truths.filter(truth => truth.docId === entry.doc.id)
36:       console.log(`${truth.docId} p${truth.page} ${truth.cropFile}`)
```

### scripts/ingest-readings-evidence.ts

```text
25: import { stableFingerprint } from '../src/revisions/canonical'
49: const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
101:       identity: { actorId: '验收转录', sessionLabel: '合成装配；读数来自扫描页' }, appVersion: 'evidence', electronVersion: 'evidence' }) } }
109:     const session = h.projectService.getSession(opened.sessionId)!
122:     const imported = await h.invoke<SourceImportValue>(IPC_CHANNELS.sourceImport, { sessionId: opened.sessionId, baseEditSeq: session.acceptedSeq })
124:     expect(imported.value.sha256).toBe(sha(pdfBytes))
126:       const result = await service.run(1, setup.command, setup.input, { userText: setup.userText, turnId: `evidence-setup-${index}` })
129:     const source = { kind: 'pdf-page', revisionId: imported.value.revisionId, sha256: imported.value.sha256, page: manifest.page }
130:     const payload = { projectId: session.snapshot.project.id, source, statement: manifest.statement, readings: manifest.readings }
134:       { userText: manifest.statement, turnId: 'evidence-manual-readings' })
141:     const target = () => session.snapshot.project.extractionDrafts.find(d => d.draftId === draft!.draftId)!
159:         expect(item.actorId).toBe(session.snapshot.project.actorId)
161:         expect(typeof item.turnId).toBe('string')
162:         expect(item.modelId).toBeNull()
178:     const beforeBatch = stableFingerprint(target())
180:     const batch = await extraction.confirmBatch({ sessionId: opened.sessionId, baseEditSeq: seq,
181:       draftId: target().draftId, candidateIds: candidates.map(c => c.candidateId) })
185:     expect(stableFingerprint(target())).toBe(beforeBatch)
189:     const plan = planApplication(target(), { source: target().sourceIdentity, candidateIds: candidates.map(c => c.candidateId) })
201:       approvalId: 'no-approval', draftId: target().draftId, previewFingerprint: 'no-preview',
211:       const latest = target().candidates.find(c => c.candidateId === candidate.candidateId)!
212:       const decided = await extraction.decide({ sessionId: opened.sessionId, baseEditSeq: session.acceptedSeq,
213:         draftId: target().draftId, candidateId: latest.candidateId, editRevision: latest.editRevision,
218:       expect(target().decisions.some(d => d.candidateId === candidate.candidateId && d.action === 'confirm' && !d.batchId)).toBe(true)
229:       const planToken = await service.issueAfterDecision(1, target().draftId)
231:       must(await service.run(1, 'apply', { planToken, baseRevisionId: session.snapshot.project.currentRevisionId,
232:         candidateIds: target().candidates.map(c => c.candidateId), mapping: manifest.mapping }))
238:     const approval = await service.issueApproval(1, summary.data!.previewId, { userAttestationAcknowledged: true })
240:     const committed = await service.commitApprovedDraft(1, { approvalId: approval.data.approvalId,
241:       draftId: summary.data!.draftId, previewFingerprint: summary.data!.previewFingerprint })
246:     must(await service.run(1, 'ingest_readings', { projectId: session.snapshot.project.id, draftId: target().draftId,
247:       source, statement: correctionStatement, readings: [correctedReading] }, { userText: correctionStatement, turnId: 'evidence-correction' }))
250:     must(await extraction.decide({ sessionId: opened.sessionId, baseEditSeq: session.acceptedSeq,
251:       draftId: target().draftId, candidateId: correctedCandidate.candidateId, editRevision: correctedCandidate.editRevision,
258:     const correctedApproval = await service.issueApproval(1, correctedSummary.data!.previewId, { userAttestationAcknowledged: true })
260:     const finalCommit = await service.commitApprovedDraft(1, { approvalId: correctedApproval.data.approvalId,
261:       draftId: correctedSummary.data!.draftId, previewFingerprint: correctedSummary.data!.previewFingerprint })
284:       pickExportPath: async (_windowId, kind, suggested) => {
294:       const exported = await h.invoke<DrawingExportValue>(channel, { sessionId: opened.sessionId,
295:         baseEditSeq: session.acceptedSeq, drawingId: drawing!.drawingId, drawingFingerprint: drawing!.dataFingerprint })
298:       expect(sha(bytes)).toBe(exported.value.sha256)
302:       expect(text).toContain(String(session.snapshot.project.actorId))
303:       checks.push({ id: channel, sha256: exported.value.sha256, fileName: exported.value.fileName })
305:     await record('service-result.json', { verdict: 'pass', checks, pdf: { file: path.relative(ROOT, pdf), sha256: sha(pdfBytes), textItems: rawPages.map(p => p.items.length) },
```

### scripts/ingest-readings-mutations.mjs

```text
10:     to: "provenance: [{ kind: 'pdf-text', documentId: draft.sourceIdentity.documentId, revisionId: draft.sourceIdentity.revisionId, sha256: draft.sourceIdentity.sha256, blobKey: draft.sourceIdentity.blobKey, page: 1, rectPdf: [0, 0, 1, 1], pageBoxPdf: [0, 0, 100, 100], textSnippet: input.statement, normalizedSnippet: input.statement, textItemIndexes: [] }]" },
16:   assert(original.includes(mutation.from), `${mutation.id} target missing`)
18:   await writeFile(`${out}/${mutation.id}.patch`, `--- ${mutation.file}\n+++ ${mutation.file}\n-${mutation.from}\n+${mutation.to}\n`)
22:     await writeFile(`${out}/${mutation.id}-red.log`, `${red.stdout}${red.stderr}\nEXIT_CODE=${red.status}\n`)
23:     assert(red.status !== null && red.status !== 0, `${mutation.id} survived`)
24:     assert(`${red.stdout}${red.stderr}`.includes('AssertionError'), `${mutation.id} must be killed by assertion, not build error`)
27:   await writeFile(`${out}/${mutation.id}-green.log`, `${green.stdout}${green.stderr}\nEXIT_CODE=${green.status}\n`)
29:   console.log(`${mutation.id}: red nonzero assertion / restored green 0`)
```

### scripts/intent-record.mjs

```text
34: const afterByDoc = new Map(after.documents.map((doc) => [doc.id, doc]))
35: const step2ByDoc = new Map(step2.documents.map((doc) => [doc.id, doc]))
38:   const now = afterByDoc.get(row.id)
39:   const before = step2ByDoc.get(row.id)
40:   if (now === undefined || before === undefined) throw new Error(`缺少候选身份快照：${row.id}`)
42:     id: row.id,
49:     draftId: now.draftId,
74:     projectFile: '9 → 10（加法：sourceKind / actorId / sessionSeq / sessionLabel / attestations；条款来源支持 user-attestation）',
100:     dxfSha256: log('14-export.log').match(/sha256=([0-9a-f]{64})/u)?.[1] ?? null,
151:     mutation: '临时把提示改回带 modelId 与 taskId（旧写法），守卫用例红；恢复后绿',
156:     legacy: '旧记录（frameFields.version 为空的已保存图纸）保持原回退文字：dataFingerprint 是用它算的，换字会让旧项目打不开（draftSyncLegacy 已实测）。下一次改图/保存即写入可读版本号',
159:       'desktop/tests/intentProject.test.ts：提交后版本栏 = 草稿 · 第 2 版（fileRevisions 数），SVG 可见文字不含 revisionId 与 ≥32 位十六进制串',
```

### scripts/intent-seed.ts

```text
22:       identity: { actorId: '老王', sessionLabel: '2026-11-12 走查' },
```

### scripts/mcp-smoke.mjs

```text
61: function sha256(text) {
62:   return createHash('sha256').update(text).digest('hex')
79:       if (frame.id !== undefined && pending.has(frame.id)) {
80:         const entry = pending.get(frame.id)
81:         pending.delete(frame.id)
94:     let nextId = 0
96:       nextId += 1
97:       const id = nextId
126:           textSha256: sha256(text),
165:       sha256: value.sha256,
171:       projectId: value.project?.id,
172:       currentRevisionId: value.formalVersion?.revisionId,
175:       requirement: value.requirement?.revisionId ?? null,
```

### scripts/real-doc-metrics.mjs

```text
67:     `${doc.id} ${doc.file}`,
89:     console.log(`${doc.id} 阻塞原因码：${reasonCodes}`)
90:     console.log(`${doc.id} 问题码：${issues}；无文本层页：${doc.issues.noTextLayerPages.join(',') || '无'}`)
113:       `页范围探针 ${probe.id}：候选 ${probe.candidates.total}（pending ${probe.candidates.pending}｜` +
137:       `${doc.id} ${doc.file}`,
176:       `${doc.id} 声明「${unit.statement}」｜actor=${unit.actor}｜sessionSeq=${unit.sessionSeq}｜turnId=${unit.turnId}` +
177:         `｜batchId=${unit.batchId.slice(0, 24)}…｜决定 ${unit.decisionCount} 条｜三类不支持保持：${preserved}`,
```

### scripts/real-docs/metrics.mjs

```text
52: function sha256(bytes) {
53:   return createHash('sha256').update(bytes).digest('hex')
68:     for (const field of ['id', 'file', 'bytes', 'sha256', 'pages', 'language', 'source']) {
79:     if (!/^[0-9a-f]{64}$/u.test(doc.sha256)) {
80:       throw new CorpusError('CORPUS_MANIFEST_INVALID', `${doc.file} 的 sha256 不是 64 位小写十六进制`)
88:     if (seen.has(doc.id)) {
89:       throw new CorpusError('CORPUS_MANIFEST_INVALID', `manifest 里 id 重复：${doc.id}`)
91:     seen.add(doc.id)
107:       missing.push({ id: doc.id, file: doc.file, absolutePath })
111:     const actualSha256 = sha256(bytes)
112:     if (bytes.byteLength !== doc.bytes || actualSha256 !== doc.sha256) {
114:         id: doc.id,
118:         expectedSha256: doc.sha256,
123:     verified.push({ doc, absolutePath, bytes, sha256: actualSha256 })
216: export function compareGroundTruth(docId, candidates, truths) {
217:   const details = truths.filter(t=>t.docId===docId).map(truth=>{
238:     return {docId,page:truth.page,rect:truth.rect,originalText:truth.originalText,expectedQ,
241:       matches:matches.map(c=>({candidateId:c.candidateId,status:c.status,nominal:c.data.nominal?.text,
253:  * 再按 batchId 整批撤销；三组数字（前 / 后 / 撤销后）都记在行里。任一步失败、
279:     documentId: `real-doc-${entry.doc.id}`,
280:     revisionId: `real-doc-${entry.doc.id}-${entry.sha256.slice(0, 12)}`,
281:     sha256: entry.sha256,
286:     projectId: 'real-doc-baseline',
305:     id: entry.doc.id,
343:     .map((candidate) => candidate.candidateId)
348:     candidateIds: ids,
353:     turnId: options.turnId,
362:     (candidateId) =>
363:       afterCandidates.find((candidate) => candidate.candidateId === candidateId)?.status ===
385:     batchId: attested.value.batchId,
406:       turnId: options.turnId,
408:       batchId: attested.value.batchId,
411:       decisionCount: attested.value.decisionIds.length,
447:     pageLimitDocuments: rows.filter((row) => row.pageLimit !== null).map((row) => row.id),
489:             label: `${entry.doc.id} ${entry.doc.file}`,
491:             turnId: `real-doc-attest-${index + 1}`,
494:     measured.row.correctness = compareGroundTruth(entry.doc.id, measured.draft.candidates, groundTruth)
504:       projectId: 'real-doc-baseline',
512:       id: `${measured.row.id}@1-${to}`,
513:       forDocument: measured.row.id,
```

### scripts/supersub-artifact.mjs

```text
12: const sha256=createHash('sha256').update(readFileSync(asar)).digest('hex')
14: writeFileSync('docs/evidence/supersub-fix/package-proof.json',serializeEvidence({asar,sha256,main:pkg.main,markers,passed:true}))
15: console.log({asar,sha256,markers})
```

### scripts/supersub-mutations.mjs

```text
36:     if (text.split(mutation.from).length !== 2) throw new Error(`Nonunique mutation ${mutation.id}`)
38:     const red = run(mutation.id, 'red', mutation.test)
40:     const green = run(mutation.id, 'green', mutation.test)
41:     if (red.exit !== 1 || green.exit !== 0) throw new Error(`${mutation.id}: expected red=1 green=0`)
42:     results.push({ id: mutation.id, mutation: mutation.to, red, green })
```

### scripts/supersub-report.mjs

```text
10: const after=metrics.documents.filter(d=>['r2','r5','r6'].includes(d.id)).flatMap(d=>d.correctness.details)
12: const comparison=after.map((row,i)=>({index:i+1,...row,before:before.flatMap(d=>d.details).find(d=>d.docId===row.docId&&d.cropFile===row.cropFile)?.matches}))
20: for(const r of comparison) lines.push(`| ${r.index} | ${r.docId}/p${r.page} | ${r.originalText} | ${r.before.map(m=>m.nominal).join(', ')} | ${r.matches.map(m=>m.nominal).join(', ')} | ${r.matches.map(m=>`${m.upperDeviation??'无'}/${m.lowerDeviation??'无'}`).join('; ')} | ${r.matches.map(m=>m.status).join(', ')} |`)
26: writeFileSync('docs/evidence/supersub-fix/index.html',`<!doctype html><html lang="zh"><meta charset="utf-8"><title>上下标修复裁片与真值对照</title><style>body{font:16px system-ui;margin:32px;max-width:1200px}img{max-width:100%;border:1px solid #bbb}figure{padding:16px;background:#f7f7f7}td,th{border:1px solid #ccc;padding:8px}table{border-collapse:collapse}code{white-space:pre-wrap}</style><h1>上下标与公差粘连修复</h1><p>${escape(JSON.stringify(metrics.summary.correctness))}</p><h2>三张原件裁片示例</h2>${examples.map(t=>`<figure><figcaption>${escape(t.docId+' p'+t.page+' '+t.originalText)}</figcaption><img src="../ground-truth/${t.cropFile}"></figure>`).join('')}<h2>19 条逐条对照</h2><table><tr><th>文档/页</th><th>原文</th><th>改前 nominal</th><th>改后 nominal</th><th>状态</th></tr>${comparison.map(r=>`<tr><td>${r.docId} p${r.page}</td><td>${escape(r.originalText)}</td><td>${escape(r.before.map(m=>m.nominal).join(','))}</td><td>${escape(r.matches.map(m=>m.nominal).join(','))}</td><td>${r.matches.map(m=>m.status).join(',')}</td></tr>`).join('')}</table></html>`)
```

### scripts/unit-attest-state-seed.ts

```text
46:   doc: { id: string; file: string; sha256: string; pages: number }
57:     ) as { documents: { id: string; file: string; sha256: string; pages: number }[] }
61:       const sha256 = createHash('sha256').update(bytes).digest('hex')
62:       expect(sha256, `语料 ${doc.file} 与 manifest sha256 不一致`).toBe(doc.sha256)
70:         projectId: 'project-a',
73:           documentId: `doc-${index + 1}`,
74:           revisionId: `sr-${index + 1}`,
75:           sha256,
84:         .map((candidate) => candidate.candidateId)
86:         candidateIds: ids,
91:         turnId: `unit-attest-seed-${index + 1}`,
102:       item.attest.candidateIds.map((candidateId) => {
103:         const candidate = item.draft.candidates.find((entry) => entry.candidateId === candidateId)
104:         expect(candidate, `${candidateId} 不在补单位后的草稿里`).toBeDefined()
105:         if (candidate === undefined) throw new Error(`missing candidate ${candidateId}`)
114:         expect(ref, `${candidateId} 缺少 user-attestation`).toBeDefined()
117:         expect(ref.actorId).toBe(ACTOR)
120:         expect(typeof ref.turnId === 'string' && ref.turnId !== '').toBe(true)
123:           documentId: `doc-${corpus.indexOf(item) + 1}`,
124:           candidateId,
125:           actorId: ref.actorId,
127:           turnId: ref.turnId,
146:       latestRevisionId: `sr-${index + 1}`,
151:       documentId: `doc-${index + 1}`,
153:       sha256: item.doc.sha256,
161:       sha256: item.doc.sha256,
166:       actorId: entry.actorId,
172:       turnId: entry.turnId ?? null,
179:         actorId: ACTOR,
187:       bindings: [{ ...base.bindings[0]!, documentId: 'doc-1', revisionId: 'sr-1' }],
204:     expect(readBack.every((entry) => entry.actorId === ACTOR)).toBe(true)
205:     expect(readBack.every((entry) => typeof entry.turnId === 'string' && entry.turnId !== '')).toBe(true)
```

### scripts/v35-seed.ts

```text
44:       const session = harness.projectService.getSession(opened.sessionId)!
46:         sessionId: opened.sessionId,
51:         sessionId: opened.sessionId,
53:         expectedFingerprint: session.fingerprint,
```

### scripts/v36-ambiguous-seed.ts

```text
38:       projectId: base.project.id,
39:       baseToken: `base-${base.project.id}`,
41:         documentId: document.id,
42:         revisionId: revision.id,
43:         sha256: sha,
67:           sha256: sha,
72:       blobs: [{ ...base.blobs[0]!, sha256: sha, byteSize: pdf.byteLength }],
```

### scripts/v36-drafts-seed.ts

```text
45:       documentId: base.documents[0]!.id,
46:       revisionId: base.revisions[0]!.id,
47:       sha256: sha,
53:         projectId: base.project.id,
54:         baseToken: `base-${base.project.id}`,
67:       candidateId: target!.candidateId,
92:           sha256: sha,
97:       blobs: [{ ...base.blobs[0]!, sha256: sha, byteSize: pdf.byteLength }],
107:     console.log(`OLD_DRAFT ${confirmed.value.draftId}`)
108:     console.log(`NEW_DRAFT ${current.draftId}`)
```

### scripts/v36-evidence.ts

```text
27: async function extract(name: string, projectId: string): Promise<ExtractionDraft> {
30:     projectId,
33:       documentId: `doc-${projectId}`,
34:       revisionId: `rev-${projectId}`,
35:       sha256: fixtureSha256(name),
36:       blobKey: `blob-${projectId}`,
51:       sha256: fixtureSha256('taskbook-TB-2026-1110.pdf'),
62:       sha256: createHash('sha256').update(readFileSync(fixturePath(name))).digest('hex'),
```

### scripts/v36-seed.ts

```text
34:           sha256: sha,
39:       blobs: [{ ...base.blobs[0]!, sha256: sha, byteSize: pdf.byteLength }],
```

### scripts/v36-ui-seed.ts

```text
40:       expectedActiveRequirementRevisionId: previous.revisionId,
41:       requirementId: 'req-1',
42:       newRequirementId: 'req-1',
43:       newRevisionId: `reqrev-${version}`,
44:       newCheckId: `check-base-${version}`,
45:       newConfigRevisionId: `rev-cfg-${version}`,
54:       chainRef: { projectId: SAMPLE_PROJECT_ID, kind: 'project-dimension-chain' },
74:       projectId: snapshot.project.id,
75:       baseToken: `base-${snapshot.project.id}`,
77:         documentId: revision.documentId,
78:         revisionId: revision.id,
79:         sha256: revision.sha256,
```

### scripts/v40-stage1-audit.mjs

```text
10:   artifacts.push({ path: file, byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
```

### scripts/v40-stage1-mutations.mjs

```text
8:   ['M08', 'const plan = planApplication(draft, { source: draft.sourceIdentity, candidateIds: req.candidateIds })', `const plan = { ok: true as const, value: { applied: false as const, items: draft.candidates.filter(c => req.candidateIds.includes(c.candidateId)).map(c => ({ candidateId: c.candidateId, kind: c.kind, groupId: c.groupId, fields: candidateNumericFields(c).map(({ field, value }) => ({ field, text: value.text, valueQ: value.valueQ, unit: value.unit })), evidence: c.evidence })) } }`, '02 伪造'],
9:   ['M09', "if (req.baseRevisionId !== revisionId) throw new MappingError('STALE_BASE', '计划正式基准已过期')", '// M09: formal basis check deliberately removed', '03 基准过期'],
```

### scripts/v40-stage1-packaged.mjs

```text
40:   socket.addEventListener('message', e => { const r = JSON.parse(e.data); if (pending.has(r.id)) { pending.get(r.id)(r); pending.delete(r.id) } })
61:     if (attached?.ok && attached.value?.snapshot?.project?.id === 'v40-stage1-seed') break
64:   if (attached?.value?.snapshot?.project?.id !== 'v40-stage1-seed') throw new Error(`seed not active: ${JSON.stringify(attached)}`)
68:       const start = performance.now(), callerRequest = input?.requestId ?? crypto.randomUUID()
71:         elapsedMs: performance.now() - start, requestId: output.requestId ?? callerRequest,
72:         requestIdOrigin: output.requestId ? 'service' : 'caller-correlation-legacy-ipc' })
78:     const sessionId = initial.value.sessionId, baseRevisionId = initial.value.snapshot.project.currentRevisionId
79:     const run = await call('runExtraction', { sessionId, baseEditSeq: seq, revisionId: 'sr-1', pageFrom: 1, pageTo: 2, requestId: crypto.randomUUID() }, r => ({ ok: r.ok, candidateCount: r.value?.candidateCount, draftId: r.value?.draftId, acceptedSeq: r.value?.acceptedSeq }))
81:     const extraction = run.snapshot.project.extractionDrafts.find(d => d.draftId === run.draftId)
84:       const decision = await call('decideExtraction', { sessionId, baseEditSeq: seq, draftId: extraction.draftId, candidateId: c.candidateId, editRevision: c.editRevision, action: 'confirm', confirmed: true }, r => ({ ok: r.ok, status: r.value?.status, decisionId: r.value?.decisionId, planTokenIssued: Boolean(r.value?.planToken), acceptedSeq: r.value?.acceptedSeq }))
87:     const inputs = await call('getConfirmedInputs', { draftId: extraction.draftId }, r => ({ ok: r.ok, objectVersion: r.objectVersion, candidates: r.data?.candidates.map(c => ({ kind: c.kind, status: c.status, editRevision: c.editRevision })), decisions: r.data?.decisions.length }))
88:     const request = { planToken, baseRevisionId, candidateIds: inputs.candidates.map(c => c.candidateId), mapping: {
89:       spacerPart: 'builtin:shaft-demo:spacer', ringSymbols: ['H', 'B1', 'S', 'B2'], formulaId: inputs.candidates.find(c => c.kind === 'formula').candidateId, requirement: true, linkLengthToSymbol: 'S',
91:     const summarize = r => ({ ok: r.ok, objectVersion: r.objectVersion, draftId: r.data?.draftId, draftRevision: r.data?.draftRevision, geometry: r.data?.geometry, checkStatus: r.data?.checkStatus, result: r.data?.computation?.result, requirementPreview: r.data?.requirementPreview, missing: r.data?.missing })
94:     const preview = await call('previewAndCheck', { toolMode: 'agent', draftId: applied.draftId, baseRevisionId }, summarize)
95:     const context = await call('getProjectContext', undefined, r => ({ ok: r.ok, objectVersion: r.objectVersion, projectId: r.data?.projectId, revisionId: r.data?.revisionId, draftId: r.data?.draft?.draftId, formalParameters: r.data?.parameters }))
96:     const staged = await call('stageParameterChange', { toolMode: 'agent', draftId: applied.draftId, baseRevisionId, parameter: 'length', deltaMm: '0.04', lockedKeys: ['innerDiameter', 'outerDiameter'] }, summarize)
97:     const changedPreview = await call('previewAndCheck', { toolMode: 'agent', draftId: staged.draftId, baseRevisionId }, summarize)
99:     return { trace, applied, duplicateId: duplicate.draftId, preview, changedPreview, currentDraftId: context.draft.draftId,
100:       formalUnchanged: JSON.stringify(final.value.snapshot.project.dimensionChain) === JSON.stringify(initial.value.snapshot.project.dimensionChain) && final.value.snapshot.project.currentRevisionId === baseRevisionId && final.value.snapshot.project.parameters.length === 0 && final.value.snapshot.project.requirementRevisions.length === 0,
101:       sourceSha256: extraction.sourceIdentity.sha256, candidateCount: inputs.candidates.length,
111:   assert('length binding', d.bindings.length === 1 && d.bindings[0].termId === 't-s' && d.bindings[0].parameterId === 'param:spacer:length')
115:   assert('idempotent draft identity', result.duplicateId === d.draftId && result.currentDraftId === d.draftId)
119:   const draftPath = path.join(isolatedHome ?? process.env.HOME, 'Library/Application Support/寸链/workspace/agent-inputs', `${createHash('sha256').update('v40-stage1-seed').digest('hex')}.json`)
121:   assert('actual workspace draft+recovery record read back', persisted.payload.draft.draftId === d.draftId && persisted.payload.recovery.basePath === seed)
122:   await fs.writeFile(`${dir}/a40-01-packaged-trace.json`, serializeEvidence({ ...result, persistedDraftPath: draftPath, seedSha256: createHash('sha256').update(before).digest('hex'), generatedAt: new Date().toISOString() }))
```

### scripts/v40-stage2-mutations.mjs

```text
24:     '  private isStaleReply(entry: TaskEntry): boolean {\n    return entry.task.projectId !== this.activeProjectId\n  }',
25:     '  private isStaleReply(entry: TaskEntry): boolean {\n    // M12: projectId identity check deliberately removed.\n    void entry\n    return false\n  }',
```

### scripts/v40-stage3-mutations.mjs

```text
40:       '  async reserve(approvalId: string, windowId: number): Promise<ApprovalLookup> {',
42:       `  async reserve(approvalId: string, windowId: number): Promise<ApprovalLookup> {
43:     // M13: 一次性消费/占用检查被人为移除，同一 approvalId 可再次通过。
44:     void windowId
45:     const cached = this.cache.get(approvalId)
47:     return this.load(approvalId)
53:     description: '允许同一 approvalId 重复消费（移除 reserve 的 consumedAt/claims/窗口/有效期门禁）',
63:         if (recomputedFingerprint !== approval.previewFingerprint) {
67:         void recomputedFingerprint`,
102:   const before = `${dir}/${variant.id}-before.txt`
103:   const after = `${dir}/${variant.id}-after.txt`
107:   await fs.writeFile(`${dir}/${variant.id}.patch`, `# ${variant.description}\n${diff.stdout}`)
114:       await fs.writeFile(`${dir}/${variant.id}-${test.name}-red.log`, `$ ${test.cmd} ${test.args.join(' ')}\n# ${variant.description}\n${red.stdout}${red.stderr}\nexitCode=${red.status}\n`)
115:       console.log(`${variant.id} ${test.name} RED exit=${red.status}`)
123:     await fs.writeFile(`${dir}/${variant.id}-${test.name}-green.log`, `$ ${test.cmd} ${test.args.join(' ')}\n${green.stdout}${green.stderr}\nexitCode=${green.status}\n`)
124:     console.log(`${variant.id} ${test.name} GREEN exit=${green.status}`)
```

### scripts/v40-stage3-seed.ts

```text
33:         activeRequirementRevisionId: null,
37:       revisions: [{ ...base.revisions[0]!, fileName: PDF_NAME, sha256: sha, byteSize: pdf.byteLength, pageCount: 2 }],
38:       blobs: [{ ...base.blobs[0]!, sha256: sha, byteSize: pdf.byteLength }],
```

### scripts/v40-stage4-export-artifact.ts

```text
21: import { sha256Hex } from '../src/sources/hash'
29:  * 那份带当次随机 revisionId，不适合当“可复算产物”的输入。
58:       expectedFingerprint: existing,
67:     const diskHash = await sha256Hex(diskBytes)
71:       sourceSha256: await sha256Hex(projectBytes),
74:       sha256: diskHash,
```

### scripts/v40-stage4-metrics.mjs

```text
65: - 供应商回执模型：${data.providerProbe?.model ?? 'n/a'}（请求 ${data.adapter?.modelRequested}，适配器 ${data.adapter?.id}）
```

### scripts/v40-stage4-seed.ts

```text
16: import { sha256Hex } from '../src/sources/hash'
25:     const sha256 = await sha256Hex(bytes)
35:           source: { ...revision.source, sha256 },
39:       revisions: [{ ...base.snapshot.revisions[0]!, fileName, sha256, byteSize: bytes.byteLength, pageCount: 2 }],
40:       blobs: [{ ...base.snapshot.blobs[0]!, sha256, byteSize: bytes.byteLength }],
```

### scripts/verify-draft-sync.mjs

```text
26:   hashes.push({ file, byteSize:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex') })
```

### scripts/verify-evidence-repro.mjs

```text
39:     const result = run('shasum', ['-a', '256', ...comparisonFiles], `${root}/logs/evidence-repro/sha256-${pass}.log`)
```

### src/App.tsx

```text
11:   | { page: 'workspace'; projectId: string }
12:   | { page: 'snapshots'; projectId: string; legacyNotice: string | null }
13:   | { page: 'report'; projectId: string; snapshotId: string }
29:         projectId: decodeURIComponent(reportMatch[1]),
30:         snapshotId: decodeURIComponent(reportMatch[2]),
44:         projectId: decodeURIComponent(snapshotsMatch[1]),
60:         projectId: decodeURIComponent(legacyReportMatch[1]),
73:     return { page: 'workspace', projectId: decodeURIComponent(match[1]) }
79: function workspaceHash(projectId: string): string {
80:   return `${PROJECTS_HASH}/${encodeURIComponent(projectId)}`
83: function snapshotsHash(projectId: string): string {
84:   return `${workspaceHash(projectId)}/snapshots`
87: function reportHash(projectId: string, snapshotId: string): string {
88:   return `${workspaceHash(projectId)}/reports/${encodeURIComponent(snapshotId)}`
110:   const openProject = (projectId: string): void => {
111:     const nextHash = workspaceHash(projectId)
115:     setRoute({ page: 'workspace', projectId })
125:   const openSnapshots = (projectId: string): void => {
126:     const nextHash = snapshotsHash(projectId)
130:     setRoute({ page: 'snapshots', projectId, legacyNotice: null })
133:   const openReport = (projectId: string, snapshotId: string): void => {
134:     const nextHash = reportHash(projectId, snapshotId)
138:     setRoute({ page: 'report', projectId, snapshotId })
145:         key={`${route.projectId}:${route.snapshotId}`}
146:         projectId={route.projectId}
147:         snapshotId={route.snapshotId}
156:         key={route.projectId}
157:         projectId={route.projectId}
167:         key={route.projectId}
168:         projectId={route.projectId}
```

### src/agent-tools/mapConfirmed.ts

```text
23:   formulaId?: string
64:     throw new MappingError('CONSTRAINT_VIOLATED', `字段重复：${field}`, { candidateId: item.candidateId })
79:   { draftId, now }: { draftId: string; now: string },
83:     return mapIntentChain(snapshot, draft, plan, mapping, { draftId, now })
92:   const candidates = new Map(draft.candidates.map((candidate) => [candidate.candidateId, candidate]))
94:     if (candidates.get(item.candidateId)?.kind !== item.kind) {
95:       throw new MappingError('INVALID_INPUT', '计划引用的候选不存在或类型不符', { candidateId: item.candidateId })
120:         parameterId: SPACER_PARAMETER_IDS[key], partId: SPACER_PART_ID, key,
139:     .filter((item) => mapping.formulaId === undefined || item.candidateId === mapping.formulaId)
141:   const formulaCandidate = formulas[0] === undefined ? undefined : candidates.get(formulas[0].candidateId)
154:       const candidate = candidates.get(item.candidateId)
171:       const candidate = candidates.get(item.candidateId)
190:     changed.add(term.id)
196:       const term = chain.terms.find((entry) => entry.id === link.termId)
197:       const parameter = parameters.find((entry) => entry.parameterId === link.parameterId)
199:           !changed.has(term.id) && term.nominalQ !== parameter.valueQ) {
209:     if (!changed.has(term.id)) lack(`bindings.${term.symbol}`, '长度绑定需要完整的已映射环数值与方向')
211:       const existing = bindings.find((binding) => binding.termId === term.id)
212:       if (existing !== undefined && existing.parameterId !== SPACER_PARAMETER_IDS.length) {
216:         kind: 'parameter-binding', bindingId: `binding:${draftId}:${term.id}:length`,
217:         termId: term.id, partId: SPACER_PART_ID, parameterId: SPACER_PARAMETER_IDS.length,
224:     const term = chain.terms.find((entry) => entry.id === binding.termId)
225:     const parameter = parameters.find((entry) => entry.parameterId === binding.parameterId)
227:       throw new MappingError('CONSTRAINT_VIOLATED', '参数绑定与组成环基本尺寸不相等', { bindingId: binding.bindingId })
236:     const candidate = interval === undefined ? undefined : candidates.get(interval.candidateId)
255:         const active = snapshot.project.requirementRevisions.find((revision) => revision.revisionId === snapshot.project.activeRequirementRevisionId)
257:           requirementId: active?.requirementId ?? null, editRevision: 1,
259:           source: { documentId: evidence.documentId, revisionId: evidence.revisionId, page: evidence.page,
270:     const computation = computeChange(candidateSnapshot, { parameters, bindings }, { revisionId: draftId, now })
274:     computation.changedTermIds = [...new Set([...computation.changedTermIds, ...changed])]
275:     computation.affectedTermIds = [...new Set([...computation.affectedTermIds, ...changed])]
277:       const before = previousChain.terms.find((term) => term.id === row.termId)!
```

### src/agent-tools/mapIntent.ts

```text
12: import { stableId } from '../document-extraction/ids'
28:     throw new MappingError('CONSTRAINT_VIOLATED', `字段重复：${field}`, { candidateId: item.candidateId })
41:     const candidate = candidates.get(item.candidateId)
52:   { draftId, now }: { draftId: string; now: string },
61:   const candidates = new Map(draft.candidates.map((candidate) => [candidate.candidateId, candidate]))
63:     if (candidates.get(item.candidateId)?.kind !== item.kind) {
64:       throw new MappingError('INVALID_INPUT', '计划引用的候选不存在或类型不符', { candidateId: item.candidateId })
80:   const formulaCandidate = candidates.get(formulas[0]!.candidateId)
116:       id: stableId('intent-term', [draft.draftId, symbol]),
155:       parameterId: SPACER_PARAMETER_IDS[key],
156:       partId: SPACER_PART_ID,
195:     const computation = computeChange(candidateSnapshot, { parameters, bindings }, { revisionId: draftId, now })
```

### src/agent/redact.ts

```text
6: import { stableFingerprint } from '../revisions/canonical'
12:   return stableFingerprint(value)
19:   return `${cleaned.slice(0, maxLength)}…<${cleaned.length} chars ${stableFingerprint(cleaned)}>`
```

### src/agent/toolSchemas.ts

```text
24:   properties: { draftId: idSchema },
25:   required: ['draftId'],
33:     baseRevisionId: idSchema,
34:     candidateIds: { type: 'array', items: idSchema, minItems: 1, maxItems: 200 },
40:         formulaId: idSchema,
48:   required: ['planToken', 'baseRevisionId', 'candidateIds', 'mapping'],
56:     draftId: idSchema,
57:     baseRevisionId: idSchema,
63:   required: ['toolMode', 'draftId', 'baseRevisionId', 'parameter', 'lockedKeys'],
75:     draftId: idSchema,
76:     baseRevisionId: idSchema,
78:   required: ['toolMode', 'draftId', 'baseRevisionId'],
173:         projectId: idSchema, draftId: idSchema, statement: statementSchema,
175:           { type: 'object', additionalProperties: false, properties: { kind: { const: 'pdf-page' }, revisionId: idSchema,
176:             sha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' }, page: { type: 'integer' } }, required: ['kind', 'revisionId', 'sha256', 'page'] },
177:           { type: 'object', additionalProperties: false, properties: { kind: { const: 'image' }, imageId: idSchema,
178:             sha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' } }, required: ['kind', 'imageId', 'sha256'] },
209:   confirmed: { name: 'confirmed', description: '读取提取草稿的已确认候选（紧凑视图：candidateId、kind、summary、原文摘录）与冲突问题。只读。', parameters: confirmed },
212:     description: '按用户已确认的候选建立工程草稿。mapping.formulaId 取 kind="formula" 候选的 candidateId；mapping.ringSymbols 是组成环符号顺序；linkLengthToSymbol 指隔套长度绑定的环。返回新建草稿的 draftId，后续 stage/preview 必须使用它。',
```

### src/agent/types.ts

```text
63:   toolCallId?: string
91:   taskId: string
110:   cancel(taskId: string): void
114:   taskId: string
115:   projectId: string
116:   baseRevisionId: string
118:   modelId: string
132:   stepId: string
133:   taskId: string
```

### src/backup/backupFormat.ts

```text
30: function encodeId(value: string): string {
39:   return `${BACKUP_PATH_PREFIX[kind]}${encodeId(id)}.${extension}`
```

### src/backup/projectBundle.ts

```text
42: import { sha256Hex } from '../sources/hash'
69:   sha256: string
80:   revisionId: string
81:   documentId: string
156:   migrationBackups: { id: string; projectId: string }[]
229:     const migrationBackups = await getAll<{ id: string; projectId: string }>(
284:         `未迁移项目：${legacy.id}`,
294:       addJson(backupPath('projects', project.id), project)
297:       addJson(backupPath('drafts', draft.projectId), draft)
300:       addJson(backupPath('documents', document.id), document)
303:       addJson(backupPath('revisions', revision.id), revision)
309:         projectId: blob.projectId,
310:         sha256: blob.sha256,
320:       addJson(backupPath('bindings', binding.id), binding)
323:       addJson(backupPath('events', event.id), event)
326:       addJson(backupPath('snapshots', snapshot.id), snapshot)
329:       addJson(backupPath('importSnapshots', snapshot.id), snapshot)
332:       addJson(backupPath('migrationBackups', backup.id), backup)
344:         sha256: await sha256Hex(file.bytes),
355:         revisionId: revision.id,
356:         documentId: revision.documentId,
359:       .sort((left, right) => left.revisionId.localeCompare(right.revisionId))
386:         .sort((left, right) => left.id.localeCompare(right.id))
388:           id: project.id,
```

### src/backup/restore.ts

```text
13: import { addChangeEvent, changeEventId } from '../history/events'
144:             projectId: blob.projectId,
145:             sha256: blob.sha256,
178:             id: `${changeEventId(
180:               project.id,
182:             projectId: project.id,
195:               id: project.id,
```

### src/backup/restoreParser.ts

```text
20: import { sha256Hex } from '../sources/hash'
84:     projectId: string
85:     sha256: string
93:   migrationBackups: { id: string; projectId: string }[]
122: const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
153:         revisionId: z.string().min(1),
154:         documentId: z.string().min(1),
169:       sha256: sha256Schema,
219:   projectId: z.string().min(1),
226:   projectId: z.string().min(1),
228:   latestRevisionId: z.string().min(1),
233:   projectId: z.string().min(1),
234:   documentId: z.string().min(1),
236:   sha256: sha256Schema,
245:   projectId: z.string().min(1),
246:   sha256: sha256Schema,
254:   latestRevisionId: z.string().min(1),
259:   projectId: z.string().min(1),
260:   termId: z.string().min(1),
261:   revisionId: z.string().min(1),
262:   documentId: z.string().min(1),
276:     projectId: z.string().min(1),
293:     z.object({ termId: z.string(), toleranceQ: z.number() }),
323:     termId: z.string().min(1),
330:     bindingId: z.string().min(1),
331:     termId: z.string().min(1),
332:     documentId: z.string().min(1),
333:     revisionId: z.string().min(1),
342:   termId: z.string().min(1).optional(),
343:   bindingId: z.string().min(1).optional(),
344:   documentId: z.string().min(1).optional(),
345:   revisionId: z.string().min(1).optional(),
350:   ruleId: reviewRuleIdSchema,
400:     termId: z.string().min(1),
406:     termId: z.string().min(1),
412:     termId: z.string().min(1),
420:   addedTermIds: z.array(z.string().min(1)),
421:   removedTermIds: z.array(z.string().min(1)),
446:   bindingId: z.string().min(1),
447:   termId: z.string().min(1),
450:   documentId: z.string().min(1),
452:   revisionId: z.string().min(1),
454:   revisionSha256: sha256Schema.nullable(),
470:   projectId: z.string().min(1),
475:   inputFingerprint: z.string().min(1),
484:     unboundTermIds: z.array(z.string().min(1)),
499:   projectId: z.string().min(1),
506:   .object({ id: z.string().min(1), projectId: z.string().min(1) })
565:   // latestRevisionId 是“当前”指针：快照冻结的是创建时的版本（例如 v1），
569:   // latestRevisionId 必须指向 manifest.revisions 中的版本。
570:   return left.id === right.id && left.projectId === right.projectId
575:     left.id === right.id &&
576:     left.projectId === right.projectId &&
577:     left.documentId === right.documentId &&
579:     left.sha256 === right.sha256 &&
600:       term.id === other.id &&
626:     finding.ruleId,
629:     finding.subject.id,
641:   snapshotId: string,
643:   const prefix = `分析快照 ${snapshotId} 的结果`
656:   const termIds = definition.terms.map((term) => term.id)
657:   if (!sameJson(result.contributions.map((item) => item.termId), termIds)) {
683:   const prefix = `分析快照 ${snapshot.id} 的审查结果`
713:       return `${prefix}中 ${finding.ruleId} 的规则版本不一致`
715:     const expectedScope = RULE_SCOPES[finding.ruleId]
717:       return `${prefix}中 ${finding.ruleId} 的作用域无效`
720:       return `${prefix}中 ${finding.ruleId} 已通过却要求人工动作`
724:       if (subject.kind !== 'chain' || subject.id !== 'chain') {
725:         return `${prefix}中 ${finding.ruleId} 的链级对象无效`
732:         return `${prefix}中 ${finding.ruleId} 的定位目标无效`
737:         subject.termId === undefined ||
738:         subject.id !== subject.termId ||
740:         finding.target.termId !== subject.termId
742:         return `${prefix}中 ${finding.ruleId} 的组成环对象无效`
747:         subject.bindingId === undefined ||
748:         subject.id !== subject.bindingId ||
749:         subject.termId === undefined ||
750:         subject.documentId === undefined ||
751:         subject.revisionId === undefined ||
754:         return `${prefix}中 ${finding.ruleId} 的绑定对象无效`
758:         finding.target.bindingId !== subject.bindingId ||
759:         finding.target.termId !== subject.termId ||
760:         finding.target.documentId !== subject.documentId ||
761:         finding.target.revisionId !== subject.revisionId ||
764:         return `${prefix}中 ${finding.ruleId} 的定位目标与绑定对象不一致`
825:   const prefix = `分析快照 ${snapshot.id} 的来源清单`
827:   const documentById = new Map<string, SourceDocument>()
829:     if (documentById.has(document.id)) {
830:       return `${prefix}包含重复的来源文档 ${document.id}`
832:     if (document.projectId !== snapshot.projectId) {
833:       return `${prefix}的来源文档 ${document.id} 属于其它项目`
835:     if (!backupDocuments.has(document.id)) {
836:       return `${prefix}的来源文档 ${document.id} 在备份中不存在`
838:     documentById.set(document.id, document)
840:   const revisionById = new Map<string, SourceRevision>()
842:     if (revisionById.has(revision.id)) {
843:       return `${prefix}包含重复的来源版本 ${revision.id}`
845:     if (revision.projectId !== snapshot.projectId) {
846:       return `${prefix}的来源版本 ${revision.id} 属于其它项目`
848:     const document = documentById.get(revision.documentId)
850:       return `${prefix}的来源版本 ${revision.id} 的文档不存在`
852:     const backupRevision = backupRevisions.get(revision.id)
854:       return `${prefix}的来源版本 ${revision.id} 与备份记录不一致`
856:     const backupDocument = backupDocuments.get(document.id)
858:       return `${prefix}的来源文档 ${document.id} 与备份记录不一致`
860:     revisionById.set(revision.id, revision)
863:     if (!revisionById.has(document.latestRevisionId)) {
864:       return `${prefix}的来源文档 ${document.id} 最新版本不在清单内`
868:   const termById = new Map(snapshot.definition.terms.map((term) => [term.id, term]))
869:   const bindingIds = new Set<string>()
871:     if (bindingIds.has(entry.bindingId)) {
872:       return `${prefix}包含重复的绑定 ${entry.bindingId}`
874:     bindingIds.add(entry.bindingId)
875:     const revision = revisionById.get(entry.revisionId)
876:     const document = documentById.get(entry.documentId)
878:       return `${prefix}的绑定 ${entry.bindingId} 引用的版本不在清单内`
881:       return `${prefix}的绑定 ${entry.bindingId} 引用的文档不在清单内`
884:       revision.documentId !== document.id ||
886:       entry.revisionSha256 !== revision.sha256 ||
891:       return `${prefix}的绑定 ${entry.bindingId} 与版本/文档元数据不一致`
894:       return `${prefix}的绑定 ${entry.bindingId} 页码超出页数`
897:       return `${prefix}的绑定 ${entry.bindingId} 声称附件可用，但备份中没有该附件`
899:     const term = termById.get(entry.termId)
902:         return `${prefix}的绑定 ${entry.bindingId} 指向已删除组成环却保留了环信息`
910:             : term.id
912:         return `${prefix}的绑定 ${entry.bindingId} 的环信息与冻结定义不一致`
919:       (term) => !manifest.bindings.some((entry) => entry.termId === term.id),
921:     .map((term) => term.id)
922:   if (!sameJson(manifest.unboundTermIds, expectedUnbound)) {
945:     return `分析快照 ${snapshot.id} 有冻结对比结果却没有基线`
948:   const prefix = `分析快照 ${snapshot.id} 的冻结基线对比`
980:     return `分析快照 ${snapshot.id} 的草稿无法转换为尺寸链`
983:     return `分析快照 ${snapshot.id} 的草稿与冻结定义不一致`
988:     snapshot.id,
1022: function isRetiredProjectId(projectId: string): boolean {
1023:   return projectId.includes('::retired::')
1114:     const digest = await sha256Hex(data)
1115:     if (digest !== entry.sha256) {
1153:         if (record.id !== id) {
1176:         if (record.projectId !== id) {
1177:           throw new BackupRecordError(`草稿文件名与 projectId 不一致：${path}`)
1183:         if (record.id !== id) {
1190:         if (record.id !== id) {
1210:         const digest = await sha256Hex(fileBytes)
1211:         if (digest !== record.sha256) {
1222:         if (record.id !== id) {
1232:         if (record.id !== id) {
1239:         if (record.id !== id) {
1264:         if (record.id !== id) {
1277:         if (record.id !== id) {
1301:   const backupDocuments = new Map(parsed.documents.map((item) => [item.id, item]))
1302:   const backupRevisions = new Map(parsed.revisions.map((item) => [item.id, item]))
1366:   const projectIds = new Set(backup.projects.map((project) => project.id))
1367:   if (projectIds.size !== backup.projects.length) {
1370:   const knownScope = (projectId: string): boolean =>
1371:     projectIds.has(projectId) || isRetiredProjectId(projectId)
1373:   const documentById = new Map(backup.documents.map((item) => [item.id, item]))
1374:   const revisionById = new Map(backup.revisions.map((item) => [item.id, item]))
1377:   const missingByRevision = new Map<string, { blobKey: string; documentId: string }>()
1379:     const revision = revisionById.get(missing.revisionId)
1381:       return `manifest 声明的缺失附件版本不存在：${missing.revisionId}`
1385:       revision.documentId !== missing.documentId
1387:       return `manifest 声明的缺失附件 ${missing.revisionId} 与版本记录不一致`
1389:     if (missingByRevision.has(missing.revisionId)) {
1390:       return `manifest 重复声明缺失附件：${missing.revisionId}`
1395:     missingByRevision.set(missing.revisionId, missing)
1399:     if (!projectIds.has(draft.projectId)) {
1400:       return `草稿引用的项目不存在：${draft.projectId}`
1405:     if (!knownScope(document.projectId)) {
1406:       return `来源文档引用的项目既不存在也不是已退役作用域：${document.projectId}`
1408:     const latest = revisionById.get(document.latestRevisionId)
1410:       return `来源文档 ${document.id} 的最新版本不存在：${document.latestRevisionId}`
1412:     if (latest.documentId !== document.id) {
1413:       return `来源文档 ${document.id} 的最新版本属于其它文档：${latest.id}`
1418:     const document = documentById.get(revision.documentId)
1420:       return `来源版本 ${revision.id} 引用的文档不存在：${revision.documentId}`
1422:     if (document.projectId !== revision.projectId) {
1423:       return `来源版本 ${revision.id} 与文档 ${document.id} 的项目作用域不一致`
1426:     const missing = missingByRevision.has(revision.id)
1431:         return `来源版本 ${revision.id} 的附件不存在，且 manifest 未声明缺失：${revision.blobKey}`
1436:       return `来源版本 ${revision.id} 在 manifest 中声明附件缺失，但备份中存在附件`
1438:     if (blob.projectId !== revision.projectId) {
1439:       return `来源版本 ${revision.id} 与附件 ${revision.blobKey} 的项目作用域不一致（拒绝跨项目附件引用）`
1441:     if (blob.sha256 !== revision.sha256 || blob.byteSize !== revision.byteSize) {
1442:       return `来源版本 ${revision.id} 与附件 ${revision.blobKey} 的哈希或大小不一致`
1447:     if (!knownScope(blob.projectId)) {
1448:       return `来源附件引用的项目既不存在也不是已退役作用域：${blob.projectId}`
1453:     if (!knownScope(binding.projectId)) {
1454:       return `绑定引用的项目既不存在也不是已退役作用域：${binding.projectId}`
1456:     const document = documentById.get(binding.documentId)
1458:       return `绑定 ${binding.id} 引用的来源文档不存在：${binding.documentId}`
1460:     const revision = revisionById.get(binding.revisionId)
1462:       return `绑定 ${binding.id} 引用的来源版本不存在：${binding.revisionId}`
1464:     if (revision.documentId !== binding.documentId) {
1465:       return `绑定 ${binding.id} 的版本与文档不匹配`
1467:     if (document.projectId !== binding.projectId) {
1468:       return `绑定 ${binding.id} 与来源文档的项目作用域不一致`
1471:       return `绑定 ${binding.id} 的页码 ${binding.page} 超出 ${revision.pageCount} 页`
1476:     if (!knownScope(event.projectId)) {
1477:       return `事件引用的项目既不存在也不是已退役作用域：${event.projectId}`
1482:     if (!projectIds.has(snapshot.projectId)) {
1483:       return `分析快照引用的项目不存在：${snapshot.projectId}`
1488:     if (!projectIds.has(snapshot.projectId)) {
1489:       return `替换前快照引用的项目不存在：${snapshot.projectId}`
```

### src/components/AgentReadEvidenceList.tsx

```text
11:       <small>{reading.source.kind === 'pdf-page' ? reading.source.revisionId : reading.source.imageId} · SHA-256 {reading.source.sha256}</small>
```

### src/components/AgentSidebar.tsx

```text
68:   revisionId: string | null
84: export function AgentSidebar({ open, onToggle, projectName, revisionId, onLocate, onProjectChanged }: AgentSidebarProps): JSX.Element {
95:   const [taskId, setTaskId] = useState<string | null>(null)
104:   const [actorId, setActorId] = useState('')
112:   useEffect(() => { taskIdRef.current = taskId }, [taskId])
139:       if (taskIdRef.current !== null && payload.task.taskId !== taskIdRef.current) return
152:     if (!open || taskId === null || api?.agentTaskState === undefined) return undefined
155:       const result = await api.agentTaskState!({ taskId })
167:   }, [api, open, taskId, refreshPreview, refreshIntent])
171:     setBusy(true); setNotice(null); setCommit(null); setPreview(null); setView(null); setTaskId(null)
174:       setTaskId(result.data.taskId)
184:     if (taskId === null || api?.agentCancel === undefined) return
186:     const result = await api.agentCancel({ taskId })
192:     if (taskId === null || api?.agentResume === undefined) return
194:     const result = await api.agentResume({ taskId })
202:     const issued = await api.issueAgentApproval({ previewId: preview.previewId })
209:       approvalId: issued.data.approvalId,
210:       draftId: preview.draftId,
211:       previewFingerprint: preview.previewFingerprint,
214:       setCommit({ ok: true, code: null, message: `已提交（工具回执） · 版本 ${committed.data.revisionId}` })
222:   const locate = async (request: { requirementRevisionId?: string; checkId?: string; parameterId?: string }): Promise<void> => {
227:       ? `已定位参数 ${parameterLabel(result.data.key)} · 绑定环 ${result.data.termIds.join('、') || '无'}`
234:     setBusy(true); setNotice(null); setCommit(null); setPreview(null); setView(null); setTaskId(null); setExportNote(null)
237:       setTaskId(result.data.taskId)
238:       setNotice(`已启动真实模型 · ${result.data.modelId}`)
289:       ? `已导出 · ${result.data.fileName} · ${result.data.byteSize} B · ${result.data.sha256?.slice(0, 12)}…`
309:       actorId: actorId.trim(),
313:       setIntentNote(`已建立无任务书项目：责任人 ${result.data.actorId} · 第 ${result.data.sessionSeq} 次输入`)
323:     if (actorId.trim() === '') { setIntentNote('先在“你的称呼”里填一个名字：出处要写清是谁说的'); return }
328:       intent: { actorId: actorId.trim(), ...(sessionLabel.trim() === '' ? {} : { sessionLabel: sessionLabel.trim() }) },
331:       setTaskId(result.data.taskId)
340:   const confirmIntentCandidate = async (candidateId: string, editRevision: number): Promise<void> => {
343:     const result = await api.intentConfirmCandidate({ candidateId, editRevision })
377:       previewId: intentPreviewValue.previewId,
386:       approvalId: issued.data.approvalId,
387:       draftId: intentPreviewValue.draftId,
388:       previewFingerprint: intentPreviewValue.previewFingerprint,
391:       ? { ok: true, message: `已保存为新版本（工具回执） · ${committed.data.revisionId}` }
403:   const intentPreviewValue = intentDraft !== null && intentDraft.previewId !== undefined &&
404:     intentDraft.previewFingerprint !== undefined
405:     ? { previewId: intentDraft.previewId, previewFingerprint: intentDraft.previewFingerprint, draftId: intentDraft.draftId }
406:     : (preview !== null ? { previewId: preview.previewId, previewFingerprint: preview.previewFingerprint, draftId: preview.draftId } : null)
428:         <div><dt>正式版本</dt><dd>{revisionId ?? '—'}</dd></div>
470:         <input value={actorId} maxLength={40} onChange={event => setActorId(event.target.value)} aria-label="责任人称呼" placeholder="例如 老王" />
479:         <button type="button" disabled={busy || !installed || actorId.trim() === ''} onClick={() => void createIntent()}>建立无任务书项目</button>
480:         <button type="button" disabled={busy || !installed || actorId.trim() === ''} title="假模型只把你说过的数字写进草稿；确认与提交仍由你完成" onClick={() => void startIntentDemo()}>对话建件（离线演示）</button>
486:             {intent.candidates.some((c) => agentReadSources(c.provenance ?? []).length > 0) ? '依据：外部读数，须对照来源逐条核对' : '依据：用户输入，无外部原文件'} · {intent.actorId ?? '未填责任人'} · 第 {intent.sessionSeq} 次输入
496:               <li key={candidate.candidateId} className="agent-sidebar__step">
504:                   : <button type="button" disabled={busy} onClick={() => void confirmIntentCandidate(candidate.candidateId, candidate.editRevision)}>确认这条</button>}
551:           <button type="button" disabled={busy || revisionId === null} onClick={() => void exportSaved('svg')}>导出已保存版本 SVG</button>
552:           <button type="button" disabled={busy || revisionId === null} onClick={() => void exportSaved('pdf')}>导出 PDF</button>
568:           {view.steps.map(step => <li key={step.stepId} className={step.errorCode === null ? 'agent-sidebar__step' : 'agent-sidebar__step agent-sidebar__step--failed'}>
599:         {recent.map(step => <li key={`recent-${step.stepId}`} className={step.errorCode === null ? 'agent-sidebar__step' : 'agent-sidebar__step agent-sidebar__step--failed'}>
611:           <div><dt>预览指纹</dt><dd className="agent-sidebar__mono">{preview.previewFingerprint.slice(0, 16)}…</dd></div>
625:           {preview.requirement !== null && <button type="button" disabled={busy} onClick={() => void locate({ requirementRevisionId: preview.requirementRevisionId ?? undefined })}>定位条款来源</button>}
```

### src/components/ChainDiagram.tsx

```text
1: import { useId, type KeyboardEvent } from 'react'
22:   selectedTermId?: string | null
23:   onSelect: (termId: string) => void
314:   selectedTermId = null,
317:   const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
318:   const titleId = `chain-diagram-title-${reactId}`
319:   const markerId = `chain-diagram-arrow-${reactId}`
320:   const selectedMarkerId = `chain-diagram-arrow-selected-${reactId}`
323:   const handleSelect = (termId: string) => {
324:     onSelect(termId)
329:     termId: string,
333:       handleSelect(termId)
386:           aria-labelledby={titleId}
390:           <title id={titleId}>{accessibleDescription(terms)}</title>
393:               id={markerId}
404:               id={selectedMarkerId}
439:             const selected = segment.term.id === selectedTermId
446:                 key={segment.term.id}
451:                 data-term-id={segment.term.id}
463:                 onClick={() => handleSelect(segment.term.id)}
464:                 onKeyDown={(event) => handleKeyDown(event, segment.term.id)}
519:                       markerEnd={`url(#${selected ? selectedMarkerId : markerId})`}
```

### src/components/ChangeWorkbench.tsx

```text
28:   sessionId: string | null
41:   onBind: (termId: string, partId: string, parameterId: string) => Promise<unknown>
42:   onUnbind: (bindingId: string) => Promise<unknown>
43:   onRestore: (revisionId: string) => Promise<unknown>
66:   const [selectedTerm, setSelectedTerm] = useState(project.dimensionChain.terms[0]?.id ?? '')
99:         (parameterId) => {
100:           const parameter = project.parameters.find((item) => item.parameterId === parameterId)
241:               <option key={term.id} value={term.id}>
266:               <li key={row.bindingId}>
283:                 <button type="button" disabled={busy} onClick={() => void run(() => props.onUnbind(row.bindingId))}>
316:           locateDisabled={props.sessionId === null}
329:               <li key={revision.revisionId}>
330:                 <span>Rev {revision.revisionId} · {revision.reason} · 父 {revision.parentId ?? '无'}</span>
331:                 {revision.revisionId !== project.currentRevisionId && (
332:                   <button type="button" disabled={busy} onClick={() => void run(() => props.onRestore(revision.revisionId))}>
348:                 <li key={term.termId}>
361:                 <li key={`${row.ruleId}-${index}`}>
362:                   {row.ruleId}：{row.reason}
363:                   {row.revisionId ? `（版本 ${row.revisionId} 第 ${row.page ?? '?'} 页）` : ''}
402:       <h3>预览：{preview.drawing.record.revisionId}</h3>
410:             <tr key={row.parameterId}>
418:             <tr key={row.bindingId}>
430:         绑定标注：{preview.drawing.right.annotations.map((item) => `${item.annotationId}（${item.parameterId}）`).join('、') || '无'}
437:           <figcaption>旧版本 {preview.drawing.left?.revisionId ?? '不可用'} · {preview.drawing.left ? `${preview.drawing.left.scale.numerator}:${preview.drawing.left.scale.denominator}` : '—'}</figcaption>
440:             selectedAnnotationId={null}
447:           <figcaption>当前草稿 {preview.drawing.right.revisionId} · {preview.drawing.right.scale.numerator}:{preview.drawing.right.scale.denominator}</figcaption>
450:             selectedAnnotationId={null}
```

### src/components/ConfirmDialog.tsx

```text
1: import { useId, type ReactNode } from 'react'
28:   const titleId = `${useId()}-confirm-title`
29:   const descriptionId = `${useId()}-confirm-description`
38:         aria-labelledby={titleId}
39:         aria-describedby={descriptionId}
41:         <h2 id={titleId} className="confirm-dialog__title">
44:         <div id={descriptionId} className="confirm-dialog__message">
```

### src/components/ContributionTable.tsx

```text
1: import { useId } from 'react'
6: /** 只用于把 result.contributions 中的 termId 映射到用户填写的代号。 */
17:    * stale 时应传入上次有效链的 terms，缺失时退回显示 termId。
23:   termId: string
51:   const symbolById = new Map(terms?.map((term) => [term.id, term.symbol]) ?? [])
52:   const ratioByTermId = new Map(
53:     contributionRatios(result).map((item) => [item.termId, item.ratio]),
58:     symbol: symbolById.get(contribution.termId) ?? contribution.termId,
59:     ratio: ratioByTermId.get(contribution.termId) ?? null,
87:   const headingId = `${useId()}-contribution-heading`
91:     <section className="contribution-table" aria-labelledby={headingId}>
92:       <h3 id={headingId} className="contribution-table__title">
117:                   key={row.termId}
119:                   data-term-id={row.termId}
```

### src/components/DesktopSessionViews.tsx

```text
38:         <tbody>{draft.terms.map((term, index) => <tr key={term.id}>
41:             const error = errors[`${term.id}.${field}`]
45:               onChange={event => edit({ type: 'updateField', termId: term.id, field, value: event.target.value })} />
48:           <td><select aria-label={`第 ${index + 1} 行 ${term.symbol} 方向`} value={term.sign} disabled={disabled} onChange={event => edit({ type: 'updateField', termId: term.id, field: 'sign', value: event.target.value === '1' ? 1 : -1 })}><option value="1">增环 (+)</option><option value="-1">减环 (−)</option></select></td>
79: export function DesktopSourceView({ snapshot, sessionId, requirementSource, locate, onImportVersion }: {
81:   sessionId: string
86:   onImportVersion: (documentId: string) => void
89:     revisionId: string
91:     termId: string | null
92:     requirementRevisionId: string | null
94:     revisionId: locate?.revisionId ?? snapshot.revisions[0]?.id ?? '',
96:     termId: locate === null ? null : '__requirement__',
97:     requirementRevisionId: locate?.requirementRevisionId ?? null,
101:   const revision = snapshot.revisions.find(item => item.id === location.revisionId)
102:   const missing = snapshot.missingAttachments.some(item => item.revisionId === revision?.id)
107:     location.requirementRevisionId === null
110:           item => item.requirementRevisionId === location.requirementRevisionId,
117:     id: `requirement-source:${highlightRequirement.requirementRevisionId}`,
118:     projectId: snapshot.project.id,
119:     termId: '__requirement__',
120:     revisionId: highlightRequirement.revisionId,
121:     documentId: snapshot.revisions.find(item => item.id === highlightRequirement.revisionId)?.documentId ?? '',
125:     note: `任务书条款选区 · ${highlightRequirement.requirementRevisionId}`,
133:     const result = await window.cunlian.readAttachment({ sessionId, revisionId: rev.id })
137:   }, [sessionId])
141:       {snapshot.revisions.length === 0 && location.revisionId === '' ? null : <label>来源版本 <select aria-label="来源版本" value={location.revisionId} onChange={event => setLocation({ revisionId: event.target.value, page: 1, termId: null, requirementRevisionId: null })}>{revision === undefined && location.revisionId !== '' ? <option value={location.revisionId}>{location.revisionId}（不在项目文件中）</option> : null}{snapshot.revisions.map(rev => <option key={rev.id} value={rev.id}>{rev.fileName} · {rev.id}</option>)}</select></label>}
142:       {snapshot.documents.map(doc => <button key={doc.id} type="button" onClick={() => onImportVersion(doc.id)}>导入「{doc.title}」新版…</button>)}
143:       <ul className="desktop-workspace__locations">{snapshot.bindings.map(binding => <li key={binding.id}><span>{snapshot.project.dimensionChain.terms.find(term => term.id === binding.termId)?.symbol ?? binding.termId} · 第 {binding.page} 页 · {binding.revisionId} </span><button disabled={!snapshot.revisions.some(rev => rev.id === binding.revisionId)} onClick={() => { setLocation({ revisionId: binding.revisionId, page: binding.page, termId: binding.termId, requirementRevisionId: null }); setZoom(1); setRotation(0) }}>查看原图位置</button></li>)}
144:         {requirementSource && <li><span>任务书条款（活动）· 第 {requirementSource.page} 页 · {requirementSource.revisionId}（{requirementSource.label}）</span><button onClick={() => { setLocation({ revisionId: requirementSource.revisionId, page: requirementSource.page, termId: '__requirement__', requirementRevisionId: requirementSource.requirementRevisionId }); setZoom(1); setRotation(0) }}>定位任务书</button></li>}
145:         {locate && locate.requirementRevisionId !== requirementSource?.requirementRevisionId && <li><span>任务书条款历史版本 · 第 {locate.page} 页 · {locate.revisionId}（{locate.label}）</span><button onClick={() => { setLocation({ revisionId: locate.revisionId, page: locate.page, termId: '__requirement__', requirementRevisionId: locate.requirementRevisionId }); setZoom(1); setRotation(0) }}>定位此历史版本</button></li>}
147:       {selectedRequirement !== null && <p data-testid="requirement-locate-summary">已定位 {selectedRequirement.label} · 来源 PDF {selectedRequirement.revisionId} 第 {selectedRequirement.page} 页 · 选区 PDF 点 {formatRequirementRect(selectedRequirement.rectPdf)}</p>}
150:         selectedTermId={location.termId} page={location.page} zoom={zoom} rotation={rotation}
160:   onLocateRequirement?: (revisionId: string) => void
170:     {snapshot.analysisSnapshots.map(item => <article key={item.id} className="desktop-workspace__history-item" aria-label={`历史报告 ${item.id}`}>
171:       <h3>{item.projectName} · {item.id}</h3><p>{item.createdAt} · 引擎 {item.engineVersion} · 规则 {item.reviewRulesVersion}</p>
```

### src/components/DimensionTable.tsx

```text
4: import { useId, type Dispatch, type MouseEvent } from 'react'
29:   selectedTermId?: string | null
31:   onSelect?: (termId: string) => void
32:   /** termId → 来源绑定数量；不传时不显示来源标记。 */
34:   /** termId → 需要重新核对的绑定数量；与 sourceBindingCounts 一起显示。 */
66:   errorId: string
76:   errorId,
94:         aria-describedby={hasError ? errorId : undefined}
95:         aria-errormessage={hasError ? errorId : undefined}
99:         <span id={errorId} className="dimension-table__error">
114:   const usedIds = new Set(terms.map((term) => term.id))
116:   while (usedIds.has(`term-${suffix}`)) {
138:   selectedTermId = null,
143:   // useId 生成不含空白的唯一前缀，避免多个表格的错误文案 id 冲突。
144:   const tableId = useId().replace(/[^A-Za-z0-9_-]/g, '')
145:   const tableElementId = `${tableId}-table`
146:   const hintId = `${tableId}-hint`
148:   const errorId = (index: number, field: string): string =>
149:     `${tableId}-${index}-${field}-error`
152:     termId: string,
156:     dispatch({ type: 'updateField', termId, field, value })
169:           aria-controls={tableElementId}
182:       <p id={hintId} className="dimension-table__hint">
194:           id={tableElementId}
196:           aria-describedby={hintId}
212:               (candidate) => candidate.id === term.id,
218:             const signError = cellErrors[`${term.id}.sign`]
219:             const selected = selectedTermId === term.id
231:                     onSelect(term.id)
236:                 key={term.id}
243:                 data-review-term={term.id}
255:                       onClick={() => onSelect(term.id)}
265:                     error={cellErrors[`${term.id}.symbol`]}
266:                     errorId={errorId(index, 'symbol')}
269:                       updateText(term.id, 'symbol', value)
277:                     error={cellErrors[`${term.id}.name`]}
278:                     errorId={errorId(index, 'name')}
280:                     onChange={(value) => updateText(term.id, 'name', value)}
287:                     error={cellErrors[`${term.id}.nominal`]}
288:                     errorId={errorId(index, 'nominal')}
292:                       updateText(term.id, 'nominal', value)
300:                     error={cellErrors[`${term.id}.lower`]}
301:                     errorId={errorId(index, 'lower')}
304:                     onChange={(value) => updateText(term.id, 'lower', value)}
311:                     error={cellErrors[`${term.id}.upper`]}
312:                     errorId={errorId(index, 'upper')}
315:                     onChange={(value) => updateText(term.id, 'upper', value)}
328:                         : errorId(index, 'sign')
333:                         : errorId(index, 'sign')
338:                         termId: term.id,
349:                       id={errorId(index, 'sign')}
372:                     error={cellErrors[`${term.id}.sourceNote`]}
373:                     errorId={errorId(index, 'sourceNote')}
376:                       updateText(term.id, 'sourceNote', value)
383:                         (sourceBindingCounts[term.id] ?? 0) > 0
387:                       data-testid={`source-badge-${term.id}`}
389:                       {(sourceBindingCounts[term.id] ?? 0) > 0
390:                         ? `已绑定 ${sourceBindingCounts[term.id]} 处来源`
392:                       {(sourceReviewPendingCounts?.[term.id] ?? 0) > 0
393:                         ? ` · ${sourceReviewPendingCounts?.[term.id]} 处待复核`
407:                           termId: term.id,
421:                           termId: term.id,
433:                         dispatch({ type: 'removeTerm', termId: term.id })
```

### src/components/DrawingCanvas.tsx

```text
5:  * selectedAnnotationId）。zoom 只是容器 CSS 变换，不改变图纸数据或尺寸。
14:   selectedAnnotationId: string | null
15:   onSelectAnnotation: (annotationId: string, parameterId: string) => void
29:         : renderDrawingSvg(props.data, { selectedAnnotationId: props.selectedAnnotationId }),
30:     [props.data, props.selectedAnnotationId],
35:     if (props.selectedAnnotationId === null) return
37:       `[data-annotation-id="${props.selectedAnnotationId}"]`,
40:   }, [props.selectedAnnotationId])
57:   function pick(target: EventTarget | null): { annotationId: string; parameterId: string } | null {
61:     const annotationId = group.getAttribute('data-annotation-id')
62:     const parameterId = group.getAttribute('data-parameter-id')
63:     if (annotationId === null || parameterId === null) return null
64:     return { annotationId, parameterId }
90:           if (picked !== null) props.onSelectAnnotation(picked.annotationId, picked.parameterId)
97:           props.onSelectAnnotation(picked.annotationId, picked.parameterId)
```

### src/components/DxfViewer.tsx

```text
92:   viaViewport,
95:   viaViewport: string | null
116:         {viaViewport === null ? '' : `（经视口 ${viaViewport}）`}
170:   const [selectedId, setSelectedId] = useState<string | null>(null)
171:   const [viaViewport, setViaViewport] = useState<string | null>(null)
197:     setSelectedId(null)
220:     if (selectedId === null) return null
221:     return doc.entities.find((entity) => entity.id === selectedId) ?? null
222:   }, [doc, selectedId])
246:     setSelectedId(picked?.entityId ?? null)
247:     setViaViewport(picked?.viaViewport ?? null)
440:                 <clipPath key={viewport.id} id={`dxf-clip-${viewport.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`}>
452:                 key={entity.entityId}
454:                 data-entity-id={entity.entityId}
457:                 opacity={selectedId === entity.entityId ? 1 : undefined}
460:                   <ShapeElement key={`${entity.entityId}:${index}`} shape={shape} color={entity.color} index={index} />
466:                 key={viewport.id}
467:                 clipPath={`url(#dxf-clip-${viewport.id.replace(/[^a-zA-Z0-9_-]/g, '_')})`}
468:                 data-viewport={viewport.id}
472:                     key={`${viewport.id}:${entity.entityId}`}
473:                     data-entity-id={entity.entityId}
476:                     data-via-viewport={viewport.id}
480:                         key={`${viewport.id}:${entity.entityId}:${index}`}
490:             {selected !== null && <SelectionHalo scene={scene} entity={selected} viaViewport={viaViewport} />}
520:           <EntityInspector entity={selected} viaViewport={viaViewport} />
576:   viaViewport,
580:   viaViewport: string | null
584:   if (viaViewport === null) {
585:     const view = scene.entities.find((item) => item.entityId === entity.id)
589:     const viewport = scene.viewports.find((item) => item.id === viaViewport)
590:     const view = viewport?.entities.find((item) => item.entityId === entity.id)
```

### src/components/ExtractionReviewPanel.tsx

```text
31:   batchConfirmCandidateIds,
32:   batchUnitCandidateIds,
50:   requestId: string
56:     revisionId: string
59:     requestId: string
62:     draftId: string
63:     candidateId: string
71:   onCancel: (requestId: string) => Promise<ExtractionCancelValue | null>
73:   onDeleteDraft: (request: { draftId: string }) => Promise<ExtractionDeleteDraftValue | null>
81:     draftId: string
82:     candidateIds: string[]
85:     draftId: string
86:     candidateIds: string[]
90:     draftId: string
91:     batchId?: string
92:     candidateId?: string
175:     const key = `${evidence.revisionId}#${evidence.page}#${evidence.rectPdf.join(',')}`
183: function nextRequestId(): string {
196:   const [revisionId, setRevisionId] = useState(revisions[0]?.id ?? '')
199:   const [draftId, setDraftId] = useState<string | null>(null)
206:   const [editing, setEditing] = useState<{ candidateId: string; field: EditableField; text: string } | null>(null)
207:   const [expandedDraftIds, setExpandedDraftIds] = useState<Record<string, true>>({})
208:   const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
211:     { revisionId: string; page: number; rectPdf: readonly [number, number, number, number]; pageBoxPdf: readonly [number, number, number, number]; label: string } | null
223:     scopes.find((scope) => scope.drafts.some((item) => item.draftId === draftId)) ?? scopes[0] ?? null
226:   const revision = revisions.find((item) => item.id === revisionId) ?? null
227:   const sourceDocument = revision === null ? null : snapshot.documents.find((item) => item.id === revision.documentId) ?? null
228:   const outdated = revision !== null && sourceDocument !== null && sourceDocument.latestRevisionId !== revision.id
249:   const unitOnlyIds = useMemo(() => {
253:       .flatMap((group) => [...batchUnitCandidateIds(group)])
255:   const selectedIds = Object.keys(selected).filter((id) => draft?.candidates.some((candidate) => candidate.candidateId === id))
267:     const requestId = nextRequestId()
268:     setRunning(requestId)
270:       const outcome = await actions.onRun({ revisionId, pageFrom: from, pageTo: to, requestId })
299:       draftId: draft.draftId,
300:       candidateId: candidate.candidateId,
313:         ? `已确认候选 ${candidate.candidateId}（仅记录决定，不自动写入尺寸链/条款）。`
315:           ? `已拒绝候选 ${candidate.candidateId}；不会复活，也不进入项目。`
317:             ? `已撤销候选 ${candidate.candidateId} 的确认；该候选回到待确认，同一符号其它处恢复可选。`
326:     if (draft === null || selectedIds.length === 0) return
330:     for (const candidateId of selectedIds) {
331:       const candidate = draft.candidates.find((item) => item.candidateId === candidateId)
334:         draftId: draft.draftId,
335:         candidateId,
346:     setMessage(`已批量拒绝 ${selectedIds.length} 条候选（逐条记录理由）。`)
355:     if (draft.candidates.some((candidate) => ids.includes(candidate.candidateId) && candidateReadSources(candidate).length > 0)) {
364:       const result = await actions.onConfirmBatch({ draftId: draft.draftId, candidateIds: [...ids] })
397:         draftId: draft.draftId,
398:         candidateIds: [...unitOnlyIds],
419:   /** 撤销补单位：整批（batchId）或逐条（candidateId）。 */
420:   async function revokeUnits(selector: { batchId?: string; candidateId?: string }): Promise<void> {
424:     setBatchRunning(selector.batchId ?? selector.candidateId ?? 'revoke')
426:       const result = await actions.onRevokeUnits({ draftId: draft.draftId, ...selector })
448:     setDeleting(target.draftId)
450:       const result = await actions.onDeleteDraft({ draftId: target.draftId })
455:       setConfirmDeleteId(null)
456:       setExpandedDraftIds((current) => {
458:         delete next[target.draftId]
463:         `已删除旧草稿 ${target.draftId}（${target.extractorVersion}）：只删了这一份草稿，来源 PDF、条款、绑定与图纸未改动；保存项目后写入文件。`,
485:     const groupMembers = candidate.kind === 'ring' && candidate.groupId !== null
486:       ? owner.candidates.filter((item) => item.kind === 'ring' && item.groupId === candidate.groupId)
489:       ? groupMembers.find((item) => item.candidateId !== candidate.candidateId && item.status === 'confirmed')
492:     const activeUnit = activeUnitAttestation(owner, { candidateId: candidate.candidateId })
496:         key={candidate.candidateId}
504:             aria-label={`选择候选 ${candidate.candidateId}`}
505:             checked={selected[candidate.candidateId] === true}
510:                 if (event.target.checked) next[candidate.candidateId] = true
511:                 else delete next[candidate.candidateId]
540:           <div key={index} className="extraction-review__warning" data-testid={`agent-read-source-${candidate.candidateId}`}>
543:             <p>{reading.source.kind === 'pdf-page' ? `来源版本：${reading.source.revisionId}` : `图片：${reading.source.imageId}`} · SHA-256 {reading.source.sha256}</p>
562:             data-testid={`unit-source-${candidate.candidateId}`}
565:             （{unitAttestation.actorId} · {unitAttestation.turnId ?? '无轮次'}）
575:                 item.candidateId === candidate.candidateId &&
604:                 revisionId: firstEvidence.revisionId,
649:               onClick={() => void revokeUnits({ candidateId: candidate.candidateId })}
658:             onClick={() => { setRejecting(candidate.candidateId); setRejectReason('') }}
670:                 setEditing({ candidateId: candidate.candidateId, field: first.field as EditableField, text: first.value.text })
677:         {rejecting === candidate.candidateId && (
695:         {editing?.candidateId === candidate.candidateId && (
727:     : revisions.find((item) => item.id === locate.revisionId) ?? null
731:         id: `extraction:${locate.revisionId}:${locate.page}:${locate.rectPdf.join(',')}`,
732:         projectId: snapshot.project.id,
733:         termId: '__extraction__',
734:         revisionId: locate.revisionId,
735:         documentId: locateRevision.documentId,
768:               value={revisionId}
771:                 const next = revisions.find((item) => item.id === event.target.value)
772:                 setRevisionId(event.target.value)
777:                 <option key={item.id} value={item.id}>
778:                   {item.fileName} · {item.id} · {item.pageCount} 页
823:               当前选择的是旧版本（latest 为 {sourceDocument?.latestRevisionId}）。提取只读这个确切版本，不会自动改用 latest。
841:                   onClick={() => setDraftId(scope.current.draftId)}
843:                   草稿 {scope.current.draftId.slice(0, 14)} · {extractorVersionLabel(scope.current.extractorVersion)} · 第 {scope.current.pageRange.from}–{scope.current.pageRange.to} 页
849:             当前显示：<code>{draft.extractorVersion}</code> · 草稿 <code>{draft.draftId}</code> · 第 {draft.pageRange.from}–{draft.pageRange.to} 页
855:             确切 PDF 版本 <code>{draft.sourceIdentity.revisionId}</code> · SHA-256{' '}
856:             <code>{draft.sourceIdentity.sha256.slice(0, 12)}…</code> · 页范围 {draft.pageRange.from}–{draft.pageRange.to}
865:                 <li key={issue.issueId} data-severity={issue.severity}>
891:                 {actions.onAttestUnits !== undefined && unitOnlyIds.length > 0 && (
903:                       批量补单位（{unitOnlyIds.length} 条）…
921:                     确认补单位（{unitOnlyIds.length} 条）
948:                     <div key={batch.batchId} className="extraction-review__unit-batch">
950:                         补单位批次 {batch.batchId.slice(0, 18)}… · {batch.candidateIds.length} 条 · 单位来源：
957:                           onClick={() => void revokeUnits({ batchId: batch.batchId })}
969:             <span>已选 {selectedIds.length} 项</span>
970:             {actions.onConfirmBatch !== undefined && !draft.candidates.some((candidate) => selectedIds.includes(candidate.candidateId) && candidateReadSources(candidate).length > 0) && (
973:                 onClick={() => void confirmBatch(selectedIds, 'confirm-selected')}
974:                 disabled={busy || batchRunning !== null || selectedIds.length === 0}
979:             <button type="button" onClick={() => void rejectSelected()} disabled={busy || selectedIds.length === 0}>
992:                   const batchIds = batchConfirmCandidateIds(group)
1014:                             disabled={busy || batchRunning !== null || batchIds.length === 0}
1015:                             onClick={() => void confirmBatch(batchIds, `group:${group.key}`)}
1017:                             本组全部确认（{batchIds.length} 条）
1033:                 const expanded = expandedDraftIds[old.draftId] === true
1041:                   <div key={old.draftId} className="extraction-review__superseded-row">
1051:                         onClick={() => setExpandedDraftIds((current) => {
1053:                           if (expanded) delete next[old.draftId]
1054:                           else next[old.draftId] = true
1064:                           onClick={() => setConfirmDeleteId(old.draftId)}
1070:                     {confirmDeleteId === old.draftId && (
1080:                           disabled={busy || deleting === old.draftId}
1085:                         <button type="button" onClick={() => setConfirmDeleteId(null)}>取消</button>
1091:                         aria-label={`旧草稿候选列表 ${old.draftId}`}
1107:             已定位 {locate.label} · 来源 PDF {locate.revisionId} 第 {locate.page} 页 · 选区 PDF 点 {formatRect(locate.rectPdf)}
1114:               selectedTermId="__extraction__"
```

### src/components/ImportWizard.tsx

```text
4:   useId,
166:   const titleId = `${useId()}-import-title`
192:   const [selectedTemplateId, setSelectedTemplateId] = useState('')
348:     if (table === null || selectedTemplateId === '') {
351:     const template = templates.find((item) => item.id === selectedTemplateId)
457:       projectId: project?.id,
499:         aria-labelledby={titleId}
503:             <h2 id={titleId} className="import-wizard__title">
542:             <section aria-labelledby={`${titleId}-input`}>
543:               <h3 id={`${titleId}-input`} className="import-wizard__section-title">
585:             <section aria-labelledby={`${titleId}-header`}>
586:               <h3 id={`${titleId}-header`} className="import-wizard__section-title">
626:             <section aria-labelledby={`${titleId}-mapping`}>
627:               <h3 id={`${titleId}-mapping`} className="import-wizard__section-title">
643:                       value={selectedTemplateId}
644:                       onChange={(event) => setSelectedTemplateId(event.target.value)}
648:                         <option key={template.id} value={template.id}>
658:                     disabled={selectedTemplateId === ''}
813:             <section aria-labelledby={`${titleId}-units`}>
814:               <h3 id={`${titleId}-units`} className="import-wizard__section-title">
878:             <section aria-labelledby={`${titleId}-preview`}>
879:               <h3 id={`${titleId}-preview`} className="import-wizard__section-title">
```

### src/components/ModelViewport.tsx

```text
18:   revisionId: string
133:     // 几何身份由 revisionId 决定；同一版本内不重建场景。
135:   }, [generation, sceneLoader, geometry.revisionId])
```

### src/components/PdfPageSurface.tsx

```text
195:                 key={highlight.id}
201:                 data-binding-id={highlight.id}
```

### src/components/PdfViewer.tsx

```text
52:   /** `${revisionId}::${page}::${zoom}::${rotation}`；与当前请求不一致即不可交互。 */
54:   revisionId: string
75:   selectedTermId: string | null
128:   selectedTermId,
190:   }, [revision.id, page])
263:   const requestKey = `${revision.id}::${clampedPage}::${zoom}::${rotation}`
316:           revisionId: revision.id,
340:   }, [opened, clampedPage, requestKey, zoom, rotation, revision.id])
346:     surface.revisionId === revision.id &&
357:     if (readOnly && surfaceReady && selectedTermId !== null) {
360:   }, [readOnly, surfaceReady, selectedTermId, requestKey])
365:         binding.revisionId === revision.id && binding.page === clampedPage,
368:       id: binding.id,
371:       active: binding.termId === selectedTermId,
381:     if (selectedTermId === null) {
485:         {revision.fileName} · v{revision.id.slice(0, 8)} · SHA-256{' '}
486:         {revision.sha256.slice(0, 12)}… · 打开的是这个确切版本，不跟随同名最新版
515:               !surfaceReady || selectedTermId === null || editingDisabled
551:                 selectedTermId === null ||
558:           {selectedTermId === null && !readOnly ? (
```

### src/components/RequirementRevisionHistory.tsx

```text
22:   onLocate: (revisionId: string) => void
59:                 key={item.revisionId}
60:                 data-testid={`${testIdPrefix}-row-${item.revisionId}`}
68:                   <code className="requirement-history__id">{item.revisionId}</code>
71:                   {item.parentRevisionId === null ? (
74:                     <code className="requirement-history__id">{item.parentRevisionId}</code>
89:                       <code className="requirement-history__id">{item.sourceRevisionId}</code>
118:                     data-testid={`locate-revision-${testIdPrefix}-${item.revisionId}`}
119:                     aria-label={`定位条款版本 ${item.revisionId} 的来源 PDF`}
121:                     onClick={() => onLocate(item.revisionId)}
```

### src/components/RequirementStatusPanel.tsx

```text
83:               条款版本 {revision.revisionId}（父 {revision.parentRevisionId ?? '无'}）· 来源{' '}
84:               {revision.source.revisionId} 第 {revision.source.page} 页 · SHA-256{' '}
85:               {revision.source.sha256.slice(0, 12)}…
89:               条款版本 {revision.revisionId}（父 {revision.parentRevisionId ?? '无'}）· 来源：用户输入（第{' '}
```

### src/components/RequirementWizard.tsx

```text
23:   sessionId: string
35:     expectedActiveRequirementRevisionId: string | null
36:     requirementId: string | null
38:       documentId: string
39:       revisionId: string
54: function defaultDocument(snapshot: SnapshotDto): { documentId: string; revisionId: string } | null {
55:   const document = snapshot.documents.find((item) => item.latestRevisionId !== '')
57:   return { documentId: document.id, revisionId: document.latestRevisionId }
66:         documentId: active.source.documentId,
67:         revisionId: active.source.revisionId,
78:       documentId: fallback?.documentId ?? '',
79:       revisionId: fallback?.revisionId ?? '',
89:   const [documentId, setDocumentId] = useState(initial.documentId)
90:   const [revisionId, setRevisionId] = useState(initial.revisionId)
109:   const latest = useRef({ documentId, revisionId, page, rect, pageBox, text, lower, upper })
111:     latest.current = { documentId, revisionId, page, rect, pageBox, text, lower, upper }
112:   }, [documentId, revisionId, page, rect, pageBox, text, lower, upper])
115:     (item) => item.documentId === documentId,
117:   const revision = snapshot.revisions.find((item) => item.id === revisionId) ?? null
118:   const document = snapshot.documents.find((item) => item.id === documentId) ?? null
122:     document.latestRevisionId !== active.confirmedAgainstLatestRevisionId
132:           requirementId: active?.requirementId ?? null,
138:             documentId: current.documentId === '' ? null : current.documentId,
139:             revisionId: current.revisionId === '' ? null : current.revisionId,
179:   function reloadForDocument(nextDocumentId: string): void {
180:     const nextDocument = snapshot.documents.find((item) => item.id === nextDocumentId)
181:     setDocumentId(nextDocumentId)
182:     setRevisionId(nextDocument?.latestRevisionId ?? '')
193:       sessionId: props.sessionId,
194:       revisionId: sourceRevision.id,
209:         expectedActiveRequirementRevisionId:
210:           snapshot.project.activeRequirementRevisionId,
211:         requirementId: active?.requirementId ?? null,
213:           documentId: revision.documentId,
214:           revisionId: revision.id,
259:                   value={documentId}
263:                     <option key={item.id} value={item.id}>{item.title}</option>
271:                   value={revisionId}
273:                     setRevisionId(event.target.value)
281:                     <option key={item.id} value={item.id}>
282:                       {item.fileName} · {item.id} · {item.pageCount} 页 · {item.sha256.slice(0, 12)}…
316:                   selectedTermId="__requirement__"
```

### src/components/ResultPanel.tsx

```text
2: import { useId, type Dispatch } from 'react'
113:   const titleId = `${useId()}-result-chart-title`
114:   const descriptionId = `${useId()}-result-chart-description`
141:         aria-labelledby={`${titleId} ${descriptionId}`}
145:         <title id={titleId}>结果区间与允许区间示意</title>
146:         <desc id={descriptionId}>
291:   const baseId = useId()
292:   const headingId = `${baseId}-heading`
293:   const targetMinId = `${baseId}-target-min`
294:   const targetMaxId = `${baseId}-target-max`
295:   const targetMinErrorId = `${baseId}-target-min-error`
296:   const targetMaxErrorId = `${baseId}-target-max-error`
297:   const confirmedId = `${baseId}-confirmed`
322:       aria-labelledby={headingId}
325:       <h2 id={headingId} className="result-panel__title">
339:           <label htmlFor={targetMinId}>目标下限</label>
341:             id={targetMinId}
352:               targetMinError === undefined ? undefined : targetMinErrorId
357:             <p id={targetMinErrorId} className="result-panel__field-error" role="alert">
364:           <label htmlFor={targetMaxId}>目标上限</label>
366:             id={targetMaxId}
377:               targetMaxError === undefined ? undefined : targetMaxErrorId
382:             <p id={targetMaxErrorId} className="result-panel__field-error" role="alert">
453:         <label className="result-panel__confirmed" htmlFor={confirmedId}>
455:             id={confirmedId}
```

### src/components/ReviewSidebar.tsx

```text
95:                     key={`${finding.ruleId}:${finding.subject.id}`}
97:                     data-testid={`review-item-${finding.ruleId}-${finding.subject.id}`}
103:                       aria-label={`定位：${REVIEW_RULE_LABEL[finding.ruleId]}，${finding.subject.label}`}
105:                       <span className="review-sidebar__rule">{REVIEW_RULE_LABEL[finding.ruleId]}</span>
106:                       <code className="review-sidebar__rule-id">{finding.ruleId}</code>
141:               <tr key={`${finding.ruleId}:${finding.subject.id}:all`}>
143:                   {REVIEW_RULE_LABEL[finding.ruleId]}
144:                   <code className="review-sidebar__rule-id">{finding.ruleId}</code>
```

### src/components/ScenarioCompare.tsx

```text
74:     diff.addedTermIds.length > 0 ||
75:     diff.removedTermIds.length > 0 ||
89:   testId: string
93: function DeltaRow({ label, testId, delta }: DeltaRowProps) {
95:     <tr data-testid={testId}>
99:       <td data-testid={`${testId}-delta`}>{formatDelta(delta)}</td>
117:   // 字段变化行以用户熟悉的代号展示；termId 只是内部标识。
118:   // 当前工作方案优先，找不到时回退基线，再找不到才显示 termId。
119:   const symbolByTermId = useMemo(() => {
124:         symbols.set(term.id, symbol)
130:         symbols.set(term.id, symbol)
167:                     key={`${change.termId}-${change.field}`}
168:                     data-testid={`compare-change-${change.termId}-${change.field}`}
171:                       {symbolByTermId.get(change.termId) ?? change.termId}
184:       {diff.addedTermIds.length > 0 ||
185:       diff.removedTermIds.length > 0 ||
191:             {diff.addedTermIds.length > 0 ? (
193:                 新增组成环：{diff.addedTermIds.join('、')}
196:             {diff.removedTermIds.length > 0 ? (
198:                 移除组成环：{diff.removedTermIds.join('、')}
227:               <DeltaRow label="Cmin" testId="compare-min" delta={diff.minQ} />
228:               <DeltaRow label="Cmax" testId="compare-max" delta={diff.maxQ} />
229:               <DeltaRow label="Tc" testId="compare-tolerance" delta={diff.toleranceQ} />
232:                 testId="compare-lower-margin"
237:                 testId="compare-upper-margin"
```

### src/components/SessionDialogs.tsx

```text
32:     {session.preview?.projects.map(project => <div key={project.id}><h3>{project.name}</h3><p>附件 {project.attachmentCount} · 缺失 {project.missingItems}</p><button disabled={session.busy} onClick={() => void session.commit(project.id)}>导入并另存为…</button></div>)}
```

### src/components/SourcePanel.tsx

```text
41:   bindingId: string
42:   revisionId: string
49:   projectId: string
51:   selectedTermId: string | null
75:   return term.symbol.trim() || term.name.trim() || term.id
79:   projectId,
81:   selectedTermId,
100:   const [activeRevisionId, setActiveRevisionId] = useState<string | null>(null)
115:     { kind: 'region' | 'source'; bindingId: string; termId: string } | null
121:   const [acceptingBindingId, setAcceptingBindingId] = useState<string | null>(null)
126:   const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)
144:           listSourceDocuments(projectId),
145:           listSourceRevisions(projectId),
146:           listSourceBindings(projectId),
147:           listSourceBlobKeys(projectId),
174:         left.title.localeCompare(right.title, 'zh-CN') || left.id.localeCompare(right.id),
178:           left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
197:   }, [projectId, reloadToken])
213:     setActiveRevisionId(locateRequest.revisionId)
221:       `[data-review-binding="${locateRequest.bindingId}"]`,
230:    * 确切 revision 与页码，而不是文档的 latestRevisionId。
233:     if (activeRevisionId !== null || revisions.length === 0) {
242:         selectedTermId === null
244:           : bindings.filter((binding) => binding.termId === selectedTermId)
249:         revisions.some((revision) => revision.id === preferred.revisionId)
251:         setActiveRevisionId(preferred.revisionId)
256:       setActiveRevisionId(lastRevision.id)
262:   }, [activeRevisionId, bindings, revisions, selectedTermId])
265:     revisions.find((revision) => revision.id === activeRevisionId) ?? null
266:   const activeTerm = terms.find((term) => term.id === selectedTermId)
270:     selectedTermId === null
272:       : bindings.filter((binding) => binding.termId === selectedTermId)
274:   const termsById = useMemo(
275:     () => new Map(terms.map((term) => [term.id, term])),
278:   const documentsById = useMemo(
279:     () => new Map(documents.map((document) => [document.id, document])),
282:   const revisionsById = useMemo(
283:     () => new Map(revisions.map((revision) => [revision.id, revision])),
294:       const term = termsById.get(binding.termId)
295:       const document = documentsById.get(binding.documentId)
296:       const revision = revisionsById.get(binding.revisionId)
297:       map[binding.id] = resolveBindingReview({
300:         latestRevisionId: document?.latestRevisionId,
306:   }, [availableBlobKeys, bindings, documentsById, revisionsById, termsById])
314:       if (reviewByBinding[binding.id]?.needsReview === true) {
315:         counts[binding.termId] = (counts[binding.termId] ?? 0) + 1
325:     const result = await reviewSourceBinding(binding.id, {
340:     const document = documentsById.get(binding.documentId)
342:       document === undefined ? undefined : revisionsById.get(document.latestRevisionId)
353:     setEditMode({ kind: 'source', bindingId: binding.id, termId: binding.termId })
354:     setActiveRevisionId(latest.id)
365:     const accepted = await acceptHistoricalSource(binding.id, {
377:     setAcceptingBindingId(null)
384:     const removed = await removeSourceBinding(binding.id)
389:     setPendingRemoveId(null)
420:       projectId,
423:       ...(importTarget === '' ? {} : { documentId: importTarget }),
434:         `生成不可变版本 ${imported.value.revision.id}（SHA-256 ${imported.value.revision.sha256.slice(0, 12)}…）。`,
436:     setActiveRevisionId(imported.value.revision.id)
445:     if (selectedTermId === null) {
454:           ? await updateSourceBindingRegion(editMode.bindingId, {
460:           : await rebindSourceBinding(editMode.bindingId, {
461:               revisionId: activeRevision.id,
479:       projectId,
480:       termId: selectedTermId,
481:       revisionId: activeRevision.id,
495:     setActiveRevisionId(binding.revisionId)
506:     setEditMode({ kind, bindingId: binding.id, termId: binding.termId })
507:     setActiveRevisionId(binding.revisionId)
517:   const revisionsOf = (documentId: string): SourceRevision[] =>
518:     revisions.filter((revision) => revision.documentId === documentId)
543:                 <option key={document.id} value={document.id}>
631:                 const documentRevisions = revisionsOf(document.id)
633:                   <li key={document.id} className="source-panel__document">
642:                         const isLatest = revision.id === document.latestRevisionId
643:                         const selected = revision.id === activeRevisionId
645:                           <li key={revision.id}>
655:                                 setActiveRevisionId(revision.id)
667:                                 {revision.sha256.slice(0, 8)}… ·{' '}
694:               key={activeRevision.id}
697:               selectedTermId={selectedTermId}
725:           {selectedTermId === null ? (
737:                   (candidate) => candidate.id === binding.revisionId,
739:                 const review = reviewByBinding[binding.id]
740:                 const term = termsById.get(binding.termId)
743:                     key={binding.id}
745:                     data-review-binding={binding.id}
758:                         data-testid={`binding-review-${binding.id}`}
766:                         data-testid={`binding-historical-${binding.id}`}
776:                           {binding.historicalAcceptance.latestRevisionId.slice(0, 8)}…
793:                         data-testid={`binding-version-actions-${binding.id}`}
802:                             data-testid={`binding-migrate-${binding.id}`}
810:                             data-testid={`binding-accept-old-${binding.id}`}
812:                               setAcceptingBindingId(binding.id)
824:                             data-testid={`binding-remove-${binding.id}`}
825:                             onClick={() => setPendingRemoveId(binding.id)}
833:                     {acceptingBindingId === binding.id ? (
836:                         data-testid={`binding-accept-form-${binding.id}`}
862:                             data-testid={`binding-accept-submit-${binding.id}`}
871:                               setAcceptingBindingId(null)
880:                     {pendingRemoveId === binding.id ? (
885:                         data-testid={`binding-remove-confirm-${binding.id}`}
893:                             data-testid={`binding-remove-confirm-yes-${binding.id}`}
899:                           <button type="button" onClick={() => setPendingRemoveId(null)}>
908:                         data-testid={`binding-reframe-${binding.id}`}
916:                         data-testid={`binding-rebind-${binding.id}`}
925:                           data-testid={`binding-remove-inline-${binding.id}`}
926:                           onClick={() => setPendingRemoveId(binding.id)}
934:                       版本 {binding.revisionId.slice(0, 8)}… · 区域{' '}
```

### src/components/SpacerDrawingPanel.tsx

```text
8:  * 再用返回的权威快照重建预览。标注只绑定 parameterId，点击后定位到原参数输入。
39:   sessionId: string | null
52:   selectedParameterId: string | null
53:   selectedAnnotationId: string | null
54:   onSelectParameter: (parameterId: string | null) => void
55:   onSelectAnnotation?: (annotationId: string) => void
103:   const syncedKey = record?.dataFingerprint ?? 'none'
127:   const selectedAnnotationId =
128:     props.selectedAnnotationId ??
129:     (props.selectedParameterId === null
131:       : displayData?.annotations.find((item) => item.parameterId === props.selectedParameterId)?.annotationId ??
145:     if (props.sessionId === null) {
155:         sessionId: props.sessionId,
157:         partId: 'builtin:shaft-demo:spacer',
172:       setNotice(`图纸已更新 · 指纹 ${result.value.drawingFingerprint.slice(0, 12)}…`)
181:     if (props.sessionId === null || record === undefined || committedData === null) {
190:         sessionId: props.sessionId,
192:         drawingId: record.drawingId,
193:         drawingFingerprint: record.dataFingerprint,
208:         `已导出 ${result.value.fileName} · ${result.value.byteSize} 字节 · SHA-256 ${result.value.sha256.slice(0, 12)}…`,
245:           候选参数预览（未提交）：标注与图形按当前参数联动草稿重画；正式图纸仍为 Rev {record?.revisionId ?? '—'}，
277:           const parameterId = SPACER_PARAMETER_IDS[key]
278:           const row = rows.find((item) => item.parameterId === parameterId)
279:           const active = props.selectedParameterId === parameterId
288:                 onFocus={() => props.onSelectParameter(parameterId)}
308:         <button type="submit" className="spacer-drawing__primary" disabled={busy || props.sessionId === null}>
314:         <AgentReadEvidenceList key={parameter.parameterId} provenance={provenanceOf(parameter)} />
365:           selectedAnnotationId={selectedAnnotationId}
367:           onSelectAnnotation={(annotationId, parameterId) => {
368:             props.onSelectParameter(parameterId)
369:             props.onSelectAnnotation?.(annotationId)
```

### src/components/ThreeViewport.tsx

```text
15:   type BuiltinPartId,
24:   selectedPartId: BuiltinPartId | null
25:   onSelectPart: (partId: BuiltinPartId | null) => void
54:   const { selectedPartId, explodeT, active, sceneLoader = defaultLoader } = props
68:     onSelectPart: (partId: BuiltinPartId | null) => propsRef.current.onSelectPart(partId),
92:           selectedPartId: propsRef.current.selectedPartId,
130:     sceneRef.current?.setSelectedPartId(selectedPartId)
131:   }, [selectedPartId, status])
172:   const selectedName = selectedPartId ? demoPart(selectedPartId).name : '未选择'
```

### src/components/layout/SplitPane.tsx

```text
29:       event.currentTarget.setPointerCapture(event.pointerId)
```

### src/desktop/ShellApp.tsx

```text
71:       setFlushLog(`已收到 requestId=${payload.requestId}，并已回复 flushed`)
72:       api.respondEditorFlush({ requestId: payload.requestId, editSeq: 0 })
```

### src/desktop/drawingPrintEntry.ts

```text
19:   drawingId: string
26:   drawingId: string
28:   svgFingerprint: string | null
78:   const root = document.getElementById('root')
129:   const svgFingerprint =
131:   if (svgFingerprint !== payload.fingerprint) {
137:     drawingId: payload.drawingId,
139:     svgFingerprint,
```

### src/desktop/main.tsx

```text
6: createRoot(document.getElementById('root')!).render(
```

### src/document-extraction/batch.ts

```text
7:  * 2. **逐条落盘**：批量确认/补单位都按候选各写一条决定（各自的 decisionId、
20: import { stableId } from './ids'
56: function uniqueIds(ids: readonly string[]): string[] {
73:   return `${candidate.candidateId}${symbol === null ? '' : ` ${symbol}`}${where}`
102:     const key = `${item.revisionId}#${item.page}#${item.rectPdf.join(',')}#${item.textSnippet}`
120:   readonly candidateIds: readonly string[]
128:   readonly candidateIds: readonly string[]
129:   readonly decisionIds: readonly string[]
145:   const ids = uniqueIds(request.candidateIds)
152:   for (const candidateId of ids) {
153:     const candidate = findCandidate(draft, candidateId)
155:       invalid.push(`${candidateId}（不存在）`)
171:     if (members.length > 1 && candidate.groupId !== null) {
172:       const list = multiGroups.get(candidate.groupId) ?? []
174:       multiGroups.set(candidate.groupId, list)
185:       .map(([groupId, list]) => {
186:         const symbol = groupId.replace(/^ring:/u, '')
197:   const decisionIds: string[] = []
198:   for (const candidateId of ids) {
199:     const candidate = findCandidate(current, candidateId)
201:       return extractionFailure('CANDIDATE_NOT_FOUND', `找不到候选 ${candidateId}`)
205:       candidateId,
215:       .filter((item) => item.candidateId === candidateId && item.action === 'confirm')
217:     if (decision !== undefined) decisionIds.push(decision.decisionId)
219:   return extractionSuccess({ draft: current, candidateIds: ids, decisionIds })
225:   readonly candidateIds: readonly string[]
236:   readonly turnId: string
241:   readonly batchId: string
242:   readonly candidateIds: readonly string[]
243:   readonly decisionIds: readonly string[]
250: function fieldPathOf(candidateId: string): string {
251:   return `candidate:${candidateId}:unit`
289:  * - 每条候选各写一条 `attest-unit` 决定（共享 batchId），**不是确认**：
301:   if (typeof request.turnId !== 'string' || request.turnId.trim() === '') {
302:     return extractionFailure('ATTESTATION_TURN_REQUIRED', '批量补单位必须绑定当前输入轮次（turnId），不能为空')
310:   const ids = uniqueIds(request.candidateIds)
316:   for (const candidateId of ids) {
317:     const candidate = findCandidate(draft, candidateId)
319:       ineligible.push(`${candidateId}（不存在）`)
340:   const batchId = stableId('unit-batch', [
341:     draft.draftId,
348:   const decisionIds: string[] = []
351:   for (const candidateId of ids) {
352:     const candidate = findCandidate(current, candidateId)
354:       return extractionFailure('CANDIDATE_NOT_FOUND', `找不到候选 ${candidateId}`)
358:       actorId: request.actor,
362:       turnId: request.turnId,
364:       fieldPath: fieldPathOf(candidateId),
422:         `候选 ${candidateId} 补单位失败，整批未执行：${error instanceof Error ? error.message : String(error)}`,
432:         `候选 ${candidateId} 补单位后出处仍不完整（字段 ${stillMissing}），整批未执行（0 条写入）`,
447:       decisionId: stableId('decision', [
448:         current.draftId,
449:         candidateId,
454:         batchId,
456:       candidateId,
465:       batchId,
473:         item.candidateId === candidateId ? nextCandidate : item,
477:     decisionIds.push(decision.decisionId)
483:     batchId,
484:     candidateIds: ids,
485:     decisionIds,
494:   /** 按批次撤销（整批）。与 candidateId 二选一。 */
495:   readonly batchId?: string | null
496:   /** 按候选逐条撤销。与 batchId 二选一。 */
497:   readonly candidateId?: string | null
505:   readonly candidateIds: readonly string[]
506:   readonly decisionIds: readonly string[]
512:   selector: { candidateId?: string | null; batchId?: string | null },
518:       (selector.candidateId === undefined || selector.candidateId === null
520:         : decision.candidateId === selector.candidateId) &&
521:       (selector.batchId === undefined || selector.batchId === null
523:         : decision.batchId === selector.batchId),
529:   readonly batchId: string
532:   readonly candidateIds: readonly string[]
541:     const batchId = decision.batchId ?? null
542:     if (batchId === null) continue
543:     const existing = map.get(batchId)
545:       map.set(batchId, {
546:         batchId,
549:         candidateIds: [decision.candidateId],
552:       map.set(batchId, { ...existing, candidateIds: [...existing.candidateIds, decision.candidateId] })
558: function attestationMatches(candidateId: string, ref: EvidenceRef): boolean {
560:   return ref.fieldPath === fieldPathOf(candidateId) && (ref.revokedAt ?? null) === null
564:  * 撤销补单位：整批（batchId）或逐条（candidateId）。
577:   const hasBatch = typeof request.batchId === 'string' && request.batchId.trim() !== ''
578:   const hasCandidate = typeof request.candidateId === 'string' && request.candidateId.trim() !== ''
580:     return extractionFailure('ATTESTATION_NOT_FOUND', '撤销补单位必须且只能给出 batchId 或 candidateId 之一')
586:       (hasBatch ? decision.batchId === request.batchId : decision.candidateId === request.candidateId),
591:       hasBatch ? `找不到仍有效的补单位批次 ${request.batchId}` : `候选 ${request.candidateId} 没有仍有效的补单位决定`,
595:     .map((decision) => findCandidate(draft, decision.candidateId))
602:             decision.candidateId === candidate.candidateId &&
615:   const decisionIds: string[] = []
617:     const candidate = findCandidate(current, target.candidateId)
619:     const batchId = target.batchId ?? null
629:       if (!refs.some((ref) => attestationMatches(candidate.candidateId, ref))) return value
636:           attestationMatches(candidate.candidateId, ref)
690:       decisionId: stableId('decision', [
691:         current.draftId,
692:         candidate.candidateId,
697:         batchId ?? 'single',
699:       candidateId: candidate.candidateId,
708:       batchId,
716:         item.candidateId === candidate.candidateId ? nextCandidate : item,
719:         item.decisionId === target.decisionId
724:     decisionIds.push(decision.decisionId)
729:     candidateIds: targets.map((decision) => decision.candidateId),
730:     decisionIds,
748:         ref.fieldPath === fieldPathOf(candidate.candidateId) &&
759: export function unitBatchKey(batchId: string): string {
760:   return `unit-batch:${batchId}`
```

### src/document-extraction/confirmGroups.ts

```text
9:  *    candidateId 排序），这里不重新排序，两次打开必然一致。
116: /** 同符号多处赋值：同 groupId 的 ring 候选多于一条。非 ring/无 groupId 一律不算。 */
121:   if (candidate.kind !== 'ring' || candidate.groupId === null) return []
123:     (item) => item.kind === 'ring' && item.groupId === candidate.groupId,
159:     if (candidate.kind !== 'ring' || candidate.groupId === null) continue
160:     const list = map.get(candidate.groupId)
161:     if (list === undefined) map.set(candidate.groupId, [candidate])
168:   if (candidate.kind !== 'ring' || candidate.groupId === null) return false
169:   return (members.get(candidate.groupId)?.length ?? 0) > 1
337:     if (candidate.groupId !== null) multiGroups.add(candidate.groupId)
341:     if (candidate.groupId !== null) unitMultiGroups.add(candidate.groupId)
362: export function batchConfirmCandidateIds(group: ConfirmGroupSummary): readonly string[] {
366:     .map((candidate) => candidate.candidateId)
370: export function batchUnitCandidateIds(group: ConfirmGroupSummary): readonly string[] {
374:     .map((candidate) => candidate.candidateId)
```

### src/document-extraction/draft.ts

```text
13: import { stableId } from './ids'
56:   candidateId: string,
58:   return draft.candidates.find((candidate) => candidate.candidateId === candidateId) ?? null
63:   candidateId: string,
70:       candidate.candidateId === candidateId ? update(candidate) : candidate,
121:   candidateId: string,
125:       decision.candidateId === candidateId &&
140:   if (candidate.kind !== 'ring' || candidate.groupId === null) return []
142:     (item) => item.kind === 'ring' && item.groupId === candidate.groupId,
154:   readonly candidateId: string
176:   const candidate = findCandidate(draft, request.candidateId)
178:     return extractionFailure('CANDIDATE_NOT_FOUND', `找不到候选 ${request.candidateId}`)
205:   const existing = latestActiveDecision(draft, candidate.candidateId)
216:         other.candidateId !== candidate.candidateId &&
218:         latestActiveDecision(draft, other.candidateId) !== null,
223:         `同一符号 ${candidate.data.symbol ?? '?'} 已确认第 ${occurrenceLabel(conflict)} 处（候选 ${conflict.candidateId}）；同一符号只能确认一处，请先撤销该确认`,
229:     decisionId: stableId('decision', [
230:       draft.draftId,
231:       candidate.candidateId,
237:     candidateId: candidate.candidateId,
252:   const updated = replaceCandidate(draft, candidate.candidateId, (current) =>
259:   readonly candidateId: string
275:   const candidate = findCandidate(draft, request.candidateId)
277:     return extractionFailure('CANDIDATE_NOT_FOUND', `找不到候选 ${request.candidateId}`)
287:     decisionId: stableId('decision', [
288:       draft.draftId,
289:       candidate.candidateId,
295:     candidateId: candidate.candidateId,
309:   const updated = replaceCandidate(draft, candidate.candidateId, (current) =>
316:   readonly candidateId: string
337:   const candidate = findCandidate(draft, request.candidateId)
339:     return extractionFailure('CANDIDATE_NOT_FOUND', `找不到候选 ${request.candidateId}`)
350:   const active = latestActiveDecision(draft, candidate.candidateId)
356:     decisionId: stableId('decision', [
357:       draft.draftId,
358:       candidate.candidateId,
364:     candidateId: candidate.candidateId,
379:     item.decisionId === active.decisionId
383:   const updated = replaceCandidate(draft, candidate.candidateId, (current) =>
411:   readonly candidateId: string
501:   const candidate = findCandidate(draft, request.candidateId)
503:     return extractionFailure('CANDIDATE_NOT_FOUND', `找不到候选 ${request.candidateId}`)
538:     decision.candidateId === candidate.candidateId &&
545:     decisionId: stableId('decision', [
546:       draft.draftId,
547:       candidate.candidateId,
554:     candidateId: candidate.candidateId,
569:       item.candidateId === candidate.candidateId ? nextCandidate : item,
576:   readonly candidateId: string
578:   readonly groupId: string | null
598:   readonly actorId: string
612:   readonly revisions?: readonly { readonly revisionId: string; readonly sha256: string }[]
613:   readonly candidateIds: readonly string[]
616:    * pdf-* 出处仍逐条比对 revisionId + sha256（I5：行为与改前等价）。
618:   readonly source: { readonly revisionId: string; readonly sha256: string }
622:   readonly images?: readonly { readonly imageId: string; readonly sha256: string }[]
632:  * 3) pdf-* 出处逐条比对 revisionId + sha256；image-ocr 比对图片 sha256；
633:  * 4) user-attestation 校验 actorId/sessionSeq 与当前会话一致，跨会话伪造拒绝。
641:     request.source.revisionId !== draft.sourceIdentity.revisionId ||
642:     request.source.sha256 !== draft.sourceIdentity.sha256
651:       { revisionId: draft.sourceIdentity.revisionId, sha256: draft.sourceIdentity.sha256 },
657:     candidateId: string,
664:         message: `候选 ${candidateId} 的字段 ${field} 缺少出处，不能送入项目草稿`,
671:           message: `候选 ${candidateId} 的字段 ${field} 出处不完整（版本/页/选区/原文），不能送入项目草稿`,
680:           message: `候选 ${candidateId} 的字段 ${field} 出处已被用户显式撤销，不能再作为依据`,
686:           message: `候选 ${candidateId} 的字段 ${field} 出处已失效（来源文件变化），需按新文件重新确认`,
691:         ref.actorId !== request.session.actorId ||
698:           message: `候选 ${candidateId} 的字段 ${field} 出处不属于当前会话（跨会话断言一律拒绝）`,
705:   const ids = [...new Set(request.candidateIds)]
711:   for (const candidateId of ids) {
712:     const candidate = findCandidate(draft, candidateId)
714:       return extractionFailure('CANDIDATE_NOT_FOUND', `找不到候选 ${candidateId}`)
719:         `候选 ${candidateId} 状态为 ${candidate.status}，未经逐条确认不能送入项目草稿`,
723:     if (candidate.kind === 'ring' && candidate.groupId !== null) {
724:       const already = confirmedGroups.get(candidate.groupId)
728:           `同一符号 ${candidate.data.symbol ?? '?'} 有两条已确认候选（${already}、${candidateId}）；同一符号只能确认一处`,
731:       confirmedGroups.set(candidate.groupId, candidateId)
733:     const decision = latestActiveDecision(draft, candidateId)
739:       return extractionFailure('STALE_DECISION', `候选 ${candidateId} 的确认已失效，需重新确认`)
742:       return extractionFailure('STALE_DECISION', `候选 ${candidateId} 的数值在确认后被改动`)
745:       const failure = checkRefs(candidateId, field, valueProvenance(value))
750:       const failure = checkRefs(candidateId, 'expression', candidateRefs)
754:       candidateId: candidate.candidateId,
756:       groupId: candidate.groupId,
781:   if (attestation.actorId !== session.actorId) return false
795:     existing.sourceIdentity.documentId !== incoming.sourceIdentity.documentId ||
796:     existing.sourceIdentity.revisionId !== incoming.sourceIdentity.revisionId ||
797:     existing.sourceIdentity.sha256 !== incoming.sourceIdentity.sha256
810:   const candidateIds = new Set(existing.candidates.map((candidate) => candidate.candidateId))
811:   const issueIds = new Set(existing.issues.map((item) => item.issueId))
812:   const decisionIds = new Set(existing.decisions.map((item) => item.decisionId))
814:     (candidate) => !candidateIds.has(candidate.candidateId),
816:   const newIssues = incoming.issues.filter((item) => !issueIds.has(item.issueId))
817:   const newDecisions = incoming.decisions.filter((item) => !decisionIds.has(item.decisionId))
826:     left.candidateId.localeCompare(right.candidateId),
```

### src/document-extraction/draftScope.ts

```text
5:  * 1. 作用域 = documentId + revisionId + 页范围。只有同一作用域内的草稿才能比较新旧；
8:  *    （提取追加顺序即创建顺序；同一版本重复的 draftId 实际由幂等键决定，不会重复）。
45:     draft.sourceIdentity.documentId,
46:     draft.sourceIdentity.revisionId,
122:       other.draftId !== draft.draftId &&
```

### src/document-extraction/ids.ts

```text
19: export function stableId(prefix: string, parts: readonly (string | number)[]): string {
```

### src/document-extraction/index.ts

```text
133:   batchConfirmCandidateIds,
134:   batchUnitCandidateIds,
148: export { stableHash, stableId } from './ids'
```

### src/document-extraction/ingestReadings.ts

```text
2: import { stableId } from './ids'
19:   readonly actorId: string
22:   readonly turnId: string
23:   readonly modelId: string | null
29:     kind: 'agent-read', actorId: input.actorId, at: input.at, sessionSeq: input.sessionSeq,
30:     turnId: input.turnId, modelId: input.modelId, source: input.source, statement: input.statement,
56:       candidateId: previous[0]?.candidateId ?? stableId('reading', [draft.draftId, input.turnId, draft.draftRevision, index]),
57:       kind: 'ring', groupId: `ring:${reading.symbol}`, rawText: input.statement,
70:   const replacedIds = new Set(replaced.map((candidate) => candidate.candidateId))
72:     decisions: draft.decisions.map((decision) => replacedIds.has(decision.candidateId)
74:     candidates: [...draft.candidates.filter((candidate) => !replacedIds.has(candidate.candidateId)), ...candidates] })
```

### src/document-extraction/parse.ts

```text
22: import { stableId } from './ids'
73:   readonly projectId: string
129:     documentId: source.documentId,
130:     revisionId: source.revisionId,
131:     sha256: source.sha256,
489:       issueId: stableId('issue', ['NO_TABLE_ROWS', page.page, header.rawText]),
494:       candidateIds: [],
802:   candidateIds: readonly string[],
806:     issueId: stableId('issue', ['INCONSISTENT_REDUNDANT_VALUE', symbol, entry.page, ...values]),
813:     candidateIds,
849:           issueId: stableId('issue', [reason, symbol, group[0].page]),
854:           candidateIds: [],
878:           issueId: stableId('issue', ['RING_OCCURRENCE_UNRESOLVED', reason, symbol, entry.page, entry.rawText]),
883:           candidateIds: [],
950:         candidateId: stableId('ring', [
951:           source.revisionId,
959:         groupId: `ring:${symbol}`,
993:           issues.push(inconsistentValueIssue(entry, symbol, [candidate.candidateId]))
1001:         issueId: stableId('issue', ['AMBIGUOUS_ASSIGNMENT', symbol]),
1006:         candidateIds: built.map((candidate) => candidate.candidateId),
1015:         issueId: stableId('issue', ['AMBIGUOUS_DEVIATION', symbol]),
1020:         candidateIds: deviationConflict.map((candidate) => candidate.candidateId),
1086:     candidateId: stableId('part-dimension', [
1087:       source.revisionId,
1093:     groupId: partName ? `part:${partName}` : null,
1183:     candidateId: stableId('interval', [
1184:       source.revisionId,
1192:     groupId: `interval:${match[1]}`,
1243:       candidateId: stableId('formula', [source.revisionId, raw, line.page]),
1245:       groupId: null,
1274:     candidateId: stableId('formula', [source.revisionId, match[1], raw, line.page]),
1276:     groupId: `formula:${match[1]}`,
1340:   const current = overrides.get(candidate.candidateId)
1342:   overrides.set(candidate.candidateId, { status: 'blocked', reasons: merged })
1380:       issueId: stableId('issue', ['FORMULA_CONFLICT', output]),
1385:       candidateIds: [
1386:         ...group.map((formula) => formula.candidateId),
1387:         ...relatedIntervals.map((interval) => interval.candidateId),
1430:         issueId: stableId('issue', ['FORMULA_VALUE_CONFLICT', output]),
1435:         candidateIds: [formula.candidateId, interval.candidateId],
1449:     const override = overrides.get(candidate.candidateId)
1469:     return left.candidateId.localeCompare(right.candidateId)
1479:     return left.issueId.localeCompare(right.issueId)
1488:   extra: { candidateIds?: readonly string[]; evidence?: readonly ExtractionEvidence[] } = {},
1491:     issueId: stableId('issue', [code, page ?? 0, message]),
1496:     candidateIds: extra.candidateIds ?? [],
1635:     issueId: stableId('issue', [code, chunk.index, chunk.from, chunk.to]),
1640:     candidateIds: [],
1657:     request.projectId,
1658:     request.source.documentId,
1659:     request.source.revisionId,
1660:     request.source.sha256,
1666:     draftId: stableId('draft', [idempotencyKey]),
1669:     projectId: request.projectId,
1777:       issueId: stableId('issue', [
1790:       candidateIds: [],
1803:     const candidateIds = finalCandidates
1809:       .map((candidate) => candidate.candidateId)
1810:     return { ...item, candidateIds }
```

### src/document-extraction/types.ts

```text
39:  *    - `sourceIdentity` 仍是原 PDF 的 revisionId + sha256，不因切块变化。
116:   readonly documentId: string
117:   readonly revisionId: string
118:   readonly sha256: string
128:   readonly documentId: string
129:   readonly revisionId: string
130:   readonly sha256: string
154:   readonly documentId: string
155:   readonly revisionId: string
156:   readonly sha256: string
165: /** 草绘照片 / 样品照片出处：锚在图片本身（imageId + sha256），不挂 PDF 版本。 */
168:   readonly imageId: string
169:   readonly sha256: string
179:  * 按 ADR-001 §11：`actorId` 用户手输、`sessionSeq` 项目内自增、`sessionLabel` 备注，
188:   readonly actorId: string
203:   readonly turnId?: string | null
212:   readonly actorId: string
215:   readonly turnId: string
216:   readonly modelId: string | null
217:   readonly source: { readonly kind: 'pdf-page'; readonly revisionId: string; readonly sha256: string; readonly page: number }
218:     | { readonly kind: 'image'; readonly imageId: string; readonly sha256: string }
258:     return typeof ref.actorId === 'string' && ref.actorId.trim() !== '' &&
260:       typeof ref.turnId === 'string' && ref.turnId.trim() !== '' &&
263:       (ref.modelId === null || (typeof ref.modelId === 'string' && ref.modelId.trim() !== '')) &&
264:       s !== undefined && typeof s.sha256 === 'string' && /^[a-f0-9]{64}$/iu.test(s.sha256) &&
265:       (s.kind === 'pdf-page' ? typeof s.revisionId === 'string' && s.revisionId.trim() !== '' &&
267:         s.kind === 'image' && typeof s.imageId === 'string' && s.imageId.trim() !== '')
272:       evidence.documentId.trim() === '' ||
273:       evidence.revisionId.trim() === '' ||
274:       evidence.sha256.trim() === '' ||
301:       ocr.documentId.trim() === '' ||
302:       ocr.revisionId.trim() === '' ||
303:       ocr.sha256.trim() === '' ||
328:       image.imageId.trim() === '' ||
329:       image.sha256.trim() === '' ||
344:       attestation.actorId.trim() === '' ||
372:   readonly revisionId: string
380:  * `revisionId#page#x0#y0#x1#y1#textSnippet`。
385:     evidence.revisionId,
408:       image.imageId,
409:       image.sha256,
421:       attestation.actorId,
453:  * - pdf-text / pdf-ocr：所属 revision 的 sha256 变了（或版本不再可用）→ stale；
454:  * - image-ocr：图片 sha256 变了（或图片不再可用）→ stale；
461:   readonly revisions: readonly { readonly revisionId: string; readonly sha256: string }[]
463:   readonly images?: readonly { readonly imageId: string; readonly sha256: string }[]
474:       ? state.revisions.find((r) => r.revisionId === s.revisionId)
475:       : (state.images ?? []).find((i) => i.imageId === s.imageId)
476:     return current?.sha256 === s.sha256 ? 'valid' : 'stale'
480:     const current = state.revisions.find((item) => item.revisionId === anchor.revisionId)
481:     return current !== undefined && current.sha256 === anchor.sha256 ? 'valid' : 'stale'
485:     const current = (state.images ?? []).find((item) => item.imageId === image.imageId)
486:     return current !== undefined && current.sha256 === image.sha256 ? 'valid' : 'stale'
591:   readonly candidateId: string
593:   readonly groupId: string | null
628:   readonly issueId: string
633:   readonly candidateIds: readonly string[]
661:   readonly decisionId: string
662:   readonly candidateId: string
678:    * 只有批量补单位写它：同一批的所有决定共享一个 batchId，界面的「整批撤销」
679:    * 按它定位；“逐条撤销”只看 candidateId，不依赖批次。
681:   readonly batchId?: string | null
691:   readonly draftId: string
694:   readonly projectId: string
735:   /** user-attestation 的 actorId/sessionSeq 与当前会话不一致（跨会话伪造）。 */
743:   /** 批量补单位：缺少“哪一轮输入”（turnId）；由 main 生成，不能为空。 */
```

### src/domain/calculate.ts

```text
6: type Contribution = { termId: string; toleranceQ: number }
7: type Ratio = { termId: string; ratio: number | null }
38:     lowerQ: safeAdd(term.nominalQ, term.lowerDeviationQ, `L(${term.id})`),
39:     upperQ: safeAdd(term.nominalQ, term.upperDeviationQ, `U(${term.id})`),
83:     contributions.push({ termId: id, toleranceQ: termToleranceQ })
131:   return result.contributions.map(({ termId, toleranceQ }) => ({
132:     termId,
```

### src/domain/compare.ts

```text
10:       termId: string
16:       termId: string
22:       termId: string
38:  * - addedTermIds / removedTermIds 按 term id 匹配，数组顺序分别沿用 after / before 的组成环顺序。
44:   addedTermIds: string[]
45:   removedTermIds: string[]
61:   const termId = before.id
64:     changes.push({ termId, field: 'symbol', before: before.symbol, after: after.symbol })
67:     changes.push({ termId, field: 'name', before: before.name, after: after.name })
70:     changes.push({ termId, field: 'nominalQ', before: before.nominalQ, after: after.nominalQ })
74:       termId,
82:       termId,
89:     changes.push({ termId, field: 'sign', before: before.sign, after: after.sign })
93:       termId,
124: function commonTermIds(chain: ChainDefinition, otherIds: ReadonlySet<string>): string[] {
125:   return chain.terms.filter((term) => otherIds.has(term.id)).map((term) => term.id)
138:   const beforeIds = new Set(before.terms.map((term) => term.id))
139:   const afterIds = new Set(after.terms.map((term) => term.id))
141:   const addedTermIds = after.terms
142:     .filter((term) => !beforeIds.has(term.id))
143:     .map((term) => term.id)
144:   const removedTermIds = before.terms
145:     .filter((term) => !afterIds.has(term.id))
146:     .map((term) => term.id)
148:   const commonIds = new Set(
149:     before.terms.filter((term) => afterIds.has(term.id)).map((term) => term.id),
151:   const beforeCommonOrder = commonTermIds(before, commonIds)
152:   const afterCommonOrder = commonTermIds(after, commonIds)
154:     (termId, index) => termId !== afterCommonOrder[index],
157:   const beforeById = new Map(before.terms.map((term) => [term.id, term]))
159:     const beforeTerm = beforeById.get(term.id)
164:     addedTermIds,
165:     removedTermIds,
```

### src/domain/types.ts

```text
59:   backupId: string
92:   contributions: { termId: string; toleranceQ: Q }[]
```

### src/domain/validation.ts

```text
110:         term.id,
```

### src/drawing/dxfExport.ts

```text
152:   annotationId: string
257:   annotationId: string
363: function layerOfLine(styleId: string): DxfLayerName {
364:   const layer = LINE_LAYER[styleId]
365:   if (layer === undefined) fail('INVALID_DRAWING', `未知线型样式：${styleId}`)
369: function layerOfText(styleId: string): DxfLayerName {
370:   const layer = TEXT_LAYER[styleId]
371:   if (layer === undefined) fail('INVALID_DRAWING', `未知文字样式：${styleId}`)
375: function textHeightOf(data: DrawingData, styleId: string): number {
376:   if (styleId === 'dim' || styleId === 'drawing-note') return data.styles.fontSizeMm
377:   const fixed = SHEET_TEXT_HEIGHT_MM[styleId]
378:   if (fixed === undefined) fail('INVALID_DRAWING', `未知文字样式：${styleId}`)
398:     return paperLine(data, geometry, layerOfLine(primitive.styleId), source, STYLE_LINETYPE[primitive.styleId])
403:       fail('INVALID_DRAWING', `折线 ${primitive.primitiveId} 顶点不足`)
407:       layer: layerOfLine(primitive.styleId),
416:     const radius = finite(geometry.r, `${primitive.primitiveId}.r`) * dxfScaleFactorOf(data)
417:     if (radius <= 0) fail('INVALID_DRAWING', `圆 ${primitive.primitiveId} 半径非正`)
418:     return { kind: 'circle', layer: layerOfLine(primitive.styleId), source, space: 'model', cx: center.x, cy: center.y, r: radius }
425:       layer: layerOfText(primitive.styleId),
430:       height: textHeightOf(data, primitive.styleId) * dxfScaleFactorOf(data),
458:   const resolved = resolveDimension(annotation.parameterId, data.parameterSnapshot)
459:   if (!resolved.ok) fail('INVALID_DRAWING', `标注数字无法解析：${resolved.message}`, annotation.annotationId)
553:  *   · 数值文字/实测值 ← resolveDimension(parameterId, 快照)（模型真值，不写死）
561:   const resolved = resolveDimension(annotation.parameterId, data.parameterSnapshot)
562:   if (!resolved.ok) fail('INVALID_DRAWING', `标注数字无法解析：${resolved.message}`, annotation.annotationId)
564:   if (geometry.lines.length === 0) fail('INVALID_DRAWING', `标注 ${annotation.annotationId} 没有几何`, annotation.annotationId)
576:     if (!(radiusPaperMm > 0)) fail('INVALID_DRAWING', `标注 ${annotation.annotationId} 半径非正`)
585:       annotationId: annotation.annotationId,
617:     annotationId: annotation.annotationId,
642:   styleId: 'frame-text' | 'frame-text-strong' | 'sheet-status',
646:   const height = SHEET_TEXT_HEIGHT_MM[styleId]
647:   if (height === undefined) fail('INVALID_DRAWING', `未知文字样式：${styleId}`)
865:   pair(state, 69, entity.id)
908:  * 直接报 `Null object Id` 拒收整份文件——这是本次最容易踩的坑。
1075:       primitive.primitiveId === 'axial.outline' &&
1077:       primitive.styleId === 'outline' &&
1216:   // VPORT（2000）：R2000 文件必须有活动视口记录 *Active，否则 ODA 系导入器报 Null object Id。
1486:       // 写错会让导入器报 Null object Id / Invalid index（实测 QCAD 3.33.1 直接拒收）。
1638:       annotationId: entity.annotationId,
```

### src/drawing/dxfGbkTable.ts

```text
248:   'ZGxlbGZsZ2xobGlsamxrbGxsbWxubG9scGxxbHJsc2x0bHVsdmx3bHhseWx6bHtsfGx9bH5sf2yAbIFsgmyDbIRshWyGbIds',
```

### src/drawing/fingerprint.ts

```text
26: export function sha256Bytes(bytes: Uint8Array): string {
86: export function sha256Text(text: string): string {
87:   return sha256Bytes(new TextEncoder().encode(text))
140: export function stableFingerprint(value: unknown): string {
141:   return sha256Text(canonicalJson(value))
```

### src/drawing/formatDimension.ts

```text
5:  * - 标注只绑定 parameterId，数字来自参数快照的 valueQ，不读几何、像素或缩放；
14:   parameterId: string
50:  * 标注数字解析：只查 parameterId 对应的参数快照。
54:   parameterId: string,
57:   const matches = snapshot.filter((item) => item.parameterId === parameterId)
59:     return { ok: false, message: `标注引用了不存在的参数：${parameterId}` }
62:     return { ok: false, message: `参数快照里 parameterId 重复：${parameterId}` }
75:       parameterId: item.parameterId,
```

### src/drawing/layout.ts

```text
140:   /** annotationId → 已经由 parameterId 解析出的最终文字（含 ⌀）。 */
173:       textBoxes.push({ id: primitive.primitiveId, box })
176:       conflicts.push(`图元超出可用区：${primitive.primitiveId}`)
185:         conflicts.push(`尺寸线超出可用区：${annotation.annotationId}`)
188:     const text = input.annotationTexts[annotation.annotationId]
190:       conflicts.push(`标注文字未解析：${annotation.annotationId}`)
201:     textBoxes.push({ id: annotation.annotationId, box })
203:       conflicts.push(`标注文字超出可用区：${annotation.annotationId}`)
210:         conflicts.push(`文字重叠：${textBoxes[i].id} / ${textBoxes[j].id}`)
```

### src/drawing/rebuildDrawing.ts

```text
5:  * dataFingerprint 一致，否则按数据不一致处理，不用默认值补齐。
29:       projectId: project.id,
30:       revisionId: record.revisionId,
31:       drawingId: record.drawingId,
38:     if (data.fingerprint !== record.dataFingerprint) {
42:         detail: `saved=${record.dataFingerprint}, rebuilt=${data.fingerprint}`,
```

### src/drawing/renderDrawingSvg.ts

```text
26:   selectedAnnotationId?: string | null
65: function styleAttribute(styleId: string): string {
66:   const className = STYLE_CLASS[styleId]
68:     throw new Error(`未知线型样式：${styleId}`)
76:     return `<line x1="${number(geometry.x1)}" y1="${number(geometry.y1)}" x2="${number(geometry.x2)}" y2="${number(geometry.y2)}" ${styleAttribute(primitive.styleId)}/>`
80:     return `<circle cx="${number(geometry.cx)}" cy="${number(geometry.cy)}" r="${number(geometry.r)}" ${styleAttribute(primitive.styleId)}/>`
84:     return `<polyline points="${pointList(geometry.points)}" ${styleAttribute(primitive.styleId)}/>`
88:     const className = TEXT_CLASS[primitive.styleId]
90:       throw new Error(`未知文字样式：${primitive.styleId}`)
102:   const resolved = resolveDimension(annotation.parameterId, data.parameterSnapshot)
123:   return `<g class="${className}" data-annotation-id="${escapeXml(annotation.annotationId)}" data-parameter-id="${escapeXml(annotation.parameterId)}" data-kind="${annotation.kind}" tabindex="0" role="button" aria-label="${escapeXml(`${label}标注 ${text}，点击定位参数`)}"><title>${escapeXml(`${label} ${text}（点击定位参数）`)}</title>${lines}${arrows}<text x="${number(annotation.textPositionMm.x)}" y="${number(annotation.textPositionMm.y)}" text-anchor="${annotation.textAnchor}" dominant-baseline="alphabetic" class="t-dim">${escapeXml(text)}</text></g>`
153:  * 序列化 DrawingData。输出只依赖数据本身（selectedAnnotationId 只影响高亮类），
160:   const selected = options.selectedAnnotationId ?? null
162:     .map((annotation) => renderAnnotation(annotation, data, annotation.annotationId === selected))
166:       drawingId: data.drawingId,
167:       drawingFingerprint: data.fingerprint,
169:       templateId: data.templateId,
173:       parameterIds: data.parameterSnapshot.map((item) => item.parameterId),
180:     `<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210" version="1.1" data-drawing-id="${escapeXml(data.drawingId)}" data-drawing-fingerprint="${escapeXml(data.fingerprint)}">`,
232:     const resolved = resolveDimension(annotation.parameterId, expected.parameterSnapshot)
235:       errors.push(`SVG 缺少标注文字：${annotation.annotationId}`)
237:     if (!markup.includes(`data-parameter-id="${escapeXml(annotation.parameterId)}"`)) {
238:       errors.push(`SVG 缺少参数绑定：${annotation.annotationId}`)
```

### src/drawing/spacerDrawing.ts

```text
7:  * 标注绑定 parameterId，数字统一走 resolveDimension；几何只由整数 q 换算，
13: import { stableFingerprint } from './fingerprint'
65:   projectId: string
66:   revisionId: string
67:   drawingId: string
71:   partId?: string
96:   primitiveId: string,
97:   viewId: string | undefined,
99:   styleId: string,
102:   return { primitiveId, ...(viewId === undefined ? {} : { viewId }), kind: 'line', geometryMm: geometry, styleId, area }
106:   primitiveId: string,
108:   styleId: string,
110:   viewId?: string,
112:   return { primitiveId, ...(viewId === undefined ? {} : { viewId }), kind: 'text', geometryMm: geometry, styleId, area }
143:   revisionId: string,
165:   // 旧记录（版本栏为空）保持既有回退文字：这些图纸的 dataFingerprint 是用这段文字算的，
168:   const version = fields.version.trim() === '' ? `草稿 ${revisionId}` : fields.version.trim()
180:     primitiveId: 'frame.border',
191:     styleId: 'frame',
195:     primitiveId: 'frame.title-block',
206:     styleId: 'frame',
210:     primitiveId: 'frame.tech-block',
221:     styleId: 'frame',
380:   if (input.partId !== undefined && input.partId !== SPACER_PART_ID) {
381:     throw new DrawingBuildError('INVALID_PARAMETER', `图纸部件必须是隔套：${input.partId}`)
391:     const provenance = input.parameters.find((item) => item.parameterId === parameter.parameterId)?.provenance
415:   const axialViewId = 'view:axial'
416:   const endViewId = 'view:right-end'
419:     primitiveId: 'axial.outline',
420:     viewId: axialViewId,
431:     styleId: 'outline',
435:     linePrimitive('axial.hidden.top', axialViewId, line(x1, axial.y - innerRadiusMm, x2, axial.y - innerRadiusMm), 'hidden', 'drawing'),
436:     linePrimitive('axial.hidden.bottom', axialViewId, line(x1, axial.y + innerRadiusMm, x2, axial.y + innerRadiusMm), 'hidden', 'drawing'),
437:     linePrimitive('axial.center', axialViewId, line(x1 - 4, axial.y, x2 + 4, axial.y), 'center', 'drawing'),
441:     primitiveId: id,
442:     viewId: endViewId,
445:     styleId: 'outline',
450:     linePrimitive('end.center.h', endViewId, line(end.x - outerRadiusMm - 4, end.y, end.x + outerRadiusMm + 4, end.y), 'center', 'drawing'),
451:     linePrimitive('end.center.v', endViewId, line(end.x, end.y - outerRadiusMm - 4, end.x, end.y + outerRadiusMm + 4), 'center', 'drawing'),
488:       annotationId: 'ann.length',
489:       parameterId: length.parameterId,
490:       viewId: axialViewId,
495:       styleId: 'dim',
498:       annotationId: 'ann.inner-diameter',
499:       parameterId: inner.parameterId,
500:       viewId: endViewId,
505:       styleId: 'dim',
508:       annotationId: 'ann.outer-diameter',
509:       parameterId: outer.parameterId,
510:       viewId: endViewId,
515:       styleId: 'dim',
519:   // 标注文字必须由 parameterId + 快照解析；解析失败直接拒绝生成。
522:     const resolved = resolveDimension(annotation.parameterId, parameters)
529:     annotationTexts[annotation.annotationId] = annotation.kind === 'diameter' ? `⌀${layoutText}` : layoutText
533:     { viewId: axialViewId, kind: 'axial', anchorMm: { ...axial }, scaleFactor, primitiveIds: ['axial.outline', 'axial.hidden.top', 'axial.hidden.bottom', 'axial.center'] },
534:     { viewId: endViewId, kind: 'right-end', anchorMm: { ...end }, scaleFactor, primitiveIds: ['end.outer', 'end.inner', 'end.center.h', 'end.center.v'] },
546:   const frame = buildFrame(frameFields, input.revisionId, input.scale)
564:   const parameterFingerprint = stableFingerprint(parameters)
565:   const modelRevisionId = `parametric-spacer:${SPACER_TEMPLATE_ID}:${parameterFingerprint.slice(0, 16)}`
566:   const withoutFingerprint: Omit<DrawingData, 'fingerprint'> = {
568:     drawingId: input.drawingId,
569:     projectId: input.projectId,
570:     revisionId: input.revisionId,
571:     partId: SPACER_PART_ID,
572:     templateId: SPACER_TEMPLATE_ID,
577:       modelRevisionId,
578:       parameterFingerprint,
590:   const fingerprint = stableFingerprint(withoutFingerprint)
591:   return { ...withoutFingerprint, fingerprint }
598:     const resolved = resolveDimension(annotation.parameterId, data.parameterSnapshot)
600:     texts[annotation.annotationId] = dimensionText(resolved.value, annotation.kind)
607:   parameterId: string
615:     parameterId: item.parameterId,
```

### src/drawing/types.ts

```text
39:   parameterId: string
40:   partId: string
138:   primitiveId: string
139:   viewId?: string
142:   styleId: string
163:   annotationId: string
164:   parameterId: string
165:   viewId: string
167:   /** 尺寸几何只描述线/箭头位置；数字永远由 parameterId + 快照解析。 */
171:   styleId: string
175:   viewId: string
180:   primitiveIds: string[]
184:   fontId: 'noto-sans-sc-cunlian'
204:   fontId: 'noto-sans-sc-cunlian',
250:   modelRevisionId: string
252:   parameterFingerprint: string
257:   drawingId: string
258:   projectId: string
259:   revisionId: string
260:   partId: string
261:   templateId: typeof SPACER_TEMPLATE_ID
```

### src/dxf-view/hit.ts

```text
89:   entityId: string
94:   viaViewport?: string
101:     entityId: string,
106:     viaViewport?: string,
112:         best = { entityId, type, layer, color, distance, viaViewport }
117:     consider(entity.entityId, entity.type, entity.layer, entity.color, entity.shapes, entity.viaViewport)
121:       consider(entity.entityId, entity.type, entity.layer, entity.color, entity.shapes, viewport.id)
```

### src/dxf-view/parse.ts

```text
682:         notes.push(`视口 ${viewport.id} 带 ${viewport.twistDeg}° 旋转；按 0° 渲染。`)
```

### src/dxf-view/scene.ts

```text
202:     entityId: entity.id,
233:       id: viewport.id,
245:           viaViewport: viewport.id,
```

### src/dxf-view/types.ts

```text
6:  * parameterId，也不允许写回。两者语义不同，不互相塞。
167:   entityId: string
173:   viaViewport?: string
```

### src/fixtures/demo.ts

```text
10: export type DemoCaseId = 'A' | 'B' | 'C'
13:   id: DemoCaseId
21: const DEMO_CASE_NAMES: Record<DemoCaseId, string> = {
93: export function demoCaseName(id: DemoCaseId): string {
97: export function createDemoChain(id: DemoCaseId): ChainDefinition {
```

### src/history/events.ts

```text
66:   projectId: string
70:   documentId?: string
71:   revisionId?: string
72:   bindingId?: string
73:   termId?: string
86:   parameterId?: string
89:   drawingId?: string
90:   drawingFingerprint?: string
96:   requirementId?: string
97:   requirementRevisionId?: string
98:   parentRevisionId?: string | null
103:   sourceRevisionId?: string
105:   checkId?: string
116:  * **不保证唯一**：调用方常把毫秒级时间戳拼进 subject（如 `${bindingId}:${reviewedAt}`），
120: export function changeEventId(type: ChangeEventType, subjectId: string): string {
121:   return `${type}:${subjectId}`
140: export function uniqueChangeEventId(baseId: string): string {
142:   return `${baseId}#${EVENT_ID_SESSION_TAG}${String(eventIdSequence).padStart(8, '0')}`
155:     .add({ ...event, id: uniqueChangeEventId(event.id) })
168:   return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
```

### src/history/snapshotId.ts

```text
7: export function snapshotShortId(id: string): string {
```

### src/history/snapshots.ts

```text
9:  * - 报告只从 snapshotId 读取快照，不再读取工作台实时数据；工作数据变化后旧
17: import { addChangeEvent, changeEventId } from '../history/events'
26: import { sha256Hex } from '../sources/hash'
68:   bindingId: string
69:   termId: string
73:   documentId: string
75:   revisionId: string
97:   unboundTermIds: string[]
118:   projectId: string
128:   inputFingerprint: string
205: function randomId(): string {
245:   return name !== '' ? name : term.id
250:   ruleId: (typeof REVIEW_RULE_IDS)[number],
251:   bindingId: string,
255:       finding.ruleId === ruleId &&
257:       finding.subject.bindingId === bindingId,
271:     left.id.localeCompare(right.id),
274:     left.id.localeCompare(right.id),
276:   const documentById = new Map(documents.map((document) => [document.id, document]))
277:   const revisionById = new Map(revisions.map((revision) => [revision.id, revision]))
278:   const termById = new Map(draft.terms.map((term) => [term.id, term]))
280:     left.id.localeCompare(right.id),
284:     const revision = revisionById.get(binding.revisionId) ?? null
285:     const document = documentById.get(binding.documentId) ?? null
286:     const term = termById.get(binding.termId) ?? null
288:       bindingId: binding.id,
289:       termId: binding.termId,
292:       documentId: binding.documentId,
294:       revisionId: binding.revisionId,
296:       revisionSha256: revision?.sha256 ?? null,
311:         available: statusOf(findingFor(review, 'SOURCE_AVAILABLE', binding.id)),
312:         current: statusOf(findingFor(review, 'SOURCE_CURRENT', binding.id)),
314:           findingFor(review, 'SOURCE_VALUE_REVIEWED', binding.id),
323:     for (const binding of bindings.filter((item) => item.termId === term.id)) {
327:   const knownTermIds = new Set(draft.terms.map((term) => term.id))
329:     if (!knownTermIds.has(binding.termId)) {
334:   const unboundTermIds = draft.terms
337:         !bindings.some((binding) => binding.termId === term.id),
339:     .map((term) => term.id)
350:     unboundTermIds,
363:   const sortById = <T extends { id: string }>(items: readonly T[]): T[] =>
364:     [...items].sort((left, right) => left.id.localeCompare(right.id))
371:     documents: sortById(input.sources.documents),
372:     revisions: sortById(input.sources.revisions),
373:     bindings: sortById(input.sources.bindings),
380:   return sha256Hex(new TextEncoder().encode(canonical))
395:   projectId: string,
411:       transaction.objectStore(PROJECT_STORE_NAME).get(projectId),
418:       transaction.objectStore(DRAFT_STORE_NAME).get(projectId),
423:         .index('projectId')
424:         .getAll(projectId),
429:         .index('projectId')
430:         .getAll(projectId),
433:       transaction.objectStore(BINDING_STORE_NAME).index('projectId').getAll(projectId),
438:         .index('projectId')
439:         .getAllKeys(projectId),
479:       const state = await readSnapshotState(db, input.project.id)
503:           id: term.id,
516:       const inputFingerprint = await fingerprint({
541:         id: input.id ?? randomId(),
542:         projectId: input.project.id,
547:         inputFingerprint,
570:           transaction.objectStore(PROJECT_STORE_NAME).get(input.project.id),
582:         const existing = await requestResult(snapshotStore.get(snapshot.id))
593:           id: changeEventId('analysis_snapshot_created', snapshot.id),
594:           projectId: snapshot.projectId,
597:           message: `已创建分析快照 ${snapshot.id}；审查状态：${
626:   snapshotId: string,
633:         transaction.objectStore(SNAPSHOT_STORE_NAME).get(snapshotId),
654:   projectId: string,
658:       const state = await readSnapshotState(db, projectId)
667:           .index('projectId')
668:           .getAll(projectId),
672:       const currentFingerprint = await fingerprint({
687:           right.id.localeCompare(left.id),
689:       const currentId =
691:           (snapshot) => snapshot.inputFingerprint === currentFingerprint,
692:         )?.id ?? null
697:           const historical = snapshot.id !== currentId
702:               ? currentId === null
```

### src/import/commit.ts

```text
47:   projectId?: string
89:   usedIds: Set<string>,
94:   while (usedIds.has(id)) {
98:   usedIds.add(id)
104:   rowNumberById: Map<string, number>,
114:     const rowNumber = rowNumberById.get(id)
137:   const existingIds = new Set(existingTerms.map((term) => term.id))
138:   const rowNumberById = new Map<string, number>()
140:     const draft = importDraftTerm(term, index, existingIds)
141:     const id = draft.id
142:     rowNumberById.set(id, term.rowNumber)
214:         ...translateCellErrors(conversion.cellErrors, rowNumberById),
296:   if (input.projectId === undefined) {
313:       input.projectId,
```

### src/import/templates.ts

```text
56: function newTemplateId(): string {
151:     typeof record.id === 'string' &&
175:         right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
198:     id: newTemplateId(),
```

### src/intent/draft.ts

```text
14: import { stableId, stableHash } from '../document-extraction/ids'
36: export function intentDraftId(projectId: string): string {
37:   return `intent-draft-${stableHash([projectId])}`
52: export function intentSourceIdentity(projectId: string, session: IntentSession) {
54:     documentId: `intent:${projectId}`,
55:     revisionId: `intent:${projectId}:s${session.sessionSeq}`,
56:     sha256: contentIdentity([projectId, session.actorId, session.sessionSeq]),
64:   projectId: string
69:     draftId: intentDraftId(input.projectId),
72:     projectId: input.projectId,
73:     baseToken: `intent:${input.session.actorId}:${input.session.sessionSeq}`,
74:     sourceIdentity: intentSourceIdentity(input.projectId, input.session),
77:     idempotencyKey: stableId('intent', [
78:       input.projectId,
79:       input.session.actorId,
168: function ringCandidateId(draft: ExtractionDraft, symbol: string): string {
169:   return stableId('intent-ring', [draft.draftId, symbol])
175:  * 同一符号重复写入不是新增候选：保留 candidateId、推进 editRevision，
229:       candidateId: ringCandidateId(draft, symbol),
231:       groupId: stableId('intent-ring-group', [draft.draftId, symbol]),
261:       candidateId: stableId('intent-formula', [draft.draftId]),
263:       groupId: null,
293:       left.candidateId.localeCompare(right.candidateId),
350:     candidateId: stableId('intent-interval', [draft.draftId]),
352:     groupId: null,
378:     ].sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
472:     candidateId: stableId('intent-part', [draft.draftId]),
474:     groupId: null,
497:     ].sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
```

### src/intent/requirement.ts

```text
10:  * 身份是确定的：同一草稿 + 同一区间 + 同一原话 → 同一 revisionId，
15: import { stableId } from '../document-extraction/ids'
26:   projectId: string
31:   requirementId: string | null
44:     parameterId: parameter.parameterId,
50:     termId: term.id,
55:     bindingId: link.bindingId,
56:     termId: link.termId,
57:     parameterId: link.parameterId,
59:   const requirementId =
60:     input.requirementId ??
61:     stableId('intent-requirement', [input.projectId, input.candidate.candidateId])
62:   const revisionId = stableId('intent-requirement-revision', [
63:     input.projectId,
64:     input.candidate.candidateId,
71:     requirementId,
72:     revisionId,
73:     parentRevisionId: null,
74:     projectId: input.projectId,
75:     chainRef: { projectId: input.projectId, kind: 'project-dimension-chain' },
80:     confirmedAgainstLatestRevisionId: `intent:${input.projectId}`,
```

### src/intent/types.ts

```text
7:  * 3. 每个写入都产生 `user-attestation` 出处（actorId + sessionSeq + turnId + 原话），
14:   readonly actorId: string
22:   readonly turnId: string
121:     actorId: input.session.actorId,
127:     turnId: input.turn.turnId,
```

### src/main.tsx

```text
6: createRoot(document.getElementById('root')!).render(
```

### src/pages/DesktopWorkspace.tsx

```text
15: import { DEMO_PARTS, demoPart, isBuiltinPartId, partPropertyRows, qToMm } from '../parts/shaftDemo'
83:       (item) => item.revisionId === project.activeRequirementRevisionId,
90:     : resolveRequirementRevisionSource(snapshot, activeRequirement.revisionId).location
91:   function locateRequirementRevision(revisionId: string): void {
93:     const resolved = resolveRequirementRevisionSource(snapshot, revisionId)
95:       setLocateError(resolved.issue?.message ?? `条款版本 ${revisionId} 无法定位来源。`)
105:     locateRequirementRevision(activeRequirement.revisionId)
109:       setSelection(`param:${value.parameterId}`)
116:       requirementRevisionId: value.requirementRevisionId,
117:       revisionId: value.revisionId,
140:   const sessionId = session.state?.sessionId ?? null
143:   const [selectionState, setSelectionState] = useState<{ sessionId: string | null; value: string | null }>({ sessionId: null, value: null })
144:   const selection = selectionState.sessionId === sessionId ? selectionState.value : null
145:   const setSelection = (value: string | null) => setSelectionState({ sessionId, value })
146:   const demo = useBuiltinAssemblyView(sessionId)
148:     sessionId,
154:     | { kind: 'bind'; termId: string; granularity: 'model' | 'part' }
183:     if (sessionId === null || window.cunlian === undefined) throw new Error('window.cunlian 不可用')
184:     const result = await window.cunlian.readAttachment({ sessionId, revisionId: revision.id })
238:     (item) => item.modelRevisionId === model.revisionId,
243:         const rev = project?.modelRevisions.find(item => item.modelRevisionId === part.currentModelRevisionId)
245:           id: part.partId,
249:             ['当前模型版本', part.currentModelRevisionId ?? '无'],
257:       ...(demo.active ? DEMO_PARTS.map(part => ({ id: part.id, label: part.name, properties: partPropertyRows(part.id, demo.explodeT) })) : []),
261:         id: `drawing:${record.drawingId}`,
265:           ['模板', `${record.templateId} v${record.templateVersion}`],
268:           ['图纸指纹', record.dataFingerprint],
269:           ['参数引用', record.parameterIds.join('、')],
273:         id: `param:${parameter.parameterId}`,
280:           ['绑定标注', effectiveDrawing?.annotations.filter(item => item.parameterId === parameter.parameterId).map(item => item.kind === 'diameter' ? '直径' : '长度').join('、') || '无'],
284:         const resolved = resolveDimension(annotation.parameterId, effectiveDrawing!.parameterSnapshot)
287:           id: `annotation:${annotation.annotationId}`,
291:             ['绑定参数', annotation.parameterId],
293:             ['视图', annotation.viewId],
298:     尺寸链: project ? [{ id: 'chain', label: '当前尺寸链', properties: [['组成环', String(project.dimensionChain.terms.length)], ['计算预览', calculation]] }, ...project.dimensionChain.terms.map(term => ({ id: `term:${term.id}`, label: `${term.symbol} · ${term.name}`, properties: [['基本尺寸', `${formatMm(term.nominalQ)} mm`], ['下偏差', `${formatMm(term.lowerDeviationQ)} mm`], ['上偏差', `${formatMm(term.upperDeviationQ)} mm`], ['方向', term.sign === 1 ? '增环' : '减环'], ['来源备注', term.sourceNote || '无']] as [string, string][] }))] : [],
299:     来源资料: snapshot?.documents.map(doc => { const rev = snapshot.revisions.find(rev => rev.id === doc.latestRevisionId); return { id: `source:${doc.id}`, label: doc.title, properties: [['当前版本', doc.latestRevisionId], ['文件名', rev?.fileName ?? '缺失版本'], ['页数', String(rev?.pageCount ?? '未知')], ['附件状态', snapshot.missingAttachments.some(item => item.documentId === doc.id) ? '声明缺失' : '有元数据，未读取附件']] } }) ?? [],
300:     版本历史: snapshot?.fileRevisions.map(rev => ({ id: `rev:${rev.revisionId}`, label: `Rev ${rev.revisionId}`, properties: [['创建时间', rev.createdAt], ['原因', rev.reason], ['父版本', rev.parentId ?? '无'], ['项目 schema', String(rev.project.schemaVersion)]] })) ?? [],
302:   const selected = Object.values(entries).flat().find(item => item.id === selection)
303:   const selectedPart = isBuiltinPartId(selection) && demo.active ? demoPart(selection) : null
304:   const selectedModelPart = modelParts.find(part => part.partId === selection) ?? null
305:   const selectedParameterId = selection?.startsWith('param:') ? selection.slice('param:'.length) : null
306:   const selectedAnnotationId = selection?.startsWith('annotation:') ? selection.slice('annotation:'.length) : null
307:   const annotationParameterId = selectedAnnotationId === null
309:     : effectiveDrawing?.annotations.find(item => item.annotationId === selectedAnnotationId)?.parameterId ?? null
310:   const activeParameterId = selectedParameterId ?? annotationParameterId
311:   const selectedTermId = selection?.startsWith('term:') ? selection.slice('term:'.length) : null
312:   const termLinks = selectedTermId && project ? project.dimensionLinks.filter(isVisualReferenceLink).filter((link) => link.termId === selectedTermId) : []
314:     project?.parts.find(part => part.partId === link.target.partId)?.name ?? link.target.partId
347:       {session.recovery.length > 0 && <section className="desktop-workspace__recovery"><h3>有尚未保存的恢复草稿</h3>{session.recovery.map(item => <div key={item.recoveryId}><span>{item.name} · {item.savedAt}</span>{item.error ? <p role="alert">{item.error}</p> : <button disabled={session.busy} onClick={() => void session.restore(item.recoveryId)}>恢复为未保存副本</button>}</div>)}</section>}
350:       <ul className="desktop-workspace__recent">{session.recent.map(item => <li key={item.recentId}><div><strong>{item.name}</strong>{item.sourceKind === 'user-intent' && <span className="desktop-workspace__source-badge" data-testid="recent-no-external-source">无外部来源</span>}<p>{item.rev ? `Rev ${item.rev}` : 'Rev 不可用'} · 上次打开 {item.lastOpenedAt}</p><p>{item.path}</p></div><button disabled={session.busy} onClick={() => void session.openRecent(item)}>{item.missing ? '重新定位' : '打开'}</button></li>)}</ul>
356:       <h1>寸链 · {project.name}</h1><span>Rev {project.currentRevisionId}</span><span className="desktop-workspace__pending">{saveState}</span>
376:       {model.partId && <button disabled={model.busy || session.busy} onClick={() => void model.beginImport(true)}>替换模型…</button>}
396:         (model.pending.replacePartId
397:           ? project.parts.find(part => part.partId === model.pending!.replacePartId)?.name
407:         组成环 <strong>{project.dimensionChain.terms.find(term => term.id === linkDialog.termId)?.symbol ?? linkDialog.termId}</strong>
408:         {' '}↔ {linkDialog.granularity === 'model' ? '整体模型' : '已登记部件'}「{selectedModelPart?.name ?? modelParts.find(part => part.partId === model.partId)?.name ?? '—'}」
409:         {linkDialog.granularity === 'model' && model.revisionId ? `（版本 ${model.revisionId}）` : ''}。
411:         {linkTargetName(linkDialog.link)}：旧版 {linkDialog.link.target.modelRevisionId ?? '无版本'} → 当前新版 {model.revisionId ?? '—'}。
417:         <button type="button" className="desktop-workspace__primary" disabled={model.busy || model.partId === null} onClick={() => {
421:               ? await model.bindLink({ termId: dialog.termId, granularity: dialog.granularity, partId: model.partId!, modelRevisionId: model.revisionId })
422:               : await model.confirmLink({ linkId: dialog.link.linkId, termId: dialog.link.termId, partId: dialog.link.target.partId, modelRevisionId: model.revisionId })
443:           {entries[group].length ? entries[group].map(item => <button key={item.id} aria-pressed={selected?.id === item.id} onClick={() => { setSelection(item.id); if (group === '尺寸链') setTab(3); if (group === '版本历史') setTab(4) }}>{item.label}</button>) : <p>{group === '零件' ? '尚未打开轴系示例 · B1' : group === '工程图' ? '暂无工程图' : `暂无${group}`}</p>}
462:               key={`${session.state?.sessionId ?? 'none'}:${project.currentRevisionId}`}
465:               sessionId={sessionId}
477:               sessionId={sessionId}
485:               selectedParameterId={activeParameterId}
486:               selectedAnnotationId={selectedAnnotationId}
487:               onSelectParameter={parameterId => setSelection(parameterId === null ? null : `param:${parameterId}`)}
488:               onSelectAnnotation={annotationId => setSelection(`annotation:${annotationId}`)}
492:           {index === 1 && (model.revisionId !== null ? (
496:                   selected={selection !== null && selection === model.partId}
497:                   onSelect={value => setSelection(value ? model.partId : null)}
512:             ? <ThreeViewport selectedPartId={selectedPart?.id ?? null} onSelectPart={partId => setSelection(partId)} explodeT={demo.explodeT} onExplodeTChange={demo.setExplodeT} active={tab === 1} viewState={demo.view} onViewStateChange={demo.setView} spacerMm={spacerMm} />
523:           {index > 1 && tab === index && snapshot && (index === 2 ? <DesktopSourceView key={`${session.state!.sessionId}:${locate?.locateNonce ?? 'none'}`} snapshot={snapshot} sessionId={session.state!.sessionId!} requirementSource={requirementSource} locate={locate} onImportVersion={(documentId) => void session.importSource(documentId)} /> : index === 3 ? <DesktopChainView snapshot={snapshot} edit={session.edit} disabled={session.busy} /> : index === 4 ? <DesktopHistoryView snapshot={snapshot} requirementHistory={requirementHistory} onLocateRequirement={locateRequirementRevision} /> : <ExtractionReviewPanel
530:               onCancel: (requestId) => session.cancelExtraction(requestId),
542:         <dl><dt>项目版本</dt><dd>{project.currentRevisionId}</dd>{selected?.properties.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
551:           <button type="button" disabled={model.busy || !model.revisionId} onClick={() => void model.beginImport(true)}>替换当前模型…</button>
554:         {selectedTermId && project && <section className="desktop-workspace__part-note" aria-label="外形资料来源关联">
559:             const current = model.revisionId
560:             const stale = link.reviewStatus === 'pending' || (link.target.modelRevisionId !== null && link.target.modelRevisionId !== current)
561:             return <div key={link.linkId} className="desktop-workspace__link-row">
564:                 {link.target.modelRevisionId ? ` · 版本 ${link.target.modelRevisionId}` : ''}
568:               {stale && link.reviewStatus === 'pending' && current && <p>旧版 {link.target.modelRevisionId ?? '无'} → 当前新版 {current}</p>}
572:           {model.partId && model.revisionId && <>
573:             <button type="button" disabled={model.busy} onClick={() => setLinkDialog({ kind: 'bind', termId: selectedTermId, granularity: 'model' })}>关联整体模型…</button>
574:             <button type="button" disabled={model.busy} onClick={() => setLinkDialog({ kind: 'bind', termId: selectedTermId, granularity: 'part' })}>关联部件（记录版本）…</button>
576:           {!model.partId && <p>先导入或打开含模型的部件后才能建立关联。</p>}
579:         {activeParameterId && effectiveDrawing && (() => {
580:           const parameter = effectiveDrawing.parameterSnapshot.find(item => item.parameterId === activeParameterId)
582:           const bound = effectiveDrawing.annotations.filter(item => item.parameterId === parameter.parameterId)
591:             {bound.map(annotation => <button key={annotation.annotationId} type="button" onClick={() => setSelection(`annotation:${annotation.annotationId}`)}>
592:               定位标注 · {annotation.kind === 'diameter' ? '直径' : '长度'} · {annotation.annotationId}
604:         <section><h3>变更</h3>{session.change.preview ? <><p>预览 {session.change.preview.drawing.record.revisionId}：受影响环 {session.change.preview.affectedTermIds.length} 个；旧结果 {formatMm(session.change.preview.previousResult.minQ)} ～ {formatMm(session.change.preview.previousResult.maxQ)} mm → 新结果 {formatMm(session.change.preview.result.minQ)} ～ {formatMm(session.change.preview.result.maxQ)} mm。</p><p>受影响环不是错误；确认前可在“工程图”页查看逐环 diff。</p></> : <p>尚无变更预览。</p>}{session.change.staleReason && <p role="alert">预览已过期：{session.change.staleReason}</p>}</section>
609:             <p>活动条款 {activeRequirement.requirementId} · 版本 {activeRequirement.revisionId} · {formatMm(activeRequirement.lowerQ)} ～ {formatMm(activeRequirement.upperQ)} mm（闭区间）</p>
611:               <p>来源 {activeRequirement.source.revisionId} 第 {activeRequirement.source.page} 页 · SHA-256 {activeRequirement.source.sha256.slice(0, 12)}…</p>
647:     {requirementOpen && snapshot && sessionId && <RequirementWizard
649:       sessionId={sessionId}
664:       revisionId={project.currentRevisionId}
```

### src/pages/PrintReport.tsx

```text
1: import { useCallback, useEffect, useId, useState } from 'react'
19: import { snapshotShortId } from '../history/snapshotId'
23:   projectId: string
24:   snapshotId: string
26:   onBackToWorkspace?: (projectId: string) => void
28:   onBackToSnapshots?: (projectId: string) => void
107:     (finding) => finding.ruleId === 'RELATION_CONFIRMED',
152:             key={`${finding.ruleId}:${finding.subject.kind}:${finding.subject.id}`}
153:             data-testid={`pending-${finding.ruleId}-${finding.subject.id}`}
156:               {REVIEW_RULE_LABEL[finding.ruleId]}
157:               <span className="print-report__rule-id">{finding.ruleId}</span>
183:   const baseId = useId()
184:   const titleId = `${baseId}-title`
185:   const methodId = `${baseId}-method`
186:   const inputId = `${baseId}-input`
187:   const expressionId = `${baseId}-expression`
188:   const resultId = `${baseId}-result`
189:   const sourceId = `${baseId}-source`
190:   const reviewId = `${baseId}-review`
191:   const baselineId = `${baseId}-baseline`
192:   const notesId = `${baseId}-notes`
200:   const shortId = snapshotShortId(snapshot.id)
203:   const pageRule = `@page { @bottom-center { content: "第 " counter(page) " 页 / 共 " counter(pages) " 页 · 快照 ${shortId}"; font-size: 8pt; color: #555; } }`
211:       aria-labelledby={titleId}
215:         <h1 id={titleId} className="print-report__title">
225:             <dd className="print-report__mono">{snapshot.projectId}</dd>
230:               {snapshot.id}
276:       <section className="print-report__section" aria-labelledby={methodId}>
277:         <h2 id={methodId}>分析方法与适用范围</h2>
304:       <section className="print-report__section" aria-labelledby={inputId}>
305:         <h2 id={inputId}>完整输入（快照冻结）</h2>
320:               <tr key={term.id} data-testid={`report-term-${term.id}`}>
349:       <section className="print-report__section" aria-labelledby={expressionId}>
350:         <h2 id={expressionId}>尺寸链表达式与计算公式</h2>
369:       <section className="print-report__section" aria-labelledby={resultId}>
370:         <h2 id={resultId}>计算结果与判定</h2>
422:       <section className="print-report__section" aria-labelledby={sourceId}>
423:         <h2 id={sourceId}>来源清单（快照冻结）</h2>
430:             {snapshot.sourceManifest.unboundTermIds.length > 0 ? (
433:                 {snapshot.sourceManifest.unboundTermIds.join('、')}。
453:                     key={entry.bindingId}
454:                     data-testid={`report-source-${entry.bindingId}`}
457:                       {entry.termLabel ?? entry.termId}
463:                       {entry.documentTitle ?? entry.documentId}
469:                       {entry.revisionId}
512:       <section className="print-report__section" aria-labelledby={reviewId}>
513:         <h2 id={reviewId}>审查结果与未完成项（快照冻结）</h2>
533:         <section className="print-report__section" aria-labelledby={baselineId}>
534:           <h2 id={baselineId}>基线对比（快照冻结）</h2>
554:       <section className="print-report__section" aria-labelledby={notesId}>
555:         <h2 id={notesId}>假设与待确认事项</h2>
588:         <span className="print-report__mono">{snapshot.id}</span>）
596:  * 独立打印报告页：只按 snapshotId 读取不可变分析快照，不读取项目实时数据、
601:   projectId,
602:   snapshotId,
612:     getAnalysisSnapshot(snapshotId)
629:             message: `分析快照不存在：${snapshotId}`,
633:         if (loaded.value.projectId !== projectId) {
657:   }, [projectId, snapshotId, reloadToken])
666:       onBackToWorkspace(projectId)
669:     window.location.hash = `#/projects/${encodeURIComponent(projectId)}`
674:       onBackToSnapshots(projectId)
677:     window.location.hash = `#/projects/${encodeURIComponent(projectId)}/snapshots`
```

### src/pages/ProjectList.tsx

```text
15:   type DemoCaseId,
43:   onOpenProject?: (projectId: string) => void
58: function workspaceHash(projectId: string): string {
59:   return `#/projects/${encodeURIComponent(projectId)}`
208:         storedDrafts.value.map((stored) => [stored.projectId, stored.draft]),
252:   const [demoCase, setDemoCase] = useState<DemoCaseId>('A')
269:     (projectId: string) => {
271:         onOpenProject(projectId)
274:       window.location.hash = workspaceHash(projectId)
354:       openProject(created.value.id)
374:       openProject(created.value.id)
383:     openProject(result.project.id)
476:           .map((item) => `「${item.name}」（新 ID ${item.newProjectId.slice(0, 8)}…）`)
502:       const renamed = await updateProject(imported.value.project.id, {
522:       const deleted = await deleteProject(target.id)
705:           onChange={(event) => setDemoCase(event.target.value as DemoCaseId)}
709:             <option key={item.id} value={item.id}>
759:               <li key={project.id} data-testid={`legacy-project-${project.id}`}>
919:             const status = projectStatus(project, drafts.get(project.id) ?? null)
922:                 key={project.id}
924:                 data-testid={`project-${project.id}`}
929:                     href={workspaceHash(project.id)}
932:                       openProject(project.id)
947:                   data-testid={`project-status-${project.id}`}
955:                     onClick={() => openProject(project.id)}
```

### src/pages/SnapshotList.tsx

```text
8:   projectId: string
10:   onBackToWorkspace?: (projectId: string) => void
12:   onOpenReport?: (projectId: string, snapshotId: string) => void
46:   projectId,
57:     Promise.all([getProject(projectId), listAnalysisSnapshots(projectId)])
73:             message: `项目不存在：${projectId}`,
106:   }, [projectId, reloadToken])
110:       onBackToWorkspace(projectId)
113:     window.location.hash = `#/projects/${encodeURIComponent(projectId)}`
114:   }, [onBackToWorkspace, projectId])
117:     (snapshotId: string): void => {
119:         onOpenReport(projectId, snapshotId)
122:       window.location.hash = `#/projects/${encodeURIComponent(projectId)}/reports/${encodeURIComponent(snapshotId)}`
124:     [onOpenReport, projectId],
219:                 key={snapshot.id}
220:                 data-testid={`snapshot-${snapshot.id}`}
227:                   <span className="snapshot-list__id" title={snapshot.id}>
228:                     {snapshot.id}
231:                 <td data-testid={`snapshot-status-${snapshot.id}`}>
240:                 <td data-testid={`snapshot-history-${snapshot.id}`}>
252:                     onClick={() => openReport(snapshot.id)}
253:                     data-testid={`snapshot-open-${snapshot.id}`}
```

### src/pages/Workspace.tsx

```text
38:   projectId?: string
42:   onOpenReport?: (projectId: string, snapshotId: string) => void
44:   onOpenSnapshots?: (projectId: string) => void
91:   onOpenReport?: (projectId: string, snapshotId: string) => void
92:   onOpenSnapshots?: (projectId: string) => void
135:   const [selectedTermId, setSelectedTermId] = useState<string | null>(null)
183:           id: term.id,
212:       setSelectedTermId(target.termId)
213:       scrollToReviewTarget(`[data-review-term="${target.termId}"]`)
217:       setSelectedTermId(target.termId)
220:         bindingId: target.bindingId,
221:         revisionId: target.revisionId,
225:       scrollToReviewTarget(`[data-review-term="${target.termId}"]`)
305:       `已创建分析快照 ${created.value.id.slice(0, 8)}…；审查状态：${
312:       onOpenReport(project.id, created.value.id)
315:     window.location.hash = `#/projects/${encodeURIComponent(project.id)}/reports/${encodeURIComponent(created.value.id)}`
332:       onOpenSnapshots(project.id)
335:     window.location.hash = `#/projects/${encodeURIComponent(project.id)}/snapshots`
538:             selectedTermId={selectedTermId}
539:             onSelect={setSelectedTermId}
549:             selectedTermId={selectedTermId}
550:             onSelect={setSelectedTermId}
579:         projectId={project.id}
581:         selectedTermId={selectedTermId}
714:   projectId,
720:   const bootstrap = useWorkspaceBootstrap(projectId)
738:     if (projectId !== undefined) {
739:       const loaded = await getProject(projectId)
754:     const sources = await loadProjectSources(project.id)
801:                 <span className="workspace__mono">{projectId}</span>
907:       key={bootstrap.project.id}
```

### src/parts/modelScene.ts

```text
238:   let rafId = 0
277:     if (disposed || !active || rafId !== 0) return
279:     rafId = window.requestAnimationFrame(tick)
283:     rafId = 0
330:   let downSample: { x: number; y: number; pointerId: number } | null = null
336:     downSample = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
341:     if (sample === null || sample.pointerId !== event.pointerId || disposed || !active) return
358:     if (rafId !== 0) {
359:       window.cancelAnimationFrame(rafId)
360:       rafId = 0
403:         if (rafId !== 0) {
404:           window.cancelAnimationFrame(rafId)
405:           rafId = 0
435:       if (rafId !== 0) {
436:         window.cancelAnimationFrame(rafId)
437:         rafId = 0
```

### src/parts/selection.ts

```text
5:  * 这里只处理「已算出的命中列表 → 注册 partId」以及与设备无关的指针几何，
9: import { isBuiltinPartId, normalizeSelectedPartId, type BuiltinPartId } from './shaftDemo'
19: /** 沿父链解析语义部件 ID；轮廓线、坐标轴等无 partId 的对象返回 null。 */
20: export function partIdFromObject(object: Object3D | null | undefined): BuiltinPartId | null {
23:     const candidate = node.userData?.partId
24:     if (isBuiltinPartId(candidate)) return candidate
36:  * 取最近的有效部件命中：过滤辅助对象（无 partId）、非有限距离；
39: export function nearestPartHit(hits: readonly IntersectionLike[]): { partId: BuiltinPartId; distance: number } | null {
40:   let best: { partId: BuiltinPartId; distance: number } | null = null
43:     const partId = partIdFromObject(hit.object)
44:     if (!partId) continue
45:     if (best === null || hit.distance < best.distance) best = { partId, distance: hit.distance }
101: export function resolveSelectionInput(value: unknown): BuiltinPartId | null {
102:   return normalizeSelectedPartId(value)
```

### src/parts/shaftDemo.ts

```text
14: /** 示例命名空间前缀：partId 是注册常量，不由下标/uuid/名称派生。 */
25: export type BuiltinPartId = (typeof BUILTIN_PART_IDS)[number]
53:   readonly id: BuiltinPartId
65: const parts: Record<BuiltinPartId, DemoPartDefinition> = {
116: export function isBuiltinPartId(value: unknown): value is BuiltinPartId {
121: export function normalizeSelectedPartId(value: unknown): BuiltinPartId | null {
122:   return isBuiltinPartId(value) ? value : null
125: export function demoPart(id: BuiltinPartId): DemoPartDefinition {
130: export function baseCenterX(id: BuiltinPartId): number {
143: export function explodeX(id: BuiltinPartId, t: number): number {
148: export function explodePosition(id: BuiltinPartId, t: number): { x: number; y: number; z: number } {
204: export function partPropertyRows(id: BuiltinPartId, explodeT = 0): [string, string][] {
```

### src/parts/shaftDemoGeometry.ts

```text
24:   type BuiltinPartId,
140:   geometry.name = def.id
145:   readonly id: BuiltinPartId
147:   /** 语义部件根：userData.partId 是唯一映射来源，位置由 baseTransform 表达。 */
163:  * 由当前隔套参数推导示意几何；只影响网格，不改 partId/装配顺序/
186:   /** D：只替换隔套网格；partId/材质/选中/爆炸/相机不变。 */
205:       baseDefinition.id === 'builtin:shaft-demo:spacer' && spacer !== undefined
215:     mesh.name = `${definition.id}:mesh`
217:     group.name = definition.id
218:     group.userData.partId = definition.id
219:     group.position.set(baseCenterX(definition.id), 0, 0)
222:     parts.push({ id: definition.id, definition, group, mesh, geometry, material })
231:         part.group.position.set(explodeX(part.id, t), 0, 0)
235:       const part = parts.find((item) => item.id === 'builtin:shaft-demo:spacer')
244:       const part = parts.find((item) => item.id === 'builtin:shaft-demo:spacer')
268: export function assemblyPart(assembly: DemoAssembly, id: BuiltinPartId): DemoPartObject {
269:   const part = assembly.parts.find((item) => item.id === id)
280:   if (!DEMO_PARTS.some((item) => item.id === id)) throw new RangeError(`未知部件 ${id}`)
281:   return demoPart(id as BuiltinPartId)
```

### src/parts/spacerParameters.ts

```text
85:     parameterId: SPACER_PARAMETER_IDS[key],
86:     partId: SPACER_PART_ID,
160:         parameterId: SPACER_PARAMETER_IDS[key],
161:         partId: SPACER_PART_ID,
175:   parameterId: string
176:   partId: string
201:     if (item.parameterId !== SPACER_PARAMETER_IDS[item.key]) {
204:     if (item.partId !== SPACER_PART_ID) {
205:       return { ok: false, message: `参数不属于隔套部件：${String(item.partId)}` }
232:         parameterId: item.parameterId,
233:         partId: item.partId,
```

### src/parts/stlLimits.ts

```text
34: /** 唯一 blob 总字节；调用方必须先按 blobKey 或 sha256 去重。 */
```

### src/parts/threeScene.ts

```text
7:  * - create → setExplodeT/setSelectedPartId/setActive/resetView/zoomBy → dispose；
40:   normalizeSelectedPartId,
42:   type BuiltinPartId,
71:   selectedPartId: BuiltinPartId | null
76:   onSelectPart(partId: BuiltinPartId | null): void
85:   setSelectedPartId(partId: BuiltinPartId | null): void
221:   let rafId = 0
226:   let selected: BuiltinPartId | null = normalizeSelectedPartId(options.selectedPartId)
267:     if (disposed || !active || rafId !== 0) return
269:     rafId = window.requestAnimationFrame(tick)
273:     rafId = 0
296:     assembly.parts.find((part) => part.id === selected)?.group.remove(outline)
303:   function applySelected(partId: BuiltinPartId | null): void {
305:       const isSelected = part.id === partId
312:     if (partId) {
313:       const part = assembly.parts.find((item) => item.id === partId)
317:         outline.name = `${partId}:outline`
348:   let downSample: { x: number; y: number; pointerId: number } | null = null
351:     activePointers.add(event.pointerId)
359:     downSample = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
363:     activePointers.delete(event.pointerId)
366:     if (!sample || sample.pointerId !== event.pointerId || disposed || !active) return
375:     options.onSelectPart(hit ? hit.partId : null)
380:     activePointers.delete(event.pointerId)
387:     if (rafId !== 0) {
388:       window.cancelAnimationFrame(rafId)
389:       rafId = 0
399:       if (rafId !== 0) {
400:         window.cancelAnimationFrame(rafId)
401:         rafId = 0
433:   applySelected(normalizeSelectedPartId(options.selectedPartId))
445:     setSelectedPartId(partId: BuiltinPartId | null) {
447:       const next = normalizeSelectedPartId(partId)
466:         if (rafId !== 0) {
467:           window.cancelAnimationFrame(rafId)
468:           rafId = 0
503:       if (rafId !== 0) {
504:         window.cancelAnimationFrame(rafId)
505:         rafId = 0
533: export function partDisplayName(id: BuiltinPartId): string {
```

### src/project-file/codec.ts

```text
13: import { sha256Hex } from '../sources/hash'
130:   const attachments = await validateAttachmentBytes(snapshot, sha256Hex)
150:     parts.set(revisionEntryPath(revision.revisionId), jsonBytes(revision))
172:     const parsed = parseRevisionFile(parsedParts[revisionEntryPath(revision.revisionId)])
204:     actualEntries.push({ path, byteSize: bytes.byteLength, sha256: await sha256Hex(bytes) })
214:     return { path: entry.path, role, byteSize: entry.byteSize, sha256: entry.sha256 }
224:       id: checked.project.id,
228:       currentRevisionId: checked.project.currentRevisionId,
440:     const revisionId = decodeSegment(path, REVISION_PATH_PREFIX, REVISION_EXTENSION)
441:     if (revisionId === null || revisionId.length === 0) {
450:     if (parsed.value.revisionId !== revisionId) {
454:         `${path} != ${parsed.value.revisionId}`,
510:       sha256: await sha256Hex(partBytes),
528:   const attachmentCheck = await validateAttachmentBytes(assembled.value, sha256Hex)
```

### src/project-file/migrateV2.ts

```text
25: import { sha256Hex } from '../sources/hash'
40: /** 退役作用域后缀；与 storage/projects.ts 的 retiredSourceScopeId 一致。 */
95:   newRevisionId?: () => string
97:   newBlobKey?: (revisionId: string) => string
111: function newId(prefix: string): string {
167: function retiredBase(projectId: string): string | null {
168:   const index = projectId.indexOf(RETIRED_MARKER)
169:   return index > 0 ? projectId.slice(0, index) : null
183:     ...result.contributions.map((item) => `${item.termId}:${item.toleranceQ}`),
223:   selectedProjectId: string,
225:   const knownProjects = new Set(parsed.projects.map((project) => project.id))
230:   const add = (kind: string, record: { projectId: string }): void => {
231:     const base = retiredBase(record.projectId)
235:     const isSelected = base === selectedProjectId
241:     records.push({ kind, projectId: record.projectId, record })
254:       projectId: blob.projectId,
255:       sha256: blob.sha256,
283:       sourceProjectId: selectedProjectId,
289:         selectedProjectId,
301:   inScopeRevisionIds: ReadonlySet<string>,
304:     inScopeRevisionIds.has(item.revisionId),
316:   const sourceSha256 = await sha256Hex(bytes)
326:     const revisions = backup.revisions.filter((item) => item.projectId === project.id)
327:     const revisionIds = new Set(revisions.map((item) => item.id))
328:     const archive = collectArchive(backup, project.id)
330:       id: project.id,
332:       attachmentCount: backup.blobs.filter((item) => item.projectId === project.id).length,
333:       missingItems: countMissingForScope(backup, revisionIds),
335:       bindingCount: backup.bindings.filter((item) => item.projectId === project.id).length,
336:       eventCount: backup.events.filter((item) => item.projectId === project.id).length,
337:       snapshotCount: backup.snapshots.filter((item) => item.projectId === project.id).length,
395:     sourceSha256: await sha256Hex(bytes),
400:         id: value.project.id,
420:     revisionId: project.currentRevisionId,
421:     parentId: null,
429:   projectId: string,
434:     id: `project_migrated_from_v2:${projectId}:${createdAt}`,
435:     projectId,
447:   projectId: string
459:   const project = backup.projects.find((item) => item.id === input.projectId)
461:     return fail('INVALID_RECORD', '所选项目不在该备份中', input.projectId)
465:   const documents = backup.documents.filter((item) => item.projectId === project.id)
466:   const revisions = backup.revisions.filter((item) => item.projectId === project.id)
467:   const blobs = backup.blobs.filter((item) => item.projectId === project.id)
468:   const bindings = backup.bindings.filter((item) => item.projectId === project.id)
469:   const events = backup.events.filter((item) => item.projectId === project.id)
470:   const snapshots = backup.snapshots.filter((item) => item.projectId === project.id)
472:     (item) => item.projectId === project.id,
475:     (item) => item.projectId === project.id,
477:   const storedDraft = backup.drafts.find((item) => item.projectId === project.id) as
498:   const revisionById = new Map(revisions.map((item) => [item.id, item]))
500:   const missingByRevision = new Map<string, { blobKey: string; documentId: string }>()
502:     if (!revisionById.has(missing.revisionId)) {
505:     const revision = revisionById.get(missing.revisionId)
509:     missingByRevision.set(missing.revisionId, {
511:       documentId: missing.documentId,
520:     const missing = missingByRevision.get(revision.id)
524:         `版本 ${revision.id} 既没有附件字节也没有缺失声明`,
529:       revisionId: revision.id,
530:       documentId: revision.documentId,
538:   const snapshotIds = new Set<string>()
540:     if (snapshotIds.has(snapshot.id)) {
541:       return fail('INVALID_RECORD', `分析快照 ID 重复：${snapshot.id}`)
543:     snapshotIds.add(snapshot.id)
544:     const revisionIds: string[] = []
547:       if (!revisionById.has(frozen.id)) {
550:           `历史快照 ${snapshot.id} 引用的来源版本不在所选项目闭包内`,
551:           frozen.id,
554:       revisionIds.push(frozen.id)
559:     snapshotReferences.push({ snapshotId: snapshot.id, revisionIds, blobKeys })
563:   const revisionId = options.newRevisionId?.() ?? newId('project-revision')
565:     id: project.id,
568:     currentRevisionId: revisionId,
587:     activeRequirementRevisionId: null,
591:     actorId: null,
597:   const archive = collectArchive(backup, project.id)
618:       projectId: project.id,
619:       sha256: blob.sha256,
628:     events: [...events, migrationEvent(project.id, createdAt, 'v2-bundle')],
646:         sourceSha256: await sha256Hex(input.bytes),
648:         sourceProjectId: project.id,
714:     ((revisionId: string) => newId(`legacy-json-${revisionId.slice(0, 12)}`))
718:     projectId: project.id,
719:     blobKey: newBlobKey(revision.id),
723:     projectId: project.id,
727:     projectId: project.id,
733:     revisionId: revision.id,
734:     documentId: revision.documentId,
740:   const revisionId = options.newRevisionId?.() ?? newId('project-revision')
742:     id: project.id,
745:     currentRevisionId: revisionId,
763:     activeRequirementRevisionId: null,
767:     actorId: null,
788:     events: [migrationEvent(project.id, createdAt, 'v2-json')],
806:         sourceSha256: await sha256Hex(bytes),
808:         sourceProjectId: project.id,
```

### src/project-file/types.ts

```text
30:  * - 10：无任务书入口的加法字段：`sourceKind`（pdf | user-intent）、`actorId`/
110:   sha256: string
125:   currentRevisionId: string
147:   /** PDF 为 SourceRevision.id，模型为 ModelRevision.modelRevisionId。 */
148:   revisionId: string
151:   sha256: string
158:   revisionId: string
159:   documentId: string
165:   snapshotId: string
166:   revisionIds: string[]
174:   sourceProjectId: string
213: /** project.json `parts[]`：稳定 partId，项目内唯一。 */
215:   partId: string
219:   currentModelRevisionId: string | null
230:   modelRevisionId: string
231:   partId: string
234:   parentModelRevisionId: string | null
251:  * 它不是参数关联：没有 parameterId，不同步 nominal/偏差/方向，也不改变计算结果。
255:   partId: string
257:   modelRevisionId: string | null
262:   linkId: string
263:   termId: string
266:   reviewedModelRevisionId: string | null
275:  * - 它不是 B2 的 visual-reference：B2 只表示外形资料来源，没有 parameterId；
281:   bindingId: string
282:   termId: string
283:   partId: string
284:   parameterId: string
317:   parameterId: string
318:   partId: string
334:  * 图元由参数 + 模板确定性重建；dataFingerprint 用于重建后校验一致。
338:   drawingId: string
340:   templateId: 'spacer-a4-landscape'
342:   partId: string
344:   revisionId: string
345:   parameterIds: string[]
371:   dataFingerprint: string
398:   currentRevisionId: string
413:   /** 确认后的不可变条款版本（可累积多个版本；只有一个活动 requirementId）。 */
416:   activeRequirementRevisionId: string | null
441:   actorId: string | null
457:  * `sourceKind`/`actorId`/`sessionSeq`/`sessionLabel`/`attestations`（读出时补）。
464:   | 'actorId'
500:   | 'activeRequirementRevisionId'
517:   | 'activeRequirementRevisionId'
536:   | 'activeRequirementRevisionId'
557:   | 'activeRequirementRevisionId'
571:  * - analysisSnapshotId 指向同次提交冻结的 AnalysisSnapshot；
572:  * - eventIds 指向同次提交的变更事件；
574:  * - restoredFromRevisionId 仅在“恢复旧版生成新版本”时出现。
579:   analysisSnapshotId: string | null
580:   eventIds: string[]
582:     documents: { documentId: string; latestRevisionId: string }[]
583:     revisions: { revisionId: string; documentId: string; sha256: string }[]
584:     bindings: { bindingId: string; revisionId: string; reviewedTermRevision: number | null }[]
587:   restoredFromRevisionId: string | null
589:   requirementRevisionId?: string | null
590:   checkId?: string | null
595:   revisionId: string
596:   parentId: string | null
619:   projectId: string
620:   sha256: string
638:   projectId: string
646:   projectId: string
658:   sourceProjectId: string | null
```

### src/project-file/upgrade.ts

```text
19:   newRevisionId?: () => string
31:     (revision) => revision.revisionId === snapshot.project.currentRevisionId,
43:   const revisionId =
44:     options.newRevisionId?.() ?? `rev-${Math.random().toString(36).slice(2, 10)}-upgrade`
49:     currentRevisionId: revisionId,
59:           revisionId,
61:           parentId: snapshot.project.currentRevisionId,
```

### src/project-file/validation.ts

```text
104: export function revisionEntryPath(revisionId: string): string {
105:   return `${REVISION_PATH_PREFIX}${encodeURIComponent(revisionId)}${REVISION_EXTENSION}`
127: const sha256Schema = z.string().regex(SHA256_PATTERN)
137:     partId: idSchema,
140:     currentModelRevisionId: idSchema.nullable(),
147:     modelRevisionId: idSchema,
148:     partId: idSchema,
150:     parentModelRevisionId: idSchema.nullable(),
155:     attachmentSha256: sha256Schema,
174:     linkId: idSchema,
175:     termId: idSchema,
179:         partId: idSchema,
180:         modelRevisionId: idSchema.nullable(),
184:     reviewedModelRevisionId: idSchema.nullable(),
192:       (link.reviewedModelRevisionId !== null && link.reviewedAt !== null),
200:     bindingId: idSchema,
201:     termId: idSchema,
202:     partId: idSchema,
203:     parameterId: idSchema,
212:   currentRevisionId: idSchema,
263:     parameterId: idSchema,
264:     partId: idSchema,
298:     drawingId: idSchema,
300:     templateId: z.literal('spacer-a4-landscape'),
302:     partId: idSchema,
303:     revisionId: idSchema,
304:     parameterIds: z.array(idSchema).length(3),
332:     dataFingerprint: sha256Schema,
339:     projectId: idSchema,
347:     documentId: idSchema,
348:     revisionId: idSchema,
349:     sha256: sha256Schema,
362:           parameterId: idSchema,
372:           termId: idSchema,
381:           bindingId: idSchema,
382:           termId: idSchema,
383:           parameterId: idSchema,
393:     requirementId: idSchema,
394:     revisionId: idSchema,
395:     parentRevisionId: idSchema.nullable(),
396:     projectId: idSchema,
401:     confirmedAgainstLatestRevisionId: idSchema,
419:       baseRevisionId: idSchema,
420:       draftId: idSchema,
427:       projectRevisionId: idSchema,
428:       parentRevisionId: idSchema.nullable(),
434:   requirementId: idSchema,
435:   requirementRevisionId: idSchema,
439:   analysisSnapshotId: idSchema.nullable(),
440:   projectRevisionId: idSchema.nullable(),
441:   drawingFingerprint: z.string().min(1).nullable(),
447:   checkId: idSchema,
448:   projectId: idSchema,
449:   requirementRevisionId: idSchema.nullable(),
454:   inputFingerprint: z.string().min(1),
481:     (check) => (check.requirementRevisionId === null ? check.evidenceRef === null : true),
488:   documentId: idSchema,
489:   revisionId: idSchema,
490:   sha256: sha256Schema,
529:     imageId: idSchema,
530:     sha256: sha256Schema,
539:  * ADR-001：用户断言出处。按 §11 用 actorId + sessionSeq + sessionLabel（不用 UUID）。
545:     actorId: z.string().min(1).max(200),
551:     turnId: z.string().min(1).max(240).nullable().optional(),
596:     (check) => (check.requirementRevisionId === null ? check.evidenceRef === null : true),
614:     kind: z.literal('agent-read'), actorId: z.string().min(1).max(200),
616:     turnId: z.string().min(1).max(240), modelId: z.string().min(1).max(240).nullable(),
619:       z.object({ kind: z.literal('pdf-page'), revisionId: idSchema, sha256: sha256Schema, page: z.number().int().min(1) }).strict(),
620:       z.object({ kind: z.literal('image'), imageId: idSchema, sha256: sha256Schema }).strict(),
695:   candidateId: idSchema,
696:   groupId: idSchema.nullable(),
755:     decisionId: idSchema,
756:     candidateId: idSchema,
770:     batchId: z.string().min(1).max(200).nullable().optional(),
777:     issueId: idSchema,
782:     candidateIds: z.array(idSchema).max(64),
803:     documentId: idSchema,
804:     revisionId: idSchema,
805:     sha256: sha256Schema,
813:     draftId: idSchema,
816:     projectId: idSchema,
895:     activeRequirementRevisionId: idSchema.nullable(),
929:     actorId: z.string().min(1).max(200).nullable(),
939:     if (value.actorId === null || value.sessionSeq < 1) {
942:         path: ['actorId'],
948:       if (attestation.actorId !== value.actorId) {
951:           path: ['attestations', index, 'actorId'],
979:     projectId: idSchema,
981:     latestRevisionId: idSchema,
988:     projectId: idSchema,
989:     documentId: idSchema,
991:     sha256: sha256Schema,
1002:     projectId: idSchema,
1003:     termId: idSchema,
1004:     revisionId: idSchema,
1005:     documentId: idSchema,
1018:         latestRevisionId: idSchema,
1027:     projectId: idSchema,
1028:     sha256: sha256Schema,
1036:     projectId: idSchema,
1045:     projectId: idSchema,
1058:     projectId: idSchema,
1068:     projectId: idSchema,
1077:     revisionId: idSchema,
1078:     parentId: idSchema.nullable(),
1084:         analysisSnapshotId: idSchema.nullable(),
1085:         eventIds: z.array(idSchema),
1089:               z.object({ documentId: idSchema, latestRevisionId: idSchema }).strict(),
1094:                   revisionId: idSchema,
1095:                   documentId: idSchema,
1096:                   sha256: sha256Schema,
1103:                   bindingId: idSchema,
1104:                   revisionId: idSchema,
1112:         restoredFromRevisionId: idSchema.nullable(),
1113:         requirementRevisionId: idSchema.nullable().optional(),
1114:         checkId: idSchema.nullable().optional(),
1123:     sourceProjectId: idSchema.nullable(),
1133:     revisionId: idSchema,
1136:     sha256: sha256Schema,
1143:     revisionId: idSchema,
1144:     documentId: idSchema,
1152:     snapshotId: idSchema,
1153:     revisionIds: z.array(idSchema),
1178:     sourceSha256: sha256Schema,
1180:     sourceProjectId: idSchema,
1200:     sha256: sha256Schema,
1236:     currentRevisionId: idSchema,
1255:     currentRevisionId: idSchema,
1484:   actorId: null,
1490:   'sourceKind' | 'actorId' | 'sessionSeq' | 'sessionLabel' | 'attestations'
1509:     activeRequirementRevisionId: null,
1524:     activeRequirementRevisionId: null,
1544:     activeRequirementRevisionId: null,
1560:     activeRequirementRevisionId: null,
1763:         revisionId: revision.id,
1766:         sha256: blob.sha256,
1773:         revisionId: revision.modelRevisionId,
1776:         sha256: blob.sha256,
1782:       // 仍保留旧行为给出空 revisionId，由引用校验拒绝。
1785:         revisionId: '',
1788:         sha256: blob.sha256,
1796:     return left.revisionId < right.revisionId ? -1 : left.revisionId > right.revisionId ? 1 : 0
1820:     entries.push({ path: revisionEntryPath(revision.revisionId), role: 'revision' })
1830: function linkKindId(link: { kind: string; linkId?: string; bindingId?: string }): string {
1831:   return link.kind === 'parameter-binding' ? (link.bindingId ?? '') : (link.linkId ?? '')
1834: /** linkId 与 bindingId 是两个命名空间，各自查重。 */
1835: function duplicateLinkIds(
1836:   links: readonly { kind: string; linkId?: string; bindingId?: string }[],
1842:       const id = linkKindId(link)
1850: function duplicateIds<T>(records: readonly T[], key: keyof T & string): string | null {
1961:  * - 草稿的 PDF 版本身份必须指向本项目里确切存在的 revision，且 sha256/blobKey 一致；
1970:   const projectId = snapshot.project.id
1971:   const revisionById = new Map(snapshot.revisions.map((item) => [item.id, item]))
1972:   const documentIds = new Set(snapshot.documents.map((item) => item.id))
1973:   const draftIds = new Set<string>()
1980:     const revision = revisionById.get(evidence.revisionId)
1982:     if (revision.documentId !== evidence.documentId) return false
1983:     if (revision.sha256 !== evidence.sha256) return false
1986:       evidence.revisionId !== draft.sourceIdentity.revisionId ||
1987:       evidence.sha256 !== draft.sourceIdentity.sha256
1996:    * - pdf-text / pdf-ocr：revisionId + sha256 + blobKey 全等（行为与改前一致）；
2010:       const revision = revisionById.get(source.revisionId)
2011:       return revision !== undefined && revision.sha256 === source.sha256 && source.page <= revision.pageCount
2019:     if (draft.projectId !== projectId) {
2020:       return fail('MISSING_REFERENCE', `提取草稿 ${draft.draftId} 不属于当前项目`)
2022:     if (draftIds.has(draft.draftId)) {
2023:       return fail('INVALID_RECORD', `提取草稿 ID 重复：${draft.draftId}`)
2025:     draftIds.add(draft.draftId)
2034:       const revision = revisionById.get(source.revisionId)
2035:       if (revision === undefined || !documentIds.has(source.documentId)) {
2038:           `提取草稿 ${draft.draftId} 引用的 PDF 版本不存在`,
2039:           source.revisionId,
2042:       if (revision.documentId !== source.documentId) {
2043:         return fail('MISSING_REFERENCE', `提取草稿 ${draft.draftId} 的文档与版本不一致`)
2045:       if (revision.sha256 !== source.sha256 || revision.blobKey !== source.blobKey) {
2046:         return fail('HASH_MISMATCH', `提取草稿 ${draft.draftId} 的版本哈希/blobKey 与来源不一致`)
2049:         return fail('INVALID_RECORD', `提取草稿 ${draft.draftId} 的页数与来源版本不一致`)
2054:           `提取草稿 ${draft.draftId} 的页范围越界`,
2060:     const candidateById = new Map<string, ExtractionCandidate>()
2061:     const decisionIds = new Set<string>()
2063:       if (candidateById.has(candidate.candidateId)) {
2064:         return fail('INVALID_RECORD', `提取候选 ID 重复：${candidate.candidateId}`)
2066:       candidateById.set(candidate.candidateId, candidate)
2071:           `提取候选 ${candidate.candidateId} 的页码不在提取页范围内`,
2078:             `提取候选 ${candidate.candidateId} 的出处与草稿来源不一致`,
2079:             evidence.revisionId,
2088:             `提取候选 ${candidate.candidateId} 的 ${field} 缺少出处`,
2095:               `提取候选 ${candidate.candidateId} 的 ${field} 出处不完整`,
2101:               `提取候选 ${candidate.candidateId} 的 ${field} 出处指向其它版本`,
2110:       if (decisionIds.has(decision.decisionId)) {
2111:         return fail('INVALID_RECORD', `提取决定 ID 重复：${decision.decisionId}`)
2113:       decisionIds.add(decision.decisionId)
2114:       const candidate = candidateById.get(decision.candidateId)
2118:           `提取决定 ${decision.decisionId} 引用了不存在的候选`,
2119:           decision.candidateId,
2125:           `提取决定 ${decision.decisionId} 的代数为未来代数`,
2129:         const list = activeDecisions.get(decision.candidateId) ?? []
2131:         activeDecisions.set(decision.candidateId, list)
2136:       const decisions = (activeDecisions.get(candidate.candidateId) ?? []).filter(
2145:             `候选 ${candidate.candidateId} 标记为已确认，但没有当前代数的确认决定`,
2151:             `候选 ${candidate.candidateId} 的数值与确认时的快照不一致`,
2158:           `候选 ${candidate.candidateId} 标记为已拒绝，但没有当前代数的拒绝决定`,
2164:           `候选 ${candidate.candidateId} 存在确认决定，但状态不是已确认`,
2176:   const projectId = snapshot.project.id
2178:   const allScoped: { label: string; records: readonly { projectId: string }[] }[] = [
2190:       if (record.projectId !== projectId) {
2194:           `projectId=${record.projectId}，当前项目=${projectId}`,
2201:     duplicateIds(snapshot.documents, 'id') ??
2202:     duplicateIds(snapshot.revisions, 'id') ??
2203:     duplicateIds(snapshot.bindings, 'id') ??
2204:     duplicateIds(snapshot.events, 'id') ??
2205:     duplicateIds(snapshot.analysisSnapshots, 'id') ??
2206:     duplicateIds(snapshot.importSnapshots, 'id') ??
2207:     duplicateIds(snapshot.migrationBackups, 'id') ??
2208:     duplicateIds(snapshot.fileRevisions, 'revisionId')
2213:   const blobKeyDuplicate = duplicateIds(snapshot.blobs, 'blobKey')
2218:   const partDuplicate = duplicateIds(snapshot.project.parts, 'partId')
2220:     return fail('INVALID_RECORD', `partId 重复：${partDuplicate}`)
2222:   const modelDuplicate = duplicateIds(snapshot.project.modelRevisions, 'modelRevisionId')
2224:     return fail('INVALID_RECORD', `modelRevisionId 重复：${modelDuplicate}`)
2226:   const linkDuplicate = duplicateLinkIds(snapshot.project.dimensionLinks)
2231:   const sourceRevisionIds = new Set(snapshot.revisions.map((item) => item.id))
2233:     if (sourceRevisionIds.has(model.modelRevisionId)) {
2237:         model.modelRevisionId,
2242:   const documentById = new Map(snapshot.documents.map((item) => [item.id, item]))
2243:   const revisionById = new Map(snapshot.revisions.map((item) => [item.id, item]))
2246:     snapshot.missingAttachments.map((item) => [item.revisionId, item]),
2248:   const termIds = new Set(snapshot.project.dimensionChain.terms.map((term) => term.id))
2251:     const latest = revisionById.get(document.latestRevisionId)
2255:         `文档 ${document.id} 的 latestRevisionId 无对应版本`,
2256:         document.latestRevisionId,
2259:     if (latest.documentId !== document.id) {
2262:         `文档 ${document.id} 的最新版本属于其它文档`,
2263:         latest.documentId,
2269:     const document = documentById.get(revision.documentId)
2271:       return fail('MISSING_REFERENCE', `版本 ${revision.id} 引用了不存在的文档`, revision.documentId)
2276:       if (missingByRevision.has(revision.id)) {
2279:       return fail('MISSING_REFERENCE', `版本 ${revision.id} 缺少 blob 元数据`, revision.blobKey)
2281:     if (missingByRevision.has(revision.id)) {
2282:       return fail('INVALID_RECORD', `版本 ${revision.id} 既声明缺失又存在 blob 元数据`)
2284:     if (blob.sha256 !== revision.sha256 || blob.byteSize !== revision.byteSize) {
2287:         `版本 ${revision.id} 与 blob 元数据的大小/哈希不一致`,
2297:   const partById = new Map(snapshot.project.parts.map((item) => [item.partId, item]))
2298:   const modelById = new Map(
2299:     snapshot.project.modelRevisions.map((item) => [item.modelRevisionId, item]),
2302:     if (part.currentModelRevisionId === null) continue
2303:     const current = modelById.get(part.currentModelRevisionId)
2307:         `部件 ${part.partId} 的当前模型版本不存在`,
2308:         part.currentModelRevisionId,
2311:     if (current.partId !== part.partId) {
2314:         `部件 ${part.partId} 的当前模型版本属于其它部件`,
2315:         current.partId,
2320:     if (!partById.has(model.partId)) {
2321:       return fail('MISSING_REFERENCE', `模型版本 ${model.modelRevisionId} 引用了不存在的部件`, model.partId)
2323:     if (model.parentModelRevisionId !== null) {
2324:       const parent = modelById.get(model.parentModelRevisionId)
2328:           `模型版本 ${model.modelRevisionId} 的父版本不存在`,
2329:           model.parentModelRevisionId,
2332:       if (parent.partId !== model.partId) {
2335:           `模型版本 ${model.modelRevisionId} 的父版本属于其它部件`,
2336:           parent.partId,
2342:       return fail('MISSING_REFERENCE', `模型版本 ${model.modelRevisionId} 缺少 blob 元数据`, model.blobKey)
2344:     if (blob.sha256 !== model.attachmentSha256 || blob.byteSize !== model.byteSize) {
2347:         `模型版本 ${model.modelRevisionId} 与 blob 元数据的大小/哈希不一致`,
2353:         `模型版本 ${model.modelRevisionId} 的字节缺失（模型版本不允许缺附件声明）`,
2360:     const visited = new Set<string>([model.modelRevisionId])
2361:     let cursor = model.parentModelRevisionId
2364:         return fail('INVALID_RECORD', `模型版本父链存在环：${model.modelRevisionId}`)
2367:       cursor = modelById.get(cursor)?.parentModelRevisionId ?? null
2389:     if (!termIds.has(link.termId)) {
2390:       return fail('MISSING_REFERENCE', `关联 ${linkKindId(link)} 引用了不存在的组成环`, link.termId)
2393:       if (!partById.has(link.target.partId)) {
2394:         return fail('MISSING_REFERENCE', `关联 ${link.linkId} 引用了不存在的部件`, link.target.partId)
2396:       if (link.target.granularity === 'model' && link.target.modelRevisionId === null) {
2397:         return fail('INVALID_RECORD', `关联 ${link.linkId} 使用模型粒度但没有具体版本`)
2399:       for (const [label, revisionId] of [
2400:         ['目标版本', link.target.modelRevisionId],
2401:         ['确认版本', link.reviewedModelRevisionId],
2403:         if (revisionId === null) continue
2404:         const model = modelById.get(revisionId)
2406:           return fail('MISSING_REFERENCE', `关联 ${link.linkId} 的${label}不存在`, revisionId)
2408:         if (model.partId !== link.target.partId) {
2411:             `关联 ${link.linkId} 的${label}属于其它部件`,
2412:             `${model.partId} != ${link.target.partId}`,
2418:     // D：参数绑定——一参一环，引用必须指向现存参数且 partId 一致。
2419:     if (bindingTerms.has(link.termId)) {
2422:         `组成环 ${link.termId} 存在第二个参数绑定`,
2423:         link.bindingId,
2426:     bindingTerms.add(link.termId)
2427:     if (link.partId !== SPACER_PART_ID && !partById.has(link.partId)) {
2428:       return fail('MISSING_REFERENCE', `参数绑定 ${link.bindingId} 引用了不存在的部件`, link.partId)
2431:       (item) => item.parameterId === link.parameterId,
2436:         `参数绑定 ${link.bindingId} 引用了不存在的参数`,
2437:         link.parameterId,
2440:     if (parameter.partId !== link.partId) {
2443:         `参数绑定 ${link.bindingId} 的部件与参数不一致`,
2444:         `${link.partId} != ${parameter.partId}`,
2447:     if (parameter.partId !== SPACER_PART_ID) {
2448:       return fail('MISSING_REFERENCE', `参数绑定 ${link.bindingId} 指向不支持的部件`)
2453:   const fileRevisionIds = new Set(snapshot.fileRevisions.map((item) => item.revisionId))
2454:   const requirementRevisionIds = new Set<string>()
2455:   const requirementIds = new Set<string>()
2457:     if (requirementRevisionIds.has(requirement.revisionId)) {
2458:       return fail('INVALID_RECORD', `条款版本 ID 重复：${requirement.revisionId}`)
2460:     requirementRevisionIds.add(requirement.revisionId)
2461:     if (requirementIds.has(requirement.requirementId) === false) {
2462:       requirementIds.add(requirement.requirementId)
2464:     if (requirement.projectId !== projectId) {
2467:         `条款 ${requirement.revisionId} 不属于当前项目`,
2468:         requirement.projectId,
2473:       requirement.chainRef.projectId !== projectId
2475:       return fail('MISSING_REFERENCE', `条款 ${requirement.revisionId} 的链引用不合法`)
2478:       return fail('INVALID_RECORD', `条款 ${requirement.revisionId} 的上下限必须是整数 q`)
2481:       return fail('INVALID_RECORD', `条款 ${requirement.revisionId} 的下限大于上限`)
2483:     if (requirement.parentRevisionId !== null) {
2485:         (item) => item.revisionId === requirement.parentRevisionId,
2490:           `条款 ${requirement.revisionId} 的父版本不存在`,
2491:           requirement.parentRevisionId,
2494:       if (parent.requirementId !== requirement.requirementId) {
2497:           `条款 ${requirement.revisionId} 的父版本属于其它条款`,
2506:           `条款 ${requirement.revisionId} 的用户断言出处不完整`,
2510:       const sourceDocument = documentById.get(requirement.source.documentId)
2511:       const sourceRevision = revisionById.get(requirement.source.revisionId)
2515:           `条款 ${requirement.revisionId} 引用的任务书版本不存在`,
2518:       if (sourceRevision.documentId !== sourceDocument.id) {
2521:           `条款 ${requirement.revisionId} 的文档与版本不一致`,
2524:       if (sourceRevision.sha256 !== requirement.source.sha256) {
2527:           `条款 ${requirement.revisionId} 的 PDF 哈希与来源版本不一致`,
2533:           `条款 ${requirement.revisionId} 的页码越界`,
2544:           `条款 ${requirement.revisionId} 的选区不合法`,
2550:   // Beta 只允许一个活动 requirementId，且活动版本必须存在。
2551:   if (requirementIds.size > 1) {
2555:       [...requirementIds].join('；'),
2558:   const activeRequirementRevisionId = snapshot.project.activeRequirementRevisionId
2559:   if (activeRequirementRevisionId !== null && !requirementRevisionIds.has(activeRequirementRevisionId)) {
2563:       activeRequirementRevisionId,
2568:     if (currentCheck.projectId !== projectId) {
2573:       currentCheck.chainRef.projectId !== projectId
2578:       currentCheck.requirementRevisionId !== null &&
2579:       !requirementRevisionIds.has(currentCheck.requirementRevisionId)
2584:         currentCheck.requirementRevisionId,
2587:     if (currentCheck.requirementRevisionId === null && currentCheck.status !== 'unchecked') {
2591:       const basisRevision = fileRevisionIds.has(currentCheck.basis.projectRevisionId)
2596:           currentCheck.basis.projectRevisionId,
2613:   const parameterIds = new Set<string>()
2616:     if (parameterIds.has(parameter.parameterId)) {
2617:       return fail('INVALID_RECORD', `隔套参数 ID 重复：${parameter.parameterId}`)
2622:     parameterIds.add(parameter.parameterId)
2627:         `隔套参数修订号必须是 ≥1 的整数：${parameter.parameterId}`,
2630:     if (parameter.partId !== SPACER_PART_ID) {
2631:       return fail('MISSING_REFERENCE', `隔套参数引用了不支持的部件：${parameter.partId}`)
2641:   const drawingIds = new Set<string>()
2643:     if (drawingIds.has(drawing.drawingId)) {
2644:       return fail('INVALID_RECORD', `图纸 ID 重复：${drawing.drawingId}`)
2646:     drawingIds.add(drawing.drawingId)
2647:     if (drawing.partId !== SPACER_PART_ID) {
2648:       return fail('MISSING_REFERENCE', `图纸引用了不支持的部件：${drawing.partId}`)
2650:     if (!fileRevisionIds.has(drawing.revisionId)) {
2651:       return fail('MISSING_REFERENCE', `图纸 ${drawing.drawingId} 的生成基准版本不存在`, drawing.revisionId)
2654:       return fail('MISSING_REFERENCE', `图纸 ${drawing.drawingId} 缺少隔套参数`)
2656:     const referenced = new Set(drawing.parameterIds)
2657:     if (referenced.size !== drawing.parameterIds.length) {
2658:       return fail('INVALID_RECORD', `图纸 ${drawing.drawingId} 的参数引用重复`)
2661:       if (!referenced.has(parameter.parameterId)) {
2664:           `图纸 ${drawing.drawingId} 缺少参数引用`,
2665:           parameter.parameterId,
2670:       return fail('MISSING_REFERENCE', `图纸 ${drawing.drawingId} 引用了多余的参数`)
2676:         projectId: snapshot.project.id,
2677:         revisionId: drawing.revisionId,
2678:         drawingId: drawing.drawingId,
2687:           `图纸 ${drawing.drawingId} 无法按保存的参数重建：${error.message}`,
2693:     if (rebuilt.fingerprint !== drawing.dataFingerprint) {
2696:         `图纸 ${drawing.drawingId} 的重建指纹与保存的 dataFingerprint 不一致`,
2697:         `saved=${drawing.dataFingerprint}, rebuilt=${rebuilt.fingerprint}`,
2703:     const revision = revisionById.get(missing.revisionId)
2705:       return fail('MISSING_REFERENCE', '缺附件声明引用了不存在的版本', missing.revisionId)
2707:     if (revision.blobKey !== missing.blobKey || revision.documentId !== missing.documentId) {
2708:       return fail('MISSING_REFERENCE', '缺附件声明与版本元数据不一致', missing.revisionId)
2719:     if (!attachmentByKey.has(revision.blobKey) && !missingByRevision.has(revision.id)) {
2722:         `版本 ${revision.id} 既没有附件字节也没有缺附件声明`,
2735:     const revision = revisionById.get(binding.revisionId)
2737:       return fail('MISSING_REFERENCE', `绑定 ${binding.id} 引用了不存在的版本`, binding.revisionId)
2739:     if (revision.documentId !== binding.documentId) {
2740:       return fail('MISSING_REFERENCE', `绑定 ${binding.id} 的文档与版本不一致`)
2745:         `绑定 ${binding.id} 的页码越界`,
2749:     if (!termIds.has(binding.termId)) {
2752:         `绑定 ${binding.id} 引用了当前方案中不存在的组成环`,
2753:         binding.termId,
2758:       return fail('INVALID_RECORD', `绑定 ${binding.id} 的区域不合法`, regionError)
2761:       if (!revisionById.has(binding.historicalAcceptance.latestRevisionId)) {
2764:           `绑定 ${binding.id} 的历史接受凭据引用了不存在的版本`,
2770:   const snapshotById = new Map(
2771:     snapshot.analysisSnapshots.map((item) => [item.id, item]),
2774:     if (!snapshotById.has(reference.snapshotId)) {
2778:         reference.snapshotId,
2781:     for (const revisionId of reference.revisionIds) {
2782:       if (!revisionById.has(revisionId)) {
2783:         return fail('MISSING_REFERENCE', '快照引用包含不存在的版本', revisionId)
2793:   const revisionFileById = new Map(
2794:     snapshot.fileRevisions.map((item) => [item.revisionId, item]),
2796:   if (!revisionFileById.has(snapshot.project.currentRevisionId)) {
2799:       '项目 currentRevisionId 在文件版本中不存在',
2800:       snapshot.project.currentRevisionId,
2804:     if (revision.project.id !== projectId) {
2805:       return fail('INVALID_RECORD', `文件版本 ${revision.revisionId} 属于其它项目`)
2807:     if (revision.parentId !== null && !revisionFileById.has(revision.parentId)) {
2810:         `文件版本 ${revision.revisionId} 的父版本不存在`,
2811:         revision.parentId,
2817:     const visited = new Set<string>([revision.revisionId])
2818:     let cursor = revision.parentId
2821:         return fail('INVALID_RECORD', `文件版本父链存在环：${revision.revisionId}`)
2824:       cursor = revisionFileById.get(cursor)?.parentId ?? null
2829:   const eventById = new Map(snapshot.events.map((event) => [event.id, event]))
2834:       evidence.analysisSnapshotId !== null &&
2835:       !snapshotById.has(evidence.analysisSnapshotId)
2839:         `版本 ${revision.revisionId} 的证据引用了不存在的分析快照`,
2840:         evidence.analysisSnapshotId,
2843:     for (const eventId of evidence.eventIds) {
2844:       if (!eventById.has(eventId)) {
2847:           `版本 ${revision.revisionId} 的证据引用了不存在的事件`,
2848:           eventId,
2853:       if (!revisionById.has(item.revisionId)) {
2856:           `版本 ${revision.revisionId} 的来源清单引用了不存在的来源版本`,
2857:           item.revisionId,
2862:       evidence.restoredFromRevisionId !== null &&
2863:       !revisionFileById.has(evidence.restoredFromRevisionId)
2867:         `版本 ${revision.revisionId} 的恢复来源不存在`,
2868:         evidence.restoredFromRevisionId,
2883:   sha256: string
2986:     if (actualEntry.sha256 !== entry.sha256) {
3016:   if (manifest.project.id !== snapshot.project.id) {
3017:     return fail('INVALID_MANIFEST', 'manifest.project.id 与 project.json 不一致')
3022:   if (manifest.project.currentRevisionId !== snapshot.project.currentRevisionId) {
3023:     return fail('INVALID_MANIFEST', 'manifest.currentRevisionId 与 project.json 不一致')
3051:     `${item.revisionId}|${item.documentId}|${item.blobKey}|${item.reason}`
3092:     if (digest !== blob.sha256) {
```

### src/requirements/check.ts

```text
37:   computeRequirementInputFingerprint,
72:   activeRequirementRevisionId: string | null
76:   baseRevisionId?: string
80:   checkId: string
129:     requirementRevisionId: check.requirementRevisionId,
169:   const byTerm = new Map(current.map((link) => [link.termId, link]))
171:     requirement.bindingBasis.bindings.map((item) => [item.termId, item]),
178:   for (const [termId, basis] of basisByTerm) {
179:     const now = byTerm.get(termId)
184:     if (now.bindingId !== basis.bindingId || now.parameterId !== basis.parameterId) {
188:   for (const [termId] of byTerm) {
189:     if (!basisByTerm.has(termId)) push('BINDING_ADDED')
194:   const confirmedIds = new Set(
195:     statusRows.filter((row) => row.state !== 'pending').map((row) => row.bindingId),
197:   for (const [termId, basis] of basisByTerm) {
198:     const now = byTerm.get(termId)
200:     if (now.bindingId === basis.bindingId && !confirmedIds.has(now.bindingId)) {
204:           event.bindingId === now.bindingId &&
205:           event.parameterId === now.parameterId,
223:       revisions: snapshot.revisions.map((item) => ({ revisionId: item.id, sha256: item.sha256 })),
230:     (item) => item.id === source.documentId,
233:     (item) => item.id === source.revisionId,
239:   if (document.latestRevisionId !== requirement.confirmedAgainstLatestRevisionId) {
248:   } else if (blob.sha256 !== source.sha256) {
333:   const chainRef = { projectId: snapshot.project.id, kind: 'project-dimension-chain' as const }
334:   const baseRevisionId = input.baseRevisionId ?? snapshot.project.currentRevisionId
340:           projectRevisionId: baseRevisionId,
341:           parentRevisionId: null,
345:           baseRevisionId,
346:           draftId: input.draft.draftId,
352:   if (input.activeRequirementRevisionId !== null) {
355:         (item) => item.revisionId === input.activeRequirementRevisionId,
363:           detail: input.activeRequirementRevisionId,
382:           { revisionId: baseRevisionId, now: input.checkedAt },
416:   const fingerprint = await computeRequirementInputFingerprint(
421:       baseRevisionId,
493:     checkId: input.checkId,
494:     projectId: snapshot.project.id,
495:     requirementRevisionId: requirement?.revisionId ?? null,
500:     inputFingerprint: fingerprint,
510:             requirementId: requirement.requirementId,
511:             requirementRevisionId: requirement.revisionId,
515:             analysisSnapshotId: null,
516:             projectRevisionId:
517:               basis.kind === 'project-revision' ? basis.projectRevisionId : null,
518:             drawingFingerprint: null,
538:     parameterId: parameter.parameterId,
543:   const terms: { termId: string; nominalQ: number; termRevision: number }[] = snapshot.project.dimensionChain.terms.map(
545:       termId: term.id,
551:     bindingId: link.bindingId,
552:     termId: link.termId,
553:     parameterId: link.parameterId,
```

### src/requirements/commit.ts

```text
41:     draftId: string
47:   activeRequirementRevisionId: string | null
56:   baseRevisionId: string
60:   checkId: string
61:   revisionId: string
62:   analysisSnapshotId: string
64:   restoredFromRevisionId: string | null
80: /** 参数/环/结果的稳定比较键；不比较 revisionId 等每次调用都会变的身份。 */
85:         parameterId: parameter.parameterId,
90:       .sort((left, right) => (left.parameterId < right.parameterId ? -1 : 1)),
93:         id: term.id,
99:       .sort((left, right) => (left.id < right.id ? -1 : 1)),
120:       { revisionId: input.revisionId, now: input.checkedAt },
167:     activeRequirementRevisionId: input.activeRequirementRevisionId,
170:     baseRevisionId: input.baseRevisionId,
174:     checkId: input.checkId,
178:       baseRevisionId: input.baseRevisionId,
179:       draftId: input.draft.draftId,
195:   const requirementGate = input.activeRequirementRevisionId !== null
210:         preview.basis.draftId !== input.draft.draftId ||
224:       preview.inputFingerprint !== check.inputFingerprint ||
225:       preview.requirementRevisionId !== check.requirementRevisionId
232:           detail: `preview=${preview.status}/${preview.inputFingerprint.slice(0, 12)}，recomputed=${
234:           }/${check.inputFingerprint.slice(0, 12)}`,
273:     revisionId: input.revisionId,
274:     analysisSnapshotId: input.analysisSnapshotId,
277:     restoredFromRevisionId: input.restoredFromRevisionId,
282:             requirementRevisionId: committedCheck.requirementRevisionId,
```

### src/requirements/confirm.ts

```text
5:  * - 已确认条款不可变：任何原文/来源/选区/上下限变化都新建 revisionId；
6:  * - Beta 一条链最多一个活动 requirementId，试图绑第二条返回
21: import { canonicalJson, stableFingerprint } from '../revisions/canonical'
68:   expectedActiveRequirementRevisionId: string | null
69:   /** 更新既有条款时为原 requirementId；首版 null。 */
70:   requirementId: string | null
72:   newRequirementId: string
73:   newRevisionId: string
74:   newCheckId: string
76:   newConfigRevisionId: string
78:     documentId: string
79:     revisionId: string
115:       documentId: document.id,
116:       latestRevisionId: document.latestRevisionId,
119:       revisionId: revision.id,
120:       documentId: revision.documentId,
121:       sha256: revision.sha256,
124:       bindingId: binding.id,
125:       revisionId: binding.revisionId,
145:     input.chainRef.projectId !== snapshot.project.id
153:   const activeId = snapshot.project.activeRequirementRevisionId
155:     activeId === null
157:       : (snapshot.project.requirementRevisions.find((item) => item.revisionId === activeId) ??
159:   const activeRequirementId = activeRevision?.requirementId ?? null
160:   if (input.expectedActiveRequirementRevisionId !== activeId) {
164:       { detail: `expected=${String(input.expectedActiveRequirementRevisionId)}，current=${String(activeId)}` },
167:   if (activeId === null) {
168:     if (input.requirementId !== null) {
171:   } else if (input.requirementId === null || input.requirementId !== activeRequirementId) {
176:       { detail: `active=${activeId}，requirementId=${String(activeRequirementId)}` },
207:   if (activeId !== null && reason === '') {
214:   const document = snapshot.documents.find((item) => item.id === input.source.documentId)
215:   if (document === undefined || document.projectId !== snapshot.project.id) {
218:   const revision = snapshot.revisions.find((item) => item.id === input.source.revisionId)
221:     revision.projectId !== snapshot.project.id ||
222:     revision.documentId !== document.id
230:   if (blob.sha256 !== revision.sha256 || blob.byteSize !== revision.byteSize) {
252:     documentId: document.id,
253:     revisionId: revision.id,
254:     sha256: revision.sha256,
261:   const requirementId = activeRequirementId ?? input.newRequirementId
262:   const parentRevisionId = activeId
263:     ? (snapshot.project.requirementRevisions.find((item) => item.revisionId === activeId)
264:         ?.revisionId ?? null)
267:     requirementId,
268:     revisionId: input.newRevisionId,
269:     parentRevisionId,
270:     projectId: snapshot.project.id,
271:     chainRef: { projectId: snapshot.project.id, kind: 'project-dimension-chain' },
275:     confirmedAgainstLatestRevisionId: document.latestRevisionId,
279:     changeReason: activeId === null ? reason || '建立条款' : reason,
289:     activeRequirementRevisionId: revisionRecord.revisionId,
292:     baseRevisionId: input.newConfigRevisionId,
296:     checkId: input.newCheckId,
300:       projectRevisionId: input.newConfigRevisionId,
301:       parentRevisionId: snapshot.project.currentRevisionId,
312:     id: `requirement_confirmed:${revisionRecord.revisionId}`,
313:     projectId: snapshot.project.id,
316:     requirementId,
317:     requirementRevisionId: revisionRecord.revisionId,
318:     parentRevisionId: revisionRecord.parentRevisionId,
321:     confirmedTextDigest: stableFingerprint({ text: confirmedText }),
322:     sourceRevisionId: isPdfRequirementSource(revisionRecord.source)
323:       ? revisionRecord.source.revisionId
326:       ? revisionRecord.source.sha256
327:       : stableFingerprint(revisionRecord.source.attestation),
328:     checkId: baseline.value.check.checkId,
332:       revisionRecord.parentRevisionId === null
334:         : `更新任务书条款版本（原版本 ${revisionRecord.parentRevisionId}）。`,
339:     currentRevisionId: input.newConfigRevisionId,
341:     activeRequirementRevisionId: revisionRecord.revisionId,
346:     analysisSnapshotId: null,
347:     eventIds: [event.id],
349:     restoredFromRevisionId: null,
350:     requirementRevisionId: revisionRecord.revisionId,
351:     checkId: baseline.value.check.checkId,
354:     revisionId: input.newConfigRevisionId,
355:     parentId: snapshot.project.currentRevisionId,
357:     reason: revisionRecord.parentRevisionId === null ? '建立任务书条款' : '更新任务书条款',
386:   return stableFingerprint(canonicalJson({ text: revision.confirmedText }))
```

### src/requirements/fingerprint.ts

```text
4:  * 指纹只覆盖**输入**，不覆盖输出身份：checkId、checkedAt、inputFingerprint
9:  * - 条款 requirementId/revisionId/原文/规则/上下限/确认依据/来源精确版本与区域；
17: import { canonicalJson, stableFingerprint } from '../revisions/canonical'
18: import { sha256Hex } from '../sources/hash'
28:   draftId: string
35:   projectId: string
37:   baseRevisionId: string
46:     documentId: string
47:     latestRevisionId: string
48:     revisionId: string | null
50:     sha256: string | null
57:   return stableFingerprint({
59:       parameterId: item.parameterId,
65:       termId: item.termId,
70:       bindingId: item.bindingId,
71:       termId: item.termId,
72:       parameterId: item.parameterId,
85:   baseRevisionId: string
92:   const revisions = new Map(snapshot.revisions.map((item) => [item.id, item]))
95:     projectId: snapshot.project.id,
97:       projectId: snapshot.project.id,
100:     baseRevisionId: options.baseRevisionId,
108:       const latest = revisions.get(document.latestRevisionId) ?? null
110:         documentId: document.id,
111:         latestRevisionId: document.latestRevisionId,
112:         revisionId: latest?.id ?? null,
116:         sha256: latest?.sha256 ?? null,
124: export async function computeRequirementInputFingerprint(
128:     projectId: input.projectId,
130:     baseRevisionId: input.baseRevisionId,
137:             requirementId: input.requirement.requirementId,
138:             revisionId: input.requirement.revisionId,
139:             parentRevisionId: input.requirement.parentRevisionId,
146:             confirmedAgainstLatestRevisionId:
147:               input.requirement.confirmedAgainstLatestRevisionId,
150:                   documentId: input.requirement.source.documentId,
151:                   revisionId: input.requirement.source.revisionId,
152:                   sha256: input.requirement.source.sha256,
161:                   actorId: input.requirement.source.attestation.actorId,
173:         id: term.id,
188:             draftId: input.draft.draftId,
192:                 parameterId: parameter.parameterId,
193:                 partId: parameter.partId,
200:               .sort((left, right) => (left.parameterId < right.parameterId ? -1 : 1)),
204:                 bindingId: link.bindingId,
205:                 termId: link.termId,
206:                 parameterId: link.parameterId,
209:               .sort((left, right) => (left.bindingId < right.bindingId ? -1 : 1)),
217:       left.documentId < right.documentId ? -1 : 1,
220:   return sha256Hex(new TextEncoder().encode(canonicalJson(payload)))
226:   currentFingerprint: string,
228:   return check.inputFingerprint !== currentFingerprint
```

### src/requirements/history.ts

```text
5:  * - 每个版本冻结自己的 PDF revisionId / 页码 / 选区，不能拿活动版本顶替；
36:   requirementRevisionId: string
37:   revisionId: string
50:   revisionId: string
51:   requirementId: string
52:   parentRevisionId: string | null
58:   sourceRevisionId: string | null
69:   /** 按传入 revisionId 找到的版本；找不到时为 null。 */
91:     (item) => item.id === source.revisionId,
96:       `条款版本 ${revision.revisionId} 引用的来源 PDF 版本 ${source.revisionId} 不在项目文件中（可能已删除），无法定位。`,
102:       item.revisionId === sourceRevision.id ||
108:       `条款版本 ${revision.revisionId} 引用的来源 ${sourceRevision.id} 已声明缺失（${declaredMissing.reason}），无法打开 PDF。`,
118:       `条款版本 ${revision.revisionId} 引用的来源附件 ${source.blobKey} 不在项目文件中（可能已删除），无法打开 PDF。`,
123:     sourceRevision.sha256 !== source.sha256 ||
124:     blob.sha256 !== source.sha256
128:       `条款版本 ${revision.revisionId} 引用的来源 ${sourceRevision.id} 哈希与确认时不一致，不能打开可能已替换的 PDF。`,
139:       `条款版本 ${revision.revisionId} 保存的第 ${source.page} 页超出 ${sourceRevision.id} 的页数（${sourceRevision.pageCount} 页），无法定位选区。`,
147:  * 按**传入的 revisionId**取该版本的来源；历史版本不会被活动版本替换。
151:   revisionId: string,
155:       (item) => item.revisionId === revisionId,
163:         `条款版本 ${revisionId} 不在项目文件中（可能已删除），无法定位来源 PDF。`,
174:     (item) => item.id === source.revisionId,
180:       requirementRevisionId: revision.revisionId,
181:       revisionId: source.revisionId,
185:       label: `条款 ${revision.revisionId}`,
195:  * 每条来源字段都通过 `resolveRequirementRevisionSource(snapshot, 本条 revisionId)`
204:       stored.revisionId,
210:       : snapshot.revisions.find((item) => item.id === pdfSource.revisionId)
212:       revisionId: stored.revisionId,
213:       requirementId: stored.requirementId,
214:       parentRevisionId: stored.parentRevisionId,
219:       sourceRevisionId: pdfSource?.revisionId ?? null,
228:         stored.revisionId ===
229:         snapshot.project.activeRequirementRevisionId,
```

### src/requirements/types.ts

```text
7:  * 2. 条款版本确认后不可变：任何字段变化都新建 revisionId，不原位覆盖。
68:   projectId: string
72: /** 条款引用的确切 PDF 版本与页内区域；不复用 termId 的组成环来源绑定。 */
76:   documentId: string
77:   revisionId: string
78:   sha256: string
112:     parameterId: string
118:     termId: string
123:     bindingId: string
124:     termId: string
125:     parameterId: string
133:   requirementId: string
134:   revisionId: string
136:   parentRevisionId: string | null
137:   projectId: string
144:   confirmedAgainstLatestRevisionId: string
154:   /** 更新既有条款时为原 requirementId；首版为 null。 */
155:   requirementId: string | null
162:     documentId: string | null
163:     revisionId: string | null
174:       baseRevisionId: string
175:       draftId: string
180:       projectRevisionId: string
181:       parentRevisionId: string | null
185:   requirementId: string
186:   requirementRevisionId: string
191:   analysisSnapshotId: string | null
192:   projectRevisionId: string | null
193:   drawingFingerprint: string | null
200:  * `isRequirementCheckStale(check, currentFingerprint)` 派生。
203:   checkId: string
204:   projectId: string
206:   requirementRevisionId: string | null
211:   inputFingerprint: string
225:   requirementRevisionId: string | null
```

### src/review/invalidation.ts

```text
168:   termId: string,
169:   affectedTermIds: readonly string[],
173:     return affectedTermIds.includes(termId)
```

### src/review/rules.ts

```text
24: export type ReviewRuleId =
34: export const REVIEW_RULE_IDS: readonly ReviewRuleId[] = [
45: export const REVIEW_RULE_LABEL: Record<ReviewRuleId, string> = {
89:       termId: string
94:       bindingId: string
95:       termId: string
96:       documentId: string
97:       revisionId: string
103:   /** 链级为 'chain'，逐环为 termId，逐绑定为 bindingId。 */
106:   termId?: string
107:   bindingId?: string
108:   documentId?: string
109:   revisionId?: string
114:   ruleId: ReviewRuleId
210:   return name !== '' ? name : term.id
218:   return { kind: 'term', id: term.id, label: `组成环 ${termLabel(term)}`, termId: term.id }
227:   const termPart = term === undefined ? binding.termId : termLabel(term)
229:   const documentPart = document?.title ?? binding.documentId
232:     id: binding.id,
234:     termId: binding.termId,
235:     bindingId: binding.id,
236:     documentId: binding.documentId,
237:     revisionId: binding.revisionId,
245:     bindingId: binding.id,
246:     termId: binding.termId,
247:     documentId: binding.documentId,
248:     revisionId: binding.revisionId,
253: function truncateId(value: string): string {
268:   const termId = key.slice(0, dot)
279:     target: { kind: 'term', termId },
280:     label: `${termId} 的${fieldLabel[field] ?? field}`,
285:   ruleId: ReviewRuleId
299:     ruleId: draft.ruleId,
340:         ruleId: 'INPUT_VALID',
355:         ruleId: 'INPUT_VALID',
375:         ruleId: 'CALC_VALID',
389:         ruleId: 'CALC_VALID',
403:         ruleId: 'CALC_VALID',
419:         ruleId: 'RELATION_CONFIRMED',
433:         ruleId: 'RELATION_CONFIRMED',
446:         ruleId: 'RELATION_CONFIRMED',
461:         ruleId: 'RELATION_CONFIRMED',
478:         ruleId: 'TARGET_WITHIN',
492:         ruleId: 'TARGET_WITHIN',
506:         ruleId: 'TARGET_WITHIN',
520:         ruleId: 'TARGET_WITHIN',
533:         ruleId: 'TARGET_WITHIN',
548:         ruleId: 'TARGET_WITHIN',
563:     const count = input.bindings.filter((binding) => binding.termId === term.id).length
566:         ruleId: 'SOURCE_PRESENT',
577:         target: { kind: 'term', termId: term.id },
584:     const term = input.terms.find((candidate) => candidate.id === binding.termId)
586:       (candidate) => candidate.id === binding.documentId,
589:       (candidate) => candidate.id === binding.revisionId,
598:           ruleId: 'SOURCE_AVAILABLE',
602:           basis: `绑定引用的版本 ${truncateId(binding.revisionId)} 在来源版本记录中不存在。`,
612:           ruleId: 'SOURCE_AVAILABLE',
626:           ruleId: 'SOURCE_AVAILABLE',
642:           ruleId: 'SOURCE_CURRENT',
653:     } else if (binding.revisionId === document.latestRevisionId) {
656:           ruleId: 'SOURCE_CURRENT',
660:           basis: `绑定指向文档「${document.title}」的当前最新版本 ${truncateId(binding.revisionId)}。`,
669:         acceptance !== null && acceptance.latestRevisionId === document.latestRevisionId
673:             ruleId: 'SOURCE_CURRENT',
678:               `使用历史来源（已说明）：绑定仍指向旧版本 ${truncateId(binding.revisionId)}，` +
679:               `文档最新版本为 ${truncateId(document.latestRevisionId)}；` +
687:         const previous = acceptance === null ? '' : `此前接受的是 ${truncateId(acceptance.latestRevisionId)}，之后又导入了更新版本；`
690:             ruleId: 'SOURCE_CURRENT',
695:               `文档「${document.title}」已导入更新版本 ${truncateId(document.latestRevisionId)}，` +
696:               `当前绑定仍指向旧版本 ${truncateId(binding.revisionId)}。${previous}` +
712:           ruleId: 'SOURCE_VALUE_REVIEWED',
726:           ruleId: 'SOURCE_VALUE_REVIEWED',
740:           ruleId: 'SOURCE_VALUE_REVIEWED',
754:           ruleId: 'SOURCE_VALUE_REVIEWED',
813:   ruleId: ReviewRuleId,
815:   return summary.findings.filter((finding) => finding.ruleId === ruleId)
```

### src/revisions/canonical.ts

```text
35: export function stableFingerprint(value: unknown): string {
```

### src/revisions/commit.ts

```text
6:  * + currentRevisionId。调用方（main）必须把候选整体交给一次原子保存；
31: import { stableFingerprint } from './canonical'
36:   revisionId: string
37:   analysisSnapshotId: string
41:   restoredFromRevisionId: string | null
49:     requirementRevisionId: string | null
61: function eventId(type: ChangeEventType, revisionId: string, subject: string): string {
62:   return `${type}:${revisionId}:${subject}`
66:   return new Map(links.map((link) => [link.bindingId, link]))
74:   const projectId = base.project.id
86:       id: eventId('parameter_changed', options.revisionId, row.parameterId),
87:       projectId,
90:       parameterId: row.parameterId,
101:   for (const [bindingId, link] of nextBindings) {
102:     if (!baseBindings.has(bindingId)) {
104:         id: eventId('parameter_binding_added', options.revisionId, bindingId),
105:         projectId,
108:         bindingId,
109:         termId: link.termId,
110:         parameterId: link.parameterId,
117:   for (const [bindingId, link] of baseBindings) {
118:     if (!nextBindings.has(bindingId)) {
120:         id: eventId('parameter_binding_removed', options.revisionId, bindingId),
121:         projectId,
124:         bindingId,
125:         termId: link.termId,
126:         parameterId: link.parameterId,
135:       id: eventId('parameter_binding_confirmed', options.revisionId, credential.bindingId),
136:       projectId,
139:       bindingId: credential.bindingId,
140:       parameterId: credential.parameterId,
141:       termId: credential.termId,
144:       drawingId: credential.drawingId,
145:       drawingFingerprint: credential.drawingFingerprint,
147:       revisionIdAtCommit: options.revisionId,
150:       message: `确认参数 ${credential.parameterId} 与环 ${credential.termId} 的 nominal 同步。`,
155:     id: eventId('project_revision_committed', options.revisionId, options.revisionId),
156:     projectId,
160:     revisionIdAtCommit: options.revisionId,
161:     message: options.restoredFromRevisionId === null
163:       : `从版本 ${options.restoredFromRevisionId} 恢复生成新版本。`,
166:   if (options.restoredFromRevisionId !== null) {
168:       id: eventId('project_restored_from_revision', options.revisionId, options.revisionId),
169:       projectId,
172:       before: options.restoredFromRevisionId,
173:       after: options.revisionId,
187:   const termById = new Map(base.project.dimensionChain.terms.map((term) => [term.id, term]))
188:   const documentById = new Map(base.documents.map((document) => [document.id, document]))
189:   const revisionById = new Map(base.revisions.map((revision) => [revision.id, revision]))
190:   const termRevisionById = new Map(
191:     base.project.dimensionChain.terms.map((term) => [term.id, term.termRevision]),
194:     const statusOf = (ruleId: string) => {
196:         (item) => item.ruleId === ruleId && item.subject.bindingId === binding.id,
200:     const document = documentById.get(binding.documentId) ?? null
201:     const revision = revisionById.get(binding.revisionId) ?? null
202:     const term = termById.get(binding.termId) ?? null
204:       bindingId: binding.id,
205:       termId: binding.termId,
207:       termRevision: termRevisionById.get(binding.termId) ?? null,
208:       documentId: binding.documentId,
210:       revisionId: binding.revisionId,
212:       revisionSha256: revision?.sha256 ?? null,
230:   const boundTermIds = new Set(base.bindings.map((binding) => binding.termId))
235:     unboundTermIds: base.project.dimensionChain.terms
236:       .filter((term) => !boundTermIds.has(term.id))
237:       .map((term) => term.id),
260:       id: term.id,
284:     id: options.analysisSnapshotId,
285:     projectId: base.project.id,
290:     inputFingerprint: stableFingerprint({
294:       drawing: computation.drawing.record.dataFingerprint,
295:       sources: stableFingerprint({
317:     currentRevisionId: options.revisionId,
330:     analysisSnapshotId: analysisSnapshot.id,
331:     eventIds: events.map((event) => event.id),
334:         documentId: document.id,
335:         latestRevisionId: document.latestRevisionId,
338:         revisionId: revision.id,
339:         documentId: revision.documentId,
340:         sha256: revision.sha256,
343:         bindingId: binding.id,
344:         revisionId: binding.revisionId,
349:     restoredFromRevisionId: options.restoredFromRevisionId,
353:           requirementRevisionId: options.requirement.requirementRevisionId,
354:           checkId: options.requirement.check.checkId,
359:     revisionId: options.revisionId,
360:     parentId: base.project.currentRevisionId,
```

### src/revisions/compare.ts

```text
5:  * （parameterId / annotationId / primitiveId / viewId）join，不用数组下标或名称。
27:   revisionId: string
28:   drawingId: string
48: function annotationText(data: DrawingData, parameterId: string, kind: 'diameter' | 'length'): string {
49:   const resolved = resolveDimension(parameterId, data.parameterSnapshot)
72:   push('version', 'revisionId', '生成版本', left.revisionId, right.revisionId)
73:   push('version', 'drawingId', '图纸 ID', left.drawingId, right.drawingId)
92:     const before = left.data.views.find((item) => item.viewId === view.viewId)
94:       diff.push({ scope: 'meta', id: view.viewId, field: '视图', before: null, after: view.kind, kind: 'added' })
96:       push('meta', view.viewId, '视图锚点', before.anchorMm, view.anchorMm)
97:       push('meta', view.viewId, '视图缩放', before.scaleFactor, view.scaleFactor)
102:   const parameterIds = new Set([
103:     ...left.data.parameterSnapshot.map((item) => item.parameterId),
104:     ...right.data.parameterSnapshot.map((item) => item.parameterId),
106:   for (const parameterId of parameterIds) {
107:     const before = left.data.parameterSnapshot.find((item) => item.parameterId === parameterId)
108:     const after = right.data.parameterSnapshot.find((item) => item.parameterId === parameterId)
112:         id: parameterId,
120:     push('parameter', parameterId, '工程值 valueQ', before.valueQ, after.valueQ)
121:     push('parameter', parameterId, '部件', before.partId, after.partId)
122:     push('parameter', parameterId, '键', before.key, after.key)
123:     push('parameter', parameterId, '显示小数位', before.inputDecimals, after.inputDecimals)
124:     push('parameter', parameterId, '来源备注', before.sourceNote ?? '', after.sourceNote ?? '')
127:   // 标注按 annotationId join；参数值变化时即使 annotation 对象未变，也显示文字变化。
128:   const annotationIds = new Set([
129:     ...left.data.annotations.map((item) => item.annotationId),
130:     ...right.data.annotations.map((item) => item.annotationId),
132:   for (const annotationId of annotationIds) {
133:     const before = left.data.annotations.find((item) => item.annotationId === annotationId)
134:     const after = right.data.annotations.find((item) => item.annotationId === annotationId)
138:         id: annotationId,
146:     push('annotation', annotationId, '类型', before.kind, after.kind)
147:     push('annotation', annotationId, '参数', before.parameterId, after.parameterId)
148:     push('annotation', annotationId, '视图', before.viewId, after.viewId)
151:       annotationId,
156:     push('annotation', annotationId, '文字位置', before.textPositionMm, after.textPositionMm)
157:     push('annotation', annotationId, '文字锚点', before.textAnchor, after.textAnchor)
158:     push('annotation', annotationId, '样式', before.styleId, after.styleId)
161:       annotationId,
163:       annotationText(left.data, before.parameterId, before.kind),
164:       annotationText(right.data, after.parameterId, after.kind),
168:   // 图元按 primitiveId join。
169:   const primitiveIds = new Set([
170:     ...left.data.primitives.map((item) => item.primitiveId),
171:     ...right.data.primitives.map((item) => item.primitiveId),
173:   for (const primitiveId of primitiveIds) {
174:     const before = left.data.primitives.find((item) => item.primitiveId === primitiveId)
175:     const after = right.data.primitives.find((item) => item.primitiveId === primitiveId)
179:         id: primitiveId,
187:     push('primitive', primitiveId, '类型', before.kind, after.kind)
188:     push('primitive', primitiveId, '几何', before.geometryMm, after.geometryMm)
189:     push('primitive', primitiveId, '样式', before.styleId, after.styleId)
190:     push('primitive', primitiveId, '区域', before.area, after.area)
191:     push('primitive', primitiveId, '视图', before.viewId ?? '', after.viewId ?? '')
```

### src/revisions/compute.ts

```text
68:   /** 确认/预览分配的正式 revisionId；图纸指纹用它重建。 */
69:   revisionId: string
85: ): { chain: ChainDefinition; termDiffs: BindingDiffRow[]; changedTermIds: string[] } {
87:   const byId = new Map(terms.map((term) => [term.id, term]))
88:   const beforeById = new Map(previous.terms.map((term) => [term.id, term]))
89:   const parameterById = new Map(parameters.map((parameter) => [parameter.parameterId, parameter]))
95:     if (seenTerms.has(binding.termId)) {
98:         `组成环 ${binding.termId} 存在第二个参数绑定`,
99:         binding.bindingId,
102:     seenTerms.add(binding.termId)
103:     const term = byId.get(binding.termId)
107:         `参数绑定 ${binding.bindingId} 引用了不存在的组成环`,
108:         binding.termId,
111:     const parameter = parameterById.get(binding.parameterId)
115:         `参数绑定 ${binding.bindingId} 引用了不存在的参数`,
116:         binding.parameterId,
119:     if (parameter.partId !== binding.partId) {
122:         `参数绑定 ${binding.bindingId} 的部件与参数不一致`,
123:         `${binding.partId} != ${parameter.partId}`,
126:     if (parameter.partId !== SPACER_PART_ID) {
127:       throw new ChangeError('INVALID_BINDING', `参数绑定 ${binding.bindingId} 指向不支持的部件`)
129:     const beforeQ = beforeById.get(binding.termId)?.nominalQ ?? term.nominalQ
134:       changed.add(term.id)
137:       bindingId: binding.bindingId,
138:       termId: term.id,
140:       parameterId: parameter.parameterId,
151:     changedTermIds: [...changed],
156:   projectId: string,
161:     drawingId: record.drawingId,
162:     partId: record.partId,
163:     templateId: record.templateId,
166:     projectId,
167:     revisionId: record.revisionId,
170:       parameterId: parameter.parameterId,
171:       partId: parameter.partId,
219:     const parameterId = SPACER_PARAMETER_IDS[key]
226:       parameterId,
255:   const drawingId = baseRecord?.drawingId ?? `drawing:${snapshot.project.id}:spacer`
259:     parameterId: parameter.parameterId,
260:     partId: parameter.partId,
273:       projectId: snapshot.project.id,
274:       revisionId: options.revisionId,
275:       drawingId,
287:     drawingId,
289:     templateId: data.templateId,
291:     partId: data.partId,
292:     revisionId: options.revisionId,
293:     parameterIds: data.parameterSnapshot.map((item) => item.parameterId),
298:     dataFingerprint: data.fingerprint,
307:     previousInput = drawingInputOf(snapshot.project.id, snapshot.project.parameters, baseRecord)
308:     const rebuilt = rebuildFromGenerationInput(previousInput, baseRecord.dataFingerprint)
316:   const bindingTerms = new Set(draft.bindings.map((binding) => binding.termId))
320:       .map((link) => link.termId),
322:   const affected = new Set<string>(applied.termDiffs.filter((row) => row.changed).map((row) => row.termId))
323:   for (const termId of bindingTerms) {
324:     if (!baseBindingTerms.has(termId)) {
325:       affected.add(termId)
328:   for (const termId of baseBindingTerms) {
329:     if (!bindingTerms.has(termId)) {
330:       affected.add(termId)
333:   const unboundTermIds = chain.terms
334:     .filter((term) => !bindingTerms.has(term.id))
335:     .map((term) => term.id)
338:     const parameter = parameters.find((item) => item.parameterId === binding.parameterId)
339:     const term = chain.terms.find((item) => item.id === binding.termId)
341:       throw new ChangeError('MISSING_REFERENCE', `绑定 ${binding.bindingId} 的引用不完整`)
344:       bindingId: binding.bindingId,
345:       parameterId: parameter.parameterId,
346:       termId: term.id,
349:       drawingId: record.drawingId,
350:       drawingFingerprint: record.dataFingerprint,
368:     changedTermIds: applied.changedTermIds,
369:     affectedTermIds: [...affected],
370:     unboundTermIds,
396:   return computation.changedTermIds.length > 0
```

### src/revisions/digest.ts

```text
5:  * - 基准不是单个 currentRevisionId：链、参数、绑定、图纸、模型、来源、版本
13: import { sha256Hex } from '../sources/hash'
14: import { canonicalJson, stableFingerprint } from './canonical'
22: export type BaseGroupId =
33: export const BASE_GROUP_LABEL: Record<BaseGroupId, string> = {
46:   id: BaseGroupId
56:   currentRevisionId: string
82:       id: term.id,
98:       parameterId: parameter.parameterId,
99:       partId: parameter.partId,
106:     .sort((left, right) => (left.parameterId < right.parameterId ? -1 : 1))
112:       bindingId: link.bindingId,
113:       termId: link.termId,
114:       partId: link.partId,
115:       parameterId: link.parameterId,
118:     .sort((left, right) => (left.bindingId < right.bindingId ? -1 : 1))
123:     drawingId: drawing.drawingId,
125:     templateId: drawing.templateId,
127:     partId: drawing.partId,
128:     revisionId: drawing.revisionId,
129:     parameterIds: drawing.parameterIds,
134:     dataFingerprint: drawing.dataFingerprint,
141:       partId: part.partId,
142:       currentModelRevisionId: part.currentModelRevisionId,
145:       modelRevisionId: revision.modelRevisionId,
146:       partId: revision.partId,
171:     bindingId: binding.id,
172:     termId: binding.termId,
173:     revisionId: binding.revisionId,
174:     documentId: binding.documentId,
182:   const boundRevisionIds = new Set(snapshot.bindings.map((binding) => binding.revisionId))
183:   const boundDocumentIds = new Set(snapshot.bindings.map((binding) => binding.documentId))
184:   const revisions = snapshot.revisions.filter((revision) => boundRevisionIds.has(revision.id))
185:   const documents = snapshot.documents.filter((document) => boundDocumentIds.has(document.id))
194:       documentId: document.id,
195:       latestRevisionId: document.latestRevisionId,
198:       revisionId: revision.id,
199:       documentId: revision.documentId,
201:       sha256: revision.sha256,
209:         sha256: blob.sha256,
217: export function sourceFingerprint(snapshot: SourceSnapshotLike): string {
218:   return stableFingerprint(sourceInput(snapshot))
227:     activeRequirementRevisionId: snapshot.project.activeRequirementRevisionId,
230:         requirementId: revision.requirementId,
231:         revisionId: revision.revisionId,
232:         parentRevisionId: revision.parentRevisionId,
238:         confirmedAgainstLatestRevisionId: revision.confirmedAgainstLatestRevisionId,
241:               documentId: revision.source.documentId,
242:               revisionId: revision.source.revisionId,
243:               sha256: revision.source.sha256,
251:               actorId: revision.source.attestation.actorId,
258:       .sort((left, right) => (left.revisionId < right.revisionId ? -1 : 1)),
264:   return `${sourceFingerprint(snapshot)}:${sourceNote ?? ''}`
269:   input: { sessionId: string; generation: number; acceptedSeq: number },
271:   const raw: { id: BaseGroupId; value: unknown }[] = [
291:         projectId: snapshot.project.id,
292:         sessionId: input.sessionId,
293:         currentRevisionId: snapshot.project.currentRevisionId,
302:     groups.push({ id: group.id, hash: await sha256Hex(new TextEncoder().encode(canonicalJson(group.value))) })
304:   const token = await sha256Hex(new TextEncoder().encode(canonicalJson(groups)))
310:     currentRevisionId: snapshot.project.currentRevisionId,
316:   draftId: string
322:   return sha256Hex(
325:         draftId: input.draftId,
329:           bindingId: link.bindingId,
330:           termId: link.termId,
331:           partId: link.partId,
332:           parameterId: link.parameterId,
342:   id: BaseGroupId
348:   const previous = new Map(before.groups.map((group) => [group.id, group.hash]))
351:     if (previous.get(group.id) !== group.hash) {
352:       changes.push({ id: group.id, label: BASE_GROUP_LABEL[group.id] })
```

### src/revisions/rebuild.ts

```text
5:  * 与保存的 dataFingerprint 一致。缺参数、未知模板版本、指纹不符都明确返回
18:   savedFingerprint?: string,
20:   if (input.templateId !== SPACER_TEMPLATE_ID) {
21:     return { ok: false, reason: `未知图纸模板：${String(input.templateId)}，不能重建` }
34:       projectId: input.projectId,
35:       revisionId: input.revisionId,
36:       drawingId: input.drawingId,
38:         parameterId: parameter.parameterId,
39:         partId: parameter.partId,
51:     if (savedFingerprint !== undefined && data.fingerprint !== savedFingerprint) {
55:         detail: `saved=${savedFingerprint}, rebuilt=${data.fingerprint}`,
```

### src/revisions/status.ts

```text
6:  *   drawingFingerprint / 来源基准 / nominal 值全部匹配；
33:   bindingId: string
34:   termId: string
36:   parameterId: string
42:   drawingFingerprint: string | null
49:   ruleId: string
51:   termId: string | null
52:   documentId: string | null
53:   revisionId: string | null
65:     termId: string
111:     (event) => event.type === 'parameter_binding_confirmed' && event.bindingId !== undefined,
117:   bindingId: string,
118:   parameterId: string,
122:     if (event.bindingId !== bindingId || event.parameterId !== parameterId) continue
147:     const term = chain.terms.find((item) => item.id === link.termId) ?? null
148:     const parameter = project.parameters.find((item) => item.parameterId === link.parameterId) ?? null
150:     if (term === null) reasons.push(`组成环 ${link.termId} 不存在（悬空引用）`)
151:     if (parameter === null) reasons.push(`参数 ${link.parameterId} 不存在（悬空引用）`)
152:     if (parameter !== null && parameter.partId !== link.partId) {
161:       parameter === null ? null : latestConfirmation(events, link.bindingId, link.parameterId)
175:       if (confirmation.drawingId !== (drawing?.drawingId ?? null)) {
180:         confirmation.drawingFingerprint !== drawing.dataFingerprint
186:       bindingId: link.bindingId,
187:       termId: link.termId,
188:       termSymbol: term?.symbol ?? link.termId,
189:       parameterId: link.parameterId,
190:       parameterLabel: parameter === null ? link.parameterId : SPACER_PARAMETER_LABELS[parameter.key],
195:       drawingFingerprint: drawing?.dataFingerprint ?? null,
210:   sourceBasisFor: (parameterId: string) => string,
215:     const parameter = project.parameters.find((item) => item.parameterId === row.parameterId)
216:     const term = chain.terms.find((item) => item.id === row.termId)
217:     const confirmation = latestConfirmation(events, row.bindingId, row.parameterId)
226:     if (confirmation.sourceBasis !== sourceBasisFor(row.parameterId)) {
253:  * - 与正式快照同一 bindingId、同一 term/part/parameter，且该参数在草稿里
264:   sourceBasisFor: (parameterId: string) => string,
274:       .map((link) => [link.bindingId, link]),
276:   const confirmedRowsById = new Map(confirmedRows.map((row) => [row.bindingId, row]))
278:     project.parameters.map((parameter) => [parameter.parameterId, parameter]),
281:     draft.parameters.map((parameter) => [parameter.parameterId, parameter]),
285:     const confirmedLink = confirmedLinks.get(binding.bindingId)
286:     const confirmedRow = confirmedRowsById.get(binding.bindingId)
287:     const draftParameter = draftParameters.get(binding.parameterId)
288:     const snapshotParameter = snapshotParameters.get(binding.parameterId)
291:       confirmedLink.termId === binding.termId &&
292:       confirmedLink.partId === binding.partId &&
293:       confirmedLink.parameterId === binding.parameterId
305:     const term = project.dimensionChain.terms.find((item) => item.id === binding.termId) ?? null
308:     if (term === null) reasons.push(`组成环 ${binding.termId} 不存在（悬空引用）`)
309:     if (parameter === null) reasons.push(`参数 ${binding.parameterId} 不存在（悬空引用）`)
311:       bindingId: binding.bindingId,
312:       termId: binding.termId,
313:       termSymbol: term?.symbol ?? binding.termId,
314:       parameterId: binding.parameterId,
315:       parameterLabel: parameter === null ? binding.parameterId : SPACER_PARAMETER_LABELS[parameter.key],
320:       drawingFingerprint: project.drawings[0]?.dataFingerprint ?? null,
340:     .filter((finding) => SOURCE_RULES.has(finding.ruleId) && finding.status !== 'passed')
342:       ruleId: finding.ruleId,
344:       termId: finding.subject.termId ?? null,
345:       documentId: finding.subject.documentId ?? null,
346:       revisionId: finding.subject.revisionId ?? null,
381:     input.computation !== null && input.computation.changedTermIds.length > 0
392:       id: term.id,
405:     termId: row.termId,
464:     (finding) => SOURCE_RULES.has(finding.ruleId) && finding.needsAction,
```

### src/revisions/types.ts

```text
22:   termId: string
23:   partId: string
24:   parameterId: string
28:   bindingId: string
29:   termId: string
31:   parameterId: string
40:   parameterId: string
57:   drawingId: string
58:   partId: string
59:   templateId: 'spacer-a4-landscape'
62:   projectId: string
63:   revisionId: string
65:     parameterId: string
66:     partId: string
86:   changedTermIds: string[]
87:   affectedTermIds: string[]
88:   unboundTermIds: string[]
99:     bindingId: string
100:     parameterId: string
101:     termId: string
104:     drawingId: string
105:     drawingFingerprint: string
```

### src/sources/agentReadDisplay.ts

```text
6:   readonly actorId: string
9:     | { readonly kind: 'pdf-page'; readonly revisionId: string; readonly sha256: string; readonly page: number }
10:     | { readonly kind: 'image'; readonly imageId: string; readonly sha256: string }
38:   return `${reading.source.kind === 'pdf-page' ? `第 ${reading.source.page} 页` : '图片'}，${reading.actorId} 提供`
```

### src/sources/bindings.ts

```text
26: import { addChangeEvent, changeEventId } from '../history/events'
40:  * latestRevisionId 记录本次处理时文档的最新版本；之后再导入新版必须重新处置，
50:   /** 接受时文档的 latestRevisionId。 */
51:   latestRevisionId: string
56:   projectId: string
57:   termId: string
58:   revisionId: string
59:   documentId: string
83:   projectId: string
84:   termId: string
85:   revisionId: string
112:   newId?: () => string
116: function randomId(): string {
155:     counts[binding.termId] = (counts[binding.termId] ?? 0) + 1
172:   const projectId = input.projectId.trim()
173:   const termId = input.termId.trim()
174:   const revisionId = input.revisionId.trim()
176:   if (projectId === '') {
179:   if (termId === '') {
182:   if (revisionId === '') {
199:   const newId = context.newId ?? randomId
211:           transaction.objectStore(SOURCE_REVISION_STORE_NAME).get(revisionId),
214:         if (revision === undefined || revision.projectId !== projectId) {
229:           id: newId(),
230:           projectId,
231:           termId,
232:           revisionId,
233:           documentId: revision.documentId,
248:             id: changeEventId('source_binding_added', binding.id),
249:             projectId,
252:             documentId: binding.documentId,
253:             revisionId: binding.revisionId,
254:             bindingId: binding.id,
255:             termId: binding.termId,
306:   projectId: string,
313:         transaction.objectStore(BINDING_STORE_NAME).index('projectId').getAll(projectId),
320:         left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
333:   projectId: string,
334:   termId: string,
336:   const listed = await listSourceBindings(projectId)
342:     value: listed.value.filter((binding) => binding.termId === termId),
378:             id: changeEventId('source_binding_removed', `${id}:${removedAt}`),
379:             projectId: existing.projectId,
382:             documentId: existing.documentId,
383:             revisionId: existing.revisionId,
384:             bindingId: existing.id,
385:             termId: existing.termId,
461:             id: changeEventId('source_binding_reviewed', `${id}:${reviewedAt}`),
462:             projectId: existing.projectId,
465:             documentId: existing.documentId,
466:             revisionId: existing.revisionId,
467:             bindingId: existing.id,
468:             termId: existing.termId,
497:  * 也不冒充最新版本。凭据记录本次处理时的 latestRevisionId：之后再导入更新版本，
543:           transaction.objectStore(SOURCE_DOCUMENT_STORE_NAME).get(existing.documentId),
545:         if (document === undefined || document.projectId !== existing.projectId) {
549:         if (document.latestRevisionId === existing.revisionId) {
563:             latestRevisionId: document.latestRevisionId,
569:             id: changeEventId('source_binding_historical_accepted', `${id}:${acceptedAt}`),
570:             projectId: existing.projectId,
573:             documentId: existing.documentId,
574:             revisionId: existing.revisionId,
575:             bindingId: existing.id,
576:             termId: existing.termId,
577:             after: `latestRevisionId=${document.latestRevisionId}`,
647:           transaction.objectStore(SOURCE_REVISION_STORE_NAME).get(existing.revisionId),
649:         if (revision === undefined || revision.projectId !== existing.projectId) {
689:               id: changeEventId('source_binding_region_changed', `${id}:${now()}`),
690:               projectId: existing.projectId,
693:               documentId: existing.documentId,
694:               revisionId: existing.revisionId,
695:               bindingId: existing.id,
696:               termId: existing.termId,
723:   revisionId: string
740:   const revisionId = input.revisionId.trim()
741:   if (revisionId === '') {
774:           transaction.objectStore(SOURCE_REVISION_STORE_NAME).get(revisionId),
776:         if (revision === undefined || revision.projectId !== existing.projectId) {
790:           revisionId,
791:           documentId: revision.documentId,
805:             id: changeEventId('source_binding_rebound', `${id}:${now()}`),
806:             projectId: existing.projectId,
809:             documentId: revision.documentId,
810:             revisionId,
811:             bindingId: existing.id,
812:             termId: existing.termId,
```

### src/sources/hash.ts

```text
8: export async function sha256Hex(bytes: Uint8Array): Promise<string> {
```

### src/sources/review.ts

```text
48:   latestRevisionId: string | undefined
54:   const { binding, termRevision, latestRevisionId, attachmentAvailable } = input
65:   if (latestRevisionId === undefined || binding.revisionId !== latestRevisionId) {
68:       latestRevisionId !== undefined &&
70:       acceptance.latestRevisionId === latestRevisionId
```

### src/sources/revisions.ts

```text
6:  *   同名替换只有在调用者显式传入 documentId 时才写入同一文档，且只新增
7:  *   revision、更新 latestRevisionId，绝不覆盖旧 revision / Blob。
23: import { addChangeEvent, changeEventId } from '../history/events'
24: import { sha256Hex } from './hash'
71:   projectId: string
73:   documentId?: string
85:   newId?: () => string
105: function randomId(): string {
194:  * 若事务失败，document.latestRevisionId 保持原值，旧 revision / Blob 不受影响。
197:  * 解析、哈希、限额判断和落库 Blob 全部基于同一份快照，因此 sha256 一定对应
207:   const projectId = input.projectId
210:   const requestedDocumentId = input.documentId
213:   if (projectId.trim() === '') {
257:   const hash = context.hashBytes ?? sha256Hex
258:   let sha256: string
260:     sha256 = await hash(bytesSnapshot)
297:   const newId = context.newId ?? randomId
298:   const revisionId = newId()
299:   const documentId = requestedDocumentId ?? newId()
300:   const blobKey = newId()
305:     id: revisionId,
306:     projectId,
307:     documentId,
309:     sha256,
319:     projectId,
320:     sha256,
340:           transaction.objectStore(PROJECT_STORE_NAME).get(projectId),
352:         if (requestedDocumentId === undefined) {
354:             id: documentId,
355:             projectId,
357:             latestRevisionId: revisionId,
362:             documentStore.get(requestedDocumentId),
364:           if (existing === undefined || existing.projectId !== projectId) {
372:           document = { ...existing, latestRevisionId: revisionId }
381:             .index('projectId')
382:             .getAll(projectId),
411:             id: changeEventId('source_import', revisionId),
412:             projectId,
415:             documentId,
416:             revisionId,
464:   projectId: string,
473:           .index('projectId')
474:           .getAll(projectId),
492:   projectId: string,
501:           .index('projectId')
502:           .getAllKeys(projectId),
533:   projectId: string,
542:           .index('projectId')
543:           .getAll(projectId),
```

### src/sources/types.ts

```text
5:  * projectId。数据库里多个项目共用同一批 store，项目总量限额与“只列出本项目
6:  * 文档”都需要它；没有 projectId 就只能靠全表扫描推断归属。
11:   projectId: string
14:   /** 指向 sourceRevisions.id；同一文档可保留多个不可变 revision。 */
15:   latestRevisionId: string
21:   projectId: string
22:   documentId: string
25:   sha256: string
35:   projectId: string
36:   sha256: string
```

### src/storage/db.ts

```text
17:  * 保存 revisionId、页码、PDF 坐标（page.view 四元组）与备注，不保存数值或
23:  * index=projectId），与迁移后的 projects/drafts 在同一个事务写入，失败一起
57:   { name: DRAFT_STORE_NAME, keyPath: 'projectId', indexes: [] },
59:   { name: IMPORT_SNAPSHOT_STORE_NAME, keyPath: 'id', indexes: ['projectId'] },
60:   { name: SOURCE_DOCUMENT_STORE_NAME, keyPath: 'id', indexes: ['projectId'] },
64:     indexes: ['projectId', 'documentId'],
66:   { name: SOURCE_BLOB_STORE_NAME, keyPath: 'blobKey', indexes: ['projectId'] },
70:     indexes: ['projectId', 'termId', 'revisionId'],
75:     indexes: ['projectId', 'createdAt'],
80:     indexes: ['projectId'],
85:     indexes: ['projectId', 'createdAt'],
```

### src/storage/migrateV1.ts

```text
65:   backupId: string
190:     id: raw.id as string,
201:       backupId: options.backupId,
248:       id: String(term.id ?? ''),
```

### src/storage/projectJson.ts

```text
50:   projectId: string
187:   const latestRevisionId =
188:     typeof record.latestRevisionId === 'string' ? record.latestRevisionId.trim() : ''
193:   if (reason === '' || scope === '' || latestRevisionId === '' || acceptedAt === null) {
196:   return { reason, scope, acceptedAt, latestRevisionId }
348:   const termIds = new Set(working.terms.map((term) => term.id))
360:     const id = readStringField(item.id, [...path, 'id'], 'invalid_source_document', '文档 id', issues)
362:     const latestRevisionId = readStringField(
363:       item.latestRevisionId,
364:       [...path, 'latestRevisionId'],
369:     if (id !== null && title !== null && latestRevisionId !== null) {
370:       documents.push({ id, projectId: '', title, latestRevisionId })
381:     const id = readStringField(item.id, [...path, 'id'], 'invalid_source_revision', '版本 id', issues)
382:     const documentId = readStringField(
383:       item.documentId,
384:       [...path, 'documentId'],
396:     const sha256 = readStringField(
397:       item.sha256,
398:       [...path, 'sha256'],
425:       documentId !== null &&
427:       sha256 !== null &&
435:         projectId: '',
436:         documentId,
438:         sha256: sha256.toLowerCase(),
454:     const id = readStringField(item.id, [...path, 'id'], 'invalid_binding', '绑定 id', issues)
455:     const termId = readStringField(item.termId, [...path, 'termId'], 'invalid_binding', '组成环 id', issues)
456:     const revisionId = readStringField(
457:       item.revisionId,
458:       [...path, 'revisionId'],
463:     const documentId = readStringField(
464:       item.documentId,
465:       [...path, 'documentId'],
489:     if (termId !== null && !termIds.has(termId)) {
491:         path: [...path, 'termId'],
493:         message: `绑定指向的组成环 ${termId} 不在导入的尺寸链中`,
498:       termId !== null &&
499:       revisionId !== null &&
500:       documentId !== null &&
519:         projectId: '',
520:         termId,
521:         revisionId,
522:         documentId,
535:   const documentIds = new Set(documents.map((document) => document.id))
536:   const revisionIds = new Set(revisions.map((revision) => revision.id))
538:     if (!revisionIds.has(document.latestRevisionId)) {
542:         message: `来源文档 ${document.id} 的最新版本 ${document.latestRevisionId} 不在文件中`,
547:     if (!documentIds.has(revision.documentId)) {
551:         message: `来源版本 ${revision.id} 的文档 ${revision.documentId} 不在文件中`,
556:     if (!revisionIds.has(binding.revisionId)) {
560:         message: `绑定 ${binding.id} 的来源版本 ${binding.revisionId} 不在文件中`,
595:   const id = readStringField(input.id, ['id'], 'invalid_project_id', '项目 id', issues)
733:   const id = readStringField(input.id, ['id'], 'invalid_project_id', '项目 id', issues)
```

### src/storage/projects.ts

```text
31: import { changeEventId } from '../history/events'
77:   projectId: string
188: function newProjectId(): string {
200: function newImportSnapshotId(projectId: string): string {
206:   return `import-snapshot-${projectId}-${suffix}`
213: async function addProjectWithUniqueId(
232:       candidate = { ...candidate, id: newProjectId() }
246:   projectId: string
270:   const migratedIds: string[] = []
281:       return migratedIds
290:       const projectId = String(record.id)
291:       const backupId = `migration-backup-${projectId}-${migratedAt}`
292:       const migrated = migrateProjectV1(record, { migratedAt, backupId })
295:           `项目 ${projectId} 无法从 V1 升级：${migrated.error.message}。` +
301:         id: backupId,
302:         projectId,
310:       const storedDraft = (await requestResult(draftStore.get(projectId))) as unknown
320:         id: `schema_migrated_v1_to_v2:${projectId}`,
321:         projectId,
329:       migratedIds.push(projectId)
333:     return migratedIds
379:   drafts: { projectId: string; draft: unknown; savedAt: unknown }[]
405:       (record): record is { projectId: string; draft: unknown; savedAt: unknown } =>
406:         isRecord(record) && typeof record.projectId === 'string',
415:     const draftsByProject = new Map(snapshot.drafts.map((draft) => [draft.projectId, draft]))
417:       const projectId = String((record as Record<string, unknown>).id ?? '')
421:         backupId: 'preflight',
423:       const draftRecord = draftsByProject.get(projectId)
444:         id: projectId,
445:         name: typeof raw.name === 'string' ? raw.name : projectId,
528:   originalId: string
529:   newProjectId: string
563:         (draft): draft is { projectId: string; draft: unknown } =>
565:           typeof draft.projectId === 'string' &&
575:     const projectId = String(record.id ?? '')
578:       backupId: 'preflight',
582:         `备份中的项目 ${projectId} 无法恢复：${preflight.error.message}`,
591:     const originalId = String(raw.id ?? '')
594:       failed.push({ id: originalId, message: imported.error.message })
597:     const newProjectId = imported.value.project.id
598:     const draftRecord = drafts.find((draft) => draft.projectId === originalId)
603:         const saved = await saveDraft(newProjectId, migratedDraft)
608:       originalId,
609:       newProjectId,
617:         ? `备份恢复失败：${failed.map((item) => `${item.id}（${item.message}）`).join('；')}`
669:     id: newProjectId(),
681:     const inserted = await withDatabase((db) => addProjectWithUniqueId(db, project))
702:     id: newProjectId(),
718:     const inserted = await withDatabase((db) => addProjectWithUniqueId(db, project))
791:         right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
924:             id: changeEventId('project_name_changed', `${id}:${savedAt}`),
925:             projectId: id,
942:             id: changeEventId('relation_confirmed', `${id}:${savedAt}`),
943:             projectId: id,
952:             id: changeEventId('relation_confirmation_cleared', `${id}:${savedAt}`),
953:             projectId: id,
961:             id: changeEventId('relation_confirmed', `${id}:${savedAt}`),
962:             projectId: id,
976:             id: changeEventId('baseline_saved', `${id}:${savedAt}`),
977:             projectId: id,
1000:  * revision 是不可变的历史资料，Blob 字节也保留。但它们的 projectId 必须整体
1004:  * 只改各表的作用域键 projectId，不改 sha256 / byteSize / blob / rectPdf /
1007: function retiredSourceScopeId(projectId: string): string {
1008:   return `${projectId}::retired::${newProjectId()}`
1013:   projectId: string,
1015:   const retiredId = retiredSourceScopeId(projectId)
1018:     documentStore.index('projectId').getAll(projectId),
1019:   )) as { id: string; projectId: string }[]
1021:     documentStore.put({ ...document, projectId: retiredId })
1026:     revisionStore.index('projectId').getAll(projectId),
1027:   )) as { id: string; projectId: string }[]
1029:     revisionStore.put({ ...revision, projectId: retiredId })
1034:     blobStore.index('projectId').getAll(projectId),
1035:   )) as { blobKey: string; projectId: string }[]
1037:     blobStore.put({ ...blob, projectId: retiredId })
1042:     bindingStore.index('projectId').getAll(projectId),
1043:   )) as { id: string; projectId: string }[]
1045:     bindingStore.put({ ...binding, projectId: retiredId })
1050:     eventStore.index('projectId').getAll(projectId),
1051:   )) as { id: string; projectId: string }[]
1053:     eventStore.put({ ...event, projectId: retiredId })
1085:         if (snapshotStore.indexNames.contains('projectId')) {
1087:             snapshotStore.index('projectId').getAll(id),
1090:             snapshotStore.delete(snapshot.id)
1096:           analysisSnapshotStore.index('projectId').getAll(id),
1099:           analysisSnapshotStore.delete(snapshot.id)
1126:   projectId: string,
1133:         transaction.objectStore(DRAFT_STORE_NAME).get(projectId),
1163:  * 读取替换导入前的方案快照。传入 projectId 时只返回该项目的快照；
1167:   projectId?: string,
1175:         projectId === undefined
1177:           : store.index('projectId').getAll(projectId)
1193:   projectId: string,
1215:         const existing = (await requestResult(projectStore.get(projectId))) as
1225:         const storedDraft: StoredDraft = { projectId, draft, savedAt }
1233:             id: newImportSnapshotId(projectId),
1234:             projectId,
1260:             existing.working.terms.map((term) => [term.id, term]),
1263:             const previous = previousTerms.get(term.id)
1269:                 id: changeEventId('term_symbol_changed', `${term.id}:${savedAt}`),
1270:                 projectId,
1273:                 termId: term.id,
1281:                 id: changeEventId('term_name_changed', `${term.id}:${savedAt}`),
1282:                 projectId,
1285:                 termId: term.id,
1293:                 id: changeEventId('term_note_changed', `${term.id}:${savedAt}`),
1294:                 projectId,
1297:                 termId: term.id,
1313:                 id: changeEventId(
1315:                   `${term.id}:${field}:${savedAt}`,
1317:                 projectId,
1320:                 termId: term.id,
1329:                 id: changeEventId('term_numeric_changed', `${term.id}:sign:${savedAt}`),
1330:                 projectId,
1333:                 termId: term.id,
1352:               id: changeEventId('target_changed', savedAt),
1353:               projectId,
1364:             .map((term) => term.id)
1365:             .filter((id) => conversion.chain.terms.some((term) => term.id === id))
1367:             .map((term) => term.id)
1371:               conversion.chain.terms.find((term) => term.id === id)?.symbol ?? id
1373:               id: changeEventId('term_reordered', savedAt),
1374:               projectId,
1385:               id: changeEventId('assumptions_changed', savedAt),
1386:               projectId,
1459:     id: project.id,
1481:   projectId: string,
1491:         transaction.objectStore(SOURCE_DOCUMENT_STORE_NAME).index('projectId').getAll(projectId),
1494:         transaction.objectStore(SOURCE_REVISION_STORE_NAME).index('projectId').getAll(projectId),
1497:         transaction.objectStore(BINDING_STORE_NAME).index('projectId').getAll(projectId),
1523: function newImportedSourceId(prefix: string): string {
1537:  *   （document.latestRevisionId、revision.documentId、binding.revisionId /
1538:  *   documentId），保证关联 ID 一致；
1563:       const existing = await requestResult(projectStore.get(candidate.id))
1565:         candidate = { ...candidate, id: newProjectId() }
1578:           const conflict = await requestResult(documentStore.get(document.id))
1580:             document.id,
1581:             conflict === undefined ? document.id : newImportedSourceId('source-document'),
1586:           const conflict = await requestResult(revisionStore.get(revision.id))
1588:             revision.id,
1589:             conflict === undefined ? revision.id : newImportedSourceId('source-revision'),
1596:             id: documentIdMap.get(document.id) as string,
1597:             projectId: candidate.id,
1598:             latestRevisionId: revisionIdMap.get(document.latestRevisionId) as string,
1604:             id: revisionIdMap.get(revision.id) as string,
1605:             projectId: candidate.id,
1606:             documentId: documentIdMap.get(revision.documentId) as string,
1609:             blobKey: newImportedSourceId('source-blob'),
1613:           const conflict = await requestResult(bindingStore.get(binding.id))
1616:             id: conflict === undefined ? binding.id : newImportedSourceId('source-binding'),
1617:             projectId: candidate.id,
1618:             revisionId: revisionIdMap.get(binding.revisionId) as string,
1619:             documentId: documentIdMap.get(binding.documentId) as string,
1631:         id: `project_imported:${candidate.id}`,
1632:         projectId: candidate.id,
1652:       candidate = { ...candidate, id: newProjectId() }
```

### src/workspace/desktopAdapter.ts

```text
58:   sessionId: string | null
97:   sessionId: null,
140:       void this.handleFlush(payload.requestId)
180:     const sessionId = this.state.sessionId
181:     if (sessionId === null) {
190:       const inFlight = this.api.stageDraft({ sessionId, editSeq: seq, snapshot })
224:   async openProject(recentId?: string): Promise<IpcResult<ProjectOpenValue>> {
225:     const result = await this.api.openProject(recentId === undefined ? {} : { recentId })
231:   async importV2(importToken: string, projectId: string): Promise<IpcResult<ProjectOpenValue>> {
232:     const result = await this.api.commitV2({ importToken, projectId })
237:   async restoreRecovery(recoveryId: string): Promise<IpcResult<ProjectOpenValue>> {
238:     const result = await this.api.restoreRecovery({ recoveryId })
249:     const sessionId = this.state.sessionId
250:     if (sessionId === null) {
254:       sessionId,
256:       expectedFingerprint: this.state.fingerprint,
268:     const sessionId = this.state.sessionId
269:     if (sessionId === null) {
273:       sessionId,
291:     if (result.ok && 'sessionId' in result.value) {
294:         ...INITIAL_STATE, status: 'open', sessionId: value.sessionId,
304:   async relinkRecent(recentId: string) {
305:     return this.api.relinkRecent({ recentId })
352:     sessionId: string
613:   private async handleFlush(requestId: string): Promise<void> {
615:     const sessionId = this.state.sessionId
617:       sessionId === null
618:         ? { requestId }
619:         : { requestId, sessionId, editSeq: this.state.acceptedSeq },
665:       sessionId: value.sessionId,
```

### src/workspace/draft.ts

```text
41: /** 键为 `${termId}.${field}`、`target.min` 或 `target.max`。 */
63:       termId: string
67:   | { type: 'updateField'; termId: string; field: 'sign'; value: 1 | -1 }
72:   | { type: 'removeTerm'; termId: string }
73:   | { type: 'moveTerm'; termId: string; direction: 'up' | 'down' }
95:       id: term.id,
123: function cellKey(termId: string, field: string): string {
124:   return `${termId}.${field}`
161:   return draftField === undefined ? null : cellKey(term.id, draftField)
174:     id: term.id,
178:       parseNumericField(term.nominal, cellKey(term.id, 'nominal'), cellErrors) ??
181:       parseNumericField(term.lower, cellKey(term.id, 'lower'), cellErrors) ?? Number.NaN,
183:       parseNumericField(term.upper, cellKey(term.id, 'upper'), cellErrors) ?? Number.NaN,
253:       const terms = draft.terms.filter((term) => term.id !== action.termId)
265:       const index = draft.terms.findIndex((term) => term.id === action.termId)
281:       const index = draft.terms.findIndex((term) => term.id === action.termId)
```

### src/workspace/relation.ts

```text
30:     term.id,
45: export function relationFingerprint(terms: readonly DimensionTerm[]): string {
71:   return review.fingerprint === relationFingerprint(chain.terms)
96:     fingerprint: relationFingerprint(chain.terms),
```

### src/workspace/useBuiltinAssemblyView.ts

```text
14:   /** 为指定会话开启（新建示例会话成功后传新 sessionId）；未传则用当前会话。 */
15:   activate: (sessionId?: string | null) => void
24:   sessionId: string | null
31: export function useBuiltinAssemblyView(sessionId: string | null): BuiltinAssemblyView {
33:   const [state, setState] = useState<ScopedState>({ sessionId: null, ...BLANK })
36:   if (state.sessionId !== sessionId) setState({ sessionId, ...BLANK })
38:   const active = armedSession !== null && armedSession === sessionId
43:       const next = target === undefined ? sessionId : target
```

### src/workspace/useDesktopSession.ts

```text
40:   sessionId: null,
55:   sessionId: string | null
93:   const sessionId = state?.sessionId ?? null
94:   const changeView: ChangeUiState = change.sessionId === sessionId ? change : EMPTY_CHANGE
97:       const base = current.sessionId === sessionId ? current : { ...EMPTY_CHANGE, sessionId }
98:       return { ...base, sessionId, ...patch }
140:     const offFlush = api.onEditorFlush(({ requestId }) => {
145:         api.respondEditorFlush(current.sessionId ? { requestId, sessionId: current.sessionId, editSeq: current.acceptedSeq } : { requestId })
171:   function requireSession(): { session: DesktopSessionAdapter; sessionId: string; acceptedSeq: number } | null {
174:     if (session === null || current === undefined || current.sessionId === null) {
180:     return { session, sessionId: current.sessionId, acceptedSeq: current.acceptedSeq }
187:   const requestId = () => {
218:           current.project.dimensionLinks.flatMap(link => (link.kind === 'parameter-binding' ? [link.termId] : [])),
221:           const before = current.project.dimensionChain.terms.find(item => item.id === term.id)
222:           if (term.id === action.termId && bound.has(term.id) && before !== undefined && before.nominalQ !== term.nominalQ) {
234:         if (result.ok) { setNewOpen(false); created = result.value.sessionId }
239:     openRecent: (item: RecentProjectItem) => run(async session => { report(await (item.missing ? session.relinkRecent(item.recentId) : session.openProject(item.recentId))) }),
242:     commit: (projectId: string) => run(async session => {
244:       const result = report(await session.importV2(preview.importToken, projectId))
251:       bindings?: { termId: string; partId: string; parameterId: string }[],
256:         sessionId: target.sessionId,
303:           sessionId: target.sessionId,
322:           sessionId: target.sessionId,
348:     importSource: async (documentId?: string | null) => {
357:         if (session.sessionId === null) {
362:           sessionId: session.sessionId,
364:           ...(documentId === undefined ? {} : { documentId }),
374:       request: Omit<ExtractionRunRequest, 'sessionId' | 'baseEditSeq'>,
375:     ): Promise<{ requestId: string; result: Awaited<ReturnType<DesktopSessionAdapter['runExtraction']>> } | null> => {
380:       if (state.sessionId === null) { setNotice(NO_WRITABLE_SESSION_NOTICE); return null }
384:           sessionId: state.sessionId,
389:         return { requestId: request.requestId, result }
395:       request: Omit<ExtractionDecideRequest, 'sessionId' | 'baseEditSeq'>,
401:       if (state.sessionId === null) { setNotice(NO_WRITABLE_SESSION_NOTICE); return null }
405:           sessionId: state.sessionId,
415:     cancelExtraction: async (requestId: string): Promise<ExtractionCancelValue | null> => {
418:       if (current === null || state === undefined || state.sessionId === null) return null
419:       const result = await current.cancelExtraction({ sessionId: state.sessionId, requestId })
425:       request: Omit<ExtractionDeleteDraftRequest, 'sessionId' | 'baseEditSeq'>,
431:       if (state.sessionId === null) { setNotice(NO_WRITABLE_SESSION_NOTICE); return null }
435:           sessionId: state.sessionId,
447:       request: Omit<ExtractionConfirmBatchRequest, 'sessionId' | 'baseEditSeq'>,
453:       if (state.sessionId === null) { setNotice(NO_WRITABLE_SESSION_NOTICE); return null }
457:           sessionId: state.sessionId,
469:       request: Omit<ExtractionAttestUnitsRequest, 'sessionId' | 'baseEditSeq'>,
475:       if (state.sessionId === null) { setNotice(NO_WRITABLE_SESSION_NOTICE); return null }
479:           sessionId: state.sessionId,
491:       request: Omit<ExtractionRevokeUnitsRequest, 'sessionId' | 'baseEditSeq'>,
497:       if (state.sessionId === null) { setNotice(NO_WRITABLE_SESSION_NOTICE); return null }
501:           sessionId: state.sessionId,
515:         sessionId: target.sessionId,
534:       expectedActiveRequirementRevisionId: string | null
535:       requirementId: string | null
545:         sessionId: target.sessionId,
555:           notice: `已确认条款版本 ${result.value.requirementRevisionId}（基线检查：${result.value.baselineCheck.status}）。`,
559:         setNotice(`任务书要求已保存为条款版本 ${result.value.requirementRevisionId}。`)
571:         sessionId: target.sessionId,
588:         sessionId: target.sessionId,
591:         previewId: shown.previewId,
593:         requestId: requestId(),
603:           notice: `已提交新版本 ${result.value.revisionId}（一次写入参数/图纸/链/事件/快照/版本）。`,
616:     bindParameter: async (termId: string, partId: string, parameterId: string, replaceBindingId?: string) => {
620:         sessionId: target.sessionId,
622:         termId,
623:         partId,
624:         parameterId,
625:         ...(replaceBindingId === undefined ? {} : { replaceBindingId }),
632:     unbindParameter: async (bindingId: string) => {
636:         sessionId: target.sessionId,
638:         bindingId,
645:     compareDrawings: async (leftRevisionId?: string) => {
650:         sessionId: target.sessionId,
651:         ...(leftRevisionId === undefined ? {} : { leftRevisionId }),
658:     restoreRevisionDraft: async (sourceRevisionId: string) => {
676:           sessionId: target.sessionId,
693:         sessionId: target.sessionId,
695:         sourceRevisionId,
696:         reason: `从版本 ${sourceRevisionId} 恢复`,
```

### src/workspace/useImportedModel.ts

```text
8:  * - 相机位姿属于具体几何版本：view 只在 revisionId 相同时有效，替换模型后自动失效，
23:   replacePartId: string | null
24:   expectedCurrentModelRevisionId: string | null
36:   linkId?: string
37:   termId: string
38:   target: { granularity: 'model' | 'part'; partId: string; modelRevisionId: string | null }
42:   sessionId: string | null
54:   partId: string | null
55:   revisionId: string | null
68:     termId: string
70:     partId: string
71:     modelRevisionId: string | null
74:     linkId: string
75:     termId: string
76:     partId: string
77:     modelRevisionId: string | null
83:   revisionId: string,
88:     revisionId,
99:   const { sessionId, acceptedSeq, snapshot, apply } = options
107:   const [viewState, setViewState] = useState<{ revisionId: string; view: DemoViewState } | null>(null)
108:   const sessionRef = useRef<string | null>(sessionId)
110:   const part = snapshot?.project.parts.find((item) => item.currentModelRevisionId !== null) ?? null
111:   const partId = part?.partId ?? null
112:   const revisionId = part?.currentModelRevisionId ?? null
113:   const currentModelRevisionId = part?.currentModelRevisionId ?? null
114:   const geometryRevisionId = geometry?.revisionId ?? null
116:   const view = viewState !== null && viewState.revisionId === geometryRevisionId ? viewState.view : null
120:     if (sessionRef.current === sessionId) return
121:     sessionRef.current = sessionId
127:   }, [sessionId])
131:     if (sessionId === null || revisionId === null) {
136:     if (geometry?.revisionId === revisionId) return
143:         sessionId,
144:         ref: { kind: 'revision', modelRevisionId: revisionId },
159:       setGeometry(geometryFrom(revisionId, read.value.fileName, parsed.value))
170:     // geometry.revisionId 只用于避免重复读取；不把整个 geometry 作为依赖。
172:   }, [sessionId, revisionId])
179:       if (geometryRevisionId === null) return
180:       setViewState({ revisionId: geometryRevisionId, view: next })
182:     [geometryRevisionId],
188:       if (!api || sessionId === null) return
189:       await api.releaseModel({ sessionId, candidateToken: token })
191:     [sessionId],
197:       if (!api || sessionId === null) return
204:           sessionId,
206:           ...(replace && part !== null ? { replacePartId: part.partId } : {}),
213:           sessionId,
231:           replacePartId: replace && part !== null ? part.partId : null,
232:           expectedCurrentModelRevisionId: replace && part !== null ? part.currentModelRevisionId : null,
244:     [acceptedSeq, part, release, sessionId],
250:       if (!api || sessionId === null || pending === null) return
255:           sessionId,
258:           expectedCurrentModelRevisionId: pending.expectedCurrentModelRevisionId,
274:         setGeometry(geometryFrom(committed.value.modelRevisionId, pending.fileName, pending.geometry))
281:     [acceptedSeq, apply, pending, release, sessionId],
293:       if (!api || sessionId === null) return false
299:           sessionId,
301:           expectedCurrentModelRevisionId: currentModelRevisionId ?? null,
319:     [acceptedSeq, apply, currentModelRevisionId, sessionId],
323:     async (input: { termId: string; granularity: 'model' | 'part'; partId: string; modelRevisionId: string | null }) =>
326:         termId: input.termId,
329:           partId: input.partId,
330:           modelRevisionId: input.modelRevisionId,
338:       linkId: string
339:       termId: string
340:       partId: string
341:       modelRevisionId: string | null
345:         linkId: input.linkId,
346:         termId: input.termId,
349:           partId: input.partId,
350:           modelRevisionId: input.modelRevisionId,
357:     partId,
358:     revisionId,
```

### src/workspace/usePersistedWorkspace.ts

```text
36:   projectId: string,
76:  * 1. 指定 projectId 时只打开该项目；未指定时读取本地项目，没有项目时创建一个
86: export function useWorkspaceBootstrap(projectId?: string): WorkspaceBootstrap {
101:       if (projectId !== undefined) {
102:         const loaded = await getProject(projectId)
115:               message: `项目不存在：${projectId}`,
147:       const storedDraft = await getDraft(project.id)
188:   }, [reloadToken, projectId])
335:         result = await updateProject(project.id, {
353:     [project.id],
394:         result = await (saveRef.current ?? persistDraft)(project.id, draftToSave)
417:     [persistRelationState, project.id],
467:   }, [draft, project.id, debounceMs, persistDraftWithState])
484:     const result = await updateProject(project.id, {
495:   }, [chain, project.id])
521:       result = await (saveRef.current ?? persistDraft)(project.id, restoredDraft)
533:   }, [baseline, dispatch, draft.relationRevision, persistRelationState, project.id, relationState.relationRevision])
546:     const sources = await loadProjectSources(project.id)
558:     project.id,
```


扫描统计：生产运行代码文件 294；基线标识引用 6713 行；用户文本/诊断候选 512 行。统计不是泄漏数。
