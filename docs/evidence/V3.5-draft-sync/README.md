# V3.5 P1 顶层草稿同步修复

基线：main 8d95e0d623868dfa25c7dd5ea51b1c10e9cebd2f。
分支：agent/v35-draft-sync。仅本地提交，不合并、不推送、不删分支。

## 根因与实现

buildCommitCandidate 已正确生成正式链、工程图、条款检查和冻结分析草稿，但返回 snapshot 时通过 ...base 继承了旧顶层 draft。尺寸链页和底部校核优先读取它，造成同一工程显示两组结果。

现在提交候选通过 draftAfterCommit 在同一原子聚合内处理顶层草稿：

1. 没有独立编辑时，顶层草稿由 chainToDraft(computation.chain) 生成，relationRevision 取本次正式关系版本（与 nextRelationRevision 一致）。分析快照继续使用本次正式输入，不拿用户独立编辑冒充提交结果。
2. 真正编辑保留全部原始字符串、非法输入、结构、目标与假设，并记录 basisRelationRevision。此字段是现有可扩展 draft 记录的可选元数据，校验为非负安全整数；没有增加容器格式或项目 schema 版本，没有迁移/重写既有图纸、条款或历史快照。
3. 尺寸链页编辑只 stage 顶层 draft，不再顺手把合法输入写成正式 dimensionChain。已绑定环的 nominal 编辑仍引导至参数页；恢复/保留历史草稿不因旧 S 与新正式 S 不同而被这道编辑限制误拦。
4. 尺寸链页与底部校核共用 resolveDraft；两处都只将选定输入交给 draftToChain / calculateChain。未动候选计算、非法输入处理、条款重算/提交门禁、q 精度或极值公式。

独立编辑界面显示“草稿基于关系版本 N，正式已是 M；当前计算为草稿，非正式结果”，并有“按正式重算 / 保留我的编辑”。重算需要再次确认，取消不改变输入；保留不会假装已经 rebase 到新正式版本。

## 显式旧文件兼容规则

- 草稿等同当前正式链的完整镜像，且没有独立编辑标记：显示当前正式镜像。
- draft.relationRevision < project.relationRevision，并且完整匹配该声明版本的历史正式链：判为过期镜像，显示当前正式链，同时提示“旧草稿（关系版本 1）已由正式版本 3 取代”。只读解析不修改原始 snapshot、文件或冻结历史。
- 结构不一致，或结构虽然相同但输入与历史正式镜像不一致，或没有足够历史证据：一律按独立编辑保留，显示版本状态和两条恢复路径。旧文件无 basisRelationRevision 时，以其自身声明的 relationRevision 标识基准；这不是新造的已确认凭据。

这里的“与旧正式链结构一致”采用保守的完整镜像证明，不仅比较 term ID/符号：还比较数值 q、方向、偏差、termRevision、名称/备注、目标、假设与顺序。仅靠相同的环结构无法分辨用户真改了数值，因此不能据此覆盖。格式小数位差异经 q 解析后不算工程值编辑；有明确独立编辑标记时仍原样保留。

打开原缺陷文件时，存储 draft.S 仍是 12.00 / 版本 1（没有偷偷改原证据）；有效显示是正式 S=12.05 / 版本 3，界面明确提示替代。后续正式提交会在候选内写入新的顶层镜像。用户仅浏览/保存旧文件而未正式提交时，兼容解析仍可在下次打开时给出同样正确显示和提示。

## 回归清单

FIX-01 通过：打包应用从 12.00 提交 12.04，main 正式 S=120400q，顶层 draft.S=12.0400；图纸标注 12.04；组成环表、当前计算与底部校核均 0.1100～0.2100。
证据：packaged-results.json 的 FIX-01；FIX-01-drawing.png、FIX-01-drawing-detail.png、FIX-01-chain.png、FIX-01-review.png；logs/packaged-e2e.log；src/workspace/draftSync.test.tsx。

FIX-02 通过：打包应用预览 12.10 为 0.0500～0.1500，确认按钮禁用；绕过按钮直接调用真实 preload/API 仍返回 REQUIREMENT_NOT_SATISFIED；断言整个 main snapshot 与预览前相同，正式仍 12.04（包括正式链与顶层草稿）。
证据：packaged-results.json 的 FIX-02；FIX-02-blocked.png；logs/packaged-e2e.log；desktop/tests/e2e/draftSync.mjs。

FIX-03 通过：打包应用再提交 12.05，main 正式 S=120500q，顶层 draft.S=12.0500 / 关系版本 3，各视图 0.1000～0.2000，条款 satisfied、下裕量 0q，边界相等满足。
证据：packaged-results.json 的 FIX-03；FIX-03-drawing.png、FIX-03-drawing-detail.png、FIX-03-chain.png、FIX-03-review.png；logs/packaged-e2e.log。

FIX-04 通过：真实 saveProject 成功后，终止自己启动的应用进程（SIGKILL；不是仅刷新或关窗口），等待进程退出，重新启动同一打包应用并打开保存文件。正式/顶层草稿/表格 S 仍 12.05，图纸 12.05，当前与底部极值仍 0.1000～0.2000，冻结条款检查与退出前完全相同；来源仍定位 PDF 第 2 页原选区，整个 source 对象深比较相同，高亮可见。
证据：packaged-results.json 的 FIX-04 与 exit；FIX-04-drawing.png、FIX-04-drawing-detail.png、FIX-04-chain.png、FIX-04-review.png、FIX-04-source.png；fixtures/ui-session.cunlian；logs/packaged-e2e.log。

FIX-05 通过：打包应用直接只读打开 /Users/aston/DSH/tmp/v35-indep/saved-after-12.05.cunlian，显示正式 12.05、0.1000～0.2000，并展示旧草稿被版本 3 取代的提示；仍断言 main 原始顶层草稿是 12.00。打开前后字节深比较相同。该文件与归档副本 SHA-256 均为 024df419014bbdcbfc081f24b4c91be65833f8bda047941cb1fe70b04d32a941。
证据：packaged-results.json 的 FIX-05；FIX-05-chain.png、FIX-05-review.png、FIX-05-drawing-detail.png；legacy.json；verification.json；desktop/tests/draftSyncLegacy.test.ts。

FIX-06 通过（真实事务/落盘重开 + React DOM/渲染，非打包 GUI 点击验收）：保留数值编辑、非法输入、结构编辑、目标编辑和备注/假设；正式 12.05 提交后，独立草稿仍保留旧输入与 basis；状态、保留路径、重算取消/确认均断言；实际磁盘重开后草稿可恢复。测试同时检查正式链、顶层草稿、React 输出的版本提示与计算。
证据：logs/fix-06-09.log；mutations/restored-green.log；desktop/tests/draftSyncTransactions.test.ts；src/workspace/draftSync.test.tsx；src/pages/DesktopWorkspace.test.tsx。

FIX-07 通过（主进程故障注入 + React 渲染）：注入 ENOSPC，使正式提交和普通保存均失败。整个会话 snapshot（含正式链、旧历史与非法用户草稿）深比较不变，磁盘字节相同；界面保持非法输入及“当前结果不可用”，不显示伪旧结果。既有 changeChannels 原子性和计算异常回归也在全量测试内通过。
证据：logs/fix-06-09.log、logs/test-desktop.log；desktop/tests/draftSyncTransactions.test.ts；desktop/tests/changeChannels.test.ts。

FIX-08 通过（真实条款确认/参数提交 + React 渲染）：原项目目标 1800～3000q，任务书 1000～3000q；正式/顶层草稿均是 120500q，对应 1000～2000q。原项目显示“超出目标”，正式条款检查 satisfied。没有拿任务书区间覆盖项目目标。
证据：logs/fix-06-09.log；desktop/tests/draftSyncTransactions.test.ts。

FIX-09 通过：复制只读旧基线 baseline.cunlian.pre-v35.ded17783b6b540d8.cunlian 到本证据目录后，用打包应用打开该旧文件副本，经既有旧文件读取兼容路径（不动原证据）。S 仍 12.00 / 120000q，当前范围 0.1500～0.2500；旧报告对象、PDF revisions 与 bindings 与原对象深比较相同，历史报告页显示原冻结结果。未把旧快照重算成新结果。
证据：packaged-results.json 的 FIX-09；FIX-09-chain.png、FIX-09-history.png；fixtures/old-baseline.cunlian；logs/packaged-e2e.log；desktop/tests/draftSyncLegacy.test.ts。

## 变异

mutations/omit-top-level-draft.patch 去掉修复后的顶层同步（保留 base.draft）。
mutations/omit-top-level-draft.log 是真实失败输出：FIX-01 期望 120400q 却得到 120000q；FIX-03 期望 120500q 却得到 120000q。不是用编译错误替代回归失败。
恢复后 mutations/restored-green.log 为绿色，含恢复路径回归。

## 新增与修改测试

- src/workspace/draftSync.test.tsx：提交三真源、连续提交、保存往返、旧镜像兼容、四类独立编辑与持久化、显式恢复选择、未知旧编辑保留。
- desktop/tests/draftSyncTransactions.test.ts：独立草稿成功提交/落盘恢复、提交及保存失败原子性、项目目标与条款区间独立判定，均包含 React 渲染计算断言。
- desktop/tests/draftSyncLegacy.test.ts：真实旧问题文件的只读兼容判断与旧基线；DRAFT_SYNC_RECORD=1 时可重新生成隔离 UI 种子。
- src/pages/DesktopWorkspace.test.tsx：调整编辑语义断言，正式链不变，顶层草稿准确记录编辑与 basis；原有可见结果和非法输入断言保留。
- desktop/tests/e2e/draftSync.mjs、draftSyncCdp.mjs：真实打包应用自动化、进程退出/重开、主进程拦截和 PDF 定位。

## 命令、打包和证据约束

六条命令及额外打包的真实 stdout/stderr、退出码分别见 logs 与 verification.json：

    npm run typecheck
    npm run typecheck:desktop
    npm run lint
    npm run test
    npm run test:desktop
    npm run build
    npm run package:desktop

复核辅助命令：

    node scripts/verify-draft-sync.mjs
    node desktop/tests/e2e/draftSync.mjs
    npm run test:desktop -- desktop/tests/draftSyncLegacy.test.ts desktop/tests/draftSyncTransactions.test.ts --reporter=verbose
    npm test -- src/workspace/draftSync.test.tsx --reporter=verbose

产物：out/寸链-darwin-arm64/寸链.app，package 版本 0.0.5-beta。
app.asar SHA-256：bf2f6315228f021126fd89e91b97702937ae886b0755f9847e11894527b5b5c3。
可执行文件 SHA-256：cd2d9352400dc818a8ee9a98dfc1d192e9b5ac549ef887ea1f52029418f8e165。
不是仅测试开发服务器，截图来自该应用的真实页面。

JSON 输出通过现有 serializeEvidence 在采集输出边界转换机器路径/随机 ID；q、计算、hash、时间、失败结论不改。产品输入从未使用归一化 ID。原始 UI 截图、.cunlian 和命令日志可核对实际标识。初轮脚本/证据序列化失败留有 failure.png、packaged-partial.json、logs/first-verification.capture，不计为通过；最终结论以最终完整日志和 packaged-results.json 为准。未修改历史证据文件与历史冻结 SHA 门禁。

## 限制

- FIX-06～08 没有声称已完成打包 GUI 的人工点击验收；使用真实事务、真实文件 IO、React DOM/SSR 断言。打包硬验收 FIX-01～04 已完成，另外打包覆盖了 FIX-05、09。
- 重开测试是保存成功后的强制进程终止/重新启动，不是“正常退出”流程测试；SIGKILL 明确记在结果中。
- 历史不足的旧文件无法无损推断“数值不同是用户编辑还是旧镜像”；保守保留并提示，由用户明确选择，绝不只凭数值不同覆盖。
- 没有新增格式升级。旧基线打开走的是项目原有升级逻辑；来源与冻结报告保持原值。
- 测试日志保留 jsdom 的 canvas/navigation 提示，构建保留大包警告；这些不是本次真实 Electron GUI 的测试替代。未新增签名/公证、未发布或推送。
