import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { ClaudeCockpit } from './components/ClaudeCockpit'
import { StremioPane, type StremioHandle } from './components/StremioPane'
import { useClaudeRun } from './useClaudeRun'

type View = 'stremio' | 'claude'

export function App(): JSX.Element {
  const stremioRef = useRef<StremioHandle>(null)
  const [view, setView] = useState<View>('claude')

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
  const showStremio = useCallback(() => setView('stremio'), [])

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
          ClaudeCode · Stremio
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
          >
            Stremio
          </button>
        </nav>
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
