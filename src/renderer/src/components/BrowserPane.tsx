import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type JSX } from 'react'
import type { WebviewElement } from '../webview'
import type { MediaHandle } from './StremioPane'

const HOME_URL = 'https://www.google.com/'

/** A saved favorite link shown in the favorites bar. */
interface Favorite {
  url: string
  title: string
}

const FAVORITES_KEY = 'workstream:browser-favorites'

function loadFavorites(): Favorite[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (f): f is Favorite =>
        typeof f === 'object' &&
        f !== null &&
        typeof (f as Favorite).url === 'string' &&
        typeof (f as Favorite).title === 'string'
    )
  } catch {
    return []
  }
}

function saveFavorites(favorites: Favorite[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites))
  } catch {
    // Storage may be unavailable; favorites just won't persist.
  }
}

/** Google's favicon service — no per-site probing needed. */
function faviconFor(url: string): string {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`
  } catch {
    return ''
  }
}

/**
 * A minimal in-app browser: a persistent webview with a URL bar and
 * back/forward/reload controls. Pauses all media (video + audio) when the
 * app switches back to Claude.
 */
export const BrowserPane = forwardRef<MediaHandle>(function BrowserPane(_props, ref) {
  const webviewRef = useRef<WebviewElement | null>(null)
  const [inputUrl, setInputUrl] = useState(HOME_URL)
  // The page currently loaded in the webview (as opposed to the URL bar's
  // edit state) plus its title — what the ★ button saves.
  const [currentUrl, setCurrentUrl] = useState(HOME_URL)
  const [pageTitle, setPageTitle] = useState('')
  const [favorites, setFavorites] = useState<Favorite[]>(loadFavorites)

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
    reload: () => webviewRef.current?.reload(),
    exitFullscreen: async () => {
      await webviewRef.current?.executeJavaScript(
        `document.fullscreenElement ? document.exitFullscreen() : undefined`
      )
    }
  }))

  // True while the user is editing the URL bar — never overwrite their typing.
  const editingRef = useRef(false)

  // Keep the URL bar (and the ★ button's notion of "current page") in sync
  // with the page as the user navigates; track the title for saving. Events
  // cover the common cases; a slow poll of getURL() is the safety net for
  // navigations that slip past them (redirects, SPA history, popups landing
  // back, event quirks of the <webview> tag).
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return

    const syncUrl = (url: string | undefined): void => {
      if (!url || url === 'about:blank') return
      setCurrentUrl(url)
      if (!editingRef.current) setInputUrl(url)
    }

    const onNav = (e: Event): void => {
      const detail = e as Event & { url?: string; isMainFrame?: boolean }
      if (detail.isMainFrame === false) return
      syncUrl(detail.url)
    }
    const onTitle = (e: Event): void => {
      const title = (e as Event & { title: string }).title
      if (title) setPageTitle(title)
    }

    wv.addEventListener('load-commit', onNav)
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)
    wv.addEventListener('page-title-updated', onTitle)

    // Poll as a fallback — getURL() is the ground truth of what's displayed.
    const timer = setInterval(() => {
      try {
        syncUrl(wv.getURL())
      } catch {
        // Webview not attached yet; ignore.
      }
    }, 1000)

    return () => {
      wv.removeEventListener('load-commit', onNav)
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
      wv.removeEventListener('page-title-updated', onTitle)
      clearInterval(timer)
    }
  }, [])

  const isFavorite = favorites.some((f) => f.url === currentUrl)

  const toggleFavorite = (): void => {
    setFavorites((prev) => {
      const next = isFavorite
        ? prev.filter((f) => f.url !== currentUrl)
        : [...prev, { url: currentUrl, title: pageTitle || hostnameOf(currentUrl) }]
      saveFavorites(next)
      return next
    })
  }

  const removeFavorite = (url: string): void => {
    setFavorites((prev) => {
      const next = prev.filter((f) => f.url !== url)
      saveFavorites(next)
      return next
    })
  }

  // Right-click a chip → inline rename (Electron has no window.prompt).
  const [renaming, setRenaming] = useState<{ url: string; draft: string } | null>(null)

  const commitRename = (): void => {
    if (!renaming) return
    const title = renaming.draft.trim()
    const { url } = renaming
    setRenaming(null)
    if (!title) return
    setFavorites((prev) => {
      const next = prev.map((f) => (f.url === url ? { ...f, title } : f))
      saveFavorites(next)
      return next
    })
  }

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
    setCurrentUrl(url)
    void webviewRef.current?.loadURL(url)
  }

  return (
    <div className="media-pane browser-pane">
      <BrowserNav
        url={inputUrl}
        isFavorite={isFavorite}
        onChange={setInputUrl}
        onNavigate={navigate}
        onBack={() => webviewRef.current?.goBack()}
        onForward={() => webviewRef.current?.goForward()}
        onReload={() => webviewRef.current?.reload()}
        onToggleFavorite={toggleFavorite}
        onEditingChange={(editing) => {
          editingRef.current = editing
          // On blur, snap the bar back to the real page URL.
          if (!editing) setInputUrl(currentUrl)
        }}
      />
      {favorites.length > 0 && (
        <div className="favorites-bar">
          {favorites.map((favorite) =>
            renaming?.url === favorite.url ? (
              <span key={favorite.url} className="favorite-chip favorite-chip--renaming">
                <input
                  className="favorite-chip__rename"
                  value={renaming.draft}
                  autoFocus
                  onChange={(e) => setRenaming({ url: favorite.url, draft: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  onBlur={commitRename}
                  onFocus={(e) => e.target.select()}
                  spellCheck={false}
                />
              </span>
            ) : (
              <span key={favorite.url} className="favorite-chip" title={favorite.url}>
                <button
                  type="button"
                  className="favorite-chip__link"
                  onClick={() => navigate(favorite.url)}
                  onContextMenu={(e) => {
                    // Suppress the app context menu; rename inline instead.
                    e.preventDefault()
                    setRenaming({ url: favorite.url, draft: favorite.title })
                  }}
                >
                  {faviconFor(favorite.url) && (
                    <img className="favorite-chip__icon" src={faviconFor(favorite.url)} alt="" />
                  )}
                  <span className="favorite-chip__title">{favorite.title}</span>
                </button>
                <button
                  type="button"
                  className="favorite-chip__remove"
                  title="Remove favorite"
                  onClick={() => removeFavorite(favorite.url)}
                >
                  ✕
                </button>
              </span>
            )
          )}
        </div>
      )}
      <webview
        ref={webviewRef as never}
        src={HOME_URL}
        partition="persist:browser"
        allowpopups={'true' as unknown as boolean} // string on purpose: react-dom drops boolean true (unknown attr) — see webview.d.ts
        className="media-webview"
      />
    </div>
  )
})

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function BrowserNav({
  url,
  isFavorite,
  onChange,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onToggleFavorite,
  onEditingChange
}: {
  url: string
  isFavorite: boolean
  onChange: (v: string) => void
  onNavigate: (v: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onToggleFavorite: () => void
  onEditingChange: (editing: boolean) => void
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
          if (e.key === 'Enter') {
            onNavigate(url)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        onFocus={e => {
          onEditingChange(true)
          e.target.select()
        }}
        onBlur={() => onEditingChange(false)}
        spellCheck={false}
      />
      <button
        type="button"
        className={'nav-btn nav-btn--star' + (isFavorite ? ' nav-btn--star-active' : '')}
        onClick={onToggleFavorite}
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        {isFavorite ? '★' : '☆'}
      </button>
    </div>
  )
}
