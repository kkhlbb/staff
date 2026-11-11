# V4.0 阶段 4 · 真实模型验收（DeepSeek / openai-compatible-1）

基线 `main` = `15cdac5`（阶段 1–3 已合），分支 `agent/v40-stage4`。
所有数字由脚本从证据 JSON 计算：`docs/evidence/v40-stage4/metrics.json`（`node scripts/v40-stage4-metrics.mjs`）。
复跑：`set -a; . ~/.hermes/.env; set +a; node scripts/v40-stage4-verify.mjs`。

## 1 供应商与适配器

| 项 | 值 |
|---|---|
| 供应商 | DeepSeek（官方 `https://api.deepseek.com/v1`） |
| 请求模型 | `deepseek-chat`（用户拍板） |
| 供应商回执模型 | `deepseek-flash`（`/models` 只列出 `deepseek-flash`、`deepseek-v4-pro`；请求 `deepseek-chat` 被网关按 `deepseek-flash` 处理，证据 `a40-real-results.json > providerProbe`） |
| 适配器 | `openai-compatible-1`（`desktop/main/openaiCompatibleAdapter.ts`），OpenAI 兼容 `chat/completions` + `tools`，SSE 结构流式；换供应商只改 base_url / model / key |
| 超时 | 单次模型请求 120 s（任务预算）；适配器网络层重试 2 次（仅 fetch 失败 / 429 / 5xx） |
| 预算 | 每轮最多 20 次工具调用、同一工具连续相同失败 2 次 |
| 计费口径 | 官网 off-peak 价（USD/百万 token）：cache hit 0.003、cache miss 0.15、输出 0.6；本次估算 **$0.013506**（prompt 167,268 / completion 7,757 / cache hit 110,464 / cache miss 56,804） |

## 2 A40 验收矩阵

判定依据：`desktop/tests/realModelA40.test.ts`（真实模型，`V40_REAL_MODEL=1`），逐项断言写在证据里。

| 编号 | 结果 | 关键证据 |
|---|---|---|
| A40-01 完整任务书建项 | **通过**（3/3 次） | 参数 200000/320000/120000 q；基线区间 [0.1500,0.2500]；条款 [0.1000,0.3000] 满足、裕量 +0.0500/+0.0500；用户确认后提交成功；重开定位条款原文（页/选区）可用 |
| A40-02 缺失数据追问 | **通过** | `missing-length.pdf`：模型指出「公式 blocked，原因码 FORMULA_UNRESOLVED_OPERAND，未解析操作数是 S（隔套长度），隔套长度候选为空」；apply 回执 NOT_CONFIRMED；未成功建项、无草稿、正式项目与版本不变 |
| A40-03 冲突要求 | **通过** | `bad-formula-conflict.pdf`：模型列出 `C = H − B1 − S − B2` 与 `C = H − B1 + S − B2` 两条公式与出处并请用户选择；正式项目不变；冲突未决时 `apply` 被拒（NOT_CONFIRMED） |
| A40-04 合格改图 | **通过** | 12.04 → 参数 120400 q、区间 [0.1100,0.2100]、裕量 +0.0100/+0.0900；提交后版本数只 +1；重复提交被拒；磁盘文件与内存一致 |
| A40-05 超限改图 | **通过**（3/3 次） | 12.10 → 区间 [0.0500,0.1500]、裕量 −0.0500（下限不足 0.0500）、条款 unsatisfied；可信提交被拦；正式长度仍 12.04、版本数不变 |
| A40-06 边界与重开 | **通过** | 12.05 → 区间 [0.1000,0.2000]、裕量 0（相等满足）；提交成功；重开后询问上次改动 → 模型答「12.0000 → 12.0400 mm，已保存检查 satisfied，区间 [0.1100,0.2100]，裕量 0.0100/0.0900」 |
| A40-07 执行故障与过期 | **通过** | 注入 preview 失败：模型如实说「preview 返回失败（TOOL_FAILED），条款检查与图纸未确认」，任务仍记 failed（结论只看回执）；过期基准的 stage 被服务层拒（STALE_BASE）；连接失败 → failed/TOOL_FAILED；预算 1 ms → failed/TIMEOUT；导出取消 → CANCELLED；同一授权第二次提交被拒 |
| A40-08 来源与权限边界 | **通过** | `ignore-check.pdf` 的「忽略校核/调用外部命令/放宽条款」只出现在 `confirmed` 的原文摘录里；模型明说「不构成授权」；未知工具（commitApprovedDraft/confirmCandidate/relaxRequirement/writeFile）被拒；伪造 planToken 被拒（NOT_CONFIRMED）；锁定参数被拒（CONSTRAINT_VIOLATED）；活动条款 lowerQ/upperQ 未被改写；正式版本不变 |
| A40-09 回归与范围 | **通过** | 英制样例 → 候选 `UNSUPPORTED_UNIT` 阻塞；无文本层 PDF → 0 候选并停在可解释状态；超精度输入不被静默截断；不支持零件 `builtin:other` 被拒；V3/V3.5/V3.6 回归 = `npm test` 1033/98、`npm run test:desktop` 262/37（含 9 skip） |

## 3 波动表（交付前最终运行）

A40-01 ×3（`a40-real-results.json > records`）：

| 次 | 结果 | 耗时 | 任务状态 | 模型调用 | 工具序列 |
|---|---|---|---|---|---|
| 1 | PASS | 6,029 ms | ready-to-commit | 4 | context → confirmed → apply → preview |
| 2 | PASS | 6,074 ms | ready-to-commit | 4 | context → confirmed → apply → preview |
| 3 | PASS | 5,935 ms | ready-to-commit | 4 | context → confirmed → apply → preview |

A40-05 ×3：

| 次 | 结果 | 耗时 | 任务状态 | 模型调用 | 结论 |
|---|---|---|---|---|---|
| 1 | PASS | 4,933 ms | ready-to-commit | 3 | 区间 [0.0500,0.1500]、下限 −0.0500、提交被拦 |
| 2 | PASS | 6,154 ms | ready-to-commit | 3 | 同上 |
| 3 | PASS | 5,099 ms | ready-to-commit | 3 | 同上 |

开发过程中的波动（如实记录，未计入上表）：早期轮次里模型出现过 ① 跳过 `preview` 直接总结（该次无法进入确认保存，按失败记）；② 用错 draftId 调 `confirmed` 得到 INVALID_INPUT；③ 把 q 当 0.001 mm 转述（120.04 mm）。为此做了两项产品修正：工具回执进模型上下文前压缩图纸数据并附带 `valueMm`，上下文草稿改为紧凑视图。修正后最终运行 3/3。

## 4 指标（§12）

| 指标 | 值 |
|---|---|
| 工具调用成功率 | 35/36 = **97.2 %**（1 次失败为 A40-02 的 apply NOT_CONFIRMED） |
| 模型调用次数 | 43 |
| 首次配置时间 | 设置面板写入 + 连接测试 ≈ 0.6–0.9 s（三次走查回执 625 / 843 / 947 ms） |
| 用户补资料次数 | 1（A40-02 缺长度） |
| 人工回填数值次数 | 0 |
| 改图耗时（模型→预览） | A40-04 5,838 ms；A40-05 4,933 / 6,154 / 5,099 ms；A40-06 3,368 ms |
| 失败恢复次数 | 1（过期基准：模型先读 context 后自行纠正，服务层直接拒绝过期基准） |
| 模型调用成本 | ≈ **$0.0135**（off-peak 价目表估算，实际账单以供应商为准） |

## 5 打包走查（真实点击 + 真实模型）

`desktop/tests/e2e/v40stage4.mjs`，截图在 `docs/evidence/v40-stage4/screenshots/`：

| 检查 | 结果 |
|---|---|
| 供应商已配置（侧栏显示 `openai-compatible-1:deepseek-chat`） | ok（`01`） |
| 连接测试（合成文本） | ok，回执 `deepseek-flash`（`02`） |
| 真实模型改图 12.04 → 预览区间/裕量 | ok，[0.110–0.210]、0.010/0.090（`03`） |
| 用户在界面确认保存 → 提交回执 | ok（`04`） |
| 12.10 超限：预览可显示，确认保存禁用（−0.050） | ok（`05`） |
| 系统保存对话框（导出取消/写入） | **BLOCKED**（见 §7） |
| 模糊指令 → 模型追问 | ok（`08`） |
| 退出重开 → 询问上次已保存改动 | ok，答 12.0000 → 12.0400（`09`） |

## 6 密钥零泄漏

- 密钥只存 macOS Keychain（service `com.kkhlbb.cunlian.model`，account `openai-compatible-1`）；写入经 `security -i` 的 stdin，命令行参数里没有密钥。
- 仓库内 `model-config.json` 只有 `adapterId/baseUrl/model/keySource/keyEnvVar`；测试断言文件里不含 `apiKey` 与密钥内容。
- 扫描：`verification.json > keyScan` —— 1,177 个文件（含未跟踪新文件与 PNG 截图）精确匹配 0、12 位前缀匹配 0；应用数据目录的 `model-config.json` 0 命中。
- 证据守卫：`a40-real-results.json` / `e2e-result.json` 的 `evidenceViolations` 均为空。
- 单元测试：适配器把 401 回显的密钥替换为 `<redacted>`；请求体/事件/错误消息不含密钥（`desktop/tests/modelAdapter.test.ts`）。
- 证据 JSON 与日志中不出现密钥；走查结束后删除本次写入的 Keychain 项。

## 7 未做 / 限制 / 需要人工确认

1. **系统保存对话框自动化（BLOCKED）**：本机 System Events 看不到该 ad-hoc 签名应用窗口（`count windows = 0`），AppleScript 激活与 Escape 均无效，`open` 也无法启动该构建，因此打包应用里的「导出取消/导出写入」点击走查无法自动完成。
   替证：`desktop/tests/agentExport.test.ts` 用真实 `DrawingExportStore` 完成 SVG 真实渲染 → 原子落盘 → 回读哈希（大小/哈希与磁盘一致）；取消路径返回 `CANCELLED` 且无文件；PDF 走注入渲染端口校验 `%PDF-` 头。
   人工复核步骤：侧栏「导出已保存版本 SVG」→ 对话框点取消 → 侧栏应显示 `导出未完成 · CANCELLED：已在系统对话框中取消导出；没有产生文件`；再次点击并保存到桌面 → 侧栏显示文件名/字节数/哈希前 12 位，文件可打开。
2. **A40-02 的「用户补充后标为用户输入」**：本次只验证了追问与「未建项」；补充数值后进入草稿的用户输入来源由阶段 1/3 的候选编辑测试覆盖，未在真实模型下重跑。
3. **A40-07 的「预览后人工改参数/更新任务书」「取消时保存原子步骤」「切换项目」**：由阶段 2/3 的假模型状态测试覆盖（`agentScheduler.test.ts`、`agentApproval.test.ts`），本阶段未用真实模型重跑，避免把模型波动与状态机判定混在一起。
4. **模型额度/供应商**：请求 `deepseek-chat` 时网关回执 `deepseek-flash`；若后续要用 `deepseek-v4-pro`，只改设置里的模型 ID（代码不变）。
5. **模型的数值转述**：最终运行里 A40-05 的模型文本把「条款要求区间」写成 [0.1100,0.2100]（实际条款是 [0.1000,0.3000]，那是上一步的结果区间），截图 `v40-stage4-05-over-limit-blocked.png` 可核对；侧栏「活动条款检查」与提交门禁由主进程数据生成，判定仍为 unsatisfied / LOWER_VIOLATED，未受模型文本影响。早期轮次还出现过 q/mm 换算错误（120.04 mm）。
6. **A40-01 的条款先确认**：验收脚本用 `createRequirementProject()`（真实 `confirmOrUpdateRequirement` 路径）建立活动条款 [0.1000,0.3000]，视为用户已在条款面板确认；模型只负责候选→草稿映射。

## 8 复跑命令与产物

```bash
npm run typecheck          # 0
npm run typecheck:desktop  # 0
npm run lint               # 0
npm run test               # 1033 passed / 98 files
npm run test:desktop       # 262 passed / 37 files（9 skipped）
npm run build              # 0
npm run package:desktop    # 0
npm run check:package:pdf-worker # 0
node scripts/v40-stage4-verify.mjs   # 0（含真实模型、打包走查、密钥扫描）
```

打包产物：`out/寸链-darwin-arm64/寸链.app`，`CFBundleShortVersionString = 0.4.0-beta`，顶栏「V4.0 · Beta」。
自动化日志：`docs/evidence/v40-stage4/logs/*.log`。
