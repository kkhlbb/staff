# 正确性扩样 gt-02 交付

基线 main `bd596cf`；分支 `agent/gt-expand`。只核验与接入度量，未修改产品抽取规则、阈值、判据。保留gt-01及README、旧裁片；没有切换OCR分支、修改模型配置、安装依赖、调用外部服务、合并或推送。

## 实际覆盖

| 文档 | 本次pending | nominal核验 | 上偏差数值核验 | 下偏差数值核验 |
|---|---:|---:|---:|---:|
| r1 | 4 | 4 | 0 | 0 |
| r2 | 10 | 10 | 7 | 7 |
| r3 | 0 | 0 | 0 | 0 |
| r4 | 1 | 1 | 0 | 0 |
| r5 | 2 | 2 | 0 | 0 |
| r6 | 41 | 41 | 13 | 13 |
| 合计 | 58 | 58 | 20 | 20 |

任务卡r6=44为旧数，不沿用。wrongPending=0，nominalWrong=0；unchecked=[]，uncheckedReasons={}。其余38条原件未标上下偏差，不当成数值0通过；见coverage.md逐条原因。没有未覆盖pending，r3是实跑无pending，不是跳过。

本次核读者是实现助手；render-crop不表示用户亲自复核。只证明这些pending的读数，不证明全文召回率、blocked/OCR或候选业务语义正确性。

## 原件证据与过程

先校验6份原PDF字节数/SHA-256，提取器仅提供页码/几何定位，4倍渲染原件；先看图转录，再做精确q比较。gt-02.json数值来自原件图，不从抽取数值生成。原件公式末值照印刷抄录，不自行重算或纠正原文。

首次仅看nominal裁片有4条“未写偏差但抽取有偏差”的表面差异。另渲染偏差出处后页并目视核验：r6-02在p2/p3为A₁=759.48±0.1mm，r6-13在p3为B₁=238.1±0.07mm，r6-14在p3为B₃=488.88±0.05mm，r6-15在p3为B₂=32.5±0.03mm。5张独立补充裁片见deviationSources，最终差异0条，详见disagreements.md。未把抽取值当真值，也未将nominal裁片未写偏差直接算成错误。

五张示例：

- [r1 A₁=34mm](crops/gt-02/r1-02-p30.png)
- [r2 L₂=100，上−0.1、下+0.2，保持原排版](crops/gt-02/r2-03-p2.png)
- [r4 R=0.5mm](crops/gt-02/r4-01-p108.png)
- [r6 T₀印刷末值0.182mm](crops/gt-02/r6-20-p3.png)
- [r6 B₂=32.5±0.03mm，后页偏差出处](crops/gt-02/r6-15-upperDeviation-0-p3.png)

scope-audit.json证明gt-01字节与旧裁片未变、除correctness外抽取度量与bd596cf完全一致。基线显式更新仅反映核验范围和字段扩展，未改变抽取结果；完整输出logs/baseline-update.log。随后常规度量BASELINE MATCH。

## 门禁实际输出

| 命令 | 退出码 | 实际结果 |
|---|---:|---|
| npm run typecheck | 0 | 无类型错误 |
| npm run typecheck:desktop | 0 | 无类型错误 |
| npm run lint | 0 | 无lint错误 |
| npm test（最终证据清单） | 0 | 126 files / 1437 tests passed |
| npm run test:desktop | 0 | 46 files passed、2 skipped；333 tests passed、17 skipped |
| npm run test:mcp | 0 | 3 files / 22 tests passed |
| npm run build | 0 | 成功；大于500kB chunk警告原样保留 |
| npm run test:real-docs | 0 | 5 files / 19 tests passed |
| node scripts/real-doc-metrics.mjs | 0 | pendingChecked=58、wrongPending=0、BASELINE MATCH |
| npm run package:desktop | 0 | darwin arm64打包；PDF worker断言PASS |
| npm run check:package:pdf-worker | 0 | worker字节/版本、入口引用断言PASS |

首次npm test为1435；新增scope-audit.json和package-proof.json后证据守卫增加2条，最终1437。两次原日志均保留。gates.json记录各项真实退出码/信号，完整输出在logs/。

M59：度量源码真实少比对每文档最后一条，计数断言期望58实际53，红退出1（4失败/3通过）；恢复7/7绿，退出0。
M60：真实让缺失cropFile仍计已核，断言期望0实际1，红退出1（2失败/5通过）；恢复7/7绿，退出0。
变异patch、源文件恢复SHA-256和原日志见mutations.json、mutations/。合成候选仅用于比较器单测，不用于建立原件真值。

## 复跑入口

依次运行：

    node scripts/gt-expand-crops.mjs
    node scripts/gt-expand-truth.mjs
    node scripts/gt-expand-report.mjs
    node scripts/gt-expand-audit.mjs
    node scripts/gt-expand-mutations.mjs
    node scripts/gt-expand-gates.mjs
    node scripts/gt-expand-final-check.mjs

truth脚本仅保存已目视转录的固定真值，不是自动核真算法；更换语料不能直接沿用。语料路径遵循REAL_DOC_CORPUS/manifest约定。crops脚本不输出抽取数值；比较器按文档/页/几何与稳定ID匹配，按精确q比较，不放宽精度。缺图、歧义、重复计数有独立守卫。

## 未做项与限制

- 桌面17条真实模型测试按原有条件跳过：intentRealModel.test.ts、realModelA40.test.ts。本轮不访问外部网络或调模型，跳过不记通过。
- 未做打包GUI交互/E2E或原生对话框人工操作；已实跑打包及PDF worker静态断言，不冒充GUI通过。
- 未扩展blocked、OCR、全文召回或数学推导核验；本轮不修规则及产品问题。
- build大chunk警告未消除、未修改警告阈值。
- 附加检查 `git diff --cached --check` 真实退出2：仅原始CLI日志中的表格对齐/构建输出尾随空格；原日志不清洗以保留证据。完整输出见logs/diff-check.log。排除原始logs后的源码/结构化证据检查退出0。此项未记作全通过。

实际打包产物在仓库下out/寸链-darwin-arm64/寸链.app；asar摘要与入口见package-proof.json。
