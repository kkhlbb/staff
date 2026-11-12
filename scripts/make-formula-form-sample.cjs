/**
 * 生成「公式行里的显式末尾值」样例 PDF（P2 验收用合成样本，Chromium printToPDF）。
 *
 * 7 页，一页一个场景，测试按页范围分别取用（页范围第一页才是文档级声明的作用域）：
 *   p1  F-01 `B1 = B1 + B1under = 135 + 250/2 = 260 mm`（中间式含字母与除号，取末尾显式值）
 *   p2  F-02 `Zmax=5.2+0.1-4.9=0.4mm)`（旧顺序里被公式分支以 FORMULA_UNSUPPORTED 抢先拦下）
 *   p3  F-03 `Δ0=[0.1+(−0.1)]/2=0mm`（希腊字母符号 + 括号负数，取末尾显式值 0）
 *   p4  F-04 `EI0=Δ0−T0/2=0−0.135/2=−0.07mm.It can be seen B1=260±0.07mm`
 *          （中间夹着第二处赋值 → 必须仍阻塞，不能把 260 挂到 EI0 头上）
 *   p5  F-05 `A = B = 10 = 12 mm`（符号链 → 形态匹配仍返回 null，交回既有解析）
 *   p6  F-06 `ES2=Δ2+T2/2=0+0.06/2=0.03`（末尾不是「数值+单位」→ 仍 FORMULA_UNSUPPORTED）
 *   p7  F-07 `B1=(125×COS10°+230/2)=238.1mm, B2=(33×COS10°)=32.5mm`（一个逗号行两条赋值）
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/make-formula-form-sample.cjs <out.pdf>
 */
const { app, BrowserWindow } = require('electron')
const { promises: fsp } = require('node:fs')
const path = require('node:path')

const out = process.argv[2]
if (!out) {
  console.error('usage: electron make-formula-form-sample.cjs <out.pdf>')
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
  /* 让“结果值 / 单位”成为独立文本项：出处才能精确指到末尾那段单位文字。 */
  .op { font-family: "Menlo", "Courier New", monospace; }
  .u { font-family: "Songti SC", "Times New Roman", serif; }
</style></head><body>

  <!-- p1 F-01 中间式含字母与除号 -->
  <h1>轴向尺寸链任务书（公式行显式末尾值样例，合成样本）</h1>
  <div class="meta">文件编号：TB-FORM-001 · 第 1 页 · 场景 F-01</div>
  <p><span>B1 = B1 + B1under = 135 + 250/2 =</span><span class="op"> 260</span><span class="u"> mm</span></p>

  ${pageBreak}
  <!-- p2 F-02 旧顺序里被公式分支抢先拦下（行内有右括号） -->
  <h2>2. 公式行里的显式结果值</h2>
  <div class="meta">第 2 页 · 场景 F-02</div>
  <p><span>Zmax=5.2+0.1-4.9=</span><span class="op">0.4</span><span class="u">mm</span><span>)</span></p>

  ${pageBreak}
  <!-- p3 F-03 希腊字母符号 + 括号负数 -->
  <h2>3. 希腊字母符号</h2>
  <div class="meta">第 3 页 · 场景 F-03</div>
  <p><span>Δ0=[0.1+(−0.1)]/2=</span><span class="op">0</span><span class="u">mm</span></p>

  ${pageBreak}
  <!-- p4 F-04 中间夹着第二处赋值：必须仍阻塞 -->
  <h2>4. 中间夹带第二处赋值</h2>
  <div class="meta">第 4 页 · 场景 F-04</div>
  <p><span>EI0=Δ0−T0/2=0−0.135/2=−0.07mm.It can be seen B1=</span><span class="op">260</span><span class="u">±0.07mm</span></p>

  ${pageBreak}
  <!-- p5 F-05 符号链 -->
  <h2>5. 符号链赋值</h2>
  <div class="meta">第 5 页 · 场景 F-05</div>
  <p><span>A = B = 10 =</span><span class="op"> 12</span><span class="u"> mm</span></p>

  ${pageBreak}
  <!-- p6 F-06 末尾不是「数值+单位」 -->
  <h2>6. 末尾不是数值加单位</h2>
  <div class="meta">第 6 页 · 场景 F-06</div>
  <p>ES2=Δ2+T2/2=0+0.06/2=0.03</p>

  ${pageBreak}
  <!-- p7 F-07 一个逗号行两条赋值 -->
  <h2>7. 逗号行内两条赋值</h2>
  <div class="meta">第 7 页 · 场景 F-07</div>
  <p><span>B1=(125×COS10°+230/2)=</span><span class="op">238.1</span><span class="u">mm</span><span>, B2=(33×COS10°)=</span><span class="op">32.5</span><span class="u">mm</span></p>

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
