# A-04d：最近项目 Rev 与 session:reattach 补齐记录

分支：`agent/dsh-v3-a4c`；工作树：`/Users/aston/DSH/wt/dsh-v3-a4c`；起点 HEAD：`0fad9d0`
（本卡开工时分支停在 `d32f6de`，已按任务卡要求 `git merge --ff-only 0fad9d0` 快进，
未产生新合并提交，也未动 `dsh-v3-A` 工作树）。实现者：代达罗斯（dsh）。
时间：2026-11-09（PST，UTC-8）。

范围：只补 Venus 接界面暴露的两个接口缺口，改动限定在 `desktop/**` 与 `docs/**`；
未改 `src/pages`、`src/components`、样式、公式、q 精度、保存/恢复/迁移逻辑。

## 1. 修改文件

- `desktop/shared/contracts.ts`
  - `IPC_CHANNELS.sessionReattach = 'session:reattach'`；
  - `RecentProjectItem.rev?: string | null`；
  - `SessionRecoveryState`、`ReattachedSession`、`SessionReattachValue`；
  - `CunlianApi.reattachSession()`。
- `desktop/main/recentProjects.ts`：`list()` 与 `relink()` 的 item 带 `rev`；
  新增私有 `readCurrentRevision()`。
- `desktop/main/recovery.ts`：新增只读 `stateOf(sessionId)`（不触发写入）。
- `desktop/main/channels.ts`：注册 `session:reattach`（空对象 strict schema）。
- `desktop/preload/index.ts`：只暴露具体方法 `reattachSession()`，仍无 `invoke/send/ipcRenderer`。
- `desktop/tests/helpers/a04.ts`：记录 main 实际创建的会话 ID，用于证明未命中不新建会话。
- `desktop/tests/sessionReattach.test.ts`：新增 10 条通道级用例。
- `desktop/tests/recentProjects.test.ts`：新增 rev 断言（有效文件 / 路径失效 / relink）。
- `docs/v3-a/evidence/a04-notes.md`：§6 增加本卡指向。

## 2. recent:list 的 rev

`rev` 取值：`project.currentRevisionId` 在 `fileRevisions` 中找到的同
`revisionId` 记录，返回该记录的 `revisionId`（版本标识本身），即“当前正式版本”。

规则：

1. 只从**磁盘上的当前正式文件**读取；每次 `list` 都重新读取，不使用索引里的旧值。
2. 读取走与打开相同的 `decodeProjectFile` 完整校验（哈希、引用、数量），
   校验不过就不认。
3. `missing=true`（路径不存在/不是常规文件/不可读）→ `rev=null`，`missing` 保持不变。
4. 文件存在但容器损坏、或 `currentRevisionId` 对应不到版本记录 → `rev=null`，
   `missing=false`；单个坏文件不会让整份列表返回错误。
5. `recent:relink` 修复索引后同样返回 `rev`（对修复后的路径重新读取）。

类型说明：`rev` 在 TS 类型上写成可选（`rev?: string | null`），原因不是实现省略，
而是本卡约束“不碰 src/pages”：`src/pages/DesktopWorkspace.test.tsx` 里的
`CunlianApi` 假值尚未带 `rev`，若写成必填会让 `tsconfig.app.json` 多一条本卡无权修的错误。
main 侧 `recent:list`/`recent:relink` 总是写入该字段，测试逐条断言；renderer 侧仍需
Venus 接 UI 时把 `undefined` 与 `null` 都当作“版本不可用”，不能保留写死的
“Rev 未提供”。

## 3. session:reattach

请求：`{}`（`.strict()` 空对象；多余字段按 `INVALID_REQUEST` 拒绝）。
返回：

- 命中：`{sessionId, editSeq, snapshot, path, fingerprint, recovery}`
  - `editSeq` = main 已接受的最新序号 `session.acceptedSeq`，不是 renderer 重载后丢失的本地序号；
  - `snapshot` = `toSnapshotDto`（不含附件字节，与 `project:open` 同形）；
  - `recovery` = `RecoveryStore.stateOf(sessionId)`，取值
    `written | unchanged | pending | failed | none`；`none` 表示 main 当前未跟踪草稿
    （例如刚打开、尚未 stage）。
- 未命中：`{session:null}`。

边界：

1. sender 校验与其它通道相同（`installChannel` → `SenderGuard`）：未登记窗口、子框架、
   frame URL 不符都返回 `FORBIDDEN_SENDER`，不返回任何会话字段。
2. 只读：不调用 gate、不 flush 草稿、不 `attach`/`adoptSnapshot`，因此
   未命中不会自动新建会话；重复调用返回同一 `sessionId`。
3. dirty 判定仍是 main 的 `acceptedSeq > savedSeq`，DTO 不带 dirty，renderer 没有
   任何参数能改写；重新挂接后 `project:open` 仍会先弹三选（测试用取消验证）。
4. 会话真实从 `projectService` 里消失（例如已被关闭）时按未命中返回
   `{session:null}`，不伪造快照。

## 4. 自动化验证（真实输出见同名日志）

| 检查 | 命令 | 结果 |
|---|---|---|
| 桌面套件 | `npm run test:desktop -- --reporter=verbose` | `14 files / 112 tests passed`，EXIT=0 |
| 既有全量 | `npm test -- --reporter=dot` | `57 files / 597 tests passed`，EXIT=0 |
| 桌面类型 | `npm run typecheck:desktop` | EXIT=0 |
| node 类型 | `npx tsc -p tsconfig.node.json --noEmit` | EXIT=0 |
| lint | `npm run lint` | EXIT=0 |
| app 类型 | `npm run typecheck` | **EXIT=2**，见 §5 |

基线：桌面套件此前为 `13 files / 102 tests`（A-04c），本卡 +1 文件 / +10 用例。
`npm test` 只跑 `src/**`，本卡 diff 不含 `src/**`；597 是起点 `0fad9d0` 的数值
（A-04c 记录的 594 是 Venus 界面合入前的数值，合入带来 +3 条 UI 用例）。

新增用例：

- recent: 有效项目 `rev='rev-a1'`（取自 `currentRevisionId`）；路径删除后
  `missing=true, rev=null`；非容器文件 `missing=false, rev=null` 且列表仍成功；
  `relink` 返回值带 rev。
- reattach 未命中：`{session:null}`，`createdSessionIds` 为空、无活动会话、无草稿跟踪。
- reattach 命中：`sessionId/editSeq=0/snapshot/path/fingerprint/recovery='none'`；
  重复调用同一 sessionId，未新建。
- 脏编辑后：`editSeq=1`、`recovery='pending'`（防抖窗口内）、main `isDirty=true`；
  此时 `project:open` 仍弹三选（`CANCELLED`，prompt 1 次），会话不变。
- 保存后：`editSeq=1`、`recovery='none'`、`savedSeq=1`、`isDirty=false`。
- 越权：未登记 webContents 与子框架调用均 `FORBIDDEN_SENDER`，会话数量不变。

## 5. 已知问题 / 未做

- **`npm run typecheck` 在起点已失败，不是本卡引入**：
  `src/pages/DesktopWorkspace.test.tsx` 的 `CunlianApi` 假值缺少
  `readAttachment`、`revealProject`。用 `git archive 0fad9d0` 的干净副本
  （`node_modules` 符号链接）复跑，同样 EXIT=2，见 `a04d-head-typecheck-app.log`。
  本卡新增的 `reattachSession` 让同一处假值再多缺一个成员（`a04d-typecheck-app.log`）。
  按“不碰 src/pages”约束未修改该文件；Venus 接 UI 时需在假值里补齐这三个方法（以及 rev）。
  因此本卡不声称“tsc 干净”，只声称 `desktop` 与 `node` 两个工程 EXIT=0。
- 未接界面：`DesktopWorkspace.tsx` 仍写死“Rev 未提供”，仍没有调用
  `reattachSession`；本卡只完成契约、main、preload 与测试。
- 未运行 `npm run test:desktop:e2e` 与 `package:desktop`；未在真实 Electron 里做
  “整页 reload → reattach”点按验证。新方法只经过 typecheck 与 FakeIpc 调用。
- `recent:list` 现在会逐个**完整解码**项目容器（含附件字节）来取 rev；最多 20 项，
  大项目会让列表明显变慢。未做缓存/惰性读取/只解 project.json 的优化（后者需要改
  `src/project-file`，超出本卡范围）。
- `reattach` 的 `recovery` 是 main 内存里最后一次草稿状态，不重新读磁盘；进程重启后
  本来就没有活动会话，走 `{session:null}`。
- 未合并、未推送、未删除任何分支；等待审查与用户批准。
