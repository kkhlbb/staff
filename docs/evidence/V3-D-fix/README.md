# V3-D 界面缺陷修复（缺陷 1：旧预览失效无原因；缺陷 2：无会话写路径静默）

- 工作树：`/Users/aston/DSH/wt/dsh-v3-A`
- 分支：`agent/dsh-v3-A`（未新建分支、未新建工作树）
- 基线：`ac20342`（feat(V3-D): 参数绑定联动、基准失效屏障与一次原子确认）
- 范围：只改渲染层的过期原因呈现与无会话 notice；未改 domain / q 精度 / schema（仍为 6）/ A、B1、B2、C、D 已通过判据。

## 缺陷 1：旧预览失效后不告诉用户原因

根因（已核）：`useDesktopSession.ts` 的 `stageChange` 成功后
`patchChange({ draft, preview: null, staleReason: null, ... })` 把过期状态清成 null，
界面无法区分“从未预览”与“预览因基准变化作废”。

修复：
- 新增 `PREVIEW_INVALIDATED_NOTICE`（`基准已变化，旧预览已作废；请重新预览后再确认。`）。
- `stageChange` / `bindParameter` / `unbindParameter` / `restoreRevisionDraft` 成功时用
  `invalidatedPreviewReason()` 决定 staleReason：只有确实存在过预览（或已处于作废状态）才写原因，
  从未预览时仍为 null，界面不会误报“已作废”。
- 复用已有 `change-workbench__stale`（role=alert）区域，未新造区域。
- 「确认提交」的灰按钮补可读说明：`title` + 按钮下方 `#change-workbench-confirm-reason`
  文本（从未预览 / 已作废 / 预览有效三套文案）。

DOM 证据（同一探针脚本，先回退源码跑 before，再应用修复跑 after）：

before（`dom-before.log`，基线代码）：

```
--- C. 预览后再改长度并重新建立草稿（缺陷 1 现场）---
{
  "alertCount": 0,
  "staleText": 0,
  "confirmDisabled": true,
  "confirmTitle": null,
  "staleRegionHtml": null,
  "confirmHintHtml": null
}
```

after（`dom-after.log`，本提交）：

```
--- A. 首次进入（从未预览）确认按钮与提示 ---
{
  "confirmDisabled": true,
  "confirmTitle": "尚未预览：先点「预览变更」，预览成功后「确认提交」才可用。",
  "alertCount": 0,
  "hint": "尚未预览：先点「预览变更」，预览成功后「确认提交」才可用。"
}
--- B. 建立草稿（从未预览）---
{ "alertCount": 0, "staleText": 0, ... }          // 不误报“已作废”
--- C. 预览后再改长度并重新建立草稿（缺陷 1 现场）---
{
  "alertCount": 1,
  "alertText": ["预览已过期基准已变化，旧预览已作废；请重新预览后再确认。请重新预览；旧确认请求会被拒绝且不写入。"],
  "confirmDisabled": true,
  "confirmTitle": "基准已变化，旧预览已作废；请重新预览后再确认。",
  "staleRegionHtml": "<div class=\"change-workbench__stale\" role=\"alert\"><strong>预览已过期</strong><span>基准已变化，旧预览已作废；请重新预览后再确认。</span><span>请重新预览；旧确认请求会被拒绝且不写入。</span></div>",
  "confirmHintHtml": "<p id=\"change-workbench-confirm-reason\" class=\"change-workbench__hint\">基准已变化，旧预览已作废；请重新预览后再确认。</p>"
}
```

## 缺陷 2：无活动会话时写路径静默

修复：`useDesktopSession.ts` 用一个 `requireSession()` 守卫替换原 `changeTarget()`，
`adapter.current === null` 与 `sessionId === null` 两种情况统一发同一条
`NO_WRITABLE_SESSION_NOTICE`（`当前没有可写入的活动项目，请先保存项目文件。`），
同时写入会话级 `notice` 与 `change.notice`（参数联动工作台内的 role=status 区域）。
`stageChange` / `previewChange` / `applyChange` / `bindParameter` / `unbindParameter`
（以及同一守卫下的 compare/restore）全部走这一条，不各编文案。

## 新增用例

`src/pages/DesktopWorkspace.test.tsx`（D 参数联动工作台）
- `D-UI-1 预览后再次建立草稿：role=alert 写明旧预览作废原因，确认按钮带可读原因`
- `D-UI-2 从未预览：不出现“已作废”文案，灰按钮用 title 与文本说明尚未预览`
- `D-UI-3 作废后重新预览：原因消失、确认按钮恢复可用`

`src/workspace/useDesktopSession.test.tsx`（新文件）
- `统一文案：常量与界面使用的是同一句`
- `adapter 存在但没有会话：五个写路径都给出 notice，且不产生任何写入`
- `没有 preload 桥（adapter 为空）：点绑定参数同样给出同一条 notice，不静默`

为什么缺陷 2 不写界面级用例：参数联动工作台只在有会话快照时渲染，
“无会话”早退分支在界面上不可达；因此直接对 hook 的真实早退分支取证
（断言 notice 文案、五个写入 IPC 均未被调用、草稿/绑定仍为空）。

## RED/GREEN

- `red.log`：回退 4 个源文件、保留新用例 → `Tests 6 failed | 32 passed (38)`，6 条新用例全部因缺少修复而失败。
- 应用修复后：`src/pages/DesktopWorkspace.test.tsx` 35 passed，`src/workspace/useDesktopSession.test.tsx` 3 passed。

## 门禁（真实输出见同名 .log，本仓库 .gitignore 忽略 *.log）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过（exit 0） |
| `npm run typecheck:desktop` | 通过（exit 0） |
| `npm run lint` | 通过（exit 0） |
| `npm test` | 76 files / 772 tests passed |
| `npm run test:desktop` | 21 files / 154 tests passed |
| `npm run build` | 通过（vite build 224ms，仅有既有的 chunk >500kB 警告） |

## 未做项 / 已知问题（如实标注）

1. 未合并、未推送、未删除任何分支或工作树。
2. 未运行 `npm run test:desktop:e2e`（本卡未要求；打包产物层面的复测仍需赫菲斯托斯/用户执行）。
3. **另一条“绑定参数静默”的可达原因（未修，超出本卡）**：工作台的绑定行只从正式快照
   `project.dimensionLinks` 派生，不读 `change.draft.bindings`。实测（`bind-row-probe.log`）：
   绑定成功后 mock 草稿里有 2 条绑定，界面仍只渲染 1 行且 `change.notice` 为 null ——
   用户看到的就是“点了没反应”。这与本卡描述的 `adapter.current` 为空不是同一条路径；
   若要修需另开任务卡（涉及工作台读草稿绑定与“草稿态”标注，属行为扩展）。
4. 工作树里 `docs/evidence/V3-D/commit/*` 三个文件在我开工前即为已修改状态（D 批次证据产物，
   时间戳 2026-11-09 17:40:57），本提交未纳入、未改动。
