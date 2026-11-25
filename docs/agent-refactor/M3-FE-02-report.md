# M3-FE-02 交付报告：A01–A12 前端验收走查套件、错误焦点无障碍与工作台入口收口

- **工作目录**：`/Users/aston/DSH/wt/dsh-agent-refactor-m0`（分支 `agent/dsh-agent-refactor-m0`）
- **参考依据**：`寸链_机械制图Agent重构开发文档.md` 第一部分 §3 末段、§4 与第二部分 §5 A01–A12
- **冻结边界核查**：`desktop/shared/contracts.ts`、`desktop/preload`、`desktop/main` 保持 **0 改动**；主流程 **0 个**手动参数表、尺寸滑块或坐标编辑器

---

## 1. 修改/新增文件清单（共 11 个文件：修改 6 个，新增 5 个）

### 修改文件（6 个）
1. `src/App.tsx`：导出 `resolveDesktopHashRoute(hash, options?)` 纯函数，支持 `defaultDesktopRoute?: 'legacy' | 'm1-workbench'` 与 `#/desktop-legacy` 回切路由，默认维持 `'legacy'` 零侵入兼容既有测试，同时以 `rawHash` 状态保证桌面路由切换即时响应。
2. `src/workspace/project-agent/ProjectAgentM1Workbench.tsx`：接入断线（`重连`）、图纸生成失败（`重试图纸`）、模型 API 鉴权/工具往返失败（`测试连接`）、聊天运行失败（`重试`）4 类错误焦点自动恢复；向 `M3CompletionView` 传递 `canUndoBlockedDraft`；在顶部栏提供「返回旧工作台」（`#/desktop-legacy`）入口链接。
3. `src/workspace/project-agent/M2CenterCanvas.tsx`：导出 `getArtifactStatusMeta`，为模型与图纸的就绪、草稿、生成中、失败（含旧图保留）与空状态统一提供图形标识 + 中文文字 + 语义色；窄屏标签页降级栏及标签按钮同步展示两者状态；为「重试图纸」按钮透传 `retryDrawingButtonRef`。
4. `src/workspace/project-agent/M2SidebarPanels.tsx`：检查面板顶部统计徽章与待澄清提示补全图形 + 文字标识（`✓ 通过`、`✕ 失败`、`? 待澄清`）。
5. `src/workspace/project-agent/M3CompletionView.tsx`：支持 `canUndoBlockedDraft` 属性；当必需检查阻塞时自动将焦点落到「撤销本次被阻塞修改」按钮，不可撤销时自动回落到首个阻塞条款的「定位来源与特征」按钮；产物状态补全草稿图形标识（`✎ 草稿`）。
6. `src/workspace/project-agent/ProjectAgentPanel.css`：补全 `.pa-link-btn`、`.pa-option-card`、`.pa-canvas-chip`、`.pa-check-trigger` 与 `.pa-svg-annotation` 的 `:focus-visible` 焦点环样式，消除键盘聚焦视觉死角。

### 新增文件（5 个）
1. `src/workspace/project-agent/focusRecovery.ts`：错误焦点恢复工具模块（`isEditableFocusTarget`、`focusRecoveryElement`），在用户位于 `INPUT` / `TEXTAREA` / `SELECT` / `contentEditable` 时拒绝抢占焦点，并跳过禁用按钮。
2. `src/App.desktop-route.test.tsx`（5 条用例）：`resolveDesktopHashRoute` 纯函数及 `<App />` 新旧工作台入口衔接与零回归单测。
3. `src/workspace/project-agent/ProjectAgentAccessibility.test.tsx`（10 条用例）：5 类错误/阻塞焦点自动落点、输入控件防抢焦、6 种检查状态与 5 种产物状态图形+文字标识、窄屏降级双状态保留与键盘 `F6` / `Shift+F6` / `Alt+1..3` / 方向键全区切换单测。
4. `src/workspace/project-agent/ProjectAgentAcceptanceWalkthrough.test.tsx`（8 条全链路用例）：覆盖 A01–A12 及第一部分 §4 双入口（外置本地 Agent + 内置模型 API）合成 `M2-BE-01` 安装板真实网格与 2D SVG 矢量图纸验收走查套件。
5. `docs/agent-refactor/M3-FE-02-report.md`：本交付报告。

---

## 2. 核心实现摘要

### 2.1 错误后焦点自动落点与防抢焦（第一部分 §3 末段）
- 抽离 `focusRecovery.ts`：`isEditableFocusTarget` 识别 `INPUT`、`TEXTAREA`、`SELECT` 及 `contentEditable`（同时校验 `isContentEditable` 与 `contenteditable` 属性以兼容 jsdom）；`focusRecoveryElement` 在当前焦点处于输入控件或目标按钮禁用时不抢焦。
- 5 类错误/阻塞态恢复落点：
  - 断线（`showDisconnectBanner`）→「重连」按钮；
  - 图纸生成失败 / 重试图纸再次失败 →「重试图纸」按钮；
  - 模型 API 鉴权/工具往返失败 →「测试连接」按钮；
  - 内置对话运行失败 →「重试」按钮；
  - 完成视图必需检查阻塞 → 可撤销时落到「撤销本次被阻塞修改」，不可撤销（`canUndo: false`）时落到首个阻塞条款「定位来源与特征」。

### 2.2 图形 + 文字状态标识、窄屏降级与键盘无死角
- 全部 6 种检查状态（`✓ 通过`、`✕ 失败`、`? 待澄清`、`○ 未覆盖`、`! 执行失败`、`◌ 检查中`）与 5 种产物状态（`✓ 就绪`、`✎ 草稿`、`◌ 生成中`、`✕ 失败`、`○ 未生成`）均同时呈现图形符号与中文文字，不单靠颜色区分。
- 窄屏降级下，`模型` / `图纸` 标签保留精确可访问名称与状态属性，并在 `窄屏标签页降级状态` 栏按实际语义色展示模型与图纸的就绪/草稿/失败（含保留旧图版本）状态。
- 键盘 `F6` / `Shift+F6` 与 `Alt+1..3` 在对象列表、中央画布、主工作台侧栏间闭环切换，对象列表支持 `ArrowDown` / `ArrowUp` / `Home` / `End`，所有交互元素均配置 `:focus-visible` 轮廓。

### 2.3 主工作台与旧工作台非侵入路由衔接
- `src/App.tsx` 导出 `resolveDesktopHashRoute(hash, options?)`：默认 `defaultDesktopRoute: 'legacy'`，保持 `#/desktop`（旧版默认）、`#/desktop-m0-preview`、`#/desktop-m1-readonly`、`#/desktop-m1-workbench` 全兼容；新增 `#/desktop-legacy` 回切旧版路由并在新工作台顶部栏提供「返回旧工作台」链接，支持后续合流时一步将新工作台设为默认入口。

---

## 3. A01–A12 前端验收走查逐条覆盖摘要

| 编号 | 验收场景 | 对应测试用例（`ProjectAgentAcceptanceWalkthrough.test.tsx`） | 结果 |
|---|---|---|---|
| **A01** | 文档建模（外置本地 Agent + 内置模型 API 双入口从空项目生成 80×50×8 mm 安装板与双 Ø10 孔，0 手填参数、0 导出再导入） | `A01 + A02（双入口空项目建模与初始边距）` | 通过 |
| **A02** | 初始边距（右孔至右端面名义 15 mm，范围 `[14.75, 15.25] mm`） | `A01 + A02（双入口空项目建模与初始边距）` | 通过 |
| **A03** | 选孔改图（3D 拾取右孔 → 双向高亮 SVG 标注 → 对话发送“向右移 1 mm” → 刷新至 X=61 / 14.0 mm 并保留 3D 视角与 2D 平移/缩放） | `A03 + A04（选右孔右移 1 mm 保留视角与缩放…）` | 通过 |
| **A04** | 阻塞与恢复（X=62 触发 `[12.75, 13.25] mm` 阻塞 → 禁用正式保存、焦点落到撤销、`locateM2Evidence` 定位条款与右孔 → 撤销恢复通过且正式版保持 `v1`） | `A03 + A04（选右孔右移 1 mm 保留视角与缩放…）` | 通过 |
| **A05** | 三维变化（参考盖板与安装板法向间隙 2 mm / `[1.7, 2.3] mm`，初始与绕世界 X 轴旋转 90° 一致） | `A05 + A06（三维变化旋转 90° 与固定姿态接触/重叠检查…）` | 通过 |
| **A06** | 姿态与干涉（Z=8 接触与 Z=7.9 重叠深度 0.1 mm 分开报告；非前台项目外部修改无打断通知） | `A05 + A06（三维变化旋转 90° 与固定姿态接触/重叠检查…）` | 通过 |
| **A07** | 不完整任务（缺项/冲突/未覆盖分别提示并支持澄清提交）+ 断线保留结果、焦点落到「重连」、接管推进代际拒绝旧包 | `A07（缺项/冲突/未覆盖任务澄清 + 断线保留结果…）` | 通过 |
| **A08** | 乱序与失败（快模型 `draft-8` + 迟到 `draft-6` + 图纸失败明确标明旧图 `draft-7`、焦点落到「重试图纸」、重试后同版并排且不污染水位） | `A08（慢图纸、快模型、乱序与图纸失败…）` | 通过 |
| **A09** | 权限与恢复（关闭重开恢复正式版、草稿、图纸、检查与本地 Agent 连接方式） | `A09 + A10（关闭重开恢复版本/图纸/检查/连接方式…）` | 通过 |
| **A10** | 历史兼容（旧 `.cunlian` 隔套项目迁移差异抽屉，原件保留，12.00/12.04/12.10/12.05 通过/通过/失败/边界通过） | `A09 + A10（关闭重开恢复版本/图纸/检查/连接方式…）` | 通过 |
| **A11** | 完成触发（生成中说“完成”展示实时进度不绕过确认，就绪后经绑定一次性确认调用 `commitM3ApprovedDraft` 提交 `v2`） | `A11（生成中触发“完成”展示实时进度…）` | 通过 |
| **A12** | 引用失效（删孔新建同径孔不同 `objectId` 触发选中对象失效提示，不静默改绑） | `A12（删孔新建同径孔不同 objectId 触发选中对象失效提示…）` | 通过 |

---

## 4. 全量验收命令执行结果与冻结边界核查

| 校验项 | 命令 | 结果 |
|---|---|---|
| 新增专项测试 | `npx vitest run src/App.desktop-route.test.tsx src/workspace/project-agent/ProjectAgentAccessibility.test.tsx src/workspace/project-agent/ProjectAgentAcceptanceWalkthrough.test.tsx` | **3 passed (3), 23 passed (23)** |
| ESLint | `npm run lint` | **通过（0 errors, 0 warnings）** |
| 前端/Node/MCP 类型检查 | `npm run typecheck` | **通过（0 errors）** |
| Desktop 类型检查 | `npm run typecheck:desktop` | **通过（0 errors）** |
| 全量单元测试 | `npm test` | **153 passed (153) 测试文件，1583 passed (1583) 用例**（含全部 1560 条既有单测 + 23 条新增单测） |
| 生产构建 | `npm run build` | **通过（`dist/` 产物构建成功）** |
| 冻结边界核查 | `git diff --stat -- desktop/shared/contracts.ts desktop/preload desktop/main` | **空（0 改动）** |

---

## 5. 遗留问题与风险说明

- 无阻塞性遗留问题。
- 后续端到端合流（关闭 F01）时，只需将 `src/App.tsx` 中 `resolveDesktopHashRoute` 的 `defaultDesktopRoute` 从 `'legacy'` 切换为 `'m1-workbench'`，即可将新工作台设为默认入口并保留 `#/desktop-legacy` 回切旧版通道。
- 本套件中的双入口验收在 jsdom 下使用贴近 `M2-BE-01` 真实结构的合成夹具完成确定性回归；真实打包环境（macOS Electron + 真实 Open CASCADE 内核与外部 MCP 客户端）的录屏走查将在合流联调阶段执行。
