# 侧栏文案：把工具名翻成人话（ui-wording）

分支 `agent/ui-wording`，基线 `eb2e9ad`（main）。本批只改**用户可见文案与呈现**：
工具名、任务状态、失败说明、待答问题、回执栏、条款状态的显示；**判据、IPC 契约、
工具定义与工具描述、错误码与回执数据一律未动**（模型看到的仍是
`src/agent/toolSchemas.ts` 原文）。

## 一、改了什么（对照表）

屏幕上实际出现的文本，改前 → 改后：

| 位置 | 改前（基线 eb2e9ad） | 改后 |
|---|---|---|
| 「正常改图」按钮提示 | `stage → preview；预览后需人工确认` | 会先改长度参数、再算一遍；算完要你点头才落盘 |
| 「需要补充」按钮提示 | `工具返回 CONSTRAINT_VIOLATED，侧栏不当作完成` | 参数被锁定，工具会说清原因；侧栏不会当作完成 |
| 「工具失败」按钮提示 | `工具返回 INVALID_INPUT，模型自述不算回执` | 数值不合法会写明怎么改；模型自己说“成功”不算数 |
| 执行步骤（模型步） | `model` | 模型想好了下一步 |
| 执行步骤（改参数成功） | `stage · ok` | 已改长度参数并重算 |
| 执行步骤（算一遍成功） | `preview · ok` | 已算完，等你确认 |
| 任务状态行 | `ready-to-commit` / `failed · INVALID_INPUT` | 已算完，等你确认 / 没有做成 · 数值或参数不合法 |
| 失败说明（新增行） | 只有状态行里的错误码 | 没有做成：<工具回执原文> 怎么办：<按错误码给出的下一步> |
| 待答问题 | `CONSTRAINT_VIOLATED` + `stage · 不能修改锁定参数` | 这个参数被锁定 + 改参数：不能修改锁定参数 + 怎么办：换一个能改的参数（内径 / 外径 / 长度） |
| 最近工具结果（回执） | `stage · ok` + `tool:req-1:INVALID_INPUT` | 改参数 · 完成 + 回执时间（`01:39:42`） |
| 条款状态 | `satisfied` / `reasonCodes`（如 `BOTH_VIOLATED`） | 满足要求 / 候选区间两侧均越界（复用 `src/requirements` 既有中文说明） |
| 预览空态 | 尚无主进程预览。工具 preview 成功后这里才出现“确认保存”。 | 还没有算过。算完并复核通过后，这里才会出现“确认保存”。 |
| 配置/导出失败提示 | `保存失败 · INVALID_INPUT：…` | 保存没有成功：… 检查 base_url、模型 ID 与密钥后重试。 |

工具名映射（只在显示层，键仍是模型侧工具名）：

```
context   → 读项目
confirmed → 读已确认项
apply     → 按确认建草稿
stage     → 改参数
preview   → 算一遍
export    → 导出
```

实现：新增 `src/components/agentWording.ts`（纯展示层映射），`AgentSidebar.tsx`
只调用它；`src/requirements/check.ts` 仅把既有的 `REASON_TEXT` 导出为
`REQUIREMENT_REASON_TEXT`（同一份中文说明，无逻辑改动），侧栏不再打印原因码。

## 二、错误码去哪了

错误码与回执**没有删、没有改**：`AgentTaskRecord.errorCode`、`AgentStepRecord.errorCode`、
`question.code`、`outputRef`、IPC 返回与 `docs/evidence/**` 日志全部照旧。
变化只在“界面是否把码直接印给用户”——现在不印，改成中文原因 + 怎么办。
侧栏仍保留 `data-state`（任务状态机原值）与 `agent-task-why`（失败说明）供机器读取。

## 三、守卫用例（红 / 绿）

`src/components/AgentSidebar.test.tsx` 新增守卫用例「侧栏文本不出现工具名 / 内部状态 /
错误码」，把六个工具、`CHUNK_FAILED`（步骤与待答问题各一处）、`unsatisfied` +
`BOTH_VIOLATED` 的预览一起渲染，断言 `document.body.textContent` 不含
`stage / preview / apply / confirmed / context / export / model / CHUNK_FAILED /
INVALID_INPUT / CONSTRAINT_VIOLATED / satisfied / unsatisfied / failed /
ready-to-commit / awaiting-input / tool:req`，同时断言人话确实出现（防空跑）。

变异：临时把 `TOOL_LABELS.stage` 改回 `'stage'`，跑同一用例：

- 红：`docs/evidence/ui-wording/mutations/guard-red.log` — `3 failed | 3 passed`，
  报错原文 `AssertionError: 侧栏文本不应出现内部名：stage: expected true to be false`
- 绿：`docs/evidence/ui-wording/mutations/guard-green-restored.log` — `6 passed`
- 改回后与改坏前的文件逐字节一致（`diff -q` 无输出）

## 四、截图（打包应用真点击，1280×900）

同一脚本 `desktop/tests/e2e/uiWording.mjs` 跑两次：`before` 只取证不断言，`after`
取证 + 守卫断言（文本 + 按钮 `title` 一起查）。

| 场景 | 改前 | 改后 |
|---|---|---|
| 正常改图 · 侧栏上部 | `screenshots/before-01-sidebar-normal-top.png` | `screenshots/after-01-sidebar-normal-top.png` |
| 正常改图 · 滚到底（步骤/回执/预览/确认保存） | `screenshots/before-02-sidebar-normal-bottom.png` | `screenshots/after-02-sidebar-normal-bottom.png` |
| 需要补充（锁定参数） | `screenshots/before-03-pending-question.png` | `screenshots/after-03-pending-question.png` |
| 工具失败（非法数值） | `screenshots/before-04-tool-failure.png` | `screenshots/after-04-tool-failure.png` |

改前侧栏里能直接看到 `ready-to-commit`、`model`、`stage · ok`、`preview · ok`；
改后同一位置是「已算完，等你确认」「模型想好了下一步」「已改长度参数并重算」
「已算完，等你确认」，回执栏是「算一遍 · 完成」「改参数 · 完成」。

机器读数：`before-observed.json`（`guard.hits` 22 条，`stage/preview/model/
INVALID_INPUT/CONSTRAINT_VIOLATED/failed` 出现在正文或按钮提示里）、
`after-observed.json`（`guard.hits: []`，`verdict: "pass"`）。

- 改前取证用的打包产物是 2026-11-12 01:11 的 `out/寸链-darwin-arm64/寸链.app`；
  该产物之后到基线 `eb2e9ad` 之间 main 只改过 README，侧栏源码与基线一致。
- 改后截图来自本批重新 `npm run build` + `npm run package:desktop -- --arch=arm64`
  的产物（01:41），与提交源码同源。
- 原有截图目录 `docs/evidence/v40-stage3/screenshots/` 未触碰。

## 五、六条命令（真实输出）

日志在 `logs/`，逐条 `EXIT=0`：

```
01-npm-test.log                 Test Files 105 passed (105) · Tests 1138 passed (1138) · EXIT=0
02-npm-run-test-desktop.log     Test Files 39 passed | 1 skipped (40) · Tests 278 passed | 14 skipped (292) · EXIT=0
03-npm-run-typecheck.log        tsc app + node --noEmit · EXIT=0
04-npm-run-lint.log             eslint . 无输出 · EXIT=0
05-npm-run-build.log            ✓ built in 214ms（仅既有 chunk 体积提示）· EXIT=0
06-npm-run-package-desktop.log  postPackage 全 PASS，含 pdf worker sha256 b4c8353d… · EXIT=0
```

`npm test` 的用例数会随 `docs/evidence/**/*.json` 增加（`evidenceRepro.test.ts`
对每个证据 JSON 生成一条序列化守卫用例）：本批新增 2 份，故比基线多 2 条守卫 + 1 条守卫用例。

## 六、已知限制与未做项

- **真实模型用例未跑**：`test:desktop` 里 14 条真模型用例默认跳过（需密钥）；本批只改渲染文案，
  没有触碰调度层，但这 14 条未执行。
- **v40stage3 / v40stage4 打包 e2e 未重跑**：两个脚本里断言旧文案的地方已同步改成新文案
  （`agent-question-reason`、`没有做成 · 数值或参数不合法`、`data-state`），但脚本会写
  `docs/evidence/v40-stage3|4/`，按任务要求原证据目录不动，故未执行。
- **仍然是术语但本批没翻**：`base_url`、`模型 ID`、`Keychain`、`预览指纹`、离线演示的
  `fake-1` 与任务短 id。它们不属于工具名，未扩大改动范围。
- **界面不再显示错误码**：若产品上需要“用户报障时能报出码”，需要另开需求（例如复制诊断信息）。
- 运行环境有一处副作用：上一轮证据跑留下的打包实例（PID 37803，最近项目均为
  `/Users/aston/DSH/tmp/cunlian-v40-stage4/*` 走查副本）占着单实例锁，`SIGTERM` 不退出，
  已 `SIGKILL` 关闭后才跑通 e2e；未触碰任何项目文件。
