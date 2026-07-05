import { useEffect, useState, type JSX } from 'react'
import type { MemoryFile, MemoryScope } from '../../../shared/types'

interface MemoryPanelProps {
  /** Working directory of the current conversation (for project CLAUDE.md). */
  cwd: string
  onClose: () => void
}

/**
 * Viewer/editor for the CLAUDE.md memory files (the CLI's /memory), covering
 * the project file (<cwd>/CLAUDE.md) and the user file (~/.claude/CLAUDE.md).
 */
export function MemoryPanel({ cwd, onClose }: MemoryPanelProps): JSX.Element {
  const [scope, setScope] = useState<MemoryScope>('project')
  const [file, setFile] = useState<MemoryFile | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setFile(null)
    void window.claude.readMemory(scope, cwd).then((f) => {
      if (cancelled) return
      setFile(f)
      setDraft(f.content)
    })
    return () => {
      cancelled = true
    }
  }, [scope, cwd])

  const dirty = file !== null && draft !== file.content

  const save = async (): Promise<void> => {
    if (!file) return
    setSaving(true)
    try {
      await window.claude.writeMemory(scope, cwd, draft)
      setFile({ ...file, exists: true, content: draft })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="settings-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="settings-panel settings-panel--wide" aria-label="Memory">
        <div className="settings-panel__header">
          <h2 className="settings-panel__title">Memory</h2>
          <button
            type="button"
            className="settings-panel__close"
            onClick={onClose}
            aria-label="Close memory"
          >
            ✕
          </button>
        </div>

        <div className="info-tabs">
          <button
            type="button"
            className={'info-tab' + (scope === 'project' ? ' info-tab--active' : '')}
            onClick={() => setScope('project')}
          >
            Project
          </button>
          <button
            type="button"
            className={'info-tab' + (scope === 'user' ? ' info-tab--active' : '')}
            onClick={() => setScope('user')}
          >
            User
          </button>
        </div>

        <div className="settings-panel__body memory-body">
          {file === null ? (
            <p className="info-empty">Loading…</p>
          ) : (
            <>
              <p className="memory-path" title={file.path}>
                {file.path}
                {!file.exists && <span className="info-list__meta"> (not created yet)</span>}
              </p>
              <textarea
                className="memory-editor"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  scope === 'project'
                    ? 'Project instructions for Claude (checked into the repo)…'
                    : 'Personal instructions applied to every project…'
                }
                spellCheck={false}
              />
              <div className="input-panel__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void save()}
                  disabled={!dirty || saving}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setDraft(file.content)}
                  disabled={!dirty || saving}
                >
                  Revert
                </button>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  )
}
