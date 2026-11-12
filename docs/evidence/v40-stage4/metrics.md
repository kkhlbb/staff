# V4.0 阶段 4 指标（由脚本从 evidence JSON 计算）

- 工具调用：37/38 成功（成功率 97.4%），失败 1
- 模型调用：46 次
- 用户补资料（追问答疑）次数：1
- 人工回填数值次数：0
- 失败恢复记录次数：1
- 成本（按官网 off-peak 价估算，USD）：0.013985（prompt 166766 / completion 8680 / cache hit 110464 / cache miss 56302）
- 供应商回执模型：deepseek-flash（请求 deepseek-chat，适配器 openai-compatible-1）

| 项目 | 尝试 | 通过 | 尝试耗时 ms | 任务状态 |
|---|---|---|---|---|
| A40-01 | 3 | 3 | 6076 / 6239 / 6133 | ready-to-commit / ready-to-commit / ready-to-commit |
| A40-04 | 1 | 1 | 5137 | ready-to-commit |
| A40-05 | 3 | 3 | 4282 / 5965 / 5334 | ready-to-commit / ready-to-commit / ready-to-commit |
| A40-06 | 1 | 1 | 3900 | completed |
| A40-02 | 1 | 1 | 5822 | failed/NOT_CONFIRMED |
| A40-03 | 3 | 3 | 4827 / 4478 / 4338 | completed / completed / completed |
| A40-07 | 1 | 1 | 5121 | ready-to-commit |
| A40-08 | 1 | 1 | 6595 | ready-to-commit |
| A40-09 | 1 | 1 | 0 | null |
