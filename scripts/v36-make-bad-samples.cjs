/**
 * V3.6 阶段 1：生成三份“坏样例”文本层 PDF（真实 Chromium printToPDF，真字体嵌入）。
 *
 *   npx electron scripts/v36-make-bad-samples.cjs src/document-extraction/__fixtures__
 *
 * 产物（只用于测试与证据，不进入产品 bundle）：
 * - bad-no-text-layer.pdf     只有一张位图，没有文本层（模拟扫描件；不调用 OCR）
 * - bad-formula-conflict.pdf  同一符号给出两条互相矛盾的线性公式 + 区间
 * - bad-inch-unit.pdf         组成环表头与区间单位写成 inch（不自动换算）
 *
 * 字体与排版沿用 scripts/make-taskbook-pdf.cjs 的做法（PingFang SC），因此文本层
 * 会出现与真实样例同样的康熙部首/CJK 部首补充区码位，属于被测行为的一部分。
 */
const { app, BrowserWindow } = require('electron')
const { promises: fsp } = require('node:fs')
const path = require('node:path')

const outDir = process.argv[2]
if (!outDir) {
  console.error('usage: electron v36-make-bad-samples.cjs <outDir>')
  process.exit(2)
}

const CSS = `
@page { size: A4; margin: 18mm 16mm; }
body { font-family: "PingFang SC", "Heiti SC", sans-serif; font-size: 11pt; line-height: 1.7; color:#000; }
h1 { font-size: 15pt; margin: 0 0 10pt; }
h2 { font-size: 12pt; margin: 14pt 0 6pt; }
p { margin: 4pt 0; }
table { border-collapse: collapse; font-size: 10pt; margin: 6pt 0; width: 100%; }
td, th { border: 1px solid #000; padding: 3pt 6pt; }
img { width: 100%; }
`

const ringRows = [
  ['H', '总长', '52.20', '+0.02', '-0.02'],
  ['B1', '左轴承', '20.00', '+0.01', '-0.01'],
  ['B2', '右轴承', '20.00', '+0.01', '-0.01'],
  ['S', '隔套', '12.00', '+0.01', '-0.01'],
]

function table(unitLabel) {
  const head = `<tr><th>位号</th><th>名称</th><th>基本尺寸（${unitLabel}）</th><th>上偏差（${unitLabel}）</th><th>下偏差（${unitLabel}）</th></tr>`
  const body = ringRows
    .map(
      (cells) =>
        `<tr>${cells.map((cell, index) => (index === 2 ? `<td>${cell}</td>` : `<td>${cell}</td>`)).join('')}</tr>`,
    )
    .join('')
  return `<table>${head}${body}</table>`
}

function html(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`
}

// 只有位图、没有文本层：模拟扫描件。
const noiseSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="860">
${Array.from({ length: 220 }, (_, index) => {
  const x = (index * 37) % 600
  const y = (index * 53) % 840
  return `<rect x="${x}" y="${y}" width="${8 + (index % 23)}" height="6" fill="#222"/>`
}).join('')}
<rect x="40" y="60" width="540" height="2" fill="#000"/>
</svg>`

const samples = [
  {
    name: 'bad-no-text-layer.pdf',
    html: html(
      `<img alt="" src="data:image/svg+xml;base64,${Buffer.from(
        noiseSvg,
        'utf8',
      ).toString('base64')}">`,
    ),
  },
  {
    name: 'bad-formula-conflict.pdf',
    html: html(`
      <h1>轴系装配技术任务书（矛盾公式样例）</h1>
      <p>文件编号：TB-2026-9101　版本：X　页数：1</p>
      <h2>1 组成环</h2>
      ${table('mm')}
      <h2>2 装配间隙要求</h2>
      <p>轴向装配间隙 C 应为 0.1000～0.3000 mm，含两端。</p>
      <p>间隙按下式确定：</p>
      <p>C = H − B1 − S − B2</p>
      <p>或按下式确定：</p>
      <p>C = H − B1 + S − B2</p>
      <p>其中 H = 52.20 mm，B1 = B2 = 20.00 mm，S = 12.00 mm。</p>
    `),
  },
  {
    name: 'bad-inch-unit.pdf',
    html: html(`
      <h1>轴系装配技术任务书（英制样例）</h1>
      <p>文件编号：TB-2026-9102　版本：Y　页数：1</p>
      <h2>1 组成环</h2>
      ${table('in')}
      <h2>2 装配间隙要求</h2>
      <p>轴向装配间隙 C 应为 0.0039～0.0118 in，含两端。</p>
      <p>间隙按下式确定：</p>
      <p>C = H − B1 − S − B2</p>
    `),
  },
]

const only = process.argv[3]
const selected =
  only === undefined ? samples : samples.filter((_, index) => String(index) === only)

app
  .whenReady()
  .then(async () => {
    const os = require('node:os')
    await fsp.mkdir(outDir, { recursive: true })
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'v36-samples-'))
    for (const [index, sample] of selected.entries()) {
      const htmlPath = path.join(tempDir, `sample-${index}.html`)
      await fsp.writeFile(htmlPath, sample.html, 'utf8')
      const win = new BrowserWindow({ show: false, width: 1000, height: 1400 })
      await win.loadURL('file://' + htmlPath)
      await new Promise((resolve) => setTimeout(resolve, 600))
      const pdf = await win.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      })
      const out = path.join(outDir, sample.name)
      await fsp.writeFile(out, pdf)
      console.log(`written ${out} ${pdf.byteLength} bytes`)
      win.destroy()
    }
    app.quit()
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
