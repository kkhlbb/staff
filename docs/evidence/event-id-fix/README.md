# 事件 ID 毫秒碰撞修复证据

分支 `agent/fix-event-id-collision`，基线 `ae3e89e`（`merge: 修 Workspace.test.tsx 偶发超时…`）。
修复提交 `4bc6aba`。产品缺陷，不是测试问题；未改 `src/review/invalidation.test.ts` 的任何断言。

## 1. 结论摘要

| 项 | 结果 |
|---|---|
| 根因 | `changeEventId` 只产出 `type:subject`；调用方把毫秒时间戳拼进 subject，同实体同毫秒两次操作得到同一事件 ID → `add()` 撞主键（`ConstraintError`）→ 整个 IndexedDB 事务 abort → 产品返回「记录来源核对失败，绑定未改变」 |
| 修复位置 | **只改 `src/history/events.ts` 两层**：`addChangeEvent` 写入前追加 `#<会话段4><单调序号8>`；`changeEventId` 保持确定性业务键不变（幂等 put 不受影响）。**未改任何调用点** |
| 复现（未修复） | `invalidation.test.ts` 连跑 6 轮 **4 红**（`repro/unfixed-round-01..06.log`） |
| EID-01~06 | 5 个新用例全绿；EID-05 = `invalidation.test.ts` **10/10 全绿**（`logs/round-01..10.log`） |
| M17 变异 | 去掉唯一性后缀 → **红 3/3**（EID-01/02/04 失败）；恢复 → **绿 2/2**（`mutations/`） |
| 六条命令 | 全部 exit 0（`logs/*.log` + `verification.json`） |
| 全量 | 97 文件 / 1022 用例全过（1015 原有 + 5 新增 + 2 证据守卫） |

## 2. 根因

`src/history/events.ts` 原来：

```ts
export function changeEventId(type, subjectId) { return `${type}:${subjectId}` }
export function addChangeEvent(transaction, event) {
  return transaction.objectStore(EVENT_STORE_NAME).add(event)   // 主键 = event.id
}
```

`src/sources/bindings.ts:461` 把毫秒时间戳当业务主键的一部分：

```ts
id: changeEventId('source_binding_reviewed', `${id}:${reviewedAt}`)
```

`reviewedAt` 来自 `new Date().toISOString()`（毫秒精度，也可由测试注入）。
同一绑定在同一毫秒内被核对两次 → 同一个 `id` → `add()` 违反主键唯一约束。

**底层错误名实测**（临时探针直接对 events store 连做两次 `add` 同 id，跑完已删；
原文 `repro/constraint-error-probe.log`）：

```
"raw second add: name=ConstraintError message=A mutation operation in the transaction failed
 because a constraint was not satisfied. ..."
"addChangeEvent same base -> 2 rows"
"id=source_binding_reviewed:probe2:2026-03-01T00:00:00.000Z#23l400000001"
"id=source_binding_reviewed:probe2:2026-03-01T00:00:00.000Z#23l400000002"
```

后两行是修复后的同一场景：同一业务键两次追加 → 2 条、ID 不同。

失败用例的可见症状（未修复，`repro/unfixed-round-02.log`）：

```
FAIL src/review/invalidation.test.ts > 失效矩阵：声明与实现一致 > 修改绑定区域：只清该绑定核对，其他绑定保留
AssertionError: 记录来源核对失败，绑定未改变: expected false to be true
 ❯ src/review/invalidation.test.ts:332:30
```

## 3. 修复（集中在写入层，不改调用点）

`src/history/events.ts`：

```ts
const EVENT_ID_SESSION_TAG = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0')
let eventIdSequence = 0

export function uniqueChangeEventId(baseId: string): string {
  eventIdSequence += 1
  return `${baseId}#${EVENT_ID_SESSION_TAG}${String(eventIdSequence).padStart(8, '0')}`
}

export function addChangeEvent(transaction, event) {
  return transaction.objectStore(EVENT_STORE_NAME)
    .add({ ...event, id: uniqueChangeEventId(event.id) })
}
```

四条设计约束逐条对应：

1. **同实体同毫秒两次都成功、ID 不同**：每次 `addChangeEvent` 取新序号，同一业务键不可能再撞。
2. **幂等 put 不被破坏**：`changeEventId` 输出不变（仍是确定业务键），`putChangeEvent` 与
   `projects.ts` 里直接 `eventStore.put(...)` 的 13 处**完全没动**，同业务键仍覆盖。
3. **一处集中**：唯一性只在 `addChangeEvent` 内部分配；22 个调用点零改动。
4. **顺序与可读**：序号十进制零填充定长，同一 `createdAt` 下 `compareChangeEvents` 仍按写入顺序
   稳定排序；ID 仍以 `type:` 开头，排障可读。

未改 DB schema、未改迁移版本；旧事件 ID 原样保留（新事件只是多了 `#…` 后缀）。

**一处测试断言适配**：`src/history/snapshots.test.ts:317` 原来断言 `event.id === 'analysis_snapshot_created:<id>'`
的精确拼写，现改为 `startsWith(...)` 前缀断言（业务键部分不变，只是允许追加写入序号）。
这不是放宽产品语义：断言仍要求存在一条 `analysis_snapshot_created` 事件且 ID 由 `snapshot.id` 推导。
`invalidation.test.ts` 未动。

## 4. 22 个 `changeEventId(` 调用点审计

任务卡列了 11 处；实际全仓 **22 处**（`events.ts` 定义本身不计）。任务卡漏列了
`projects.ts:1352/1373/1385`、`bindings.ts:378/569/689/805`、`restore.ts:178`。
分类：**A = add 路径 + 含毫秒时间戳（本缺陷触发类）**，**B = add 路径 + 唯一业务键**，
**C = put 幂等路径 + 含时间戳（不中止事务）**。

| # | 位置 | 事件类型 | subject 构成 | 时间来源 | 路径 | 修复前碰撞风险 | 修复后 |
|---|---|---|---|---|---|---|---|
| 1 | `sources/bindings.ts:248` | `source_binding_added` | `binding.id` | 不参与 | add | 无（绑定 ID 新建唯一） | 无 |
| 2 | `sources/bindings.ts:378` | `source_binding_removed` | `${id}:${removedAt}` | `new Date()` 毫秒 | add | **理论同类**：同绑定同毫秒删两次。实际路径不可达——第二次 `existing === undefined` 提前返回，不会 add | 无 |
| 3 | `sources/bindings.ts:461` | `source_binding_reviewed` | `${id}:${reviewedAt}` | `reviewedAt`（可注入）毫秒 | add | **已复现**（本缺陷现场） | 无 |
| 4 | `sources/bindings.ts:569` | `source_binding_historical_accepted` | `${id}:${acceptedAt}` | `acceptedAt`（可注入）毫秒 | add | **真实存在**：第二次接受同一旧版仍满足前置条件，会再次 add → 撞 | 无 |
| 5 | `sources/bindings.ts:689` | `source_binding_region_changed` | `${id}:${now()}` | `now()` 毫秒 | add | **真实存在**：同绑定同毫秒改两次区域。另注意此处 `now()` 被调用两次（id 与 createdAt 可能是两个时刻），属独立小瑕疵，未在本任务改（不影响唯一性） | 无 |
| 6 | `sources/bindings.ts:805` | `source_binding_rebound` | `${id}:${now()}` | `now()` 毫秒 | add | **真实存在**：同绑定同毫秒换源两次 | 无 |
| 7 | `sources/revisions.ts:411` | `source_import` | `revisionId` | 不参与 | add | 无（revision ID 唯一） | 无 |
| 8 | `history/snapshots.ts:593` | `analysis_snapshot_created` | `snapshot.id` | 不参与 | add | 无（快照 ID 唯一，且 add 前已查重） | 无 |
| 9 | `backup/restore.ts:178` | `project_restored_from_bundle` | `${project.id}:${restoredAt}` | `restoredAt` 毫秒 | add | **真实存在**：同一 zip 同毫秒恢复两次 → 撞（第二次恢复本来应成功） | 无 |
| 10 | `storage/projects.ts:924` | `project_name_changed` | `${id}:${savedAt}` | `savedAt` 毫秒 | put | C 类：不中止事务；同项目同毫秒两次改名会覆盖前一条事件 | 不变（幂等语义保留） |
| 11 | `storage/projects.ts:942` | `relation_confirmed` | `${id}:${savedAt}` | 同上 | put | C 类 | 不变 |
| 12 | `storage/projects.ts:952` | `relation_confirmation_cleared` | `${id}:${savedAt}` | 同上 | put | C 类 | 不变 |
| 13 | `storage/projects.ts:961` | `relation_confirmed`（重新确认分支） | `${id}:${savedAt}` | 同上 | put | C 类（与 #11 分支互斥） | 不变 |
| 14 | `storage/projects.ts:976` | `baseline_saved` | `${id}:${savedAt}` | 同上 | put | C 类 | 不变 |
| 15 | `storage/projects.ts:1269` | `term_symbol_changed` | `${term.id}:${savedAt}` | 同上 | put | C 类 | 不变 |
| 16 | `storage/projects.ts:1281` | `term_name_changed` | `${term.id}:${savedAt}` | 同上 | put | C 类 | 不变 |
| 17 | `storage/projects.ts:1293` | `term_note_changed` | `${term.id}:${savedAt}` | 同上 | put | C 类 | 不变 |
| 18 | `storage/projects.ts:1313` | `term_numeric_changed` | `${term.id}:${field}:${savedAt}` | 同上 | put | C 类（每个字段一个 ID，同轮次不会重复） | 不变 |
| 19 | `storage/projects.ts:1329` | `term_numeric_changed`（方向） | `${term.id}:sign:${savedAt}` | 同上 | put | C 类 | 不变 |
| 20 | `storage/projects.ts:1352` | `target_changed` | `savedAt`（无实体前缀） | 同上 | put | C 类，且**风险面最大**：ID 只有时间戳，同一项目同毫秒两次保存必然同键 | 不变 |
| 21 | `storage/projects.ts:1373` | `term_reordered` | `savedAt` | 同上 | put | C 类，同上 | 不变 |
| 22 | `storage/projects.ts:1385` | `assumptions_changed` | `savedAt` | 同上 | put | C 类，同上 | 不变 |

**为什么 C 类不改成 add**：`put` 是任务卡要求保留的幂等语义（同一业务键 = 覆盖），
且它不会 `ConstraintError`、不会中止事务、不会让产品操作失败——与本缺陷的错误面不同。
同一保存轮次内每个 term/字段只会进入一次 put，所以**轮内不会重复**；
"同毫秒两次保存"需要两次完整用户操作（含事务提交）落在同一毫秒，实际不可达。
把它改成 add 需要逐个改 13 个调用点，正是任务卡第 3 条要避免的做法。
**如实标注残余风险**：若将来出现批量/脚本化连写，C 类会「少记一条历史」（不报错），
届时应在 `projects.ts` 统一换成 `addChangeEvent`，而不是逐个拼随机后缀。

## 5. EID-01~06 真实输出

`logs/eid-tests.log`（`npx vitest run src/history/events.idCollision.test.ts --reporter=verbose`）：

```
 ✓ EID-01 同一绑定、同一注入时刻连续核对两次：两次都成功，事件 2 条，id 不同 32ms
 ✓ EID-02 同一时刻连续 100 次同类操作：全部成功，无 ConstraintError，id 全不同 13ms
 ✓ EID-03 幂等路径：同一业务键 put 两次仍只有一条，内容取最后一次 3ms
 ✓ EID-04 事件顺序与 createdAt：同毫秒写入仍按操作顺序稳定排序 7ms
 ✓ EID-06 旧数据兼容：历史事件 id 原样可读，混合后排序仍按 createdAt 2ms
      Tests  5 passed (5)
```

| 编号 | 断言要点 | 结果 |
|---|---|---|
| EID-01 | 同 `reviewedAt` 两次核对，两次 `ok`、事件 2 条、`id` 集合大小 2、`createdAt` 均等于注入时刻 | 绿 |
| EID-02 | 同 `reviewedAt` 连做 100 次：失败列表为空、事件 100 条、`id` 100 个不重复 | 绿 |
| EID-03 | `putChangeEvent` 同业务键写两次 → 1 条、内容为第二次；产品路径同毫秒两次保存同一组成环代号 → 仍 1 条、`after` 为最后一次 | 绿 |
| EID-04 | 同毫秒三次核对 → 3 条、`createdAt` 全相同，`compareChangeEvents` 排序后 message 顺序 = 修订号 1→2→3 | 绿 |
| EID-05 | `invalidation.test.ts` 连跑 10 轮 | **10/10 绿**（见第 6 节） |
| EID-06 | 预置两条旧格式事件（`source_import:legacy-rev-1`、`source_binding_reviewed:legacy-binding:2020-…`）后产生新事件：旧 id 原样存在、排序仍按 `createdAt` | 绿 |

EID-06 的恢复路径旁证：`src/backup/projectBundle.test.ts` 的「原有事件逐条深比较（排除恢复新增事件）」
在全量中通过，说明 `.cunlian.zip` 恢复不会改写既有事件 id。

## 6. EID-05：10 轮统计

`scripts/invalidation-rounds.sh`（逐轮日志 `logs/round-01..10.log`）：

| 轮 | Tests | 结果 |
|---|---|---|
| 01 | 8 passed (8) | 绿 |
| 02 | 8 passed (8) | 绿 |
| 03 | 8 passed (8) | 绿 |
| 04 | 8 passed (8) | 绿 |
| 05 | 8 passed (8) | 绿 |
| 06 | 8 passed (8) | 绿 |
| 07 | 8 passed (8) | 绿 |
| 08 | 8 passed (8) | 绿 |
| 09 | 8 passed (8) | 绿 |
| 10 | 8 passed (8) | 绿 |

**10/10**。10 轮跑于代码提交 `4bc6aba`；此后只新增 `docs/evidence/` 文件，
`git diff 4bc6aba HEAD -- src/` 为空，`src/review/invalidation.test.ts` 从基线到 HEAD 无改动。
对照组（未修复，`scripts/repro-baseline.sh` 把 `events.ts` 临时回退到 `ae3e89e`）：

| 轮 | Tests | 结果 |
|---|---|---|
| 01 | 8 passed (8) | 绿 |
| 02 | 1 failed / 7 passed | **红** |
| 03 | 1 failed / 7 passed | **红** |
| 04 | 8 passed (8) | 绿 |
| 05 | 1 failed / 7 passed | **红** |
| 06 | 1 failed / 7 passed | **红** |

**4/6 红**（`repro/unfixed-round-*.log`）。与任务卡记录的 2 次红同属概率性，
差别来自两轮跑的时间窗口不同；机制相同（同毫秒才撞）。

## 7. M17 变异

- 修复补丁：`mutations/M17-fix-unique-event-id.patch`
- 变异补丁：`mutations/M17-mutation-drop-unique-id.patch`（`addChangeEvent` 改回 `.add(event)`，
  即去掉唯一性后缀；`git apply --check` 通过）

| 步骤 | 轮次 | 结果 | 日志 |
|---|---|---|---|
| 变异 | 3 | **红 3/3**，每轮 `3 failed / 2 passed` | `mutations/logs/M17-red-attempt-01..03.log` |
| 恢复 | 2 | **绿 2/2**（5 passed） | `mutations/logs/M17-green-restored-01..02.log` |

变异体红掉的用例（`eid-stats.json` → `mutationM17.red.failingCases`）：
EID-01、EID-02、EID-04（EID-03/06 仍绿，符合预期——它们不依赖追加唯一性）。

## 8. 六条命令

| # | 命令 | 退出码 | 实际输出 | 日志 |
|---|---|---|---|---|
| 1 | `npm run typecheck` | 0 | 无诊断 | `logs/typecheck.log` |
| 2 | `npm run typecheck:desktop` | 0 | 无诊断 | `logs/typecheck-desktop.log` |
| 3 | `npm run lint` | 0 | `eslint .` 无输出 | `logs/lint.log` |
| 4 | `npm run test` | 0 | 97 文件 / 1022 用例全过 | `logs/test.log` |
| 5 | `npm run test:desktop` | 0 | 31 文件 / 229 用例全过 | `logs/test-desktop.log` |
| 6 | `npm run build` | 0 | vite 构建通过（既有 chunk >500kB 警告） | `logs/build.log` |

`verification.json` 由 `capture.mjs` 生成（走 `serializeEvidence`）。
用例数 1022 = 1015（修复前全量）+ 5（EID 用例）+ 2（`verification.json`、`eid-stats.json` 触发的证据守卫）；
第 8 节跑的是「两个证据 JSON 已存在」的树，与提交后一致。

## 9. 未做项 / 已知问题（如实标注）

1. **C 类 13 处 put 路径未改**（见第 4 节）：不中止事务，但同毫秒两次保存会覆盖前一条事件。
   判断为「幂等语义的一部分 + 实际不可达」，本轮不动；若做批量写入需另行统一改造。
2. **`bindings.ts:689/805` 的 `now()` 被调用两次**（id 与 `createdAt` 可能相差 1ms），
   属独立小瑕疵，不影响唯一性，未在本任务修（超出范围）。
3. **`snapshots.test.ts:317` 断言由精确 id 改为前缀匹配**（理由见第 3 节）；未动 `invalidation.test.ts`。
4. **跨进程/跨标签页的序号空间**靠 4 位会话随机段区分；同一标签页内由单调序号保证。
   理论极值：两个标签页在同毫秒各写 1 条且会话段恰好相同（1/46656）——未做压力测试。
5. **只在本机 macOS 验证**，未在 CI 或其它机型复跑。
6. 未 merge / 未 push / 未删分支。

## 10. 证据索引

```
docs/evidence/event-id-fix/
├── README.md                             本文件
├── capture.mjs                           六条命令 + 统计采集（node docs/evidence/event-id-fix/capture.mjs）
├── verification.json                     六条命令退出码/耗时（serializeEvidence）
├── eid-stats.json                        10 轮/基线 6 轮/EID/M17 的 Tests 解析（serializeEvidence）
├── scripts/
│   ├── invalidation-rounds.sh            EID-05：连跑 10 轮
│   └── repro-baseline.sh                 对照：回退 events.ts 到 ae3e89e 连跑 6 轮
├── logs/
│   ├── round-01..10.log                  invalidation.test.ts 10 轮（修复后）
│   ├── eid-tests.log                     EID-01/02/03/04/06（verbose）
│   └── typecheck*/lint/test*/build.log   六条命令
├── repro/
│   ├── unfixed-round-01..06.log          未修复基线 6 轮（4 红）
│   └── constraint-error-probe.log        ConstraintError 错误名 + 修复后同键两条 id
└── mutations/
    ├── M17-fix-unique-event-id.patch     修复补丁
    ├── M17-mutation-drop-unique-id.patch 变异补丁
    └── logs/M17-red-attempt-01..03.log   变异红
        logs/M17-green-restored-01..02.log 恢复绿
```
