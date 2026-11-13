# 读数入口 ingest_readings 实现与验收

## 结论与边界

DeepSeek deepseek-flash 不支持图像输入。本次不含看图能力，也不实现OCR。“谁来看图”未解决；今天的产品路径是用户对照文件报数，未来视觉模型仅预留证据结构。

PDF页读数入口、逐条核对防线、出处随版本与图纸保存已实现。image证据结构、完整性/失效校验、显示及容器结构已就位；桌面尚无图片库，工具对image返回UNSUPPORTED_SCOPE，尚不能直接接收图片文件读数。这是未完成项，不计通过。

工作分支 agent/ingest-readings。从d72fc48开分支；工作期间出现的既有文档提交0d715f2（README/BENCHMARK）原样保留，不属于本任务实现提交。未merge/push/删分支。agent/ocr-scanned只读了指定扫描样本，未合并、未修改。

## 改动清单

- ADR-001只追加§13，原有结论未重写。
- document-extraction/types.ts新增第五支AgentReadEvidence；出处完整性、去重、失效沿用统一入口。ingestReadings.ts只产pending ring，PDF evidence恒为空，原话只存agent-read。合法q与mm检查，不换算或补值。
- desktop/main/ingestReadings.ts绑定项目负责人、会话与轮次，核对实际附件SHA/版本/页数；AgentToolService串行写恢复草稿。src/agent工具schema注册桌面工具，未改MCP注册表。
- batch.ts整批拒绝agent-read；draft.ts记录individual/batch并在planApplication复核标记、单条确认决定、代数、数值快照、来源与会话。更正同符号保留candidateId、推进代数、旧确认失效。
- ExtractionReviewPanel专组与固定“读数未核对”标记，不出现该组“全部确认”；AgentSidebar也显示来源与原话。项目头不再把已挂扫描页的读数项目标成无外部原文件。
- mapIntent/mapConfirmed及项目schema保留组成环/参数provenance，摘要把存在的出处纳入失效判定；computeChange、图纸重建、SVG/DXF共享图纸保留读数依据。未改抽取规则、精度或判据。

## 实际执行结果

最终完整输出见gates.json和logs/01..09（退出码均0）：

    npm run typecheck             0
    npm run typecheck:desktop     0
    npm run lint                  0
    npm test                     115文件 / 1308通过
    npm run test:desktop          307通过 / 17跳过（44文件通过、2文件跳过）
    npm run test:mcp              3文件 / 22通过
    npm run build                0
    npm run package:desktop      0（含打包PDF worker断言）
    npm run test:real-docs        4文件 / 12通过

新增领域用例16条、桌面用例10条；另有UI出处/批量隐藏、参数出处显示和SVG/R12/2000 DXF来源测试。JSON证据自动增加守卫用例，故全量数量不等于仅业务用例差值。跳过的联网/模型用例未记通过。

真实服务E2E：scripts/ingest-readings-evidence.ts，1条通过。打包UI：desktop/tests/e2e/ingestReadings.mjs，verdict=pass。复跑命令、夹具解释见scripts/ingest-readings-evidence.md。

## A：真扫描件 → 读数 → 确认 → 提交 → 出图

fixtures/r2-tolerance-domain-scanned-300dpi.pdf是指定OCR分支样本的逐字节副本，SHA-256：

    1c846ad52f571a5458518dde87615276766929e373ebf754b1098a30cc538b8f

真实pdfjs逐页读取：5页文本项均0，见service-result.json。第3页左栏底部三条：L1=30(0/-0.2)，L2=5(0/-0.1)，L3=43(+0.2/0)mm，page3.png可复查。测试输入由实现代理查看渲染页转录，不是用户本人已核对，也不是产品视觉输出；manifest明确此边界。

初次喂入3条，其中L2故意报50（真值5）。批量拒绝、未确认拒绝后，真实逐条确认，错误数值未被自动“修好”；固定的合成装配条款使提交返回REQUIREMENT_NOT_SATISFIED。随后通过相同读数入口更正L2=5，旧确认失效，再逐条确认、预览、授权、提交成功。重读磁盘项目核验三环真值及agent-read。错误输入与原确认决定仍保留在证据和历史中。

装配式L3-L1-L2、隔套几何20/32/12.05及8..8.5闭区间是明确独立的合成工程条件，不冒充论文内容。初次脚本误复用旧示例0.15..0.25的测试配置已修正；产品条款判据未改，也未为放过错值扩大公差。图纸上的隔套几何不声称是论文装配的自动重建。

- pending.cunlian：初次3条未核对读数。
- confirmed.cunlian：3条逐条确认，仍含故意错值。
- committed.cunlian：核对更正后真实正式提交文件。
- 本目录实际SVG / R12 DXF：经生产导出IPC写盘并读回哈希核验。
- screenshots/01-unverified-readings.png：固定未核对标记、原话、版本页码与提供人。
- screenshots/02-after-real-batch-rejection.png：真实批量IPC拒绝后的原页面；错误码在batch-rejected.json/ui-result.json，无伪造toast。
- screenshots/03-single-item-confirmations.png：打包应用真实三次逐条按钮点击后的决定。
- screenshots/04-committed-drawing-provenance.png：打包应用打开正式提交工程图。
- screenshots/05-export-title-source.png：真实SVG导出物全幅，标题栏与技术要求可读到“读数来源：第3页，验收转录提供”。
- screenshots/99-failure.png：早期UI取证等待busy结束前点击的诊断截图，非最终通过证据。

服务阶段是完整真实事务；UI阶段打开服务生成容器，实际单条确认并读取提交图纸，不冒称第二次纯UI ingest到commit全链。

## B / C：防线与出处

batch-rejected.json：EXTRACTION_BATCH_REJECTED，草稿和acceptedSeq零变化。unconfirmed-apply-rejected.json：NOT_CONFIRMED；unconfirmed-commit-rejected.json另记录无授权直接提交被拒（不拿批准门禁替代核对门禁）。wrong-reading-commit-rejected.json保留10倍错误被条款拦截的真实结果。

project-fragment.json是从真正提交文件解码后节选的脱敏JSON，含kind=agent-read、source.page=3、statement原话及三环数值；commit-result.json提供完整项目片段。数值evidence数组为空，候选/数值/计划/项目来源均不降级pdf-text或pdf-ocr；脚本对任何pdf-text对象递归断言不包含agent-read或这句读数原话。

## D：真实变异红绿

    node scripts/ingest-readings-mutations.mjs

- M46：允许批量，断言收到ok:true而期望拒绝，退出1；恢复16/16绿、退出0。
- M47：将读数provenance改成带伪造PDF锚点的pdf-text，出处断言失败、退出1；恢复16/16绿、退出0。
- M48：删除入口requiresVerification，标记及提交门禁断言失败、退出1；恢复16/16绿、退出0。

mutations/下保存三份变异、各自red/green原始日志。脚本要求AssertionError，编译失败不算杀死。

## 未做项 / 已知问题

- 本次不含看图能力；未接视觉模型，未做OCR。
- 图片直入存储未完成，当前桌面image输入明确拒绝；领域和证据接口预留，不计图片端到端通过。
- 未执行真实DeepSeek联网调用、原生保存对话框辅助功能自动操作、真实PDF打印；本次真实导出为SVG和R12 DXF。PDF共用来源图纸的单元覆盖不代替实际打印取证。
- Vite仍提示大于500kB的chunk；jsdom的canvas/navigation未实现警告仍在，命令退出0。未为本任务扩大重构。
- 抽取规则未改，real-docs回归通过；本次没有重生成140/58/82统计报告，不把未重测的汇总数字当作新增实测。
