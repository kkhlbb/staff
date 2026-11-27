# 用户修改库、替换与调试指南（`v1.0.2` 统一 OCCT 7.8.1 XCAF WASM）

本文件说明用户依据 LGPL-2.1 修改 Open CASCADE Technology (OCCT) 7.8.1 库、重编译并替换寸链运行时 WASM 内核的受支持路径与安全边界。

## 一、用户权利声明

- 寸链自身代码遵循 MIT 许可（见根目录 `LICENSE`）；OCCT 7.8.1 遵循 LGPL-2.1-only 及 OCCT LGPL Exception。
- 本应用不以任何条款禁止用户为自用修改 OCCT 源码、重新编译/重链接，以及为调试这些修改而进行逆向工程。

## 二、路径 A：不重编应用，通过本地 WASM Opt-In 加载修改版内核

默认运行资源位于外置目录 `occt-unified/` 并受严格 SHA-256 校验保护。如需在已安装的应用上运行自行编译的兼容 `cunlian_occt.wasm`，可在启动主进程前同时设置三项环境变量：

```bash
CUNLIAN_STEP_LOCAL_OPT_IN=1 \
CUNLIAN_STEP_LOCAL_WASM="/abs/path/to/your-modified-cunlian_occt.wasm" \
CUNLIAN_STEP_LOCAL_SHA256="<该文件的小写64位SHA-256>" \
env -u ELECTRON_RUN_AS_NODE "/Applications/寸链.app/Contents/MacOS/寸链"
```

### 安全与契约边界

- **显式用户同意**：三项环境变量由主进程启动时捕获，不允许 renderer、模型或 MCP/IPC 参数指定本地内核路径；缺任一项、非绝对路径或摘要格式不合法均直接拒绝，**不静默回退到默认内核**。
- **仅允许替换 WASM**：固定随包的 `cunlian_occt.mjs` 与 `step-worker.cjs` 仍先逐项严格校验哈希，不接受用户自定义 JS/CJS/worker 路径。
- **有界安全读取**：主进程使用 `O_NOFOLLOW`/`O_NONBLOCK` 经同一文件描述符校验普通文件与体积范围（8 B – 64 MiB）及用户声明的 SHA-256，仅向一次性 worker 传入校验后的字节快照。
- **ABI 与资源限制**：worker 再次核验摘要、编译验证、检查导入/导出签名兼容，并强制单非共享 32 位内存（最大 <= 8192 页 / 512 MiB）与受限 `funcref` 表（最大 <= 100 万项）；V8 worker 限额 256/32/4 MiB，30 秒超时，单任务并发，16 MiB STEP 输出上限。此限制不是 OS 级进程沙箱，请勿加载不受信任的二进制文件。
- **回执标识**：本地替换模式下回执会明确标注 `local-wasm-opt-in` 与实际运行的 `wasmSha256`，保留全部几何与安全断言。

## 三、路径 B：从 OCCT 7.8.1 源码重编译并更新默认随包资产

完整可重现构建指南见 `vendor/occt-unified/SOURCE.md` 与 `scripts/occt-wasm-build/README.md`：

1. 获取本仓库源码与固定 OCCT 7.8.1 归档（`V7_8_1` / `bd2a789f15235755ce4d1a3b07379a2e062fdc2e`，SHA-256 `7321af48c34dc253bf8aae3f0430e8cb10976961d534d8509e72516978aa82f5`），或在修改后的 OCCT 源码副本上保留修改记录与许可文本。
2. 按 `scripts/occt-wasm-build/reproduce.sh` 使用 Emscripten `4.0.23` 编译新的 `cunlian_occt.mjs` 与 `cunlian_occt.wasm`，并在独立输出目录完成烟测。
3. 如需打包包含修改版内核的自定义应用副本（依据本仓库 MIT 许可）：
   - 将新产物同步至 `vendor/occt-unified/` 并更新 `vendor/occt-unified/SHA256SUMS`；
   - 更新 `desktop/main/cad/stepAssetManifest.ts` 与 `STEP-NARROW-SBOM.cdx.json` 中的对应 SHA-256 与组件说明；
   - 运行验证门禁：
     ```bash
     npm run step:assets
     npm run check:release:step
     npm run test:step-license
     npm run test:step-kernel
     ```
   - 再按 `README.md` 执行多平台打包，并使用 `npm run check:package:step -- <packaged-resources-dir>` 核验成包资源。
