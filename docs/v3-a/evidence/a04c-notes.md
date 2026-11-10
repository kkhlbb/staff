# A-04c：source:read 与 project:reveal 补齐记录

分支：`agent/dsh-v3-a4c`；工作树：`/Users/aston/DSH/wt/dsh-v3-a4c`；起点 HEAD：`45f2489`
（A-04 后端 + Venus 界面骨架合并）。实现者：代达罗斯（dsh）。时间：2026-11-09（PST，UTC-8）。

范围：只补任务卡 §3 白名单里 A-04 遗留的两个通道，并把它们接到 `window.cunlian`。
未修改 `src/pages`、`src/components` 或任何样式；未改公式、q 精度、保存/恢复/迁移逻辑。

## 1. 修改文件

- `desktop/main/channels.ts`：新增 `source:read`、`project:reveal` 的严格 schema 与 handler；
  新增 `revealPath` 注入端口。
- `desktop/main/index.ts`：把 `revealPath` 接到 Electron `shell.showItemInFolder`。
- `desktop/shared/contracts.ts`：新增 `SourceReadValue`、`ProjectRevealValue` 与
  `CunlianApi.readAttachment/revealProject`。
- `desktop/preload/index.ts`：只暴露两个具体函数，仍不暴露 `invoke/send/ipcRenderer`。
- `desktop/tests/helpers/a04.ts`：harness 增加 reveal 端口记录与失败注入。
- `desktop/tests/sourceAndReveal.test.ts`：新增 10 条通道级用例。
- `docs/v3-a/evidence/a04-notes.md`：§6 的“未实现”一行指向本记录。

## 2. source:read 行为

请求：`{sessionId, revisionId}`，schema 为 `.strict()`。

1. `requireActive`：sender 窗口必须仍以该 sessionId 为活动会话，否则 `STALE_SESSION`。
2. 只在 `session.snapshot` 内解析版本：先查 `revisions`，再查 `legacyArchive.records`
   中 `kind='revision'` 的记录；**blobKey 只从命中的版本记录读取**。
   参数里没有 blobKey/path/URL 的位置，额外字段由 strict schema 拒绝。
3. `revisionId` 含 `/`、`\`、空字节或等于 `.`/`..` 时按 `INVALID_REQUEST` 拒绝，
   不会触到文件系统。
4. 限额按 main 的内存元数据判定：单版本 `byteSize > 20 MiB` 或当前项目
   `revisions.byteSize` 合计 `> 100 MiB` 返回 `INVALID_REQUEST`（detail 带实际数值）；
   实际字节超过单文件限额同样拒绝。任务卡该行列出的专用码是
   `ATTACHMENT_MISSING / HASH_MISMATCH / INVALID_REQUEST`，故限额归入
   `INVALID_REQUEST`，没有另造错误码。
5. 找不到版本、版本没有对应附件字节、或已由 `missingAttachments` 声明缺失：
   `ATTACHMENT_MISSING`。历史归档按迁移设计只保留记录与哈希，不带字节，
   因此退役 revision 可被解析但读取字节会明确返回 `ATTACHMENT_MISSING`。
6. 读出后重新计算 SHA-256；与版本记录的 `sha256` 不一致返回 `HASH_MISMATCH`。
7. 返回**复制后的** `Uint8Array`（不是 base64），renderer 改动字节不会污染 main
   会话里的原始附件；返回 `{bytes, sha256, fileName}`。

## 3. project:reveal 行为

请求：`{sessionId}`，schema 为 `.strict()`；没有任何路径或 shell 参数入口。

1. `requireActive` 后只取 `session.path`——该值只会在打开成功或保存成功（真实
   rename + 回读）后出现；新建/恢复草稿的 `path=null` 会话返回 `NOT_FOUND`。
2. 用 `ProjectService.kindOf` 判类型：不存在 → `NOT_FOUND`；目录/符号链接/其它 →
   `NOT_FOUND`（不跟随链接）。
3. 只有常规文件才调用注入端口 `revealPath`；`index.ts` 用
   `shell.showItemInFolder(targetPath)`，不拼接 shell 命令，不接受 renderer 路径。
4. 端口抛错 → `REVEAL_FAILED`；成功 → `{shown:true}`。不写“永远成功”的 stub：
   未落盘、文件已删、非法路径都会在调用端口前失败。

## 4. 自动化验证（真实输出见同名日志）

- `npm run test:desktop` → `13 files / 102 tests passed`（原 12/92 + 新增 1 文件/10 用例）。
- `npm test`（既有全量，仅 `src/**`）→ `57 files / 594 tests passed`。
  该数字高于 A-04 记录的 56/589，原因是起点 HEAD 已合并 Venus 界面骨架；
  在 `45f2489` 的独立 detached worktree 重跑同样得到 `57/594`，本卡未改 `src/**`。
- `npm run typecheck`（app + node）→ exit 0。
- `npm run typecheck:desktop` → exit 0。
- `npm run lint` → exit 0。

日志：`a04c-desktop-test.log`、`a04c-test.log`、`a04c-typecheck-app-node.log`、
`a04c-typecheck-desktop.log`、`a04c-lint.log`。

新增用例覆盖：

- source:read 正常路径：字节等于源 PDF、返回 Uint8Array、哈希/文件名正确，且返回副本。
- 越权 revision：先在 B 项目自己的会话里可读 `sr-b`，再用 A 会话读同一 ID →
  `ATTACHMENT_MISSING`。
- 路径注入：`../../../../etc/passwd`、额外 `path`、额外 `blobKey` 全部
  `INVALID_REQUEST`。
- 哈希不符：篡改内存字节 → `HASH_MISMATCH`。
- 附件缺失：移除附件字节 → `ATTACHMENT_MISSING`。
- 历史归档：退役 revision 可解析但无字节 → `ATTACHMENT_MISSING`（消息说明归档不带字节）。
- reveal 正常：只把 `session.path` 交给端口，返回 `{shown:true}`。
- reveal 未落盘：`path=null` → `NOT_FOUND`，端口未被调用。
- reveal 已删除文件：`NOT_FOUND`，端口未被调用。
- reveal 端口失败：`REVEAL_FAILED`，不返回 `shown:true`。

## 5. 未做 / 已知限制

- 未运行 `npm run test:desktop:e2e` 与 `package:desktop`；`preload` 的新方法只经过
  typecheck，未在真实 Electron 打包产物里点按验证。通道行为由 FakeIpc 直接调用验证。
- `shell.showItemInFolder` 本身没有返回值/错误回执；`REVEAL_FAILED` 只会在该 API
  抛错或注入端口失败时出现。未在真实访达中人工确认“定位到文件”的视觉效果。
- 未测真实磁盘故障、双显示器或超大附件；限额判断基于内存聚合元数据，失败注入
  未用于 source:read（该通道不写磁盘）。
- 未合并、未推送；等待用户批准。
