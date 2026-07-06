import { useCallback, useEffect, useState, type JSX } from 'react'
import type {
  CodexAccount,
  CodexModel,
  CodexRunSettings,
  CodexThreadSummary
} from '../../../shared/types'
import type { UseCodexRun } from '../useCodexRun'
import { useSessions } from '../useSessions'
import { Transcript } from './Transcript'
import { Composer } from './Composer'
import { InputPanel } from './InputPanel'

type Gate = 'checking' | 'not-installed' | 'login' | 'ready'

const APPROVAL_OPTIONS: { value: NonNullable<CodexRunSettings['approvalPolicy']>; label: string }[] = [
  { value: 'untrusted', label: 'Ask (untrusted)' },
  { value: 'onRequest', label: 'On request' },
  { value: 'never', label: 'Never ask' }
]

const SANDBOX_OPTIONS: { value: NonNullable<CodexRunSettings['sandbox']>; label: string }[] = [
  { value: 'readOnly', label: 'Read-only' },
  { value: 'workspaceWrite', label: 'Workspace' },
  { value: 'dangerFullAccess', label: 'Full access' }
]

interface CodexCockpitProps {
  run: UseCodexRun
  /** Hand control back (user sent a prompt / answered) → show media. */
  onHandOff: () => void
}

/**
 * The Codex workspace: thread browser + transcript + composer, backed by the
 * lazy app-server (nothing spawns until this component asks for account
 * state — which only happens once the user actually opens the Codex tab).
 */
export function CodexCockpit({ run, onHandOff }: CodexCockpitProps): JSX.Element {
  const sessions = useSessions()
  const [cwd, setCwd] = useState('')
  const [gate, setGate] = useState<Gate>('checking')
  const [account, setAccount] = useState<CodexAccount | null>(null)
  const [models, setModels] = useState<CodexModel[]>([])
  const [threads, setThreads] = useState<CodexThreadSummary[]>([])
  const [settings, setSettings] = useState<CodexRunSettings>({
    approvalPolicy: 'onRequest',
    sandbox: 'workspaceWrite'
  })
  const [loggingIn, setLoggingIn] = useState(false)
  const [gateError, setGateError] = useState<string | null>(null)

  // Default the working directory to the selected project's path (shared
  // project selector semantics with the Claude cockpit).
  useEffect(() => {
    if (sessions.selectedProject) setCwd(sessions.selectedProject.cwd)
  }, [sessions.selectedProject])

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

  // Gate: installed? → authenticated? → ready. Spawns the server lazily on
  // the account check, which is exactly "the user opened the Codex tab".
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

  // New threads appear once a run starts — refresh when the id changes.
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
    setCwd(thread.cwd)
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

  const running = run.status === 'running'
  const awaitingInput = run.status === 'awaiting-input'
  const selectedModel = models.find((m) => m.id === settings.model)

  if (gate !== 'ready') {
    return (
      <div className="cockpit codex-gate">
        <div className="codex-gate__body">
          {gate === 'checking' && <p className="info-empty">Checking Codex…</p>}
          {gate === 'not-installed' && (
            <>
              <h2 className="codex-gate__title">Codex isn&rsquo;t installed</h2>
              <p className="codex-gate__text">
                Install the Codex app (codex.openai.com) or run{' '}
                <code>npm i -g @openai/codex</code>, then reopen this tab.
              </p>
              {gateError && <p className="error-banner">{gateError}</p>}
            </>
          )}
          {gate === 'login' && (
            <>
              <h2 className="codex-gate__title">Sign in to Codex</h2>
              <p className="codex-gate__text">
                Codex uses your ChatGPT account (Plus/Pro) or an OpenAI API key. The sign-in
                opens in your browser.
              </p>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void handleLogin()}
                disabled={loggingIn}
              >
                {loggingIn ? 'Waiting for browser…' : 'Sign in with ChatGPT'}
              </button>
              {gateError && <p className="error-banner">{gateError}</p>}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="cockpit">
      <aside className="sidebar">
        <div className="sidebar__section">
          <div className="sidebar__header">
            <span>Project</span>
          </div>
          <select
            className="sidebar__select"
            value={sessions.selectedProject?.dirName ?? ''}
            onChange={(event) => {
              const project = sessions.projects.find((p) => p.dirName === event.target.value)
              if (project) sessions.selectProject(project)
            }}
          >
            {sessions.projects.map((project) => (
              <option key={project.dirName} value={project.dirName}>
                {project.cwd.split('/').filter(Boolean).pop()}
              </option>
            ))}
          </select>
          {cwd && <div className="sidebar__cwd">{cwd}</div>}
          {account?.planType === 'free' && (
            <div className="codex-plan-warning">
              ChatGPT plan: free — Codex turns need Plus/Pro or an API key.
            </div>
          )}
        </div>

        <div className="sidebar__section sidebar__section--grow">
          <div className="sidebar__header">
            <span>Threads</span>
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => run.setMessages([], null)}
            >
              + New
            </button>
          </div>
          <ul className="session-list">
            {threads.length === 0 && <li className="session-list__empty">No threads yet</li>}
            {threads.map((thread) => (
              <li
                key={thread.threadId}
                className={
                  'session-row' +
                  (thread.threadId === run.threadId ? ' session-row--active' : '')
                }
              >
                <button
                  type="button"
                  className="session-item"
                  onClick={() => void handleSelectThread(thread)}
                >
                  <span className="session-item__title">{thread.title}</span>
                  <span className="session-item__meta">
                    {thread.updatedAt ? new Date(thread.updatedAt).toLocaleString() : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <section className="cockpit__main">
        <div className="cockpit__bar">
          <div className="run-settings">
            <label className="run-settings__field">
              <span>Model</span>
              <select
                value={settings.model ?? ''}
                onChange={(e) => {
                  const model = models.find((m) => m.id === e.target.value)
                  setSettings((prev) => ({
                    ...prev,
                    model: e.target.value,
                    effort: model?.defaultEffort ?? prev.effort
                  }))
                }}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="run-settings__field">
              <span>Effort</span>
              <select
                value={settings.effort ?? ''}
                onChange={(e) => setSettings((prev) => ({ ...prev, effort: e.target.value }))}
              >
                {(selectedModel?.efforts ?? []).map((effort) => (
                  <option key={effort} value={effort}>
                    {effort}
                  </option>
                ))}
              </select>
            </label>
            <label className="run-settings__field">
              <span>Approvals</span>
              <select
                value={settings.approvalPolicy}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    approvalPolicy: e.target.value as CodexRunSettings['approvalPolicy']
                  }))
                }
              >
                {APPROVAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="run-settings__field">
              <span>Sandbox</span>
              <select
                value={settings.sandbox}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    sandbox: e.target.value as CodexRunSettings['sandbox']
                  }))
                }
              >
                {SANDBOX_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="cockpit__bar-right">
            {run.usage && (
              <span className="usage" title="Tokens used in this thread">
                {run.usage.inputTokens.toLocaleString()} in /{' '}
                {run.usage.outputTokens.toLocaleString()} out
              </span>
            )}
          </div>
        </div>

        <Transcript
          messages={run.messages}
          streamingText={run.streamingText}
          running={running}
        />
        {run.error && <div className="error-banner">{run.error}</div>}
        {run.pendingRequest && <InputPanel request={run.pendingRequest} onRespond={handleRespond} />}
        <Composer
          running={running}
          disabled={!cwd || awaitingInput}
          commands={[]}
          onSend={handleSend}
          onCancel={run.cancel}
        />
      </section>
    </div>
  )
}
