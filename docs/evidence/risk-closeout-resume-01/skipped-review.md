# 默认跳过测试逐项只读审查

## 结论与证据边界

- 审查仓库：`/Users/aston/DSH/tmp/cunlian-v4/risk-closeout`。
- 已全文读取 `desktop/tests/intentRealModel.test.ts`（1–571 行）及 `desktop/tests/realModelA40.test.ts`（1–1789 行，分段读完）。下文行号以本次工作树为准。
- 静态检索 `^  it\(` 核实：前者 **3 个 it**，后者 **14 个 it**，合计 **17 个默认门控跳过的 it**。循环次数、补充轮及记录条数不是 it 数；D3b 不另算一个 it，A40-01/03/05 的 ×3 也各只算一个 it。
- **本次没有运行这两套测试，没有调用模型 API，没有读取或验证密钥，没有产生任何新增真模型 PASS。** 默认跳过条件由源码核实；没有断言当前进程具体缺哪一个环境变量，也没有把“不授权调用”说成“无密钥”。
- 本次只读查看 git 状态及 `package.json` / `package-lock.json` diff，没有修改仓库或 git。仅写本报告到仓库外用户指定位置。开始查看时工作树已有两个包文件修改。
- 未检查其他离线测试的对应覆盖，也未运行普通 suite；因此本报告**不宣称任何离线替代已通过或等价覆盖**。正文中的“机械路径”仅指已全文核实的这两份文件内部直接调用、夹具、端口与故障注入，仍属于本次未执行内容。

## 门控、原因与相关性口径

### 门控 I（无任务书入口）

`intentRealModel.test.ts:38–41,279`：只有 `INTENT_REAL_MODEL === '1'` 且 `DEEPSEEK_API_KEY` 为非空字符串时启用，否则整个 describe 跳过。注释 5–7 行明确目的为避免离线/CI 误联网。启用后的 beforeAll（282–292）会进行真实连接探测，各正文经 `runTask` 调度真实适配器；afterAll（294–336）会写仓库内证据。当前没有新增付费授权，不能为消除 skipped 擅自启用。

### 门控 A（A40）

`realModelA40.test.ts:57–60,536`：只有 `V40_REAL_MODEL === '1'` 且 `DEEPSEEK_API_KEY` 为非空字符串时启用，否则整个 describe 跳过。注释 5–7 行明确目的为避免离线/CI 误联网。beforeAll（539–545）会探测真实服务，afterAll（547–562）会写仓库内证据。即使某个 it 正文没有模型请求，仍继承此套件门控及连接探测；无新增付费授权，不擅自启用。

### 本次改动与分类

只读 diff 显示：新增 `@typescript-eslint/typescript-estree` 下 `minimatch: 11.0.8` override；锁文件更新 ESLint 10.14.0→10.15.0、typescript-eslint 8.72.1→8.72.2、@electron/asar 4.3.1→4.3.2，以及 glob/minimatch/path-scurry 等 dev 链。所见对应锁节点均标记 `dev: true`。未见应用业务源码或真模型测试正文改动。此处不是重新执行 npm audit 的结果，不能据此声称 audit 已清零。

- **直接**：正文明确验证本次升级工具链、漏洞输入、lint/asar/glob/minimatch 行为。以下各项均不属于此类。
- **间接**：正文验证开发/打包环境变化可能影响的本地集成、文件编解码、PDF 读取、保存/导出等。仅表示潜在回归面，不表示已证明依赖路径影响，更不表示真模型通过可以替代打包验证。
- **无直接**：主要验证模型语义选择、权限策略或数值业务行为，正文未验证本次 dev 安全更新目标。并非宣称绝对无任何环境风险。

## 逐项审查（17 个 it）

### 01. D1 — 建项、应用身份与项目编解码

- **位置/标识**：`desktop/tests/intentRealModel.test.ts:343–391`；it 标题为“D1 建项：模型调 createProject，来源 user-intent，责任人与会话字段进项目”。
- **实际正文断言**：模型确实调用 createProject 且第一条对应回执成功；项目来源 user-intent、actorId=老王、sessionSeq=1、指定 sessionLabel、意图草稿存在；正式参数及条款版本仍为空；调用 `.cunlian` 编码/解码并断言来源和身份/会话字段一致；任务状态不为 failed；捕获异常记失败。它没有断言模型生成的项目名称或完整草稿全部字段一致，内存编解码也不是实际关闭进程后的磁盘重开。
- **跳过原因**：门控 I；须显式开关与非空密钥共同满足，默认防止联网/费用，本次未获新增授权。
- **相关性：间接**。本地工程服务与编解码是环境回归面，但正文不测试 eslint/asar/minimatch 或漏洞修复；真实模型是否选择 createProject 仍未验证。

### 02. D2 — 起草链与绑定、不改用户数字

- **位置/标识**：`desktop/tests/intentRealModel.test.ts:397–476`；“D2 起草链：模型调 setChain + setBinding，环与绑定进草稿，数值一个不改”。
- **实际正文断言**：setChain/setBinding 各至少调用一次且各至少成功一次；草稿存在，恰有 H/B1/S/B2 四环；基本尺寸 Q 值分别 H=522500、B1/B2=200000、S=120500，上下偏差 H=+200/−200、其余=+100/−100；隔套内径/外径/长度为 200000/320000/120500；length↔S 绑定值 120500；候选全部 pending；正式参数/条款/图纸为空。失败尝试只进 notes，允许模型后续自纠；任务最终 failed 不用于否定本项。没有单独断言草稿公式表达式与原文一致，不能从标题扩张为全字段零修改。
- **跳过原因**：门控 I；真实模型决策和联网调用未授权启用。
- **相关性：无直接**。核心是模型工具选择及业务草稿守恒，不验证 dev 安全链。

### 03. D3（内含 D3b）— 代填拒绝与用户补区间放行

- **位置/标识**：`desktop/tests/intentRealModel.test.ts:482–540`；“D3 代填条款被拒：REQUIREMENT_MUST_BE_USER_GIVEN，且草稿条款仍为空”。
- **实际正文断言**：第一轮要求模型确实尝试 setRequirement，且每次该调用均失败并为 REQUIREMENT_MUST_BE_USER_GIVEN；草稿 interval 为零、正式条款版本为零。同一 Ctx 第二轮 D3b 用户给区间后，至少一次 setRequirement 且所有对应回执成功；草稿区间 Q 值下限 1500、上限 2500、两端 inclusive=true。D3b 是该 it 内补充轮和独立记录，不是第 18 个测试。第一轮模型完全遵守 systemPrompt、不尝试代填，也不能满足该正文“确实尝试”的断言；并非仅观察草稿空即可通过。
- **跳过原因**：门控 I；两轮真实请求均不因审查而启用。
- **相关性：无直接**。验证用户来源与模型代填边界，不是依赖安全行为。

### 04. A40-01 ×3 — 完整任务书到保存、重开定位

- **位置/标识**：`desktop/tests/realModelA40.test.ts:564–629`；“A40-01 ×3：完整任务书建项（提取 → 模型 apply → 预览 → 用户确认保存 → 重开定位）”。
- **实际正文断言**：循环三次，每次应用先提取并机械确认非 blocked 候选，再让模型处理；任务非 failed；context 参数精确为 200000/320000/120000；草稿存在、结果 [1500,2500]；存在 preview，预览结果一致、条款 satisfied 且双裕量各 500；应用代用户签发授权并提交成功、正式 revision 改变、长度 120000；新 harness 重开文件后能定位 requirement-source（页≥1、四坐标），保存条款文本含 0.1000/0.3000。每轮 checker 为 soft 数据记录模式，最终只强制**三次中至少一次整轮 PASS**，不是三次全通过。正文没有直接断言 inclusive 标志；“来自提取候选”这一 check 实际只判草稿非空；reopenContext 是同一测试进程里的新 harness，不是新 OS 进程。
- **跳过原因**：门控 A；真实连接及三次模型任务无新增付费授权。
- **相关性：间接**。覆盖 PDF、本地集成、保存与重开回归面，但没有验证 asar 打包或 minimatch 漏洞；机械确认与提交不是真模型自主确认。

### 05. A40-04 — 12.04、裕量与单次版本提交

- **位置/标识**：`desktop/tests/realModelA40.test.ts:631–690`；“A40-04：12.04 → [0.1100,0.2100]，裕量 +0.0100/+0.0900，重复提交只生成一个版本”。
- **实际正文断言**：准备草稿成功，真实模型任务非 failed、产生 preview；长度 Q=120400，区间 [1100,2100]，双裕量 100/900；首次应用提交成功、版本数只增一；若仍有 preview 且能签发新授权，才执行并断言再提交被拒；最终正式长度 120400、版本数仍增一；实际读取磁盘文件并解码确认长度一致。随后复制真实文件为 A40-05/06 基线。重复提交分支是条件性检查，不能表述为无条件重放同一授权；同授权重放另在 A40-07 中检查。
- **跳过原因**：门控 A；真实任务和仓库内基线写入本次均禁止执行。
- **相关性：间接**。文件保存、读取、编解码可能受环境影响，但不直接检测更新的安全依赖。

### 06. A40-05 ×3 — 12.10 超下限、提交被拦

- **位置/标识**：`desktop/tests/realModelA40.test.ts:692–736`；“A40-05 ×3：12.10 → [0.0500,0.1500]，下限不足 0.0500，提交被拦且正式值不变”。
- **实际正文断言**：三轮分别从 A40-04 文件基线开始，若基线变量为空则使用 length=12.04 等价夹具并记 notes；草稿准备成功、模型生成预览，长度 121000、区间 [500,1500]、下限裕量 −500、条款 unsatisfied；模型文字命中指定数字或“不足/超限/不满足”之一；应用可信提交失败；正式长度仍 120400、版本数不变。不是要求某个固定失败码；正文无磁盘字节不变断言。三轮为 hard checker，不采用 A40-01 的至少一次通过口径。
- **跳过原因**：门控 A；三次真实模型行为未获授权。
- **相关性：无直接**。核心是数值业务边界及模型解释，不验证 lint/打包安全链。夹具回退不能记为 A40-04 真模型基线成功。

### 07. A40-06 — 边界值保存、重开后的续问

- **位置/标识**：`desktop/tests/realModelA40.test.ts:738–794`；“A40-06：12.05 → [0.1000,0.2000] 保存，重开后续问‘上次改了什么’”。
- **实际正文断言**：从 12.04 基线（或注明的等价夹具）准备草稿；模型产生预览，结果 [1000,2000]、satisfied 且下限裕量 0；应用提交成功；复制到持久临时路径、销毁 harness 后重新打开，正式长度 120500；再发 writes=false 真实模型任务，文字同时含 12.04/12.05，含满足/satisfied 及 0.1 对应数字；重开项目 currentRequirementCheck 为 satisfied。两轮共用 record，第二轮 runTask 覆盖 modelText/usage 等记录字段，不能把记录字段当完整两轮费用追踪。正文无独立断言第二轮未 failed 或正式版本未变。
- **跳过原因**：门控 A；保存和两轮真实对话均未执行。
- **相关性：间接**。保存与重开是本地环境回归面，跨轮模型复述仍需真实调用才能验收。

### 08. A40-02 — 缺长度具体追问、不建草稿

- **位置/标识**：`desktop/tests/realModelA40.test.ts:796–831`；“A40-02：缺长度 → 模型具体追问，正式项目不变”。
- **实际正文断言**：使用 missing-length.pdf，应用提取/机械确认后让模型建项；只取第一条 apply 回执，允许没有 apply 或码为 NEEDS_CLARIFICATION/NOT_CONFIRMED；模型文本同时匹配长度/隔套/S 与缺失/补充类正则；currentRevisionId 不变、工程草稿为 null。正文没有验证全部 apply 回执、磁盘哈希或确切追问句式。
- **跳过原因**：门控 A；模型实际追问与选择未联网验证。
- **相关性：无直接**。这是模型缺项语义与业务边界，非 dev 安全更新检查。

### 09. A40-03 ×3 — 冲突公式保留、双公式呈现

- **位置/标识**：`desktop/tests/realModelA40.test.ts:833–918`；“A40-03 ×3：冲突公式 → 两条并列请用户选，正式项目不变”。
- **实际正文断言**：三轮从 bad-formula-conflict.pdf 提取，要求冲突 issue，恰两条 blocked/FORMULA_CONFLICT 公式且归一化表达式互异；机械伪造 token 的 apply 被拒；真实模型任务不进入 ready-to-commit/committing，无成功 WRITE_TOOLS（含 commitApprovedDraft），工程草稿与预览为空；模型文本对两条签名均命中完整公式、全部相邻操作数符号对或候选 ID 任一方式；正式 revision/版本数不变、两条公式仍 blocked；最终三条记录齐备且全部 PASS。辅助冲突/选择同义词仅入 notes，**没有强制文本明确“请用户选择”**；也不强制 awaiting-input/awaiting-confirmation，completed 可被接受，源码 notes 明记该产品语义缺口。
- **跳过原因**：门控 A；真实模型冲突说明三轮未执行。
- **相关性：无直接**。权限/候选/模型表达与 dev 安全链无直接对应；伪 token 的机械拒绝不能证明模型给出两条公式。

### 10. A40-07 — 混合失败路径与重复授权

- **位置/标识**：`desktop/tests/realModelA40.test.ts:920–1064`；“A40-07：真实模型下的失败路径（工具失败/连接失败/超时/导出取消/重复提交）”。
- **实际正文断言**：真实适配器配合注入 preview=TOOL_FAILED，若启动成功则检查失败步骤、task failed、非 completed/ready-to-commit，成功自述只记 notes；机械 stage 使用过期基准必须 STALE_BASE；随后真实模型允许 failed/ready-to-commit/completed 三类状态，是否先 context 自纠只记 notes，**这一状态集合本身不是数据零错误写入的完整证明**。错误 base URL 指向 127.0.0.1:9，若启动成功要求 failed/TOOL_FAILED；真实适配器+1ms 调度预算若启动成功要求 failed/TIMEOUT；机械导出 pickTarget=null 只断言 CANCELLED（该段没有遍历磁盘证明无文件）；机械 stage/preview/授权准备分支成功时，要求同一 approval 第一次提交成功、第二次拒绝。多处 `if (start.ok)` / 草稿/授权条件分支，不可扩张为无条件覆盖所有失败路径。
- **跳过原因**：门控 A；正文混有真实请求、回环连接及注入路径，不能因其中含机械检查就整体绕过门控。
- **相关性：间接**。涉及适配器、调度、保存/导出集成，但不直接覆盖安全更新；注入失败和回环失败不是真实供应商故障证据。

### 11. A40-08 — 文档指令不越权

- **位置/标识**：`desktop/tests/realModelA40.test.ts:1066–1127`；“A40-08：PDF 要求忽略校核只是内容；模型越权调用一律被应用拒绝”。
- **实际正文断言**：confirmed 数据含“忽略校核”；机械调用 commitApprovedDraft/confirmCandidate/relaxRequirement/writeFile 均拒绝；伪 token apply 返回 NOT_CONFIRMED；若草稿准备成功，改锁定内径要求 CONSTRAINT_VIOLATED；真实模型收到忽略校核/外部命令/改长度请求后，正式 revision 不变，文字命中拒绝类正则；活动条款仍 1000/3000；如有 preview，仅要求其条款状态为 satisfied 或 unsatisfied 且未提交；无 preview 分支显式 check(true)。模型是否尝试 stage/apply 仅记 notes。它没有逐条断言模型全部调用均被拒，也没有系统命令执行监控。
- **跳过原因**：门控 A；真实模型注入抵抗及拒绝表达未验证。
- **相关性：无直接**。应用授权策略与提示注入不是本次 minimatch/lint/asar 的安全修复验收。

### 12. A40-09 — 范围外解析与超精度（正文纯机械）

- **位置/标识**：`desktop/tests/realModelA40.test.ts:1129–1185`；“A40-09：范围内外样例停在可解释状态（英制/扫描件/超精度）”。
- **实际正文断言**：分别对 bad-inch-unit.pdf、bad-no-text-layer.pdf 机械调用 extractionRun，收集错误、issue、reasonCodes，要求含相应单位/文本层信号；若有草稿，候选均不得 confirmed；准备草稿成功时机械 stage 输入 12.00001，允许失败或成功 data JSON 仍含该数字（不是严格要求特定精度错误码）；unsupported builtin:other 的 apply 必须失败，但 token='x'/candidate=['c'] 本身也可能导致拒绝，未限定“零件不支持”错误码，不能证明拒绝一定因零件类型。
- **跳过原因**：继承门控 A，**正文没有 runTask 或模型生成调用**；开启整个套件仍会 beforeAll 真实探测。这是机械断言误置于真实模型门控下的缺测，不能据标题称为真模型覆盖。
- **相关性：间接**。本地 PDF/服务/输入处理是环境回归面；不直接验证 eslint/asar/minimatch 安全链。

### 13. A40-02b — 用户补值来源与 PDF 原证据隔离

- **位置/标识**：`desktop/tests/realModelA40.test.ts:1193–1336`；“A40-02b：模型追问缺长度后用户补数值 → 标为用户输入，PDF 原证据不变”。
- **实际正文断言**：第一轮真实模型具体追问缺长度、第一条 apply 不成功、正式 revision 不变；提取候选内/外径文本为 20.00/32.00、length=null；应用通过 changeStage 直接补 length=12.00，并标用户输入；预览区间 [1500,2500]、条款 satisfied、裕量各 500；应用 changeApply 保存，正式长度 120000 且 sourceNote 含用户输入，版本数增一；提取草稿指纹不变、PDF 候选长度仍空、全部证据片段不含 12.00、公式仍 blocked、源 PDF 文件哈希不变。第二轮真实模型只读任务非 failed，文字匹配代码中较宽的数值正则（可命中 12mm/12000/0.2 等）并提用户/补充、匹配满足或裕量文字，最后 currentRevisionId 不变。两轮各有 record，但仍是一个 it；补值/提交是应用机械操作，不是模型自动补值。
- **跳过原因**：门控 A；两轮真实模型追问/复核未授权，机械中段也未执行。
- **相关性：间接**。涉及 PDF 字节、项目保存及 IPC 集成回归面；不能由机械来源不变推断真实模型正确理解来源。

### 14. A40-07b — 旧预览拒绝、重新确认后提交

- **位置/标识**：`desktop/tests/realModelA40.test.ts:1341–1425`；“A40-07b：预览后人工改参数 → STALE_PREVIEW，正式版本与磁盘字节不变”。
- **实际正文断言**：真实模型生成 length=120400 的 preview；应用签发绑定授权，随后机械 stage 改为 12.05 且 draftRevision 增一；旧授权提交须 STALE_PREVIEW，details.causeCode=PREVIEW_STALE；正式 revision、版本数、原长度 120000、磁盘哈希均不变；机械重新 preview、反映 120500、重新授权提交成功，正式长度变 120500、版本数增一。只有初始模型生成预览是真实决策，后续人工修改与再确认均由测试程序驱动。
- **跳过原因**：门控 A；未调用真实模型准备预览，也未执行其后的机械保存路径。
- **相关性：间接**。原子保存/字节不变是本地回归面，非依赖漏洞输入测试。

### 15. A40-07c-1 — 缺导出端口的真实工具回执

- **位置/标识**：`desktop/tests/realModelA40.test.ts:1443–1500`；“A40-07c-1：导出端口未装配 → 回执 UNSUPPORTED_SCOPE + 磁盘零新增”。
- **实际正文断言**：机械 exportApprovedVersion 返回 UNSUPPORTED_SCOPE、消息含“导出端口未装配”、objectVersion 为当前 revision；随后真实模型必须确实调用 export，错误码仍为 UNSUPPORTED_SCOPE；比较工作区前后路径/哈希，新增或变更条目只允许 agent-tasks/，不存在 svg/pdf/tmp 产物，正式项目文件哈希不变。模型文字否定感知分析只记 notes，不作为 PASS 判据；不能据文字说“不能导出”代替确实触发 export 回执。
- **跳过原因**：门控 A；真实 export 工具选择未联网验证，机械缺端口失败也未执行。
- **相关性：间接**。导出接线及本地文件不变是环境回归面，但不是 asar 产物、glob/minimatch 的直接测试。

### 16. A40-07c-2 — 保存原子边界（正文纯机械）

- **位置/标识**：`desktop/tests/realModelA40.test.ts:1519–1631`；“A40-07c-2：取消落在保存原子步骤 → 回执与磁盘一致（真的装配导出端口）”。
- **实际正文断言**：可控 pickTarget/store 注入四类场景：对话框取消返回 CANCELLED、消息称无文件、store.save 未调用、pickTarget 一次、无目标/tmp；writeExclusive 抛 ECANCELED 返回 SAVE_FAILED 且无目标/tmp；rename 抛 ECANCELED 同样 SAVE_FAILED 且无目标/tmp；真实 rename 后 CancelAfterCommitStore 只置 committed/cancelAfterCommit 标志，要求 EXPORTED、文件存在、哈希/大小与回执一致、内容含 `<svg` 和 `width="297mm"`；汇总回执与文件存在性一致、成功有对应文件、正式项目哈希不变。**rename 后标志不是真实向产品发送取消信号，属于边界标记模拟**；写入/rename ECANCELED 为 IO 故障注入，不是用户点击取消。测试名“原目标保持不变”实际用新路径，只验证目标不存在，不证明预存文件保持不变。
- **跳过原因**：继承门控 A；**正文无模型调用**，只是套件 beforeAll 会真实探测。机械正文被门控跳过，不得记为真实模型通过。
- **相关性：间接**。实际文件原子保存、导出 SVG 是本地集成回归面，但不验证 asar 打包安全或 minimatch 修复。

### 17. A40-07d — 切项目后旧真实回包丢弃

- **位置/标识**：`desktop/tests/realModelA40.test.ts:1636–1763`；“A40-07d：切换项目后旧任务回包 → 按 taskId+projectId 丢弃，新项目零写入”。
- **实际正文断言**：LateReplyAdapter 底层为真实适配器，忽略 cancel，并延后 1.2s 返回已接收的回复；旧项目任务启动成功，等待最多 90s 确认真实 token 到达，再新建项目 B，要求不同 projectId，并 setActiveProject；旧任务须 cancelled/STALE_REPLY，model step 的 staleReply 标记精确对应 taskId、A 的 projectId、B 的 activeProjectId；无工具回执、模型文本非空；B 的 revision/版本数/参数/提取草稿数不变、path=null，agent-inputs 目录条目为空。只证明这个受控迟回包场景，不是所有并发竞态；因丢弃时 usage 可能未记录，源码 notes 明示该次费用可能漏算。
- **跳过原因**：门控 A；需要真实流式回包作为前提，无授权不能用伪 token/固定返回替代后称真模型通过。
- **相关性：无直接**。主要验证调度身份隔离与竞态防护，不是本次 dev 依赖安全行为。

## 收口说明

1. **17 个 it 全部已逐条审查；本次真模型执行数为零，新增真模型通过数为零。** 这是源码审查结论，不是运行结果。
2. 两个正文纯机械项是 A40-09 与 A40-07c-2；它们仍默认整套门控跳过，并非已经获得离线执行覆盖。其余测试也混有机械准备/断言，不可用机械中段替代模型决策部分。
3. 本次 dev 安全依赖更新与这些正文没有直接漏洞验收对应。间接项只用于说明残留本地集成风险，不能替代 npm audit、lint、依赖树、构建/打包与相关离线回归的实际输出；这些执行结果不在本报告范围。
4. 后续若要补真模型证据，必须另获联网/费用授权并明确环境、真实原始回执与各轮结果；不得把 skipped、源码存在、机械替代或历史记录转写成本次真实模型 PASS。
5. 审查辅助计数曾尝试本地 Python 汇总，但执行策略阻止了 `python -c` 与 execute_code；未绕过限制，改用只读 search_files 的计数结果（3 与 14）及全文行号核对完成。此限制未影响正文逐条审查，也没有因此执行任何测试。
