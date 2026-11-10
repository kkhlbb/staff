# V3.6 体验补丁：提取入口角标 + 条款版本历史默认高度

状态：**实现、自动化测试、打包应用走查（1440×900 / 960×640）均已完成。**
按本次指令**未自开分支/未建工作树/未 merge/未 push/未删除**，直接改在 `main` 工作树。

- 仓库：`/Users/aston/DSH/staff`，分支 `main`
- 基线：`51caf99`（v3.6.0-alpha 已发布，工作区干净）
- 改动范围：两处体验问题（入口角标、历史表默认高度），不动 domain 公式、q 精度、
  schema 8 判据、V3.5/V3.6 既有数值断言（1500/2500、1100/2100、500/1500、1000/2000）。

## 1 「任务书提取」入口角标

### 1.1 行为

- 角标只从**项目文件里的 `project.extractionDrafts`** 计数（schema 8，跨重启一致），
  不读会话内存、不看面板内部状态。
- 未决 = `pending` + `blocked`；`confirmed` / `rejected` / `stale` 已处理完，不计入。
- 多份草稿（不同页范围各自一份）逐份累加，因为入口面向整个项目。
- 没有未决项 → 不渲染任何角标元素（不是 `0`，也不是空徽标）。
- **不自动展开面板、不自动触发提取**：角标是纯展示，`runExtraction` 不会被调用。
- 可读文案：
  - 角标短文本：`待确认 4 · 阻塞 1`（与提取页计数行同序，只显示非零项）
  - `title` 与 `aria-describedby` 指向的隐藏说明：`有 5 项提取候选待处理（4 待确认、1 阻塞）`
  - tab 的可访问名仍是 `任务书提取`（`aria-labelledby` 指向标签文本），
    角标数字只进描述，不污染 tab 名。

实现：`src/document-extraction/pending.ts`（纯函数 + 文案）、
`src/pages/DesktopWorkspace.tsx`（tab 渲染与 `--review-height` 之外的角标接线）、
`src/pages/DesktopWorkspace.css`（角标与 sr-only 样式）。

### 1.2 用例（新增）

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `src/document-extraction/pending.test.ts` | 合成夹具走真实解析路径：4 条待确认 + 1 条阻塞 | 夹具走 `buildPdfTextLayer → buildExtractionDraft`，不手写候选 |
| 同上 | 有未决项：角标文本与一句话说明都由草稿状态导出 | `待确认 4 · 阻塞 1` / `有 5 项…（4 待确认、1 阻塞）` |
| 同上 | 只有待确认：角标不显示阻塞 0 | 只显示非零项 |
| 同上 | 全部确认/拒绝后：无角标（null，不是 0 或空字符串） | 决定走 `confirmCandidate` / `rejectCandidate` |
| 同上 | 多份草稿逐份累加；已失效不计入未决 | 多草稿 + `stale` |
| `src/pages/DesktopWorkspace.test.tsx` | 有未决项：入口角标显示待确认/阻塞数，title 一句话可读，面板不自动展开也不自动提取 | 用例 ①；断言 `runExtraction` 未被调用、提取页仍 `hidden`、`aria-selected=false` |
| 同上 | 已确认/已拒绝全部处理完：角标消失（不显示 0 或空徽标） | 用例 ② |
| 同上 | 关闭重开（项目文件编码/解码往返）：角标与数字保持一致 | 用例 ③（`encodeProjectFile → decodeProjectFile → toSnapshotDto`） |

夹具：`src/document-extraction/__fixtures__/draftFixture.ts`（合成文本层 → 真实领域解析，
1 页：表头 + 4 行组成环 + 一条不支持运算符的公式）。

本补丁**没有新增 IPC / 契约**，因此不需要往 `DesktopWorkspace.test.tsx` 补新假 mock。

## 2 条款版本历史默认高度

### 2.1 行为

- 复核区默认高度：`200px` → `340px`，并按窗口收口：
  `--review-height: max(200px, min(340px, 100dvh - 360px))`
  → 900 高窗口 340px，640 高窗口 280px；**用户拖动分隔条后按用户选的像素渲染**
  （不再跟窗口收口），分隔条范围 `200–480px`（原 160–280）。
- 历史表容器改成“按内容自适应到上限”：`max-height: 360px; overflow: auto`
  → 未超上限时完整显示（1440 约 8 行、960 约 6 行），超出才在表内滚动。
- 未改：列宽/换行策略（960 下仍是原换行方式，9 列表格宽度 928px = 容器宽，
  不引入横向滚动）；也没有调整复核区各分区的信息层次（历史表仍在第二行，
  打开复核区后需要滚动到该区，这一点与修复前一致）。

### 2.2 打包应用实测（`docs/evidence/V3.6/ui-polish.json`）

夹具：`/Users/aston/DSH/tmp/cunlian-v36/UI-V36.cunlian`（5 个条款版本，走真实
`confirmOrUpdateRequirement`；1 份提取草稿：4 待确认 + 1 阻塞）。
应用：`out/寸链-darwin-arm64/寸链.app`（`npm run package:desktop -- --arch=arm64` 产物），
视口用 CDP `Emulation.setDeviceMetricsOverride` 精确设为 1440×900 / 960×640。

| 视口 | 复核区实高 | 中央工作区（画布）高 | 历史表容器 | 表内容 | 完整可见行 | 文档横向溢出 | 复核区横向溢出 |
|---|---|---|---|---|---|---|---|
| 1440×900 | 340px（`clientHeight` 339） | 381px | 1408×256 | 5 行 × 45px + 表头 | **5 行** | 否（1440/1440） | 否（1408/1408） |
| 960×640 | 280px（`clientHeight` 279） | 141px | 928×327 | 5 行 × 59.3px + 表头 | **4 行**（第 5 行在折叠线下方） | 否（960/960） | 否（928/928，表格自身 `scrollWidth` 928 = `clientWidth`） |
| 960×640（拖动分隔条后 332px） | 332px | 89px | 928×327 | 同上 | **5 行** | 否 | 否 |

（画布高 = `.desktop-workspace__center` 实测高度；复核区收起时分别为 694px / 394px。）

修复前（同一夹具、同一应用，改动前的运行）：复核区固定 `200px`（`useState(200)`），
复核区内容 `scrollHeight` 608px，历史表自身 256px —— 200px 的可视区里只能看到
约 2 行（截图 `v36-08-1440x900-history.png` 的旧版本即此状态）。

断言口径：`visibleRows` = 行矩形完全落在 `min(历史表容器, 复核区可视区, 视口)` 内的行数。

### 2.3 截图（`docs/evidence/V3.6/screenshots/`）

| 文件 | 内容 |
|---|---|
| `v36-08-1440x900-badge.png` | 1440×900 打开项目后：入口角标 `待确认 4 · 阻塞 1`，复核区收起，提取页未展开 |
| `v36-08-1440x900-review-open.png` | 1440×900 复核区刚打开（默认滚动位置） |
| `v36-08-1440x900-history.png` | 1440×900 滚到历史表：5 行完整可见 |
| `v36-09-960x640-badge.png` | 960×640 同上（角标） |
| `v36-09-960x640-review-open.png` | 960×640 复核区刚打开 |
| `v36-09-960x640-history.png` | 960×640 滚到历史表：4 行完整可见，右侧按钮不被裁切 |
| `v36-09b-960x640-history-expanded.png` | 960×640 把复核区拖到 332px：5 行完整可见 |
| `v36-10-all-decided-no-badge.png` | 4 条确认 + 1 条拒绝（真实 main 写入）后，角标消失 |

走查日志（脚本 stdout 摘要）：`loaded` 显示打开后草稿状态 `[pending×4, blocked]`、
`requirementRevisions: 5`；`afterDecisions` 显示 `[confirmed×4, rejected]`、
`badgePresent: false`。

## 3 六条命令（干净工作树执行）

| # | 命令 | 退出码 | 实际输出 | 日志 |
|---|---|---|---|---|
| 1 | `npm run typecheck` | 0 | 无诊断（app + node 两个 tsconfig） | `logs/typecheck-v36-polish.log` |
| 2 | `npm run typecheck:desktop` | 0 | 无诊断 | `logs/typecheck-desktop-v36-polish.log` |
| 3 | `npm run lint` | 0 | `eslint .` 无告警 | `logs/lint-v36-polish.log` |
| 4 | `npm test` | 0 | **90 文件 / 917 用例全过** | `logs/test-v36-polish.log` |
| 5 | `npm run test:desktop` | 0 | **27 文件 / 192 用例全过** | `logs/test-desktop-v36-polish.log` |
| 6 | `npm run build` | 0 | vite 生产构建通过（既有 chunk 体积警告） | `logs/build-v36-polish.log` |

跑完上述命令后 `git status --short` 无输出（测试不往仓库写文件；证据/日志显式提交）。

## 4 复现

```bash
cd /Users/aston/DSH/staff
npx vitest run src/document-extraction/pending.test.ts
npx vitest run src/pages/DesktopWorkspace.test.tsx
npm run typecheck && npm run typecheck:desktop && npm run lint
npm test && npm run test:desktop && npm run build

# 打包应用走查（会写 /Users/aston/DSH/tmp/cunlian-v36/）
V36_UI_SEED_OUT=/Users/aston/DSH/tmp/cunlian-v36/UI-V36.cunlian \
  npx vitest run --config vitest.v36fixture.config.ts
npm run package:desktop -- --arch=arm64
env -u ELECTRON_RUN_AS_NODE node desktop/tests/e2e/v36-ui-polish.mjs
```

注意：走查脚本每次用新的工作文件名（`UI-V36-run-<pid>.cunlian`）。恢复草稿按路径索引，
复用同名文件会把上一轮的决定带进来，脚本会在打开后核对 `pending` 是否存在，否则直接 BLOCKED 退出。

## 5 未做 / 已知限制（如实列出）

1. **960×640 下“完整 4 行”依赖默认高度 280px，中央工作区只剩约 141px 高**。
   这是 640px 高的物理约束：复核区再矮就看不到 4 行，再高就进一步压缩画布。
   1440×900 下画布仍有约 381px。用户可用分隔条在 200–480px 之间自行取舍
   （拖到 332px 可显示 5 行，画布约 89px）。
2. **复核区信息层次没改**：条款版本历史仍在「变更/校核/任务书要求」之后，
   打开复核区后需要滚动到该区；本次没有把它提前（避免扩大改动）。
3. 960 下表格仍按原换行策略渲染（每行约 59px）。曾试验“窄屏单行 + 缩字号”，
   实测会把 9 列表格撑到 977px（容器 928px）产生**表内横向滚动**，与“不许横向溢出”
   冲突，因此撤回，保持原换行。
4. 角标计数是“所有草稿之和”，不区分页范围；提取页内部计数仍按当前草稿显示。
5. 未做打包应用签名/安装验证；只走查本机 `package:desktop` 产物。
6. 未合并、未推送、未删除任何分支或工作树；合并与发布需用户本人批准。
