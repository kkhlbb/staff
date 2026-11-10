# A-04 后端与会话层实现记录（不含界面）

分支：`agent/dsh-v3-A`；工作树：`/Users/aston/DSH/wt/dsh-v3-A`；实现起点 HEAD：`40efaee`
（A-03 提交）。实现者：代达罗斯（dsh）。时间：2026-11-09（PST，UTC-8）。

范围依据：任务卡 `tmp/cunlian-v3/任务卡_V3-A.md` §3（IPC 契约）、§4.2（原子保存/失败语义）、
§4.3（草稿与最近项目落盘位置）、§6 A-04 行、§7 A-MAC-3/A-MAC-4、§8（回退实验）。

界面边界：未修改 `src/workspace/*.tsx`、`src/components/` 下的样式与布局。
`src/workspace/desktopAdapter.ts` 是会话适配层（无 React、无 JSX），由本卡实现。

## 1. 新增/修改文件

新增（主进程/会话层）：

- `desktop/main/sessionController.ts`：活动会话、dirty 判定、三选 gate、切换/关闭/退出流程、
  另存与索引维护。
- `desktop/main/channels.ts`：`project:new/open/stage/save/save-as`、`recent:list/relink`、
  `recovery:list/restore` 的严格 schema 与 handler；不导入 Electron。
- `desktop/main/recovery.ts`：恢复草稿（完整 `.cunlian` 容器）、1 秒防抖、flush、索引、
  写失败与损坏处理。
- `desktop/main/recentProjects.ts`：`recent-projects.v1.json`、≤20、路径去重、missing、relink。
- `desktop/main/workspaceJson.ts`：`<userData>/workspace` 下 JSON 索引的原子读写与损坏隔离。
- `desktop/main/newProject.ts`：`empty` / `chain-demo` 初始聚合（A-MAC-2 的整数链）。
- `src/workspace/desktopAdapter.ts`：renderer 会话状态机（editSeq、stage、保存前 flush、
  编辑屏障回复、菜单动作转发）。

修改：

- `desktop/main/projectService.ts`：新增 `adoptSnapshot`、`stageFromDto`（附件字节与
  manifestMeta 由 main 覆盖，其余走同一 `assembleSnapshot`）、`fingerprint`、`readProjectBytes`。
- `desktop/main/index.ts`：接入三选对话框、另存/打开/relink 对话框、Finder open-file 排队消费、
  `window:request-close`、红点/⌘Q 同一关闭流程、`editor:flushed` 会话/序号校验、
  迁移提交成功后切换会话。
- `desktop/main/migrationService.ts`：dirty gate 增加 windowId；新增可选
  `dirtyGateDetailed`（保留保存错误码，不再把保存失败伪装成 CANCELLED）；A-03 的
  `dirtyGate` 旧签名仍兼容，A-03 测试未改。
- `desktop/preload/index.ts`：按 `CunlianApi` 暴露新增的具体函数，仍不暴露 invoke/send。
- `desktop/shared/contracts.ts`：新增项目/最近/恢复 DTO 与 `window.cunlian` 方法签名。
- `desktop/main/menu.ts`：⌘W 标签由“关闭项目”改为“关闭窗口”（见 §3 偏离说明）。

## 2. 关键行为

1. dirty 只由 main 判定：`acceptedSeq > savedSeq`。stage/save 的参数 schema 是 `.strict()`，
   renderer 传送 `dirty`、`savedSeq` 等额外字段直接 `INVALID_REQUEST`；没有任何 API 接受
   `dirty=false`。
2. 所有 new/open/migrate/restore/close/quit 先跑编辑屏障，再跑三选（保存/不保存/取消）。
   选“保存”必须等 `FileStore.saveAtomic` 的真实 rename + 回读成功；失败按保存码返回，
   会话、路径、指纹、编辑序号、窗口都不变。
3. 保存期间若出现更高 editSeq：`saveSession` 只保存询问时的序号，保存完成后重新比较；
   仍有未保存编辑就再次询问（最多 3 轮，超出返回 BUSY），不会把旧序号当已保存。
4. 同一窗口的 gate 有互斥锁：并发打开/关闭返回 BUSY，不弹第二个对话框。
5. 草稿：`<userData>/workspace/recovery/<recoveryId>.cunlian` +
   `recovery-index.v1.json`。stage 只在内存接受并安排 1 秒防抖写；`flush` 等待真实写入；
   写入序列为“独占临时文件 → 回读哈希 → 完整容器解码校验 → rename → 目录同步”。
   写失败返回 `failed` + warning，acceptedSeq 仍保留，pending 保留待重试。
6. 恢复草稿恢复为 `path=null` 的未保存副本；与基准路径指纹不同时在 warnings 明确标注；
   恢复后立即把副本重新写成草稿，崩溃后仍可再次恢复，且不覆盖正式文件。
7. 最近项目：≤20、`path.resolve().normalize('NFC')` 去重、同 projectId 不同副本都保留；
   文件不存在/非普通文件标 `missing`，不自动删除；relink 只修索引，项目 ID 不符返回
   `PROJECT_ID_MISMATCH`，不打开、不切换。
8. 菜单动作仍只经 `menu:action` 下发：⌘O/⌘S/⇧⌘S 由适配器调用对应 IPC（gate 在 main）；
   ⌘Q 走 `before-quit`；红点、⌘W、`requestClose` 都走 `runCloseGate`（同一三选与失败语义）。
9. Finder open-file：main 只把 OS 给的路径排队，并向 renderer 发一次 `menu:action open`；
   `openProject()` 消费一次排队路径，其余情况仍由 main 对话框取路径。renderer 不能注入路径。
10. `editor:flushed` 增加校验：回复的 sessionId 必须等于活动会话，editSeq 必须等于 main 的
    `acceptedSeq`；否则记录 STALE_EDIT/STALE_SESSION 且不释放关闭流程。

## 3. 契约偏离与取舍（需审查确认）

- `RecoveryWriteState` 在任务卡三值（written/unchanged/failed）之外增加 `pending`。
  原因：任务卡同时要求“防抖 1 秒写”和“展示尚未持久化窗口”；三值无法诚实表达
  “内存已接受、草稿未落盘”，用 unchanged 会谎报。原三值语义不变，新增值只用于该状态。
- `project:new` 的 `empty` 模板不是 0 环：`validateChain` 要求 2..20 环且基本尺寸 > 0，
  因此用两个占位环（A/B，10.00，±0，relationRevision=0，无人工确认）。`chain-demo`
  为 A-MAC-2 的 H/B1/S/B2 整数链。
- 白名单没有 `project:close`，菜单 action `close` 按 §3 的“系统菜单/红点/⌘Q 同一流程”
  走 `requestClose`，故 ⌘W 标签改为“关闭窗口”。若产品要求“关闭项目但保留窗口”，
  需要新增通道，超出本卡白名单，请裁决。
- 草稿索引自定上限 50 条（任务卡未给上限），仅作索引文件防线；未据此删除用户草稿。
- 迁移 gate 使用新增的 `dirtyGateDetailed`，保留 NO_SPACE/PERMISSION_DENIED 等具体码；
  A-03 的 `dirtyGate` 路径保留，旧测试断言未改。

## 4. 自动化验证（真实输出见日志）

命令与结果：

- `npx vitest run --config vitest.desktop.config.ts` → `12 files / 92 tests passed`
  （原 7 files / 58 + 新增 5 files / 34：sessionController 8、recovery 6、
  recentProjects 6、projectChannels 9、desktopAdapter 5）。
- `npx vitest run`（既有全量）→ `56 files / 589 tests passed`，未改 V2/既有断言。
- `npx tsc -p tsconfig.desktop.json --noEmit`、`tsc -p tsconfig.app.json --noEmit`、
  `tsc -p tsconfig.node.json --noEmit` → 全部 exit 0。
- `npx eslint .` → exit 0。

日志：`a04-desktop-test.log`、`a04-test.log`、`a04-typecheck-{desktop,app,node}.log`、
`a04-lint.log`。

运行瑕疵（如实记录）：02:06 一次把桌面套件与全量套件放在同一 shell 顺序紧跑时，
`src/pages/Workspace.test.tsx` 的一个交互用例 5s 超时（`1 failed | 588 passed`）。
随后单独重跑全量得到 `56 files / 589 tests passed`；未修改该测试，超时归因并发负载，
之后未复现。上述 589 的数字来自单独重跑。

覆盖的验收点（用例名见日志）：

- dirty 三选：取消保持会话与磁盘；不保存放行并清草稿；保存真实落盘后才放行。
- 保存失败（注入 ENOSPC）：不切换、不退出、会话仍 dirty、原文件哈希不变。
- stage 竞态：保存期间注入 editSeq=2，连续两次询问；取消后 acceptedSeq=2/savedSeq=1 且
  dirty=true，磁盘停在 seq1。
- 草稿写失败（注入 ENOSPC）：`failed`+warning，不谎报 written，pending 保留。
- 索引损坏：recent/recovery 列表均报 `*_READ_FAILED`，写入前隔离 `.corrupt-*`，不静默覆盖。
- relink 项目 ID 不符：`PROJECT_ID_MISMATCH`，索引与活动会话都不变。
- 最近记录路径失效：按 recentId 打开返回 `NOT_FOUND`，当前会话不变，不把“文件没了”
  报成保存失败（文件类型先查，不跟随符号链接）。
- ⌘Q 与红点：同一 `runCloseGate`，仅 purpose 不同；取消/保存失败都在两种 purpose 下阻止关闭。
- dirty 绕过：stage/save 携带 `dirty:false` → `INVALID_REQUEST`，acceptedSeq 不变。

## 5. 回退实验：dirty gate 被绕过（定点 mutation）

补丁：`rollback-a04.patch`（只改实现，未改测试）。
变异内容：`SessionController.isDirty` 固定返回 `false`，模拟“信任 renderer 传来的 dirty=false”。

- 红灯：`rollback/a04-red.log`，`6 failed | 86 passed`；失败全部落在 dirty gate 相关用例
  （取消/不保存/保存/竞态/⌘Q 同流程/并发 BUSY），不是编译失败。
- 恢复：还原 `isDirty`。绿灯：`rollback/a04-green-restored.log`，`12 files / 92 tests passed`。

## 6. 未实现 / 未测 / 已知问题

- 本卡未实现：`source:read`、`project:reveal` 的 handler（任务卡白名单里有，但 A-04 范围
  是会话/保存/最近/恢复；仍无“永远成功”的 stub，调用会被 Electron 拒绝）。
  后续补充见 `a04c-notes.md`（`agent/dsh-v3-a4c`）：两个通道已实现并接入 preload。
- A-04d 补齐（`a04d-notes.md`，同一 `agent/dsh-v3-a4c` 分支）：`recent:list` 增加当前
  正式版本 `rev`；新增 `session:reattach` 供渲染器整页重载后重新挂接 main 会话。
- 未运行：`npm run test:desktop:e2e` 与 `package:desktop`（需要打包产物；A-04 未做 Electron
  集成验收，留给 A-05/用户授权后的打包验证）。未在真实双显示器/真实磁盘故障下测试；
  失败注入走 FileOps/WorkspaceOps 端口。
- 界面：`DesktopWorkspace.tsx` 与布局/样式由 Venus 的分支负责；本卡只提供
  `desktopAdapter.ts` 状态机与 IPC，未接任何页面。
- 已知限制：
  * `recovery:list` 会逐个完整解码草稿做容器校验，草稿较大时列表较慢（未做结果缓存）。
  * 恢复草稿只在“放弃/保存成功/切换”时删除对应记录；未实现保留天数清理（等用户确认策略）。
  * 保存的原子性只保证同目录 rename 不出现半文件；不对断电耐久或跨进程恶意并发作绝对承诺
    （与 §4.2/§10 一致）。
  * `empty` 模板的占位环名称/数值是后端默认；若 GUI 需要别的初始内容，应在界面层传入
    完整快照或另行约定模板，不在本卡擅自扩充模板枚举。

## 7. 参考来源

- 任务卡 `tmp/cunlian-v3/任务卡_V3-A.md` §3、§4.2、§4.3、§6 A-04、§7、§8。
- 仓库既有实现：`desktop/main/{fileStore,projectService,migrationService,closeGuard,ipc,senderGuard}.ts`、
  `desktop/shared/contracts.ts`、`src/project-file/{codec,validation,types}.ts`、
  `src/workspace/draft.ts`、`src/project-file/__fixtures__/sampleProjectFile.ts`。
- Electron 官方文档（沿用任务卡 §9 已交叉核对过的摘要，本轮未重新联网抓取全文）：
  IPC `invoke/handle` 与 sender 校验（tutorial/ipc、tutorial/security#validate-the-sender-of-all-ipc-messages）、
  contextBridge/context isolation、`app.getPath` 的 userData/sessionData/logs/documents/temp。
