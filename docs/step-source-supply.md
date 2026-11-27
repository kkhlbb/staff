# 统一 OCCT 7.8.1 WASM 对应源码与许可告知供给索引（`v1.0.2`）

本产品（寸链 `v1.0.2`）的 STEP 导入/导出、XCAF 装配特征提取与 2D HLR 工程图能力基于 **Open CASCADE Technology (OCCT) 7.8.1**，经统一编译的 WASM 内核 `occt-unified/cunlian_occt.wasm` 运行。

## 许可边界与用户权利

- **应用边界**：寸链自身源代码、手写 C++ wrapper 与 worker 遵循根目录 `LICENSE` 的 **MIT** 许可；应用 MIT 许可不覆盖或改写第三方组件许可。
- **OCCT 许可**：OCCT 7.8.1 适用 **LGPL-2.1-only** 及 **OCCT LGPL Exception**（完整原文随包提供为 `LICENSE_LGPL_21.txt` 与 `OCCT_LGPL_EXCEPTION.txt`）。OCCT Exception 仅适用于头文件内联/模板材料，不免除库本体的 LGPL-2.1 义务。
- **用户修改、重链接与调试权利**：本产品不以任何应用条款禁止用户为自用修改 LGPL 库、重新链接修改后的库，或为调试这些修改而进行逆向工程。

## 上游固定源码与构建脚本

- **OCCT 官方源码**：[Open-Cascade-SAS/OCCT](https://github.com/Open-Cascade-SAS/OCCT)，固定标签 `V7_8_1`，提交 `bd2a789f15235755ce4d1a3b07379a2e062fdc2e`。
- **源码压缩包 SHA-256**：`7321af48c34dc253bf8aae3f0430e8cb10976961d534d8509e72516978aa82f5`（`https://codeload.github.com/Open-Cascade-SAS/OCCT/tar.gz/refs/tags/V7_8_1`）。
- **可重现构建脚本**：仓库内 `scripts/occt-wasm-build/reproduce.sh`、`scripts/occt-wasm-build/README.md` 与 `vendor/occt-unified/SOURCE.md`，使用 Emscripten `4.0.23` 从已校验源码归档构建 `cunlian_occt.mjs` 与 `cunlian_occt.wasm`。
- **机器可读 SBOM**：根目录 `STEP-NARROW-SBOM.cdx.json`（随包副本 `occt-unified/STEP-SBOM.cdx.json`），状态为 `COMPLETE` / `APPROVED_UNIFIED_OCCT_LGPL_21`。

## 应用随包内完整合规材料位置

以下文件由 `scripts/step-assets.mjs` 自动复制到应用外置资源目录 `occt-unified/`（macOS：`Contents/Resources/occt-unified/`；Windows：`resources/occt-unified/`），并在打包与发布门禁中逐字节核验：

- `LICENSE_LGPL_21.txt`、`OCCT_LGPL_EXCEPTION.txt`：OCCT 7.8.1 完整 LGPL-2.1 与 OCCT Exception 原文。
- `SOURCE.md`、`SHA256SUMS`：OCCT 7.8.1 固定源码定位与 `cunlian_occt.mjs` / `cunlian_occt.wasm` 校验和。
- `NOTICE`、`THIRD-PARTY-NOTICES.md`：显著使用告知与第三方组件许可总览。
- `STEP-SBOM.cdx.json`：CycloneDX 1.6 格式的统一 OCCT 7.8.1 运行时资产与源码哈希清单。
- `STEP-CANDIDATE-LICENSES.txt`、`STEP-NARROW-RUNTIME-NOTICES.txt`、`STEP-TRANSITIVE-NOTICES.txt`：Emscripten 运行时、musl、LLVM 子库及传递依赖原始许可文本。
- `APP-RUNTIME-NOTICES.txt`、`RELEASE-SUPPLEMENTAL-NOTICES.txt`：前端与桌面运行时依赖许可汇总。
- `ELECTRON-LICENSE.txt`、`ELECTRON-CHROMIUM-LICENSES.html`：Electron 45.2.3 与 Chromium/Node.js 随发行许可文本（复制入包内防止移动 `.app` 时遗漏）。
- `SOURCE-SUPPLY.zh-CN.md`、`step-narrow-runtime.md`、`step-license-provenance.md`、`step-kernel-replacement.md`：对应源码供给、运行时边界、来源溯源与用户替换指南。

## 从源码重建与用户替换

1. 参照 `vendor/occt-unified/SOURCE.md` 与 `scripts/occt-wasm-build/README.md`，在全新空目录准备固定 OCCT 7.8.1 源码归档（或你的修改版归档），运行 `scripts/occt-wasm-build/reproduce.sh` 生成新的 `cunlian_occt.mjs` 与 `cunlian_occt.wasm`。
2. 如需在不修改应用源码的情况下加载自行编译的修改版 WASM，可在启动主进程前显式设置 `CUNLIAN_STEP_LOCAL_OPT_IN=1`、`CUNLIAN_STEP_LOCAL_WASM=<修改版绝对路径>`、`CUNLIAN_STEP_LOCAL_SHA256=<小写64位SHA-256>`；详细步骤与安全边界见 [step-kernel-replacement.md](step-kernel-replacement.md)。
3. 如需基于 MIT 源码整体重钉默认内核哈希，可同步更新 `vendor/occt-unified/`、`desktop/main/cad/stepAssetManifest.ts` 与 `STEP-NARROW-SBOM.cdx.json`，再运行 `npm run check:release:step` 与 `npm run test:step-license` 校验。
