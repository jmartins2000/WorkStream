import { useMemo, useState, type JSX } from 'react'

interface DiffFile {
  path: string
  additions: number
  deletions: number
  lines: { kind: 'add' | 'del' | 'hunk' | 'ctx'; text: string }[]
}

/** Parse a unified diff (git format) into per-file sections. */
function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = []
  let current: DiffFile | null = null

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) {
      // `diff --git a/path b/path` — prefer the b/ side.
      const match = line.match(/ b\/(.+)$/)
      current = { path: match?.[1] ?? line.slice(11), additions: 0, deletions: 0, lines: [] }
      files.push(current)
      continue
    }
    if (!current) continue
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ')) continue
    if (line.startsWith('@@')) {
      current.lines.push({ kind: 'hunk', text: line })
      continue
    }
    if (line.startsWith('+')) {
      current.additions++
      current.lines.push({ kind: 'add', text: line })
    } else if (line.startsWith('-')) {
      current.deletions++
      current.lines.push({ kind: 'del', text: line })
    } else {
      current.lines.push({ kind: 'ctx', text: line })
    }
  }
  return files
}

function FileSection({ file }: { file: DiffFile }): JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <div className="cx-diff-file">
      <button type="button" className="cx-diff-file__header" onClick={() => setOpen((o) => !o)}>
        <span className="cx-diff-file__caret">{open ? '▾' : '▸'}</span>
        <span className="cx-diff-file__path">{file.path}</span>
        <span className="cx-diff-file__stats">
          <span className="cx-diff-add">+{file.additions}</span>{' '}
          <span className="cx-diff-del">−{file.deletions}</span>
        </span>
      </button>
      {open && (
        <pre className="cx-diff-file__body">
          {file.lines.map((line, i) => (
            <div key={i} className={`cx-diff-line cx-diff-line--${line.kind}`}>
              {line.text || ' '}
            </div>
          ))}
        </pre>
      )}
    </div>
  )
}

/** Right-hand diff review pane — rendered straight from turn/diff/updated. */
export function CodexDiffPane({ diff, onClose }: { diff: string; onClose: () => void }): JSX.Element {
  const files = useMemo(() => parseUnifiedDiff(diff), [diff])
  const additions = files.reduce((sum, f) => sum + f.additions, 0)
  const deletions = files.reduce((sum, f) => sum + f.deletions, 0)

  return (
    <aside className="cx-diffpane">
      <div className="cx-diffpane__header">
        <span className="cx-diffpane__title">
          Changes
          <span className="cx-diffpane__totals">
            {files.length} file{files.length === 1 ? '' : 's'}{' '}
            <span className="cx-diff-add">+{additions}</span>{' '}
            <span className="cx-diff-del">−{deletions}</span>
          </span>
        </span>
        <button type="button" className="cx-diffpane__close" onClick={onClose} aria-label="Close diff">
          ✕
        </button>
      </div>
      <div className="cx-diffpane__body">
        {files.length === 0 ? (
          <p className="cx-diffpane__empty">No parsed changes.</p>
        ) : (
          files.map((file) => <FileSection key={file.path} file={file} />)
        )}
      </div>
    </aside>
  )
}
