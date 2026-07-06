import { useCallback, useEffect, useState } from 'react'
import type { UpdateStatus } from '../../shared/types'

/** localStorage key: the commit the user chose "Later" on, so we don't nag. */
const DISMISSED_KEY = 'workstream:update-dismissed'

export type UpdatePhase = 'idle' | 'available' | 'dismissed' | 'updating' | 'error'

export interface UseUpdate {
  phase: UpdatePhase
  status: UpdateStatus | null
  error: string | null
  /** Dismiss the current update until a newer one appears. */
  dismiss: () => void
  /** Kick off the rebuild; the app quits on success. */
  update: () => Promise<void>
}

/**
 * Checks for a newer build once on launch (option C self-update). Surfaces an
 * update banner unless the user already said "Later" for this exact commit.
 */
export function useUpdate(): UseUpdate {
  const [phase, setPhase] = useState<UpdatePhase>('idle')
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Small delay so the check never competes with first paint / startup work.
    const timer = setTimeout(() => {
      void window.claude.checkForUpdate().then((result) => {
        if (cancelled || !result.available) return
        setStatus(result)
        const dismissed = localStorage.getItem(DISMISSED_KEY)
        // "Later" is remembered per remote head — a further update re-nags.
        setPhase(dismissed && dismissed === result.latestMessage ? 'dismissed' : 'available')
      })
    }, 3000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  const dismiss = useCallback(() => {
    if (status?.latestMessage) localStorage.setItem(DISMISSED_KEY, status.latestMessage)
    setPhase('dismissed')
  }, [status])

  const update = useCallback(async () => {
    setPhase('updating')
    setError(null)
    const result = await window.claude.performUpdate()
    if (!result.started) {
      setError(result.error ?? 'Could not start the update.')
      setPhase('error')
    }
    // On success the app quits and the script takes over — nothing more to do.
  }, [])

  return { phase, status, error, dismiss, update }
}
