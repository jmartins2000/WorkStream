import { useCallback, useEffect, useState } from 'react'
import type { ProjectSummary, SessionSummary } from '../../shared/types'

export interface UseSessions {
  projects: ProjectSummary[]
  sessions: SessionSummary[]
  selectedProject: ProjectSummary | null
  loading: boolean
  selectProject: (project: ProjectSummary) => void
  refresh: () => Promise<void>
}

/**
 * Loads the shared Claude Code project/session index from disk and tracks the
 * currently browsed project.
 */
export function useSessions(): UseSessions {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null)
  const [loading, setLoading] = useState(false)

  const loadSessions = useCallback(async (project: ProjectSummary) => {
    setLoading(true)
    try {
      setSessions(await window.claude.listSessions(project.dirName))
    } finally {
      setLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await window.claude.listProjects()
      setProjects(next)
      // Keep the current selection if it still exists, else pick the first.
      setSelectedProject((current) => {
        const match = current && next.find((p) => p.dirName === current.dirName)
        return match ?? next[0] ?? null
      })
    } finally {
      setLoading(false)
    }
  }, [])

  const selectProject = useCallback(
    (project: ProjectSummary) => {
      setSelectedProject(project)
      void loadSessions(project)
    },
    [loadSessions]
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Whenever the selected project changes, (re)load its sessions.
  useEffect(() => {
    if (selectedProject) void loadSessions(selectedProject)
  }, [selectedProject, loadSessions])

  return { projects, sessions, selectedProject, loading, selectProject, refresh }
}
