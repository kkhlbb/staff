# 内置字体来源与许可（V3-C）

随包分发两个 OFL-1.1 字体子集，全部离线加载，不依赖系统字体回退：

| 文件 | 用途 | 字节 | SHA-256 |
|---|---|---|---|
| `NotoSansSC-Cunlian-subset.woff2` | 中文、数字、标点 | 38,920 | `52dd75b392552a0eaea882e1d7a6fd4f2da108b6f3c27667692f61faf166191c` |
| `NotoSansMath-Cunlian-symbols.woff2` | `⌀`、`±` 等符号 | 3,112 | `33f512e3d4594830ed6865a799be9f44774aeb8a6b2733f85b56de45e37bdf48` |

## 为什么是两个字体

Noto Sans SC（含 Noto CJK 全系）**不包含 U+2300 `⌀`**；实测源字体 cmap 无此码位。
因此中文/数字用 Noto Sans SC 子集，`⌀ ±` 由同为 OFL-1.1 的 Noto Sans Math 子集
补齐，SVG/HTML 用同一字体栈按字符回退。PDF 里两个字体都必须以嵌入子集出现
（`FontFile2`/`FontFile3` + `BaseFont` 前缀），不能只看 `document.fonts.ready`。

## 上游与版本

### Noto Sans SC

- 仓库：https://github.com/google/fonts
- 文件：`ofl/notosanssc/NotoSansSC[wght].ttf`（可变字体）
- 取得时该文件所在提交：`2894aab31764f10f29c421bdfd2340d3b382d384`
- 源文件 SHA-256：`a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da`
- 处理：`fontTools.varLib.instancer` 固定 `wght=400`，再按实际用字子集化为 woff2；
  name 表改为 `Noto Sans SC Cunlian` / `NotoSansSC-Cunlian`，许可不变。

### Noto Sans Math

- 仓库：https://github.com/notofonts/notofonts.github.io
- 文件：`fonts/NotoSansMath/hinted/ttf/NotoSansMath-Regular.ttf`
- 取得时该文件所在提交：`55773c3eb233b5a0eaa07de6226da189b136b4f0`
- 源文件 SHA-256：`d51afd5739c7ba6c44fcab35a88160e25dfb69a2d4ad0bd99533f8d894af1f96`
- 子集字符：`⌀ ± · × °`

## 许可

SIL Open Font License 1.1；全文见同目录 `LICENSE-OFL-1.1.txt`。子集保留 name 表
与版权声明，未单独售卖字体。

## 子集范围

主字体只保留图纸实际使用的 186 个字符（ASCII 可打印、`⌀ ± · — 、。：；（）° ×`、
模板与参数标签中文）。`scripts/build-font-subset.py` 记录可复现流程；滚动更新字体
时必须同步更新本文件的提交号、源文件哈希与子集哈希，并重新验证实际 PDF 的
`FontDescriptor/FontFile2` 与文字提取，不能只看本机预览。
