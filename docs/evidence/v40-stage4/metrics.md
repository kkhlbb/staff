# V4.0 阶段 4 指标（由脚本从 evidence JSON 计算）

- 工具调用：35/36 成功（成功率 97.2%），失败 1
- 模型调用：43 次
- 用户补资料（追问答疑）次数：1
- 人工回填数值次数：0
- 失败恢复记录次数：1
- 成本（按官网 off-peak 价估算，USD）：0.013506（prompt 167268 / completion 7757 / cache hit 110464 / cache miss 56804）
- 供应商回执模型：deepseek-flash（请求 deepseek-chat，适配器 openai-compatible-1）

| 项目 | 尝试 | 通过 | 尝试耗时 ms | 任务状态 |
|---|---|---|---|---|
| A40-01 | 3 | 3 | 6029 / 6074 / 5935 | ready-to-commit / ready-to-commit / ready-to-commit |
| A40-04 | 1 | 1 | 5838 | ready-to-commit |
| A40-05 | 3 | 3 | 4933 / 6154 / 5099 | ready-to-commit / ready-to-commit / ready-to-commit |
| A40-06 | 1 | 1 | 3368 | completed |
| A40-02 | 1 | 1 | 5326 | failed/NOT_CONFIRMED |
| A40-03 | 1 | 1 | 4593 | completed |
| A40-07 | 1 | 1 | 4819 | ready-to-commit |
| A40-08 | 1 | 1 | 6906 | ready-to-commit |
| A40-09 | 1 | 1 | 0 | null |
