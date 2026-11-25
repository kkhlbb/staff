# 寸链后端 M0 · 本轮实测与任务卡

2026-11-23，`agent/gpt-agent-refactor-m0`，基线 `61d8c435b220cea95c3b06f5435bdf81a6a8dbf9`。本机 macOS 26.4 (25E246) arm64、Node 26.12.1、npm 11.20.0。M0 门槛仍待满足。

| 任务 | 本机 Node | 候选 arm64 包内 Electron | 独立读回 |
| --- | --- | --- | --- |
| B1 旧项目与独立草稿 | 六份归档用产品编解码器核对 SHA-256、正式版本和草稿尺寸 | 未运行，Forge 启动失败 | 项目夹具由既有编解码器读取 |
| B2 旧五工具与一维 q | 真实 MCP stdio 五工具均无错误；A10 四组结论保持通过、通过、失败、边界通过 | 未运行 | 不适用 |
| B3 契约与门禁 | 原 14 项加 1 项幂等隔离通过；共享事件复现 1 项 TODO | 未接线、未运行 | 不适用 |
| B4 A01 精确板件 | 实体、STEP 输出及同绑定新实例读回已测 | 未运行 | 原生 OCP 未找到，独立几何读回未运行 |
| B4 A05 / A06 法向变化、接触、重叠 | 0° 和世界 X 轴 +90° 两种姿态均实测 | 未运行 | 两种姿态均由同一套 WASM 量测，独立路径未运行 |

## 锁定依赖与打包

- `main-integration` 和 `release-042` 的锁文件与本工作树一致，未见可用安装树。`staff` 有安装树和 Electron 45.2.3，但锁文件不同，平台适用项中有 21 项版本或完整性不符，包括缺失 Replicad。未复制其他工作树的安装树。
- 唯一一次正常 `npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=15000 --cache <新建独立缓存目录>` 退出 1。实际请求 `registry.npmjs.org/zod-validation-error/-/zod-validation-error-4.0.2.tgz` 返回 `getaddrinfo ENOTFOUND`，停止网络安装路径。
- 从本机 npm 内容缓存按当前锁文件的完整性哈希定位、重新验哈希并解包适用 darwin/arm64 的 386 份 tarball 到工作树，重建包声明的 bin 链接。386/386 命中，0 项来自其他工作树。未执行生命周期脚本。*这是一棵用锁定内容恢复的源码测试树，npm ci 本身没有成功。*
- 缓存中有 44.9.3 和 45.2.3 的 darwin-arm64 ZIP。锁定 45.2.3 ZIP 与 npm 包内校验表一致，SHA-256 为 `4d7c429064087a47b855d9bd06c76ead4819b7f02b385de232d4a5c37ecef55f`。
- `ELECTRON_ZIP_DIR=<已校验的缓存目录> npm run package:desktop -- --arch=arm64` 退出 1。包装脚本调用 `node_modules/.bin/electron-forge` 时返回 `spawnSync … EACCES`。缓存恢复出的 CLI JS 是普通 0644 文件，bin 链接指向该文件。按本轮权限约束停止该路径，未更改模式，未从其他入口绕过启动限制。日志在 `/private/tmp/cunlian-m0-package.log`。未生成候选包。

## 上轮契约审查

逐项核对严格对象结构、整数 q / 右手基校验、项目与草稿过滤、序号去重和快照重取、取消封口、尝试号过滤、两级 CAS、确认绑定与必需检查集。已交接五个共享文件及两份历史文档均与交接清单哈希一致。前端和共享 DTO/导出未改。

- `guards.ts` 将认证 `userId` 纳入回执索引。同一项目、调用方 ID 和幂等键在不同认证用户下原先可能命中同一份回执。回归隔离了回执命名空间。写入令牌本身仍由未来服务负责按认证身份生成和绑定，当前规则未接真实 IPC 或持久化事务。
- 安全相关待协调项。共享 reducer 接受相同 `inputFingerprint` 配不同 `inputs.geometry` 的 `jobChanged`，会替换活动任务的输入同时保留旧产物。复现用例把原点从 `[0,0,0]` 改为 `[0,0,1]`，现行实现触发预期断言失败，标为 TODO。提交门禁本身另核对清单与任务完整输入。建议双方确认生产端从规范化完整输入重新生成指纹、同 job 冻结输入，以及接收端在冲突时重取快照的行为，再协调共享运行时更新。

## 精确几何与量测

- 窄版参考为 `vendor/step-narrow-v1/spacer.cpp`、`spacer.wasm` 与 `desktop/main/cad/step-worker.cjs`。本机编译 WASM 并枚举导出，唯一业务函数为 `spacer_step`，其余为 memory、table 与 Emscripten 运行时辅助。C++ 的圆柱差集、闭壳校验、精确体积及 STEP 写读均封闭在三参数隔套入口内，未见板坯、通用布尔、变换或对外量测 ABI。现有 `stepKernel.test.ts` 仍通过。
- 板件参考为从锁文件恢复的 `replicad-opencascadejs@1.2.1/dist/replicad_single.d.ts`、CJS glue 和 WASM。运行时加载导出并实际调用 `BRepPrimAPI_MakeBox`、`BRepPrimAPI_MakeCylinder`、`BRepAlgoAPI_Cut/Common`、`BRepGProp.VolumeProperties`、`BRepBndLib.AddOptimal`、`BRepAdaptor_Surface`、`gp_Trsf`、`BRepBuilderAPI_Transform`、`STEPControl_Writer/Reader`。WASM SHA-256 与实际变换矩阵见 [测量回执](geometry-evidence/measurements.json)。建模使用 mm，夹具输入用整数 q。
- A01 板坯 `80×50×8 mm`、`32000 mm³`。两次圆柱切除后，B-rep 有效且为单实体，包围盒仍为该尺寸。圆柱面轴线平行 Z，XY 中心为 `(20,25)`、`(60,25)`，半径 5 mm，沿 Z 跨越 0–8 mm。净体积 `30743.36293856409 mm³`。导出的 [A01.step](geometry-evidence/A01.step) 在新 WASM 实例转移一个根实体，读得同一包围盒、孔位和 `30743.36293856405 mm³`。该读回使用同一 OCCT 绑定，外部读回待做。
- A05 盖板覆盖安装板完整 XY 投影，延伸 1 mm。板厚和盖板底高的名义及两个极限组合分别构造精确实体。两件施加同一内核变换，局部 +Z 法向也由内核变换。在实际平面上取点投影到有向法向，以盖板下平面投影减去安装板顶平面投影。0° 和 +90° 的名义均为 2 mm，区间实测 `[1.700000000000001, 2.3] mm`。Z=8 时接触且交叠体积为 0，Z=7.9 时有符号间隙约 −0.1 mm，交叠体积约 `384.2920367320496 mm³`。
- 沿用调查登记的线性绝对误差 `1e-6 mm`、体积绝对误差 `1e-3 mm³`、单位向量分量 `1e-9`。OCCT `Precision.Confusion()` 实测 `1e-7 mm`，用于接触分类。布尔调用使用内核默认设置。测试中的解析期望值用于比对，实测来自精确 B-rep。样机按几何类型和法向识别面，未实现生产稳定拓扑、投影、网格或任务书驱动流程。

## 命令与退出码

| 命令 | 退出码 | 实测结果 |
| --- | ---: | --- |
| `node --test desktop/tests/projectAgentM0.node.mjs desktop/main/geometry-prototype/plate.test.mjs` | 0 | 19 通过，1 TODO 已复现，0 非预期失败。19 项含原 Node 14、回执隔离 1、几何 4 |
| `npm run test:desktop -- desktop/tests/projectAgentCompatibility.test.ts` | 0 | 11 通过 |
| `npm run test:desktop -- desktop/tests/{projectAgentCompatibility,draftSyncTransactions,draftSyncLegacy,projectService,projectChannels,stepKernel}.test.ts` | 0 | 6 文件、40 通过，含上述 11 项 |
| `npm run test:mcp` | 0 | 3 文件、22 通过 |
| `npm run mcp:smoke -- --log <隔离目录>/frames.ndjson --out <隔离目录>/artifacts` | 0 | 1 个真实 stdio 子进程、5 工具均无错误 |
| `npm test -- src/domain src/project-file` | 0 | 16 文件、219 通过 |
| `npm run typecheck`、`npm run typecheck:desktop`、`npm run lint` | 各 0 | 通过 |
| `npm run build` | 0 | 通过，Vite 报有压缩前超过 500 kB 的分块 |
| `node desktop/main/geometry-prototype/run.mjs /private/tmp` | 0 | 生成 STEP 和 JSON，本次归档同一次执行的文件 |
| `python3 -B -c 'import OCP; print(OCP.__version__)'` | 1 | `ModuleNotFoundError: No module named 'OCP'`，只读检查的目录无独立 OCP 环境 |

未运行全库 Vitest、全量桌面回归、桌面 E2E、真实 API 和双入口联验。未执行包内旧项目读取、包内 A01/A05、干净用户目录与含空格安装路径验收，以及独立几何读取。窄版隔套原生读回脚本采用另一套判据，当前不能直接验板件。

## 上轮登记的后续工作块

1. 提供由正常安装流程生成、带可执行 npm bin 的锁定依赖树，或协调在权限允许的环境中恢复安装。用已校验的 Electron ZIP 生成候选 arm64 包，从隔离目录用夹具副本验证旧项目、独立草稿和重开行为。
2. 如继续选择 Replicad，最小包外资源目录包含锁定的 `replicad_single.cjs`、`replicad_single.wasm`、打包后的独立几何 worker 入口（含 q 转换）及运行时 SHA-256 清单。验收夹具可在测试时独立传入。启动时从 `process.resourcesPath` 解析并校验资源。变更需协调现有封装断言，当前 `assert-packaged-step.mjs` 明确排除 Replicad，同时需要对 LGPL 源码供应、许可、SBOM 和资产白名单重新评审。本轮未改打包配置和断言。
3. 提供可用的独立几何读回环境，例如已存在的原生 OCP 解释器路径，及带页码的安装板和盖板任务书 PDF 与指纹。用同一候选包完成 A01/A05 实测，分别归档包内和独立读回证据，再复核 M0 门槛。

## 本轮修复与离线准备

仍在 `agent/gpt-agent-refactor-m0`。B3 原 TODO 已转为通过的原点回归，另覆盖右手坐标轴旋转、坐标系标识、建模容差、显示精度、四种版本输入、指纹变化、几何单位校验、对象键和步骤重排，以及快照重取和并发迟到回包。完整输入比较使用现有严格 DTO 和提交门禁 `guards.ts` 的规范化比较作为参考。事件冲突使当前产物失效并暂停在冲突前游标。活动快照也校验清单的完整输入。各 kind 的尝试独立过滤，历史状态回包按整条观察处理。DTO、版本、公开导出、能力开关和旧工具/q 域未改。前端需同步 `desktop/shared/project-agent/events.ts`，配合 [共享契约的重连说明](backend-contract.md#完整输入绑定与重连) 核对快照接纳、当前产物展示及完成门控。共享文件之外的改动均属于后端验证和文档。

在现有几何样机旁增加本机资源准备和 Node worker 探针。参考为锁定 npm 发行件的 `replicad-opencascadejs@1.2.1/package.json`、`dist/replicad_single.cjs`、同目录 ESM glue 和 WASM，以及本机 Vite 8.3.5 的 `build` API 类型定义、Node 的 `node:worker_threads` 与现有隔套的哈希校验方案 `scripts/step-assets.mjs`。Vite 只在内存构建单个 worker，复用原样机和 q 转换。准备脚本为每次运行新建暂存目录，保留原始 `package.json` 的 ESM 模块语义、LICENSE、`dist/replicad_single.{cjs,js,wasm}` 的目录关系。CJS 入口动态导入旁边的 JS，初始化时 `locateFile` 指向该目录的 WASM。离线探针在启动 worker 前校验准备回执的清单摘要和文件 SHA-256，另核对五个上游文件的固定 SHA-256。清单用于完整性校验，包内仍需确定可信摘要的交付位置。

```sh
node scripts/geometry-prototype.mjs prepare <已有暂存父目录>
node scripts/geometry-prototype.mjs smoke <准备回执中的目录> <准备回执中的manifestSha256>
```

新证据目录为 `/private/tmp/cunlian m0 candidate2 evidence.HH4BCX`。其中 `preparation.json` 给出资源目录及摘要，`worker-measurements.json` 记录含空格路径运行的报告，`worker.log` 为 OCCT 输出。另有同轮开发态 `cunlian-m0-geometry-3ejLJo/{A01.step,measurements.json}`、旧五工具的 `mcp-frames.ndjson` 和输出产物。上轮归档的 `geometry-evidence` 保留。A01 的 worker 名义体积为 30743.36293856409 mm³，STEP 使用同一绑定的全新 WASM 实例读回，体积 30743.36293856405 mm³。A05 两种姿态名义均为 2 mm，范围实测 [1.700000000000001, 2.3] mm。A06 仍记录接触和 0.1 mm 轴向重叠。当前 WASM 字符串证据只支持 OCCT 8.0 系列，8.0.1 补丁版本待由有来源的构建链确认。上游 `BRepBndLib.AddOptimal` 采用数值容差，包围盒按登记允差判断。A05 使用有向法向上的面投影差作为有符号间隙，最短距离仅能提供无符号距离信息。

| 本轮实测 | 结果 |
| --- | --- |
| Node 契约及几何测试 | 36 通过，0 失败，0 TODO。其中事件/契约 28、开发态几何 4、暂存资源与 worker 4 |
| 桌面兼容、草稿、项目通道及隔套定向回归 | 6 文件、40 通过 |
| MCP 回归和 stdio smoke | 3 文件、22 通过，额外真实 stdio 运行的 5 个工具全部成功 |
| q 域及项目文件回归 | 16 文件、219 通过 |
| 类型检查、桌面类型检查、lint | 各自退出 0 |
| 普通 `npm run build` | 退出 0。Vite 报有压缩后超过 500 kB 的分块 |

## 后续协调与 M0 门槛

- 包装协调需要独立确定 `process.resourcesPath/geometry-prototype` 的资源定位、Electron worker 运行时兼容、可信摘要入口、对实际包成员的单独审计以及上游资产、许可和 SBOM 条目。保持 `step-narrow-v1` 独立，保留 `assert-packaged-step.mjs` 对 `app.asar` 内 Replicad 成员的拒绝规则。由包维护方评审如何将外置资源纳入明确清单并运行包内 smoke。本轮打包配置、隔套 vendor 和打包断言均保留原样。
- Forge 权限仍待用户答复，本轮未启动 Forge。目标 arm64 安装包读旧项目及独立未提交草稿、包内 A01/A05、干净用户目录与含空格的实际安装路径均待验收。独立几何读回环境和带页码的板件任务书及指纹仍待提供。Node 探针为同绑定读回，包内及独立证据应分别留存。
- 发布门槛仍包括 LGPL 对应源码、重链或替换方案、许可证及 SBOM 审查。生产接线及跨重启输入冻结仍需由后续服务实现。M0 新能力仍全部为 `false`。
