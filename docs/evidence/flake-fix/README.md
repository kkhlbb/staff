# Workspace.test.tsx 偶发红（flake）修复证据

分支 `agent/fix-workspace-flake`，基线 `b4f2a53`（`merge: V4.0 阶段2 Agent 调度骨架与假模型适配器`）。
只改 `src/pages/Workspace.test.tsx`（+46 / −26），未改产品代码、未改断言语义。

## 1. 结论摘要

| 项 | 结果 |
|---|---|
| 复现 | **成功**（用未修复代码，8 workers + 8 个 CPU 抢占进程，第 1 轮即红） |
| 根因 | **纯超时（负载相关）**为主；另有一处**测试工具按 `indexedDB.open` 调用序号注入故障**，负载下序号被后台读库挤掉 → 故障注入打偏 |
| 全量 10 轮 | **10/10 全绿**（`logs/round-01..10.log`） |
| 高负载 3 轮（8 workers + 8 抢占） | **3/3 全绿**（`logs/load-01..03.log`） |
| 极端 2 轮（8 workers + 16 抢占，额外加做） | **2/2 全绿**（`logs/extreme-01..02.log`） |
| M16 变异 | 回退全文 → **红 3/3**；恢复 → **绿 2/2**（`mutations/`） |
| 六条命令 | 全部 exit 0（`logs/*.log` + `verification.json`） |

## 2. 复现方法（先抓现场，未修改任何代码）

机器 10 核。脚本：`repro` 目录下的日志由下列条件直接产生。

条件 A（不够）——`npx vitest run --maxWorkers=8`，连跑 10 轮：**10/10 全绿，未复现**
（`repro/load8-attempt-01..10.log`）。

条件 B（复现）——同样 `--maxWorkers=8`，另起 8 个 `yes > /dev/null` 抢占核心（10 核上共 ~17 个进程）：**第 1 轮即红**。

失败原文（`repro/burn8-attempt-01.log`，未修复代码，src/pages/Workspace.test.tsx:166 处仍是 `userEvent.setup()`）：

```
 ❯ src/pages/Workspace.test.tsx (21 tests | 1 failed) 33289ms
   ❯ Workspace：从空项目建立案例 A，再修改为案例 B (4)
     × 逐格输入案例 A 后确认判定为不满足，改到 B 时确认被清除、重新确认后判定为满足 5048ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/pages/Workspace.test.tsx > Workspace：从空项目建立案例 A，再修改为案例 B > 逐格输入案例 A 后确认判定为不满足，改到 B 时确认被清除、重新确认后判定为满足
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ src/pages/Workspace.test.tsx:165:3
    165|   it('逐格输入案例 A 后确认判定为不满足，改到 B 时确认被清除、重新确认后判定为满足', async () => {
       |   ^
    166|     const user = userEvent.setup()
```

注意：**失败的不是某个 `expect` 断言不符，而是用例级 5000ms 超时**（没有任何 `expected X to be Y` 之类的不一致）。
所以“期望什么/实际什么”在这里没有对象——超时即事实本身。这一点是本任务最重要的判断依据。

### 2.1 耗时量化（证明是“贴 5s 悬崖”，不是断言竞态）

同一用例、同一负载（8 workers + 8 抢占），把 `--testTimeout` 放宽到 20000ms 后逐用例计时：

| 代码状态 | 该用例耗时 | 日志 |
|---|---|---|
| 未修复（`userEvent.setup()`） | **4825 ms** | `repro/unfixed-full-verbose.log`（`--reporter=verbose`） |
| 同上，单 worker 只跑本文件 | 2531 ms | `repro/unfixed-verbose.log` |
| 仅改 `delay: null`（尚无显式超时） | **3334 ms** | `repro/fixed-full-verbose.log` |

4825ms 对 5000ms 只有 175ms 余量 —— 这就是“7 轮里红 1 轮”的机械原因：负载再抖一点就穿。
`delay: null` 让每次按键不再走真实计时器等待，耗时降 31%（4825→3334ms），但**极端压力下仍不够**：
16 个抢占进程时 `repro` 之外的中间态跑出过 `草稿有效时导出当前有效链…` 超时（`mutations/logs/m16green-02.log`）。
因此最终版本同时给了该文件显式 `testTimeout: 15000`（`vi.setConfig`，已用 7s 睡眠探针验证生效）。

## 3. 第二处机制（不是超时，是故障注入打偏）

`来源元数据也读不到时明确说明是降级备份` 用例原本靠**序号**注入故障：

```ts
vi.spyOn(IDBFactory.prototype, 'open').mockImplementation((name, version) => {
  openCount += 1
  // 1：引导失败；2：应急导出重新读取项目成功；3：读取来源元数据失败。
  if (openCount === 1 || openCount === 3) throw new Error('模拟打开失败')
  ...
})
```

但页面里还有自动保存、草稿恢复等后台读库，它们同样调用 `indexedDB.open`（`withDatabase` 每次开新连接、无缓存）。
并行负载下这些 open 会挤到用户的点击之前，`#3` 落到别的读库上，`loadProjectSources` 拿到的是 `#4/#5`，于是走了“普通备份”分支。

证据（临时插桩，记录每次 open 的序号与调用栈，插桩已回退）：`repro/probe-attempt-02.log`

```
[probe-open] #1 name=shaft-tolerance-chain ...
[probe-open] #2 ... #7（共 7 次 open，只有 #1 抛错）
FAIL src/pages/Workspace.test.tsx > ... > 来源元数据也读不到时明确说明是降级备份，不把空来源当作普通备份
TestingLibraryElementError: Unable to find an element with the text: /已导出降级备份/
（页面渲染的是“已导出项目 JSON 备份：其中不含来源附件…”，即普通备份分支）
```

单跑该用例（8 抢占进程，8 次）：**0/8 红**（`repro/degradation-single.log`）——只有整文件并行才触发，符合“后台读库挤占序号”的解释。

## 4. 改动清单（只有 `src/pages/Workspace.test.tsx`）

1. **`userEvent.setup()` → `userEvent.setup({ delay: null })`，17 处**：去掉按键间的人为等待，直接压缩用例时间（4825→3334ms）。
2. **文件级显式超时**：`vi.setConfig({ testTimeout: 15000, hookTimeout: 15000 })`，给并行负载留余量。
   用插入 7s 睡眠的临时探针验证过确实生效（默认 5s 会红），探针已删除。
3. **重写 `来源元数据也读不到…` 的故障注入**：不再按 `open` 序号，改为 `vi.spyOn(IDBDatabase.prototype, 'transaction')`，
   按“本次事务是否要读 `sourceDocuments`”决定失败；两阶段（引导全失败 → 应急导出只让来源读失败）。
   断言原样保留（仍要求 `/已导出降级备份/` 且含“不含来源记录、绑定坐标与附件”），没有放宽。
4. 配套新增 `SOURCE_DOCUMENT_STORE_NAME` 导入。

未改：产品代码、其它测试、`vite.config.ts`、断言文本。

## 5. 统计（最终代码，逐轮日志在 `logs/`）

> 用例总数说明：`src/test/evidenceRepro.test.ts` 里有 `it.each(evidenceJsonFiles('docs/evidence'))`，
> 每个新增证据 JSON 会动态生成 1 个守卫用例。本目录的 `verification.json` + `flake-stats.json`
> 使全量从 **96 文件 / 1013 用例** 变为 **96 文件 / 1015 用例**（两者都通过）。
> 所以：第 2、3、6 节的复现/变异日志是“加证据 JSON 之前”的树（报 1013），第 5 节统计与第 7 节六条命令
> 是**提交后的树**（报 1015）；差别仅这两个守卫用例，不是代码变化。

### 5.1 全量 `npm test` 10 轮

| 轮 | Test Files | Tests |
|---|---|---|
| 01 | 96 passed (96) | 1015 passed (1015) |
| 02 | 96 passed (96) | 1015 passed (1015) |
| 03 | 96 passed (96) | 1015 passed (1015) |
| 04 | 96 passed (96) | 1015 passed (1015) |
| 05 | 96 passed (96) | 1015 passed (1015) |
| 06 | 96 passed (96) | 1015 passed (1015) |
| 07 | 96 passed (96) | 1015 passed (1015) |
| 08 | 96 passed (96) | 1015 passed (1015) |
| 09 | 96 passed (96) | 1015 passed (1015) |
| 10 | 96 passed (96) | 1015 passed (1015) |

**10/10**（`logs/round-01..10.log`，exit 0 各轮）。

### 5.2 高负载 3 轮（`--maxWorkers=8` + 8 个 `yes` 抢占）

| 轮 | Tests | 结果 |
|---|---|---|
| 01 | 1015 passed (1015) | 绿 |
| 02 | 1015 passed (1015) | 绿 |
| 03 | 1015 passed (1015) | 绿 |

**3/3**（`logs/load-01..03.log`）。

### 5.3 极端压力 2 轮（`--maxWorkers=8` + 16 个 `yes` 抢占，额外加做）

`extreme-01/02` 均 1015 passed → **2/2**（`logs/extreme-01..02.log`）。
加做原因：`delay: null` 单改版本在此压力下曾红过一次，用来证明显式超时是必需的。

## 6. M16 变异

- 修复补丁：`mutations/M16-fix-delay-null-and-timeout.patch`
- 回退补丁（变异体）：`mutations/M16-mutation-revert-fix.patch`（等价于 `git checkout --` 回 HEAD 全文）

| 步骤 | 条件 | 结果 | 日志 |
|---|---|---|---|
| 变异 | 8 workers + 16 抢占，3 轮 | **红 3/3**（2、3、3 个用例失败） | `mutations/logs/M16-red-attempt-01..03.log` |
| 恢复 | 同条件，2 轮 | **绿 2/2** | `mutations/logs/M16-green-restored-01..02.log` |

变异红命中的用例（`M16-red-attempt-01.log`）：`逐格输入案例 A…` 5000ms 超时；第 2、3 轮另含 `F-01`、`F-02` 超时——都是同一“按键计时器 + 并行负载”机制。

诚实补充：**先用 8 个抢占进程跑变异体 4 轮全绿**（`mutations/logs/M16-attempt-01..04-unfixed.log`），
说明该复现对压力敏感（该用例未修复时 4825ms，离 5s 只差 175ms），压力加到 16 个抢占进程后才稳定红。
这也是我没有把“8 workers 10 轮全绿”当成复现成功的理由。

## 7. 六条命令（在最终工作树上执行，`verification.json`）

| # | 命令 | 退出码 | 实际输出 | 日志 |
|---|---|---|---|---|
| 1 | `npm run typecheck` | 0 | 无诊断 | `logs/typecheck.log` |
| 2 | `npm run typecheck:desktop` | 0 | 无诊断 | `logs/typecheck-desktop.log` |
| 3 | `npm run lint` | 0 | `eslint .` 无输出 | `logs/lint.log` |
| 4 | `npm run test` | 0 | 96 文件 / 1015 用例全过 | `logs/test.log` |
| 5 | `npm run test:desktop` | 0 | 31 文件 / 229 用例全过 | `logs/test-desktop.log` |
| 6 | `npm run build` | 0 | vite 生产构建通过（既有 chunk 体积警告） | `logs/build.log` |

跑完 `git status --short` 无输出（测试与构建不写仓库文件；证据文件已提交）。
（提交哈希见本分支最后一次提交。）

## 8. 未做项 / 已知问题（如实标注）

1. **未改产品代码**：两处问题都在测试工具层，没有产品行为改动。
2. **不属本任务、但已发现且会污染全量统计**：`src/review/invalidation.test.ts > 修改绑定区域：只清该绑定核对，其他绑定保留`
   在本分支（也在我 stash 掉改动后的干净 HEAD 上）**偶发红**：单文件 6 次里红 4 次。实测错误：
   `storage_failure / 记录来源核对失败，绑定未改变`，底层是 `ConstraintError`——变更事件 id 为
   `source_binding_reviewed:<bindingId>:<reviewedAt>`，`reviewedAt = new Date().toISOString()` 只有毫秒精度，
   同一绑定在同一毫秒内被核对两次就 `add` 撞键、事务中止。这看起来像**产品层的 id 碰撞缺陷**，需要单独任务卡。
   证据：`repro` 之外的中间态日志 `repro/fixed-full-verbose.log`（该轮就是它红，而 Workspace 用例 3334ms 已过）。
   我没有顺手改它（超出任务范围）。
3. **任务卡里的基线数字对不上**：卡上写“红 1 轮（1018/1019）”，当前 `b4f2a53` 上是 **96 文件 / 1015 用例**
   （`npm run test:desktop` 也是 31/229，不是 V3.6 时期的 26/178）。可能当时在别的工作树/分支上量的，需要确认。
4. **被覆盖的日志**：第一次 3 轮高负载里 `load-03.log` 曾红（就是第 3 节那个降级备份用例）；
   因为之后修好重跑，`logs/load-03.log` 已被新的全绿日志覆盖，该失败的存活副本是 `repro/probe-attempt-02.log`（带插桩）。
5. **极端压力下的“全绿”不等于无限负载下永不超时**：给的是 15s 显式余量（实测最慢 3334ms 于 8 抢占、更多压力未逐档测量），
   若 CI 机器比本机慢 4 倍以上仍可能触界，届时应按同一方法继续量化，而不是再放大超时蒙过去。
6. 只在 macOS（10 核）本机验证过，未在 CI 或其它机型复跑。

## 9. 证据索引

```
docs/evidence/flake-fix/
├── README.md                                  本文件
├── capture.mjs                                六条命令 + 统计采集脚本（node docs/evidence/flake-fix/capture.mjs）
├── scripts/                                   复现/统计脚本（可独立重跑同一负载条件）
│   ├── repro-loop.sh                          <轮数> <workers> <抢占进程> <label>：未修复版复现循环
│   ├── stats-rounds.sh                        <轮数> <workers|default> <抢占> <前缀> <输出目录>：逐轮统计
│   ├── measure-full.sh                        全量 + 抢占 + 放宽超时 + verbose，量逐用例耗时
│   ├── loop-one.sh                            单个用例重复跑，统计失败率
│   └── m16-final.sh                           M16 变异：回退全文 → 重压必须红 → 恢复必须绿
├── verification.json                          六条命令退出码/耗时（serializeEvidence）
├── flake-stats.json                           各轮 Tests 解析结果（serializeEvidence）
├── repro/
│   ├── load8-attempt-01..10.log               未修复 + 8 workers，10 轮全绿（未复现）
│   ├── burn8-attempt-01.log                   ★ 未修复 + 8 workers + 8 抢占 → 红（失败原文）
│   ├── unfixed-full-verbose.log               未修复、放宽超时：逐格输入 4825ms
│   ├── unfixed-verbose.log                    未修复、单 worker：2531ms
│   ├── fixed-full-verbose.log                 仅 delay:null：3334ms（该轮 invalidation 偶发红）
│   ├── probe-attempt-02.log                   ★ open 序号插桩证据 + 降级备份用例失败原文
│   ├── degradation-single.log                 该用例单跑 8 次全绿
│   └── degradation-fixed.log                  重写注入后单跑 10 次全绿
├── logs/
│   ├── round-01..10.log                       npm test 10 轮
│   ├── load-01..03.log                        高负载 3 轮
│   ├── extreme-01..02.log                     极端 2 轮
│   └── typecheck*/lint/test*/build.log        六条命令
└── mutations/
    ├── M16-fix-delay-null-and-timeout.patch   修复补丁
    ├── M16-mutation-revert-fix.patch          变异补丁（回退到原写法）
    ├── logs/M16-red-attempt-01..03.log        变异红
    ├── logs/M16-green-restored-01..02.log     恢复绿
    ├── logs/M16-attempt-01..04-unfixed.log    8 抢占进程下未红的 4 轮（压力不足）
    └── logs/m16green-01..02.log               delay:null 单改在 16 抢占下的验证（含 1 次超时红）
```
