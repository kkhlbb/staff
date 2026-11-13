"""Read-only inventory of production UI identities; always compare to the task baseline."""
from pathlib import Path
import subprocess
import re
import difflib

root = Path(__file__).resolve().parents[1]
baseline = 'fdd200d'
files = sorted(p for folder in ('src', 'desktop', 'mcp', 'scripts') for p in (root / folder).rglob('*') if p.suffix in ('.ts', '.tsx', '.js', '.mjs', '.py') and not any(x in str(p.relative_to(root)) for x in ('.test.', '/tests/', '/e2e/', '/__tests__/', '/__fixtures__/', 'src/test/')))
idpat = re.compile(r'\b\w*(?:Id|Ids|Fingerprint)\b|\.id\b|sha256|truncateId|snapshotShortId|viaViewport')

def cell(value):
    return value.strip().replace('|', '\\|').replace('`', '&#96;')

rows = []
raw = []
for p in files:
    rel = str(p.relative_to(root))
    result = subprocess.run(['git', 'show', f'{baseline}:{rel}'], cwd=root, text=True, capture_output=True, check=False)
    if result.returncode:
        continue  # New presentation helpers contain no baseline leaks.
    before = result.stdout.splitlines()
    after = p.read_text().splitlines()
    ops = difflib.SequenceMatcher(None, before, after, autojunk=False).get_opcodes()
    for i, line in enumerate(before):
        if not idpat.search(line):
            continue
        raw.append((rel, i + 1, line))
        visible = (bool(re.search(r'[\u4e00-\u9fff]', line)) and any(t in line for t in ('${', '{', '??', '||'))) or bool(re.search(r'>[^<]*\{[^}]*(?:' + idpat.pattern + r')[^}]*\}', line))
        if not visible:
            continue
        tag, a, b, c, d = next(o for o in ops if o[1] <= i < o[2])
        if tag == 'equal':
            new, n = line, c + i - a + 1
            status = '保留诊断/数据产生点：原始身份供日志、文件、MCP 协议与工具证据；UI 消费处经 uiDiagnosticText 或人话标签映射' if p.suffix != '.tsx' else '保留结构引用/用户原文：key、选择/路由/调用参数不是可见身份；外部文件名与原话不改写'
        else:
            new, n = ' '.join(after[c:d]), c + 1
            status = '已改展示；新块仍保留完整调用/关联参数，不改业务数据'
        if any(t in line for t in ('data-testid=', 'key={', 'data-', 'id: ', 'documentId:', 'projectId:', 'revisionId:', 'onClick=')) and not re.search(r'>[^<]*\{', line):
            status = '故意保留：React key / DOM-data 属性 / IPC 参数 / 结构标识，不是用户可见文本'
        rows.append((f'{rel}:{i + 1}', f'{rel}:{n}', line, new, status))

header = '''# 界面内部 ID 清理：全库清单

基线 fdd200d；行号由 scripts/ui-id-inventory.py 从基线及最终工作树计算。

全库运行代码扫描包括 src、desktop、mcp、scripts 的 TS/TSX/JS/MJS/Python；测试/夹具不是生产展示入口，排除但原文件保留。desktop/main/menu.ts 与 index.ts 的原生菜单/对话框标题均为固定人话，未发现版本身份拼接；MCP 回包、脚本 stdout、诊断与证据明确保留内部身份，它们不是应用界面版本标签。JSON/CSS/HTML 静态资源不产生内部 ID 拼接。

## 规则与审计结论

仅改展示层。正式序号沿用图纸的 append-only fileRevisions 顺序（索引 + 1）；缺少记录为「未命名版本」。草稿显示「草稿 · 第 N 版」。任何版本都不退回 ID，也不显示 ID 前几位。

### 六区域与扩展入口

| 区域 | 实际入口 | 改前 | 改后 / 保留原因 |
|---|---|---|---|
| 主工作台顶栏、属性、项目树 | src/pages/DesktopWorkspace.tsx | Rev/currentRevisionId、模型版本、来源版本、父版本、图纸指纹、参数/标注身份 | 第 N 版、名称；缺记录未命名；完整图纸校验信息保存在文件 |
| Agent 侧栏 | src/components/AgentSidebar.tsx | 正式 revisionId、两种提交回执 revisionId、失败与提问/定位消息可夹带 ID | 正式序号；提交后只读 reattachSession 的真实已提交历史；无序号未命名；诊断仅展示副本映射 |
| 确认面板 | src/components/ExtractionReviewPanel.tsx、ChangeWorkbench.tsx；DesktopWorkspace 关联确认 | 草稿/候选/轮次/批次/父版本/预览/标注身份 | 名称、页范围、真实版本号、候选数量、条目序号；动作与原数据 ID 保留 |
| 图纸面板 | src/components/SpacerDrawingPanel.tsx、DrawingCanvas.tsx | 候选状态回显正式 revisionId；老文件空版本栏回退「草稿 rev-…」 | 草稿/正式版本人话；老文件只替换预览 SVG 的可见版本格，不改 metadata/图纸记录/fingerprint/导出数据 |
| 项目列表 | src/pages/DesktopWorkspace.tsx recent/recovery；ProjectList.tsx | 最近项目 Rev；恢复/导入/备份错误可能夹带 ID | 最近索引没有正式序号，诚实显示未命名版本；异常文案消费端映射；项目名、路径原文保留 |
| DXF 看图信息栏 | src/components/DxfViewer.tsx | 经视口 ${entity.viaViewport} | 经图纸视口；外部 DXF 原始 TEXT/图层/块名不修改 |
| 来源/PDF 与历史条款 | SourcePanel.tsx、PdfViewer.tsx、DesktopSessionViews.tsx、RequirementRevisionHistory.tsx | revisionId / reqrev；短 ID 来源摘要 | 文件名、文档内版本序号、条款版本序号、页码及选区；下拉 option.value 保留 |
| 报告/快照/比较 | PrintReport.tsx、SnapshotList.tsx、Workspace.tsx、ReviewSidebar.tsx、ContributionTable.tsx、ScenarioCompare.tsx | projectId、snapshotId（含页脚短 ID）、revisionId、termId fallback | 项目名、创建时间、来源版本、未命名组成环；冻结快照和路由身份不变 |
| 对话框与异常消费 | SessionDialogs.tsx、ProjectList.tsx、DesktopWorkspace.tsx、AgentSidebar.tsx | 上游错误中的原始身份 | uiDiagnosticText 保留原因与补救文字，替换完整身份 token，不截断 |
| 外部读数依据 | AgentReadEvidenceList.tsx | revisionId、完整 64 位 SHA-256 | 只显示页码/提供者/原话；提示校验信息在文件中；EvidenceRef 完整保留 |

### 故意保留（不属于用户版本身份展示）

1. 业务、IPC、存储、项目文件、日志、证据、源 SVG metadata、React key、data-*、路由、选择控件 value、事件参数：须保留完整身份，禁止因展示清理而删改。
2. 上游诊断产生点（useDesktopSession、requirements/history、history/snapshots、project-file/validation、backup、storage、drawing 等）：不改契约；用户消费处显示人话/展示副本。附表明确列出产生点，不能据其仍含 ID 判定存储应删 ID。
3. 明确标为 SHA-256 / fingerprint 的现有短校验摘要保留；这是校验值，不是版本 ID，绝不作为版本前缀显示的例外。原先完整 64 位读数哈希与属性指纹不再在界面输出。
4. 外部 DXF 文件图形/文字、用户项目名、文件名/路径、原话、人名仍如实展示；不以“清理”为由破坏来源真值。这些不是应用把内部 ID 拼成标签的路径。若用户故意输入禁用串，通用守卫照样拒绝该渲染结果，不静默放行。
5. 模型配置里的供应商模型名（如 deepseek-chat）是用户配置，不是任务实例号。fake-1/任务实例号不回显；工具名/错误码走既有 agentWording 人话映射。

## 文件:行号 / 改前 / 改后 / 保留理由

下表是刻意保守的超集，含用户文本及诊断候选、结构引用。每个改前命中均提供改后所在块；同块可重复以保留逐行可追溯性。“保留结构引用”不授权把身份显示给用户。非可见 ID 另有全量附录，避免只列三处。

| 基线位置 | 最终位置 | 改前源码/文案 | 改后源码/文案 | 处理/保留理由 |
|---|---|---|---|---|
'''
text = header + ''.join('| ' + ' | '.join(cell(x) for x in row) + ' |\n' for row in rows)
text += '\n## 全量 ID 引用附录（含非可见结构，故意保留）\n\n下面保留所有基线匹配行，不删业务/存储引用；测试与夹具排除，因其不是生产展示入口。\n\n'
for rel in sorted({r[0] for r in raw}):
    text += '### ' + rel + '\n\n```text\n' + ''.join(f'{n}: {s}\n' for f, n, s in raw if f == rel) + '```\n\n'
text += f'\n扫描统计：生产运行代码文件 {len(files)}；基线标识引用 {len(raw)} 行；用户文本/诊断候选 {len(rows)} 行。统计不是泄漏数。\n'
output = root / 'docs/evidence/ui-id-leak/inventory.md'
output.write_text(text)
print(f'{output}: files={len(files)} references={len(raw)} candidates={len(rows)} bytes={output.stat().st_size}')
