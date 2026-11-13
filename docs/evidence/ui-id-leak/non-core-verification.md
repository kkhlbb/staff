# 非核心区域子任务历史验证记录

本文件是实现过程中的历史阶段记录，不是最终验收。下文“主 agent 必须处理”所列核心修复、旧断言迁移、六区守卫及打包截图均已收口；最终结果以 README.md、inventory.md 与 logs/verification.md 为准。早期失败如实保留，不计作最终通过。

## 已验证

- `npm test -- src/components src/pages/SnapshotList.test.tsx`：**23 个测试文件，164 个测试全部通过**（Vitest 5.1.0，最后运行 02:26:17，耗时 3.47s）。jsdom 缺 canvas 的提示来自现有预期错误测试，不是失败。
- `npm run typecheck`：退出 0。
- 对本子任务改动生产文件及 `uiIdentity.test.tsx` 的定向 `npx eslint ...`：退出 0。
- `git diff --check`：退出 0。
- 新增 `src/components/uiIdentity.test.tsx` 的 4 条用例：真实正整数版本号、同文档内来源版本顺序、上游错误身份替换且保留原因、读数出处不渲染内部版本/完整哈希且原对象不变。
- 未改 IPC/业务/存储/文件格式；未提交；未触碰主 agent 四个核心 TSX 文件。

## 全库清单

`inventory.md` 扫描 **162 个生产 TS/TSX 文件**，附录列出基线 **4168 行**标识引用，主表 **402 行**用户文本/诊断候选（候选不是泄漏总数）。每条给出旧位置、新位置、改前/改后代码及保留/交接原因。CSS 的 `content:` 独立扫描仅发现项目列表的中点字符，JSON 未发现指定内部 ID 字段。

扫描生成脚本在 `/Users/aston/.hermes/profiles/daedalus/cache/scratch/build-ui-id-inventory.py`。主 agent 完成核心区域后可重跑，使新行号/改后文案与最终工作树一致；该脚本只生成清单，不改源文件。

## 主 agent 必须处理

1. 核心四文件与六区守卫/真实红绿/截图/打包由主 agent 负责。静态清单明确列出范围外上游错误风险，不宣称全库零泄漏。
2. **旧页面测试在断言泄漏本身**，超出子任务授权文件范围，未改：
   - `src/pages/Workspace.test.tsx:441` 仍断言 `项目不存在：missing-project`。应改为人话错误，并断言无原 ID；该测试最近运行是 20 过 / 1 失败。
   - `src/pages/PrintReport.test.tsx:260,265,385,416,585,619` 仍断言项目 ID、快照 ID、页脚短 ID、错误中的 snapshot-missing；应改为项目名/创建时间/分析快照与不泄漏断言。该文件最近运行是 6 过 / 4 失败，都是旧 ID 展示契约。请更新页面测试后再跑全量。
3. `uiDiagnosticText` 是展示兼容器，不是根因守卫，也不替代业务错误码。它覆盖 UUID、rev 模式、16 位稳定哈希身份与旧短 ID 片段；任意供应方自由字符串或短标识仍需基于实际渲染路径核对。主 agent 可统一到自己的展示函数，但不能让回执/失败重新显示原 ID。
4. 文件/日志/证据/源 DXF 原始内容保留。现有明确标注 SHA-256 / 指纹的短校验信息保留；不可将其当作版本 ID 截断例外。

## 文件范围

生产：`Workspace.tsx`、`SnapshotList.tsx`、`PrintReport.tsx`；components 下的 `AgentReadEvidenceList`、`ChangeWorkbench`、`ContributionTable`、`DesktopSessionViews`、`DxfViewer`、`ExtractionReviewPanel`、`PdfViewer`、`RequirementRevisionHistory`、`RequirementStatusPanel`、`RequirementWizard`、`ReviewSidebar`、`ScenarioCompare`、`SourcePanel`、`SpacerDrawingPanel`，以及新 `uiIdentity.ts`。

测试：相应 components 旧泄漏断言已迁移；新增 `uiIdentity.test.tsx`。页面测试由主 agent 收口。
