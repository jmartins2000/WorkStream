import { forwardRef, useEffect, useImperativeHandle, useRef, type JSX } from 'react'
import type { WebviewElement } from '../webview'
import { useStremioServer } from '../useStremioServer'

/** The hosted Stremio web app. Embedding it gives full, maintenance-free Stremio. */
const STREMIO_URL = 'https://web.stremio.com/'

/**
 * Decode-error auto-recovery, injected into the Stremio page on every load.
 *
 * Chromium's video decoder is strict — a corrupt torrent piece or unusual
 * bitstream mid-file kills playback with a fatal MediaError ("Error occurred
 * when Decoding") and the web player just gives up. mpv in the native app
 * shrugs these off. Recovery: when a hooked <video> fires a fatal error while
 * genuinely playing, remember the position in sessionStorage, reload the
 * player page, and seek back once the stream is ready again. A history guard
 * caps recoveries at 3 per 10 minutes so a truly broken file can't reload
 * forever — after that the player's own error screen stays up.
 */
const DECODE_RECOVERY_SCRIPT = `(() => {
  if (window.__wsRecoveryInstalled) return
  window.__wsRecoveryInstalled = true
  const KEY = 'ws-decode-recovery'

  // Phase 2 (after a recovery reload): seek back to where playback died.
  const pending = sessionStorage.getItem(KEY)
  if (pending) {
    sessionStorage.removeItem(KEY)
    try {
      const saved = JSON.parse(pending)
      if (Date.now() - saved.at < 120000 && saved.href === location.href) {
        const trySeek = setInterval(() => {
          const v = document.querySelector('video')
          if (v && v.readyState >= 2 && v.duration > 0) {
            clearInterval(trySeek)
            if (saved.t > 5 && saved.t < v.duration - 5) v.currentTime = saved.t
            v.play().catch(() => {})
            console.log('[workstream] recovered playback at', Math.round(saved.t) + 's')
          }
        }, 1000)
        setTimeout(() => clearInterval(trySeek), 60000)
      }
    } catch { /* corrupt state — nothing to recover */ }
  }

  // Loop guard: at most 3 recoveries per 10 minutes. Returns the recovery
  // number (1-based) or 0 when the limit is reached.
  const recoveryNumber = () => {
    let hist = []
    try { hist = JSON.parse(sessionStorage.getItem(KEY + '-hist') || '[]') } catch { hist = [] }
    const now = Date.now()
    hist = hist.filter((ts) => now - ts < 600000)
    if (hist.length >= 3) return 0
    hist.push(now)
    sessionStorage.setItem(KEY + '-hist', JSON.stringify(hist))
    return hist.length
  }

  const recover = (t) => {
    const n = recoveryNumber()
    if (!n) {
      console.log('[ws-decode-error] recovery limit reached, giving up')
      return
    }
    // The main process watches for this exact line; on the 2nd error it
    // force-transcodes this stream (strips videoCodecs from the playlist
    // requests) so the recovered playback gets a clean re-encoded stream.
    console.log('[ws-decode-error] count=' + n + ' at=' + Math.round(t) + 's')
    // Seek target only when we caught a meaningful position — otherwise let
    // Stremio's own saved watch position handle the resume.
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ t: t > 5 ? t : 0, href: location.href, at: Date.now() })
    )
    setTimeout(() => location.reload(), 800)
  }

  // Phase 1: hook every video element as the player creates them — and, as a
  // safety net, scan for elements whose .error is already set (the event can
  // be missed if the player resets the element first).
  let recovering = false
  setInterval(() => {
    document.querySelectorAll('video').forEach((v) => {
      if (!v.__wsHooked) {
        v.__wsHooked = true
        v.addEventListener('error', () => {
          // Only recover genuine mid-playback deaths, not load failures.
          if (recovering || !v.error || v.currentTime < 5) return
          recovering = true
          recover(v.currentTime)
        })
      }
      if (!recovering && v.error) {
        recovering = true
        recover(v.currentTime)
      }
    })
  }, 2000)
  console.log('[workstream] decode recovery armed')
})();`

/** Imperative controls the app uses to pause/resume playback in any media pane. */
export interface MediaHandle {
  pause: () => void
  play: () => void
  reload: () => void
  /**
   * Exit any active HTML fullscreen before handing control back to Claude.
   * Must be awaited — the pane switch should happen only after the fullscreen
   * layer has been torn down, otherwise it covers the Claude cockpit.
   */
  exitFullscreen: () => Promise<void>
}

/**
 * Hosts Stremio in an Electron <webview>. The webview stays mounted for the
 * app's lifetime so playback/session state survive when the cockpit overlays
 * it — we only toggle visibility, never unmount.
 *
 * web.stremio.com can't resolve or play any stream without the local
 * streaming server (see claude/stremioServer.ts) — an overlay covers the
 * webview until that server reports ready, instead of leaving the user
 * looking at a Stremio UI that will silently fail to play anything.
 */
export const StremioPane = forwardRef<MediaHandle>(function StremioPane(_props, ref) {
  const webviewRef = useRef<WebviewElement | null>(null)
  const { status, installRosetta } = useStremioServer()

  // (Re)install the decode-error recovery on every page load — dom-ready
  // fires per navigation, including our own recovery reloads. Also inject
  // immediately: the page may already be loaded when this effect attaches
  // (dom-ready raced the mount, or the renderer hot-reloaded), which would
  // otherwise leave the player unprotected until the next navigation. The
  // script self-guards against double installation.
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const inject = (): void => {
      void wv.executeJavaScript(DECODE_RECOVERY_SCRIPT).catch(() => {
        // Page not ready / navigating away; the next dom-ready retries.
      })
    }
    wv.addEventListener('dom-ready', inject)
    inject()
    return () => wv.removeEventListener('dom-ready', inject)
  }, [])

  useImperativeHandle(ref, () => ({
    pause: () => {
      void webviewRef.current?.executeJavaScript(
        `(() => { document.querySelectorAll('video').forEach(v => v.pause()); })();`
      )
    },
    play: () => {
      void webviewRef.current?.executeJavaScript(
        `(() => { const v = document.querySelector('video'); if (v) v.play(); })();`
      )
    },
    reload: () => webviewRef.current?.reload(),
    exitFullscreen: async () => {
      // If the page has an active fullscreen element, exit it and wait for the
      // transition to complete so the overlay is gone before we show Claude.
      await webviewRef.current?.executeJavaScript(
        `document.fullscreenElement ? document.exitFullscreen() : undefined`
      )
    }
  }))

  return (
    <div className="media-pane">
      <webview
        ref={webviewRef as never}
        src={STREMIO_URL}
        partition="persist:stremio"
        allowpopups={'true' as unknown as boolean} // string on purpose: react-dom drops boolean true (unknown attr) — see webview.d.ts
        className="media-webview"
      />
      {status.state !== 'ready' && (
        <div className="stremio-overlay">
          <StremioOverlayContent status={status} onInstallRosetta={installRosetta} />
        </div>
      )}
    </div>
  )
})

function StremioOverlayContent({
  status,
  onInstallRosetta
}: {
  status: ReturnType<typeof useStremioServer>['status']
  onInstallRosetta: () => void
}): JSX.Element {
  switch (status.state) {
    case 'starting':
      return (
        <>
          <p className="stremio-overlay__title">Starting local streaming server…</p>
          <p className="stremio-overlay__body">A moment — Stremio needs this to resolve streams.</p>
        </>
      )
    case 'installing-rosetta':
      return (
        <>
          <p className="stremio-overlay__title">Installing Rosetta…</p>
          <p className="stremio-overlay__body">Approve the password prompt to continue.</p>
        </>
      )
    case 'rosetta-required':
      return (
        <>
          <p className="stremio-overlay__title">Rosetta 2 required</p>
          <p className="stremio-overlay__body">
            Stremio&rsquo;s streaming server only ships for Intel; Apple Silicon needs Rosetta to
            run it.
          </p>
          <button type="button" className="btn btn--primary" onClick={onInstallRosetta}>
            Install Rosetta
          </button>
        </>
      )
    case 'missing-binaries':
      return (
        <>
          <p className="stremio-overlay__title">Streaming server not installed</p>
          <p className="stremio-overlay__body">
            Run <code>npm run fetch:stremio</code> in the project, then restart the app.
          </p>
        </>
      )
    case 'error':
      return (
        <>
          <p className="stremio-overlay__title">Streaming server error</p>
          <p className="stremio-overlay__body">{status.message}</p>
        </>
      )
    default:
      return <></>
  }
}
