/**
 * 生成「同一符号多处赋值」样例 PDF（V3.6 体验修订验收用，合成样本）。
 *
 * 内容（文本层，Chromium printToPDF）：
 * - 第 1 页：A0 三处不同取值（0.100 / 0.200 / 0.150 mm）；
 *            B0 三处相同取值（0.500 mm ×3，应合并成一条候选）。
 * - 第 2 页：C0 三处，其中一处缺单位（0.300 mm / 0.400 mm / 0.350），
 *            期望 2 条候选 + 1 条 UNKNOWN_UNIT issue。
 *
 * 只用于测试/证据，不冒充真实任务书。用法：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/make-ambiguous-sample.cjs <out.pdf>
 */
const { app, BrowserWindow } = require('electron')
const { promises: fsp } = require('node:fs')
const path = require('node:path')

const out = process.argv[2]
if (!out) {
  console.error('usage: electron make-ambiguous-sample.cjs <out.pdf>')
  process.exit(2)
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 20mm 20mm 20mm 20mm; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "PingFang SC", "Noto Sans SC", "Songti SC", sans-serif; color: #111; font-size: 12pt; line-height: 2; }
  h1 { font-size: 18pt; margin: 0 0 8mm; }
  h2 { font-size: 13pt; margin: 8mm 0 3mm; }
  .meta { color: #444; font-size: 10pt; margin-bottom: 8mm; }
  .page-break { page-break-before: always; }
  p { margin: 0; }
</style></head><body>
  <h1>同符号多处赋值样例（合成样本）</h1>
  <div class="meta">文件编号：TB-AMB-001 · 本文件为 V3.6 体验修订验收用合成资料，不是真实客户任务书。</div>
  <h2>1. 符号 A0：三处不同取值</h2>
  <p>A0 = 0.100 mm</p>
  <p>A0 = 0.200 mm</p>
  <p>A0 = 0.150 mm</p>
  <h2>2. 符号 B0：三处相同取值</h2>
  <p>B0 = 0.500 mm</p>
  <p>B0 = 0.500 mm</p>
  <p>B0 = 0.500 mm</p>
  <div class="page-break"></div>
  <h1>符号 C0：三处，其中一处缺单位</h1>
  <p>C0 = 0.300 mm</p>
  <p>C0 = 0.400 mm</p>
  <p>C0 = 0.350</p>
</body></html>`

app.whenReady().then(async () => {
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
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
