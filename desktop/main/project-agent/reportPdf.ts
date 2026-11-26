export async function printSimulationReport(html: string): Promise<Uint8Array> {
  const { BrowserWindow } = await import('electron')
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  })
  try {
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    await window.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
    return await window.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true })
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}
