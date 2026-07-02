import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type JSX } from 'react'
import type { WebviewElement } from '../webview'
import type { MediaHandle } from './StremioPane'

const HOME_URL = 'https://www.google.com/'

/**
 * A minimal in-app browser: a persistent webview with a URL bar and
 * back/forward/reload controls. Pauses all media (video + audio) when the
 * app switches back to Claude.
 */
export const BrowserPane = forwardRef<MediaHandle>(function BrowserPane(_props, ref) {
  const webviewRef = useRef<WebviewElement | null>(null)
  const [inputUrl, setInputUrl] = useState(HOME_URL)

  useImperativeHandle(ref, () => ({
    pause: () => {
      void webviewRef.current?.executeJavaScript(
        `(() => { document.querySelectorAll('video, audio').forEach(v => v.pause()); })();`
      )
    },
    play: () => {
      void webviewRef.current?.executeJavaScript(
        `(() => { const v = document.querySelector('video, audio'); if (v) v.play(); })();`
      )
    },
    reload: () => webviewRef.current?.reload()
  }))

  // Keep the URL bar in sync with the page as the user navigates.
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const onNav = (e: Event): void => {
      const url = (e as Event & { url: string }).url
      if (url) setInputUrl(url)
    }
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)
    return () => {
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
    }
  }, [])

  const navigate = (raw: string): void => {
    let url = raw.trim()
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      // Looks like a bare domain → add https; otherwise treat as a search query.
      if (/^[^\s/]+\.[^\s/]+/.test(url)) {
        url = 'https://' + url
      } else {
        url = `https://www.google.com/search?q=${encodeURIComponent(url)}`
      }
    }
    setInputUrl(url)
    void webviewRef.current?.loadURL(url)
  }

  return (
    <div className="media-pane browser-pane">
      <BrowserNav
        url={inputUrl}
        onChange={setInputUrl}
        onNavigate={navigate}
        onBack={() => webviewRef.current?.goBack()}
        onForward={() => webviewRef.current?.goForward()}
        onReload={() => webviewRef.current?.reload()}
      />
      <webview
        ref={webviewRef as never}
        src={HOME_URL}
        partition="persist:browser"
        allowpopups
        className="media-webview"
      />
    </div>
  )
})

function BrowserNav({
  url,
  onChange,
  onNavigate,
  onBack,
  onForward,
  onReload
}: {
  url: string
  onChange: (v: string) => void
  onNavigate: (v: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
}): JSX.Element {
  return (
    <div className="browser-nav">
      <button type="button" className="nav-btn" onClick={onBack} title="Back">
        ‹
      </button>
      <button type="button" className="nav-btn" onClick={onForward} title="Forward">
        ›
      </button>
      <button type="button" className="nav-btn" onClick={onReload} title="Reload">
        ↻
      </button>
      <input
        type="text"
        className="browser-url"
        value={url}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') onNavigate(url)
        }}
        onFocus={e => e.target.select()}
        spellCheck={false}
      />
    </div>
  )
}
