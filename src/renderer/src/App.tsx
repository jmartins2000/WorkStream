import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { ClaudeCockpit } from './components/ClaudeCockpit'
import { StremioPane, type StremioHandle } from './components/StremioPane'
import { useClaudeRun } from './useClaudeRun'
import { useTheme } from './useTheme'

type View = 'stremio' | 'claude'

export function App(): JSX.Element {
  const stremioRef = useRef<StremioHandle>(null)
  const [view, setView] = useState<View>('claude')
  const { theme, toggle } = useTheme()

  // Claude needs the user (finished, asking a question, or requesting
  // permission): pause Stremio and bring the cockpit forward.
  const handleAttention = useCallback(() => {
    stremioRef.current?.pause()
    setView('claude')
  }, [])

  const run = useClaudeRun(handleAttention)

  // User handed control back to Claude (sent a prompt or answered one): go watch.
  const handleHandOff = useCallback(() => setView('stremio'), [])

  const showClaude = useCallback(() => setView('claude'), [])

  // Stremio is "earned": you can only flip over to it while Claude is actually
  // working — actively generating or with a background task still running.
  const stremioAllowed = run.status === 'running' || run.backgroundActive
  const showStremio = useCallback(() => {
    if (stremioAllowed) setView('stremio')
  }, [stremioAllowed])

  // If Claude stops working while you're on Stremio, pull back to the cockpit.
  useEffect(() => {
    if (view === 'stremio' && !stremioAllowed) setView('claude')
  }, [view, stremioAllowed])

  // Esc interrupts a running Claude turn (like the CLI).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && run.status === 'running') run.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run])

  const needsAttention =
    view !== 'claude' && (run.status === 'awaiting-input' || run.status === 'done' || run.status === 'error')

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
              onClick={showStremio}
              disabled={!stremioAllowed}
              title={stremioAllowed ? 'Watch Stremio' : 'Available while Claude is working'}
            >
              Stremio
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
        {/* Stremio stays mounted underneath so playback/session state persist. */}
        <div className={'pane pane--stremio' + (view === 'stremio' ? ' pane--front' : '')}>
          <StremioPane ref={stremioRef} />
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
