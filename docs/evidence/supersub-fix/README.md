# 上下标与公差粘连修复

基线：main `f16f5eb`。实现分支：`agent/supersub-fix`（以用户消息为准，任务卡中的 subsup 拼写未采用）。规则版本：`document-extractor-8`。
未合并、未推送、未删除分支。`agent/ocr-scanned` 保持 `9cf0656fe05c1dbfc55747a34fac2cb09b8d95d9`；main 保持原提交。

## A–D：真值、修复和正确性

- 真值：`../ground-truth/gt-01.json` 的 entries，r2 7 条 + r5 2 条 + r6 按基线候选顺序前 10 条，共 19 条。
- 每条均有原件真渲染裁片，核读后才填写 nominal / upperDeviation / lowerDeviation；数值不是从抽取结果倒推。转录位置记法见 `../ground-truth/README.md`。
- 三张示例和全部对照：打开本目录 `index.html`；逐条文本表 `COMPARISON.md`；机器可核对数据 `comparison.json`。
- 改前：19 条 checked，wrongPending=2，见 `before-correctness.json`；r2 的 7 条中错误 2 条。
- 改后：`correctness: {pendingChecked:19, wrongPending:0, wrongRate:0}`。
- r2 L1：1001 → 100，上偏差 +0.2，下偏差 −0.1。
- r2 L3：430 → 43，上偏差 +0.2，下偏差 0。
- r2 5.20 → 5.2，上偏差 +0.1，下偏差 0；两者 nominal q 相同，但改前吞掉了公差。
- r2 L1=30 的额外真实裁片回归：nominal 30 / upper 0 / lower −0.2。
- bogus 1001/430 已从本次 r2 候选 nominal 消失；rawText 保留原文本层的粘连串用于审计，不伪造原始文本层。

数量如实报告：

| 文档 | 改前 total/pending/blocked | 改后 total/pending/blocked | 真值 checked / wrongPending |
|---|---|---|---|
| r2 | 22 / 7 / 15 | 24 / 10 / 14 | 7 / 0 |
| r5 | 4 / 2 / 2 | 4 / 2 / 2 | 2 / 0 |
| r6 | 87 / 44 / 43 | 87 / 41 / 46 | 10 / 0 |
| 全部 6 份 | 138 / 58 / 80 | 140 / 58 / 82 | 19 / 0 |

r2 的增加来自以前被拆开的公差现在能隔离出基本尺寸，不为数量保留粘连数字。r6 的减少是偏差冲突/可疑字号保守阻塞，不把下降写成漏测。

## 实现范围

- `src/document-extraction/scriptsGeometry.ts`：以数值主字号和 transform 导出的 y 基线判断。识别字号比 <0.8；可疑字号比 <0.95；基线偏移比例 >0.05 且 ≤0.65；横向 padding 比例 0.25。全部是有边界用例的常量。
- 先屏蔽数值 RHS 中的可疑小字，再交原赋值解析器；原文、span 偏移和出处保留。分不清或文字形态不合法 → `SUBSCRIPT_AMBIGUOUS`，不能成为 pending，也不拼进 nominal。
- `parse.ts`：几何公差复用现有 upperDeviation / lowerDeviation 与出处构建；仅一侧存在时另一侧为 0，不取负值猜对称。
- `types.ts`：版本 8、新原因码。既有 ± 路径不改；OCR、平台业务代码未改。
- `scripts/real-docs/metrics.mjs`：按文档、页、nominal 出处几何匹配，用符号出处锚点区分共享数值的 T1/T2；逐 q 精确比较，不按数值选正确候选。
- CLI 的普通/补单位两种度量都报告 correctness；wrongPending>0 时拒绝接受基线。真实语料测试独立断言 checked=19、wrongPending=0，不能只更新基线绕过。
- 同步现有版本断言/种子/E2E 脚本中的当前规则版本。真实文档数量断言按实测精确更新，未改成宽松范围。
- 更新 BENCHMARK、baseline.json、metrics.json；补单位仍真的执行并撤销，歧义项不能被补单位解锁。

新增针对性用例：`scriptsGeometry.test.ts` 15 条、`correctness.test.ts` 5 条；证据 JSON 另有默认套件的逐文件守卫。覆盖真实 1001/430、5.2+0.1/0、30+0/−0.2、非对称、单侧、基线/字号阈值、小字缺几何、可疑字号、不可识别文字、正常同字号 1001 不被启发式改写、q 级错值、错误页/文档、缺失/blocked 不假报检查、符号链不按值择优。

## E：M43 / M44 / M45

运行：`node scripts/supersub-mutations.mjs`。直接改真实源码、每次 finally 逐字恢复，不在产品中留变异开关。

| 变异 | 红 | 恢复绿 | 实际捕获 |
|---|---|---|---|
| M43 关闭几何隔离 | exit 1，2 failed | exit 0，2 passed | 原始行分组真实快照重新出现 nominal 1001 / 430 |
| M44 下偏差改为上偏差取负 | exit 1，1 failed | exit 0，1 passed | q=-2000，而期望 q=-1000 |
| M45 歧义改为静默原串拼接 | exit 1，3 failed | exit 0，3 passed | 基线不明、缺几何、可疑字号的数字不再保守阻塞 |

机器记录：`mutations.json`；原始输出：`logs/M43-*.log`、`M44-*.log`、`M45-*.log`。筛选运行中未命中的用例由 Vitest 标 skipped，不冒充通过；完整默认套件另跑。

## F：最终实际执行

`node scripts/supersub-acceptance.mjs` 顺序执行六条验收命令及附加检查：

| 命令 | 实际结果 | 证据 |
|---|---|---|
| npm test | 112 文件，1272 passed，exit 0 | logs/01-test.log |
| npm run test:desktop | 43 文件通过，297 passed；2 文件/17 条 skipped，exit 0 | logs/02-desktop.log |
| npm run typecheck | exit 0 | logs/03-typecheck.log |
| npm run lint | exit 0 | logs/04-lint.log |
| npm run test:real-docs | 4 文件，12 passed，exit 0 | logs/05-real-docs.log |
| npm run metrics:real-docs | checked 19 / wrong 0；BASELINE MATCH，exit 0 | logs/06-metrics.log |
| npm run typecheck:desktop | exit 0 | logs/08-typecheck-desktop.log |
| npm run test:mcp | 3 文件，22 passed，exit 0 | logs/09-mcp.log |
| npm run build | exit 0；保留 chunk >500 kB 警告 | logs/10-build.log |

全程拒绝外网访问。普通命令放在 macOS `sandbox-exec` 的 deny network* 策略中；desktop 套件的模型适配器测试需要本机 HTTP stub，额外只允许 localhost bind/inbound/outbound，仍拒绝外网。第一次连 loopback 也禁用导致 EPERM/超时的原始失败保留在 `logs/02-desktop-no-loopback-failed.log`，没有提高测试超时或修改平台测试。

打包实际命令（同一 npm package 脚本）：

    sandbox-exec -p '(version 1)(allow default)(deny network*)' env NODE_OPTIONS='--import ./scripts/supersub-offline-context.mjs' npm run package:desktop

exit 0，见 `logs/07-package-command-offline.log`。打包前的默认离线命令会尝试重新获取 SHASUMS256.txt，即使 ZIP 已命中本地缓存；被沙箱拦截的失败保留在 `logs/07-package.log` / `07-package-offline-debug.log`。preload 只把已安装 `electron/checksums.json` 的官方哈希传给 Forge 内存配置，仍校验缓存 ZIP，不关闭校验，不改 Forge/平台配置文件，不联网补依赖。

产物：`out/寸链-darwin-arm64/寸链.app`。现有 PDF worker 字节一致性断言通过；`package-proof.json` 额外记录 app.asar SHA-256，并实际读包确认 main 内含 version 8、SUBSCRIPT_AMBIGUOUS、RULE_GEOMETRIC_SCRIPTS。

## 未做项与局限

- 正确性数字仅覆盖指定 19 条 nominal；其余 pending 未逐条裁片核验，不宣称全语料 100% 正确。
- 现有符号截断/跨栏粘连（ryL2、avA 等）未在本单修复；复杂表格/任意数学版式未新增全面支持。
- r6 A1=759.48 的候选带 ±0.1，是原有同符号同值跨处合并；该裁片没有公差，真值仍为 null/null。这是为何 nominal 正确率不能冒充所有字段正确率。
- 未做打包应用人工 GUI 走查、Windows/Linux 打包、OCR；desktop 的 17 条既有 skipped 没有记作通过。
- 默认套件仍输出 jsdom navigation/canvas 未实现提示；构建仍有 chunk size 警告。均保留原输出，未为过验收降低判据。
- 原始日志保留表格填充空格/末尾空行，因此全量 `git diff --check` 会提示日志空白；排除 `docs/evidence/supersub-fix/logs` 后检查通过，未清洗真实输出来隐藏警告。

提交后用 `git status --short` 验证干净；提交号与最终 main/OCR 分支核对结果见交付消息。
