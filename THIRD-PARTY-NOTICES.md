# 第三方组件与许可（寸链 `v1.0.2`）

寸链自身代码以 **MIT** 许可发布（见根目录 `LICENSE`）。随附的第三方组件按各自的原始许可分发，应用 MIT 许可不覆盖或替换第三方许可条款。

## 一、统一几何内核：Open CASCADE Technology (OCCT) 7.8.1

寸链 `v1.0.2` 使用统一编译的 **OCCT 7.8.1 XCAF WASM** 内核（外置资源目录 `occt-unified/`，含 `cunlian_occt.mjs`、`cunlian_occt.wasm`、`step-worker.cjs`），承担 STEP AP214/AP203 装配导入/导出、XCAF 装配特征提取、三维构形与 2D HLR 矢量工程图能力。

- **许可**：**LGPL-2.1-only** + **OCCT LGPL Exception**（Exception 仅适用于头文件材料，不免除整个库的 LGPL-2.1 义务）。
- **完整原文**：随仓库位于 `vendor/occt-unified/LICENSE_LGPL_21.txt` 与 `vendor/occt-unified/OCCT_LGPL_EXCEPTION.txt`，并由 `scripts/step-assets.mjs` 逐字节复制入应用外置资源目录 `occt-unified/`。
- **固定源码与可重现构建**：
  - 上游仓库：[Open-Cascade-SAS/OCCT](https://github.com/Open-Cascade-SAS/OCCT)，标签 `V7_8_1`，提交 `bd2a789f15235755ce4d1a3b07379a2e062fdc2e`（官方归档 SHA-256：`7321af48c34dc253bf8aae3f0430e8cb10976961d534d8509e72516978aa82f5`）。
  - 构建脚本：`scripts/occt-wasm-build/reproduce.sh`（Emscripten `4.0.23`）与 `vendor/occt-unified/SOURCE.md`。
- **资产清单与发布门禁**：`STEP-NARROW-SBOM.cdx.json`（随包副本 `occt-unified/STEP-SBOM.cdx.json`）已标记 `COMPLETE` 与 `APPROVED_UNIFIED_OCCT_LGPL_21`，可通过 `npm run check:release:step` 与 `npm run test:step-license` 逐字节核验。
- **用户修改与替换权利**：允许用户为自用修改 LGPL 库、重新链接以及为调试这些修改而逆向工程；详细供给、本地 WASM opt-in 替换及源码重编译步骤见 `NOTICE`、`docs/step-source-supply.md`、`docs/step-narrow-runtime.md`、`docs/step-license-provenance.md` 与 `docs/step-kernel-replacement.md`。
- **Emscripten 与传递运行时许可**：Emscripten glue、musl、LLVM 子库、dlmalloc、David Gay `strtod` 等均遵循各自原始许可，不统称为 MIT；完整原文随包位于 `occt-unified/STEP-NARROW-RUNTIME-NOTICES.txt`、`STEP-TRANSITIVE-NOTICES.txt` 与 `STEP-CANDIDATE-LICENSES.txt`。

## 二、应用运行时依赖

| 组件 | 版本 | 许可 | 用途 |
|---|---|---|---|
| Electron | 45.2.3 | MIT | 桌面运行时 |
| React / React DOM | 19.3.1 | MIT | 界面渲染 |
| three | 0.187.0 | MIT | 3D 装配展示、拾取与变形云图动画 |
| pdfjs-dist | 6.5.438 | **Apache-2.0** | 来源任务书 PDF 渲染与文本提取 |
| @zip.js/zip.js | 2.24.0 | **BSD-3-Clause** | `.cunlian` 项目归档读写 |
| papaparse | 5.7.0 | MIT | CSV 数据解析 |
| smol-toml | 1.9.1 | MIT | 配置文件解析 |
| zod | 4.6.7 | MIT | 项目文件、IPC、MCP 与 REST 契约校验 |

运行时依赖完整许可汇编随包位于 `occt-unified/APP-RUNTIME-NOTICES.txt` 与 `occt-unified/RELEASE-SUPPLEMENTAL-NOTICES.txt`。

## 三、字体

| 字体 | 许可 | 说明 |
|---|---|---|
| Noto Sans SC（子集 `NotoSansSC-Cunlian-subset.woff2`） | **SIL Open Font License 1.1** | 仅保留数值、`⌀`、`±` 与图框/标注所需字形 |
| Noto Sans Math（子集 `NotoSansMath-Cunlian-symbols.woff2`） | **SIL Open Font License 1.1** | 数学与直径符号 |

完整许可原文见 `public/fonts/LICENSE-OFL-1.1.txt`，字体来源与子集方式见 `public/fonts/SOURCE.md`。OFL-1.1 要求再分发时随附许可原文、不得单独售卖字体本身、不得使用保留字体名（Reserved Font Name）命名修改版本。本项目未修改字形，仅做子集化并重命名标明用途（`*-Cunlian`）。

## 四、Apache-2.0 组件（pdfjs-dist）

Apache-2.0 要求分发时保留其 `LICENSE` 与 `NOTICE`（若有）。安装依赖后原文位于 `node_modules/pdfjs-dist/LICENSE`，且已纳入随包 `APP-RUNTIME-NOTICES.txt`。

## 五、Electron 与 Chromium 随发行许可

Electron 45.2.3 打包产物包含 Chromium 与 Node.js 的第三方组件许可清单。为防止仅移动 `.app` 时遗漏旁置文件，本产品同时在 `occt-unified/` 内随包复制完整原文：

- `occt-unified/ELECTRON-LICENSE.txt`
- `occt-unified/ELECTRON-CHROMIUM-LICENSES.html`

## 六、自行核对命令

```bash
npm run check:release:step
npm run test:step-license
node -e "for (const p of ['electron','three','pdfjs-dist','react','zod','@zip.js/zip.js','papaparse','smol-toml']) console.log(p, require('./node_modules/'+p+'/package.json').version, require('./node_modules/'+p+'/package.json').license)"
```
