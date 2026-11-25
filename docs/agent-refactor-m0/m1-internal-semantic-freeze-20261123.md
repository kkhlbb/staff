# M1 内部语义冻结记录 2026-11-23

18:40 前端确认、父接受的语义：

1. 连接、授权、写入占用相互独立。
2. 两入口共享 projectId、draftRevision。
3. takeOver 递增 epoch，旧 token 写入拒绝（WRITER_REVOKED 或 M0 既有码）。
4. context 的 snapshot、activities 来自同一日志切点并带续读 cursor。
5. afterSequence 是排他下界；nextCursor 仅为实际返回末条序号，空页保持输入；highWatermark 不是消费游标。
6. 项目切换、撤权取消旧订阅且拒收迟到事件；后端拒绝旧 writerEpoch。
7. 历史不足显式 CURSOR_EXPIRED，须重取 snapshot，不伪造连续历史。超前游标同样重取。撤权 AUTH_REQUIRED 并清除受限视图。

本轮仅新增内部模块 m1InternalService.ts，测试直接导入；未新增共享 M1 DTO 文件。内部 storage:1 仅为存储格式，不是公开协议版本。沿用 M0 guards 的既有请求校验作为内部测试入口，不构成新公开 API。

未冻结且未编码：公共草稿分支类型、对话方法名、公开 operation 名、0.2.0-m1 协议版本、占用保留时限、可见身份标签。expireHistoryForTest 是明确测试挂钩，不是生产留存策略。

可靠样本：desktop/main/project-agent/guards.ts、desktop/tests/projectAgentM0.node.mjs（门禁、收据）；desktop/shared/project-agent/events.ts（连续流）；desktop/main/agentTaskStore.ts（临时文件/回读/rename）；desktop/tests/projectAgentCompatibility.test.ts（六份既有版本化夹具，只读）。未改公式、单位或夹具。

实现差距以本轮证据报告为准；冻结语义不等于已实现或真实入口验收通过。
