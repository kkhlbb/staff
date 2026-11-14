# 第三方组件与许可

寸链自身代码以 MIT 许可发布（见 `LICENSE`）。随附的第三方组件按各自的许可分发，以下为实际打包进应用的版本。

## 运行时依赖

| 组件 | 版本 | 许可 | 用途 |
|---|---|---|---|
| Electron | 45.2.3 | MIT | 桌面运行时 |
| React / React DOM | 19.3.1 | MIT | 界面 |
| three | 0.187.0 | MIT | 3D 轴系展示与 STL 预览 |
| pdfjs-dist | 6.5.438 | **Apache-2.0** | 来源 PDF 渲染 |
| zod | 4.6.7 | MIT | 项目文件与 IPC 载荷校验 |

## 字体

| 字体 | 许可 | 说明 |
|---|---|---|
| Noto Sans SC（子集 `NotoSansSC-Cunlian-subset.woff2`） | **SIL Open Font License 1.1** | 仅保留数值、`⌀`、`±` 与图框/标注所需字形 |
| Noto Sans Math（子集 `NotoSansMath-Cunlian-symbols.woff2`） | **SIL Open Font License 1.1** | 数学与直径符号 |

完整许可原文见 `public/fonts/LICENSE-OFL-1.1.txt`，字体来源与子集方式见 `public/fonts/SOURCE.md`。

OFL-1.1 要求：再分发时必须随附许可原文；不得单独售卖字体本身；不得使用保留字体名（Reserved Font Name）命名修改版本。本项目**未修改**字形，仅做子集化与重命名以标明用途（`*-Cunlian`）。

## 关于 Apache-2.0 组件（pdfjs-dist）

Apache-2.0 要求分发时保留其 `LICENSE` 与 `NOTICE`（若有）。安装依赖后原文位于 `node_modules/pdfjs-dist/LICENSE`。

## Electron 应用内的其它许可

Electron 打包产物体内还包含 Chromium 与 Node.js 的第三方组件，其许可清单由 Electron Forge 自动生成在产物根目录：

- `<app>.app/Contents/Resources/LICENSE`
- `<app>.app/Contents/Resources/LICENSES.chromium.html`

它们随产物一同分发，无需额外处理。

## STEP：Open CASCADE Technology（本地接入，发布阻塞）

本应用通过固定 `replicad-opencascadejs@1.2.1`（Steve Genoud）使用
Open CASCADE Technology (OCCT)。npm 包声明 LGPL-2.1-only；OCCT 适用
LGPL 2.1 及 OCCT additional exception。应用 MIT 不覆盖内核；例外不取消
库的 LGPL 义务。未使用高层 replicad 包。

完整文本随外置运行资源放在 `step-kernel/LICENSE_LGPL_21.txt` 与
`step-kernel/OCCT_LGPL_EXCEPTION.txt`，源码副本位于
`desktop/main/cad/licenses/`，逐字复制批准 spike 已保存的官方 V8_0_0 文本：

- https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_0/LICENSE_LGPL_21.txt
- https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_0/OCCT_LGPL_EXCEPTION.txt
- 包源码：https://github.com/sgenoud/replicad/tree/5e4ad9bb5a35bb9ae0571e91c25fa1897ba0570c/packages/replicad-opencascadejs
- 构建参考：https://github.com/taucad/opencascade.js/tree/v3.1.0

运行字节自报 OCCT 8.0；不能由此证明精确补丁/提交。固定 WASM SHA-256：
`a9335919fa64bfeaee3e241d3139ad134022682429c6688e20d8ca12093d33d9`。
npm build script 引用 `ghcr.io/taucad/opencascade.js:3.1.0-single-threaded`，
不等于已核实对应容器 digest、完整源码、补丁、工具链或完整 SBOM。

**发布阻塞，尚未闭合：**本地实现/测试不等于批准分发。分发前需确定与字节对应
的完整 source/build provenance，按适用 LGPL 路径提供库源码、修改及构建信息；
审查静态组合组件与 Emscripten 运行时许可；落实并验证 LGPL 第6节适用的替换/
重链接及调试修改库权利。上游 URL 不是完整源码供给。当前固定哈希是完整性
机制，**不是已验证合规的库替换机制**；发布兼容替换途径及说明仍待解决。
不声称法律合规认证、完整 SBOM 或再分发许可已通过。

## 固定资产补充核查（仍阻塞，不是分发许可）

显著使用告知见根目录 `NOTICE`；本项目 MIT 不改，OCCT/绑定仍按自身许可。
新增 `STEP-SBOM.cdx.json` 是 STEP 专用部分清单，明确 `INCOMPLETE`，不是整个
Electron 产品或完整 WASM 静态组件认证。上述 V8_0_0 链接只说明早期许可文本
取得位置，不是目标精确源码证明；固定构建参考实际指向 V8_0_1，文本相同。

npm tarball SRI、固定 gitHead 中 dist 与实装字节已核对；源码/构建证据、候选
静态组件许可与尚缺材料见 `docs/step-license-provenance.md`。不把当前容器 tag
或主分支 URL 当作 npm 构建时的精确来源。额外保留 npm 原始 LGPL 及候选
Emscripten/runtime/OCCT嵌入条款全文于外置资源，均未被根目录 MIT 替换。

用户替换/重链接与调试权利、可执行探针及阻塞见 `docs/step-kernel-replacement.md`。
直接替换当前仍被完整性hash拒绝，修改库源重编/重链接未证明，不宣称已合规。
`npm run check:release:step` 必须非零退出，普通打包绿灯仅表示本地资源核验。

## 如何自行核对

```bash
npm install
node -e "for (const p of ['electron','three','pdfjs-dist','react','zod']) console.log(p, require('./node_modules/'+p+'/package.json').version, require('./node_modules/'+p+'/package.json').license)"
```
