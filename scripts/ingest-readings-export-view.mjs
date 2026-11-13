import { app, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
const root = process.cwd()
const out = path.join(root, 'docs/evidence/ingest-readings')
app.setPath('userData', path.join(process.env.TMPDIR ?? path.join(root, '../tmp'), 'ingest-export-view'))
app.whenReady().then(async () => {
try {
  const svg = (await fs.readdir(out)).find((file) => file.endsWith('.svg'))
  if (!svg) throw new Error('Missing real product SVG export')
  const win = new BrowserWindow({ width: 1500, height: 1100, show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
  await win.loadFile(path.join(out, svg))
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  const text = await win.webContents.executeJavaScript('document.documentElement.textContent')
  if (!text.includes('读数来源') || !text.includes('验收转录') || !text.includes('第 3 页')) throw new Error('Export provenance missing')
  await fs.writeFile(path.join(out, 'screenshots/05-export-title-source.png'), (await win.webContents.capturePage()).toPNG())
  console.log('Actual exported SVG rendered, provenance checked, screenshot captured')
  win.destroy()
} finally { app.quit() }
}).catch((error) => { console.error(error); app.exit(1) })
