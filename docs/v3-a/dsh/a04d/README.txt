A-04d 契约补齐：session:reattach 返回 savedSeq
================================================

分支：agent/dsh-v3-a4c
基线：已 fast-forward 合并 dsh-v3-A 头 2eb2287（合并前 HEAD 71e7566）
改动范围：desktop/ 与 docs/（未改 src/、未改公式、未改界面）

改动
----
1. desktop/shared/contracts.ts
   ReattachedSession 增加必填字段 `savedSeq: number`，注释写清：
   `editSeq > savedSeq` 即 dirty，`editSeq === savedSeq` 即已保存；
   并保留原约定：dirty gate 仍只由 main 判定，DTO 不带 dirty 字段。
2. desktop/main/channels.ts
   session:reattach 返回 `savedSeq: session.savedSeq`（main 内存最后成功保存序号）。
   未新增写入、未改 gate 判定、未自动新建会话。
3. desktop/tests/sessionReattach.test.ts
   新增/加强三个场景的断言：
   - 从未保存过的新会话，脏编辑后 reattach：savedSeq=0、editSeq>savedSeq、isDirty=true；
   - 保存后再 reattach：savedSeq===editSeq、isDirty=false；
   - 已打开项目脏编辑后 reattach：savedSeq=0、editSeq>savedSeq。
   同时断言干净重挂接最初 savedSeq=0。

真实执行与结果
--------------
命令：npx vitest run --config vitest.desktop.config.ts desktop/tests/sessionReattach.test.ts
结果：Test Files 1 passed (1)，Tests 10 passed (10)，exit 0
日志：targeted.log

命令：npm run test:desktop
结果：Test Files 14 passed (14)，Tests 113 passed (113)，exit 0
（基线为 14 文件 / 112 用例，本次新增 1 个用例）
日志：desktop-test.log

命令：npm run typecheck:desktop
结果：exit 0
日志：typecheck-desktop.log

命令：npx eslint desktop/shared/contracts.ts desktop/main/channels.ts desktop/tests/sessionReattach.test.ts
结果：exit 0（无输出）
日志：lint.log

命令：npm run typecheck
结果：exit 2（app typecheck 失败）
日志：typecheck-app.log
错误：
  src/pages/DesktopWorkspace.test.tsx(153,66): error TS2322:
  Type '{ editSeq: number; path: string; recovery: "pending"; sessionId: string;
  snapshot: SnapshotDto; fingerprint: string | null; warnings: string[]; }'
  is not assignable to type 'SessionReattachValue'.
  Property 'savedSeq' is missing ...
说明：这是 renderer 侧测试 mock 未带新必填字段。该文件在 src/ 下，按本卡
「只动 desktop/ 与 docs/」未修改。修复只需在该 mock 加 `savedSeq: 0`
（或相应已保存序号），属于 Venus 的 renderer 范围，未在本分支擅自改动。
因此本次不把 app typecheck 记为通过。

未做
----
- 未 merge / push / delete，未合并回任何集成分支；
- 未改 renderer 消费逻辑与界面（savedSeq 的展示/判断仍待 Venus 接入）；
- 未改 dirty gate 判定与保存流程。
