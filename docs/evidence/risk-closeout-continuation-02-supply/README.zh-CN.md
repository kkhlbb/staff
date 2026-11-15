# 当前依赖修复包：供给重新绑定与实际包实测（不批准发布）

证据根：`/Users/aston/DSH/tmp/cunlian-v4/risk-closeout-evidence/continuation-02/supply`。本轮新增目录；历史 step-distribution-closeout、resume-01 只读。
实现提交 `92931c9daaf85458cc60b2327595142d1ef7a59d`：新增 `scripts/build_dependency_supply.py` 和四项 unittest。
先运行测试 RED exit1（实现模块不存在），后 GREEN / final exit0，4 tests。
源供给精确绑定此提交；本页是后续报告，不把报告提交冒称运行源码编译点。

## 交付实物

- 当前实际包副本：`/Users/aston/DSH/tmp/cunlian-v4/risk-closeout-evidence/continuation-02/supply/app/寸链.app`；与风险工作树 `out/寸链-darwin-arm64/寸链.app` 全树一致。
- 应用归档：`/Users/aston/DSH/tmp/cunlian-v4/risk-closeout-evidence/continuation-02/supply/寸链-dependency-fixed-arm64.app.tar.gz`，126317479 bytes，SHA-256 `ff9a9f1fb78980ea2aeaee8c4f63fa1ddfd67e6f9be6133fc572ecb8e5d963f8`。
- 独立目录：`/Users/aston/DSH/tmp/cunlian-v4/risk-closeout-evidence/continuation-02/supply/distribution/`；113 个供给文件 / 1127111038 bytes（不含自身 MANIFEST 与旁置应用）。
- MANIFEST SHA-256 `5e916f4d9e616884996ad195c8ab5c77d420ac66f7f1518227980cbcc889edd2`；PRODUCT-BINDING 对实际 21 份 Resources 全 hash，APP-TREE 对 291 份常规文件/符号链接建索引。
- PACKAGE-FILES.cdx.json 是实际 .app 的文件级 CycloneDX清单（291 entries），不等于完整语义依赖/逐函数来源证明。
- `closeout-source.tar.gz` 是当前绑定提交完整 git 受跟踪源码，含新锁与供给实现；历史集成源、历史 closeout 原始补充另外保留，不伪装当前源。
- 原供给37文件全部先逐个重新SHA-256验证，再复制完整核源/对象/archive/工具二进制与完整工具源/缓存/最终链接实物。不是只有URL或旁置旧绝对路径。

### 必须纠正旧推断

实测当前 app.asar = `f60450dbb75c92de102ec592cd686bd72561314206c19cfec58532d89982a944`，与旧绑定**相同**，不是“重打包必然产生不同hash”。
当前资源与历史包对比：无新增/无字节变化，仅少历史额外 `REPLICAD_OCJS_LICENSE.txt`；该原文另保留在供给 review/。
这符合开发依赖更新不进入运行包的实际边界；本轮仍独立重建当前供给/版本绑定，不能拿历史回执直接冒充新回执。
三项核资产均与已证hash一致：WASM `c309d6a202aab5b2b2a498bdd1515b8b03f470ea238dfb99ba5ccb00b8a80108`，
JS `96ff4cea09e0fcbc3cbdcd07e83c6e03470735db01bcab32b689972b4e57b94f`，
worker `2eb428ddaa2a22c243d60e2ab8a14dfe696a0a0594acf3d75cbbf54d711ed36c`。

## 官方变更依赖原文

对 `770bba2` 锁与当前锁逐路径对比：20 个新增/变更节点，0移除；去重 19 个官方精确版本tarball。
每个 npm 官方版本元数据的 name/version/dist.tarball/dist.integrity 与锁一致，全部真实 tarball 做强算法 SRI 校验；
19 份许可/通知原文逐字节保留，并与安装文件字节比较一致。版本、来源、hash 在 `dependency-official-license-index.json`。
原文许可声明分布：{'MIT': 14, 'Apache-2.0': 1, 'BlueOak-1.0.0': 4}。不把 BlueOak-1.0.0 或 Apache-2.0 改写MIT。
完整下载事件和原文/包在 distribution/build-dependencies/；合并告知为 BUILD-DEPENDENCY-NOTICES.txt。
BUILD-DEPENDENCIES.cdx.json 保留完整当前npm锁 420组件，dev scope=excluded；这是构建库存，不冒充全部进入runtime。
实际 asar 审计确认受修复dev包路径均未出现。STEP原SBOM仍明确限STEP、INCOMPLETE与三个blocker；没有为凑绿改门禁。

## 本轮真实命令结果

所有argv/cwd/退出码：`commands.jsonl`，完整stdout/stderr：`logs/`。各子命令分别记录，不以组合shell最后退出码代替。

| 命令/阶段 | exit | 结果 |
|---|---:|---|
| python3 scripts/build_dependency_supply_test.py（实现前） | 1 | RED，缺模块；没有当成功 |
| 同测试（实现后与final） | 0 | 4 tests，SRI篡改/不支持算法、tar路径逃逸/缺许可、增改删差集、dev SBOM阻塞属性 |
| 官方材料（首次curl） | 1 | 系统LibreSSL连接失败；原失败保留 |
| 官方材料（npm view/pack，局部cache，ignore-scripts） | 0 | 19官方包SRI与安装原文一致；未全局安装 |
| npm run test:step-license | 0 | 18 pass / 0 skipped |
| node --test scripts/verify-step-supply.test.mjs | 0 | 8 pass / 0 skipped |
| node scripts/risk-closeout-package-audit.mjs <新报告> | 0 | 实际asar dev路径边界与hash核查 |
| npm run check:package:step -- <当前证据包Resources> | 0 | 当前15告知与源字节一致；无旧核资产 |
| npm run check:release:step -- <当前证据包Resources> | 1 | packageVerification=VERIFIED，INCOMPLETE，三blocker保留 |
| sandbox-exec deny-network + verify-step-supply | 0 | 当前全部供给/21资源，LOCAL_MATERIALS_VERIFIED，BLOCKED |
| node scripts/step-evidence/packaged.mjs <当前执行文件> <完整旧夹具> <本轮新输出> | 0 | 真实Electron main/preload/IPC/worker/落盘；process code0/signal=null |
| native-readback.py packaged.step / odd-packaged.step / restored.step | 各0 | 三份ACCEPTED，未放宽原线性/体积阈值 |
| finalize-exact-artifacts | 0 | smoke后291全树恢复，归档逐文件读取也相等，当前out一致，源码归档锁/脚本字节一致 |

packaged harness实际覆盖普通/奇数q、历史99mm与所选12mm隔离、取消/stale/退化拒绝、资源缺失/损坏拒绝与恢复、有效但hash不同WASM拒绝。
原生reader验证AP214/mm、1solid/1shell/4解析面和几何探针；奇数q为20.0001mm内径、10.00005mm半径。
原生框桩化；OCP同OCCT家族且默认transfer可能修复，不能声称异厂商、无修复、GUI UX或另一主机验证。

## 已证内核重建的引用边界

本轮不重编内核，也未重建已经得到当前out的Electron包；本轮实际运行的是该依赖修复后包的全树相同副本。
原核源/工具/最终链接归档hash、本轮实际资源hash均复核一致；故引用历史禁网离线prepare 35413文件相等、
真实Controller源修改重编/同应用对象重链接/产品使用证据，不伪称本轮重跑。系统缓存复用和平台工具前提继续明示。
无谓重复全库构建不增加本轮依赖修复的证明。完整源/工具实物与相对命令已给出。

## 失败与外部阻塞

- 实现提交范围 `git diff --check 72de5b6 92931c9 -- scripts/...` exit0；仅文档元数据暂存检查exit0，补入原始日志后 `git diff --cached --check` exit2（两份 npm gate stdout 原有EOF空行）。未裁剪原文、未记作通过；原始诊断另存logs/docs-raw-log-diff-check.stdout.txt。
- 首次curl TLS失败exit1，改已有npm网络栈成功；所有失败输出保留。
- 首次assembly对历史额外REPLICAD告知作了不当存在性假设而KeyError exit1；原半成品保留于 assembly-first-attempt/，
  改为显式差集、只对实际共有资源逐hash核对，重装配exit0。旧包/旧证据未改。
- fontTools/brotli/jsonschema在系统与既有native-reader Python均未安装，探测实录已保留；未安装额外工具，不宣称独立字体name或外部schema认证。
- FORMAL_SOURCE_DELIVERY：本地完整备料/绑定已验，但仍需有权人批准每一接收方渠道/维护责任及实际提供动作；没有公开上传授权。
- TRANSITIVE_NOTICE_REVIEW：历史事实包列明293无leading notice、生成JS/头文件/原生Electron/FFmpeg/PDF/font精确边界仍需人工答复。
- LGPL_LEGAL_REVIEW：§2(b)修改显著通知日期overlay、§4/§6(a)对应源/应用对象/工具例外/渠道，以及§6修改/逆向调试与最终EULA冲突由合格审查员确认。
- 新增开发依赖完整原文与BlueOak/Apache条款供人工审查；机械完整性不等于兼容性法律认证。

未动模型测试/业务代码、未追加团队日志；主agent负责机械测试迁出与团队日志。不合并/推送/tag/release/delete/付费/改权限/全局安装。
