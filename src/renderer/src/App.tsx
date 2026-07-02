import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { BrowserPane } from './components/BrowserPane'
import { ClaudeCockpit } from './components/ClaudeCockpit'
import type { MediaHandle } from './components/StremioPane'
import { StremioPane } from './components/StremioPane'
import { YouTubePane } from './components/YouTubePane'
import { useClaudeRun } from './useClaudeRun'
import { useTheme } from './useTheme'

type View = 'claude' | 'stremio' | 'youtube' | 'browser'
type MediaView = Exclude<View, 'claude'>

export function App(): JSX.Element {
  const stremioRef = useRef<MediaHandle>(null)
  const youtubeRef = useRef<MediaHandle>(null)
  const browserRef = useRef<MediaHandle>(null)

  const [view, setView] = useState<View>('claude')
  // Remember which media tab the user was last on so hand-off returns them there.
  const [lastMediaView, setLastMediaView] = useState<MediaView>('stremio')
  const { theme, toggle } = useTheme()

  // Claude needs the user: pause all media and bring the cockpit forward.
  const handleAttention = useCallback(() => {
    stremioRef.current?.pause()
    youtubeRef.current?.pause()
    browserRef.current?.pause()
    setView('claude')
  }, [])

  const run = useClaudeRun(handleAttention)

  // User sent a prompt or answered Claude — go back to whatever they were watching.
  const handleHandOff = useCallback(() => setView(lastMediaView), [lastMediaView])

  const showClaude = useCallback(() => setView('claude'), [])

  // Media tabs are "earned": only accessible while Claude is actively working.
  const mediaAllowed = run.status === 'running' || run.backgroundActive

  const showMedia = useCallback(
    (tab: MediaView) => {
      if (!mediaAllowed) return
      setView(tab)
      setLastMediaView(tab)
    },
    [mediaAllowed]
  )

  // If Claude stops working while on a media tab, pull back to the cockpit.
  useEffect(() => {
    if (view !== 'claude' && !mediaAllowed) setView('claude')
  }, [view, mediaAllowed])

  // Esc interrupts a running Claude turn (like the CLI).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && run.status === 'running') run.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run])

  const needsAttention =
    view !== 'claude' &&
    (run.status === 'awaiting-input' || run.status === 'done' || run.status === 'error')

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo">◇</span>
          <span className="topbar__name">WorkStream</span>
        </div>

        <div className="topbar__status">
          {run.status === 'running' && <span className="status status--running">● Claude working…</span>}
          {run.status === 'awaiting-input' && (
            <span className="status status--attention">◆ Claude needs you</span>
          )}
          {run.status !== 'running' && run.backgroundActive && (
            <span className="status status--running">● Background task running…</span>
          )}
          {run.status === 'done' && !run.backgroundActive && (
            <span className="status status--done">✓ Claude finished</span>
          )}
          {run.status === 'error' && <span className="status status--error">⚠ Claude stopped</span>}
        </div>

        <div className="topbar__right">
          <nav className="topbar__tabs">
            <button
              type="button"
              className={'tab' + (view === 'claude' ? ' tab--active' : '')}
              onClick={showClaude}
            >
              Claude
              {needsAttention && <span className="tab__dot" />}
            </button>
            <button
              type="button"
              className={'tab' + (view === 'stremio' ? ' tab--active' : '')}
              onClick={() => showMedia('stremio')}
              disabled={!mediaAllowed}
              title={mediaAllowed ? 'Watch Stremio' : 'Available while Claude is working'}
            >
              Stremio
            </button>
            <button
              type="button"
              className={'tab' + (view === 'youtube' ? ' tab--active' : '')}
              onClick={() => showMedia('youtube')}
              disabled={!mediaAllowed}
              title={mediaAllowed ? 'Watch YouTube' : 'Available while Claude is working'}
            >
              YouTube
            </button>
            <button
              type="button"
              className={'tab' + (view === 'browser' ? ' tab--active' : '')}
              onClick={() => showMedia('browser')}
              disabled={!mediaAllowed}
              title={mediaAllowed ? 'Browse the web' : 'Available while Claude is working'}
            >
              Browser
            </button>
          </nav>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggle}
            title={theme === 'dark' ? 'Switch to Daylight' : 'Switch to Lamplight'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
          </button>
        </div>
      </header>

      <main className="stage">
        {/* All panes stay mounted so playback/session state survive tab switches. */}
        <div className={'pane pane--media' + (view === 'stremio' ? ' pane--front' : '')}>
          <StremioPane ref={stremioRef} />
        </div>
        <div className={'pane pane--media' + (view === 'youtube' ? ' pane--front' : '')}>
          <YouTubePane ref={youtubeRef} />
        </div>
        <div className={'pane pane--media' + (view === 'browser' ? ' pane--front' : '')}>
          <BrowserPane ref={browserRef} />
        </div>
        <div className={'pane pane--claude' + (view === 'claude' ? ' pane--front' : '')}>
          <ClaudeCockpit run={run} onHandOff={handleHandOff} />
        </div>
      </main>
    </div>
  )
}

function SunIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
    </svg>
  )
}

function MoonIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
    </svg>
  )
}
