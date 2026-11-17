# slop cleanup followup-02：会话事务与明确冲突回执

本记录不关闭整卡，不授权合并或发布。外部原始证据目录：`/Users/aston/DSH/tmp/cunlian-v4/slop-cleanup-evidence/followup-02`。

## S02 的实际边界

- `ProjectService.transaction` 是每会话异步 FIFO；不同会话独立，异常不毒化队列。AsyncLocalStorage 只允许仍存活事务的内部嵌套调用重入。
- save/saveAs、candidate、stage、stageFromDto、applySpacerDrawing、closeSession 共用队列。ChangeService/ExtractionService 原局部编排队列转发到此队列；Agent 的变更编排也转发到此队列。
- model/source/sketch/drawing 的 IPC handler 从 sender/schema 校验之后开始加入同一事务，包含其恢复写入。Agent 的 createIntentProject/runIntentTool/confirmIntentCandidate/ingest 路径同样加入；ChangeService 的草稿修改及条款草稿修改与 apply/confirm 共用协议。
- main 的完整受信 stage 作为完整后继版本接受，必要时只分配更高传输序号，绝不合并业务字段。renderer DTO 在接收时固定、按当时权威字段校验；排队期间基准改变时不合入候选，明确 STALE_EDIT，界面编辑不重置，完整冲突副本写入恢复数据，main 保留冲突 dirty 状态。
- 迟到的旧正式版本 DTO，可依据 main 中仍存在的当前 schema 冻结历史或已保留冲突基准写出独立恢复副本；没有可验证旧基准时明确回执“本次恢复草稿未更新”，原恢复数据不变，界面及 main 内存仍保留请求，阻止保存/提交/已保存版本导出冒充已解决。
- 恢复异常明示 failed，不返回已持久化；原文件和旧恢复草稿保持。正式提交后的清理在共享事务内，普通保存清理只退休 savedSeq 覆盖且当前没有待接纳编辑/冲突的代数。
- 授权仍按原顺序在校验/独立重算后、写盘前消费，失败不返还令牌；本次没有改动消费策略。

## S05 的最终边界

继承已有 UI“先保存”提示和 main dirty 拒绝，不静默保存。已入队但未发布的 stage 及未解决冲突也算 dirty。对话框/生成阶段不占会话锁，编辑会使导出取消且零目标写入；最终落盘才加入共同事务。如果新编辑到达于最终 rename 内，则排在导出事务之后才接受并回执，项目保持 dirty，不存在 busy 却回成功丢编辑。`canCommit` 只是取消条件，不被描述成异步提交锁。

## 真实执行（本次代码阶段）

- `01-baseline-red.log`：原三条 S02 RED，exit 1。
- 原三条 `candidateRace` 未删、未 xfail，保留“new edit 存在且 dirty”的断言；仅按异步协议先提交 stage promise、释放 rename 栅栏、再等待回执，另加磁盘 approved 读回与 savedSeq 断言。
- `20-focused.log`：6 文件 / 35 passed，exit 0；含原三红、S01 保存/恢复竞态、真实 IPC 冲突恢复读回、跨会话隔离、rename 失败原文件不变、恢复异常旧数据保持、重复序号拒绝、队列异常/关闭后禁止旧会话写盘、冲突恢复成副本后显式另存、S05 各阶段编辑。
- `21-typecheck.log`：desktop typecheck exit 0。
- `full-verification/gates.json`：11 步均 exit 0；应用 130 文件 / 1354 passed；桌面 60 passed / 1 skipped 文件，413 passed / 15 skipped 用例；MCP 22 passed；real-docs 19 passed；GT nominal58/58、wrongPending0、偏差各20，BASELINE MATCH；typecheck、desktop、lint、build、package、pdf-worker 均真实通过。
- audit、script tests、STEP license 的原始输出分别位于 `23-audit.log`、`24-script-tests.log`、`25-step-license.log`，均 exit 0。
- 中间失败、超时和类型检查失败保留为独立日志，没有覆盖成绿。

## 用户已决策项

S03 维持公差带中点的统一分布契约，含单边/非对称/负方向，极值内核不改。S12 已有提交 `2c5fe2d` 将同次权威重算的私有上下文用于检查，独立提交重算保留；`orchestration.test.ts` 的 8 条断言随全量测试实际通过。S03/S05/S12 不是待拍板问题。

最终打包 STEP 运行与原生读回、17 项最终追踪及历史原件核验另记外部 followup-02 最终报告。本记录不把尚未执行的该部分写成通过。15 个真实模型项未获付费授权，不运行、不记通过。
