import { useCallback, useEffect, useState } from 'react'
import type { StremioServerStatus } from '../../shared/types'

export interface UseStremioServer {
  status: StremioServerStatus
  installRosetta: () => void
}

/**
 * Tracks the local Stremio streaming server's status (see
 * claude/stremioServer.ts). The webview can't play anything until this
 * reaches 'ready'.
 */
export function useStremioServer(): UseStremioServer {
  const [status, setStatus] = useState<StremioServerStatus>({ state: 'starting' })

  useEffect(() => {
    let cancelled = false
    void window.claude.getStremioServerStatus().then((s) => {
      if (!cancelled) setStatus(s)
    })
    const unsubscribe = window.claude.onStremioServerStatus(setStatus)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const installRosetta = useCallback(() => {
    void window.claude.installRosetta()
  }, [])

  return { status, installRosetta }
}
