# gt-01：原件渲染真值

范围：f16f5eb 下 r2 全部 7 条 pending、r5 全部 2 条 pending、r6 按原候选顺序前 10 条 pending，共 19 条。

来源：`../real-doc-baseline/corpus-manifest.json` 中的本地 PDF，先核对 SHA-256 与字节数；没有联网，也没有使用 OCR。原件不另行提交。

核验顺序：先定位原件并用 pdfjs 真渲染 → 逐张查看裁片 → 按可见字形转录 nominal/上下偏差 → 才实现几何修复和正确性比较。
核读者为本次实现助手；`verifiedBy: render-crop` 不表示用户已人工复核全部 19 条。

`gt-01.json` 的 `entries` 是 19 条真值，每条包含任务卡要求的全部字段。十进制用字符串保留精度；null 表示该处没有公差标注，不擅自解释为对称。

转录约定：可表示的上下标用 Unicode；Unicode 没有对应拉丁字母的下标时使用 `_b` 或 `_{L_b}` 这类位置记法，花括号/下划线只表示排版位置，不是原件额外字符。不得把拉丁 b 换成希腊 β。字体斜体/正体不另编码；空白按可读间隔记录。

坐标：`rect` 为未旋转 PDF 点 `[x0,y0,x1,y1]`，原点在左下角，针对本条赋值出处；裁片按此区域左右各外扩 8 点、下 8 点、上 12 点，以 4 倍比例真渲染。裁片可能带相邻行上下文，真值仅抄目标标注。

r6 的 T1/T2 使用同一个显式数值，但属于两个原始 pending 候选：两个区域保留各自的符号起点。比较器先按 nominal 出处定位，再用符号出处的 x 起点区分，绝不按“哪个数看起来正确”选择候选。

离线重渲染（不生成/修改真值）：

    node scripts/ground-truth-crops.mjs

三张示例和 19 条对照见 `../supersub-fix/index.html`；完整数据见 `../supersub-fix/COMPARISON.md`、`comparison.json`。
