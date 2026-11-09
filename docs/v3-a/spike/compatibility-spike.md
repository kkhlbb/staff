# 兼容性 spike：Electron 45.2.3 + Electron Forge 8.0.1 + 现有 Vite 8.3.5

日期：2026-11-09（UTC 2026-11-09T08:54Z–08:59Z）
分支：`agent/dsh-v3-A`（从 main = 10c4564 创建）
工作树：`/Users/aston/DSH/wt/dsh-v3-A`

## 结论

通过。`npm run package:desktop -- --arch=arm64` 实际打包出 arm64 `.app`，产物从
`app.asar` 加载本地 `file://` 渲染资源并正常显示窗口；渲染进程无 `require`/`process`，
`contextIsolation` 生效，页面没有发出任何网络资源请求（`performance.getEntriesByType('resource')`
为空）。

## 实际安装的依赖（仅项目内 `npm i -D`，未全局安装）

```
npm i -D --save-exact electron@45.2.3 @electron-forge/cli@8.0.1 \
  @electron-forge/plugin-vite@8.0.1 @electron-forge/shared-types@8.0.1
added 373 packages, and audited 374 packages in 21s
```

Electron 实际版本（`./node_modules/.bin/electron --version`）：`v45.2.3`
（`node_modules/electron/package.json` 解析值 45.2.3，`dist` 267 MB）

环境：macOS 26.4 (25E246)、arm64、Node v26.12.1（宿主）、npm 11.20.0。

## 兼容性判断依据

`node_modules/@electron-forge/plugin-vite/package.json` 的 devDependencies 声明
`vite: ^8.0.0`，与仓库现有 `vite ^8.3.5`（解析 8.3.5）同代，未观察到 Forge 插件对 Vite 8
的 API 冲突。spike 未降级/升级 Vite 或 React。

## 首次失败与修正（保留原文）

第一次打包失败，原因是 Forge Vite 插件用入口文件名生成 `[name].cjs`，主进程与 preload
入口都叫 `index.ts`，撞成同一个 `.vite/build/index.cjs`；而 `package.json` 的 `main`
指向 `main.cjs`：

```
✖ Finalizing package [FAILED: The main entry point to your app was not found.
  Make sure ".../.vite/build/main.cjs" exists ...]
```

修正：在 `vite.main.config.ts` 把 `build.lib.fileName` 固定为 `main.cjs`；在
`vite.preload.config.ts` 把 `rollupOptions.output.entryFileNames` 固定为 `preload.cjs`，
保持 preload 为 CJS 且不关闭 `sandbox`。修正后打包退出码 0。

## 打包命令与输出（节选）

```
$ npm run package:desktop -- --arch=arm64
✔ Building desktop/main/index.ts
✔ Building desktop/preload/index.ts
✔ Built target main_window
✔ [plugin-vite] Building production Vite bundles
✔ Packaging for arm64 on darwin
✔ Packaging application
PACKAGE_EXIT=0
```

产物：`out/寸链-darwin-arm64/寸链.app`（253 MB，实测 `du -sh`）。

## 离线启动实测

用 CDP 连接打包应用（仅验证时用 `--remote-debugging-port=9223` 启动参数，未写入代码）：

```
TARGET_URL=file:///Users/aston/DSH/wt/dsh-v3-A/out/%E5%AF%B8%E9%93%BE-darwin-arm64/%E5%AF%B8%E9%93%BE.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.desktop.html
TARGET_TITLE=寸链
BODY_TEXT="寸链\n\n桌面壳兼容性 spike"
HAS_REQUIRE=undefined
HAS_PROCESS=undefined
HAS_CUNLIAN=object
PERF_RESOURCES=[]
SHOT=/tmp/spike-shot.png
```

截图证据（spike 阶段临时目录）：`/tmp/spike-shot.png`，窗口 1440×900，显示“寸链 /
桌面壳兼容性 spike”。正式 A-MAC-1 的断网 Finder 验收仍需 A-05 按任务卡执行，此处不作为
MAC-01 通过。

## 风险备注

- Forge 的 Vite 插件仍标注 experimental；本次只验证了打包与启动，未验证 `electron-forge start`
  的开发热更新路径。
- `app.asar` 内路径通过 `file://` 加载；renderer base 为 `./`（插件默认），本 spike 未引入
  字体/PDF worker 等额外资源，A-MAC 离线资源要求需在引入 pdfjs 后再次验证。
