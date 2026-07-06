import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  session,
  shell,
  type MenuItemConstructorOptions,
  type WebContents
} from 'electron'
import { broadcastStremioStatus, registerIpcHandlers } from './ipc.js'
import * as stremioServer from './stremio/server.js'
import { setAdblock } from './adblock.js'
import { stopCodexServer } from './codex/runner.js'

/** Partitions backing the media webviews (Stremio / YouTube / Browser). */
const WEBVIEW_PARTITIONS = ['persist:stremio', 'persist:youtube', 'persist:browser']

/**
 * Electron ships no context menu at all — build a standard one: edit actions
 * in inputs, copy for selections, link helpers, and Inspect Element (the only
 * practical way to reach a webview's DevTools).
 */
function attachContextMenu(contents: WebContents): void {
  contents.on('context-menu', (_event, params) => {
    const template: MenuItemConstructorOptions[] = []

    if (params.linkURL) {
      template.push(
        {
          label: 'Open Link in System Browser',
          click: () => void shell.openExternal(params.linkURL)
        },
        { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) },
        { type: 'separator' }
      )
    }

    if (params.isEditable) {
      template.push(
        { label: 'Cut', enabled: params.editFlags.canCut, click: () => contents.cut() },
        { label: 'Copy', enabled: params.editFlags.canCopy, click: () => contents.copy() },
        { label: 'Paste', enabled: params.editFlags.canPaste, click: () => contents.paste() },
        { label: 'Select All', click: () => contents.selectAll() },
        { type: 'separator' }
      )
    } else if (params.selectionText.trim()) {
      template.push({ label: 'Copy', click: () => contents.copy() }, { type: 'separator' })
    }

    template.push({
      label: 'Inspect Element',
      click: () => contents.inspectElement(params.x, params.y)
    })

    Menu.buildFromTemplate(template).popup()
  })
}

/**
 * Strip the app/Electron tokens from a user agent. Google (and others) refuse
 * OAuth logins from user agents that reveal an embedded browser ("this
 * browser or app may not be secure"); the remaining UA is plain Chrome.
 */
function cleanUserAgent(ua: string): string {
  return ua
    .replace(/ workstream\/\S+/i, '')
    .replace(/ Electron\/\S+/, '')
}

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

// OAuth popups (e.g. Google Sign-In on x.com) are opened from postMessage
// handlers, where the original click's user activation doesn't reach the
// webview's window.open — Chromium's popup blocker kills them before
// Electron's window-open handlers are even consulted. Disable the blocker;
// setWindowOpenHandler still gates what actually opens. Also skip FedCM
// (browser-mediated identity), which Electron doesn't implement — Google's
// sign-in library then goes straight to the popup flow instead of failing
// FedCM first.
app.commandLine.appendSwitch('disable-popup-blocking')
app.commandLine.appendSwitch('disable-features', 'FedCm')

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

  // Dev: surface the renderer's console errors in the terminal — otherwise
  // "Script failed to execute" style failures are invisible without DevTools.
  if (isDev) {
    window.webContents.on('console-message', (event, ...legacyArgs) => {
      const details = event as unknown as { level?: string | number; message?: string }
      const level = details.level ?? legacyArgs[0]
      const message = typeof details.message === 'string' ? details.message : String(legacyArgs[1] ?? '')
      if (level === 'error' || level === 3) {
        console.error(`[renderer] ${message}`)
      }
    })
  }

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

  // Present as plain Chrome on every webview session — Google login (and
  // other OAuth providers) reject user agents that reveal an embedded
  // browser. Session-level, so popup windows on the same session inherit it.
  for (const partition of WEBVIEW_PARTITIONS) {
    const s = session.fromPartition(partition)
    s.setUserAgent(cleanUserAgent(s.getUserAgent()))
  }

  // Decode-error escalation. Playback normally COPIES the source video track
  // (fast, pristine) — but a source with bytes Chromium's strict decoder
  // rejects dies with a fatal decode error. The in-page recovery script
  // (StremioPane) reloads and logs '[ws-decode-error] count=N'; on the 2nd
  // error for a stream we force the server to RE-ENCODE its video by
  // stripping the advertised videoCodecs from the HLS playlist requests —
  // ffmpeg tolerates the bad bitstream and emits a clean one, preventing
  // further decode errors on that stream at a quality/CPU cost.
  let forceTranscodeArmedUntil = 0
  const forcedMediaUrls = new Set<string>()

  session.fromPartition('persist:stremio').webRequest.onBeforeRequest(
    { urls: ['http://127.0.0.1:11470/hlsv2/*'] },
    (details, callback) => {
      try {
        const url = new URL(details.url)
        const mediaUrl = url.searchParams.get('mediaURL') ?? ''
        const armed = Date.now() < forceTranscodeArmedUntil
        if (url.searchParams.has('videoCodecs') && (armed || forcedMediaUrls.has(mediaUrl))) {
          if (mediaUrl && !forcedMediaUrls.has(mediaUrl)) {
            forcedMediaUrls.add(mediaUrl)
            console.log('[stremio] forcing video transcode for recovering stream')
          }
          url.searchParams.delete('videoCodecs')
          callback({ redirectURL: url.toString() })
          return
        }
      } catch {
        // Malformed URL — pass through untouched.
      }
      callback({})
    }
  )

  // Every webContents (main window, webviews, popups) gets a context menu;
  // webviews additionally get a window-open handler: `allowpopups` only
  // *permits* popups — without this handler window.open() silently no-ops,
  // which broke OAuth popups like "Sign in with Google" on x.com. Allowing
  // them opens a real window on the same session, so logins complete and the
  // opener gets its postMessage callback.
  app.on('web-contents-created', (_event, contents) => {
    attachContextMenu(contents)
    if (contents.getType() === 'webview') {
      contents.setWindowOpenHandler(() => ({ action: 'allow' }))

      // Custom entertainment tabs use dynamic partitions (persist:custom-*)
      // unknown at startup — give their sessions the clean UA too (idempotent
      // for the static partitions handled above).
      contents.session.setUserAgent(cleanUserAgent(contents.session.getUserAgent()))

      // Watch for the recovery script's decode-error reports. On the second
      // error for a stream, arm the force-transcode rewrite briefly — the
      // recovery reload's playlist requests then get their videoCodecs
      // stripped and the server re-encodes the video track.
      contents.on('console-message', (event, ...legacyArgs) => {
        const eventMessage = (event as unknown as { message?: string }).message
        const message =
          typeof eventMessage === 'string' ? eventMessage : String(legacyArgs[1] ?? '')
        const match = message.match(/\[ws-decode-error\] count=(\d+)/)
        if (match && Number(match[1]) >= 2) {
          forceTranscodeArmedUntil = Date.now() + 60_000
          console.log('[stremio] repeated decode errors — arming forced transcode')
        }
      })
    }
  })

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

    // Audio-state probe: every 5s, log the <video> element's audio facts from
    // inside the Stremio webview. Distinguishes "player muted / volume 0"
    // (aBytes grows while silent) from "audio track never made it into MSE"
    // (aBytes stays 0) — they need entirely different fixes.
    app.on('web-contents-created', (_event, contents) => {
      if (contents.getType() !== 'webview') return
      // Don't queue overlapping executeJavaScript calls — while a page is
      // loading they pile up (the MaxListeners did-stop-loading warning).
      let probeInFlight = false
      const timer = setInterval(() => {
        if (contents.isDestroyed()) {
          clearInterval(timer)
          return
        }
        if (probeInFlight || !contents.getURL().includes('stremio')) return
        probeInFlight = true
        void contents
          .executeJavaScript(
            `(() => {
              const v = document.querySelector('video')
              if (!v) return 'no <video> element'
              return JSON.stringify({
                muted: v.muted,
                volume: Math.round(v.volume * 100) / 100,
                paused: v.paused,
                t: Math.round(v.currentTime),
                readyState: v.readyState,
                vBytes: v.webkitVideoDecodedByteCount ?? -1,
                aBytes: v.webkitAudioDecodedByteCount ?? -1
              })
            })()`
          )
          .then((state: unknown) => {
            if (state !== 'no <video> element') console.log(`[stremio-audio] ${state}`)
          })
          .catch(() => {
            /* page navigating; ignore */
          })
          .finally(() => {
            probeInFlight = false
          })
      }, 5000)
    })
  }

  // Arm ad blocking on the built-in media partitions BEFORE the window (and
  // its always-mounted webviews) exists — otherwise YouTube's initial page
  // load races the filter engine and slips through unfiltered. The renderer
  // reconciles shortly after with the user's actual setting + custom tabs.
  void setAdblock(true, ['persist:youtube', 'persist:browser'])

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
  stopCodexServer()
})
