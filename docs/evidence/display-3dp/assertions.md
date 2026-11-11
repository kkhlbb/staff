# display-3dp 测试断言迁移

## 结果与边界

- 实际工作树：`/Users/aston/DSH/staff`，分支 `agent/display-3dp`。委派文字中的 `/Users/aston/DSH/staff agent/display-3dp` 不是存在的目录；已用 `git worktree list` 确认工作树与分支。
- 本次只修改下表 14 个 `*.test.ts/tsx`、本文及本目录新增日志。没有修改生产代码、`src/domain/units.test.ts`，没有提交。
- formatter 判定：`q % 10 === 0` 的 mm 显示为三位；否则四位，不能直接截断所有四位数。现有历史结果 `0.1234` 与报告哨兵 `99.9999` 保留四位。
- 实际改动 **154 个断言源码位置**，另改 **1 个 DOM 定位查询**（Workspace 的对比表 `getByText`）。计数口径为独立 `expect(...)` 位置，不把数组元素、循环执行次数、参数化用例次数或一个区间的两个端点重复计数。ChainDiagram 的外置显示期望表算到消费该表的断言。
- 计数通过 TypeScript AST 对比 HEAD 与工作树的 `expect` 表达式，并核对外置显示期望表、纯变量改名与定位查询得出；不包含主代理修改的 units 测试。

## 实跑证据（各轮使用不同日志名）

| 阶段 | 命令 | 退出码 | 实际结果 | 日志 |
| --- | --- | --- | --- | --- |
| formatter 修改前基线 | `npm test` | 0 | 既有基线 | `assertions-baseline-test.log` |
| formatter 修改前基线 | `npm run test:desktop` | 0 | 既有基线 | `assertions-baseline-desktop.log` |
| formatter 修改后、断言适配前 | `npm test` | 1 | 13 文件失败，41 测试失败 / 951 通过 | `assertions-after-formatter-test-01.log` |
| formatter 修改后、断言适配前 | `npm run test:desktop` | 1 | 1 文件失败，2 测试失败 / 199 通过 | `assertions-after-formatter-desktop-01.log` |
| 第一轮适配后 | `npm test` | 1 | 3 文件失败，4 测试失败 / 988 通过 | `assertions-adapted-test-02.log` |
| 第一轮适配后 | `npm run test:desktop` | 0 | 29 文件，201 测试通过 | `assertions-adapted-desktop-02.log` |
| 最终 | `npm test` | 0 | 94 文件，992 测试通过 | `assertions-final-test-03.log` |
| 最终 | `npm run test:desktop` | 0 | 29 文件，201 测试通过 | `assertions-final-desktop-03.log` |

第二轮残留失败逐项判定：REAL-01 仍把原样输入 nominal 当显示预期，改为独立三位期望表；参数工作台初始值由 q 格式化，`12.00` 显示预期改为 `12.000`；条款区间正则改三位；内外半径并非 formatMm 路径，回退保留原四位预期。随后真实全套 `npm test` 通过。

## 每文件行号、判定与改动计数

行号以本次完成后的文件为准。范围包含多行 expect 的定位行、期望值行；未列出的用户输入和领域 fixture 不改。

| 文件 | 当前行号 | 改动断言数 | 判定依据 |
| --- | --- | ---: | --- |
| `desktop/tests/draftSyncTransactions.test.ts` | 54、60、99 | 3 | renderToStaticMarkup 的计算区间显示；不改 stage 输入 `20.00` / `32.00` / `12.05`、磁盘内容比较或 q。 |
| `src/components/ChainDiagram.test.tsx` | 142–149、160–171、302、324–325 | 5 | 代号旁 nominal 显示走 formatMm。案例 A 与 REAL-01 使用独立三位显示期望表；原样四位 nominal 输入 fixture 保留。REAL-01 的 symbol/id 仅随循环变量改名，不计新增显示断言。 |
| `src/components/ContributionTable.test.tsx` | 68–73、122–125 | 2 | 两个完整贡献表数组的公差显示；比例和顺序不变，makeTerm 输入不改。 |
| `src/components/DimensionTable.test.tsx` | 206–223 | 6 | 仅六个只读上下极限尺寸 cell；可编辑字段的原样 `100.0000` / `0.0000` / `0.1000` 断言保留。 |
| `src/components/RequirementRevisionHistory.test.tsx` | 22 | 1 | 历史条款上下限的 mm 展示；PDF 页码、选区坐标、版本 ID 不变。 |
| `src/components/ResultPanel.test.tsx` | 254–260、262–263、269–275、277–278、284–290、292–293、350–352、373–375、409、439–441 | 37 | 标准案例、裕量、目标区间、stale 与零公差结果展示；保留用户输入 change/type 和 `minInput` 原样 `0.2000`。 |
| `src/components/ScenarioCompare.test.tsx` | 73–93、107–108、113–114、119–120 | 13 | 前后值、变化量、裕量的显示；领域链与 mm(...) fixture 不改。 |
| `src/pages/DesktopWorkspace.test.tsx` | 453、459、555、569、594、649–651、1154、1166、1337 | 11 | 属性、计算范围、历史范围和条款摘要走 formatter；594 保留精细端点 `0.1234`。1154 是参数工作台从 q 生成的初始显示，改 `12.000`；用户改入 `14.00` 及 IPC 原样断言不改。1166/1337 仅显示正则变三位。 |
| `src/pages/PrintReport.test.tsx` | 289–309、320–321、325–331、336–337、346–351、374–377、411–412、446 | 21 | 冻结报告输入表、代入公式、结果、贡献与对比均为 mm 显示；99.9999 哨兵、1q=0.0001mm、快照内部数据不变。446 负向断言也改为实际新显示，避免旧四位字符串导致空洞通过。 |
| `src/pages/ProjectList.test.tsx` | 541–543、646 | 4 | 导入项目/演示案例的结果与目标显示；导入导出 fixture、内部 q 不改。 |
| `src/pages/Workspace.test.tsx` | 202–203、210–218、248–255、261、271、287–288、306、327–329、568–569、586–587、623–625、806–814、826、854–862、873–875、1177；定位查询 823 | 43 | 结果卡/贡献/对比展示。恢复基线和 V1 无草稿迁移会 chainToDraft，854/857/860/873/1177 为生成镜像显示，可改三位。577–583 等原样用户输入恢复断言不改。823 的 getByText 定位为第 1 个额外查询，不算断言。 |
| `src/parts/shaftDemo.test.ts` | 133–135 | 3 | 仅源 q 内径、外径、长度走 formatMm；136–137 半径为几何浮点 `.toFixed(4)`，保留原四位。 |
| `src/review/invalidation.test.ts` | 157–162、224–227 | 2 | 两个事件对象的 before/after 为用户可读 mm 摘要；numeric.beforeQ/afterQ 和事件语义不改。 |
| `src/workspace/draftSync.test.tsx` | 32–33、76 | 3 | 计算区间与 officialDraft 镜像输入显示。该 helper 所有 q 值均为整千分之一，独立期望 `.toFixed(3)`；未复用被测 formatter。手写编辑 `99.0000` 等保留。 |
| **合计** | **14 文件** | **154** | **另 1 个定位查询；没有更改任何测试数量或删除用例。** |

## 明确保留与源文件核验

- 所有用户实际输入字符串、parseMm/mm 领域 fixture、PDF 坐标、工程图按元数据指定的精度、哈希/ID、整数 q、内部冻结字段保持不变。
- `shaftDemo` 内外半径暂试改三位后真实失败（收到 `10.0000 mm`），已按生产只读代码确认 `.toFixed(4)` 并恢复；不是 formatter 迁移对象。
- `units.test.ts` 工具显示的 `+1****00.000` 是输出脱敏而非源码星号。对源文件对应行读取后用 `s.count(chr(42))` 核验，实际星号数 **0**；全套 units 测试也实际通过。没有写该文件。
- `git diff --check` 退出码 0。
