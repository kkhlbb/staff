# S05 followup-04：持续导出提交边界

状态：实现、自测与实际成品复验已完成，交主控再次独立复核；不代替独立验收或发布批准。

工作树：/Users/aston/DSH/tmp/cunlian-v4/slop-cleanup
分支：agent/S05-followup-04
起点：ee2742e9eefbf7bd15998b020fa59c4b0f2726ac，开工工作树干净。
最终测试/打包对应代码提交：31c2a0657e47c6f74660b7e65d013fb189c1268d。其后的本交付提交仅新增本文。
证据根目录：/Users/aston/DSH/tmp/cunlian-v4/slop-cleanup-evidence/followup-04

## 分段提交

- 52743c09b76375437ddc747fa54a481ae1cc9138：先提交真实 adapter + model service + ProjectService + store 栅栏 RED。
- 2c018e1826273330ac0db62126fd3371e58eca92：最终阶段持续编辑租约、UI/adapter 统一接线、初步生命周期覆盖。
- 9a078b1dc90fe3621f37af8a9cc07266ab55b625：超时/旧回执/全部程序化编辑请求覆盖；显式补装 main-only 离线 IO 夹具端口。
- 31c2a0657e47c6f74660b7e65d013fb189c1268d：renderer 自行到期释放还须单调时钟确实到期，不能仅相信定时器触发；新增对应测试。

## 真实 RED，不沿用未运行探针

命令：

    ./node_modules/.bin/vitest run --config vitest.desktop.config.ts desktop/tests/savedExportBarrier.test.ts -t 'continuous boundary'

logs/01-red.log：exit=1，2 failed / 16 skipped。悬停临时 write、read 两个用例都实际得到 `successfulExportOfOldVersionAfterAcceptedEdit: true`，期望为 false。

用例通过真实 DesktopSessionAdapter.edit 产生默认 250ms 防抖窗口；进入真实 AgentToolService.run('export')、ProjectService 和 DrawingExportStore，用内存 FileOps 的 Promise 栅栏控制临时 IO，不用直接 main.stage 代替 renderer 编辑，不推进 250ms，不复制服务回执。

同一核心断言在 GREEN 未放宽：导出可以取消；或 renderer 新操作必须尚未被接纳，提交后再回放。最终采用后者，满足“rename 前不能有已经接纳、main 却不知情的编辑”。

## 最小安全协议与线性化点

选择：仅在最终写入阶段短暂暂缓接纳编辑，而非在生成/系统对话框期间长时间禁用工作台。没有第三次 flush，没有 sleep，没有取消防抖，没有自动保存。

1. 初始 clean/对象/序号/路径/指纹捕获与初始可信 flush 保留。读取、解码、生成、系统对话框、目标指纹期间仍可编辑，原有每个 await 后的 unchanged 检查保留。
2. 原第二次瞬时 flush 替换为 controller.acquireExportLease。main CloseGuard 生成不可由模型参数指定的 nonce（requestId），捕获实际会话对象和窗口，在 main 建立单调时钟截止时间，再发 `editor:flush {requestId, exportLease:{action:'acquire',sessionId,durationMs:30000}}`。
3. renderer 的同一个 DesktopSessionAdapter.handleEditorFlush 同步安装租约，之后才 await flushStage。UI useDesktopSession 不再另写一个仅做瞬时 flush 的 listener。普通 bind 和真实 UI 共用此实现。
4. renderer 只在 stage 成功、绑定代次/会话未变、localSeq=acceptedSeq 且租约仍在时回 `exportLeaseHeld:true`。main 仍核对 sender、nonce、捕获会话对象与自己实际 acceptedSeq；普通旧 flush 回执、缺端口、失联、超时、失败均不放行。
5. 租约期间 adapter.edit 的完整快照被 structuredClone 后按调用顺序排队，不更新权威 snapshot/localSeq，不 stage、不保存。通知明确显示“编辑已排队，提交结束或超时后接纳，不会自动保存”。这不是已接纳编辑，也不将 main 尚不知道的编辑伪装成 clean。
6. 其他会发起编辑/保存/切换的 adapter 程序化入口明确抛出“此操作尚未执行，请结束或超时后重试”，而不是 UI-only 禁用或静默成功。测试逐个覆盖这些入口。main 已完成操作的权威回执重同步不当作新编辑请求吞掉；其真实 main 变化仍由 unchanged 拒绝导出。租约前已发出的 open/reattach 回执也不能 resetState 清掉排队编辑。
7. 最终 store.save 仍在原 ProjectService 会话事务中运行。进入事务及 rename 前的同步 canCommit 都检查租约有效性和原 unchanged。持续租约覆盖 writeExclusive、临时回读、两次 hash、结构校验、最后目标指纹等所有 await。
8. 线性化点明确为：同步门禁成功后、无中间 await 地调用原子 rename。此点之前排队编辑尚未有效接纳；租约若撤销/过期、会话/窗口/序号/路径/指纹变化则拒绝 rename。rename 调用后接纳的新编辑排序在导出提交点之后，不倒删已经提交的用户输出。
9. 正常成功、失败、异常均在 finally 释放；main 先置租约无效再发送匹配 nonce/session 的 release。renderer 只释放对应租约，按序回放完整快照，localSeq 正常递增、dirty=true，恢复原 250ms stage 防抖，不自动保存。
10. 关闭、render-process-gone、主框架导航使用已有 main cancelWindow 接线撤销当前窗口租约；adapter dispose 发送同 nonce 的失败撤销。旧 nonce、旧会话释放、其他窗口取消/回执、旧 release 的重复调用都不能解除新租约。多个窗口绑定同一会话时明确拒绝独占导出，且租约每次 valid 都复查独占性；不同会话/窗口可各持自己的租约。
11. main valid 用 performance.now 检查截止时间，即使 main 定时器尚未获得执行机会也拒绝过期 rename。renderer 的计时开始晚于 main，只有自身单调时钟也确实走完完整租期才可在 release 丢失时自行回放；若定时器取整提前触发，按剩余租期重新检查，不提前恢复编辑。新 nonce 不受旧计时器影响。

可用性边界：30 秒到期保证 renderer 不永久暂缓接纳编辑，过期的 store 即使晚恢复也不能 rename。没有声称可强行取消操作系统的挂起 IO；原 main 会话事务仍等待正在执行的 IO 收尾，磁盘永久不响应时 stage/保存仍可能等待。没有为超时提前拆开原事务或回退授权/提交安全。

DrawingExportStore 的临时文件、wx/0600、回读/hash、结构校验、目标指纹、rename 和清理实现均未改；普通草稿导出策略未改。S01/S02、权限、领域计算、精度、依赖/锁文件、GT 基线均未改。

## 最终定向与完整回归

定向命令：

    ./node_modules/.bin/vitest run --config vitest.desktop.config.ts desktop/tests/savedExportBarrier.test.ts desktop/tests/savedVersionExport.test.ts desktop/tests/agentExport.test.ts desktop/tests/desktopAdapter.test.ts desktop/tests/closeGuard.test.ts

logs/21-focused-deadline.log：exit=0，5 files / 62 passed。

覆盖：真实防抖 + write/read 栅栏、两个排队快照顺序回放、写失败/回读失败/异常、关闭/导航撤销、adapter dispose、租约到期、main 定时器未执行但截止已过、renderer 定时器触发但截止未过、丢失 acquire 回执/丢失 release、所有程序化编辑请求拒绝、旧回执不能 reset、两个真实 adapter/一个 main guard 的窗口隔离、同会话多窗口拒绝、旧 nonce 不解新租约、普通旧 flush 回执不冒充租约、显式保存后恢复导出。原 source/对话框/PDF/临时写/最终 rename 事务测试继续保留。

完整命令：

    node scripts/gt-expand-gates.mjs ../slop-cleanup-evidence/followup-04/final-verification-03

logs/22-full-gates-final.log、final-verification-03/gates.json 与 logs/：exit=0，11 步均 exit=0、signal=null、无超时：

- npm run typecheck
- npm run typecheck:desktop
- npm run lint
- npm test：130 files / 1354 passed
- npm run test:desktop：61 files passed / 1 skipped；447 passed / 15 skipped（不计通过）
- npm run test:mcp：3 files / 22 passed
- npm run build：实际 built in 232ms
- npm run test:real-docs：5 files / 19 passed
- 真实文档 metrics：nominal 58/58、上下偏差各 20、wrongPending=0、BASELINE MATCH
- npm run package:desktop
- npm run check:package:pdf-worker

另：logs/24-package-step-final.log，`npm run check:package:step -- 'out/寸链-darwin-arm64/寸链.app/Contents/Resources'` exit=0，仅资源检查，不等同于 STEP 几何/CAD 互通通过。

首轮完整回归失败留在 final-verification 和 logs/08-full-gates.log。原因是离线 A40 的 main-only IO 夹具没有装配新增租约，尚未进入所注入的写失败/rename 失败位置就提前拒绝。仅显式启用 stubExportLease 供这些旧 main-only 夹具使用，没有改变原断言；真实租约测试不使用该 stub。最终完整回归复验通过。

## 实际打包产品：重复同一个临时 IO 窗口

最终包：out/寸链-darwin-arm64/寸链.app
app.asar SHA-256：e13a65faf661573f2736ab2efe9f55cd0a505ab057b32b9e3e5bb17b10950922

命令：

    node ../slop-cleanup-evidence/followup-04/packaged-lease-probe.mjs 'out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链' /Users/aston/DSH/tmp/cunlian-v4/slop-cleanup-evidence/followup-04/product-final-02

logs/23-product-final.log、product-final-02/result.json：exit=0，76 checks passed，4 runs，write/read 各重复两次，实际进程退出 code=0/signal=null。探针拒绝已有目录；复跑须换一个新输出目录。

- 真正 packaged main、真实 UI 持有的 adapter、真实 ProjectService 和 DrawingExportStore；先委托真实磁盘 IO，再用 Promise 栅栏悬停临时 write/read。没有替代 adapter/stage/export 服务或伪造服务响应。
- 通过真实 H 输入事件产生新操作；排队通知可见，权威 localSeq/snapshot 未前进。截图 `write-1-queued.png` 等。
- 在实际 rename 调用处记录真实租约 valid、canCommit、main dirty=false、acceptedSeq=savedSeq。随后真实目标文件大小/hash 与回执逐一匹配。
- release 后同一编辑只回放一次成为 dirty；项目原字节在显式保存之前未变。点击真实“保存”后解码真实 .cunlian，完整 draft 与回放后的 draft 逐字比较；再导出，SVG 与已保存 project 的真实重建/渲染逐字一致并通过结构验证。
- 每次事件只有 initial flush + acquire + release，没有第三次 flush；不靠等待 debounce 关闭竞态窗口。
- 真实 probe 源码快照保存在 product-final-02/probe-source.mjs，归档 hash/runtime/全部回执/每次 JSON/截图/electron.log/probe.log 同目录保存。

另用现有成品探针复验正常路径：

    node scripts/saved-export-packaged.mjs 'out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链' ../slop-cleanup-evidence/followup-04/product-normal-02

logs/25-product-normal-final.log：exit=0。真实 UI 编辑立即导出拒绝、显式保存后 SVG/PDF 正常输出；SVG 逐字比对重建且结构校验，PDF 走真实 printToPDF 并经真实解析器读取标注，不只检查文件头。原生对话框返回由 debugger 注入，不声称原生对话框 GUI 走查通过。

## 保留失败与未测范围

- product-lease-01：页面 URL 匹配错，未识别 index.desktop.html，未开始竞态场景。
- product-lease-02：paused 状态错误使用 Runtime.evaluate 查询，改用 Debugger.evaluateOnCallFrame；未完成场景。
- product-lease-03：完成一次竞态/排队/显式保存，但探针错误假设“改 H 草稿就会改正式图纸”。inspect-probe-diff.mjs 真实回读证明仅 draft.terms[0].nominal 和草稿代次变化；rebuildDrawing.ts 使用 project.parameters。没有改产品/精度/结果迎合假设；后续改为完整持久化 draft 比较及严格按已保存 project 渲染校验，原失败保留。
- product-lease-04：Inspector scriptParsed 事件时序，探针未等主脚本实际出现；改为事件 Promise，不加 sleep。
- product-lease-05、product-final、final-verification-02 是前一个代码提交的真实通过记录，不替代最终 31c2a06 的 final-verification-03、product-final-02、product-normal-02。
- 15 付费真模型未运行；没有模型端到端通过声明。
- 成品悬停 IO 重复覆盖 SVG，共用协议的 PDF 正常成品路径另测；没有声称 PDF 专属悬停窗口也重复过。
- 未重跑真实原生对话框交互、STEP 几何/CAD 互通或发布法律门禁；旧发布阻断不改变。
- 没有 merge/push/tag/release/付费/权限修改/全局安装，没有覆盖历史日志。

汇总核对命令：`node ../slop-cleanup-evidence/followup-04/summarize.mjs`。脚本核对全部门禁、成品次数与检查数量、真实文件大小/hash、当前 asar hash、干净工作区，以及测试后仅本文的差异，写 results-summary.json；实际输出另存 logs/26-summary.log。
