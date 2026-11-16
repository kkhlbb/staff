# S09/S10 当前口径勘误（不覆盖历史原始报告）

历史 confirm-efficiency 报告中的“12次点击完成58条确认/加单位共15次”不能作为完成证据：
- 旧面板测试使用一份语料形状夹具，mock返回值不更新UI快照；只能证明请求发出，不能证明六份文档的最终确认集合。
- 夹具有28个单值候选、30个多处候选/11个互斥组。1次批量+11次选组，只确认39条，另19条仍pending；单位声明45条不是确认。
- 当前测试用真实 confirmCandidateBatch / confirmCandidate / attestCandidateUnits 复算：声明前 confirmed39/pending19/blocked80，声明后 confirmed39/pending64/blocked35。UI mock不更新的事实也有断言，不再称端到端完成。

当前真实语料分组实跑（原提取器与阈值未改）：6份/140候选/pending58/blocked82，单位单独待补43（不是夹具45）。
- 必须按文档分别计算批量按钮与单位表单，不能整个语料只算一次。
- 同等选择目标：逐条确认39次；批量后确认点击18次；未选pending19条。补单位后仍有62条pending，包含单位步骤的计划操作下界36次。
- 上述数字是PLANNED_NOT_EXECUTED静态分组下界；未计阅读、复核、剩余候选决策与真实工时，不能当“节省工时百分比”或“58条已完成”。
- 新报告默认写到 ../slop-cleanup-evidence/confirm-efficiency/；历史JSON、日志、原报告不重生成。

S10：新增证据文件不再各自膨胀业务用例数。STAGE2格式扫描聚合为一个审计，单独报告扫描文件数；历史冻结哈希与生产序列化契约仍保留。
旧历史测试计数不改。当前总数应引用本轮完整日志，同时区分evidenceRepro非业务守卫与业务测试；不能把文件扫描量称业务覆盖量。

当前证据（以下均相对工作树根目录，不是相对本文件）：../slop-cleanup-evidence/S09-report.log、S09-final.log、S06-red.log、S06-S10-green.log、full-gates/。
