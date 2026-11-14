# STEP 本地验收索引（不是分发批准）

外部证据根相对本 worktree：`../step-followup/`。旧 `../step-test-review/` 未覆盖。
开工 `before-manifest.json` 保存2077个文件哈希，`before-diff.txt` 保存既有未提交输入。
本阶段接续并审阅了该输入（回执/UI、错误脱敏、写入失败清理及测试/证据入口），
不是将它们认领为本轮从零完成。固定参考见 ADR-004 和 `../step-spike/`。

## 取消缺口

旧失败 `../step-test-review/logs/packaged-runtime.log` 保留：切到 odd 项目之后仍使用
base session，因此在保存框前被正确拒绝为 STALE_SESSION，而非取消产品缺陷。
本轮 packaged.mjs 使用当前 openProject 返回的 sessionId/editSeq 以及当前选择冻结
revisionId/partId/inputFingerprint。没有把期望改为 STALE_SESSION 来凑取消通过。

`../step-followup/logs/package-first.{json,log}`：新快照实打包 exit0；
`logs/packaged-first.{json,log}`：真实新包IPC导出/缺WASM拒绝/恢复/odd/取消 exit0。
`packaged-first/cancelled-receipt.json`：CANCELLED；`cancelled-disk-audit.json`：
取消目标ENOENT，导出目录前后STEP清单相等，零自有 .step-tmp。
`stale-session-receipt.json`：独立旧session仍STALE_SESSION，保存框调用数0。
只审计该导出目录；不声称应用无日志写入或全盘零写入。

本轮五份原生读回（product/base、product/odd、packaged-first/packaged、
odd-packaged、restored）各exit0/ACCEPTED，完整日志 `logs/native-first-*.{json,log}`。
奇数内径q=200001读到10.00005mm半径；线性1e-6mm、体积max(1e-6,参考*1e-9)未放宽。
`logs/step-focused.*`：29通过；`logs/ui-focused.*`：25通过（含历史冻结/当前值不串）。

对话框仅调试器桩化；不是原生交互/完整GUI UX验收。原生OCP仍同OCCT内核家族，
GetShapeProcessFlags绑定TypeError仍存在，repairFreeImportProven=false；不是异厂商或无修复证明。
全量回归/许可后最终包结果另追加，不以此阶段替代。
