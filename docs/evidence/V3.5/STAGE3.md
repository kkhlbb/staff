# V3.5 第 3 阶段：三处实测缺陷修复 + 第 4 项来源基准核实

状态：**代码、测试、打包应用截图与证据已完成；未推送、未合并、未删除任何分支/工作树。**
本阶段只改任务范围内的 UI/派生状态与测试；未改 `src/domain` 公式、q 精度、schema 7，
未改 A/B1/B2/C/D 与 V3.5 第 1/2 阶段已通过判据，未动 `docs/evidence/V3-D/`。

- 仓库：`/Users/aston/DSH/staff`
- 分支：`main`（按用户指令：不自开分支、不建工作树）
- 基线 HEAD：`2f4a6c0393871ae1ff9bd40e4aec1131d155217e`（工作区干净）
- 代码/测试提交：`6135615`（本文档与截图等证据在后续证据提交中）
- 最终 HEAD / 证据提交：见交付消息的 `git log -2 --oneline`

## 1. 三处缺陷的修复

### 1.1 二维图纸随合法草稿自动刷新

- 数据来源：`useDesktopSession.autoPreviewChange` 成功后，main 返回的
  `ChangePreviewValue.drawing.right` 就是按候选参数重建的 `DrawingData`。
- 修改：`src/pages/DesktopWorkspace.tsx` 把该候选图传给 `SpacerDrawingPanel`
  （`draftPreview.drawing`），并把项目树 “工程图” 组、右侧属性从正式图切到候选图；
  `src/components/SpacerDrawingPanel.tsx` 画布改用候选图，同时明确标
  「候选参数预览（未提交）」与「候选草稿 · 未提交」。
- 边界：
  - 正式图纸记录、图框/比例表单、**导出**仍只读 `project`；候选显示期间导出按钮禁用，
    避免“看到 12.04 却导出 12.00”。
  - 非法输入时 `preview` 保留上一次有效候选，画布继续显示上次有效画面，并显示
    「输入待修正，当前检查未完成」。
  - 候选刷新不重建 `ThreeViewport`：3D 隔套网格走 `setSpacerDimensions`，同一场景句柄，
    相机/选择/爆炸状态不重置；2D 画布缩放也保持。
- 打包应用实测（`node desktop/tests/e2e/v35fixes.mjs`，真实 `.app` + CDP）：
  - 12.00：`[data-annotation-id="ann.length"]` 文本为 `12.00`；
  - 12.04（自动预览，未点“预览变更”）：同一处文本为 `12.04`，项目树为 `长度 · 12.04`，
    属性为 `q = 120400 · 输入 2 位小数`，候选区间 `0.1100 ～ 0.2100`。
- 截图（左视图长度标注与图形，4 倍细节裁剪）：
  - `screenshots/v35fix-02b-drawing-1200-detail.png`（12.00）
  - `screenshots/v35fix-03b-drawing-1204-detail.png`（12.04，标题栏版本也随候选变为 `rev-d-…`）
  - 整张画布：`v35fix-02-drawing-1200.png`、`v35fix-03-drawing-1204.png`
  - 3D 候选：`v35fix-06-3d-candidate-1210.png`（3D 就绪，属性 q=121000）

### 1.2 条款不满足 / 待确认时「确认提交」禁用

- 修改：`src/components/ChangeWorkbench.tsx` 的确认按钮在原有
  `busy / 未预览 / 预览过期` 之外，增加 `requirementBlocker !== null`
  （条款检查不是 `satisfied`）。
- 原因文字仍在 `#change-workbench-confirm-reason` 中完整显示（不是只放 `title`）：
  `条款检查为「不满足要求」：…；正式版本保持在上一次提交。`
- main 侧门禁未删除、未放宽：`src/requirements/commit.ts`
  `desktop/main/changeService.ts` 的重算/条款校验保持原样；按钮禁用只是 UI。
- 打包应用实测（12.10）：按钮 `disabled=true`，可见原因含「不满足要求」「下界越界」，
  二维标注为 `12.10`，条款状态为「不满足要求」。
- 截图：`screenshots/v35fix-04-confirm-disabled.png`（局部）、
  `v35fix-05-confirm-disabled-full.png`（全窗）。

### 1.3 顶栏批次标签

- `src/pages/DesktopWorkspace.tsx` 两处 `V3 · D 批次` → `V3.5 · Beta`
  （启动页、工作台各一处）。
- 新增用例断言两处文本，并断言不再出现旧标签。
- 截图：`screenshots/v35fix-00-workspace.png`（右上角 `V3.5 · Beta`）。

## 2. 第 4 项疑点：条款确认后的“来源基准与确认时不一致”

结论：**属于过度失效，已修；参数绑定不应因新增任务书 PDF / 确认条款而失效。**

### 2.1 证据链

1. 真实种子项目 `P35-imported.cunlian` 的事件顺序（`logs/p35-seed-events.txt`）：
   1. `source_import`（尺寸链来源 PDF）
   2. `parameter_binding_confirmed`（`sourceBasis=741c9d2df253…`）
   3. `source_import`（任务书 PDF）
   4. `requirement_confirmed`
   即：绑定确认发生在任务书导入之前。旧实现把“所有文档/版本/blob”都算进
   `sourceBasis`，第 3 步一发生，第 2 步的凭据必然失配。
2. 旧实现在打包应用/派生状态中的表现，已由变异 MUT-B35-4 复现（见 2.4）：
   绑定行从 `已确认生效` 变为 `待核：来源基准与确认时不一致`。
3. 修复后在**打包应用**打开同一项目：绑定行显示
   `S ← 长度（param q=120000，环 q=120000）已确认生效`，无「来源基准」待核。
   截图：`screenshots/v35fix-01b-binding-detail.png`。

### 2.2 sourceBasis 应该包含什么

参数绑定确认凭据要证明的是：**这次人工核对时，参数值、组成环、图纸与该参数相关来源
证据**没有变化。因此 `src/revisions/digest.ts` 的 `sourceInput` 现在只纳入：

- `snapshot.bindings`（尺寸链来源绑定）本身；
- 这些绑定实际引用的 document / revision / blob；
- 这些绑定 blob 的“声明缺失”状态；
- 参数 `sourceNote`（`sourceBasisOf` 拼接）。

不再纳入项目中所有文档。任务书 PDF 的归属由 `RequirementRevision.source`
（documentId/revisionId/sha256/blobKey/page/rect）冻结，并已进入
`computeBaseDigest` 的 `requirement` 分组；它不是参数 binding 的来源证据。

保留的失效能力（新增用例覆盖）：
- 已绑定来源 revision 的 sha256 变化 → `sourceBasis` 变化 → 仍判「待核」；
- 参数 sourceNote 变化 → 仍判「待核」（D 原用例继续通过）。

### 2.3 规格依据

- 任务卡 §4：「已确认有效绑定下单纯长度变化只使预览过期并重算候选，**不自动把条款
  降为待确认**」；同理，与参数绑定无关的任务书附件也不应把绑定降为待核。
- 任务卡 §2.1：`bindingBasis` 冻结参数/环/绑定身份，**不把所有数值冻结为永久有效条件**。
- 任务卡 §5：`computeBaseDigest` 的“来源可用性”仍覆盖全部来源，因此导入/换版任务书
  仍会让旧**预览**失效（这是正确行为）；但它不等于参数绑定确认凭据失效。
- `docs/evidence/V3-D/derived-status.md`：`sourceBasis` 是“来源清单稳定指纹 + 参数
  sourceNote”。本次把“来源清单”限定为**该链实际绑定并核对过的来源**，没有关闭检查。

### 2.4 变异证据（MUT-B35-4）

- 变异：把 `sourceInput` 恢复为旧的“全项目文档/版本/blob”版本。
- patch：`mutations/MUT-B35-4.patch`
- 红：`mutations/MUT-B35-4.red.log`，`EXIT_CODE:1`，
  `AssertionError: expected 'pending' to be 'valid'`。
- 恢复绿：`mutations/MUT-B35-4.green.log`，`EXIT_CODE:0`，1 passed。
- 变异只作用于 `src/revisions/digest.ts`，跑完即 `git checkout --` 恢复；未留在交付代码中。

## 3. 命令与实际结果

原始日志在 `logs/`（`*.log` 被 .gitignore 忽略，提交时 `git add -f` 纳入）。

| 命令 | 退出码 | 实际结果 | 日志 |
|---|---|---|---|
| `npm run typecheck` | 0 | app + node 两套 tsc 通过 | `logs/typecheck-stage3.log` |
| `npm run typecheck:desktop` | 0 | desktop tsc 通过 | `logs/typecheck-desktop-stage3.log` |
| `npm run lint` | 0 | eslint 全仓通过 | `logs/lint-stage3.log` |
| `npm test` | 0 | **81 文件 / 844 用例全过**（基线 839 + 新增 5） | `logs/test-stage3.log` |
| `npm run test:desktop` | 0 | **26 文件 / 178 用例全过** | `logs/test-desktop-stage3.log` |
| `npm run build` | 0 | vite 生产构建通过（既有 chunk 体积警告） | `logs/build-stage3.log` |
| `npm run package:desktop` | 0 | `out/寸链-darwin-arm64/寸链.app`（arm64，未签名） | `logs/package-stage3.log` |
| `node desktop/tests/e2e/v35fixes.mjs` | 0 | `RESULT ALL_PASS`，真实 .app 内三处缺陷逐项 PASS | `logs/e2e-v35fixes.log` |

测试不写仓库文件：跑完 `npm test` / `npm run test:desktop` 后 `git status --short` 为空
（最终交付消息附原始输出）。

## 4. 新增/修改用例

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `src/pages/DesktopWorkspace.test.tsx` | 合法草稿自动预览后工程图/标注/属性按候选参数重画；非法输入保留上次画面并标注 | 缺陷 1：12.04 画布/树/属性、3D `setSpacerDimensions`、非法输入保留 |
| `src/pages/DesktopWorkspace.test.tsx` | 条款检查为不满足时确认提交按钮 disabled，原因文字仍可见 | 缺陷 2：disabled + 可见原因 + 不调用 apply；项目预置未绑定的任务书 PDF，同时验证绑定仍「已确认生效」 |
| `src/pages/DesktopWorkspace.test.tsx` | 顶栏批次标签在启动页与工作台两处都是 V3.5 · Beta | 缺陷 3 |
| `src/requirements/confirm.test.ts` | 新增并确认任务书 PDF 后，未改动的参数绑定仍为已确认生效 | 第 4 项：真实条款确认路径 |
| `src/requirements/confirm.test.ts` | 已绑定来源本身变化时仍然失效（不是把凭据检查关掉） | 第 4 项：保留应有失效 |
| `desktop/tests/e2e/v35fixes.mjs` | 打包应用逐项检查（非测试套件，手动证据脚本） | 三处 UI + 绑定行 |

## 5. 未做 / 已知边界（不记作通过）

1. 未重跑第 10 节 B35-01～09 的全部打包验收；本阶段只针对用户实测的三处缺陷与第 4 项
   做定点验证，外加既有 844/178 回归。
2. 打包截图使用 CDP `Emulation.setDeviceMetricsOverride` 1600×1400 视口，便于同时看到
   工程图画布与参数联动；没有改变应用数据。
3. 3D 隔套长度在打包截图中只能看到“3D 就绪 + 属性候选 q=121000”，没有做像素级长度测量；
   同源更新由渲染层用例断言 `setSpacerDimensions({length:12.04,…})`，且场景句柄未重建。
4. 候选显示期间导出按钮禁用是本次的防误用选择；未新增“导出候选图”功能。
5. 未验证原生“选择 PDF”文件对话框（本阶段不需要重新导入 PDF）。
6. 未推送、未合并、未删除；远端状态未验证。
