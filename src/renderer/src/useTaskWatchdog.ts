import { useEffect, useState } from 'react'
import type { BackgroundTask } from './useClaudeRun'

/**
 * Default time before a background task triggers a watchdog alert.
 * 15 minutes — long enough to avoid false alarms on legitimate builds/tests,
 * short enough to catch genuinely stuck tasks.
 */
export const DEFAULT_WATCHDOG_MS = 15 * 60 * 1000

/**
 * Watches the list of background tasks and fires an alert when any task has
 * been running longer than `watchdogMs` without being snoozed or dismissed.
 *
 * Returns the currently alerting task (the oldest overdue one), or null.
 */
export function useTaskWatchdog(
  tasks: BackgroundTask[],
  watchdogMs: number = DEFAULT_WATCHDOG_MS
): BackgroundTask | null {
  const [alertingTaskId, setAlertingTaskId] = useState<string | null>(null)

  useEffect(() => {
    const check = (): void => {
      const now = Date.now()
      const taskIds = new Set(tasks.map((t) => t.taskId))

      // Candidate: oldest overdue, non-dismissed, non-snoozed task
      let candidate: BackgroundTask | null = null
      for (const task of tasks) {
        if (task.dismissedWatchdog) continue
        if (task.snoozedUntil !== null && task.snoozedUntil > now) continue
        if (now - task.startedAt < watchdogMs) continue
        // Pick the one that's been overdue the longest
        if (!candidate || task.startedAt < candidate.startedAt) {
          candidate = task
        }
      }

      setAlertingTaskId((prev) => {
        // If the previously alerting task disappeared, clear
        if (prev && !taskIds.has(prev)) return candidate?.taskId ?? null
        return candidate?.taskId ?? null
      })
    }

    check()
    const interval = setInterval(check, 10_000)
    return () => clearInterval(interval)
  }, [tasks, watchdogMs])

  return tasks.find((t) => t.taskId === alertingTaskId) ?? null
}
