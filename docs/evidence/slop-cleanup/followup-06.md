# S05 followup-06：异步回执跨租约释放窗口

状态：实现、自测、最终成包取证完成，交独立复核；不代表主控验收或发布批准。

工作树：/Users/aston/DSH/tmp/cunlian-v4/slop-cleanup
分支：agent/S05-followup-05（沿用，未重建）
开工基线：0caae39，工作区干净。
最终代码/测试/打包提交：d524367cc020a273f2484b3afc3f3456b4b71375。
证据根：/Users/aston/DSH/tmp/cunlian-v4/slop-cleanup-evidence/followup-06
本文件之后的交付提交仅增加说明，不改变已测源码。

## TDD 与分段提交

- f7f85d0：真实 DesktopSessionAdapter + 可控 API Promise 的 RED，不复制状态机。logs/01-red.log，exit=1，8 tests / 8 failed。release 与 timeout 两例均在 localSeq=1、acceptedSeq=0、dirty=true、stage 未调用时投递旧回执，实际被覆盖为基线、localSeq=0、dirty=false。
- 617e6e3：响应票据与生命周期保护，补 dirty-gate 自身 stage、dispose/rebind、同 ID 重新接入、保存等待 stage 等边界。
- c81f581：补充只读审查指出首版过严，先增加“保存先回执/参数提交后合法返回”和“权威更新先到/有意打开新会话后返回”两条 RED。logs/15-authorized-red.log，exit=1，2 failed / 12 passed。此处没有把静态审查推测直接记成实测，随后才用真实 adapter 执行复现。
- d524367：修复合法权威聚合/有意打开误拒，再补在途 reattach 的更高 main 聚合与期间本地编辑冲突对照。最终新文件 16 tests；logs/16-authorized-green.log，exit=0，3 files / 55 passed（含既有 adapter 与租约屏障专项）。

保留中间失败：logs/03-typecheck.log exit=2（mock 字面量类型与 reattach 返回联合类型推断，后续修正；logs/04、07 typecheck 及最终门禁通过）。logs/23-summary.log exit=1 是证据汇总脚本误读 STEP 报告不存在的 artifact 字段；删除该无依据校验后 logs/24-summary.log exit=0，不更改产品测量 JSON 或任何断言结果。

## 响应规则与范围

生产只改 src/workspace/desktopAdapter.ts；新增 desktop/tests/adapterReceipts.test.ts。未改 main、领域精度、导出提交线性化、依赖/锁文件、历史证据。

1. 请求发出时记录 binding/session identity、本地编辑代次、权威代次、恢复回执代次、reset 请求代次，以及是否存在未 stage 编辑。编辑代次在租约排队时即递增，不依赖释放时才变化的 localSeq，也不因 reset 清零。
2. reattach 为被动读取：请求期间本地编辑、已知权威/恢复更新、后继 reset 请求、dispose/rebind 或会话切换均阻止旧响应覆盖；本来就有未 stage 本地编辑时也不能用 main 基线清掉它。冲突返回 STALE_SESSION，并保留完整快照、序号、dirty 和恢复信息；本地编辑冲突有可见 lastError。
3. 有意 new/open/importV2/restoreRecovery 与菜单 new 单独使用 open 规则：允许 main dirty gate 自身 flush 和先前在途权威更新完成后合法切换；不要求返回新 session 的序号等于旧 session。期间发生新的本地编辑则明确报错且保留编辑，不静默替换。
4. 权威提交不是被动旧读取。无身份/编辑冲突且本地已接纳时，严格高于当前 acceptedSeq 的 main 新聚合可以越过旧权威代次检查；这既覆盖已在途的提交，也覆盖 reloadSession 的新聚合。期间若有新本地编辑，即使回执的 main 序号更高仍拒收，不能按数字大小猜测合并独立编辑。
5. applyChange、资料/草图导入、草图读数、提取运行/决定/删除、批量提取、条款确认的异步快照发布均应用同一票据检查。直接 applyModelMutation/applyDrawingMutation 推进权威代次，使更早的 reattach 失效；不更改主进程提交的业务语义。
6. save/saveAs 在 flush 前保护操作身份，发出保存时再次取票据。保存只更新元数据，不覆盖快照；允许期间新本地编辑留存，dirty 用 localSeq > savedSeq 而非 acceptedSeq > savedSeq，防止尚未防抖 stage 的新输入被标 clean。跨会话迟到保存不能污染新项目路径/指纹。
7. stage 回执验证 binding 和会话接入代次，含同 sessionId 重接、等待另一 stage 的保存；旧回执不能向新接入项目发布 acceptedSeq/recovery。STALE_SESSION stage 失败不再清空尚存编辑，而是保留并报错。
8. close 仅转发 requestClose，没有异步 resetState 发布；不添加 renderer 自行清空，也不改变 main dirty gate。resetState 的正常 attach 会清旧 stage timer、推进接入/权威代次；租约内明确拒绝仍保留，释放后的安全依靠请求票据而非瞬时租约锁。

## 最终全量回归

命令：node scripts/gt-expand-gates.mjs ../slop-cleanup-evidence/followup-06/final-verification-02
完整输出：logs/17-final-gates.log；逐命令 argv、退出码、signal、超时信息与日志：final-verification-02/gates.json、logs/。
程序核对 11 步全部 exit=0、signal=null、无超时：

- npm run typecheck、typecheck:desktop、lint：0。
- npm test：131 files / 1360 passed。
- npm run test:desktop：62 passed files / 1 skipped；463 passed / 15 skipped。付费模型未运行，不计通过。
- npm run test:mcp：3 files / 22 passed。
- npm run build：0，built in 234ms。
- npm run test:real-docs：5 files / 19 passed。
- real-doc-metrics：nominal 58/58，上下偏差各 20，wrongPending=0，BASELINE MATCH（6 文档）。
- npm run package:desktop、check:package:pdf-worker：0。
- 另 logs/10-audit.log：npm audit --json exit=0，vulnerabilities.total=0。未改变依赖。

## 最终成包实测

产品：out/寸链-darwin-arm64/寸链.app
app.asar SHA-256：8c0cf8077e24466696a02fbb7b3c2b2d0caeb3031a26e1723c556bec2ef5049e
adapter 源码 SHA-256：7e9fea88fafeb31a5cd5397e888758a7bb312c93fc147943c3f43408f0c2b12d
新增测试 SHA-256：c66ac7524fae7c3d2ff936630ddb2502a97c4ba9cdfad44c1563e73fde791be8

所有探针命令、真实退出码：logs/18–22 对应 .log 与 .exit.json。各产品进程 code=0/signal=null。所有输出使用新目录；早期 product、product-normal、product-step 和 final-verification 是首版实测，保留但不作为最终代码结论。

- packaged-receipt-probe.mjs：product-final/result.json，104 checks / 4 runs，exit=0。使用真实成包 UI hook 持有的 adapter，委托真正 preload/main 的 reattachSession 得到真实回执，仅把 Promise 延后；请求在租约建立前发出。在真正 releaseExportLease 完成真实回放的同一任务中释放旧回执，明确记录 localSeq 已 +2、acceptedSeq 未变、dirty=true，故不是仅测锁内窗口。write/read 两个真实临时 IO 窗口各重复两次，整份排队投影、两独立输入、恢复字段与序号均未被迟到回执清掉。实际 UI 保存后解码文件并逐字核对完整草稿；再导出 SVG 与保存项目的重建内容比较。每次仍只有 initial flush + acquire + release，无第三次 flush，无自动保存。源文件字节及导出文件 size/hash 均读回检查。
- product-final/*-queued.png、*-replayed.png：真实产品截图。可见“有未保存修改”、H 输入与过期响应保留提示；目标下限不在截图可见区域，值以同轮 DOM/快照和持久化完整草稿断言为证。
- scripts/saved-export-packaged.mjs：product-normal-final/result.json，16 checks，exit=0。未保存导出拒绝、不打开目标对话框、不改源文件；显式 UI 保存后 SVG/PDF 正常，SVG 结构与完整内容比较，PDF 用真实 parser 读回保存长度标注。
- packaged-step-probe.mjs：product-step-final/result.json，7 checks，exit=0。真实 packaged IPC/worker，STEP 落盘 size/hash 与回执一致，历史冻结输入不变，实际使用 packaged pinned wasm。
- check:package:step：logs/22-step-assets-final.log，exit=0。native-readback.py：logs/21-step-native-final.log、product-step-final/native-readback.json，exit=0、ACCEPTED；1 solid / 1 closed shell / 4 faces，半径10/16 mm、包围盒±6/±16/±16 mm；保持既有1e-6 mm线性阈值与体积阈值，点分类/布尔探针均通过。
- summarize.mjs：logs/24-summary.log exit=0，results-summary.json 程序核对最终11门禁、各退出码、104/4/16/7计数、源码/当前asar与测试时asar hash、完整投影与STEP hash；运行时git工作区干净。

## 边界与未测项

- 交主控独立复核，未自行宣称最终独立验收通过。
- 超时后迟到回执、乱序、同/跨session、dispose/rebind、旧stage/等待保存及授权聚合的边界由真实 adapter 可控 Promise 测试覆盖；最终成包迟到窗口为正常 release，没有宣称成包也重跑30秒超时或全部排列。
- 成包通过真实 hook 所持 adapter 方法触发 reattach；没有另造状态机，但未声称该轮是点击某个业务按钮触发 reloadSession 的完整业务流程。正常打开/保存由真实UI按钮实测。
- 对原生文件对话框仅用 debugger 代返选择；不计原生对话框GUI验收。无付费模型调用。
- STEP读回仍为OCP/OCCT同内核家族，不代表第二厂商CAD或无healing证明；资源检查仍明确 BLOCKED_PROVENANCE_AND_LGPL_SOURCE_SUPPLY，不改变发布法律门禁。
- 不自动合并并发业务编辑；过期响应明确失败，保留当前编辑与恢复信息，用户需核对后重试/重新打开。
- 无merge/push/tag/release/付费/改权限/全局安装，未改历史证据或其他工作树。
