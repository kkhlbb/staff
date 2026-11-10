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

## 如何自行核对

```bash
npm install
node -e "for (const p of ['electron','three','pdfjs-dist','react','zod']) console.log(p, require('./node_modules/'+p+'/package.json').version, require('./node_modules/'+p+'/package.json').license)"
```
