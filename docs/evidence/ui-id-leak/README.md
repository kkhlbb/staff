# 界面内部 ID 清理 · 验收证据

基线：main / HEAD 开工时均为 fdd200de96d1c50154da68c1c3cf97a5f3efe499，工作区为空；分支 agent/ui-id-leak。未 merge、push 或删分支。提交哈希见交付消息 / git log。

## 实现范围

- 正式版本用项目 fileRevisions 的真实序号显示「第 N 版」；没有匹配记录显示「未命名版本」，不回退 ID、不切片。
- 草稿显示「草稿 · 第 N 版」。顶栏、属性、项目树、Agent 正式版本、普通/意图提交回执、变更预览/版本历史、来源/PDF、确认面板、项目列表、报告/快照、DXF 信息栏均完成展示审计。
- 提交回执只读主进程已提交快照取版本序号，不用 acceptedSeq 或预览猜版本；普通提交后复用现有只读重新挂接回调刷新顶栏/侧栏，未改提交判定/写入逻辑。
- 图纸老文件的空版本栏仍保留原始数据和 fingerprint；DrawingCanvas 只替换预览 SVG 的可见版本格。文件、源 SVG metadata、导出数据、IPC 和存储格式没有删除或改写内部身份。
- 问题/失败/定位/导入/恢复等诊断在消费端处理展示副本，保留原因与补救文字。没有把失败变成功，也没有改数学计算/精度。

## A / F：真实改前、改后与打包应用

每一组两张 960×640 PNG，第一张同时覆盖顶栏与侧栏正式版本，第二张覆盖提交回执：

| 阶段 | 顶栏 + 正式版本 | 提交回执 |
|---|---|---|
| fdd200d 独立基线包 | before-topbar-formal-version-960x640.png | before-agent-submit-receipt-960x640.png |
| 修复后实际 app | after-topbar-formal-version-960x640.png | after-agent-submit-receipt-960x640.png |
| 最终重新打包 app | packaged-topbar-formal-version-960x640.png | packaged-agent-submit-receipt-960x640.png |

基线三处真实复现 rev-a-UUID；修复后和最终包三处都断言与已提交 fileRevisions 序号一致，实际显示「第 2 版」，回执「已提交（工具回执） · 第 2 版」。三个位置均无连续 ≥32 位十六进制串或完整/截断 rev-x 身份。PNG 已实际视觉核对。

脚本 scripts/ui-id-evidence.mjs 实际启动给定 .app 的独立实例，使用隔离 profile 与现有 stage3 seed 副本，通过真实 UI 点击内置离线演示、确认保存；main 的预览/授权/提交实现没有 mock。未调用真实联网模型、未使用用户项目。截图来自真实 Electron renderer 的 Page.captureScreenshot，不是合成图，也不声称包含 macOS 原生窗口边框。

before/after/packaged-observed.json 保存实测文案、截图 SHA-256、主进程前后快照与判定。断言先检查原始结果，再经 scripts/evidence-json.ts 的 serializeEvidence 输出；证据中的 UUID/机器路径按项目既有要求归一，数字/校验值保留，PNG 没有遮掩。每组实际命令日志见 logs/*-screenshot.log；基线输出 baseline-reproduced，另外两组 pass。包 SHA-256 见 packaged.sha256。

复跑命令及基线构建来源见 screenshots.md。

## B：全库清单

inventory.md 由 python3 scripts/ui-id-inventory.py 生成，固定对比 fdd200d，提供文件:旧行号/新行号/改前/改后/保留理由。

实际扫描 src、desktop、mcp、scripts 的生产运行代码：294 文件、6713 行基线标识引用、512 行用户文本/诊断候选；后两者是保守候选及结构引用数量，不是宣称存在这么多泄漏。包含顶栏、Agent（回执/提问/失败）、确认、图纸、项目列表、DXF 重点入口及完整引用附录。日志、协议、证据、DOM/数据标识故意保留；用户原话/文件名和外部 DXF 原始内容不篡改。

## C：通用守卫，不只守图纸

src/test/uiIdGuard.ts 检查实际 DOM 文本、SVG text、title、aria-label、输入显示值；拒绝连续 ≥32 十六进制及 rev-[a-z0-9]-…（连截断前缀也拒绝），并拒绝空扫描。不排除 aria-hidden 的可见文字。仅排除非可见 script/style/SVG metadata/hidden 区域；传输 data-* 属性不算可见文本。

| 区域 | 实际渲染覆盖 |
|---|---|
| 主工作台 | DesktopWorkspace.test.tsx：危险 revision UUID 的真实工作台、属性与项目树 |
| Agent 侧栏 | AgentSidebar.test.tsx：危险 task/version 身份、失败、问题及成功提交回执 |
| 确认面板 | ExtractionReviewPanel.test.tsx：危险 draft/candidate/source 身份，真实候选文字必须存在 |
| 图纸面板 | 工作台内 SpacerDrawingPanel；DrawingCanvas.identity.test.tsx 另用真实 SVG + 旧版 UUID，要求真实版本格/尺寸存在且元数据与输入对象未变 |
| DXF 看图 | DxfViewer.test.tsx：真实 2000 1:2 样本的 SVG/信息栏，保留原几何数值断言 |
| 项目列表 | DesktopWorkspace.test.tsx：recent 中真实危险版本身份，要求项目条目实际出现 |

初次真实红：logs/guard-red.log，Agent 的 ≥32 hex 和列表的 rev UUID 泄漏断言失败。该早期日志也包含一个当时测试初始化问题，未将其冒称为泄漏证据；有效泄漏失败有明确 UI leaks 原因。最终六区定向执行：logs/guard-green.log，5 文件 / 6 用例通过；90 项仅因 -t 过滤未执行，不是全量漏测。完整 npm test 另行全通过。

src/test/uiIdGuard.test.tsx 额外验证普通文字、SVG、可见 aria-hidden 文字、可访问提示、输入值中的危险串都会被抓；metadata/data-* 原样保留不会误判；空扫描必须失败。

## D：M51 真实变异

只把 DesktopWorkspace 顶栏版本标签改回 `${project.currentRevisionId}`，未改守卫或夹具。实际最小差异在 M51.diff。

- npm test -- src/pages/DesktopWorkspace.test.tsx -t 'UI-ID guard'
- 变异时退出 1：logs/M51-red.log，明确报 UI leaks a revision identity，含真实渲染出的完整 rev-a-UUID；1 失败 / 1 通过 / 50 筛选跳过。
- 撤销该变异，cmp 与变异前完整源文件逐字节一致（退出 0）。
- 同命令恢复退出 0：logs/M51-green.log，2 通过 / 50 筛选跳过。

不是伪造 fail 文案，不是改 expected 使测试红，也没有提交变异源码。

## E：六条命令 + 打包 + MCP

复跑入口 node scripts/ui-id-verify.mjs，原始 stdout/stderr 与结果表均落 logs/；logs/verification.md 直接由真实执行结果生成。

| 命令 | 实际结果 |
|---|---|
| npm test | 119 文件 / 1342 用例通过，exit 0 |
| npm run test:desktop | 44 文件通过 / 2 文件跳过；307 用例通过 / 17 跳过，exit 0 |
| npm run typecheck | 无诊断，exit 0 |
| npm run typecheck:desktop | 无诊断，exit 0 |
| npm run lint | 无诊断，exit 0 |
| npm run build | Vite 构建成功，exit 0 |
| npm run package:desktop -- --arch=arm64 | 打包成功，pdf worker 运行时加载 RESULT PASS，exit 0 |
| npm run test:mcp | 3 文件 / 22 用例通过，exit 0 |

最终应用：out/寸链-darwin-arm64/寸链.app。提交后再从同一 HEAD 将验证输出写到 profile scratch，避免证据自修改污染工作树；最终 git status --short 的真实输出在交付消息报告。

## 未做项与已知边界

- 本卡 A–F 均有对应执行证据；没有用静态源码检查代替 F 的真实打包启动。
- 桌面原有 17 个跳过保留为跳过，不计通过。真实联网供应商模型没有调用，不冒称真实模型验收；本卡回执走内置离线演示，但授权/提交是实际主进程实现。
- macOS 原生系统文件对话框/窗口边框未截图；此处用实际打包 Electron 窗口的 renderer 内容满足三位置取证，不声称测试了原生保存对话框。
- 外部 DXF 原文、用户原话/人名/项目名/文件名保持真值；不以守卫为由静默修改输入。内部版本身份不得借这些字段回退显示。
- 老文件/导出物中的原始内部身份仍可能存在：这是明确要求保留的文件数据，不是本卡修改存储/导出的机会。预览只修改可见版本格，原 metadata 与 fingerprint 不动。
- 构建/测试原有警告保留在原始日志，不删除输出来制造“无警告”。未 merge/push/删分支。
- 原始日志保留命令自带的行尾空白/末尾空行；因此对包含日志的完整 staged diff 做 --check 会报告这些空白。src/scripts 的 staged --check 无问题，不为消除提示篡改实测输出。
