# S05 followup-05：持续租约下独立编辑累积

状态：实现、自测与成包实测完成，交再次独立复核；不代替独立验收/发布批准。

工作树：/Users/aston/DSH/tmp/cunlian-v4/slop-cleanup
分支：agent/S05-followup-05
基线：913e2aa2883b3d3a05a6ac1fabd880c3e2854126（开工干净）。git worktree/进程检查未发现该仓库的并行实现进程。
最终测试、打包对应提交：1c3261316a86a62e350ffe53d81b02915289d16f。后续交付提交只增加本文。
证据根目录：/Users/aston/DSH/tmp/cunlian-v4/slop-cleanup-evidence/followup-05

## 分段提交

- 01a9dda：先提交真实 useDesktopSession + DesktopSessionAdapter + resolveDraft/workspaceReducer 的 RED。
- 6a0c59d：独立 renderer 排队编辑投影；hook 与真实桌面受控输入读同一投影；补释放/切换覆盖。
- 1c32613：强化租约前发出的 reattach 回执到达 resetState 时，两个独立编辑均不得被清掉。

## RED 与根因

命令：`./node_modules/.bin/vitest run src/workspace/queuedEdits.test.tsx`

logs/01-red.log 完整输出，实际 exit=1，5 tests / 5 failed。首轮退出码也记录在执行工具原始回执 RED_EXIT=1；该轮先于 run-command.mjs，没有另造 exit.json。

不是手工把 A 塞进 B 快照：真实 renderHook 挂载 useDesktopSession，通过真实租约 listener，然后连续调用返回的 edit(action)。每次输入均由生产 resolveDraft/workspaceReducer 计算。

- assumptions=FIRST EDIT MUST SURVIVE 后设 targetMin=1/targetMax=2：第一处被覆盖回夹具原值“合成示例数据”。该夹具原值不为空，但与退回复现是同一个 stale-basis 覆盖缺陷。
- 两不同组成环：第一处 nominal 原始非法文本被覆盖，termRevision/relationRevision 也丢失。
- 独立项目快照改名后两次 hook 草稿操作：项目名被覆盖回原名，第一处草稿操作也丢失。

原因：队列保存的是完整替换快照，下一次 hook 却从冻结 state.snapshot 重新计算。localSeq=2、队列长度=2 或同字段最后值正确均不是独立操作保留证明。

## 精确编辑语义与改动范围

仅修改三个生产文件：src/workspace/desktopAdapter.ts、useDesktopSession.ts、src/pages/DesktopWorkspace.tsx；另外两个测试文件。未改 main、导出/store/nonce/rename、领域精度、依赖或锁文件。

1. state.snapshot 保持原租约的冻结基准；localSeq/acceptedSeq/savedSeq 不因排队提前递增。不把 renderer 编辑投影 stage 给 main，也不改已导出输入。
2. 新增 state.editingSnapshot，仅为 renderer 排队编辑投影；每次完整 edit(snapshot) structuredClone 入原队列，并把最后排队结果发布为投影。
3. adapter.getEditingSnapshot() 返回 editingSnapshot ?? snapshot。hook 的唯一生产本地读-改-写入口从它调用 resolveDraft/workspaceReducer，B 因而确实读 A 的结果。DesktopWorkspace 同样用该投影显示受控输入，避免表单渲染仍用冻结值。
4. edit(snapshot) 仍是明确的完整替换语义，不猜测 delta、不把任意手工 stale 全快照解释为独立操作。调用方做读-改-写时必须用 getEditingSnapshot；当前生产源码只有 hook 这一个本地 edit 调用方，已接线。没有另外复制一套 hook 队列或 reducer。
5. 匹配 nonce/session 的 release 先清 editingSnapshot，再按原顺序接纳队列，每次 localSeq +1；恢复原防抖 stage，不自动保存。两个独立输入释放后 localSeq +2，完整最终 snapshot 与排队投影逐字一致。重复/旧 release 不重放、不重复 stage。
6. 无排队编辑的 release 不制造 dirty。resetState/会话切换在租约内仍明确拒绝，不能清队列；正常切换后不携带旧投影。租约超时、失败/异常释放保留两处独立字段。
7. 原先保存后导出、sender/nonce/会话隔离、main 单调截止、rename 同步线性化及第三次 flush 禁止均保留。没有加 sleep、延长租约、第三次 flush 或自动保存。

## 专项与生命周期证据

- logs/02-green.log：原 5 条 RED 全绿，exit=0。
- logs/05-hook.log：`vitest run src/workspace/queuedEdits.test.tsx src/workspace/useDesktopSession.test.tsx`，2 files / 9 passed，exit=0。
- logs/06-focused.log：`vitest run --config vitest.desktop.config.ts desktop/tests/savedExportBarrier.test.ts desktop/tests/savedVersionExport.test.ts desktop/tests/agentExport.test.ts desktop/tests/desktopAdapter.test.ts desktop/tests/closeGuard.test.ts`，5 files / 62 passed，exit=0。
- logs/14-reset-focused.log：最终强化 reset 用例，savedExportBarrier 34 passed，exit=0。

真实 main/service/store 失败矩阵将旧“同字段最后名字”改成真实 reducer 依次产生的 assumptions + target：write-failed/read-failed/exception/closed/navigation/timeout/adapter-dispose 均断言两处完整输入，且正式项目字节未变、不自动保存。继续覆盖失联/丢 release、旧 nonce/session、多窗口隔离、提前计时器等原边界。hook 覆盖正常/超时/拒绝普通 flush 后释放、两不同组成环（含非法原始文本与修订号）、项目+草稿混合、投影展示、切换后无残留。

中间失败 logs/03-hook.log 保留，exit=1：新增清投影断言用 toMatchObject({editingSnapshot:undefined})，重置状态合法地省略了这个 optional key，Vitest 不把“缺 key”视为“显式 undefined”。改为直接 `expect(state.editingSnapshot).toBeUndefined()`；未放宽值保留、序号或 dirty 断言。没有产品缺陷被标作通过。

## 最终全量回归与真实退出码

命令：`node scripts/gt-expand-gates.mjs ../slop-cleanup-evidence/followup-05/final-verification-02`

logs/15-final-gates.log、final-verification-02/gates.json 与 logs/：总 exit=0，11 步全为 exit=0、signal=null、无超时。

- npm run typecheck：0
- npm run typecheck:desktop：0
- npm run lint：0
- npm test：131 files / 1360 passed
- npm run test:desktop：61 files passed / 1 skipped；447 passed / 15 skipped（未跑付费模型，不计通过）
- npm run test:mcp：3 files / 22 passed
- npm run build：built in 240ms
- npm run test:real-docs：5 files / 19 passed
- real-doc-metrics：nominal 58/58、上下偏差各 20、wrongPending=0、BASELINE MATCH（6 份文档）
- npm run package:desktop：0
- npm run check:package:pdf-worker：0

另：logs/08-audit.log，`npm audit --json` exit=0，vulnerabilities.total=0。
logs/09-package-step.log，`npm run check:package:step -- 'out/寸链-darwin-arm64/寸链.app/Contents/Resources'` exit=0；只代表资源检查，不冒充几何验收。

## 最终实际成包验证

包：out/寸链-darwin-arm64/寸链.app
app.asar SHA-256：26e382a819014e21161d98825d75dff132491c602fedc46639a11eda39710d94

命令（所有命令的完整 argv/退出码另见 logs/*.exit.json）：

    node ../slop-cleanup-evidence/followup-05/packaged-lease-probe.mjs 'out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链' ../slop-cleanup-evidence/followup-05/product-final
    node scripts/saved-export-packaged.mjs 'out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链' ../slop-cleanup-evidence/followup-05/product-normal-final
    node ../slop-cleanup-evidence/followup-05/packaged-step-probe.mjs 'out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链' ../slop-cleanup-evidence/followup-05/product-step-final

- logs/16-product-final.log：exit=0，product-final/result.json 92 checks / 4 runs PASS；write/read 两个真实临时 IO 窗口各两次。真实 main、UI hook/adapter、ProjectService、DrawingExportStore；先委托真实磁盘 IO，再 Promise 栅栏悬停。通过两个真实输入事件分别改 H nominal 与目标下限，没有调用 probe 自写 reducer 或伪造 B 快照。断言两处投影值、冻结 snapshot/序号未变、实际 rename 时 lease/canCommit=true/main clean，释放后完整投影逐字保留且只增加 2 次序号，未显式保存前项目原字节未变。随后点真实保存，解码实际项目验证完整 draft 持久化，再导出 SVG 比对已保存 project 重建结果。每轮只有 initial flush + acquire + release，无第三次 flush。
- product-final/*-queued.png、*-replayed.png：真实页面截图。write-1-queued 可见“两次编辑已排队”与 H 新值；目标下限在滚动区域下方，截图本身不证明其值，值由同轮真实 DOM/投影读回和完整持久化比较证明。
- logs/17-product-normal-final.log：exit=0，16 checks PASS；未保存即导出拒绝，不打开目标对话框/不改源文件，显式保存后 SVG/PDF 正常。PDF 使用真实解析器读回长度标注，不只是文件头。
- logs/18-product-step-final.log：exit=0，7 checks PASS；实际 packaged IPC/worker 生成 STEP，落盘 size/hash 与真实回执一致，历史冻结 generationInput 未变，实际使用 packaged pinned wasm。
- logs/19-step-native-final.log：既有项目内 OCP reader Python 执行 native-readback.py，exit=0、ACCEPTED。1 solid / 1 closed shell / 4 analytic faces；半径 10/16 mm、包围盒 ±6/±16/±16 mm；体积误差约 1.25338e-10 mm³，保持原线性阈值 1e-6 mm 与体积阈值；孔内/材料点分类及布尔探针均通过。原生报告 product-step-final/native-readback.json。
- 上述实际产品进程退出均 code=0/signal=null。探针源码快照、完整回执、原始日志与截图均归档，输出目录 wx 拒绝覆盖。首轮 product/product-normal/product-step 是前一次打包的实测，最终结论使用 *-final。

汇总：`node ../slop-cleanup-evidence/followup-05/summarize.mjs`，logs/20-summary.log exit=0，results-summary.json 程序核对门禁总数、每个退出码、92 checks/4 runs、实际 SVG/STEP hash、完整投影保留、当前 asar hash 与测试时干净工作区。

## 未完成/已知边界

- 没有未完成的本次实现项；尚待用户要求的再次独立复核，不自行宣告独立验收通过。
- 15 付费模型未运行，真实模型端到端不计通过。
- 原生对话框由 debugger 代返选择，未测原生对话框 GUI 操作；产品 IO 与导出/worker 不替代。成包悬停窗口验证 SVG，共用协议 PDF 正常路径另测，没有宣称 PDF 专属悬停窗口复测。
- STEP 原生读回使用 OCP/OCCT 同内核家族，不是第二厂商 CAD 互通或无内部 healing 证明；原 provenance/LGPL/发布法律门禁不改变。
- 没有 merge/push/tag/release/付费/改权限/全局安装；未覆盖历史日志或改动其他工作树。
