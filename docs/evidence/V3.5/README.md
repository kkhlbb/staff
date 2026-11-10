# V3.5 Beta 第 2 阶段交付证据（桌面接入 + 变异补证据）

状态：**实现与本地自测完成；打包应用内导入资料/绑定条款/定位原文/自动预览已实际截图。未推送、未合并、未删除任何分支。**

- 仓库：`/Users/aston/DSH/staff`
- 分支：`main`（按用户指令：不自开分支、不建工作树）
- 基线 HEAD：`c92b50ef49931641110a5e78660d49fc9f90576a`（第 1 阶段已验收，工作区干净）
- 本阶段提交：见交付消息或 `git log -1 --oneline`（本 README 与该提交同属一次提交）

## 1. 本阶段实现范围

1. **桌面 PDF 导入/换版（main）**：`source:import` 通道；主进程读取本地字节、自算 SHA-256、
   解析页数与每页 `pageBoxPdf`、写入不可变 `SourceRevision` + 独立 blob/附件；
   失败路径不修改会话快照。未调用依赖 IndexedDB 的浏览器写函数。
2. **条款绑定向导**：复核区「绑定任务书要求」→ 选确切版本 → 页码 → 框选
   （rectPdf + pageBoxPdf）→ 粘贴原文 → 上下限（mm/q）→ 当前唯一链 → 双范围对比 →
   显式确认 → `RequirementRevision` + 基线检查，走 `commitCandidate/saveAtomic` 原子写盘。
3. **定位原文**：按条款冻结的 revisionId/page/rect 打开**同一版本** PDF 并高亮；
   换版后旧条款仍指向旧版本。
4. **自动刷新**：合法输入 400ms 防抖自动 stage+preview；请求序号 + 串行队列，
   迟到响应不覆盖新草稿；非法输入保留上次有效几何但清除通过资格并标
   「输入待修正，当前检查未完成」。
5. **复核区**：尺寸变化/计算区间/要求区间/两侧裕量/四态判定/定位入口/需核对新版；
   原项目目标与任务书要求双标签并列。
6. **提交接入**：沿用第 1 阶段 `commitRecomputedChange` 重算门禁；
   unsatisfied/pending/unchecked 拒绝推进正式版本，草稿保留。
7. 新增 IPC 后同提交补齐 `src/pages/DesktopWorkspace.test.tsx` 的 `CunlianApi` mock。

未改：`src/domain` 公式与 q 精度、A/B1/B2/C/D 与第 1 阶段判据、`docs/evidence/V3-D/`、
`npm run evidence:record` 的指向。

## 2. 命令与实际结果

原始日志见 `logs/`（`*.log` 被仓库忽略，提交时以 `git add -f` 纳入）。

| 命令 | 退出码 | 实际结果 | 日志 |
|---|---|---|---|
| `npm run typecheck` | 0 | app + node 两套 tsc 通过 | `logs/typecheck.log` |
| `npm run typecheck:desktop` | 0 | desktop tsc 通过 | `logs/typecheck-desktop.log` |
| `npm run lint` | 0 | eslint 全仓通过 | `logs/lint.log` |
| `npm test` | 0 | **81 文件 / 839 用例全过** | `logs/test.log` |
| `npm run test:desktop` | 0 | **26 文件 / 178 用例全过**（证据生成器不属于该套件） | `logs/test-desktop.log` |
| `npm run build` | 0 | vite 生产构建通过（既有 chunk 体积警告） | `logs/build.log` |
| `npm run package:desktop` | 0 | `out/寸链-darwin-arm64/寸链.app`（arm64，未签名） | `logs/package-desktop.log` |
| `node desktop/tests/e2e/v35ui.mjs` | 0 | 打包应用内打开含 PDF 的项目→向导框选→确认条款→定位→自动预览，截图见 `screenshots/` | `logs/e2e-v35ui.log` |

数值仍为：S=12.00→1500/2500，12.04→1100/2100，12.10→500/1500（不满足），
12.05→1000/2000（下边界相等仍满足）；由第 1 阶段单测继续覆盖，本阶段未改公式。

## 3. 变异实验（红 → 恢复 → 绿）

全部在 `main` 工作树上临时注入单一错误，跑完即 `git checkout --` 恢复；patch 为
`git diff` 原始输出，日志含真实命令与 `EXIT_CODE`。

| ID | 变异 | patch | 红日志（退出码 1） | 恢复绿（退出码 0） |
|---|---|---|---|---|
| MUT-B35-1 | 提交复用预览计算与预览检查、不重算（`src/requirements/commit.ts`） | `mutations/MUT-B35-1.patch` | `mutations/MUT-B35-1.red.log`：6 failed（伪造满足、草稿数值已变、previewComputation 受控差异、spy 未调用等） | `mutations/MUT-B35-1.green.log`：11 passed |
| MUT-B35-2 | 条款失效后仍出满足（`src/requirements/check.ts` 跳过来源换版/不可读检查） | `mutations/MUT-B35-2.patch` | `mutations/MUT-B35-2.red.log`：2 failed（PDF 换版、PDF 不可读） | `mutations/MUT-B35-2.green.log`：21 passed |
| MUT-B35-3 | 条款区间与 target 混用（判定改读 `chain.target`） | `mutations/MUT-B35-3.patch` | `mutations/MUT-B35-3.red.log`：2 failed，含 B35-07 P35-T 双向独立 | `mutations/MUT-B35-3.green.log`：21 passed |

这三条是第 1 阶段欠账（MUT-B35-1/2 当时只在会话里）加上本阶段新增 MUT-B35-3；
现在 patch 与红/绿日志都归档在仓库。

## 4. 合成任务书与项目夹具

- `fixtures/taskbook-2p.pdf` — 两页 A4 合成任务书，241,323 字节，
  SHA-256 `fec9afafcb044d550422bda68841383543aa99e68b8ba208797dd525082145e9`；
  第 2 页含“轴向装配间隙 C 应为 0.1000～0.3000 mm，含两端”。
  由 `scripts/make-taskbook-pdf.cjs`（Electron/Chromium `printToPDF`）生成；
  `pdfjs` 实测页数 2、page.view `[0,0,594.96,841.92]`，文本可抽取。
- `fixtures/P35-imported-seed.cunlian` — 通过真实 `source:import` 通道把上述 PDF
  写入 P35-A（S=12.00、已确认参数绑定）的项目文件，249,801 字节，
  SHA-256 `50f74124e2b2ef396d1df615e57e69452fdd98d591ff54466a0d1d2c2cd91ef2`。
  生成命令（显式证据脚本，不属于常规测试套件）：
  `V35_SEED_OUT=<out> npx vitest run --config vitest.v35fixture.config.ts`（`scripts/v35-seed.ts`）

## 5. 打包应用截图（`screenshots/`）

均来自 `out/寸链-darwin-arm64/寸链.app`（Electron 45.2.3 / arm64），通过 CDP 操作并
`Page.captureScreenshot` 取图；不是 dev server 或浏览器。

| 文件 | 内容 |
|---|---|
| `v35-00-workspace.png` | 打包应用打开含任务书附件的 P35-A 工作台 |
| `v35-01-import.png` | 「来源 PDF」页显示已导入的 taskbook-2p.pdf（sr-…，SHA-256 fec9af…，2 页）并渲染第 1 页 |
| `v35-02-wizard.png` | 「绑定任务书要求」向导：确切版本、第 2 页、黄色框选区域、原文、上下限 |
| `v35-02b-wizard-compare.png` | 向导下部：原项目目标 / 任务书要求 / 范围差异、当前链、显式确认勾选 |
| `v35-03-confirmed-review.png` | 确认后复核区：条款版本 reqrev-…、来源第 2 页、冻结基线检查「满足」 |
| `v35-04-locate.png` | 「定位任务书」：打开同一 revision 第 2 页并高亮保存的选区（PDF 坐标） |
| `v35-05-auto-preview.png` | 改 S=12.04 后自动预览（未点预览按钮），计算 0.1100～0.2100 mm |
| `v35-06-requirement-panel.png` | 条款面板：原目标/任务书要求双标签、候选区间、两侧裕量 +100q/+900q、原因码 |

实际确认结果（e2e 日志）：`lowerQ=1000, upperQ=3000, page=2, pageBoxPdf=[0,0,594.96,841.92]`,
基线检查 `satisfied`，写入项目文件后 `activeRequirementRevisionId` 为新的 `reqrev-…`。

## 6. 未完成 / 已知边界（不记作通过）

1. **系统“选择 PDF”原生对话框的点击未自动化**：本会话没有 WindowServer/屏幕录制权限，
   `screencapture` 报 “could not create image from display”，System Events 也看不到应用窗口；
   因此无法在打包应用里点击原生打开/保存对话框。证据做法是：用**同一个 main
   `source:import` 通道**在 Node harness 中导入 PDF 并生成项目文件，再由打包应用通过
   `open-file` 打开；向导框选、确认、定位、自动预览均在打包应用内真实点击完成。
   `导入资料` 按钮已在应用中启用，IPC/schema/失败零写入由
   `desktop/tests/sourceImport.test.ts` 覆盖；**“在 GUI 对话框里选文件”这一步未验证**。
2. `package:desktop` 产物未签名、未公证，未做分发；未做 `make:desktop`。
3. 第 10 节 B35-01～09 的完整验收（含断网重开、12.10 提交拦截的打包 UI 点击）未在本阶段全跑；
   本阶段只完成第 2 阶段范围与上述 UI 证据。
4. 条款更新（第二版本）目前由 `requirementFlow.test.ts` 的 main 服务用例覆盖；
   打包 UI 未点击“更新条款 → 新版本”按钮。
5. 未推送、未合并、未删除；远端状态未验证。
6. 越界/待确认/未检查被拒绝后，main 内存草稿与 UI token 保留，可在同一会话继续修正
   （`requirementCommit.test.ts` 断言磁盘正式版本不变）；**D 参数草稿跨进程重启的
   恢复未在本阶段新增实现或验证**，不记作已支持。
7. 自动预览不会重建 3D/图纸组件（`ChangeWorkbench` key 已去掉 `draftRevision`，
   避免输入被重置）；相机/选择/爆炸状态“保持”目前由组件挂载路径保证，
   **没有专门的自动化断言或截图对比**，不记作已验收。
