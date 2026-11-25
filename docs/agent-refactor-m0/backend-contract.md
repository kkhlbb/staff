# 寸链后端 M0 共享契约评审稿

协议标识为 `0.1.0-m0`，包入口为 `desktop/shared/project-agent/index.ts`。本稿对应基线 `61d8c435b220cea95c3b06f5435bdf81a6a8dbf9`，供两端评审与对接。

## 请求与响应

| 操作 | 额外输入 | 成功 `result` |
| --- | --- | --- |
| `capabilities` | 无 | 服务标志和零件能力表 |
| `getContext` | 可空 `revision` | 项目快照 |
| `acquireWriter` / `takeOverWriter` | `expectedWriterEpoch` | 新 epoch、令牌和快照 |
| `importRequirements` | 授权文档引用与内容指纹 | 新草稿、条款、待回答问题 |
| `answerQuestion` | 问题、答案、来源依据 | 新草稿、条款、待回答问题 |
| `stageChange` | `operation`、`basis` | 新草稿及受影响条款 |
| `buildAndCheck` | 当前草稿、版本化输入、产物种类、规则 ID | 任务 |
| `getJob` / `cancelJob` | `jobId` | 任务 / 取消回执 |
| `retryStep` | `jobId`、步骤种类、预期尝试编号 | 更新后的任务 |
| `getArtifacts` | `revision` | 产物清单 |
| `locateEvidence` | 修订及条款、对象或标注选择 | 证据列表 |
| `issueConfirmation` | 预览及检查集指纹 | 确认令牌、到期时间和指纹 |
| `commitApprovedDraft` | 上述指纹和确认令牌 | 正式修订及清单哈希 |
| `exportRevision` | 修订、格式、获批目的地引用 | 修订、格式、mm、哈希及产物引用 |

每个请求带 `version, requestId`。项目级调用再带 `projectId, authorizationRef`。除接管和获取写入权外，写操作带 `baseRevision, expectedDraftRevision, writerToken, writerEpoch, idempotencyKey`。首次创建正式基准或草稿时，相应修订字段传 `null`。成功响应为 `{version, requestId, ok: true, result}`，失败则为 `{version, requestId, ok: false, error: {code, message, retryable, requestId, details}}`。错误详情始终含可空的 `baseRevision, draftRevision, retryStep, recovery, question`。通过可信授权派生调用方身份与权限；客户端上送的各种 ref 都需要主进程解析并按授权复核。

## 前端接线与样本

- 常量 `PROJECT_AGENT_VERSION`、`M0_CAPABILITIES`。默认新服务、桥接、API 工具往返、持久化写入、事件续读、板件几何、图纸投影和多维能力均为 `false`，`parts: []`。旧五工具独立提供已有能力。
- 类型 `ProjectAgentOperation`、`ProjectAgentRequest<K>`、`ProjectAgentResult<K>`、`ProjectAgentResponse<K>`、`ProjectAgentError`、`ProjectAgentEvent`、`ProjectAgentSnapshot`、`ProjectAgentArtifact`、`ProjectAgentJob`、`ProjectAgentManifest`、`ProjectAgentCheck`、`ObjectRef`、`ProjectAgentStream`。
- 运行时校验 `projectAgentRequests[operation](value)`、`projectAgentResults[operation](value)`、`isProjectAgentResponse(operation, value)`、`isProjectAgentSnapshot`、`isProjectAgentEvent`、`isProjectAgentError`、`isCapabilities`、`isObjectRef`、`isGeometryBoundary`、`isBuildInputs`、`isArtifact`、`isArtifactManifest`、`isJob`、`isCheck`。协议对象字段严格匹配，显式的 `null` 表示可空值。
- 流函数 `startProjectAgentStream`、`reduceProjectAgentEvent`、`canPublishArtifact`、`hasMatchingBuildArtifacts`。其余工具为 `resolveObjectRef` 和 `qToGeometryMm`。

以下是断线重开样本的最小 DTO。前端可在 DTO 外套 `{synthetic: true, snapshot, events: []}`，以模拟标签呈现，真实连接仍依握手和工具往返决定。

```ts
const snapshot: ProjectAgentSnapshot = {
  version: PROJECT_AGENT_VERSION,
  projectId: 'p', baseRevision: 'r7', draftRevision: null, cursor: 100,
  connection: { status: 'disconnected', source: null },
  authorization: { authorized: false, canWrite: false },
  writer: { epoch: 4, callerId: null },
  selection: null, capabilities: M0_CAPABILITIES,
  activeJobId: null, jobs: [], currentManifest: null, fallbackArtifacts: [],
}
```

- **接管与重放**　把 `draftRevision` 设为 `d8`，接管回执中的快照更新 `writer.epoch` 为 5。相同项目按 101、101、102 重放，重复事件跳过。旧令牌回复 `WRITER_REVOKED`。
- **部分成功与取消**　`activeJobId: 'j8'`，`jobs` 包含同基准及草稿的任务。任务带 `inputs` 及 `steps: [{kind, attempt, status, retryable}]`。部分清单两个确认指纹均为 `null`，其中可有当前模型，正式版图纸放 `fallbackArtifacts` 并标 `draftRevision: null, baseRevision: 'r7'`。取消后，晚到的 `artifactReady` 继续过游标但不得替换清单。
- **澄清与确认**　`needsClarification` 检查指向 `evidence.requirementId, anchors, objects, annotationIds, inputs, threshold`。修订或检查集变化后，旧令牌返回 `STALE_CONFIRMATION`。签发与保存操作需由可信调用方接线。

事件都带 `version, projectId, baseRevision, draftRevision, jobId, sequence, type`。类型为 `artifactReady | jobChanged | jobCancelled | contextChanged`。`artifactReady` 平铺 `artifactId, kind, hash, inputFingerprint, objectMapVersion, attempt, localRef, unit`。`jobChanged` 带 `job`。`contextChanged` 的 `jobId` 为 `null`，指示重取快照，适用于切换当前草稿或任务。序号属于项目，旧草稿和旧任务事件可推进游标，当前产物保持原样。序号缺口暂停应用并要求重取快照。历史消费、补拉及 `CURSOR_EXPIRED` 的传输由后续服务负责。正式版产物的 `draftRevision` 传 `null`。

### 完整输入绑定与重连

同一项目和任务 ID 下，完整 `job.inputs` 必须固定。对象字段顺序无关，坐标及轴向分量按位置精确比较，`-0` 和 `0` 等价。需求、特征、内核、规则版本及几何元数据变化时，服务必须分配新任务 ID，并从可信的规范化完整输入生成摘要。现有几何 DTO 只接受 mm，检查产物继续使用 q。

- 当前任务的连续 `jobChanged` 如给出不同的完整输入，流保留原任务和冲突前游标，清空当前产物并置 `needsSnapshot`。重取期间暂停应用事件。活动草稿快照也必须核对清单和任务的完整输入，同一任务的冲突清单会让流保持暂停。前端用 `stream.artifacts` 和 `needsSnapshot` 决定当前展示与同版完成状态。原快照中的清单及显式的历史回退需要按各自修订呈现。
- 每种产物按自己的 `attempt` 门控。重试只会让对应种类的旧尝试失效。若一个任务状态回包包含缺失的旧步骤、更旧的尝试，或同一次尝试的状态倒退，整条任务回包只推进项目游标。旧草稿或旧任务的事件也只推进游标。整任务取消继续封闭迟到输出。
- 前端重取时应按当前项目和请求代次接纳最新响应，丢弃并行旧请求的历史回包。用接受的快照调用 `startProjectAgentStream`，然后从它的 `cursor` 续读。在同一订阅内拒绝回退游标。共享流的起点是传入的快照，跨快照的任务输入冻结由服务保证；产物事件只携带摘要，服务必须从已经绑定输入的任务发布它。

尺寸输入使用整数 q，沿用旧域的单个尺寸输入上限。几何字段明确 mm，记录右手正交坐标系、原点、轴向、建模容差和显示小数位，几何校验仅覆盖这个边界。模型和图纸产物标 mm，检查产物的尺寸证据标 q。对象引用以 `partId, featureId, role, revision, objectMapVersion` 标识，重建后只在目标修订和映射内按前三项解析。零命中为失效，多命中为歧义。生产端仍需从精确几何建立持久角色和映射。

## 写入及确认接线

`desktop/main/project-agent/guards.ts` 导出 `checkWriterAcquisition`、`checkWrite`、`checkCommitConfirmation`、`checkSetFingerprint`、`previewFingerprint` 及类型 `WriteReceipt<K>`、`PreviewConfirmation`。主进程应在同一项目的串行写入事务内使用这些规则。

1. 用可信调用身份验证项目授权，校验当前写入方、令牌与 epoch。接管校验预期 epoch，成功结果仅给出应写入的新 epoch。
2. 在授权与令牌校验后查找回执。索引编码协议版本、项目、认证调用方、操作和幂等键。请求摘要包括两个基准和逻辑负载，传输请求 ID、授权引用、写入令牌及 epoch 不参与摘要。匹配时返回原回执，相同键不同负载返回 `IDEMPOTENCY_CONFLICT`。首次处理在两个基准都匹配时取得 `proceed`。
3. 提交前验证当前正式基准和草稿、用户、项目、epoch、有效期、未消费令牌与当前预览及检查集指纹。检查集按规范化条目排序并用 SHA-256 摘要，包含条款、必要性、规则版本、输入、结论和证据。对象键按 JS 字符串顺序排序，证据内部数组顺序保留。预览指纹绑定修订、输入清单、对象映射、排序后的产物及检查集指纹。生产端以可信输入、实际产物校验值和权威必需条款列表调用；必需检查要完整且通过，三类产物须与同一已就绪任务、尝试、输入和对象映射一致。
4. 服务需要在同一持久化边界写入正式版与提交回执并消费确认。取消的发布门禁也应持久化，再通知 worker。当前纯函数只判断，不分配令牌、不改变状态，也不持久化。

## 后端任务卡与验收边界

| 卡片 | 本轮交付 | 待验收 |
| --- | --- | --- |
| M0-B1 | 兼容测试固定六个真实版本化文件的 SHA-256、正式修订以及正式/草稿隔套尺寸。 | 运行项目解码测试和安装版打开、历史、来源、重开走查。 |
| M0-B2 | 固定五工具注册名、参数形状、q 与 mm 输入约定、A10 四组区间与判据。 | 用锁定依赖运行 Vitest 和旧 MCP stdio 五工具回归。 |
| M0-B3 | 共享契约候选、运行时校验、写入及确认规则、事件和引用规则、独立自动测试。 | M0 保留前后端对事件与能力定义的评审。M1 后续接入 IPC、安装包及 MCP 生产桥接、内部模型工具往返、正式项目授权、单写入方、持久化事务、任务日志与快照续接，以及该接线涉及的 worker 生产集成。 |
| M0-B4 | 记录包内样机所需证据和独立判据。 | 实作并打包 arm64 板件样机，A01/A05 包内实测。 |

依据[官方规格 §6](/Users/aston/DSH/tmp/cunlian-agent-refactor/spec-20261123-0828.md:151)，父与协调方宁拙吾已确认上述归属。此前自拆任务卡将 M0 定义评审与 M1 生产待办混排，原待办继续保留。当前纯函数只判断，不分配令牌、不改变状态、不持久化；生产服务尚未实现或接线，M0 新能力仍为 `false`。官方 M0 验收仍为打包版读取旧项目、技术样机复现 A01、A05 数值。证据充分性待验收。

可靠参考来自现有实现。五工具定义与接线见 `mcp/tools/index.ts`、`mcp/tools/{read-taskbook,calc-chain,check-requirement,render-drawing,describe-project}.ts`、`mcp/tests/consistency.test.ts` 与 `docs/evidence/mcp-entry/README.md`。单位及公式见 `src/domain/{types,units,calculate}.ts`、`src/requirements/check.ts`。编解码和正式保存参考 `src/project-file/codec.ts`、`desktop/main/{projectService,fileStore,agentToolService,approvalStore}.ts`。隔套 PDF 样本为 `src/document-extraction/__fixtures__/taskbook-TB-2026-1110.pdf`，SHA-256 为 `6b6b02ebbe796168447ec18b698fa12db6a93eb7f5dd1ec5b9a9473879b6f0ff`。它只用于旧来源回归，安装板和盖板验收 PDF 待提供并归档。

## 下一工作块

准备锁定依赖和 Electron 45.2.3 的本地 arm64 ZIP，确定候选 OCCT 绑定、发行许可、worker 及资源打包路径，并新增包内实际执行入口和独立读回脚本。现有 `vendor/step-narrow-v1/spacer.cpp`、`desktop/main/cad/stepKernel.ts`、`scripts/step-assets.mjs` 提供隔套参考路径。候选包应在含空格位置和干净用户数据目录运行，记录构建提交、OS/架构、内核版本、包和资源指纹。用真实有页码文本 PDF 及指纹、精确实体、模型网格、图纸、对象映射、检查记录和日志建立联合证据。

- **A01** 独立读回一块 80 × 50 × 8 mm 安装板、两个沿 Z 的直径 10 mm 贯穿孔，中心分别为 (20,25)、(60,25) mm，净体积为 32000 − 400π mm³。核对同修订的投影标注、对象和 PDF 来源。
- **A05** 初始与两件及局部坐标系一起绕世界 X 轴 +90° 后，沿有向板法向测得名义间隙 2 mm、范围 [1.7, 2.3] mm。记录完整刚体变换以及 +Z 到 −Y 的法向变化。
- 执行前登记读回线性、体积和法向分量允差，另记内核与显示容差。复查旧项目和独立草稿。包内几何门槛、真实双入口、恢复与正式保存均等待独立证据。

条款与证据的 `threshold` 为 `null` 或 `{lowerQ, upperQ, lowerInclusive, upperInclusive}`。单侧界限用另一侧的 `null` 和 `false` 表达。例如安装板的至少 13 mm 用 `{lowerQ: 130000, upperQ: null, lowerInclusive: true, upperInclusive: false}`。步骤重试增加该步骤的 `attempt`。整任务取消后的重建使用新任务，并从快照更新 `activeJobId`。
