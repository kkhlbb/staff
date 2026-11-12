# ADR-001 第 3 步：意图驱动建件（无任务书入口）

一句话：用户**没有任务书**也能用对话把零件说出来，走同一套 `planApplication → 草稿 → 复核 → 提交` 门禁；
所有数字都标清“来自人、没有原文件”，并且模型**不能替用户说条款区间**。

| 项 | 值 |
|---|---|
| 基线 | `main = f79d73b`（EvidenceRef 泛化 + 侧栏文案已合入） |
| 分支 | `agent/intent-project`（从 f79d73b 切出；未合并、未推送、未删除） |
| 实现提交 | `ef8ead1`（四工具 + schema 10 + 标记）→ `c42ad0a`（导出测试、标题栏去重、徽标样式、走查脚本）；证据提交 `f809f22` |
| 提取规则版本 | **不变**：`document-extractor-6`（本步不改 PDF 抽取路径） |
| 项目文件 schema | `PROJECT_FILE_SCHEMA_VERSION` 9 → **10**（纯加法） |
| IndexedDB | `PROJECT_DB_VERSION` **未变**（store 结构未动；与项目 JSON schema 分开处理） |
| 新增工具 | `createProject` / `setChain` / `setRequirement` / `setBinding`（只产草稿，没有提交能力） |
| 新增用例 | schema10 迁移 4、意图门禁 7、主进程全链路 6、导出 1、侧栏守卫 2、工作台守卫 1 |
| 真实语料 | 候选 **138**、pending **58**、r4 **7**；候选身份与第 2 步基线**逐字节一致** |
| 变异 | M25 红 → 绿；M26 红 → 绿 |
| 真实模型 3 条 | **BLOCKED**（本机无密钥；见第七节，不记为通过） |

---

## 一、只加四个工具（全部只产草稿）

| 工具 | 输入 | 行为 |
|---|---|---|
| `createProject` | 名称、`partType: 'spacer'` | 把空白项目就地建立为 `sourceKind='user-intent'`（projectId 不变），写责任人/会话/空意图草稿；已是无任务书项目时幂等返回。**责任人由界面手输、main 绑定，模型参数里没有 actorId** |
| `setChain` | `statement`（用户原话逐字）、`rings[{symbol, nominalMm, upperDeviationMm, lowerDeviationMm}]`、可选 `formula` | 写 ring 候选 + formula 候选；每个数必须能在**本轮用户原话**里找到 |
| `setRequirement` | `statement`、`lowerMm`、`upperMm`、端点是否包含 | 写条款区间候选；**只认用户原话**，违规返回 `REQUIREMENT_MUST_BE_USER_GIVEN` |
| `setBinding` | `statement`、`parameters[{parameter, mm, symbol?}]` | 写入隔套三参数与“参数 ↔ 环”绑定意图；参数值来自原话，绑定要求参数值 = 环基本尺寸 |

**为什么 `setBinding` 带 mm**：任务卡只允许四个工具，而生成隔套几何必须有内径/外径/长度。
把“参数值 + 可选绑定符号”合进 `setBinding`，不新增第五个工具；值仍过同一套原话校验。

**门禁没有旁路**：
- `applyIntentDraft` 仍先调 `planApplication`（已确认、决定未失效、出处完整、会话一致），再 `mapConfirmed`；
- 提交仍走既有 `commitApprovedDraft`：从磁盘草稿 `computeChange` 重算、`computeCandidateRequirementCheck` 重算条款、授权指纹比对、原子写盘；
- 无任务书项目**不跳过条款检查**：用户确认的区间在预览/提交的候选快照里冻结成正式条款版本（`user-attestation` 来源），`activeRequirementRevisionId` 非空，所以 `requirementGate=true`。

**一处刻意的设计**：`mapIntent` 不创建 D 层 `parameter-binding`。原因：D 层“绑定已核”由绑定确认事件派生，
无任务书项目没有单独的绑定核对动作；伪造事件会让既有判据失真。绑定意图保存在意图草稿与断言里随版本冻结；
“改参数自动同步改环”在无任务书项目暂不可用（见第九节）。

---

## 二、身份与出处（没有 UUID、没有唯一性校验）

- `actorId`：用户首次建项手输（≤40 字符，去首尾空白，禁止换行/控制字符），存进项目文件；
- `sessionSeq`：项目内自增；同一轮对话共享一个序号，新一轮输入 +1（由 main 依据 `turnId` 推进）；
- `sessionLabel`：用户备注（可空）；
- `turnId`：main 绑定的当前 Agent 任务 ID，模型不可提供；
- `statement`：用户原话**逐字**，必须能在本轮用户文字里逐字找到（归一空白后）。

账本 `project.attestations` 只追加；出处 `provenance` 引用的断言与账本一致，提交时随版本冻结。

**跨会话伪造**（M24 仍红）：`planApplication` 校验 `actorId` 与会话序号；`PlanSession` 新增可选
`sessionSeqs`（本项目已发生的输入序号），只接受账本里真实存在的序号——伪造“第 99 次输入”仍拒绝。
新工具用例 `intentProject.test.ts > M24 覆盖新工具` 把 ring 出处改成 `actorId='mallory'` 后，`applyIntentDraft` 返回 `CONSTRAINT_VIOLATED`。

---

## 三、条款区间只认用户原话（M25 目标）

`setRequirementInDraft` 两道检查：
1. `statementIsUserGiven(statement, 本轮原话)`；
2. `numbersAreUserGiven([lowerMm, upperMm], 本轮原话)`。

任一失败 → `REQUIREMENT_MUST_BE_USER_GIVEN`。没有标准库入口，也没有“按 GB/T 5847 等级推导”的代码路径；
界面在“无任务书建项”区固定写明这条规则。

**实测抓到一次真实的模型代填**：离线演示脚本最初把 H 写成 `52.20`，而用户原话是 `52.25`；
`setChain` 立即返回 `VALUE_MUST_BE_USER_GIVEN`（任务记录里能看到“写组成环没成功”），
修正脚本数字后才通过。这不是测试构造，是门禁在真实链路上拦下的。

---

## 四、无来源标记（想删都难）

| 位置 | 实现 | 证据 |
|---|---|---|
| 项目列表 | 最近项目名后「无外部来源」琥珀色徽标（`sourceKind` 随索引记录） | `screenshots/intent-05-recent-list-badge.png` |
| 项目头 | 「依据：用户输入，无外部原文件」 | `screenshots/intent-02b-attestation-checkbox.png` 顶部 |
| 图纸标题栏 | 第 10 行「依据｜用户输入，无外部原文件」（有来源项目**不新增该行**） | `screenshots/intent-04c-title-block-crop.png` |
| SVG | XML 注释 `<!-- 依据：用户输入，无外部原文件 -->` | `desktop/tests/intentProject.test.ts` |
| DXF | 文件头 `999` 注释 + 标题栏文字（GBK/ANSI_936） | `logs/14-export.log`（实际导出） |
| 文件名 | 默认后缀 `-userinput`（DXF/SVG/PDF；用户改名后标记仍在项目内与文件头） | `隔套-图纸-1_1-userinput-DXF-R12.dxf` |
| 提交 | 勾选「这些尺寸由我提供，无原文件可核对」；勾选进入授权记录，提交复核该记录 | `screenshots/intent-02b`、`intent-03` |

有来源项目字节不变：`frameFields.basis` 为空时标题栏/技术区不新增任何行与文字（现有图纸用例全部通过）。

---

## 五、PDF 路径零变化（A）

命令（两侧相同）：

```bash
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs node scripts/real-doc-metrics.mjs
REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs node scripts/evidence-ref-candidates.mjs --out docs/evidence/intent-project/real-docs-candidates-after.json
cmp docs/evidence/intent-project/real-docs-candidates-after.json docs/evidence/evidence-ref/real-docs-candidates-after.json
```

| 文档 | 页数 | 候选 | pending | blocked | 候选数组 SHA-256（前 16 位） | 与第 2 步基线 |
|---|---|---|---|---|---|---|
| r1 | 74 | 15 | 4 | 11 | `2f00d76711de3f35` | 一致 |
| r2 | 5 | 22 | 7 | 15 | `7ca45c3da6dfb719` | 一致 |
| r3 | 4 | 3 | 0 | 3 | `b0d4c916da995dac` | 一致 |
| r4 | 170 | 7 | 1 | 6 | `98abced2d7f1ad0b` | 一致 |
| r5 | 8 | 4 | 2 | 2 | `eecbbff03bcff72b` | 一致 |
| r6 | 8 | 87 | 44 | 43 | `2eef7127b2e34009` | 一致 |
| **合计** | 269 | **138** | **58** | 80 | 6/6 全等 | 一致 |

- `logs/01-metrics.log`：`BASELINE MATCH：与 docs/evidence/real-doc-baseline/baseline.json 完全一致（6 份文档）`
- `logs/03-candidates-cmp.log`：`CANDIDATES_IDENTICAL_TO_STEP2_BASELINE`，两份文件 sha256 均为
  `561701d6e9b6d74d47d4e3ec8086df6c31eab78b47da3fe8974e73f3cebbde1d`
- 逐份 draftId / 幂等键 / 候选 ID / `candidateArraySha256` 全部与第 2 步相同（`evidence.json` 的 `pdfPath.documents`）

---

## 六、变异：M25 / M26 红 → 绿

驱动：`scripts/intent-mutations.mjs`（文本替换，apply/revert 可逆，不依赖 git 状态）。

| 变异 | 红 | 绿（恢复后） |
|---|---|---|
| **M25**：删掉 `setRequirement` 的用户原话/数值校验 | 领域 `1 failed / 6 passed`（`M25-red.log`）；主进程 `1 failed / 5 skipped`（`M25-desktop-red.log`） | 领域 `7 passed`（`M25-green.log`） |
| **M26**：去掉图纸依据标记 | 主进程 `1 failed / 5 skipped`，失败点 `expected '' to be '依据：用户输入，无外部原文件'`（`M26-red.log`） | 主进程 `6 passed`（`M26-green.log`） |

红的正是对应断言，不是整套一起红。

---

## 七、真实模型 3 条（D）：**BLOCKED，未执行**

- 本机 `DEEPSEEK_API_KEY` 不存在（环境变量为空）；
- Keychain 服务 `com.kkhlbb.cunlian.model` 查无此条目（`security find-generic-password -s com.kkhlbb.cunlian.model` 返回 “could not be found”）；
- 因此 **setChain / setRequirement 各被正确调用一次、模型代填条款被拒一次** 这三条**没有执行**，不记为通过。

模型侧已经就绪：四个工具在 `MODEL_TOOL_SCHEMAS` 里、系统提示包含“数值必须来自用户原话”的约束；
拿到密钥后可跑：

```bash
DEEPSEEK_API_KEY=... V40_REAL_MODEL=1 npx vitest run --config vitest.desktop.config.ts desktop/tests/realModelA40.test.ts
```

（现有真实模型用例覆盖 A40 改图链路；无任务书三条需要按同一 harness 补用例，本步未写，见第九节。）

---

## 八、全链路走查（B）与导出证据

`desktop/tests/e2e/intentProject.mjs`：打包应用 + 真实点击（CDP），离线假模型只把**用户原话里的数字**写进草稿。

| 步骤 | 结果 |
|---|---|
| 打开无任务书项目 → 标题栏标记 | `project-source-note` = 依据：用户输入，无外部原文件 |
| 侧栏“对话建件（离线演示）” | 意图草稿 7 条候选（4 环 + 装配式 + 条款 + 隔套参数），每条带原话与第几次输入 |
| 逐条“确认这条” | 7/7 已确认（不是全批） |
| 生成工程草稿 → 算一遍 | 条款检查“满足要求”，结果区间 0.150～0.250 mm |
| 未勾选 | 不签发授权（主进程拦截） |
| 勾选 → 保存为新版本 | 工具回执“已保存为新版本” |
| 工程图 | 标题栏「依据｜用户输入，无外部原文件」 |
| 重启应用 | 最近项目「无外部来源」徽标 |

截图（`docs/evidence/intent-project/screenshots/`）：

- `intent-01-draft-from-conversation.png`
- `intent-02-preview-and-attestation.png`
- `intent-02b-attestation-checkbox.png`（勾选框未勾选）
- `intent-03-commit-receipt.png`
- `intent-04-drawing-title-block.png`
- `intent-04b-drawing-full.png` / `intent-04c-title-block-crop.png`（同一已渲染 SVG 的放大概览/标题栏裁切，见下）
- `intent-05-recent-list-badge.png`

**两处如实说明**：
1. 工作台把图纸区压到 48px 高（既有布局）；为了截出可读标题栏，走查把**同一个已渲染的 SVG**
   临时放进全屏覆盖层再截（不重画、不改数据），截完移除。全窗口截图 `intent-04` 仍是原布局。
2. **原生保存对话框**（导出 DXF/SVG/PDF）需要 macOS 辅助功能权限，本会话没有该权限，
   无法截图“对话框里的文件名”。导出文件名与文件头改由
   `desktop/tests/intentExport.test.ts` 在**真实导出代码路径**上验证（只把路径选择端口注入固定目录）：
   - 建议文件名与回执文件名：`隔套-图纸-1_1-userinput-DXF-R12.dxf`（SVG 为 `隔套-图纸-1_1-userinput.svg`）
   - 实际写盘：DXF 9266 B，sha256 `8f7bc4d9…a85d1a`；SVG 9418 B，sha256 `11a5b7eb…8e2ac6f`
     （DXF 头含生成时间，逐次导出哈希会变；文件名与标记不变）
   - GBK 解码后 DXF 文件头含 `999` 与「依据：用户输入，无外部原文件」；SVG 含
     `<!-- 依据：用户输入，无外部原文件 -->`
   - **PDF 导出未在本次验证**：PDF 走系统打印面板，需要辅助功能权限
   - 日志：`logs/14-export.log`

---

## 九、schema 9 → 10 与版本边界

- `PROJECT_FILE_SCHEMA_VERSION` 9 → **10**，纯加法：
  - `sourceKind: 'pdf' | 'user-intent'`
  - `actorId: string | null`、`sessionSeq: number`、`sessionLabel: string | null`
  - `attestations: UserAttestation[]`（项目级账本）
  - 条款来源联合新增 `user-attestation`（不伪造页码/哈希）；检查证据引用同步接受
  - 提取草稿新增可选 `intentBindings`
  - 图纸 `frameFields.basis?`（空 = 有来源项目，不新增行）
- `PROJECT_DB_VERSION` **保持 7**（IndexedDB store 结构没变；仓库既有约定是两者分开）
- schema 9 读入：`adaptProjectV9` 固定补 `sourceKind='pdf'`、`actorId=null`、`sessionSeq=0`、空账本；
  **不重算、不改值**；保存时才写 10。
  用例 `src/project-file/schema10.test.ts`（4 条）验证链/参数/图纸/`calculateChain` 与预算一致。
- 旧历史 Revision 记录保留原 schema（3..9），不重写。
- 校验加强（不是放宽）：无任务书项目必须有责任人；账本里断言的 `actorId` 必须等于项目责任人、
  `sessionSeq` 不得超出项目已发生的输入；保存时 `user-attestation` 出处必须在账本里。

---

## 十、门禁（E）

| # | 命令 | 结果 | 日志 |
|---|---|---|---|
| 1 | `npm run typecheck` | exit 0 | `logs/20-typecheck.log` |
| 2 | `npm run typecheck:desktop` | exit 0 | `logs/21-typecheck-desktop.log` |
| 3 | `npm run lint` | exit 0（无输出） | `logs/22-lint.log` |
| 4 | `npm test` | **107 文件 / 1154 用例全过** | `logs/23-test.log` |
| 5 | `npm run test:desktop` | **41 文件通过 + 1 跳过；285 通过 + 14 跳过** | `logs/24-test-desktop.log` |
| 6 | `npm run build` | `✓ built in …` | `logs/10-build.log` |
| 7 | `npm run package:desktop -- --arch=arm64` | `RESULT PASS 打包产物中的 pdf worker 可被 main.cjs 运行时加载` | `logs/11-package.log` |
| 8 | `npm run check:package:pdf-worker` | `RESULT PASS` | `logs/12-check-pdf-worker.log` |

`git status --short` 在提交后为空（交付消息里贴实际输出）。

---

## 十一、未做 / 已知限制（如实）

1. **真实模型 3 条未执行**（第七节）：没有密钥，不记为通过。
2. **无任务书项目不创建 D 层参数绑定**：改参数不会自动同步改环；“参数 ↔ 环”只作为草稿意图与断言冻结，
   随版本可审。要补需要给无任务书项目设计一个“绑定核对”用户动作（另有判据影响，本卡未做）。
3. **意图草稿的起始链是占位链**（A/B 100.000）：领域校验要求 2..20 个环，而真实环要等用户开口；
   提交时链被用户给出的环**整体替换**，占位值不会进入版本。界面在提交前显示占位环（第九节已注明）。
4. **条款来源是用户断言**：`RequirementRevision.source` 新增一支；定位/历史页对断言来源显示原话而不是页码，
   “定位任务书”按钮对断言条款禁用。
5. **DXF/SVG/PDF 导出没有在 UI 里截图文件名**：原生保存对话框需要辅助功能权限（第八节）。
6. **`setBinding` 的参数值校验是“数值出现在原话里”**，不判断语义（“外径”是否真的指外径由用户核对）。
7. **`sessionSeq` 语义**：一轮对话一个序号；同一轮多个工具共享。不是每次工具调用 +1。
8. **手绘/扫描件入口、置信度展示、团队签名**不在本卡范围。
