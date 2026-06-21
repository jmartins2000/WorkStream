import { useEffect, useState, type JSX } from 'react'
import { DEFAULT_RUN_SETTINGS, type RunSettings, type SessionSummary } from '../../../shared/types'
import type { UseClaudeRun } from '../useClaudeRun'
import { useSessions } from '../useSessions'
import { SessionSidebar } from './SessionSidebar'
import { Transcript } from './Transcript'
import { Composer } from './Composer'
import { InputPanel } from './InputPanel'
import { RunSettingsBar } from './RunSettings'

interface ClaudeCockpitProps {
  run: UseClaudeRun
  /** Called after the user hands control back to Claude (sent a prompt or
   *  answered a prompt), so the app can switch to Stremio. */
  onHandOff: () => void
}

/** The full Claude Code workspace: session browser + transcript + composer. */
export function ClaudeCockpit({ run, onHandOff }: ClaudeCockpitProps): JSX.Element {
  const sessions = useSessions()
  const [cwd, setCwd] = useState<string>('')
  const [settings, setSettings] = useState<RunSettings>(DEFAULT_RUN_SETTINGS)

  // Default the working directory to the selected project's path.
  useEffect(() => {
    if (sessions.selectedProject) setCwd(sessions.selectedProject.cwd)
  }, [sessions.selectedProject])

  const handleSelectSession = async (session: SessionSummary): Promise<void> => {
    setCwd(session.cwd)
    const messages = await window.claude.getMessages(session.projectDir, session.sessionId)
    run.setMessages(messages, session.sessionId)
  }

  const handleNewSession = (): void => {
    run.setMessages([], null)
    if (sessions.selectedProject) setCwd(sessions.selectedProject.cwd)
  }

  const handleSend = (prompt: string): void => {
    if (!cwd) return
    void run.start(prompt, cwd, settings)
    onHandOff()
  }

  const handleRename = async (session: SessionSummary): Promise<void> => {
    const title = window.prompt('Rename session', session.title)
    if (title && title.trim()) {
      await window.claude.renameSession(session.sessionId, title.trim(), session.cwd)
      await sessions.refresh()
    }
  }

  const handleDelete = async (session: SessionSummary): Promise<void> => {
    if (!window.confirm(`Delete session "${session.title}"? This cannot be undone.`)) return
    await window.claude.deleteSession(session.sessionId, session.cwd)
    if (session.sessionId === run.sessionId) run.setMessages([], null)
    await sessions.refresh()
  }

  const handleRespond: typeof run.respond = (response) => {
    run.respond(response)
    onHandOff()
  }

  const running = run.status === 'running'
  const awaitingInput = run.status === 'awaiting-input'
  const canSend = Boolean(cwd) && !running && !awaitingInput

  return (
    <div className="cockpit">
      <SessionSidebar
        projects={sessions.projects}
        sessions={sessions.sessions}
        selectedProject={sessions.selectedProject}
        activeSessionId={run.sessionId}
        loading={sessions.loading}
        onSelectProject={sessions.selectProject}
        onSelectSession={(session) => void handleSelectSession(session)}
        onNewSession={handleNewSession}
        onRefresh={() => void sessions.refresh()}
        onRenameSession={(session) => void handleRename(session)}
        onDeleteSession={(session) => void handleDelete(session)}
      />

      <section className="cockpit__main">
        <div className="cockpit__bar">
          <RunSettingsBar
            settings={settings}
            onChange={setSettings}
            disabled={running || awaitingInput}
          />
          {run.usage && (
            <span className="usage" title="Cost and tokens for the last run">
              ${run.usage.costUsd.toFixed(4)} · {run.usage.inputTokens.toLocaleString()} in /{' '}
              {run.usage.outputTokens.toLocaleString()} out
            </span>
          )}
        </div>
        <Transcript
          messages={run.messages}
          streamingText={run.streamingText}
          running={running}
        />
        {run.error && <div className="error-banner">{run.error}</div>}
        {run.pendingRequest && (
          <InputPanel request={run.pendingRequest} onRespond={handleRespond} />
        )}
        <Composer
          running={running}
          disabled={!canSend}
          commands={run.commands}
          onSend={handleSend}
          onCancel={run.cancel}
        />
      </section>
    </div>
  )
}
