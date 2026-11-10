# V3-A 回退实验记录（A-01 离线资源 / A-02 原子保存）

工作树：`/Users/aston/DSH/wt/dsh-v3-A`
分支：`agent/dsh-v3-A`，HEAD `1038a61`
日期：2026-11-09
环境：macOS 26.4 (25E246)、arm64、Node v26.12.1、npm 11.20.0

> 实现文件已全部恢复；`git diff` 为空。下面所有红/绿结果都来自真实运行，
> 恢复后 `npm run test:desktop` 6 文件 49 用例、`npm test` 55 文件 574 用例全过。

## 0. 关于“用例名”的如实说明

原交付的测试套件里**没有**名为 `packaged-offline-launch` 或
`save-failure-preserves-original` 的用例：

- `desktop/tests/fileStore.test.ts` 的 ENOSPC 用例只让注入层“立即抛出”，
  没有“先写入若干字节再 ENOSPC”，也没有独立打开校验；
- A-01 的离线断言只散落在 `desktop/tests/e2e/smoke.mjs` 的“无远程资源请求”。

按“只动实现文件、不改任何测试断言或预期”的约束，本次**没有修改任何既有测试**，
也没有把新用例塞进既有套件；两条任务卡断言以独立回退校验脚本的形式放在本目录，
用真实断言和退出码（1 红 / 0 绿）取证。是否把它们正式并入 `desktop/tests`
由用户/审查者拍板。

## 一、桌面生产离线资源（A-01）

### 1.1 回退补丁

`docs/v3-a/evidence/rollback-a01.patch`：

```diff
@@ -37,11 +37,15 @@
 export function createMainWindow(options: CreateMainWindowOptions): MainWindowHandle {
   const rendererIndexPath = resolveRendererIndexPath()
-  const devServerUrl = normalizeDevServerUrl(
-    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string'
-      ? MAIN_WINDOW_VITE_DEV_SERVER_URL
-      : undefined,
-  )
+  // ===== 回退实验定点变异（仅本地实验，不提交）=====
+  // 旧策略：生产包也走开发 URL 加载；没有 Forge 注入地址时回落到经典 5173。
+  const devServerUrl =
+    normalizeDevServerUrl(
+      typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string'
+        ? MAIN_WINDOW_VITE_DEV_SERVER_URL
+        : undefined,
+    ) ?? 'http://localhost:5173/'
+  // ===== 变异结束 =====
```

即把生产分支退回“开发 URL 加载策略”：打包后没有 Forge 注入的 dev URL 时，
仍然 `loadURL('http://localhost:5173/')`，不 `loadFile` 本地
`.vite/renderer/main_window/index.desktop.html`。

### 1.2 离线条件（怎么做的）

- 停掉 Vite dev server：本机原有一个 `node …/staff/node_modules/.bin/vite`
  （PID 3893，监听 `[::1]:5173`，已运行约 4 小时），已 `kill 3893`；
  运行前后 `lsof -nP -iTCP:5173 -sTCP:LISTEN` 均无输出。
- 未改系统网络设置（本机无免密 sudo）。用 Chromium 参数做离线模拟：
  `--proxy-server=127.0.0.1:9`（不存在的代理）+ `--proxy-bypass-list=<-loopback>`
  （取消 localhost 直连例外）。所有 HTTP(S) 必然失败；`file://` 不经过代理。
- 打包产物重新生成：`npm run package:desktop -- --arch=arm64`，
  两次均 `Packaging application` 成功（见 `a01-package-red.log` / `a01-package-green.log`）。

### 1.3 红灯原文（`a01-red.log`）

```
PASS 打包应用启动并暴露 page target
FAIL 生产入口为本地 file:// got=chrome-error://chromewebdata/
FAIL 加载出本地桌面壳（找不到本地 UI 即失败） body=""
PASS 页面没有远程资源请求
FAIL 控制台没有远程请求错误 failures=["net::ERR_PROXY_CONNECTION_FAILED"]
FAIL 没有 http(s) 文档/资源请求（生产包不得回退开发 URL） remoteRequests=["http://localhost:5173/"]
INFO location=chrome-error://chromewebdata/
INFO documentRequest=http://localhost:5173/
INFO remoteRequests=["http://localhost:5173/"]
INFO title=""
INFO body=""
OFFLINE_LAUNCH_RESULT=FAIL(...)
EXIT=1
```

截图 `a01-offline-red.png` 为全白，无桌面壳。

### 1.4 红灯归因

- 不是编译/打包失败：红灯前 `package:desktop` 完整成功，应用也启动了并暴露
  page target。
- 直接证据：`documentRequest=http://localhost:5173/`，
  `location=chrome-error://chromewebdata/`，`body=""`，
  网络层 `net::ERR_PROXY_CONNECTION_FAILED`。
- 结论：生产包没有加载随包的本地 UI，而是回退到已停止的开发 URL；
  目标行为（生产 `file://` 本地入口）缺失。

### 1.5 恢复后绿灯（`a01-green-restored.log`）

```
PASS 打包应用启动并暴露 page target
PASS 生产入口为本地 file://
PASS 加载出本地桌面壳（找不到本地 UI 即失败）
PASS 页面没有远程资源请求
PASS 控制台没有远程请求错误
PASS 没有 http(s) 文档/资源请求（生产包不得回退开发 URL）
INFO documentRequest=file:///.../app.asar/.vite/renderer/main_window/index.desktop.html
INFO title="寸链"
INFO remoteRequests=[]
OFFLINE_LAUNCH_RESULT=PASS
EXIT=0
```

截图 `a01-offline-green.png` 显示“寸链 · 桌面壳”（内容 1200×768，窗口 outer 1200×800，
`window.resizeTo` 设定；本次 PID 15230，启动命令见 `a01-green-restored.log` 的
`INFO command=` / `INFO window_inner_x_outer=` 行）。

## 二、原子保存（A-02）

### 2.1 回退补丁

`docs/v3-a/evidence/rollback-a02.patch`：在指纹校验通过之后、临时文件之前，
插入直接写目标路径的分支（保留既有 `FileOps.writeExclusive` 故障注入钩子）：

```diff
@@ -316,6 +316,22 @@ export class FileStore {
       }
     }
 
+    // ===== 回退实验定点变异（仅本地实验，不提交）=====
+    // 旧策略：直接写目标路径，没有临时文件、自校验与 rename。
+    const rollbackDirectWrite = true as boolean
+    if (rollbackDirectWrite) {
+      try {
+        await ops.writeExclusive(targetPath, options.bytes)
+      } catch (error) {
+        return { ok: false, error: mapWriteError(error) }
+      }
+      return {
+        ok: true,
+        value: { path: targetPath, fingerprint: await sha256Bytes(options.bytes), warnings },
+      }
+    }
+    // ===== 变异结束 =====
+
     const tempPath = `${targetPath}.${suffix}.tmp`
```

### 2.2 故障注入

见 `a02-save-failure-preserves-original.test.ts`：P0 真实落盘并记录 SHA-256；
注入 `writeExclusive` 先往传入路径写 32 字节，再抛 `ENOSPC`。
原子实现会把 32 字节写进 `.tmp`；回退实现会把 32 字节写进正式文件。

### 2.3 红灯原文（`a02-red.log`）

```
× ... > save-failure-preserves-original：写入 32 字节后 ENOSPC，P0 哈希不变且可独立打开
  → 原文件 SHA-256 必须保持不变: expected 'd69815df…' to be '6d704a3b…'
  → 原文件必须能独立打开并通过完整校验: expected false to be true
  → 第一次写入必须落在 .tmp 临时文件: expected false to be true
× ... > 另存恢复路径：故障后另存 Q 成功，Q 为 P1 且 P0 仍为原值
  → expected false to be true

AssertionError: 原文件 SHA-256 必须保持不变:
Expected: "6d704a3bbc79d831c5c8614593ffe977bea790cf0b5fea7e644029f69cd4f099"
Received: "d69815dff88c0cbdcef466e61a77ecb759edbd0d970766f8e895a431d08e1d3d"

AssertionError: 原文件必须能独立打开并通过完整校验: expected false to be true

Test Files  1 failed (1)
     Tests  2 failed (2)
EXIT=1
```

### 2.4 红灯归因

- 不是编译失败：Vitest 正常收集并执行了两条用例，断言逐条执行。
- 保存确实返回失败（`NO_SPACE`，detail 含 `ENOSPC`），但 32 字节已写进正式文件：
  - P0 的 SHA-256 从 `6d704a3b…` 变为 `d69815df…`；
  - 独立 `readProjectFile + decodeProjectFile` 打开失败（半截文件不是合法容器）；
  - 第一次写入路径不以 `.tmp` 结尾。
- 结论：目标行为“临时文件→自校验→rename”缺失，失败写入破坏了原文件。

### 2.5 恢复后绿灯（`a02-green-restored.log`）

```
✓ ... > save-failure-preserves-original：写入 32 字节后 ENOSPC，P0 哈希不变且可独立打开
✓ ... > 另存恢复路径：故障后另存 Q 成功，Q 为 P1 且 P0 仍为原值

Test Files  1 passed (1)
     Tests  2 passed (2)
EXIT=0
```

另存恢复路径也实际验证：故障后不再注入故障，另存 Q 成功，独立打开 Q 得到
“P1 新项目”；P0 仍能独立打开为“P0 原始项目”，指纹等于故障前哈希。

## 三、A-MAC-1 预检（不算正式验收）

用 `open` 启动已打包应用（同样带离线模拟参数）：

```
open -n out/寸链-darwin-arm64/寸链.app --args \
  --remote-debugging-port=9445 \
  --proxy-server=127.0.0.1:9 \
  --proxy-bypass-list='<-loopback>'
open_exit=0
```

- 进程：PID 15318 正常存在（`ps` 显示 `cmdline` 与启动命令一致），窗口内容通过 CDP 读取正常。
- 窗口：outer 1280×820 / inner 1280×788（`window.resizeTo` 设定，用于让本次截图与另外两次验证区分）。
- 入口：`file://…/app.asar/.vite/renderer/main_window/index.desktop.html`
- 标题/正文：`寸链` / “寸链 · 桌面壳…”
- `remoteRequests=[]`、`remoteFailures=[]`、`remoteResources=[]`、`consoleErrors=[]`
- `5173` 无监听。
- 截图：`docs/v3-a/evidence/a01-offline-launch.png`（1280×788，已人工查看，界面正常；
  SHA-256 `cb5bbeaa…`）。
- 日志：`docs/v3-a/evidence/rollback/a01-open-offline.log`
  （首部记录 `launch` 时间、完整 `command=`、`pid=`、`cmdline=`）
- `OPEN_OFFLINE_CHECK=PASS`

注意：这是开发机上的离线条件模拟 + 本机未签名产物预检，不冒充 A-MAC-1 正式通过；
真实断网 Finder 双击、录屏与网络日志仍需 A-05 在目标环境执行。

## 四、最终计数（恢复实现后）

```
$ npm run test:desktop
 Test Files  6 passed (6)
      Tests  49 passed (49)

$ npm test
 Test Files  55 passed (55)
      Tests  574 passed (574)
```

`git diff` 为空；仅新增证据文件（`docs/v3-a/evidence/`）。

## 五、三张截图的可区分性（2026-11-09 01:32 PST 重拍）

早期 `docs/v3-a/evidence/a01-shell.png`、`a01-offline-launch.png` 与本目录
`a01-offline-green.png` 的 SHA-256 完全相同（`32557c5c…`）。原因是三者都是同一静态页在
1440×868 下的 `Page.captureScreenshot`，确定性渲染产出相同字节，**不是复制**；但同一份
字节不能同时充当“桌面壳”“打包离线启动”“回退后恢复”三次不同验证的证据。

处置：保留 `a01-shell.png`（1440×868），重拍后两张，并用真实窗口尺寸区分：

| 截图 | 验证 | 内容尺寸 | outer 窗口 | SHA-256 |
|---|---|---|---|---|
| `a01-shell.png` | 桌面壳页面 | 1440×868 | 1440×900（由内容尺寸推得；抓图命令未留存） | `32557c5c…`（仅此一处） |
| `a01-offline-launch.png` | `open` 启动 + 离线模拟 | 1280×788 | 1280×820 | `cb5bbeaa…` |
| `a01-offline-green.png` | 回退恢复后离线启动 | 1200×768 | 1200×800 | `02a2eea4…` |

窗口尺寸由 renderer 侧 `window.resizeTo(w,h)` 真实改动（不是截图裁剪或视口模拟），
两张日志分别记录了 `run_at`、PID、完整启动命令与 `window_inner_x_outer`：

- 恢复后绿灯：`a01-green-restored.log`（PID 15230，outer 1200×800 / inner 1200×768）。
- `open` 预检：`a01-open-offline.log`（PID 15318，outer 1280×820 / inner 1280×788）。

为记录这些信息，`a01-packaged-offline-launch.mjs` 与 `a01-open-offline-check.mjs` 增加了
可选的 `CUNLIAN_WINDOW_WIDTH` / `CUNLIAN_WINDOW_HEIGHT` 与 `run_at`/PID/命令日志；
不设置这两个环境变量时行为与红/绿实验时一致（断言与退出码未改，红/绿结论不变）。

完整证据清单（文件 → 命令 → 时间 → 运行者 → 任务卡章节）：`docs/v3-a/evidence/README.md`。
