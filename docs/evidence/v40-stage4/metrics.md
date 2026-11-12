# V4.0 阶段 4 指标（由脚本从 evidence JSON 计算）

- 工具调用：42/43 成功（成功率 97.7%），失败 1
- 模型调用：54 次
- 用户补资料（追问答疑）次数：0
- 人工回填数值次数：0
- 失败恢复记录次数：2
- 成本（按官网 off-peak 价估算，USD）：0.015544（prompt 186105 / completion 9329 / cache hit 122240 / cache miss 63865）
- 供应商回执模型：deepseek-flash（请求 deepseek-chat，适配器 openai-compatible-1）

| 项目 | 尝试 | 通过 | 尝试耗时 ms | 任务状态 |
|---|---|---|---|---|
| A40-01 | 3 | 3 | 6450 / 7149 / 6231 | ready-to-commit / ready-to-commit / ready-to-commit |
| A40-04 | 1 | 1 | 5882 | ready-to-commit |
| A40-05 | 3 | 3 | 4431 / 5548 / 5479 | ready-to-commit / ready-to-commit / ready-to-commit |
| A40-06 | 1 | 1 | 4112 | completed |
| A40-02 | 1 | 1 | 3499 | completed |
| A40-03 | 3 | 3 | 3685 / 4519 / 4864 | completed / completed / completed |
| A40-07 | 1 | 1 | 5201 | ready-to-commit |
| A40-08 | 1 | 1 | 3421 | completed |
| A40-09 | 1 | 1 | 0 | null |
| A40-02b | 2 | 2 | 3022 / 3638 | completed / completed |
| A40-07b | 1 | 1 | 5969 | ready-to-commit |
| A40-07c-1 | 1 | 1 | 1892 | failed/UNSUPPORTED_SCOPE |
| A40-07c-2 | 1 | 1 | 0 | null |
| A40-07d | 1 | 1 | 1893 | cancelled/STALE_REPLY |
