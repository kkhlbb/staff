# 统一 OCCT 7.8.1 WASM 内核：来源溯源、许可义务与发布门禁（`v1.0.2`）

本文件记录寸链 `v1.0.2` 所打包的统一 **OCCT 7.8.1 XCAF WASM** 运行时资产的来源溯源、许可边界与自动化发布门禁。历史 `replicad-opencascadejs` 与 `step-narrow-v1` 过渡期文档已归档至 Git 标签 `archive/pre-cleanup-v1.0.2`。

## 一、运行资产字节身份（已闭环）

当前外置运行目录 `occt-unified/` 仅包含三项经 SHA-256 精确锁定的执行资产（权威定义见 `desktop/main/cad/stepAssetManifest.ts` 与 `STEP-NARROW-SBOM.cdx.json`）：

| 资产文件 | 仓库来源 | SHA-256 |
|---|---|---|
| `cunlian_occt.mjs` | `vendor/occt-unified/cunlian_occt.mjs` | `0727731066be7847ab67312f187592db3ee5fe285621cf94cd6baa6aac4eed91` |
| `cunlian_occt.wasm` | `vendor/occt-unified/cunlian_occt.wasm` | `6cb34be8e7cd73b121618bb8d3900d2950dc1b67043e59c9e499771afaf89282` |
| `step-worker.cjs` | `desktop/main/cad/step-worker.cjs` | `389fe39a8dc571247d5a6aa2d3b2cd4789d91f721a84ffe32ac1b8ecb84e0790` |

## 二、上游源码与可重现构建溯源（已闭环）

- **上游库**：Open CASCADE Technology (OCCT) `7.8.1`
- **固定标签与提交**：`V7_8_1` / `bd2a789f15235755ce4d1a3b07379a2e062fdc2e`
- **官方归档校验和**：`7321af48c34dc253bf8aae3f0430e8cb10976961d534d8509e72516978aa82f5`
- **工具链与构建脚本**：Emscripten `4.0.23`，完整构建入口为 `scripts/occt-wasm-build/reproduce.sh` 与 `scripts/occt-wasm-build/README.md`，隔套翻译单元位于 `vendor/step-narrow-v1/spacer.cpp`。构建流程从已校验的官方 OCCT 7.8.1 源码归档直接编译 XCAF 与隔套绑定，不再依赖任何无溯源的预构建第三方 npm WASM 二进制。

## 三、许可边界与静态/运行时组件告知

- **应用代码**：MIT（见根目录 `LICENSE`）。
- **OCCT 7.8.1**：LGPL-2.1-only + OCCT LGPL Exception（完整原文见 `vendor/occt-unified/LICENSE_LGPL_21.txt` 与 `vendor/occt-unified/OCCT_LGPL_EXCEPTION.txt`）。OCCT Exception 仅覆盖头文件中的模板/内联实例化，不免除整个库的 LGPL-2.1 条款。
- **Emscripten 运行时与传递组件**：musl、libc++/libc++abi、libunwind、compiler-rt、dlmalloc、David Gay `strtod` 等原始许可文本完整随包保留于 `licenses/STEP-NARROW-RUNTIME-NOTICES.txt`、`licenses/STEP-TRANSITIVE-NOTICES.txt` 与 `licenses/STEP-CANDIDATE-LICENSES.txt`，不统称为 MIT。
- **Electron / Chromium 与前端运行时**：完整许可汇总保留于 `licenses/APP-RUNTIME-NOTICES.txt`、`licenses/RELEASE-SUPPLEMENTAL-NOTICES.txt`、`licenses/ELECTRON-LICENSE.txt` 与 `licenses/ELECTRON-CHROMIUM-LICENSES.html`。

## 四、LGPL-2.1 义务与可机器校验门禁

本仓库通过以下自动化门禁保障发布产物与许可材料一致：

1. **`npm run check:release:step`**（`scripts/check-step-release.mjs`）：核验 `occt-unified/` 中三项运行资产哈希、18 份法律告知文件与源仓库逐字节一致，并校验 `STEP-SBOM.cdx.json` 满足 `cunlian:completeness=COMPLETE`、`cunlian:distributionApproval=APPROVED_UNIFIED_OCCT_LGPL_21` 且 `cunlian:blockers=""`，通过时退出 `0`。
2. **`npm run test:step-license`**（`scripts/step-license.test.mjs`）：逐项变异测试确认缺失或篡改任意一份法律告知文件、篡改 WASM 字节、或在 `occt-unified/` 中混入旧内核文件（`replicad_single.wasm`、`spacer.wasm` 等）均会被拒绝。
3. **`npm run check:package:step`**（`scripts/assert-packaged-step.mjs`）：在 Electron 打包产物上直接复验 `Contents/Resources/occt-unified/`（或 `resources/occt-unified/`）完整性。

用户修改 LGPL 库、重编译、本地 opt-in 替换与调试权利说明见 [step-kernel-replacement.md](step-kernel-replacement.md) 与 [step-source-supply.md](step-source-supply.md)。
