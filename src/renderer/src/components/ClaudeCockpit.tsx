import { useEffect, useRef, useState, type JSX } from 'react'
import {
  DEFAULT_RUN_SETTINGS,
  type RunSettings,
  type SessionSummary,
  type TranscriptMessage
} from '../../../shared/types'
import type { UseClaudeRun } from '../useClaudeRun'
import { useTaskWatchdog } from '../useTaskWatchdog'
import { useSessions } from '../useSessions'
import { SessionSidebar } from './SessionSidebar'
import { Transcript } from './Transcript'
import { Composer } from './Composer'
import { InputPanel } from './InputPanel'
import { RunSettingsBar } from './RunSettings'
import { WatchdogAlert } from './WatchdogAlert'

const ROLE_LABEL: Record<TranscriptMessage['role'], string> = {
  user: 'You',
  assistant: 'Claude',
  system: 'System'
}

/** Render a transcript as markdown for export. */
function transcriptToMarkdown(messages: TranscriptMessage[]): string {
  return messages
    .map((message) => {
      const body = message.parts
        .map((part) => {
          if (part.kind === 'text') return part.text
          if (part.kind === 'thinking') return `_(thinking)_\n\n${part.text}`
          const head = `\`${part.name}${part.detail ? ': ' + part.detail : ''}\``
          return part.result ? `${head}\n\n\`\`\`\n${part.result}\n\`\`\`` : head
        })
        .join('\n\n')
      return `### ${ROLE_LABEL[message.role]}\n\n${body}`
    })
    .join('\n\n---\n\n')
}

interface ClaudeCockpitProps {
  run: UseClaudeRun
  /** Called after the user hands control back to Claude (sent a prompt or
   *  answered a prompt), so the app can switch to Stremio. */
  onHandOff: () => void
  /** Watchdog threshold in ms (0 = never). Comes from user settings. */
  watchdogMs?: number
}

/** The full Claude Code workspace: session browser + transcript + composer. */
export function ClaudeCockpit({ run, onHandOff, watchdogMs }: ClaudeCockpitProps): JSX.Element {
  const sessions = useSessions()
  const [cwd, setCwd] = useState<string>('')
  const [settings, setSettings] = useState<RunSettings>(DEFAULT_RUN_SETTINGS)
  const alertingTask = useTaskWatchdog(run.backgroundTasks, watchdogMs)

  // Default the working directory to the selected project's path.
  useEffect(() => {
    if (sessions.selectedProject) setCwd(sessions.selectedProject.cwd)
  }, [sessions.selectedProject])

  // When the SDK forks a historical session into a new one (resume creates a
  // new file), the run's sessionId changes after the turn starts. Refresh the
  // sidebar so the new session appears and is highlighted as active immediately.
  const prevSessionId = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevSessionId.current
    prevSessionId.current = run.sessionId
    if (run.sessionId && prev !== null && run.sessionId !== prev) {
      void sessions.refresh()
    }
  }, [run.sessionId, sessions])

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

  const handleFork = async (session: SessionSummary): Promise<void> => {
    const newId = await window.claude.forkSession(session.sessionId, session.cwd)
    await sessions.refresh()
    // Load the fork's transcript so the user continues on the branch.
    const messages = await window.claude.getMessages(session.projectDir, newId)
    setCwd(session.cwd)
    run.setMessages(messages, newId)
  }

  const handleExport = async (): Promise<void> => {
    if (run.messages.length === 0) return
    const name = `claude-session-${run.sessionId ?? 'new'}.md`
    await window.claude.exportTranscript(name, transcriptToMarkdown(run.messages))
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
      {alertingTask && (
        <WatchdogAlert
          task={alertingTask}
          onKill={() => run.killTask(alertingTask.taskId)}
          onSnooze={(ms) => run.snoozeTask(alertingTask.taskId, ms)}
          onDismiss={() => run.dismissTask(alertingTask.taskId)}
        />
      )}
      <SessionSidebar
        projects={sessions.projects}
        sessions={sessions.sessions}
        selectedProject={sessions.selectedProject}
        activeSessionId={run.sessionId}
        loading={sessions.loading}
        backgroundTasks={run.backgroundTasks}
        onSelectProject={sessions.selectProject}
        onSelectSession={(session) => void handleSelectSession(session)}
        onNewSession={handleNewSession}
        onRefresh={() => void sessions.refresh()}
        onRenameSession={(session) => void handleRename(session)}
        onDeleteSession={(session) => void handleDelete(session)}
        onForkSession={(session) => void handleFork(session)}
        onKillTask={run.killTask}
        onSnoozeTask={run.snoozeTask}
        onDismissTask={run.dismissTask}
      />

      <section className="cockpit__main">
        <div className="cockpit__bar">
          <RunSettingsBar
            settings={settings}
            onChange={setSettings}
            disabled={running || awaitingInput}
          />
          <div className="cockpit__bar-right">
            {run.usage && (
              <span className="usage" title="Cost and tokens for the last run">
                ${run.usage.costUsd.toFixed(4)} · {run.usage.inputTokens.toLocaleString()} in /{' '}
                {run.usage.outputTokens.toLocaleString()} out
              </span>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => void handleExport()}
              disabled={run.messages.length === 0}
              title="Export transcript to markdown"
            >
              Export
            </button>
          </div>
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
