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
全量回归/许可后最终包结果见下节，不以此阶段替代。

## 许可后最终复验

代码阶段：9fc177c（接续待审输入与取消补验）、51970c9（许可/部分SBOM/门禁）；
其后证据脚本增强为当前长度990000q、历史冻结120000q，并对四项资源逐个缺失/损坏。
外部source-vs-snapshot字节核对覆盖全部已跟踪文件，功能/脚本一致；最终总结文档追加
不改变已测产品代码。初始2077文件无删除；既有9个跟踪修改未改字节，已接续提交；
6个既有未跟踪文件中packaged/product两个脚本扩充，其余保留。

真实命令结果（完整argv/stdout/stderr见外部logs同名.json/.log）：

  final-typecheck: npm run typecheck                         exit0
  final-typecheck-desktop: npm run typecheck:desktop         exit0
  final-lint / final-lint-expanded: npm run lint             exit0
  final-test: npm test                                      exit0，128文件/1455通过
  final-desktop: npm run test:desktop                        exit0，49通过/2跳过文件；363通过/17跳过用例
  final-mcp: npm run test:mcp                                exit0，3文件/22通过
  final-build: npm run build                                exit0，保留>500kB chunk警告
  final-license: npm run test:step-license                   exit0，10通过；9种告知各测缺失/篡改/恢复
  final-package: npm run package:desktop -- --arch=arm64     exit0，真实mac arm64包+PDF/STEP资源断言
  final-product-frozen: vitest --config vitest.step-evidence.config.ts  exit0，1采集用例；product-final新产物
  final-packaged-expanded: node scripts/step-evidence/packaged.mjs <新包> <product-final> <packaged-expanded>
                                                            exit0，真实IPC/worker/磁盘；原生对话框桩化
  final-native-{base,odd,packaged,odd-packaged,restored}: 原生native-readback.py 各exit0/ACCEPTED
  final-mutations: node scripts/step-evidence/mutations.mjs <新目录> <已有venv/python>
                                                            exit0，8/8预期；6负例reader实际exit3
  final-assets-expanded-restored: npm run check:package:step -- <Resources> exit0
  final-kernel-deny-network: sandbox-exec deny network* npm run test:step-kernel
                                                            exit0，7通过；监听控制探针正常可用，禁网EPERM
  final-release: npm run check:release:step                  exit1，分发阻塞（非许可通过）

三套主测试合计1840通过、17跳过；17条是真实模型用例未执行，不重复累加目标用例。
外部commands-summary.json聚合37次命令，36次exit0、1次exit1（发布门禁）；测试运行
无失败重试。execute_code被策略阻止、未执行；研究委派以同步方式完成；这些工具层
情况不算子进程测试命令，也没有绕过限制或伪造输出。

packaged-expanded/historical-freeze-audit.json：当前990000q/所选历史120000q；回执
完整generationInput等于所选冻结输入，而非当前模型。奇数q真实native半径10.00005mm。
resource-mutation-audit.json：CJS/JS/WASM/worker各缺失、损坏，共8项拒绝；无目标写入，
每项finally恢复并核原字节。取消与stale独立断言继续成立，残留调试端口0，成包进程exit0。
replacement-audit.json：合法custom-section候选WASM被STEP_ASSET_HASH拒绝，原字节
已恢复，后续odd导出与资源断言通过。这是替换阻塞证据，非修改库重链接成功。

许可已闭环的事实：npm tarball SRI/SHA、11个实装文件、固定commit同字节dist；
NOTICE、MIT边界、LGPL/exception/npm许可全文与候选条款随包字节一致；机器部分SBOM；
固定构建参考/DEPS/当前OCI证据；父任务独立复核38个下载hash与12个OCI descriptor。
仍阻塞四项：目标历史构建provenance；完整对应/修改源码和生成绑定；实际静态组件
与对象清单/link map；修改库重新链接/运行和源码供给。详情见step-license-provenance.md。
没有Docker/emcc/cmake，不安装工具；没有完整材料时不承诺可执行重建成功。

最终本地包：`../step-followup/snapshot-final/out/寸链-darwin-arm64/寸链.app`。
app.asar SHA256 83b5e37254b431588d6dd0d6ea8a5f432da1458f891d087be24f4305cd44a634。
外置许可/部分SBOM是本轮新字节；app.asar与旧版相同是产品运行代码未变，不是复用旧包。
完整包成员及新产物哈希374项见外部artifact-hashes.json；路径均相对证据根。

原始日志保留真实绝对路径、session和stdout；相对化检索索引为commands-summary.json、
artifact-hashes.json、audit.json。wrapper早期14条final日志的cwd标签误写snapshot，实际
subprocess已在snapshot-final执行（stdout也记录路径）；仅以cwd-corrections.json补正
元数据，未重写原始日志。后续已修正runner标签。不影响退出码/测试数据。

未完成/限制不变：无静默修复证明（bitset绑定TypeError，默认Transfer可能heal）、
异厂商互通、原生保存框/完整GUI UX、Windows/Linux/x64、干净机安装/断网全应用、
签名公证、全参数空间、实际磁盘满/断电/跨进程CAS竞争。未把这些当产品必修bug，
未声称通过。既有React重复key、pdfjs legacy、jsdom能力提示及大chunk警告保留。
未碰共享gt-expand树及其变更；未merge/push/delete/发布/付费/改权限或全局安装。

