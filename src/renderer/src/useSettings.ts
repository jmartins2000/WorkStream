import { useState } from 'react'
import { DEFAULT_WATCHDOG_MS } from './useTaskWatchdog'

const STORAGE_KEY = 'workstream:settings'

interface Settings {
  /** How long a background task can run before the watchdog fires (ms). 0 = never. */
  watchdogMs: number
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>
      return {
        watchdogMs:
          typeof parsed.watchdogMs === 'number' ? parsed.watchdogMs : DEFAULT_WATCHDOG_MS
      }
    }
  } catch {
    // Ignore parse errors — fall through to defaults.
  }
  return { watchdogMs: DEFAULT_WATCHDOG_MS }
}

function save(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage may be unavailable in some sandboxed environments.
  }
}

export function useSettings(): {
  settings: Settings
  setWatchdogMs: (ms: number) => void
} {
  const [settings, setSettings] = useState<Settings>(load)

  const setWatchdogMs = (ms: number): void => {
    setSettings((prev) => {
      const next = { ...prev, watchdogMs: ms }
      save(next)
      return next
    })
  }

  return { settings, setWatchdogMs }
}
