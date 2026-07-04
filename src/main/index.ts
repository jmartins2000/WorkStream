import { join } from 'node:path'
import { app, BrowserWindow, session, shell } from 'electron'
import { broadcastStremioStatus, registerIpcHandlers } from './ipc.js'
import * as stremioServer from './stremio/server.js'

// In dev mode (unpackaged), Electron doesn't reliably pick up package.json's
// name for the Dock tooltip / menu bar — it falls back to "Electron". Must be
// set before the app is ready. Packaged builds get this from the bundle
// itself (electron-builder.yml's productName), so this is a dev-only fix in
// practice, but harmless either way.
app.setName('WorkStream')

// Allow the Stremio webview to autoplay audio/video without requiring a prior
// user gesture. Chromium's default policy forces media that starts before any
// user interaction to use muted=true — the web player then can't unmute itself,
// producing silent video. Must be set before app.whenReady().
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

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

  // Grant all permission requests from the Stremio webview (audio, video,
  // fullscreen, etc.). Without this the session may block audio playback.
  session.fromPartition('persist:stremio').setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(true)
  )

  // Opt-in diagnostics (STREMIO_DEBUG=1): log every request the Stremio webview
  // makes to the local streaming server (127.0.0.1:11470) with its duration.
  // This reveals whether playback goes through the transcoder (/hlsv2/…, slow
  // under Rosetta) or direct play, and which request eats the load time.
  if (process.env.STREMIO_DEBUG === '1') {
    const wr = session.fromPartition('persist:stremio').webRequest
    const starts = new Map<number, number>()
    const isServer = (url: string): boolean =>
      url.includes('127.0.0.1:11470') || url.includes('localhost:11470')
    // Trim query/hash so the log stays readable but keeps the routing prefix.
    const shorten = (url: string): string => url.split('?')[0].slice(0, 140)
    wr.onSendHeaders((details) => {
      if (isServer(details.url)) starts.set(details.id, Date.now())
    })
    const finish = (details: { id: number; url: string; method: string }, label: string): void => {
      if (!isServer(details.url)) return
      const started = starts.get(details.id)
      starts.delete(details.id)
      const ms = started ? Date.now() - started : -1
      console.log(`[stremio-net] ${label} ${ms}ms ${details.method} ${shorten(details.url)}`)
    }
    wr.onCompleted((details) => finish(details, String(details.statusCode)))
    wr.onErrorOccurred((details) => finish(details, `ERR:${details.error}`))
  }

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
