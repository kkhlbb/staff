# 统一 OCCT 7.8.1 XCAF WASM 运行核：资产与边界（`v1.0.3`）

当前正式发布版本（`v1.0.3`）采用统一编译的 **Open CASCADE Technology 7.8.1 XCAF WASM** 内核，取代历史上的 `replicad-opencascadejs`（npm 绑定）与 `step-narrow-v1/spacer.wasm` 窄核过渡方案。架构决策见 [ADR-004-unified-occt-xcaf.md](adr/ADR-004-unified-occt-xcaf.md)。

## 运行时资产与打包位置

- **仓库源码与预编译产物**：`vendor/occt-unified/`（含 `cunlian_occt.mjs`、`cunlian_occt.wasm`、`LICENSE_LGPL_21.txt`、`OCCT_LGPL_EXCEPTION.txt`、`SOURCE.md`、`SHA256SUMS`）与 `desktop/main/cad/step-worker.cjs`。
- **本地准备缓存**：`node_modules/.cache/occt-unified/`（由 `npm run step:assets` / `scripts/step-assets.mjs` 生成并校验）。
- **应用随包外置目录**：`<app>/Contents/Resources/occt-unified/`（macOS）或 `<app>/resources/occt-unified/`（Windows），仅包含经哈希锁定的三项运行时文件及完整许可/SBOM/告知文档：
  - `cunlian_occt.mjs`（SHA-256：`0727731066be7847ab67312f187592db3ee5fe285621cf94cd6baa6aac4eed91`）
  - `cunlian_occt.wasm`（SHA-256：`6cb34be8e7cd73b121618bb8d3900d2950dc1b67043e59c9e499771afaf89282`）
  - `step-worker.cjs`（SHA-256：`389fe39a8dc571247d5a6aa2d3b2cd4789d91f721a84ffe32ac1b8ecb84e0790`）
- 权威哈希清单唯一定义在 `desktop/main/cad/stepAssetManifest.ts`，与 `STEP-NARROW-SBOM.cdx.json`（随包副本命名为 `occt-unified/STEP-SBOM.cdx.json`）逐项一致。打包断言严格拒绝任何未登记的旧内核文件（如 `replicad_single.wasm`、`spacer.wasm`、`spacer.cjs`）。

## 几何能力与进程隔离边界

- 统一 `cunlian_occt.wasm` 覆盖 STEP AP214/AP203 装配导入、XCAF 装配树与几何特征提取、三维构形、2D HLR 矢量工程图投影与 AP214 STEP 导出。
- 隔套 STEP 导出继续保留整数 `q`（`1q = 0.0001 mm`）精度边界与解析几何守卫（单 solid、单闭合 shell、四解析面、圆柱半径、端面平面、体积与通孔点/壁中点距离断言，写 STEP 前与回读后双校验）。
- 运行时隔离约束：
  - 主进程与 worker 每次执行前先严格核验固定资产哈希；仅在启动主进程前由用户显式同时设置 `CUNLIAN_STEP_LOCAL_OPT_IN=1`、`CUNLIAN_STEP_LOCAL_WASM`（绝对路径）与 `CUNLIAN_STEP_LOCAL_SHA256`（小写 64 位摘要）时，才采用用户自选 WASM 的同 fd 有界快照。
  - 默认与本地替换两支均检查实际 WASM 内存与表声明（单非共享 32 位 memory，最大 8192 页 / 512 MiB；单 `funcref` 表有上界且 <= 100 万项），不允许用户替换固定 JS glue 或 worker，且编译/ABI/资源/运行失败不静默回退默认核。
  - 30 秒超时、单任务并发、取消/超时等待真实 `worker.terminate()`、16 MiB 输出上限、会话冻结、原子写入与路径脱敏契约保持不变。此隔离机制不是 OS 级沙箱，不应加载不受信任的二进制文件。

## 对应源码、可重现构建与发布门禁

- **上游固定源码**：Open CASCADE Technology `7.8.1`（tag `V7_8_1`，commit `bd2a789f15235755ce4d1a3b07379a2e062fdc2e`，源码归档 SHA-256：`7321af48c34dc253bf8aae3f0430e8cb10976961d534d8509e72516978aa82f5`）。
- **构建脚本与工具链**：基于 Emscripten `4.0.23` 的可重现构建脚本位于 `scripts/occt-wasm-build/reproduce.sh` 与 `scripts/occt-wasm-build/README.md`，源码溯源说明见 `vendor/occt-unified/SOURCE.md`。
- **机器校验门禁**：
  - `STEP-NARROW-SBOM.cdx.json` 标记 `cunlian:completeness=COMPLETE`、`cunlian:distributionApproval=APPROVED_UNIFIED_OCCT_LGPL_21`、`cunlian:blockers=""`。
  - `npm run check:release:step` 与 `npm run test:step-license` 对随包二进制与全部法律告知文件执行字节级校验，在 `v1.0.3` 发布链路中退出码为 `0` 放行。
