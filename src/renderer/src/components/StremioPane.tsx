import { forwardRef, useImperativeHandle, useRef } from 'react'
import type { WebviewElement } from '../webview'

/** The hosted Stremio web app. Embedding it gives full, maintenance-free Stremio. */
const STREMIO_URL = 'https://web.stremio.com/'

/** Imperative controls the app uses to pause playback when a run finishes. */
export interface StremioHandle {
  /** Pause every <video> currently playing inside Stremio. */
  pause: () => void
  /** Resume the most recently paused video. */
  play: () => void
  reload: () => void
}

/**
 * Hosts Stremio in an Electron <webview>. The webview stays mounted for the
 * app's lifetime so playback/session state survive when the cockpit overlays
 * it — we only toggle visibility, never unmount.
 */
export const StremioPane = forwardRef<StremioHandle>(function StremioPane(_props, ref) {
  const webviewRef = useRef<WebviewElement | null>(null)

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
    reload: () => webviewRef.current?.reload()
  }))

  return (
    <webview
      ref={webviewRef as never}
      src={STREMIO_URL}
      partition="persist:stremio"
      allowpopups
      className="stremio-webview"
    />
  )
})
