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

## 2. 回退实验（任务卡 §8）

| 文件 | 证明内容 | 生成命令 | 时间 | 任务卡 |
|---|---|---|---|---|
| `rollback-a01.patch` | A-01 定点变异：生产加载退回开发 URL 策略 | 定点变异后取 diff，具体生成命令未留存（补丁原文见 `rollback/README.md` §1.1） | *01:24:06 | §8「桌面生产离线资源」 |
| `rollback-a02.patch` | A-02 定点变异：直接写目标路径，无临时文件/自校验/rename | 定点变异后取 diff，具体生成命令未留存（补丁原文见 `rollback/README.md` §2.1） | *01:23:37 | §8「原子保存」 |
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
