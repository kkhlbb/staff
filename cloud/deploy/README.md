# 寸链云端部署

## ECS

1. 安装 Docker Engine 和 Compose 插件。为 ECS 域名配置 DNS，开放 TCP 80/443。
2. 在仓库根目录执行 `cp cloud/deploy/.env.example cloud/deploy/.env`。用 `openssl rand -hex 32` 分别生成 API、人工确认与可选 Webhook 的密钥。设置 `CUNLIAN_PUBLIC_ORIGIN` 为 HTTPS 域名。
3. 执行 `docker compose -f cloud/deploy/docker-compose.yml up -d --build`，再用 `docker compose -f cloud/deploy/docker-compose.yml ps` 检查健康。
4. 在 ECS 主机运行 Caddy，替换 `Caddyfile` 中的域名。HTTP API 端口仅绑定主机回环地址。网关保留 Authorization 或 X-API-Key、Origin、Accept 与 MCP-Protocol-Version，并对 SSE 禁用缓冲。
5. 执行 `curl -fsS https://域名/healthz`。用 `Authorization: Bearer …` 请求 `/api/v1/capabilities`。从仓库根目录运行 `npm run cloud:smoke` 可在本机启动独立进程跑完整场景。

容器使用 Node 24 LTS 和生产依赖中的 OCCT WASM，多阶段构建会自动编译 `cloud/web` 静态产物（`cloud/web/dist`）并装载至 `/web`。根路径与 `/review/:projectId/:draftRevision` 使用同一入口文件。

## 信任与存储

- 这是单工作区、单写入实例部署。配置中的密钥属于同一个工作区。已配置的身份可按项目 ID 显式调用授权，读写和接管仍分别受身份配置与项目租约限制。不同租户使用独立部署、卷和密钥。用 `CUNLIAN_KEYS` 的 `tools` 字段收窄 MCP 工具范围，并为 Agent 网关配置对应 REST 路由 ACL；保持人工确认密钥只对人或人工审核代理可用。
- Node 仅从 `CUNLIAN_TRUSTED_PROXIES` 中精确匹配的直连 IP 接受 `X-Real-IP` 和 HTTPS 标记。这些头只影响来源校验与审计元数据。建议固定 `CUNLIAN_PUBLIC_ORIGIN`。可信代理须覆盖客户端同名头。代理地址按照 Node 实际观察到的 IP 配置。
- 每个项目的 ZIP 档案、正式修订、草稿、租约、事件、附件、REST 导出和 Webhook outbox 由一个卷内 JSON 状态保存。文件写临时路径、同步后执行原子重命名。MCP 导出按身份存放。备份卷时暂停实例。结构化请求日志输出 JSON，域事件随项目写入，正式提交事件也进入 `.cunlian` 档案。
- 原始上传默认最多 16 MiB（含 multipart 开销）。超时由服务和 worker 共同约束。删除与保留策略由部署管理员管理。
- 本版本加载固定安装板和隔套几何。通用装配和 STEP API 保持关闭。预先拒绝开启尚无 Track B 运行时的配置，避免能力端点或健康探针发布错误状态。
- 模型探针只连接已配置的精确 HTTPS Base URL，发送合成探针与随机回执。未配置时，能力端点返回 `modelConnection: false`。它不会发送项目上下文。

## 审核确认与回调

访问冻结 REST `GET …/review` 获取检查集，明确展示项目、基线、草稿、指纹和检查结果。人确认后，受信审核代理使用当前写入身份和 `X-Cunlian-Approval` 再次获取同一审核资源。服务器在 `X-Cunlian-Confirmation-Token` 返回短期凭据，绑定当前身份、租约 epoch 与检查集。代理把凭据及用户确认的指纹提交到 `POST …/commit`。提交后可在同一路径 GET 查询状态。

对已授权的 HTTPS Webhook URL，正式提交和 outbox 同时持久化。接收方用共享密钥对 `<X-Cunlian-Timestamp>.<原始请求体>` 求 HMAC-SHA256，核对 `X-Cunlian-Signature` 中的 `sha256=<hex>`，并按 `projectId + committedRevision` 去重。失败最多尝试六次，非成功记录留在卷内供排查。

## 参考

[MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) · [Node HTTP](https://nodejs.org/api/http.html) · [Docker 多阶段构建](https://docs.docker.com/build/building/multi-stage/)
