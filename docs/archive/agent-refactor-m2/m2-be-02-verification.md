# M2 BE-02 异步预览与证据验收

验收工作树为 `/Users/aston/DSH/wt/gpt-agent-refactor-m1-entry-20261123-1948`，分支为 `agent/gpt-agent-refactor-m1-entry-20261123-1948`。环境为 macOS arm64、Node.js 26.12.1 和 Replicad OpenCascade.js 1.2.1。验收沿用 [BE-01 引擎结果](m2-be-01-verification.md) 与 [M0 几何运行时及上游资料索引](../agent-refactor-m0/geometry-runtime-verification.md)。

## A07 任务书、澄清与重算

| 输入与动作 | 可重放证据 |
| --- | --- |
| 导入归档的 `mounting-plate-taskbook.pdf` | SHA-256 为 `d455a7fa1d91741ec94b14ff6b4a63036b6d09f5e75a6c506875dd8d063b9c42`。检查五项均通过。MP-03 定位到第 1 页，阈值 ≥13 mm。MP-05 定位到第 2 页，阈值 ≥1.5 mm。两项均返回变量输入与关联的特征和标注编号。 |
| 两页 PDF 变体 | MP-02 缺少孔中心坐标基准，标为 `needsClarification`。MP-04 的 9 mm 厚度与 MP-01 的 8 mm 矛盾，标为 `conflict`，证据同时返回两页。MP-06 平面度标为 `uncovered`。 |
| 补齐基准，再纠正板厚为 8.5 ±0.2 mm | 回答与原文分页引用分别保存。重复提交同一回答返回原回执。重算后图纸标注为 8.50 mm，MP-05 显示 [1.2, 1.8] mm 并失败。MP-06 仍未覆盖，模型状态为草稿。 |
| 同一文件绑定下重开管线 | 从原 PDF 重读来源，从草稿清单恢复纠正记录，得到同一 `draft-3`、模型指纹和条款状态。 |

## A08 快模型、慢图纸与重试

1. 基准 `draft-1` 完成，其图纸可作为后续失败时的上一有效版本。
2. 右孔沿局部 X 移动 +1 mm，`draft-2` 发布 `model_ready` 与 `checks_updated`。测试阻塞图纸并取消该任务，再释放晚到的旧 worker 结果。该修订没有发布图纸或完成信号。
3. 连续第二次移动 +1 mm 后，`draft-3` 的 MP-03 区间为 [12.75, 13.25] mm，判为失败。测试注入非法投影约定，触发带 `projectionFailed` 原因的 `drawing_failed`。快照中模型是 `draft-3`，保留的有效图纸是 `draft-1`。
4. 用同一个重试请求重复调用图纸重试。实体 worker 累计仍执行三次。最终图纸与模型同为 `draft-3` 且指纹相同，发布 `drawing_ready` 和 `task_completed`。快照包含真实三角网格与主、俯、侧三视图的矢量数据。

## 生产接线

- 来源导入经现有 `sourceImport` 校验、写入项目会话并保存恢复快照后触发预览接线。打开项目后也可从已获授权文件会话的有效附件恢复。解析前对 PDF 字节复核 SHA-256，发布前复核附件版本。草稿清单按已验证文件绑定保存，记录原 PDF 引用、回答或纠正及右孔的整数位移。
- 桌面模型 API 对话复用 M1 连接、文件绑定和写入授权。识别出安装板任务书后，现有对话入口可调用类型化的右孔 X 轴位移，经草稿校验和请求去重后启动 `buildAndCheck`。隔套对话沿用原工具及契约。
- `buildAndCheck` 回传任务 ID。实体和投影分别在可取消 worker 中执行。每次发布验证活动任务、已授权文件、修订和当前 PDF 来源，订阅按项目、调用方主 frame 及订阅令牌投递。撤权、导航、渲染进程退出与会话切换清理活动管线。
- 公开 IPC 有 `getM2PreviewSnapshot`、`locateM2Evidence`、`retryM2Drawing`、`submitM2Clarification` 和 `subscribeM2PreviewEvents`。推送和取消订阅是这组方法的内部传输通道。原 `locateEvidence` 契约沿用。Vite 生成独立 worker，Forge 将其及运行时依赖落在 `app.asar.unpacked/.vite/build/m2-worker`。

## 改动清单

| 文件 | 改动 |
| --- | --- |
| `desktop/main/project-agent/m2/pipeline.ts` | 异步任务、取消、草稿、检查、证据、独立图纸重试与事件。 |
| `desktop/main/project-agent/m2/requirements.ts` | 真实 PDF 文本和页码、安装板条款解析、分类与澄清。 |
| `desktop/main/project-agent/m2/draftStore.ts` | 文件绑定下的草稿清单与校验、同目录原子替换。 |
| `desktop/main/project-agent/m2/channels.ts` | 五个 IPC 的入参守卫、授权、事件投递与内部变更端口。 |
| `desktop/main/project-agent/m2/engine.mjs`、`engine.d.mts`、`worker.mjs`、`evaluate.mjs`、`model.mjs` | 拆分实体与投影执行，支持打包后的 worker 位置。 |
| `desktop/main/geometry-prototype/plate.mjs`、`vite.main.config.ts`、`forge.config.ts` | 复用实体内核并生成、布置 worker 与 WASM 资源。 |
| `desktop/main/index.ts`、`sourceChannels.ts` | 安装 M2 IPC，将经验证的来源和生命周期连入任务管线。 |
| `desktop/main/project-agent/m1LocalAuthority.ts`、`m1ModelApi.ts`、`m1WorkbenchChannels.ts` | 复用文件绑定、写入权限、作用域代际和桌面对话变更入口。 |
| `desktop/shared/contracts.ts`、`desktop/shared/project-agent/m2-preview.ts`、`desktop/preload/index.ts` | 对齐冻结的前端桥字段和结果信封。 |
| `desktop/tests/projectAgentM2Pipeline.test.ts`、`desktop/tests/preloadContract.test.ts`、`src/pages/DesktopWorkspace.test.tsx` | A07/A08、真实证据定位、五个方法的 preload、主进程与 sender 守卫覆盖，以及工作台 mock。 |
| `docs/agent-refactor-m2/m2-be-02-verification.md` | 验收记录。 |

## 命令与结果

| 命令 | 退出码 | 计数 |
| --- | ---: | --- |
| `npm run test:desktop -- desktop/tests/projectAgentM2Pipeline.test.ts desktop/tests/preloadContract.test.ts` | 0 | 2 文件，9 通过 |
| `npm run typecheck` | 0 | app、node、mcp 三个 TS 项目 |
| `npm run typecheck:desktop` | 0 | desktop TS 项目 |
| `npm run lint` | 0 | 无诊断 |
| `npm run test:mcp` | 0 | 3 文件，23 通过 |
| `npm run test:desktop -- desktop/tests/projectAgentM1*.test.ts desktop/tests/projectAgentM2*.test.ts desktop/tests/projectAgentCompatibility.test.ts desktop/tests/preloadContract.test.ts desktop/tests/mountingPlateTaskbook.test.ts` | 0 | 21 文件，171 通过 |
| `node --test desktop/tests/projectAgentM0.node.mjs` | 0 | 28 通过 |
| `npm test -- src/pages/DesktopWorkspace.test.tsx` | 1 | Vite 拒绝符号链接依赖目录内的 PDF worker，测试未运行 |
| `npm run test -- --config out/m2-be-02-vitest.config.mts src/pages/DesktopWorkspace.test.tsx` | 0 | 1 文件，53 通过 |
| `git diff --check` | 0 | 已跟踪差异 |
| Vite 生产构建、生成的 worker 运行及临时 ASAR 解包布局运行 | 0 | 两处均测得 30,743.36293856409 mm³，独立出图均生成 9 项标注 |

完整桌面套件曾有一次并发运行因 M1 原生 socket 锁报 `LOCAL_ENDPOINT_BUSY`（退出 1，170 通过、1 失败）。独立重跑通过。工作台临时配置按 [M1-D 的共享依赖目录配置](../agent-refactor-m0/m1-be-02d-report.md) 复建，位于忽略的 `out/`。

## 验收范围

本次验证了安装板文本 PDF 的约定格式、西文数值和已支持几何。图形化 PDF、通用 OCR 及任意工程句式仍待验证。进程重开从输入清单重新生成模型与图纸，运行中的任务和历史产物保留在当前会话。真实签名安装包、真实 Electron BrowserWindow 与独立前端工作树的并排联调、真实模型供应商和外部 MCP 的安装板端到端变更仍待验证。正式版提交与 M3 留在后续阶段。
