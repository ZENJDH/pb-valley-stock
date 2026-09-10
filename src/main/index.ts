import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { StockDatabase } from './database'
import { registerIpc } from './ipc'
import { AlertScheduler } from './scheduler'

let database: StockDatabase | null = null
let scheduler: AlertScheduler | null = null

function createWindow(): void {
  const windowIcon = app.isPackaged
    ? join(process.resourcesPath, 'logo-pb.png')
    : join(app.getAppPath(), 'logo-pb.png')
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1050,
    minHeight: 700,
    show: false,
    backgroundColor: '#f6f7f2',
    title: 'PB Valley Stock',
    icon: windowIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.setAppUserModelId('com.pbvalley.stocktracker')

app.whenReady().then(() => {
  database = new StockDatabase(join(app.getPath('userData'), 'stock-tracker.sqlite'))
  scheduler = new AlertScheduler(database)
  registerIpc(database, scheduler)
  scheduler.start()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  scheduler?.stop()
  database?.close()
})
