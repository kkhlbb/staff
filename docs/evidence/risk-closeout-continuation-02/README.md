# 风险连续收尾 continuation-02：自主机械项完成，真实模型与人工法律/正式交付仍阻塞

分支 agent/risk-closeout。开工实查 HEAD72de5b6、工作区干净。
提交：92931c9 供给脚本与4项TDD；c9e22c5 供给第一阶段证据；3654c73 两条机械测试迁出及门控回归。本报告是后续证据，不是新的运行编译点。
新证据根：/Users/aston/DSH/tmp/cunlian-v4/risk-closeout-evidence/continuation-02
旧 step-distribution-closeout、resume-01 只读保留；团队日志完整读后在本目录新副本承接并追加，原文前缀hash可核对。

## 第一阶段：17 skipped → 15 skipped，不造真实模型 PASS

A40-09、A40-07c-2 的完整 it 代码块逐字节从原门控 describe 移至无条件离线 describe，共享服务/夹具不改，断言/场景/条件分支不改。父核验直接读取 git72de5b6 原文，确认完整函数体相等，不是自造期望。
新增 a40Gate.test.ts 两项 AST 回归：两条标题只属于无条件离线套件；离线套件无 runTask/adapterFor/testConnection/startTask；其余12条A40保留真实模型门控及连接探测。先 RED 两项failed/exit1，再禁网 GREEN 4pass/15skip/exit0（含原两条机械测试）。intent另外3条仍门控。
不把迁出后的机械PASS称为模型PASS；记录仍为modelCalls=0。原测试自身条件性断言/故障注入局限详见旧 skipped-review，本轮不扩张为更强覆盖。

remaining-model-review.md 逐条列剩余15条真实模型必要性、混合机械段及费用条件。只查环境变量/加密条目存在性、Keychain元数据和本地监听端口；没有打印/解密凭据，没有远端模型探测。寸链现有配置为api.deepseek.com/keychain；相关环境键未设、未发现该加密键文件、旧Keychain条目查询exit44；四个常见本地模型端口均未监听。此结论只限已查范围，不宣称全机无键或免费额度用尽。没有已证合法且不新增付费的可运行渠道，所以15条保留skipped。

## 第二阶段：当前实际包及最终供给

当前应用实物：/Users/aston/DSH/tmp/cunlian-v4/risk-closeout-evidence/continuation-02/supply/app/寸链.app
应用归档：/Users/aston/DSH/tmp/cunlian-v4/risk-closeout-evidence/continuation-02/supply/寸链-dependency-fixed-arm64.app.tar.gz
归档 SHA-256 ff9a9f1fb78980ea2aeaee8c4f63fa1ddfd67e6f9be6133fc572ecb8e5d963f8
独立供给：/Users/aston/DSH/tmp/cunlian-v4/risk-closeout-evidence/continuation-02/supply/distribution/
最终MANIFEST SHA-256 005247fb755b49ec3b2420291d55e639cad45a2c16ca9eae21e06c66f9a813a0，116文件/1127173462字节，不含manifest本身和旁置app。
最终源码绑定 3654c73e47c53d077522540fe978c545bab5651f，包含机械迁出测试；与初始供给源码差异仅tests/docs，运行源码未改。不因测试/文档提交无谓重打包或重编内核。pre-final-binding保留前一次源码归档、绑定、manifest、SBOM、回执；父核验 parent-verification.json 是字体补证前阶段回执，最终hash以 final-delivery-receipt.json 为准。
291项实际app全树由父agent独立核对，21份Resources完整绑定；源归档的锁/两测试逐字节等于当前文件。app归档sha亦由父独立重算。禁网交付核验器再次实跑exit0：116供给/21资源，LOCAL_MATERIALS_VERIFIED，releaseApproval=BLOCKED。

新锁相对修复前20个变更/新增节点，去重19官方精确版本tarball，SRI和安装许可原文一致；完整420组件构建锁SBOM与291文件实包SBOM分开。不把dev包都当runtime；实际asar拒绝受修复dev包路径。
app.asar与旧包实际同hash f60450dbb75c92de102ec592cd686bd72561314206c19cfec58532d89982a944；当前资源只少历史额外REPLICAD告知（原文另留供给review），没有谎称新包必须产生新asar hash。
核资产WASM c309d6a202aab5b2b2a498bdd1515b8b03f470ea238dfb99ba5ccb00b8a80108、glue 96ff4cea09e0fcbc3cbdcd07e83c6e03470735db01bcab32b689972b4e57b94f、worker 2eb428ddaa2a22c243d60e2ab8a14dfe696a0a0594acf3d75cbbf54d711ed36c均与已证一致；引用原禁网35413文件重构、真实Controller源修改重编/同应用对象重链接实测，不冒称本轮重编。

真实成包main/preload IPC/worker/STEP落盘exit0，process code0/signal=null；普通/奇数q/恢复三份STEP原生读回分别exit0、ACCEPTED。保留普通/历史冻结/取消/stale/退化、四资源缺坏和有效异hash替换拒绝/恢复断言；未放宽数值。OCP同OCCT家族、默认transfer可能修复，原生文件框桩化，不宣称异厂商/无修复/GUI框UX/跨机验收。

## 字体额外机械补证（没有留在“没装工具”）

仅在 continuation-02/tools/font-audit 新建隔离venv，安装fonttools/brotli，未全局安装、未改其他项目环境。原pip不支持--report的exit2保留，去掉不兼容输出选项后安装exit0，精确版本见font-tool-freeze日志。实际从当前asar抽取两WOFF2及OFL，逐字节匹配源文件，再独立解析name/cmap表，exit0。新增原文表/绑定/tool版本已进入最终供给review清单。
- NotoSansMath-Cunlian-symbols.woff2：name1=Noto Sans Math；name6=NotoSansMath-Regular；cmap=3，glyph=6；版权/name13/14原文均留。
- NotoSansSC-Cunlian-subset.woff2：name1=Noto Sans SC Cunlian；name6=NotoSansSC-Cunlian；cmap=184，glyph=559；版权/name13/14原文均留。
Noto Sans SC版权name0声明Reserved Font Name 'Source'、family/PostScript为Cunlian；Math仍为Noto Sans Math/NotoSansMath-Regular。此处提供事实，不能代替RFN/商标/传递许可法律意见。SOURCE.md的Math“5个子集字符”与实际cmap3不是等同口径，作为既有资料差异显式记录，未据此修改字体/放宽测试。

## 实际执行（原始argv/cwd/退出码在commands.jsonl、原文在logs）

| 阶段 | exit | 实际摘要 |
|---|---:|---|
| gate-red | 1 | Test Files  1 failed (1) / Tests  2 failed (2) |
| gate-green | 0 | Test Files  2 passed | 1 skipped (3) / Tests  4 passed | 15 skipped (19) |
| full-desktop | 1 | Test Files  1 failed | 54 passed | 1 skipped (56) / Tests  10 failed | 370 passed | 15 skipped (395) / Errors  10 errors |
| full-desktop-loopback | 0 | Test Files  55 passed | 1 skipped (56) / Tests  380 passed | 15 skipped (395) |
| final-full-browser | 0 | Test Files  128 passed (128) / Tests  1483 passed (1483) |
| full-mcp | 0 | Test Files  3 passed (3) / Tests  22 passed (22) |
| desktop-typecheck | 0 | 完整输出见对应日志 |
| app-typecheck | 0 | 完整输出见对应日志 |
| final-lint | 0 | 完整输出见对应日志 |
| build | 0 | 完整输出见对应日志 |
| npm-audit | 0 | 完整输出见对应日志 |
| sealed-final-supply | 0 | "status": "LOCAL_MATERIALS_VERIFIED", |
| final-actual-resources-gate | 1 | 完整输出见对应日志 |
| packaged-font-name-tables | 0 | 完整输出见对应日志 |

三套主回归合计1885 passed，15 skipped（仅真模型），各退出0；许可18pass、供给核验8pass、Python供给4pass另列，不重复累计。npm audit总漏洞0。
禁网全桌面那次不是PASS：10failed/370passed/15skipped、10unhandled listen EPERM。因为它还要启动本机适配器桩server；保留失败，正常允许回环并明确unset真模型开关/键后整套380pass/15skip。没有用假服务冒充真实模型，这些本就是适配器协议单测。

## 仅剩确切外部依赖/明确未验证

1. 15真实模型场景：用户明确费用/预算及合法配置，或提供已证无需新增付费、具备真实工具/流式能力的兼容模型服务。无调用授权不启动连接探测。
2. FORMAL_SOURCE_DELIVERY：负责人确定逐接收方渠道/维护责任、用户本人批准任何公开外发并实际提供。现有本地完整备料不等于正式提供。
3. TRANSITIVE_NOTICE_REVIEW：人工确认293无leading notice的许可继承，生成JS/头/原生Electron/FFmpeg/PDF精确范围；字体name事实已补，不再挂“未解析”，法律适用仍需审查。
4. LGPL_LEGAL_REVIEW：合格审查员确认§2(b)历史修改日期/显著通知overlay、§4/§6(a)对应源/对象/工具例外/交付渠道、§6用户修改及逆向调试与EULA。新增BlueOak/Apache原文同样提供审查，非实现者签法律放行。
实际Resources release gate始终exit1，packageVerification=VERIFIED、INCOMPLETE与三blocker保留；未把资源完整性等同法律批准。
跨主机/异厂商/无自动修复、字体法律认证/外部schema认证不是本轮已验项，不能据本轮绿灯扩张。

实现源码范围diff --check exit0；最终暂存证据diff --check实际exit2（原始日志EOF空行、Vite/pip原始输出尾空格），诊断见logs/final-staged-diff-check.stdout.txt。如实保留第三方原文/原日志，不为绿灯裁剪，不记通过。
未merge/push/tag/release/delete/付费/改权限/全局安装，未动其他工作树。最终仅证据文档归档后提交，再实查git状态。
