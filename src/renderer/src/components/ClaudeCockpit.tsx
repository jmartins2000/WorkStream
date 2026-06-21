import { useEffect, useState, type JSX } from 'react'
import type { SessionSummary } from '../../../shared/types'
import type { UseClaudeRun } from '../useClaudeRun'
import { useSessions } from '../useSessions'
import { SessionSidebar } from './SessionSidebar'
import { Transcript } from './Transcript'
import { Composer } from './Composer'
import { InputPanel } from './InputPanel'

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
    void run.start(prompt, cwd)
    onHandOff()
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
      />

      <section className="cockpit__main">
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
