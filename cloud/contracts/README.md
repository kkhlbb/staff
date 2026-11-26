# 寸链 M0 云端契约

- `openapi.json` 冻结 OpenAPI 3.1.1。REST 路径使用 `/api/v1`，`/healthz` 公开。受保护路径支持 Bearer 或 X-API-Key，并沿用连接授权及单写入方租约。二进制上传用 multipart，网格返回 JSON 数组，图纸返回原始 SVG 或 DXF。
- `mcp-tools.json` 冻结 `/mcp` 的 15 个工具。每项 `outputSchema` 描述成功响应中的 `structuredContent`，工具错误沿用本地 `isError: true` 和文本载荷。只读工具与 `mcp/server.mjs` 一致，项目授权及草稿入口对照 `cunlian-local`。路径参数保持本地签名，远程宿主应将它们解析到调用方获准的服务端输入和导出目录。`render_drawing` 可创建导出文件。正式提交入口是 REST 审核确认。
- `FEATURE_3D_ASSEMBLY_M1` 默认关闭。关闭时服务仅提供固定安装板及隔套场景。启用后才能开放 STEP 和装配能力。项目文件可以独立持久化装配数据。
- 提交需要授权写入方和单次人工确认凭据，并核对项目 ID、基准版本、草稿修订号及检查集指纹。成功提交后可按草稿修订号轮询提交状态。可选 HTTPS Webhook 在落盘后发送，接收者可按项目 ID 与正式修订号去重。
- Schema 11 沿用 formatVersion 2 和 SHA-256 校验。STEP `attachmentId` 对应项目级 `stepAttachments[].id`，该 ID 通过 `blobKey` 绑定已验证的字节。历史中的 STEP 引用也保留字节。归档校验不解析 STEP 几何。
- Nominal transform 为行主序齐次 4×4 矩阵，平移单位 mm，STEP 实体索引从 0 开始。3-2-1 的六个接触对按 3 个主基准、2 个次基准、1 个第三基准排序。长度输入与极值判定使用安全整数 q，1q = 0.0001 mm。统计参考使用浮点 q，并单独保留分布、样本、种子和假设。
- `AssemblyModelV1` 与 `EvidenceRef` 的 OpenAPI 结构来自项目文件 Zod 契约。引用解析、ID 一致性及其他跨字段校验由项目文件解析器执行。MCP 只读工具继续返回各自的历史证据投影。

参考规范：[OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html) · [MCP Tools 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)

## M3 GD&T 契约

- `mcp-gdt-tools.json` 冻结 `stage_datum`、`stage_gdt`、`analyze_gdt_stackup` 的输入与输出。启用 `FEATURE_3D_ASSEMBLY_M1` 且宿主实现对应操作后才注册这些工具和开放对应 REST 接口。
- 两种 stage 按 ID 批量写入草稿，每项附带至少一条现有 `EvidenceRef`。宿主核对项目授权、租约持有方及 epoch、基准版本、预期草稿版本和幂等键，再原子地生成新草稿。人工审核继续使用该项目、基准版本、草稿修订号和检查集指纹绑定的单次确认凭据，通过现有 REST commit 入口正式提交。
- `analyze_gdt_stackup` 使用租约绑定的草稿版本和明确的采样参数调用求解器。What-If 公差与实体条件修改仅用于试算，返回基线和试算结果，使用相同采样参数。结果供人工审阅。
- 项目文件对当前和历史记录使用相同的兼容解析，保留 v0.6.0-beta 允许的基准数量、原始修饰符和历史结果。新增或编辑框格须调用 `gdtFeatureControlEditSchema`，并在当前装配中核对特征和基准引用。项目文件与编辑解析都会校验新增尺寸偏差上下界及基准修饰符数量。JSON Schema 描述结构和框格基准数量，宿主负责跨字段和引用校验。
- 对当前拓扑中未建模为尺寸要素的特征或基准，MMC/LMC 产生 `ILLEGAL_MODIFIER`，求解采用有效条件 RFS。评审保留草稿中请求的原始条件与工程告警。

## M4 柔性契约

- `mcp-compliant-tools.json` 冻结 `stage_physics`、`import_mic_matrix` 和 `analyze_compliant_stackup`。启用 `FEATURE_3D_ASSEMBLY_M1` 且宿主实现相应操作后开放工具和 REST 路径。
- 两种写入均核对项目授权、活动租约持有方、`expectedWriterEpoch`、`baseRevision`、`expectedDraftRevision` 和幂等键。空的预期草稿版本表示调用者预期当前没有草稿。`stage_physics` 替换草案中明确传入的字段，数组字段整体替换；空数组清空该字段。宿主必须逐个核对材料、载荷、翘曲、温差等新增或变更输入所对应的非空 `EvidenceRef`，并验证装配中的零件和特征引用。证据按相对 `physics` 的 JSON Pointer 绑定，例如 `/materials/0/youngsModulusMpa`。直接设置 MIC 引用走 `import_mic_matrix`。
- MIC 导入将结构化 JSON 编码为 UTF-8，使用实际存储字节计算 SHA-256。宿主校验 payload、矩阵维度和当前草稿中的 `partId`，在同一次草稿更新中保存附件、引用及来源证据。回执中的 `attachment.revisionId` 对应 `micMatrixAttachments[].id`，同时也是 `physics.micMatrixRef` 的值。对应的 MIC 字节必须与 ZIP manifest 及 blob 元数据中的 SHA-256 一致。既有 Schema 11 记录中的裸 `micMatrixRef` 按原样保留。
- 写入回执给出新草稿修订号。宿主的审核检查集指纹必须绑定该草稿的柔性参数、出处与 MIC 哈希。人在审核页检查该版本和证据后，现有 REST commit 入口核对项目、基准版本、草稿修订号、检查集指纹和单次确认凭据，再正式提交。工具请求均无确认凭据字段，草稿变化使旧审核确认失效。
- 分析读取租约绑定的草稿，使用相同采样参数和抽样对比刚体与柔性结果。缺少 `physics` 时按纯刚体处理，`enabled` 省略时有非空柔性模型或 MIC 引用即默认启用，显式 `false` 关闭柔性。试算仅影响本次分析。柔性贡献与 GD&T 使用同一方差占比口径和分母，位移场使用 mm。外置 FEA 的 `FeaSidecarStatus` 仅描述可选本机求解器的探测结果。
