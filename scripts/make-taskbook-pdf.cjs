const { app, BrowserWindow } = require('electron')
const { promises: fsp } = require('node:fs')
const path = require('node:path')

const out = process.argv[2]
if (!out) {
  console.error('usage: electron make-pdf-v35.cjs <out.pdf>')
  process.exit(2)
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 18mm 18mm 18mm 18mm; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "PingFang SC", "Noto Sans SC", "Songti SC", sans-serif; color: #111; font-size: 12pt; line-height: 1.7; }
  h1 { font-size: 20pt; margin: 0 0 8mm; }
  h2 { font-size: 14pt; margin: 0 0 4mm; }
  .meta { color: #444; font-size: 10pt; margin-bottom: 8mm; }
  .page-break { page-break-before: always; }
  .box { border: 1px solid #333; padding: 4mm; margin: 4mm 0; }
  .key { background: #fff3c4; padding: 1mm 2mm; }
  table { border-collapse: collapse; width: 100%; font-size: 10pt; }
  td, th { border: 1px solid #666; padding: 2mm; }
</style></head><body>
  <h1>轴向装配任务书（合成样本）</h1>
  <div class="meta">文件编号：TB-V35-001 · 版本：A · 页 1 / 2 · 本文件为 V3.5 Beta 验收用合成资料，不是真实客户任务书。</div>
  <h2>1. 适用范围</h2>
  <p>本任务书规定隔套装配后轴向装配间隙 C 的允许范围。适用于轴系轴向公差链演示项目 P35-A。</p>
  <table>
    <tr><th>组成环</th><th>代号</th><th>基本尺寸 / 偏差</th></tr>
    <tr><td>总长</td><td>H</td><td>52.20 ±0.02 mm</td></tr>
    <tr><td>轴承 B1</td><td>B1</td><td>20.00 ±0.01 mm</td></tr>
    <tr><td>隔套</td><td>S</td><td>长度 ±0.01 mm</td></tr>
    <tr><td>轴承 B2</td><td>B2</td><td>20.00 ±0.01 mm</td></tr>
  </table>
  <p>尺寸链：C = H − B1 − S − B2。</p>
  <div class="page-break"></div>
  <h1>2. 轴向间隙要求</h1>
  <div class="meta">页 2 / 2 · 本页原文用于“绑定任务书要求”的框选与粘贴。</div>
  <div class="box">
    <p><strong>2.1 装配要求</strong></p>
    <p class="key">轴向装配间隙 C 应为 0.1000～0.3000 mm，含两端。</p>
    <p>判定按闭区间执行：Cmin ≥ 0.1000 mm 且 Cmax ≤ 0.3000 mm 才算满足；部分相交不视为满足。</p>
  </div>
  <h2>3. 记录</h2>
  <p>本页要求由设计部门提出；变更须重新确认并保留旧版本。任务书要求是本次检查的唯一判定依据，原项目目标继续独立保存。</p>
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
