/**
 * 生成「表达式末尾单位」样例 PDF（P1 验收用合成样本，Chromium printToPDF）。
 *
 * 7 页，一页一个场景，测试按页范围分别取用（页范围第一页才是文档级声明的作用域）：
 *   p1  E-01 `A0max = 1753.1 − 759.38 − 765.31 = 228.41 mm`（末尾等号后是结果值）
 *   p2  E-02 `A = 230 ± 0.3 mm`（基本尺寸 + 对称偏差 + 单位）
 *   p3  E-03 `T0 = +0.3 − (−0.3) = 0.6 mm`（括号负数不当成两个值）
 *   p4  E-04 `A = 10 = 12 mm`（多个等号结果不一致 → INCONSISTENT_REDUNDANT_VALUE）
 *   p5  E-05 `A0max = 1753.1 − 759.38 − 765.31`（无单位 → 仍 UNKNOWN_UNIT）
 *   p6  E-06 `单位：mm` + `A = 230 ± 0.3`（无单位 → 走 P0 继承）
 *   p7  E-07 `i = 0` / `i = 1`（下标碎片 → 不当尺寸候选）
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/make-expression-unit-sample.cjs <out.pdf>
 */
const { app, BrowserWindow } = require('electron')
const { promises: fsp } = require('node:fs')
const path = require('node:path')

const out = process.argv[2]
if (!out) {
  console.error('usage: electron make-expression-unit-sample.cjs <out.pdf>')
  process.exit(2)
}

const pageBreak = '<div class="page-break"></div>'

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 20mm 20mm 20mm 20mm; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "PingFang SC", "Noto Sans SC", "Songti SC", sans-serif; color: #111; font-size: 12pt; line-height: 1.9; }
  h1 { font-size: 17pt; margin: 0 0 6mm; }
  h2 { font-size: 12.5pt; margin: 0 0 4mm; }
  .meta { color: #444; font-size: 9.5pt; margin-bottom: 6mm; }
  .page-break { page-break-before: always; }
  p { margin: 0 0 2mm; }
  .mono { font-family: "Menlo", "Courier New", monospace; }
  /* 让“结果值 / 单位”成为独立文本项：出处才能精确指到末尾那段单位文字。 */
  .op { font-family: "Menlo", "Courier New", monospace; }
  .u { font-family: "Songti SC", "Times New Roman", serif; }
</style></head><body>

  <!-- p1 E-01 末尾等号后是结果值 -->
  <h1>轴向尺寸链任务书（表达式末尾单位样例，合成样本）</h1>
  <div class="meta">文件编号：TB-EXPR-001 · 第 1 页 · 场景 E-01</div>
  <p><span>A0max = 1753.1 − 759.38 − 765.31 =</span><span class="op"> 228.41</span><span class="u"> mm</span></p>

  ${pageBreak}
  <!-- p2 E-02 基本尺寸 ± 偏差 + 单位 -->
  <h2>2. 组成环赋值（对称偏差）</h2>
  <div class="meta">第 2 页 · 场景 E-02</div>
  <p><span>A = 230 ±</span><span class="op"> 0.3</span><span class="u"> mm</span></p>

  ${pageBreak}
  <!-- p3 E-03 括号负数 -->
  <h2>3. 组成环赋值（括号负数）</h2>
  <div class="meta">第 3 页 · 场景 E-03</div>
  <p><span>T0 = +0.3 − (−0.3) =</span><span class="op"> 0.6</span><span class="u"> mm</span></p>

  ${pageBreak}
  <!-- p4 E-04 多个等号结果不一致 -->
  <h2>4. 结果值矛盾</h2>
  <div class="meta">第 4 页 · 场景 E-04</div>
  <p><span>A = 10 =</span><span class="op"> 12</span><span class="u"> mm</span></p>

  ${pageBreak}
  <!-- p5 E-05 无单位 -->
  <h2>5. 无单位表达式</h2>
  <div class="meta">第 5 页 · 场景 E-05</div>
  <p>A0max = 1753.1 − 759.38 − 765.31</p>

  ${pageBreak}
  <!-- p6 E-06 无单位 ± 偏差，靠页内「单位：mm」继承 -->
  <h2>6. 无单位赋值 + 页内单位声明</h2>
  <div class="meta">第 6 页 · 场景 E-06</div>
  <p>单位：mm</p>
  <p>A = 230 ± 0.3</p>

  ${pageBreak}
  <!-- p7 E-07 下标碎片 -->
  <h2>7. 公式下标片段</h2>
  <div class="meta">第 7 页 · 场景 E-07</div>
  <p>i = 0</p>
  <p>i = 1</p>

</body></html>`

app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({ show: false, width: 1000, height: 1400 })
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await new Promise((resolve) => setTimeout(resolve, 800))
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    })
    await fsp.mkdir(path.dirname(out), { recursive: true })
    await fsp.writeFile(out, pdf)
    console.log(`written ${out} ${pdf.byteLength} bytes`)
    app.quit()
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
