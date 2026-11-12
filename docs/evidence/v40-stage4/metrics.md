# V4.0 阶段 4 指标（由脚本从 evidence JSON 计算）

- 工具调用：45/48 成功（成功率 93.8%），失败 3
- 模型调用：61 次
- 用户补资料（追问答疑）次数：2
- 人工回填数值次数：0
- 失败恢复记录次数：2
- 成本（按官网 off-peak 价估算，USD）：0.017843（prompt 216363 / completion 10802 / cache hit 143488 / cache miss 72875）
- 供应商回执模型：deepseek-flash（请求 deepseek-chat，适配器 openai-compatible-1）

| 项目 | 尝试 | 通过 | 尝试耗时 ms | 任务状态 |
|---|---|---|---|---|
| A40-01 | 3 | 3 | 6112 / 6615 / 6557 | ready-to-commit / ready-to-commit / ready-to-commit |
| A40-04 | 1 | 1 | 5281 | ready-to-commit |
| A40-05 | 3 | 3 | 6082 / 6208 / 4867 | ready-to-commit / ready-to-commit / ready-to-commit |
| A40-06 | 1 | 1 | 4196 | completed |
| A40-02 | 1 | 1 | 6777 | failed/NOT_CONFIRMED |
| A40-03 | 3 | 3 | 5217 / 4574 / 4118 | completed / completed / completed |
| A40-07 | 1 | 1 | 6123 | ready-to-commit |
| A40-08 | 1 | 1 | 6738 | ready-to-commit |
| A40-09 | 1 | 1 | 0 | null |
| A40-02b | 2 | 2 | 5220 / 3896 | failed/NOT_CONFIRMED / completed |
| A40-07b | 1 | 1 | 5017 | ready-to-commit |
| A40-07c | 1 | 1 | 3094 | failed/UNSUPPORTED_SCOPE |
| A40-07d | 1 | 1 | 2039 | cancelled/STALE_REPLY |
