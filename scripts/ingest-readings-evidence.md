# ingest_readings 取证复跑

我们使用的 DeepSeek deepseek-flash 不支持图像输入。本次不含看图能力，不做 OCR，不解决谁来看图。今天由用户对照扫描件报数；未来视觉来源只预留证据结构。

## 命令（仓库根目录，使用项目内依赖）

    INGEST_READINGS_MANIFEST=docs/evidence/ingest-readings/manifest.json ./node_modules/.bin/vitest run --config scripts/ingest-readings-evidence.config.ts
    node scripts/ingest-readings-mutations.mjs
    node scripts/ingest-readings-gates.mjs
    node desktop/tests/e2e/ingestReadings.mjs
    env -u ELECTRON_RUN_AS_NODE TMPDIR=/Users/aston/.hermes/profiles/daedalus/cache/scratch ./node_modules/.bin/electron scripts/ingest-readings-export-view.mjs

运行 UI 前必须先 package:desktop，且 service-result.json verdict=pass。UI 端口默认9418，拒绝占用；LaunchServices 先启动隔离 userData 再投递真实 open-file。仅结束经 PID/启动参数核实属于本次运行的实例；原用户实例不碰。所有新产物在 docs/evidence/ingest-readings/。

## 夹具及诚实边界

manifest.json 是外部输入的验收夹具，不是产品识别结果，也不是用户本人已核对的声明。实现代理查看渲染页转录了第3页左栏底部三条尺寸（page3.png 可复查）：L1=30(0/-0.2)、L2=5(0/-0.1)、L3=43(+0.2/0) mm。三条输入中 L2 故意报50，其余原值。元件公式 L3-L1-L2、20/32/12.05隔套几何和8..8.5闭区间是独立合成工程条件，绝不冒充论文事实。

扫描PDF逐字节读取自 agent/ocr-scanned 的已提交样本，复制到本任务 fixtures/，SHA-256=1c846ad52f571a5458518dde87615276766929e373ebf754b1098a30cc538b8f。只读样本，不合OCR分支、不改OCR代码。pdfjs逐页实测5页文本项均0。

没有seedFile时调用产品createIntentProjectSnapshot建立项目，随后真实source:import；setup三类工具经真实服务录入支持事实，不能私改快照。seedFile可选，用于复跑其他已编码项目；PDF项目需明确mapping。

脚本先将三条读数经真实AgentToolService.run('ingest_readings')放入同一草稿，批量拒绝、未确认plan/apply拒绝；经ExtractionService逐条确认后尝试提交，固定条款拒绝10倍错误。随后只把L2按扫描真值5重新喂入（新statement），旧确认失效，重新逐条确认、预览、授权、提交。读回真正提交文件核验真值与agent-read出处。没有改判据或放宽条款来迁就错值。

SVG和R12 DXF经真实drawing IPC + DrawingExportStore导出。只替换原生路径选择器；读回字节核对哈希、页码、提供人。export-view只渲染此实际SVG并截屏，不手写图纸、不注入来源文字。

## 证据边界

完整事务是服务阶段真实产品链路（含磁盘保存与读回），UI阶段不是第二次纯UI从ingest到commit：打包应用打开服务生成的pending容器，实点三次单条确认；新隔离进程打开committed容器拍工程图。

批量拒绝截图是实际preload IPC拒绝后页面，错误码在ui-result.json/batch-rejected.json；不向DOM伪造错误提示。直接提交无授权拒绝只证明批准门禁，不能代替未核对门禁；后者由plan/apply独立证明。

M46/M47/M48脚本逐一改真实目标，要求非零且有AssertionError，不把编译失败算杀死；finally恢复后要求16条核心测试全绿。六门禁、build、package、real-docs分别落日志并记录退出码到gates.json。

未覆盖：原生保存对话框的辅助功能操作、真实DeepSeek联网调用、真实PDF打印路径。当前桌面无图片库，image证据结构和领域校验可用，桌面接收image明确拒绝UNSUPPORTED_SCOPE；不把无法核验图片当合法输入。
