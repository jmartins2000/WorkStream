import { useState, type JSX } from 'react'
import type { BackgroundTask } from '../useClaudeRun'

const SNOOZE_OPTIONS: { label: string; ms: number }[] = [
  { label: '5 min', ms: 5 * 60 * 1000 },
  { label: '15 min', ms: 15 * 60 * 1000 },
  { label: '30 min', ms: 30 * 60 * 1000 },
  { label: '1 hr', ms: 60 * 60 * 1000 }
]

interface WatchdogAlertProps {
  task: BackgroundTask
  onKill: () => void
  onSnooze: (durationMs: number) => void
  onDismiss: () => void
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

/**
 * Modal overlay that appears when a background task exceeds the watchdog
 * threshold. The user can Kill it, Snooze alerts for a chosen duration, or
 * Dismiss (permanently silences the watchdog for this task).
 */
export function WatchdogAlert({ task, onKill, onSnooze, onDismiss }: WatchdogAlertProps): JSX.Element {
  const [selectedSnooze, setSelectedSnooze] = useState(SNOOZE_OPTIONS[1])

  return (
    <div className="watchdog-overlay" role="dialog" aria-modal="true" aria-label="Task watchdog alert">
      <div className="watchdog-dialog">
        {/* Header */}
        <div className="watchdog-dialog__header">
          <div className="watchdog-dialog__icon" aria-hidden="true">⏱</div>
          <div>
            <h2 className="watchdog-dialog__title">Task running a long time</h2>
            <p className="watchdog-dialog__subtitle">
              A background task hasn't finished within the watchdog limit.
            </p>
          </div>
        </div>

        {/* Task card */}
        <div className={'watchdog-task-card watchdog-task-card--' + task.kind}>
          <div className="watchdog-task-card__top">
            <span className={'task-badge task-badge--' + task.kind}>
              {task.kind === 'process' ? 'Process' : 'Agent'}
            </span>
            <span className="watchdog-task-card__elapsed">
              running for {formatElapsed(task.startedAt)}
            </span>
          </div>
          <p className="watchdog-task-card__desc">{task.description}</p>
        </div>

        {/* Snooze time picker */}
        <div className="watchdog-snooze">
          <div className="watchdog-snooze__label">Snooze for</div>
          <div className="watchdog-snooze__options">
            {SNOOZE_OPTIONS.map((opt) => (
              <button
                key={opt.ms}
                type="button"
                className={
                  'watchdog-snooze__btn' +
                  (opt.ms === selectedSnooze.ms ? ' watchdog-snooze__btn--selected' : '')
                }
                onClick={() => setSelectedSnooze(opt)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <hr className="watchdog-dialog__divider" />

        {/* Action buttons */}
        <div className="watchdog-dialog__actions">
          <button type="button" className="btn btn--danger-outline" onClick={onKill}>
            Kill task
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onSnooze(selectedSnooze.ms)}
          >
            Snooze {selectedSnooze.label}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onDismiss}>
            Dismiss
          </button>
        </div>

        <p className="watchdog-dialog__fine-print">
          Dismiss stops these alerts for this task only. You can still monitor it in Running Tasks.
        </p>
      </div>
    </div>
  )
}
