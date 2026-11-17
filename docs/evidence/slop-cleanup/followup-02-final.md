# followup-02 最终验证补记（整卡 OPEN）

代码提交：`60f5511316c0cbe2dcd62003cd70221d2b6860dd`。接续起点实际为 `75f66f9`；已有 S05/S12 提交未回退。完整外部报告及 17 项逐项追踪：`/Users/aston/DSH/tmp/cunlian-v4/slop-cleanup-evidence/followup-02/REPORT.zh-CN.md`、`TRACKING.txt`、`tracking.json`。

实跑结果：

- `node scripts/gt-expand-gates.mjs ../slop-cleanup-evidence/followup-02/full-verification` 实际 exit 0；11 步均 exit 0。
- 应用 130 文件 / 1354 passed；桌面 60 文件通过 / 1 跳过，413 passed / 15 skipped；MCP 22 passed；real-docs 19 passed。跳过项不计通过。
- typecheck、desktop typecheck、lint、build、desktop package、packaged pdf-worker 均 exit 0。
- audit：0 vulnerabilities、exit 0；共享脚本测试 11 pass、exit 0；STEP license 18 pass、exit 0。
- GT nominal58/58、wrongPending0、上下偏差各20，BASELINE MATCH。极值源文件与 GT baseline 文件逐字节未变。
- 原三条 S02 RED 转绿，定向 6 文件 / 35 passed。附加授权/失败安全及 S03/S05/S12 UI/领域专项再次实跑，均 exit 0。
- 实际新包经 main/preload IPC/worker 输出 `packaged.step`、`odd-packaged.step`、`restored.step`；三份原生读回均 ACCEPTED、exit 0，线性阈值仍为 1e-6 mm，体积等原阈值未放宽。资源变异后回读/恢复再次检查 exit 0；app 进程 code=0、signal=null，无本工作树测试/应用遗留进程。
- `npm run check:release:step -- <实际 Contents/Resources>` 实际 exit 1；packageVerification=VERIFIED，但 FORMAL_SOURCE_DELIVERY、TRANSITIVE_NOTICE_REVIEW、LGPL_LEGAL_REVIEW 仍 BLOCKED。
- 基线 525c0f0 的 1614 份源证据逐文件 blob 未变，changed=[]。旧报告、旧失败与用户决策原文没有重写；本补记不是历史报告覆写。

首次包检查漏 Resources 参数、相对路径启动失败，以及源码索引采集器一次定位错误均保留真实 exit 1 和原始输出；正确调用重新执行的输出另存。索引采集器只修定位符，没有改产品或测试断言，初始文件另存 `.initial`。最终 `refresh-source-index.py` 实际 exit 0，17 项索引无缺项；各实际子进程码见外部 `exit-codes.json`。

界限：15 个未获付费授权的真模型项不运行；标准正文未获得；旧 stage4 全流水线、其它主题整套编排、原生对话框 GUI、异厂商 CAD 和无隐式修复互通均不记通过。原生 reader 是既有项目局部 OCP，与产品同属 OCCT 家族，`repairFreeImportProven=false`。

S03/S05/S12 已按用户决策核验，不再待拍板。对于无法验证旧基准或恢复存储失败的冲突，明确拒绝且保留界面/内存及原恢复数据，不假称新恢复副本已持久化，不自动合并业务字段。

结论：本轮已列工程门禁实际通过；发布门禁实际失败，未测范围仍明确存在。整卡保持 OPEN，不作合并、推送、tag、release 或分发批准。
