# V3-B2 补丁：替换模型后 WebGLRenderer 初始化失败（alpha TypeError）根因与修复

分支：`agent/dsh-v3-A`（沿用 B2 分支，不新开分支/工作树）
日期：2026-11-09
范围：只动 `ModelViewport` 的 canvas 生命周期、`modelScene` 的上下文有效性检查，以及对应测试；未动 `src/domain/**`、未做 C/D、未改 B1 的 `threeScene`。

## 1. 现象

- 连续「导入 → 替换 → 替换」模型时，偶发 `WebGLRenderer 初始化失败（Cannot read properties of null (reading 'alpha')）`，`<canvas>` 从 DOM 消失（`canvasCount = 0`），界面进入 3D 降级，点“重试 3D 视图”可恢复。
- 重启应用、打开同一项目仍复现过一次，重试即好。

## 2. 根因（已用真实 Chromium 验证，不是推测）

链路：

1. `ModelViewport` 的建场 effect 以 `geometry.revisionId` 为依赖；替换模型后 effect 重跑，先执行 cleanup：`current?.dispose(true)`。
2. `dispose(true)` 在 `src/parts/modelScene.ts` 末尾调用 `WEBGL_lose_context.loseContext()`，把 **当前 canvas 元素** 的上下文丢为终态。
3. 旧实现的 canvas 是 React 里的 `<canvas key={generation}>`；替换模型时 `generation` 不变，**同一个 canvas DOM 节点被复用**。
4. 新 effect 对同一个 canvas 调 `canvas.getContext('webgl2')`。浏览器语义：上下文丢失后再次 getContext **原样返回同一个已丢失的上下文**，`getContextAttributes()` 返回 `null`。
5. `modelScene` 只判断了 `if (!gl)`，`gl` 非空（是丢失的旧上下文），继续交给 three r187。`node_modules/three/build/three.module.js` 第 15930 行：
   `_alpha = context.getContextAttributes().alpha;`
   `getContextAttributes()` 为 `null` → 抛出正是 `Cannot read properties of null (reading 'alpha')`，被包成 `RENDERER_INIT_FAILED`。

为什么“偶发”而不是每次都被看见：

- 组件层实测（下方第 3 节）是 **确定性的**：只要画布被复用，下一次建场必失败。
- 失败后 `status='error'`，旧 JSX 把 canvas 卸载；此后继续“替换”时 `canvasRef.current` 为 `null`，effect 直接 return，不会再有建场尝试，所以界面上只留下第一次错误。点“重试”时 `generation` 自增、React 新建 canvas 节点，因此能恢复；恢复后下一次替换又会踩同一问题。
- 重启应用不会重置这条链路（它不依赖跨会话泄漏的上下文数量），所以重启后仍能复现一次。
- 排除“上下文数量超限”：`dispose(true)` 已经 `loseContext()` 释放；同一页面用 8 个新 canvas 连续建场/释放 8/8 成功（见 3.2）。

## 3. 复现与验证（真实 Chromium + 真实 three 0.187 / WebGL2）

探针页面用 Vite dev 加载真实 `src/parts/modelScene.ts` 与真实 `ModelViewport`（不是 mock），跑完即删，未入库。

### 3.1 浏览器语义（data: 页，Chrome）

```
== before: { has: true, attrs: true, lost: false }
== loseContext() 后立刻：
{ same: true, attrs: 'null', lost: true }
```

即：同一 canvas 再次 `getContext('webgl2')` 返回同一个对象（`same: true`），`getContextAttributes()` 为 `null`。等待 0.05s / 0.2s / 0.5s / 1s / 2s 复查，仍为 `null`、`isContextLost() === true`（没有自动恢复）。

### 3.2 修复前的组件层复现（真实 React + 真实 ModelViewport + 真实 modelScene）

连续把 `geometry.revisionId` 从 rev-0 换到 rev-1…rev-5：

```
states: [
 {"i":0,"state":"error","canvases":0,"attempts":2,
  "last":{"attempt":2,"canvasKnown":1,"canvasConnected":true,"glAttrs":"lost","ok":false,
          "error":"RENDERER_INIT_FAILED: WebGLRenderer 初始化失败（Cannot read properties of null (reading 'alpha')）"}},
 … i=1..5 相同（attempts 停在 2，canvases=0）
]
```

- `canvasKnown:1` = 第二次建场拿到的 canvas 就是第一次那张；
- `glAttrs:"lost"` = 建场前上下文已丢失；
- 报错文本与用户看到的一致。

同一页面另做“每次换新 canvas”对照：8/8 成功：

```
fresh-canvas#0..#7: ok:true（8/8）
```

### 3.3 修复后同一路径（真实 Chromium，6 次替换 = 7 次建场）

```
i=0..5: state=ready, canvases=1, attempts=1..6,
last: { canvasKnown:null, canvasConnected:true, glAttrs:"ok", ok:true }
最终 DOM: canvases=1, window errors=[]
```

StrictMode 下（React 开发态双挂载）替换 4 次：全部 `ready`、每次 `canvases=1`、`attempts=1..4`、无错误。

contextlost 后重试（真实场景对象回调触发降级）：

```
dispatched → { state:"error", canvases:1, alert:true }
retry → { state:"ready", canvases:1, attempts:7, last:{ glAttrs:"ok", ok:true } }
rebuilt: true（新 canvas !== 旧 canvas），errors:[]
```

## 4. 修复内容

1. `src/components/ModelViewport.tsx`
   - canvas 不再由 JSX 渲染并跨版本复用；改由建场 effect **每次创建新的 `<canvas>`** 插入 stage，cleanup 时 `dispose(true)` 后 `canvas.remove()`。
   - 替换模型、重试、StrictMode 双挂载都会得到全新 canvas；任意时刻 DOM 中只有一张 canvas。
   - 失败路径不再依赖“canvas 被 React 卸载”；重试按钮仍走同一 effect（`generation` 自增），幂等。
2. `src/parts/modelScene.ts`
   - 拿到 `gl` 后增加 `gl.getContextAttributes() === null` 的显式检查，报 `WEBGL2_UNAVAILABLE（画布 WebGL2 上下文已失效，需要新建 canvas 后重试）`，不再把 three 的 alpha TypeError 泄漏到界面。
3. `src/components/ModelViewport.css`
   - 给 loading / fallback 覆盖层加 `z-index: 1`，canvas 改由 effect 插入为 stage 首个子节点后仍被覆盖层正确遮挡。

## 5. 自动化用例（新增 2 文件 / 4 用例）

- `src/components/ModelViewport.test.tsx`
  - 连续替换 6 次（7 次建场）全部 `ready`；7 次拿到的 canvas 互不相同；旧场景释放 6 次；DOM 始终 1 张 canvas。
  - 初始化失败 → 显示 `RENDERER_INIT_FAILED` → 点重试 → 新 canvas 成功、DOM 仍 1 张 canvas。
  - contextlost → 降级 → 重试：旧场景只释放一次、新 canvas 不同、canvas 不叠加。
  - 伪场景模块复刻浏览器语义：`dispose(true)` 后同 canvas 建场即抛同一个 alpha TypeError。
- `src/parts/modelScene.test.ts`
  - 用 `getContextAttributes() === null` 的假上下文验证显式 `WEBGL2_UNAVAILABLE`，并断言消息不含 `alpha`。

回归证明（变异：把 canvas 改回跨版本复用）：

- 红：`logs/fix-canvas-mutation-red.log` → 3 failed / 3（组件用例全红，`Expected: "ready" Received: "error"`）。
- 绿：还原后 `logs/fix-canvas-green.log` → 2 files / 4 passed。

## 6. 全套命令与结果

| 命令 | 结果 | 日志 |
|---|---|---|
| `npm test` | 68 files / 713 passed（基线 66/709，新增 2/4） | `logs/fix-canvas-test.log` |
| `npm run test:desktop` | 17 files / 127 passed（与基线一致） | `logs/fix-canvas-test-desktop.log` |
| `npm run typecheck` | exit 0 | `logs/fix-canvas-typecheck.log` |
| `npm run typecheck:desktop` | exit 0 | `logs/fix-canvas-typecheck-desktop.log` |
| `npm run lint` | exit 0 | `logs/fix-canvas-lint.log` |
| `npm run build` | exit 0；modelScene/threeScene 仍为独立 chunk | `logs/fix-canvas-build.log` |

## 7. 能否稳定复现

- 在组件/场景这一层：**可以稳定复现**（修复前每次替换必失败），不是概率问题；用户侧“偶发”是错误出现后 canvas 被卸载、后续替换不再尝试建场所致。
- 在真实打包 Electron 应用的完整 UI 流程（含文件选择/解析/提交）上：本次未重跑打包 app 的端到端流程；证据来自同一 Chromium/WebGL2 内核下运行真实 `ModelViewport` + 真实 `modelScene` + 真实 three。这一边界不记为“已通过打包 app 验证”。

## 8. 未做 / 已知边界

1. 未改 `src/domain/**`、未做 C/D、未改 B1 `threeScene` 的行为与用例。
2. 未合并/推送/删除分支；提交留在 `agent/dsh-v3-A`。
3. 未对打包 .app 重新做真实窗口端到端取证（见第 7 节）。
4. contextlost 事件后到点重试前，失效 canvas 仍留在 stage 内（被降级遮罩覆盖，不参与渲染）；重试时随 cleanup 移除，任何时刻 DOM 中 canvas 数量 ≤ 1。
