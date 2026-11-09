# A-01 桌面壳 · 实现与实测记录

分支：`agent/dsh-v3-A`（工作树 `/Users/aston/DSH/wt/dsh-v3-A`）
日期：2026-11-09
环境：macOS 26.4 (25E246)、arm64、宿主 Node v26.12.1、npm 11.20.0

## 交付范围（只做任务卡第 6 节 A-01）

| 任务卡要求 | 实现文件 |
|---|---|
| app 生命周期、单窗口、菜单、退出保护 | `desktop/main/index.ts`、`desktop/main/menu.ts`、`desktop/main/closeGuard.ts` |
| BrowserWindow 安全配置与生产资源加载 | `desktop/main/window.ts`、`desktop/main/rendererUrl.ts` |
| 受限 IPC、sender 校验、DTO 契约 | `desktop/main/ipc.ts`、`desktop/main/senderGuard.ts`、`desktop/shared/contracts.ts` |
| preload 只暴露具体函数 | `desktop/preload/index.ts` |
| Forge/Vite 配置、桌面入口 | `forge.config.ts`、`vite.main.config.ts`、`vite.preload.config.ts`、`vite.renderer.config.ts`、`index.desktop.html`、`src/desktop/{main.tsx,ShellApp.tsx,window-cunlian.d.ts}` |
| 桌面 tsconfig 与测试配置 | `tsconfig.desktop.json`、`vitest.desktop.config.ts` |
| 新增 scripts（不覆盖现有） | `start:desktop`、`package:desktop`、`make:desktop`、`typecheck:desktop`、`test:desktop`、`test:desktop:e2e` |

## 安全与协议实现要点

- BrowserWindow：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、
  `webSecurity: true`、`allowRunningInsecureContent: false`、`webviewTag: false`；
  preload 产物为 CJS `preload.cjs`（未因 ESM 配置关闭 sandbox）。
- 导航与窗口：`will-navigate` 一律 `preventDefault`；`setWindowOpenHandler` 返回 deny；
  `will-attach-webview` 拒绝；权限请求全部拒绝。
- IPC：`installChannel` 统一做 sender 白名单（登记 WebContents + 主框架 + 精确 frame URL）
  → zod schema → handler → `{ok:true,value}` / `{ok:false,error:{code,message,detail?}}`。
  未注册 channel 不注册 handler，Electron 直接 reject。
- 退出保护：`window:request-close` 与窗口 `close` 事件、⌘Q 共用
  `editor:flush → editor:flushed` 编辑屏障，超时返回 `EDITOR_TIMEOUT` 且不关闭窗口；
  同一窗口防重入（`BUSY`）。
- 生产入口只从 `app.asar` 内 `file://.../index.desktop.html` 加载；开发只接受
  Forge 注入的 loopback http 地址，拒绝 https 与远程主机。

## 实测命令与真实输出

### 类型检查 / lint / 浏览器回归

```
$ npm run typecheck            # exit 0（tsc -p tsconfig.app.json && tsc -p tsconfig.node.json）
$ npm run typecheck:desktop    # exit 0（tsc -p tsconfig.desktop.json）
$ npm run lint                 # exit 0
$ npm test                     # Test Files 54 passed (54) / Tests 557 passed (557)
$ npm run build                # exit 0，dist/assets/index-*.js 1,234.51 kB
```

### 桌面单元测试

```
$ npm run test:desktop
 Test Files  4 passed (4)
      Tests  26 passed (26)
```

覆盖：sender 登记/销毁/子框架/非法 URL 拒绝、未注册 channel 不可调用、参数 schema 拒绝且
不回显原始值、IpcFailure 业务码透传、未知异常统一 INTERNAL、CloseGuard 超时/跨窗口回复/
无效 editSeq/防重入/dispose。

### 打包

```
$ npm run package:desktop -- --arch=arm64
✔ Packaging for arm64 on darwin
✔ Packaging application
PACKAGE_EXIT=0
```

> 以上是网络可用条件下的记录。断网/不可达代理条件下**不能**打包成功，
> 实测与归因见下文“未实现项与已知风险”最后一条。

产物：`out/寸链-darwin-arm64/寸链.app`，实测 `du -sh` = **253M**。

### 打包产物离线冒烟（真实 Electron）

```
$ npm run test:desktop:e2e
PASS 窗口标题为 寸链
PASS 渲染出桌面壳内容
PASS window.cunlian 只暴露具体函数
PASS 没有通用 IPC 转义口 / Node 全局
PASS 页面没有远程资源请求
PASS 子框架拿不到 preload 桥
PASS requestClose 经编辑屏障后返回 closed
PASS renderer 实际收到 editor:flush
PASS 关闭流程结束后窗口销毁
E2E_RESULT=PASS
```

完整日志：`docs/v3-a/evidence/a01-e2e.log`
窗口截图：`docs/v3-a/evidence/a01-shell.png`（内容 1440×868，内容为“寸链 · 桌面壳”；
这是页面区截图，不含窗口标题栏。该图抓取命令当时未留存，仅以文件 mtime 定位）。
离线启动与恢复后截图见 `docs/v3-a/evidence/README.md` §4（三张图已用不同窗口尺寸区分，
SHA-256 不再相同）。

## 与任务卡的文字偏离（如实登记）

1. 任务卡写“main 指向 `.vite/build/main.js`”，Forge 8.0.1 的 Vite 插件默认输出
   `[name].cjs`；实测 `package.json` 的 `main` 用 `.vite/build/main.cjs`，并通过
   `vite.main.config.ts` 固定产物名。preload 同为 `.cjs`。
2. 任务卡把 `recovery.ts`/`recentProjects.ts` 列在 A-01 文件清单里，但第 6 节明确
   “恢复草稿/最近项目由 A-04 做”；本组未创建这两个文件，避免越界。
3. `desktop/main/menu.ts` 已提供 new/open/save/saveAs/importV2/close 菜单项并发
   `menu:action`；这些动作的会话处理属 A-04，A-01 不打开任何项目。
4. 未实现 `exportDrawingPdf`、3D/STL/SVG/PDF 出图；未接入 autoUpdater。

## 未实现项与已知风险

- **dirty gate（保存/不保存/取消）未实现**：属 A-04 会话层。A-01 只保证“关闭前必须完成
  编辑屏障”，当前没有活动项目，因此不存在未保存内容；`closeGuard` 已留出接入点。
- **UNKNOWN channel 的验证方式**：Electron 没有“未注册 channel 的全局钩子”，实测方式是
  未注册时为 reject + renderer 不被暴露 `ipcRenderer`（e2e 已断言无通用转义口）。
- **SIGTERM 行为**：测试进程收到 SIGTERM 时曾因退出流程拦截而残留（由探针脚本
  `child.killed` 判断错误叠加导致），e2e 收尾改用 SIGKILL；应用自身的 ⌘Q/红点关闭已实测
  走通屏障。SIGTERM 下的退出语义未单独立项验收。
- **`electron-forge start` 开发热更新未实测**，只验证了 package + 生产启动。
- **离线断网 Finder 双击**属 A-MAC-1 正式验收，需 A-05 在真实断网条件执行；本记录只证明
  本地 file:// 加载、无远程资源请求，不冒充 MAC-01 通过。
- 未签名/未公证：本机产物可启动，不等于另一台 Mac 可交付（任务卡 §10 待用户拍板）。

### 纯离线打包实测（失败，如实登记）

2026-11-09 01:33 PST，在“不可达代理”条件下实测 `npm run package:desktop -- --arch=arm64`
（未改系统网络设置，用 `ELECTRON_GET_USE_PROXY=true` + `HTTP(S)_PROXY=http://127.0.0.1:9`、
`NO_PROXY=` 让 HTTP(S) 必然失败）：

```
✖ Copying files [FAILED: fetch failed]
✖ Packaging for arm64 on darwin [FAILED: fetch failed]
✖ Packaging application [FAILED: fetch failed]
TypeError: fetch failed
EXIT=1
```

失败位置固定为 `Packaging application → Copying files`（Electron 二进制/校验文件获取阶段），
不是 Vite 构建失败。`@electron/get` 的 DEBUG 轨迹（`a01-offline-package-trace.log`）显示：

```
Checking the cache …/electron-v45.2.3-darwin-arm64.zip → Cache hit
Downloading https://github.com/electron/electron/releases/download/v45.2.3/SHASUMS256.txt
Artifact in cache didn't match checksums [TypeError: fetch failed]
falling back to re-download
Downloading …/electron-v45.2.3-darwin-arm64.zip → fetch failed
```

即：**zip 已在 `~/Library/Caches/electron` 命中缓存也不够**。`@electron/get` 5.1.0 的
`validateArtifact` 对 `SHASUMS256.txt` 固定使用 `cacheMode=Bypass`（源码注释：
`Never use the cache for loading checksums, load them fresh every time`），拿不到校验文件就把
缓存 zip 判为不匹配并回退重新下载。空缓存（`HOME` 指向空目录）时则直接 `Cache miss` → 下载 zip 失败。

结论：当前 Forge 8.0.1 + `@electron/get` 5.1.0 组合下**纯离线无法打包**，没有“只预热某个缓存
就能离线打包”的路径；至少需要一次可访问 GitHub releases 的网络（用于 `SHASUMS256.txt`）。
若必须离线构建，需要改 Forge/打包器配置（例如 `electronZipDir` 指向本地 zip，或
`download.unsafelyDisableChecksums`，后者降低校验强度、需用户拍板）——本轮按要求未改代码/配置。
证据：`docs/v3-a/evidence/a01-offline-package-{warm-cache,trace,empty-cache,empty-cache-trace}.log`。

因此，本分支**不能**记为“断网环境可构建”；交付只能分发已构建的未签名 `.app`，或在有网环境
重新执行 `npm run package:desktop -- --arch=arm64`。上面的打包成功记录均来自网络可用条件。
