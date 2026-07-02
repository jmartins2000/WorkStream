import { forwardRef, useImperativeHandle, useRef, type JSX } from 'react'
import type { WebviewElement } from '../webview'
import { useStremioServer } from '../useStremioServer'

/** The hosted Stremio web app. Embedding it gives full, maintenance-free Stremio. */
const STREMIO_URL = 'https://web.stremio.com/'

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
        allowpopups
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
