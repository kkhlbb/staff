/**
 * 生成「单位从表头/上下文继承」样例 PDF（P0 验收用合成样本，Chromium printToPDF）。
 *
 * 12 页，一页一个场景，测试按页范围分别取用（页范围第一页才是文档级声明的作用域）：
 *   p1  U-02 文档级声明页：本页写「单位：mm」
 *   p2  U-02 正文：三条赋值句都不写单位（应继承 p1 的 mm）
 *   p3  U-02 组成环表：表头没有单位（应继承 p1 的 mm）
 *   p4  U-01 组成环表：表头写「基本尺寸/mm 上偏差/mm 下偏差/mm」，行里只有数字
 *   p5  U-03 表头 mm，但 H 的基本尺寸自带 in（单元格单位优先，不被覆盖）
 *   p6  U-04 表头 mm，正文另写「单位为英寸」（UNIT_CONFLICT，不许二选一）
 *   p7  U-05 没有任何单位线索（必须仍阻塞 UNKNOWN_UNIT）
 *   p8  U-06 表头 mm + 数据行（跨页表格的前半页）
 *   p9  U-06 续表数据行（无表头）+ 一条无单位赋值（不许从上一页表头继承）
 *   p10 U-07 图注「图 3 隔套端面间隙（mm）」+ 图内标注数字
 *   p11 U-08 mm 侧：超出精度 / 超出量级的数字仍报既有错误
 *   p12 U-08 in 侧：继承到英制单位也不换算，仍 UNSUPPORTED_UNIT
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/make-unit-inherit-sample.cjs <out.pdf>
 */
const { app, BrowserWindow } = require('electron')
const { promises: fsp } = require('node:fs')
const path = require('node:path')

const out = process.argv[2]
if (!out) {
  console.error('usage: electron make-unit-inherit-sample.cjs <out.pdf>')
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
  table { border-collapse: collapse; width: 100%; font-size: 10.5pt; }
  td, th { border: 1px solid #666; padding: 1.6mm 2mm; text-align: left; }
  .caption { margin-top: 4mm; }
</style></head><body>

  <!-- p1 U-02 文档级声明 -->
  <h1>轴向尺寸链任务书（单位继承样例，合成样本）</h1>
  <div class="meta">文件编号：TB-UNIT-001 · 第 1 页 · 场景 U-02（文档级声明）</div>
  <p>单位：mm</p>
  <p>本任务书后附全部尺寸均按上述单位记录，逐处不再重复标注。</p>
  <p>适用于轴系轴向公差链演示项目 P40-U。</p>

  ${pageBreak}
  <!-- p2 U-02 正文赋值 -->
  <h2>2. 组成环（逐处未标单位）</h2>
  <div class="meta">第 2 页 · 场景 U-02</div>
  <p>H = 52.20</p>
  <p>B1 = 20.00</p>
  <p>S = 12.00</p>

  ${pageBreak}
  <!-- p3 U-02 无单位表头的组成环表 -->
  <h2>3. 组成环表（表头未标单位）</h2>
  <div class="meta">第 3 页 · 场景 U-02</div>
  <table>
    <tr><th>位号</th><th>名称</th><th>基本尺寸</th><th>上偏差</th><th>下偏差</th></tr>
    <tr><td>H</td><td>总长</td><td>52.20</td><td>+0.02</td><td>-0.02</td></tr>
    <tr><td>B2</td><td>右轴承</td><td>20.00</td><td>+0.01</td><td>-0.01</td></tr>
  </table>

  ${pageBreak}
  <!-- p4 U-01 表头写单位 -->
  <h2>4. 表头带单位的组成环表</h2>
  <div class="meta">第 4 页 · 场景 U-01</div>
  <table>
    <tr><th>位号</th><th>名称</th><th>基本尺寸/mm</th><th>上偏差/mm</th><th>下偏差/mm</th></tr>
    <tr><td>H</td><td>总长</td><td>52.20</td><td>+0.02</td><td>-0.02</td></tr>
    <tr><td>B1</td><td>左轴承</td><td>20.00</td><td>+0.01</td><td>-0.01</td></tr>
  </table>

  ${pageBreak}
  <!-- p5 U-03 单元格自带英制单位 -->
  <h2>5. 表头 mm，某单元格自带 in</h2>
  <div class="meta">第 5 页 · 场景 U-03</div>
  <table>
    <tr><th>位号</th><th>名称</th><th>基本尺寸/mm</th><th>上偏差/mm</th><th>下偏差/mm</th></tr>
    <tr><td>H</td><td>总长</td><td>2.05 in</td><td>+0.02</td><td>-0.02</td></tr>
  </table>

  ${pageBreak}
  <!-- p6 U-04 表头 mm 与正文英寸冲突 -->
  <h2>6. 表头与正文单位矛盾</h2>
  <div class="meta">第 6 页 · 场景 U-04</div>
  <table>
    <tr><th>位号</th><th>名称</th><th>基本尺寸/mm</th><th>上偏差/mm</th><th>下偏差/mm</th></tr>
    <tr><td>H</td><td>总长</td><td>52.20</td><td>+0.02</td><td>-0.02</td></tr>
  </table>
  <p>注：本页其余标注的尺寸单位为英寸。</p>

  ${pageBreak}
  <!-- p7 U-05 完全没有单位线索 -->
  <h2>7. 无任何线索的组成环表</h2>
  <div class="meta">第 7 页 · 场景 U-05</div>
  <table>
    <tr><th>位号</th><th>名称</th><th>基本尺寸</th><th>上偏差</th><th>下偏差</th></tr>
    <tr><td>H</td><td>总长</td><td>52.20</td><td>+0.02</td><td>-0.02</td></tr>
  </table>
  <p>K = 30</p>

  ${pageBreak}
  <!-- p8 U-06 跨页表格前半页 -->
  <h2>8. 跨页表（前半页在上一页，表头只在此页）</h2>
  <div class="meta">第 8 页 · 场景 U-06</div>
  <table>
    <tr><th>位号</th><th>名称</th><th>基本尺寸/mm</th><th>上偏差/mm</th><th>下偏差/mm</th></tr>
    <tr><td>H</td><td>总长</td><td>52.20</td><td>+0.02</td><td>-0.02</td></tr>
  </table>

  ${pageBreak}
  <!-- p9 U-06 续表（无表头）+ 无单位赋值 -->
  <h2>9. 跨页表续（本页无表头）</h2>
  <div class="meta">第 9 页 · 场景 U-06</div>
  <table>
    <tr><td>B1</td><td>左轴承</td><td>20.00</td><td>+0.01</td><td>-0.01</td></tr>
  </table>
  <p>K = 30</p>

  ${pageBreak}
  <!-- p10 U-07 图注带单位 -->
  <h2>10. 图注给出单位</h2>
  <div class="meta">第 10 页 · 场景 U-07</div>
  <p>C = 0.15</p>
  <p>C2 = 0.20</p>
  <p class="caption">图 3 隔套端面间隙（mm）</p>

  ${pageBreak}
  <!-- p11 U-08 mm 侧：精度与量级不放松 -->
  <h2>11. 继承 mm 仍不允许越界</h2>
  <div class="meta">第 11 页 · 场景 U-08</div>
  <p>单位：mm</p>
  <p>A = 12.34567</p>
  <p>B = 12345678</p>

  ${pageBreak}
  <!-- p12 U-08 in 侧：继承英制不换算 -->
  <h2>12. 继承到英制单位</h2>
  <div class="meta">第 12 页 · 场景 U-08</div>
  <p>单位：英寸</p>
  <p>D = 0.15</p>

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
