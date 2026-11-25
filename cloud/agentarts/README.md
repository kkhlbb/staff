# AgentArts 编排接入

采用外置 ECS 引擎，由 AgentArts 管理模型、编排与确认。平台账号、真实远程工具接入、网关策略及人工节点在本次交付中未实测。以下文件可供手工配置和粘贴，服务协议已在本地跑通。

## 导入步骤

1. 按部署文档启动 HTTPS 服务。为四角色和工作流分别生成密钥，参考 `roles.json` 配置 `CUNLIAN_KEYS`。该文件是权限清单，不是 AgentArts 原生导入包。人工接管密钥单独保存，须启用 `write` 和 `takeover`。
2. 在平台工具管理中登记 HTTPS `/mcp`，选择 Streamable HTTP，按身份注入 Bearer 或 X-API-Key。若使用旧版 HTTP+SSE，登记 `/sse`，消息投递使用流返回的 `/messages?sessionId=…`。为网关配置角色对应的 REST ACL。验证初始化、工具发现和一个实际调用，再保存连接。
3. 建立四个角色，粘贴 `prompts.md` 的对应提示词。只绑定清单列出的工具。上传 `knowledge.md` 和获授权的受控参考文件。
4. 按下列顺序编排，工作流状态至少保存 `projectId`、`baseRevision`、`draftRevision`、`writerEpoch`、`checksetFingerprint`、证据和交付件路径。分别验证正常、检查打回、租约冲突、旧指纹和人工超时。
5. 确认操作交给受信人工审核代理。该代理使用写入方身份完成审核和提交，工程密钥和人工确认密钥均从秘密存储读取。模型节点仅观察状态。

## 工作流

1. **连接探针**。工作流调用 `capabilities`，按角色调用 `authorizeProject`。模型网关受允许时，以 REST 模型探针验证工具调用和工具回执。
2. **解析**。将附件路径传给需求解析 Agent。路径使用 `/api/v1/projects/{projectId}/attachments/{attachmentId}`。在用户确认缺项后分配给设计角色。
3. **建模**。设计角色检查当前草稿状态和租约，写入草稿。409 回到状态同步或人工接管。
4. **出图和检查**。隔套使用 MCP `render_drawing` 时指定 `outputDir: "/exports"`，返回的工件由同身份下载。安装板使用 REST 读取工程图和检查。失败按条款回到设计，缺输入回到解析。图纸随草稿更新。
5. **人工确认**。向人展示同源 `/review/{projectId}/{draftRevision}` 入口、草稿、指纹、检查及证据。部署未装载前端时，由受信审核代理呈现审核 REST 数据。确认代理取得短时凭据后提交，工作流轮询提交状态或验证签名回调。旧指纹返回审核，重新展示并确认。
6. **报告与撤租**。报告角色使用 `/api/v1/projects/{projectId}/archive` 作为 `describe_project` 的虚拟路径，引用正式修订号和可下载的同源图纸。设计身份在编排结束后撤租。

所有 15 个工具合计分配给四角色、工作流控制和人工接管。编排控制与接管是独立凭据用途。
