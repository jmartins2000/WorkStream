import { useCallback, useEffect, useState, type JSX } from 'react'
import type {
  CodexAccount,
  CodexModel,
  CodexRunSettings,
  CodexThreadSummary
} from '../../../shared/types'
import type { UseCodexRun } from '../useCodexRun'
import { CodexTranscript } from './CodexTranscript'
import { CodexComposer, ACCESS_MODES } from './CodexComposer'
import { CodexDiffPane } from './CodexDiffPane'

type Gate = 'checking' | 'not-installed' | 'login' | 'ready'

/**
 * Codex keeps its own recent-projects list (localStorage) — deliberately NOT
 * derived from Claude's ~/.claude project store; the two agents' worlds stay
 * separate.
 */
const RECENTS_KEY = 'workstream:codex-recent-projects'

function loadRecents(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

function saveRecents(recents: string[]): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, 10)))
  } catch {
    // non-fatal
  }
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function relativeTime(ms: number | null): string {
  if (!ms) return ''
  const minutes = Math.round((Date.now() - ms) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

interface CodexCockpitProps {
  run: UseCodexRun
  /** Hand control back (user sent a prompt / answered) → show media. */
  onHandOff: () => void
}

/**
 * The Codex workspace, styled after the Codex desktop app: its own dark
 * monochrome theme (independent of the app theme), three-pane layout —
 * threads sidebar | conversation | diff review — inline approvals, and a
 * composer with model/effort/access pills. Backed by the lazy app-server:
 * nothing spawns until this component asks for account state, which only
 * happens once the user opens the tab.
 */
export function CodexCockpit({ run, onHandOff }: CodexCockpitProps): JSX.Element {
  const [recents, setRecents] = useState<string[]>(loadRecents)
  const [cwd, setCwd] = useState(() => loadRecents()[0] ?? '')
  const [gate, setGate] = useState<Gate>('checking')
  const [account, setAccount] = useState<CodexAccount | null>(null)
  const [models, setModels] = useState<CodexModel[]>([])
  const [threads, setThreads] = useState<CodexThreadSummary[]>([])
  const [settings, setSettings] = useState<CodexRunSettings>({
    ...ACCESS_MODES[1].settings // Agent (workspace write, ask on request)
  })
  const [accessMode, setAccessMode] = useState('agent')
  const [loggingIn, setLoggingIn] = useState(false)
  const [gateError, setGateError] = useState<string | null>(null)
  const [diffOpen, setDiffOpen] = useState(true)

  const openProject = useCallback((path: string) => {
    setCwd(path)
    setRecents((prev) => {
      const next = [path, ...prev.filter((p) => p !== path)]
      saveRecents(next)
      return next
    })
  }, [])

  const chooseFolder = useCallback(async () => {
    const picked = await window.claude.pickFolder()
    if (picked) openProject(picked)
  }, [openProject])

  const loadReady = useCallback(async () => {
    const modelList = await window.claude.codexModels()
    setModels(modelList)
    const def = modelList.find((m) => m.isDefault) ?? modelList[0]
    if (def) {
      setSettings((prev) => ({
        ...prev,
        model: prev.model ?? def.id,
        effort: prev.effort ?? def.defaultEffort
      }))
    }
    setGate('ready')
  }, [])

  // Gate: installed? → authenticated? → ready. The account check is the lazy
  // server's spawn moment — i.e. the first time the user opens this tab.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { installed } = await window.claude.codexInstalled()
        if (cancelled) return
        if (!installed) {
          setGate('not-installed')
          return
        }
        const acc = await window.claude.codexAccount()
        if (cancelled) return
        setAccount(acc)
        if (!acc.authenticated) {
          setGate('login')
          return
        }
        await loadReady()
      } catch (err) {
        if (!cancelled) {
          setGateError(err instanceof Error ? err.message : String(err))
          setGate('not-installed')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadReady])

  const refreshThreads = useCallback(async () => {
    if (!cwd || gate !== 'ready') return
    try {
      setThreads(await window.claude.codexThreads(cwd))
    } catch {
      setThreads([])
    }
  }, [cwd, gate])

  useEffect(() => {
    void refreshThreads()
  }, [refreshThreads])

  useEffect(() => {
    if (run.threadId) void refreshThreads()
  }, [run.threadId, refreshThreads])

  const handleLogin = async (): Promise<void> => {
    setLoggingIn(true)
    setGateError(null)
    try {
      const result = await window.claude.codexLogin()
      if (result.success) {
        setAccount(await window.claude.codexAccount())
        await loadReady()
      } else {
        setGateError(result.error ?? 'Login failed.')
      }
    } finally {
      setLoggingIn(false)
    }
  }

  const handleSelectThread = async (thread: CodexThreadSummary): Promise<void> => {
    openProject(thread.cwd)
    const messages = await window.claude.codexThreadMessages(thread.threadId)
    run.setMessages(messages, thread.threadId)
  }

  const handleSend = (prompt: string): void => {
    if (!cwd) return
    void run.start(prompt, cwd, settings)
    onHandOff()
  }

  const handleRespond: typeof run.respond = (response) => {
    run.respond(response)
    onHandOff()
  }

  const handleAccessMode = (id: string): void => {
    setAccessMode(id)
    const mode = ACCESS_MODES.find((m) => m.id === id)
    if (mode) setSettings((prev) => ({ ...prev, ...mode.settings }))
  }

  const running = run.status === 'running'
  const activeThread = threads.find((t) => t.threadId === run.threadId)

  if (gate !== 'ready') {
    return (
      <div className="codex-root">
        <div className="cx-gate">
          {gate === 'checking' && <p className="cx-gate__text">Connecting to Codex…</p>}
          {gate === 'not-installed' && (
            <>
              <div className="cx-gate__logo">◎</div>
              <h2 className="cx-gate__title">Codex isn&rsquo;t installed</h2>
              <p className="cx-gate__text">
                Install the Codex app or run <code>npm i -g @openai/codex</code>, then reopen
                this tab.
              </p>
              {gateError && <p className="cx-gate__error">{gateError}</p>}
            </>
          )}
          {gate === 'login' && (
            <>
              <div className="cx-gate__logo">◎</div>
              <h2 className="cx-gate__title">Sign in to Codex</h2>
              <p className="cx-gate__text">
                Uses your ChatGPT account (Plus/Pro) or an OpenAI API key. Sign-in opens in
                your browser.
              </p>
              <button
                type="button"
                className="cx-btn cx-btn--primary"
                onClick={() => void handleLogin()}
                disabled={loggingIn}
              >
                {loggingIn ? 'Waiting for browser…' : 'Sign in with ChatGPT'}
              </button>
              {gateError && <p className="cx-gate__error">{gateError}</p>}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="codex-root">
      <aside className="cx-sidebar">
        <div className="cx-project-row">
          {recents.length > 0 ? (
            <select
              className="cx-project"
              value={cwd}
              onChange={(event) => openProject(event.target.value)}
            >
              {recents.map((path) => (
                <option key={path} value={path} title={path}>
                  {basename(path)}
                </option>
              ))}
            </select>
          ) : (
            <span className="cx-project cx-project--empty">No project</span>
          )}
          <button
            type="button"
            className="cx-project-pick"
            onClick={() => void chooseFolder()}
            title="Open a project folder"
          >
            …
          </button>
        </div>
        {cwd && (
          <div className="cx-cwd" title={cwd}>
            {cwd}
          </div>
        )}

        <button type="button" className="cx-newthread" onClick={() => run.setMessages([], null)}>
          + New thread
        </button>

        <div className="cx-threads">
          {threads.map((thread) => (
            <button
              key={thread.threadId}
              type="button"
              className={
                'cx-thread' + (thread.threadId === run.threadId ? ' cx-thread--active' : '')
              }
              onClick={() => void handleSelectThread(thread)}
            >
              <span className="cx-thread__title">{thread.title}</span>
              <span className="cx-thread__time">{relativeTime(thread.updatedAt)}</span>
            </button>
          ))}
          {threads.length === 0 && <p className="cx-threads__empty">No threads yet</p>}
        </div>

        {account?.planType === 'free' && (
          <div className="cx-plan-warning">
            Free ChatGPT plan — turns need Plus/Pro or an API key.
          </div>
        )}
      </aside>

      <section className="cx-main">
        <header className="cx-header">
          <span className="cx-header__title">
            {activeThread?.title ?? (run.threadId ? 'Thread' : 'New thread')}
          </span>
          <span className="cx-header__badges">
            <span className="cx-badge">Local</span>
            {run.usage && (
              <span className="cx-header__usage">
                {run.usage.inputTokens.toLocaleString()} in ·{' '}
                {run.usage.outputTokens.toLocaleString()} out
              </span>
            )}
            {run.diff && (
              <button
                type="button"
                className={'cx-badge cx-badge--button' + (diffOpen ? ' cx-badge--on' : '')}
                onClick={() => setDiffOpen((o) => !o)}
              >
                Diff
              </button>
            )}
          </span>
        </header>

        <CodexTranscript
          messages={run.messages}
          streamingText={run.streamingText}
          running={running}
          plan={run.plan}
          pendingRequest={run.pendingRequest}
          onRespond={handleRespond}
        />

        {run.error && <div className="cx-error">{run.error}</div>}

        <CodexComposer
          running={running}
          disabled={!cwd || run.status === 'awaiting-input'}
          models={models}
          settings={settings}
          accessMode={accessMode}
          onSettingsChange={setSettings}
          onAccessModeChange={handleAccessMode}
          onSend={handleSend}
          onCancel={run.cancel}
        />
      </section>

      {run.diff && diffOpen && <CodexDiffPane diff={run.diff} onClose={() => setDiffOpen(false)} />}
    </div>
  )
}
