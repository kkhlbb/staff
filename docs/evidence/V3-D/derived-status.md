# V3-D 派生状态 → 存储字段对照表

本批唯一真源规则：**没有任何“已确认”布尔**。除 C 的历史兼容标签
`parameter.reviewStatus` 外，活动复核状态全部从版本号、指纹与事件派生。

| 派生状态 | 派生读取的存储字段 | 禁止当作来源 | 变化后果 | 证明测试 |
|---|---|---|---|---|
| 未关联尺寸链 | `project.dimensionLinks[]` 中 `kind='parameter-binding'` 数量 = 0 | B2 `visual-reference`、`part.currentModelRevisionId`、参数是否存在 | 只存在 B2 外形资料仍显示“未关联尺寸链” | `src/revisions/status.test.ts` “只有 B2 外形关联不等于已关联尺寸链”；`DesktopWorkspace.test.tsx` “无参数绑定显示…” |
| 参数绑定同步有效 | 绑定 `bindingId/termId/parameterId/partId` + 参数 `parameterRevision/valueQ` + 环 `termRevision/nominalQ` + `drawings[0].dataFingerprint` + 最新 `parameter_binding_confirmed` 事件的同名字段 + 事件 `sourceBasis` | 参数 `reviewStatus`、事件存在本身、数值相等 | 上述任一项不匹配 → 待核，并逐项列出原因 | `status.test.ts` 五组“改一项即变待核”；`changeChannels.test.ts` 确认后事件字段断言 |
| 参数绑定同步待核 | 同上；另含悬空 term/parameter/部件不一致 | 不得用“数值已同步”代替凭据 | 悬空引用单列错误 | `status.test.ts` 第 1 例；`schema6.test.ts` 悬空/重复绑定拒绝 |
| 受影响环 | 每个参数的 `valueQ` 与绑定 `termId` 集合；旧/新 `nominalQ` | 不得按 B2 关联判定 | 数值不同标“数值变化”，相同标“被引用，值未变” | `compute.test.ts` LINK-01/多环同参；UI 五组测试 |
| 关系待核 | `relationRevision` + `relationReview{relationRevision,fingerprint,confirmedAt}` + 当前 `dimensionChain.terms`（复用 `isRelationConfirmed`） | 参数绑定确认事件**不是**关系确认 | nominal 同步递增 `termRevision/relationRevision`，旧凭据自然失效；改回也不复活 | `status.test.ts` 关系断言；`compute.test.ts` termRevision+1 |
| 需复核来源 | `sources/bindings.json` 的 `reviewedTermRevision/reviewedAt/historicalAcceptance` + 文档 `latestRevisionId` + 版本哈希/字节 + `missingAttachments` | 参数 `sourceNote` 不是“来源已核对” | 三项规则（可用/当前/数值已核对）任一未过逐条列出 | `status.test.ts` `SOURCE_VALUE_REVIEWED` 行；`review/rules` 既有测试 |
| B2 外形关系待核 | 旧 `visual-reference.reviewStatus/reviewedModelRevisionId` + `parts[].currentModelRevisionId` | 不得提升为参数绑定 | 保持 B2 原语义 | `modelChannels.test.ts` 既有回归（全部通过） |
| 图纸一致 / 失配 | `drawings[0]` 的 `revisionId/templateId/templateVersion/scale/frameFields/parameterIds/dataFingerprint` + 该版本参数；按冻结输入重建 | 不得用当前参数重建旧图；不得只信指纹 | 指纹不符 → “不能重建”，不冒充 | `schema6.test.ts` 往返；`changeChannels.test.ts` 双图比较/无旧图；`revisions/rebuild.ts` |
| 材料缺失 | `drawings[0].frameFields.material` 等空值 | 不从数值推导是否满足 | 单独“材料待补充”，不与其他坏消息合并 | `status.test.ts` 五类同时；UI 分组测试 |
| 计算不满足 | 当前 `dimensionChain` + target 经 `calculateChain` | 与关系/来源复核独立 | outside 给出 min/max/缺口；no-target 单列 | `compute.test.ts` 12→14；UI 五组测试 |
| 预览有效 | main 的 `baseToken`（正式基准分组摘要 + acceptedSeq + 单调 generation）+ `draftToken`（draftRevision 单调）+ previewToken | 不得持久化可写 `previewValid` 布尔 | 任一不匹配 → `STALE_BASE/STALE_DRAFT/STALE_PREVIEW`，零写入 | `changeChannels.test.ts` 改后改回/外部编辑/错误 token；MUT-D1/2 |
| 未保存草稿 | `acceptedSeq > savedSeq`（既有 A-04 语义）；D 草稿另存于 main，未落盘 | 不用 `recovery.state` 冒充正式保存 | 写失败保留草稿 | `changeChannels.test.ts` 写失败测试 |
| 历史复核状态 | 版本引用的冻结 `AnalysisSnapshot.result/review/sourceManifest/comparison/status/pendingCount` | 不以今日规则重算覆盖 | 旧报告只读展示 | 既有 `history/snapshots.test.ts` 全绿；D 版本证据引用测试 |
| 版本可重建性 | `fileRevisions[].project.parameters` + `drawings[0]` + `evidence.analysisSnapshotId/sourceManifest` | 缺参数/未知模板/指纹不符不得“假画” | 明确“不能重建”及原因 | `changeChannels.test.ts` 无图纸旧版；`revisions/rebuild.ts` |

## 事件凭据字段（`ChangeEvent`）

`parameter_binding_confirmed` 必须同时带：

- `bindingId`、`parameterId`、`termId`
- `parameterRevision`、`termRevision`
- `drawingId`、`drawingFingerprint`
- `sourceBasis`（来源清单稳定指纹 + 参数 sourceNote）
- `revisionIdAtCommit`、`createdAt`、`scope='nominal-only'`

缺任一字段 = “未记录/待核对”，不推测、不以旧事件覆盖新版本。
