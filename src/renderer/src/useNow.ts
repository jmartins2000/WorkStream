import { useEffect, useState } from 'react'

/**
 * A ticking clock for live elapsed-time displays. Re-renders the consumer
 * every `intervalMs` while `active`; pass active=false to pause (e.g. when
 * nothing is being timed).
 */
export function useNow(active = true, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [active, intervalMs])
  return now
}
