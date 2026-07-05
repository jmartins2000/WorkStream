import { useCallback, useEffect, useState, type JSX } from 'react'
import type {
  AgentSummary,
  CommandSummary,
  ContextUsage,
  McpServerInfo
} from '../../../shared/types'

type Tab = 'context' | 'mcp' | 'agents' | 'commands'

const TABS: { id: Tab; label: string }[] = [
  { id: 'context', label: 'Context' },
  { id: 'mcp', label: 'MCP' },
  { id: 'agents', label: 'Agents' },
  { id: 'commands', label: 'Commands' }
]

interface SessionInfoPanelProps {
  /** Live streaming session id, or null when no session is live. */
  runId: string | null
  onClose: () => void
}

/**
 * Session introspection panel mirroring the CLI's /context, /mcp, /agents and
 * /skills views. All four tabs query the live session's control APIs, so the
 * panel needs a running (or at least open) streaming session.
 */
export function SessionInfoPanel({ runId, onClose }: SessionInfoPanelProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('context')

  return (
    <>
      <div className="settings-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="settings-panel" aria-label="Session info">
        <div className="settings-panel__header">
          <h2 className="settings-panel__title">Session</h2>
          <button
            type="button"
            className="settings-panel__close"
            onClick={onClose}
            aria-label="Close session info"
          >
            ✕
          </button>
        </div>

        <div className="info-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={'info-tab' + (tab === t.id ? ' info-tab--active' : '')}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="settings-panel__body">
          {runId === null ? (
            <p className="info-empty">Connecting to the session…</p>
          ) : (
            <>
              {tab === 'context' && <ContextTab runId={runId} />}
              {tab === 'mcp' && <McpTab runId={runId} />}
              {tab === 'agents' && <AgentsTab runId={runId} />}
              {tab === 'commands' && <CommandsTab runId={runId} />}
            </>
          )}
        </div>
      </aside>
    </>
  )
}

/**
 * Shared fetch wrapper: loading / gone / data states for a control API call.
 * Retries a couple of times on null — a freshly warm-opened session's CLI may
 * still be booting when the first request goes out.
 */
function useControlData<T>(runId: string, fetcher: (runId: string) => Promise<T | null>): {
  data: T | null
  loading: boolean
  refresh: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)

  const refresh = useCallback(() => {
    setLoading(true)
    setAttempt((a) => a + 1)
  }, [])

  useEffect(() => {
    setData(null)
    setLoading(true)
    setAttempt(0)
  }, [runId])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    fetcher(runId)
      .then((result) => {
        if (cancelled) return
        setData(result)
        if (result === null && attempt < 3) {
          timer = setTimeout(() => setAttempt((a) => a + 1), 1200)
        } else {
          setLoading(false)
        }
      })
      .catch(() => {
        if (cancelled) return
        setData(null)
        setLoading(false)
      })
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [runId, fetcher, attempt])

  return { data, loading, refresh }
}

const fetchContext = (runId: string): Promise<ContextUsage | null> =>
  window.claude.getContextUsage(runId)

function ContextTab({ runId }: { runId: string }): JSX.Element {
  const { data, loading, refresh } = useControlData(runId, fetchContext)

  if (!data && loading) return <p className="info-empty">Measuring context…</p>
  if (!data) return <p className="info-empty">Context usage unavailable for this session.</p>

  const pct = Math.min(100, Math.round(data.percentage))
  return (
    <section className="settings-section">
      <div className="context-meter" title={`${data.totalTokens.toLocaleString()} of ${data.maxTokens.toLocaleString()} tokens`}>
        <div
          className={'context-meter__fill' + (pct > 80 ? ' context-meter__fill--high' : '')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="context-meter__label">
        {data.totalTokens.toLocaleString()} / {data.maxTokens.toLocaleString()} tokens ({pct}%) ·{' '}
        {data.model}
      </p>
      <ul className="info-list">
        {data.categories
          .filter((c) => c.tokens > 0)
          .sort((a, b) => b.tokens - a.tokens)
          .map((c) => (
            <li key={c.name} className="info-list__item">
              <span className="info-list__name">{c.name}</span>
              <span className="info-list__meta">{c.tokens.toLocaleString()} tokens</span>
            </li>
          ))}
      </ul>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        onClick={refresh}
        disabled={loading}
      >
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
    </section>
  )
}

const fetchMcp = (runId: string): Promise<McpServerInfo[] | null> =>
  window.claude.getMcpStatus(runId)

const MCP_STATUS_ICON: Record<McpServerInfo['status'], string> = {
  connected: '●',
  failed: '✕',
  'needs-auth': '🔑',
  pending: '…',
  disabled: '○'
}

function McpTab({ runId }: { runId: string }): JSX.Element {
  const { data, loading, refresh } = useControlData(runId, fetchMcp)
  // Server name an action is currently running for, or null.
  const [busy, setBusy] = useState<string | null>(null)
  // Last action failure, shown inline under the server it belongs to.
  const [actionError, setActionError] = useState<{ server: string; message: string } | null>(null)

  const act = async (server: string, action: () => Promise<void>): Promise<void> => {
    setBusy(server)
    setActionError(null)
    try {
      await action()
    } catch (err) {
      setActionError({ server, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
      refresh()
    }
  }

  // Keep the list rendered during refreshes — only blank it before first data.
  if (!data && loading) return <p className="info-empty">Checking MCP servers…</p>
  if (!data) return <p className="info-empty">MCP status unavailable for this session.</p>
  if (data.length === 0) return <p className="info-empty">No MCP servers configured.</p>

  return (
    <section className="settings-section">
      <ul className="info-list">
        {data.map((server) => {
          const isBusy = busy === server.name
          const disabled = server.status === 'disabled'
          return (
            <li key={server.name} className="info-list__item info-list__item--stacked">
              <span className="info-list__name">
                <span className={`mcp-status mcp-status--${server.status}`}>
                  {MCP_STATUS_ICON[server.status]}
                </span>{' '}
                {server.name}
                <span className="info-list__meta">
                  {' '}
                  · {server.status}
                  {server.scope ? ` · ${server.scope}` : ''}
                  {server.tools.length > 0 ? ` · ${server.tools.length} tools` : ''}
                </span>
              </span>
              {server.error && <span className="info-list__error">{server.error}</span>}
              {server.status === 'needs-auth' && (
                <span className="info-list__desc">
                  Authenticate once with <code>claude /mcp</code> in a terminal — the credentials
                  land in the shared ~/.claude store and this app picks them up (Reconnect after).
                </span>
              )}
              {actionError?.server === server.name && (
                <span className="info-list__error">{actionError.message}</span>
              )}
              <span className="mcp-actions">
                {!disabled && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    disabled={isBusy}
                    onClick={() =>
                      void act(server.name, () =>
                        window.claude.reconnectMcpServer(runId, server.name)
                      )
                    }
                  >
                    {isBusy ? 'Working…' : 'Reconnect'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  disabled={isBusy}
                  onClick={() =>
                    void act(server.name, () =>
                      window.claude.toggleMcpServer(runId, server.name, disabled)
                    )
                  }
                >
                  {isBusy ? 'Working…' : disabled ? 'Enable' : 'Disable'}
                </button>
              </span>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        onClick={refresh}
        disabled={loading}
      >
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
    </section>
  )
}

const fetchAgents = (runId: string): Promise<AgentSummary[] | null> =>
  window.claude.getAgents(runId)

function AgentsTab({ runId }: { runId: string }): JSX.Element {
  const { data, loading } = useControlData(runId, fetchAgents)

  if (loading) return <p className="info-empty">Loading agents…</p>
  if (!data) return <p className="info-empty">Agent list unavailable for this session.</p>
  if (data.length === 0) return <p className="info-empty">No subagents available.</p>

  return (
    <section className="settings-section">
      <ul className="info-list">
        {data.map((agent) => (
          <li key={agent.name} className="info-list__item info-list__item--stacked">
            <span className="info-list__name">
              {agent.name}
              {agent.model && <span className="info-list__meta"> · {agent.model}</span>}
            </span>
            <span className="info-list__desc">{agent.description}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

const fetchCommands = (runId: string): Promise<CommandSummary[] | null> =>
  window.claude.getCommands(runId)

function CommandsTab({ runId }: { runId: string }): JSX.Element {
  const { data, loading } = useControlData(runId, fetchCommands)
  const [filter, setFilter] = useState('')

  if (loading) return <p className="info-empty">Loading commands…</p>
  if (!data) return <p className="info-empty">Command list unavailable for this session.</p>

  const visible = data.filter(
    (c) =>
      !filter ||
      c.name.toLowerCase().includes(filter.toLowerCase()) ||
      c.description.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <section className="settings-section">
      <input
        className="info-filter"
        placeholder="Filter commands…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <ul className="info-list">
        {visible.map((command) => (
          <li key={command.name} className="info-list__item info-list__item--stacked">
            <span className="info-list__name">
              /{command.name}
              {command.argumentHint && (
                <span className="info-list__meta"> {command.argumentHint}</span>
              )}
            </span>
            {command.description && (
              <span className="info-list__desc">{command.description}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
