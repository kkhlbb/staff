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

## 分段提交与收尾检查

9fc177c：接续审阅的既有输入及成包取消补验。
51970c9：许可来源、部分SBOM、告知打包断言和分发阻塞门禁。
bb06575：历史/当前分离与四资源缺失损坏、替换阻塞、全量回归结果。
最终本节仅收尾文档，不改产品；首个diff --check指出本文件EOF多一空行，
已移除并单独复查，不混淆为测试或许可失败，也不重写前面提交/日志。

## 220a45f之后：受控替换机制及固定源码续追

本轮起点实核 agent/step-spacer / 220a45ff7989a63c5065ea834f571424691b5d46，
工作区干净。完整读本索引、许可来源、原发布门禁、provenance研究报告及替换文档。
新证据独立根 ../step-followup/replacement-20261114/，不覆盖旧证据；其中final/
为最终新源码快照/新包/新产物，根logs/保存先红后绿与早期失败，不用最终结果覆盖。

实现提交 d750833：独立主进程启动opt-in、用户本地WASM绝对路径/sha，读取同一
fd的有界快照，固定默认四资源仍先严格hash，worker内验证ABI/API、内存/表上限。
新核身份标明user-selected/unverified，回执sha为实际用户字节。execArgv与环境
不继承、V8限额256/32/4MiB，本地WASM内存最大512MiB/表100万项、文件64MiB、
结果16MiB；保留30秒/并发/取消等待terminate及所有几何断言。不是OS sandbox或
总RSS硬限，不宣称能安全执行任意恶意库；只接受用户信任的兼容WASM，不接JS。

测试先行发现两处真实问题并修正：
1. 固定glue忽略wasmBinary，修改候选虽回执sha正确却仍跑默认核；行为断言真实
   2失败，改为instantiateWasm只实例化校验快照后绿，不接受无行为custom section。
2. 成包负例的worker外层错误掩盖STEP_LOCAL具体原因；先保存4项成包失败与5条
   单测失败，再以白名单局部原因脱敏输出修正。fe3c347含此修复/验证脚本/来源更新。
   完整argv/退出码/原始stdout/stderr保存在根logs与final/logs。

最终实际命令结果：
  npm test                          exit0，128文件/1455通过（根logs/app-tests）
  npm run test:desktop              exit0，52通过/2跳过文件，373通过/17跳过
  npm run test:mcp                  exit0，3文件/22通过（根logs/mcp）
  npm run typecheck                 exit0（根logs/typecheck）
  npm run typecheck:desktop         exit0（final/logs/typecheck-desktop）
  npm run lint                     exit0（final/logs/lint）
  npm run build                    exit0，仍有>500kB chunk警告（根logs/build）
  npm run test:step-license         exit0，10通过（final/logs/license）
  npm run package:desktop -- --arch=arm64   exit0（final/logs/package；新snapshot内）
  vitest.step-evidence.config.ts    exit0，1采集用例（final/product，非复用旧输出）
  packaged.mjs 默认/本地核各       exit0，真实新包IPC/worker/磁盘，原生对话框桩化
  local-negatives.mjs              exit0，10项新包负例全符合期望、无目标、路径脱敏
  local-native.mjs                 exit0，8份新STEP各原生reader exit0/ACCEPTED
  sandbox-exec deny network* 内核   exit0，4文件/12通过；正常监听控制组可用、限制组EPERM
  主加载器OS拒读/可读控制组        各exit0；拒读STEP_LOCAL_FILE，不改权限、不提权
  npm run check:package:step        exit0，变异恢复后默认资源和随包告知仍严格通过
  npm run check:release:step        exit1，四项blocker不变；不是许可通过

三套主测试合计1850通过/17真实模型跳过。目标复验不重复累加进此总数。
10项成包负例：缺opt-in、错opt-in、非法二进制、错ABI、超内存、超表、错sha、
缺文件、符号链接、目录。默认与本地核两套均另有四资源各缺/坏8项拒绝和恢复、
当前99mm/历史12mm冻结、stale拒绝、取消零导出写入、自有step-tmp零残留。
本地核额外实测用户文件改变后HASH拒绝，finally恢复原字节；没有默认回退。
final下12个新包进程真实退出均code0/signal=null；审计脚本检查调试监听为空。

候选不是custom section：真实数据段translator/processor字符串变为USER PATCHED，
真实memory maximum从4GiB减到512MiB；三份本地核STEP均实际含修改后的processor。
八份原生读回保留原线性1e-6mm/体积阈值，奇数q仍10.00005mm；原生bitset绑定
TypeError/repairFreeImportProven=false、同家族而非异厂商、原生框仅桩化限制未消失。
完整OCCT源重编/产品重链接仍未测，不用二进制数据段探针冒充LGPL全部闭环。

整Electron套sandbox的早期取证exit13，在inspector阶段中断，未得到导出验证，
不计通过；记录在根logs/negative-os-deny-read。改用同一实际主加载器做OS拒读
与可读控制验证（各exit0），只宣称该加载器权限行为，不算全应用sandbox验收。
取证脚本随后修正socket关闭/超时处理，避免未完成top-level await吞掉诊断。

固定源码续追新目录 ../step-followup/replacement-20261114-research/：
官方固定LLVM/Binaryen源码归档、许可原文实际下载；全部9个OCCT补丁在隔离副本
落盘、26文件改变并保存前后sha/diff，libembind匹配上游expected hash。父任务
独立重算36511文件零不一致，且实际重跑修改native数值组件输出MODIFIED_OCCT_STRTOD。
候选源不等于目标确证对应源；native Strtod重链接也不等于产品WASM重链接。
窄C ABI构建/烟测脚本已落盘并做真实头文件语法检查，但完整build前检exit2：
缺emcc/em++/emcmake/cmake。最小局部工具方案、23toolkit依赖闭包、绑定生成额外
缺件/许可见该报告；没有安装大型SDK或全局工具，也没有声称configure/link已成功。

最终包：../step-followup/replacement-20261114/final/snapshot/out/寸链-darwin-arm64/寸链.app。
app.asar SHA256 d93f7cf0a7b966167c60db25ee8c767e19634dfb7ccdcec7b551a25896eb0d6b。
用户候选 SHA256 0b4722cbb3ab0faef9166ce61113e5fa9fa2a70c33f159fac5cae64c305c7893。
本地核STEP SHA256 c70b3db015d96b9284b3351374440c44315e5def63da0fc26e85be2443525029。
脚本/产物/日志hash与完整退出码聚合见新证据根audit.json、artifact-hashes.json。
最终snapshot逐文件清单2097项；收尾仅新增取证辅助脚本/索引，不改已测产品代码。
发布门禁脚本字节及SBOM四blocker属性与220a45f作自动比较，维持BLOCKED/INCOMPLETE。
未merge/push/delete/发布/付费/改权限/全局安装；未接触共享staff/gt-expand。

## 新源码可追溯窄核接入（本节为最新产品状态）

用户明确批准本轮替换。起点2368683干净；61ba70d/dc2ab93/4830450接入独立
step-narrow-v1资产与新ABI；旧几何安全检查迁入产品C++，真实重编应用对象并重链接。
0ff0c0b/e776212补成包、实际源变异与非法退化验收；2c8210c由同名错签名红例驱动，
实例化前解析真实函数type，保留默认hash/主进程opt-in/快照/no fallback/内存表/取消等契约。
758ed23补完整早退出记录；6641b01让发布门禁显式核实际Resources，非只读开发SBOM。

独立新证据 ../step-newkernel-integration/REPORT.zh-CN.md、audit-final.json、logs/。
全量typecheck、typecheck:desktop、lint、build各exit0；npm test1455、desktop376/17跳过、
MCP22，三套1853通过/17真实模型跳过。最终许可测试13通过。真实mac arm64新包
snapshot-final/out/寸链-darwin-arm64/寸链.app；app.asar SHA256
f60450dbb75c92de102ec592cd686bd72561314206c19cfec58532d89982a944。
517个运行相关源码/资产/配置与最终snapshot同字节，后续仅CLI/证据脚本/索引补强不冒称重打包。

最终默认/源修改核两套真实IPC/worker/磁盘：普通/奇数q、历史99mm/12mm隔离、
stale-session、保存框取消及stepCancel IPC、微小长度/薄壁零目标写入；3资源各缺/坏6项
仍拒绝、custom-section直接替换仍hash拒绝。开发node_modules及默认vendor可逆移位为
不可用时两套包仍运行，finally恢复；无需关闭产品Chromium sandbox。
最终11本地核成包负例全部符合期望，含同名错签名/内存/表/错sha/opt-in/符号链接等。
14份最终STEP原生reader各exit0/ACCEPTED，精度未放宽；6类C++源变异真实重编后
原生reader各exit3，前后2绿，8/8符合预期。禁网内核4文件13通过，网络限制控制EPERM。
16个相关最终成包进程code0/signal=null，原生保存框仅桩化，不计GUI UX全验。

独立本地交付delivery/含固定完整OCCT源/patch、产品对象/源码、23archive/4193成员、
工具实物/完整工具源归档/缓存、map/why-extract/reproduce/许可与43组件供给SBOM。
最终实际提取2728个OCCT对象+317系统对象，不沿用旧实验2739计数。core供给sha
 a0477a0cac0101a6d04c3e1adb755eaebfdaa2b288b32d814c0f0f1ce731b9f2。
父任务再从delivery解包、含空格新目录重编wrapper/Controller实际源对象并重链接exit0，
默认/修改核与产品确切hash一致；该产物进入最终包又真实IPC导出/三份原生ACCEPTED。
复用系统缓存，非全库从零重建；主机Python/Node/macOS arm64前提明确，没有原开发绝对路径执行依赖。

只移除新资产已证实的PRODUCT_PACKAGED_MODIFIED_KERNEL_EXECUTION。
实际包release gate exit1、packageVerification=VERIFIED，仍BLOCKED/INCOMPLETE：
FORMAL_SOURCE_DELIVERY、TRANSITIVE_NOTICE_REVIEW、LGPL_LEGAL_REVIEW。旧SBOM原字节保留，
不替旧npm补造历史，不作法律认证；无修复/异厂商/原生GUI/其他平台限制不变。
整Electron外套OS拒读策略真实失败，初次早退出未知保留，修正取证后重跑明确SIGTRAP，
未算通过；资源移位独立验证成功。峰值RSS实测467.296875MiB，不是总RSS硬限/无泄漏证明。
原始失败/警告全部保留；无历史证据更改或跟踪文件删除，未merge/push/发布/付费/改权限/全局安装。
