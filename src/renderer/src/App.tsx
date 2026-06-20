import { useCallback, useRef, useState, type JSX } from 'react'
import { ClaudeCockpit } from './components/ClaudeCockpit'
import { StremioPane, type StremioHandle } from './components/StremioPane'
import { useClaudeRun } from './useClaudeRun'

type View = 'stremio' | 'claude'

export function App(): JSX.Element {
  const stremioRef = useRef<StremioHandle>(null)
  const [view, setView] = useState<View>('claude')
  // True after a run finishes until the user acknowledges by interacting.
  const [finishedOk, setFinishedOk] = useState<boolean | null>(null)

  // When a run finishes: pause Stremio and bring the cockpit forward.
  const handleComplete = useCallback((ok: boolean) => {
    stremioRef.current?.pause()
    setFinishedOk(ok)
    setView('claude')
  }, [])

  const run = useClaudeRun(handleComplete)

  // After sending a prompt, slide over to Stremio to watch while Claude works.
  const handlePromptSent = useCallback(() => {
    setFinishedOk(null)
    setView('stremio')
  }, [])

  const showClaude = useCallback(() => {
    setFinishedOk(null)
    setView('claude')
  }, [])

  const showStremio = useCallback(() => setView('stremio'), [])

  const running = run.status === 'running'

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo">◇</span>
          ClaudeCode · Stremio
        </div>

        <div className="topbar__status">
          {running && <span className="status status--running">● Claude working…</span>}
          {!running && finishedOk === true && (
            <span className="status status--done">✓ Claude finished</span>
          )}
          {!running && finishedOk === false && (
            <span className="status status--error">⚠ Claude stopped</span>
          )}
        </div>

        <nav className="topbar__tabs">
          <button
            type="button"
            className={'tab' + (view === 'claude' ? ' tab--active' : '')}
            onClick={showClaude}
          >
            Claude
            {!running && finishedOk !== null && view !== 'claude' && (
              <span className="tab__dot" />
            )}
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
          <ClaudeCockpit run={run} onPromptSent={handlePromptSent} />
        </div>
      </main>
    </div>
  )
}
