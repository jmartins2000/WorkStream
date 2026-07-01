import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { broadcastStremioStatus, registerIpcHandlers } from './ipc.js'
import * as stremioServer from './stremio/server.js'

// In dev mode (unpackaged), Electron doesn't reliably pick up package.json's
// name for the Dock tooltip / menu bar — it falls back to "Electron". Must be
// set before the app is ready. Packaged builds get this from the bundle
// itself (electron-builder.yml's productName), so this is a dev-only fix in
// practice, but harmless either way.
app.setName('WorkStream')

const isDev = !app.isPackaged

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 940,
    minHeight: 600,
    title: 'WorkStream',
    backgroundColor: '#0b0d12',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Required so the renderer can host Stremio inside a <webview>.
      webviewTag: true
    }
  })

  // Open target=_blank links (e.g. from Stremio) in the system browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (isDev && devServerUrl) {
    void window.loadURL(devServerUrl)
    // DevTools are opt-in (run with OPEN_DEVTOOLS=1) so normal dev use isn't
    // cluttered. Toggle anytime with Cmd+Option+I.
    if (process.env.OPEN_DEVTOOLS === '1') {
      window.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(() => {
  // Packaged builds get their icon from the app bundle automatically (see
  // electron-builder.yml's mac.icon); only dev mode needs it set explicitly.
  if (isDev) app.dock?.setIcon(join(__dirname, '../../build/icon.png'))

  registerIpcHandlers()
  createWindow()
  // Independent of which pane is visible — the webview is always mounted, so
  // the server should be warm by the time the user switches to Stremio.
  void stremioServer.start(broadcastStremioStatus)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Standard macOS behaviour: stay alive until Cmd+Q.
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stremioServer.stop()
})
