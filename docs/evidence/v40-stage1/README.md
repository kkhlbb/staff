# V4.0 阶段 1交付与证据

## 范围与基线

开工实际 `HEAD=60d8750`，分支 `main`，`git status --short` 无输出；从此创建 `agent/v40-stage1`。只做无模型工程工具，不做 UI，不修改整数 q 单位与计算内核，不改历史证据；未 merge、push、删除分支或发布。

## 实现清单

- `src/agent-tools/mapConfirmed.ts`：应用已验证的 ApplicationPlan，映射三参数、登记链环数值/偏差/方向/修订号、参数绑定、未确认条款，复用 `computeChange`/`calculateChain` 生成图纸、3D 参数和检查数据。缺项逐字段给用途；几何完整但装配不完整时返回几何草稿及 `issues[].code=NEEDS_CLARIFICATION`，不谎报任务完成。
- `desktop/main/agentToolService.ts`：五项工具服务、持久化决定重读、可信计划凭据、来源最新版本与字节 SHA 校验、重新 `planApplication`、正式版本及独立工程编辑基准校验、串行写入、幂等回执、草稿和恢复元数据单文件原子写。
- `desktop/main/agentToolChannels.ts`：严格结构、窗口校验、统一信封。新增三个 `agent:*` 通道；以 `toolMode:'agent'` 在原 `change:stage` / `change:preview` 通道分流，原调用及原 IpcResult 语义不变。
- `desktop/main/extractionChannels.ts`、`recovery.ts`、`index.ts`：只在既有 UI `extraction:decide` 的 confirm 成功后，flush 已有恢复容器并重读成功才签发 token。正常保存已清理恢复副本时，只在没有未保存编辑的前提下重读正式项目文件。token 由 main 持有并绑定窗口/会话/候选整份决定代数与工程基准，10 分钟有效；Agent 无签发接口。
- `desktop/shared/contracts.ts`、`desktop/preload/index.ts`：新增 ToolResult / ToolErrorCode 与五个具体 API，不暴露任意 invoke 或确认工具。`confirmed/user/approvedBy` 请求声明被丢弃，不构成凭据。
- `desktop/tests/agentTools.test.ts`：任务卡九项状态验收及七项边界补测；`preloadContract.test.ts`、`src/pages/DesktopWorkspace.test.tsx` 仅同步新增 API 的契约/未调用 mock，未改 UI。
- `scripts/v40-stage1-{verify,mutations,packaged,audit}.mjs`：可重跑的命令日志、变异、打包应用取证及证据守卫。

工程草稿存于主进程工作区 `workspace/agent-inputs/<project-id-sha256>.json`，内容包含完整工具草稿、来源决定摘要、基准、恢复元数据及幂等回执，单次 rename 是唯一提交点；没有第二份需同步的草稿索引。临时文件字节回读相等且 CAS 基准不变后才 rename，写失败不替换旧草稿。原正式项目、旧正式版本、target、来源与分析快照均不写。恢复项目后可由 getProjectContext 重新读取工作草稿；源或基准变更会标记 stale，预览/修改拒绝。

本阶段工具草稿没有自动导入旧 change:apply 提交令牌的能力，也没有提交授权；不是可直接正式保存的新版本。后续阶段 3 必须接用户确认与既有提交门禁，不能把本阶段的几何/条款预览回执当成提交授权。

## 样本先验

`fixtures/README.md`、`verification.txt` 与 `existing-fixtures-audit.txt` 记录真实 pdfjs 核验。完整样本为仓库 `taskbook-TB-2026-1110.pdf`，SHA-256：

`6b6b02ebbe796168447ec18b698fa12db6a93eb7f5dd1ec5b9a9473879b6f0ff`

旧 `v35-indep/generic/taskbook.pdf` 缺几何尺寸，不单独作为完整验收资料。已有完整 PDF，未另造 PDF，也未假称独立验证过其他真实文件。

`fixtures/a40-01-seed.cunlian` 是打包链路的模板容器：真实 fixture 字节和采样项目结构，经正常 encode/decode 校验；没有预填提取确认或工程参数。可在仓库根目录重生成：

    V40_SEED_OUT="$PWD/docs/evidence/v40-stage1/fixtures/a40-01-seed.cunlian" npx vitest run --config vitest.desktop.config.ts desktop/tests/agentTools.test.ts -t '01 A40-01'

SHA 与字节数均由 `artifacts.json` 实测记录。

## 实际验收结果

任务卡九项对应 `agentTools.test.ts` 的 01—09，均通过：

1. 真实 PDF→逐条 UI 确认通道→应用草稿：三参数、四环、方向、绑定、条款草稿、图纸与 3D 参数，区间 [1500,2500] q。
2. `confirmed/user/approvedBy` 伪造不生效；有效 UI token 也不能把其余未确认候选映入草稿。
3. 过期正式版本返回 STALE_BASE，磁盘和聚合字节/状态不变。
4. 最新来源版本变化返回 SOURCE_CHANGED，既有草稿及来源字节不变。
5. 同 token/基准并发重试仅一个草稿 ID，文件字节不变。
6. 注入 ENOSPC 返回 SAVE_FAILED，项目、既有工具草稿、恢复文件和附件字节深比较不变。
7. 缺长度返回 NEEDS_CLARIFICATION，具体 `parameters.length` 与用途，零写入。
8. 同符号两条已确认返回 CONSTRAINT_VIOLATED，保留 GROUP_ALREADY_CONFIRMED 原因。
9. 五工具成功、业务错误、参数错误与不可信窗口均含 requestId/objectVersion；受控增量 +0.04 mm 得 [1100,2100] q，条款侧裕量 100/900 q。

补测 10—16：同正式 ID 下独立编辑使旧计划/预览过期；几何草稿缺关系不冒充完成；伪造 token 与 UI 撤销；不支持的公式；跨其他计划幂等/不同映射重放拒绝/锁定与非法几何；正常保存后重读正式项目决定；不同数值基线的真实映射及原 target 与条款独立。

最新实测：16/16 阶段用例；单测 1008/95 文件；桌面 217/30 文件。精确命令与原始输出在 `logs/` 和 `verification.json`：

    npm run typecheck                 exit 0
    npm run typecheck:desktop         exit 0
    npm run lint                      exit 0
    npm run test                      exit 0
    npm run test:desktop              exit 0
    npm run build                     exit 0
    npm run package:desktop           exit 0

`node scripts/v40-stage1-verify.mjs` 重跑以上六命令、打包与专项测试。新增 JSON 全部经 `serializeEvidence`；`final-audit.log` 验证四份 JSON 的守卫与序列化幂等。

## M08 / M09

`node scripts/v40-stage1-mutations.mjs` 自动保存原实现、施加变异、运行指定状态用例、finally 恢复，再运行相同用例。

- M08 跳过 planApplication：未确认候选被实际写成草稿，02 用例预期 NOT_CONFIRMED 却得到 ok:true，exit 1；恢复后 exit 0。
- M09 去掉 baseRevisionId 检查：03 用例预期 STALE_BASE 却得到 ok:true，exit 1；恢复后 exit 0。

真实 patch、红绿日志在 `mutations/`；不是编译失败或 mock 返回失败替代变异击杀。

## 打包应用实际链路

产物：`out/寸链-darwin-arm64/寸链.app`。`package-desktop.log` 包含 Forge 输出与打包 PDF worker 断言。`artifacts.json` 记录 app.asar / 可执行文件的实际字节数及 SHA-256。

`a40-01-packaged-trace.json` 是真实打包应用中通过 preload 调用的 15 步脱敏日志：真实提取、7 次逐项决定、读取决定、应用、幂等重试、基线预览、读取上下文、参数增量、再次预览。记录入参/出参摘要、耗时、requestId 来源。旧 extraction/decide IPC 没有服务端 requestId；这些步骤明确标为 caller-correlation-legacy-ipc，不冒充服务端回执；五个新工具的 requestId 来自服务端。序列化将生成 ID 标记为 `<generated>`，数值、q、SHA、状态及耗时保留。

原始断言在 `logs/packaged-a40-01.log`：基线 [0.1500,0.2500]，长度加到 12.04 后 [0.1100,0.2100]，正式版本/target/原文件字节不变，真实工作区草稿与恢复元数据回读一致。

本机原有寸链进程占锁，首次默认目录运行退出，留 `first-packaged-lock-blocker.log`；未关闭或接管原实例。最终用独立 HOME/CFFIXED_USER_HOME 通过 `open -n` 启动，且只结束带本次唯一启动标记的测试进程。独立 HOME 放在当前 profile scratch，脚本可显式指定：

    V40_APP_HOME="$TMPDIR/v40-stage1-app-home" node scripts/v40-stage1-packaged.mjs

Finder open-file 到达时 renderer 监听器未就绪的首次尝试也保留 `second-packaged-open-event.log`。最终脚本对该测试实例调用正常 openProject 消费排队文件事件，未加产品测试后门。

`boundary-fixture-initial-failure.log` 保留一次额外边界测试夹具构造失败：容器本身拒绝“已确认但决定代数不匹配”的非法输入；最终补测改为真实 UI revoke 路径验证旧凭据失效，未放宽 schema 或确认校验。

## 明确未做与限制

- `locateEvidence` 不实现：本阶段只返回定位引用；工作台定位留阶段 3。
- `commitApprovedDraft` 不实现：阶段 3 接一次性用户授权和既有 change:apply；本阶段不签发提交令牌、不写正式版本。
- `exportApprovedVersion` 不实现：阶段 4 接已保存版本与系统对话框授权；本阶段没有导出操作。
- 无模型、无 Agent 侧栏/新 UI、无联网/密钥/费用，不把本次无模型链路称为真实模型验收。
- 工程草稿保存在本机工具工作区，不伪装为正式项目容器的新版本；跨机器携带、正式提交与导出由后续阶段接入。新工具草稿不会自动出现在既有手动参数编辑器中，本阶段用脚本读取。
- 计划凭据本地 10 分钟过期且重启失效，需通过 UI 再确认取得；每正式基准最多保留 32 次计划回执，草稿文件预算 4 MiB，超限不静默淘汰回执或部分写入。
- 现有测试日志仍有 jsdom navigation/canvas 提示、构建大 chunk 提示；打包 pdfjs 有 require/DOMMatrix/Path2D polyfill 警告。真实文本提取与本次参数/图纸数据链路已通过，但本阶段不声称验证了受这些警告影响的所有 PDF 渲染能力。
- 本阶段未执行正式提交、版本导出、真实模型、UI 人工点击端到端；确认是脚本驱动既有 UI IPC 通道，未冒称用户本人实际逐项点击。
