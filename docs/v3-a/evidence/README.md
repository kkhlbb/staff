# V3-A 证据索引（A-01 / A-02）

分支：`agent/dsh-v3-A`；工作树：`/Users/aston/DSH/wt/dsh-v3-A`
运行与记录者：代达罗斯（dsh，A-01/A-02 实现者）；仓库提交作者配置为 `aston <2708671643@qq.com>`
环境：macOS 26.4 (25E246) · arm64 · Node v26.12.1 · npm 11.20.0
时间：PST（UTC-8）。带 `*` 的时间取自文件 mtime（原日志未打印时间），其余取自日志内 `run_at` / `Start at`。

> 仓库 `.gitignore` 会忽略 `*.log`；本目录的日志证据是用 `git add -f` 强制纳入版本库的，
> 不是被忽略后漏提交。

## 1. 实现与普通验证

| 文件 | 证明内容 | 生成命令 | 时间 | 任务卡 |
|---|---|---|---|---|
| `a01-notes.md` | A-01 实现范围、安全配置、实测与偏离 | 手写记录 | *01:09:42 初稿；01:34 补纯离线打包实测 | §6 A-01、§7 A-MAC-1、§8 回归 |
| `a01-e2e.log` | 打包产物 e2e 9 项 PASS（标题/桌面壳/preload/sender/子框架/关闭屏障） | `npm run test:desktop:e2e` | *01:09:25 | §8 集成回归 |
| `a01-shell.png` | 桌面壳页面截图 1440×868（SHA-256 `32557c5c…`）；抓图命令未在任何日志中留存，仅能由 mtime 定位到 e2e 之后 | 未留存（`Page.captureScreenshot`，具体调用脚本未保存） | *01:09:30 | §6 A-01 |
| `a02-notes.md` | A-02 容器契约、原子保存序列、故障矩阵、负向用例 | 手写记录 | *01:17:55 | §6 A-02、§4.1/§4.2 |
| `a03-notes.md` | A-03 迁移实现、纯校验抽取边界、字段对照表、IPC 契约、未完成项 | 手写记录 | 2026-11-09 01:48 | §5、§6 A-03、§3 |
| `a03-test.log` | 全量 `npx vitest run`：56 files / 589 tests passed（含迁移 15 例） | `npx vitest run` | 01:51 | §8 回归 |
| `a03-desktop-test.log` | 桌面主进程测试：7 files / 58 tests passed（含迁移服务 9 例） | `npx vitest run --config vitest.desktop.config.ts` | 01:51 | §8 回归 |

## 2. 回退实验（任务卡 §8）

| 文件 | 证明内容 | 生成命令 | 时间 | 任务卡 |
|---|---|---|---|---|
| `rollback-a01.patch` | A-01 定点变异：生产加载退回开发 URL 策略 | 定点变异后取 diff，具体生成命令未留存（补丁原文见 `rollback/README.md` §1.1） | *01:24:06 | §8「桌面生产离线资源」 |
| `rollback-a02.patch` | A-02 定点变异：直接写目标路径，无临时文件/自校验/rename | 定点变异后取 diff，具体生成命令未留存（补丁原文见 `rollback/README.md` §2.1） | *01:23:37 | §8「原子保存」 |
| `rollback-a03.patch` | A-03 定点变异：ZIP 迁移保留当前确认（只退回“清确认”一步，历史转换不动） | 手工记录 diff（见补丁原文） | 2026-11-09 01:47 | §8「迁移确认边界」 |
| `rollback/a03-red.log` | A-03 红灯：`migration-clears-current-preserves-history` 因当前确认非 null 失败；历史深相等用例仍 passed（`1 failed \| 1 passed`） | `npx vitest run src/project-file/migrateV2.test.ts -t "migration-"`（定点变异后） | 01:47:42 | §8 |
| `rollback/a03-green-restored.log` | 恢复实现后两条用例均通过（`2 passed`） | 同上（恢复后） | 01:47:47 | §8 |
| `rollback/a01-red.log` | A-01 红灯：入口 `http://localhost:5173/`、`chrome-error`、body 为空、`OFFLINE_LAUNCH_RESULT=FAIL` | `CUNLIAN_SCREENSHOT=…/a01-offline-red.png node docs/v3-a/evidence/rollback/a01-packaged-offline-launch.mjs`（脚本启动参数见日志） | *01:24:34 | §8 |
| `rollback/a01-offline-red.png` | 红灯截图，全白错误页 1440×868 | 同上（`Page.captureScreenshot`） | *01:24:34 | §8 |
| `rollback/a01-green-baseline.log` | 恢复实现前的绿灯基线：`OFFLINE_LAUNCH_RESULT=PASS` | `node docs/v3-a/evidence/rollback/a01-packaged-offline-launch.mjs` | *01:24:01 | §8 |
| `rollback/a01-package-red.log` | 红灯前打包成功（证明红灯不是打包/编译失败） | `npm run package:desktop -- --arch=arm64` | *01:24:15 | §8 |
| `rollback/a01-package-green.log` | 恢复后打包成功 | `npm run package:desktop -- --arch=arm64` | *01:24:48 | §8 |
| `rollback/a01-green-restored.log` | 恢复后离线启动 6 项 PASS；记录 `run_at=2026-11-09T09:31:58Z`、PID 15230、启动命令、窗口 outer 1200×800 / inner 1200×768 | `CUNLIAN_WINDOW_WIDTH=1200 CUNLIAN_WINDOW_HEIGHT=800 CUNLIAN_SCREENSHOT=…/a01-offline-green.png node docs/v3-a/evidence/rollback/a01-packaged-offline-launch.mjs` | 01:31:58（run_at）；文件 mtime 01:32:02 | §8 |
| `rollback/a01-offline-green.png` | 恢复后离线启动截图 1200×768（SHA-256 `02a2eea4…`） | 同上 | 01:31:58（run_at） | §8 |
| `rollback/a02-green-baseline.log` | A-02 恢复前绿灯基线 2 用例 PASS | `npx vitest run --config docs/v3-a/evidence/rollback/vitest.rollback.config.ts` | 01:23:23 | §8「原子保存」 |
| `rollback/a02-red.log` | A-02 红灯：P0 哈希 `6d704a3b…`→`d69815df…`、原文件打不开、首次写入未落 `.tmp`，`Tests 2 failed` | 同上（定点变异后） | 01:23:39 | §8 |
| `rollback/a02-green-restored.log` | 恢复后 2 用例 PASS | 同上（恢复实现后） | 01:23:43 | §8 |
| `rollback/a02-save-failure-preserves-original.test.ts` | 独立回退校验用例（未并入既有套件，未改既有断言） | 随上述 vitest 命令运行 | *01:23:21 | §8 |
| `rollback/vitest.rollback.config.ts` | 只 include 本目录用例的独立配置 | 手工新增 | *01:23:21 | §8 |
| `rollback/a01-packaged-offline-launch.mjs` | A-01 离线启动校验脚本（断言 + 退出码 1/0） | — | *01:31:43（本轮增加窗口尺寸/PID 日志） | §8 |
| `rollback/a01-open-offline-check.mjs` | `open` 启动产物的离线预检与截图脚本 | — | *01:31:43（同上） | §7 A-MAC-1 预检 |
| `rollback/a01-open-offline.log` | `open -n` 启动预检：PID 15318、完整启动命令、5173 无监听、`OPEN_OFFLINE_CHECK=PASS` | 见日志首部 `command=` / `cmdline=` | 01:32:46 启动 / 01:32:58 检查 | §7 A-MAC-1 预检 |
| `a01-offline-launch.png` | `open` 启动预检截图 1280×788（outer 1280×820，SHA-256 `cb5bbeaa…`） | 同上（`CUNLIAN_WINDOW_WIDTH=1280 CUNLIAN_WINDOW_HEIGHT=820`） | 01:32:58 | §7 A-MAC-1 预检 |
| `rollback/README.md` | 回退实验的完整过程、红/绿原文与归因 | 手写记录 | *01:34:54（本轮更新） | §8 |

## 3. 纯离线打包实测（2026-11-09 01:33，任务卡 §2.1 离线资源 / §8 回退结论的补充）

四条命令都在“不可达代理”下执行，未改系统网络设置：

`ELECTRON_GET_USE_PROXY=true HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 NO_PROXY= npm run package:desktop -- --arch=arm64`

| 文件 | 条件 | 结果 |
|---|---|---|
| `a01-offline-package-warm-cache.log` | `~/Library/Caches/electron` 已有 `electron-v45.2.3-darwin-arm64.zip` | **失败**，`Copying files` → `fetch failed`，EXIT=1 |
| `a01-offline-package-trace.log` | 同上 + `DEBUG=@electron/get:*` | `Cache hit` → 强制下载 `SHASUMS256.txt` → `Artifact in cache didn't match checksums [TypeError: fetch failed]` → 回退重下 zip 失败，EXIT=1 |
| `a01-offline-package-empty-cache.log` | `HOME` 指向空目录（electron 缓存为空） | **失败**，`Copying files` → `fetch failed`，EXIT=1 |
| `a01-offline-package-empty-cache-trace.log` | 同上 + `DEBUG=@electron/get:*` | `Cache miss` → 下载 zip 失败，EXIT=1 |

结论（不粉饰）：当前 Forge 8.0.1 + `@electron/get` 5.1.0 组合下，**纯离线无法完成
`npm run package:desktop`**；失败点在 `Packaging application → Copying files`。
即使 zip 已缓存命中，`validateArtifact` 仍以 `cacheMode=Bypass` 联网拉取
`SHASUMS256.txt`（源码注释原文：`Never use the cache for loading checksums, load them
fresh every time`），拿不到就把缓存 zip 判为 “didn't match checksums” 并回退重下。
因此“预热 `~/Library/Caches/electron` 里的 zip”只能省掉 121 MB 重下，**不能实现离线打包**；
至少要能访问 GitHub releases 取一次 `SHASUMS256.txt`，或改 Forge/打包器配置
（如 `electronZipDir` / `download.unsafelyDisableChecksums`，后者降低校验强度）——本轮未改配置。

## 4. 三张截图曾字节相同的说明与处置

早期 `a01-shell.png`、`a01-offline-launch.png`、`rollback/a01-offline-green.png`
都是同一静态页在 1440×868 下的 `Page.captureScreenshot`，SHA-256 均为
`32557c5cc3d381f4138bd719eea00afeef5c23fd0ef46111f5eed2cf18051ad7`。
字节相同是确定性渲染，不是复制；但同一份字节不能充当三次不同验证的证据。

为让三次验证可区分，2026-11-09 01:32（PST）重拍了后两张（真实窗口 `window.resizeTo`，
日志记录 outer/inner 尺寸、PID 与启动命令）：

| 截图 | 对应验证 | 尺寸（内容） | SHA-256 |
|---|---|---|---|
| `a01-shell.png` | 桌面壳页面（历史截图，命令未留存） | 1440×868 | `32557c5c…`（仅此一处使用） |
| `a01-offline-launch.png` | 打包产物 `open` 启动 + 离线模拟 | 1280×788（outer 1280×820） | `cb5bbeaa…` |
| `rollback/a01-offline-green.png` | 回退恢复后打包产物离线启动 | 1200×768（outer 1200×800） | `02a2eea4…` |

## 5. A-04 会话与恢复（2026-11-09 02:05–02:08 PST）

实现记录：`a04-notes.md`（分支 `agent/dsh-v3-A`，起点 `40efaee`；界面由 Venus 分支负责，
本卡只做后端与会话层，未改 `src/workspace/*.tsx` / `src/components/` 样式布局）。

| 文件 | 证明内容 | 生成命令 | SHA-256（前 12 位） |
|---|---|---|---|
| `a04-notes.md` | 范围、行为、契约偏离、未实现项 | 手写记录 | `75020f55a00c` |
| `a04-desktop-test.log` | 桌面套件 `12 files / 92 tests passed`（新增 5 files / 34 tests） | `npx vitest run --config vitest.desktop.config.ts --reporter=verbose` | `2d2ae421ac1b` |
| `a04-test.log` | 既有全量 `56 files / 589 tests passed`（V2/旧断言未改） | `npx vitest run --reporter=dot` | `bf2dccb03fb2` |
| `a04-typecheck-desktop.log` | `tsc -p tsconfig.desktop.json --noEmit`，`EXIT=0` | 见日志首行 | `5995c17e3e5b` |
| `a04-typecheck-app.log` | `tsc -p tsconfig.app.json --noEmit`，`EXIT=0` | 见日志首行 | `3c6cee6ecb7b` |
| `a04-typecheck-node.log` | `tsc -p tsconfig.node.json --noEmit`，`EXIT=0` | 见日志首行 | `fdd1ecd24d19` |
| `a04-lint.log` | `npx eslint .`，`EXIT=0` | 见日志首行 | `583dc328efba` |
| `rollback-a04.patch` | 定点 mutation：`isDirty` 固定返回 false（模拟信任 renderer dirty=false） | `diff -u` 原始/变异文件 | `d8550ed72585` |
| `rollback/a04-red.log` | 红灯：`6 failed / 86 passed`，失败全部是 dirty gate 用例 | 变异后 `npx vitest run --config vitest.desktop.config.ts --reporter=verbose` | `b6d4b00cfb50` |
| `rollback/a04-green-restored.log` | 恢复实现后 `12 files / 92 tests passed` | 恢复后同一命令 | `c477b16ff9c0` |

说明：`a04-desktop-test.log`/`a04-test.log` 末尾没有单独打印 `EXIT=`，但同一条命令在
shell 中返回 0；typecheck/lint 日志首行记录命令、末行记录 `EXIT=0`。回退实验只改实现
文件、未改任何测试断言。

## 6. A-04c / A-04d 接口补齐（2026-11-09 02:20–02:56 PST）

实现记录：`a04c-notes.md`（`source:read` / `project:reveal`）与 `a04d-notes.md`
（`recent:list` 的 rev / `session:reattach`），同一分支 `agent/dsh-v3-a4c`。
a04c 日志未入本表（见其 notes 内清单）。

| 文件 | 证明内容 | 生成命令 | SHA-256（前 12 位） |
|---|---|---|---|
| `a04d-notes.md` | 范围、DTO 语义、已知问题（含 app typecheck 起点失败） | 手写记录 | `f8021c2fb11f` |
| `a04d-desktop-test.log` | 桌面套件 `14 files / 112 tests passed`（新增 1 文件 / 10 用例） | `npm run test:desktop -- --reporter=verbose` | `89a09a083c88` |
| `a04d-test.log` | 既有全量 `57 files / 597 tests passed`（本卡未改 `src/**`） | `npm test -- --reporter=dot` | `69449b3993dd` |
| `a04d-typecheck-desktop.log` | `tsc -p tsconfig.desktop.json --noEmit`，`EXIT=0` | 见日志首行 | `00cc88ef3cf2` |
| `a04d-typecheck-node.log` | `tsc -p tsconfig.node.json --noEmit`，`EXIT=0` | 见日志首行 | `e28829525127` |
| `a04d-typecheck-app.log` | `npm run typecheck` 失败：起点已有的 renderer 假值缺成员，另加本卡新方法 | 见日志首行 | `5cbdb47aa410` |
| `a04d-head-typecheck-app.log` | 起点 `0fad9d0` 干净副本同样失败（缺 `readAttachment/revealProject`） | `git archive 0fad9d0` 后 `tsc -p tsconfig.app.json --noEmit` | `64d4d5d3161c` |
| `a04d-lint.log` | `npx eslint .`，`EXIT=0` | 见日志首行 | `c004f76ea5d1` |

