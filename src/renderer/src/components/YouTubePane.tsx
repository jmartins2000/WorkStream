import { forwardRef, useImperativeHandle, useRef } from 'react'
import type { WebviewElement } from '../webview'
import type { MediaHandle } from './StremioPane'

const YOUTUBE_URL = 'https://www.youtube.com/'

/** YouTube embedded as a persistent webview — stays mounted so playback survives tab switches. */
export const YouTubePane = forwardRef<MediaHandle>(function YouTubePane(_props, ref) {
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
    <div className="media-pane">
      <webview
        ref={webviewRef as never}
        src={YOUTUBE_URL}
        partition="persist:youtube"
        allowpopups
        className="media-webview"
      />
    </div>
  )
})
