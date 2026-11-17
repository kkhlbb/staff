# S05 followup-03：renderer debounce 屏障修复交付

本次退回项已实现并自测，交主控再次独立复核；不代替独立验收，不关闭整卡或发布门禁。

起点工作树干净：`agent/slop-cleanup`，`36930ac3fea50e7b2d8cb1c77158a127cd6715b3`。

分段提交：
- `23c151f76a727d176d7ec7c949de23cabf8889cd`：真实 adapter + 模型 service + export store 内存端口 RED（实际 exit 1，返回 ok:true）。
- `ed186a6b557fccdeede19237493e5865b9e5571d`：共享保存版本导出入口强制可信 renderer flush 屏障，不持会话事务锁、不自动保存；绑定主进程 request/window/session/acceptedSeq，失败/dirty 均拒绝。
- `e1bf86d6890fe8b23daf0105758d0c2495440796`：生命周期与缺端口测试、stale 一次结算、真实打包产品 SVG/PDF 导出及读回探针。

保留原有异步阶段身份复核、最终 transaction 与 rename 前同步 canCommit；对话框/生成后加第二次屏障。renderer stage 失败/切会话/dispose 只回失败；窗口关闭/主框架导航/进程失联清理 pending。UI 和模型保存版本导出共用 createSavedVersionExport；模型不能提供可信屏障消息。未改依赖/锁文件、q/精度/领域算法、授权规则或 S01/S02 事务。

证据根目录：`/Users/aston/DSH/tmp/cunlian-v4/slop-cleanup-evidence/followup-03`。
完整报告 `REPORT.zh-CN.md`，程序化汇总 `results-summary.json`，每步完整 stdout/stderr/exit/signal/timeout 在 `final-verification/logs/` 和 `final-verification/gates.json`。

真实执行：
- `node scripts/gt-expand-gates.mjs ../slop-cleanup-evidence/followup-03/final-verification`：exit 0，11 步全部 exit 0，无信号/超时。typecheck、desktop typecheck、lint、应用1354 passed、桌面429 passed/15 skipped、MCP22 passed、real-docs19 passed、build、package、packaged PDF worker 全绿。跳过不计通过。
- GT nominal58/58、wrongPending0、上下偏差各20，BASELINE MATCH；原基线未改。
- 最终定向5文件44 passed，exit0（`GREEN-final.log`）。包含 debounce、零目标写入/先保存、显式保存恢复、取消/超时/失联/stale/缺身份/缺端口、真实stage失败、跨窗口/过期回复、dispose、最终屏障失败与旧提交事务复核。
- `npm audit --json`：exit0，0 vulnerabilities（`audit-final.json`）。
- `npm run check:package:step -- 'out/寸链-darwin-arm64/寸链.app/Contents/Resources'`：exit0，真实资源/许可证字节检查通过。
- `node scripts/saved-export-packaged.mjs 'out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链' ../slop-cleanup-evidence/followup-03/product-final`：exit0，16项实检通过。真实UI编辑H=52.210后main仍editSeq=savedSeq=0，导出屏障接收为1/0并拒绝，目标框0次、目标不存在、源文件未变；显式UI保存后SVG/PDF实际导出与哈希读回通过。SVG逐字/结构校验，PDF真实解析含12.000标注；app code0/signal null，精确pgrep无遗留进程。回执、PDF文本与截图在`product-final/`。

原生对话框返回经 main debugger 替代，仅替代 dialog 回答；其余产品 adapter/flush/service/store/保存/printToPDF/读回均真实。不是原生对话框 GUI 交互验收，也不是付费模型验收。

失败原样保留：RED.exit=1；GREEN-expanded.exit=1（测试误认为run严格拒绝额外字段，已改为实际验证伪造字段不能绕过失联屏障，未改模型策略）；product-run-01.exit=1（探针漏切“尺寸链”标签，后修探针，未改产品）。各后续绿色日志另存，没有覆写失败。

15付费真模型未运行；本次未重跑STEP几何/异厂商CAD互通或发布法律门禁；旧发布阻断不变。无merge/push/tag/release/付费/全局安装/删除历史/权限操作。所有旧历史证据保持原样。
