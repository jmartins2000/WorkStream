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
import {
  loadSessionSettings,
  removeSessionSettings,
  saveSessionSettings
} from '../sessionSettings'
import { SessionSidebar } from './SessionSidebar'
import { Transcript } from './Transcript'
import { Composer } from './Composer'
import { InputPanel } from './InputPanel'
import { RunSettingsBar } from './RunSettings'
import { SessionInfoPanel } from './SessionInfoPanel'
import { MemoryPanel } from './MemoryPanel'
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
  /** Pull the user back to the cockpit (pause media). Used when the watchdog
   *  flags a stale background task — the alert renders here, so the cockpit
   *  must come forward for the user to see/snooze/kill it. */
  onAttention?: () => void
  /** Watchdog threshold in ms (0 = never). Comes from user settings. */
  watchdogMs?: number
  /** Model/effort/permission defaults for new conversations (user settings). */
  runDefaults?: RunSettings
  /** Start sessions with the Remote Control bridge (user settings). */
  remoteControl?: boolean
}

/** The full Claude Code workspace: session browser + transcript + composer. */
export function ClaudeCockpit({
  run,
  onHandOff,
  onAttention,
  watchdogMs,
  runDefaults = DEFAULT_RUN_SETTINGS,
  remoteControl = false
}: ClaudeCockpitProps): JSX.Element {
  const sessions = useSessions()
  const [cwd, setCwd] = useState<string>('')
  const [settings, setSettings] = useState<RunSettings>(runDefaults)
  const [infoOpen, setInfoOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const alertingTask = useTaskWatchdog(run.backgroundTasks, watchdogMs)

  // A watchdog alert is useless while the cockpit is hidden behind a media
  // tab — surface it. Keyed on the task id so snooze/dismiss aren't undone by
  // re-triggers of the same alert.
  const alertingTaskId = alertingTask?.taskId ?? null
  const onAttentionRef = useRef(onAttention)
  onAttentionRef.current = onAttention
  useEffect(() => {
    if (alertingTaskId) onAttentionRef.current?.()
  }, [alertingTaskId])

  // Default the working directory to the selected project's path.
  useEffect(() => {
    if (sessions.selectedProject) setCwd(sessions.selectedProject.cwd)
  }, [sessions.selectedProject])

  // When the SDK forks a historical session into a new one (resume creates a
  // new file), the run's sessionId changes after the turn starts. Refresh the
  // sidebar so the new session appears and is highlighted as active
  // immediately — and carry the conversation's remembered settings to the new
  // id so per-session memory survives the fork.
  const prevSessionId = useRef<string | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  useEffect(() => {
    const prev = prevSessionId.current
    prevSessionId.current = run.sessionId
    if (run.sessionId && run.sessionId !== prev) {
      saveSessionSettings(run.sessionId, settingsRef.current)
      if (prev !== null) void sessions.refresh()
    }
  }, [run.sessionId, sessions])

  const handleSelectSession = async (session: SessionSummary): Promise<void> => {
    setCwd(session.cwd)
    // Restore the settings last used in this conversation (per-session memory).
    setSettings(loadSessionSettings(session.sessionId) ?? runDefaults)
    const messages = await window.claude.getMessages(session.projectDir, session.sessionId)
    run.setMessages(messages, session.sessionId)
  }

  const handleNewSession = (): void => {
    run.setMessages([], null)
    setSettings(runDefaults)
    if (sessions.selectedProject) setCwd(sessions.selectedProject.cwd)
  }

  const handleSend = (prompt: string): void => {
    if (!cwd) return
    void run.start(prompt, cwd, settings, remoteControl)
    onHandOff()
  }

  // Model and permission mode can change mid-run (SDK setModel /
  // setPermissionMode on the live query); effort is start-time-only. Changes
  // are remembered per conversation.
  const handleSettingsChange = (next: RunSettings): void => {
    const prev = settings
    setSettings(next)
    if (run.sessionId) saveSessionSettings(run.sessionId, next)
    if (run.runId) {
      if (next.model !== prev.model) void window.claude.setRunModel(run.runId, next.model)
      if (next.permissionMode !== prev.permissionMode) {
        void window.claude.setRunPermissionMode(run.runId, next.permissionMode)
      }
    }
  }

  // Compact the conversation (/compact is handled by the CLI itself). Stay in
  // the cockpit — it's quick and the boundary note lands in the transcript.
  // Confirm first: compaction summarizes away detail and can't be undone.
  const handleCompact = (): void => {
    if (!cwd) return
    if (
      !window.confirm(
        'Compact this conversation? Older messages are replaced with a summary to free context. This cannot be undone.'
      )
    ) {
      return
    }
    void run.start('/compact', cwd, settings, remoteControl)
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
    removeSessionSettings(session.sessionId)
    if (session.sessionId === run.sessionId) run.setMessages([], null)
    await sessions.refresh()
  }

  const handleFork = async (session: SessionSummary): Promise<void> => {
    const newId = await window.claude.forkSession(session.sessionId, session.cwd)
    await sessions.refresh()
    // Load the fork's transcript so the user continues on the branch, keeping
    // the source conversation's remembered settings.
    const forkSettings = loadSessionSettings(session.sessionId) ?? runDefaults
    saveSessionSettings(newId, forkSettings)
    setSettings(forkSettings)
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
  // Sending while Claude works is allowed (the message is queued into the live
  // session, like typing mid-run in the CLI). Only block when Claude is waiting
  // on a question/permission — answer that through the InputPanel instead.
  const canSend = Boolean(cwd) && !awaitingInput

  return (
    <div className="cockpit">
      {alertingTask && (
        <WatchdogAlert
          task={alertingTask}
          onKill={() => run.killTask(alertingTask.taskId)}
          // Snooze/Dismiss mean "leave the task alone, I'll keep watching" —
          // hand the user back to their media tab like answering Claude does.
          // Kill keeps them here to see what Claude does next.
          onSnooze={(ms) => {
            run.snoozeTask(alertingTask.taskId, ms)
            onHandOff()
          }}
          onDismiss={() => {
            run.dismissTask(alertingTask.taskId)
            onHandOff()
          }}
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
      />

      <section className="cockpit__main">
        <div className="cockpit__bar">
          <RunSettingsBar
            settings={settings}
            onChange={handleSettingsChange}
            disabled={false}
            disableEffort={running || awaitingInput}
          />
          <div className="cockpit__bar-right">
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => {
                // Warm-open a session for the current conversation if none is
                // live yet, so the panel has something to interrogate.
                void run.ensureSession(cwd, settings, remoteControl)
                setInfoOpen(true)
              }}
              disabled={!cwd}
              title="Session info: context usage, MCP servers, agents, commands"
            >
              Session
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => setMemoryOpen(true)}
              disabled={!cwd}
              title="View & edit CLAUDE.md memory files"
            >
              Memory
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={handleCompact}
              disabled={!cwd || run.messages.length === 0 || awaitingInput}
              title="Compact the conversation to free context (/compact)"
            >
              Compact
            </button>
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
          queuedPrompts={run.queuedPrompts}
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

      {infoOpen && <SessionInfoPanel runId={run.runId} onClose={() => setInfoOpen(false)} />}
      {memoryOpen && <MemoryPanel cwd={cwd} onClose={() => setMemoryOpen(false)} />}
    </div>
  )
}
