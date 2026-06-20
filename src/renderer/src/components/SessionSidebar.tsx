import type { JSX } from 'react'
import type { ProjectSummary, SessionSummary } from '../../../shared/types'

interface SessionSidebarProps {
  projects: ProjectSummary[]
  sessions: SessionSummary[]
  selectedProject: ProjectSummary | null
  activeSessionId: string | null
  loading: boolean
  onSelectProject: (project: ProjectSummary) => void
  onSelectSession: (session: SessionSummary) => void
  onNewSession: () => void
  onRefresh: () => void
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

/** Sidebar for browsing Claude Code projects and their sessions. */
export function SessionSidebar({
  projects,
  sessions,
  selectedProject,
  activeSessionId,
  loading,
  onSelectProject,
  onSelectSession,
  onNewSession,
  onRefresh
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
            <li key={session.sessionId}>
              <button
                type="button"
                className={
                  'session-item' +
                  (session.sessionId === activeSessionId ? ' session-item--active' : '')
                }
                onClick={() => onSelectSession(session)}
              >
                <span className="session-item__title">{session.title}</span>
                <span className="session-item__meta">
                  {session.messageCount} msgs · {formatTime(session.lastActivity)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
