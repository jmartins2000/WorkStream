import { useState, type JSX } from 'react'
import type { ProjectSummary, SessionSummary } from '../../../shared/types'
import type { BackgroundTask } from '../useClaudeRun'

interface SessionSidebarProps {
  projects: ProjectSummary[]
  sessions: SessionSummary[]
  selectedProject: ProjectSummary | null
  activeSessionId: string | null
  loading: boolean
  backgroundTasks: BackgroundTask[]
  onSelectProject: (project: ProjectSummary) => void
  onSelectSession: (session: SessionSummary) => void
  onNewSession: () => void
  onRefresh: () => void
  onRenameSession: (session: SessionSummary) => void
  onDeleteSession: (session: SessionSummary) => void
  onForkSession: (session: SessionSummary) => void
  onKillTask: (taskId: string) => void
  onSnoozeTask: (taskId: string, durationMs: number) => void
  onDismissTask: (taskId: string) => void
}

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

function formatTime(ms: number | null): string {
  if (!ms) return ''
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatElapsed(startedAt: number): string {
  const ms = Date.now() - startedAt
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

/** Inline snooze picker shown on a task row. */
function TaskSnoozeMenu({
  taskId,
  onSnooze
}: {
  taskId: string
  onSnooze: (taskId: string, ms: number) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const options = [
    { label: '5 min', ms: 5 * 60 * 1000 },
    { label: '15 min', ms: 15 * 60 * 1000 },
    { label: '30 min', ms: 30 * 60 * 1000 },
    { label: '1 hr', ms: 60 * 60 * 1000 }
  ]
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="task-action-btn"
        onClick={() => setOpen((v) => !v)}
        title="Snooze alert"
      >
        Snooze
      </button>
      {open && (
        <div className="task-snooze-menu">
          {options.map((opt) => (
            <button
              key={opt.ms}
              type="button"
              className="task-snooze-menu__item"
              onClick={() => {
                onSnooze(taskId, opt.ms)
                setOpen(false)
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Sidebar for browsing Claude Code projects and their sessions. */
export function SessionSidebar({
  projects,
  sessions,
  selectedProject,
  activeSessionId,
  loading,
  backgroundTasks,
  onSelectProject,
  onSelectSession,
  onNewSession,
  onRefresh,
  onRenameSession,
  onDeleteSession,
  onForkSession,
  onKillTask,
  onSnoozeTask,
  onDismissTask
}: SessionSidebarProps): JSX.Element {
  return (
    <aside className="sidebar">
      <div className="sidebar__section">
        <div className="sidebar__header">
          <span>Projects</span>
          <button type="button" className="btn btn--ghost" onClick={onRefresh} title="Refresh">
            ↻
          </button>
        </div>
        <select
          className="sidebar__select"
          value={selectedProject?.dirName ?? ''}
          onChange={(event) => {
            const project = projects.find((p) => p.dirName === event.target.value)
            if (project) onSelectProject(project)
          }}
        >
          {projects.length === 0 && <option value="">No projects found</option>}
          {projects.map((project) => (
            <option key={project.dirName} value={project.dirName}>
              {basename(project.cwd)} ({project.sessionCount})
            </option>
          ))}
        </select>
        {selectedProject && <div className="sidebar__cwd">{selectedProject.cwd}</div>}
      </div>

      <div className="sidebar__section sidebar__section--grow">
        <div className="sidebar__header">
          <span>Sessions</span>
          <button type="button" className="btn btn--primary btn--small" onClick={onNewSession}>
            + New
          </button>
        </div>
        <ul className="session-list">
          {loading && <li className="session-list__empty">Loading…</li>}
          {!loading && sessions.length === 0 && (
            <li className="session-list__empty">No sessions yet</li>
          )}
          {sessions.map((session) => (
            <li
              key={session.sessionId}
              className={
                'session-row' +
                (session.sessionId === activeSessionId ? ' session-row--active' : '')
              }
            >
              <button
                type="button"
                className="session-item"
                onClick={() => onSelectSession(session)}
              >
                <span className="session-item__title">{session.title}</span>
                <span className="session-item__meta">
                  {session.gitBranch ? `⎇ ${session.gitBranch} · ` : ''}
                  {session.messageCount} msgs · {formatTime(session.lastActivity)}
                </span>
              </button>
              <div className="session-row__actions">
                <button
                  type="button"
                  className="icon-btn"
                  title="Fork / branch"
                  onClick={() => onForkSession(session)}
                >
                  ⑂
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="Rename"
                  onClick={() => onRenameSession(session)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--danger"
                  title="Delete"
                  onClick={() => onDeleteSession(session)}
                >
                  🗑
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {backgroundTasks.length > 0 && (
        <div className="sidebar__section">
          <div className="sidebar__header">
            <span>Running Tasks</span>
            <span className="task-count-badge">{backgroundTasks.length}</span>
          </div>
          <ul className="task-list">
            {backgroundTasks.map((task) => (
              <li key={task.taskId} className={'task-card task-card--' + task.kind}>
                <div className="task-card__top">
                  <span className={'task-badge task-badge--' + task.kind}>
                    {task.kind === 'process' ? 'Process' : 'Agent'}
                  </span>
                  <span className="task-card__elapsed">{formatElapsed(task.startedAt)}</span>
                </div>
                <p className="task-card__desc" title={task.description}>
                  {task.description}
                </p>
                <div className="task-card__actions">
                  <button
                    type="button"
                    className="task-action-btn task-action-btn--danger"
                    onClick={() => onKillTask(task.taskId)}
                    title="Kill task and interrupt Claude"
                  >
                    Kill
                  </button>
                  <TaskSnoozeMenu taskId={task.taskId} onSnooze={onSnoozeTask} />
                  <button
                    type="button"
                    className="task-action-btn"
                    onClick={() => onDismissTask(task.taskId)}
                    title="Stop watchdog alerts for this task"
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}
