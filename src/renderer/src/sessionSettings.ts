import type { RunSettings } from '../../shared/types'
import { sanitizeRunSettings } from './useSettings'

/**
 * Per-conversation memory of model/effort/permission settings — something the
 * CC CLI doesn't do (it only persists a single global default). Reopening a
 * conversation restores whatever you last used in it.
 */
const STORAGE_KEY = 'workstream:session-settings'

type SettingsMap = Record<string, unknown>

function loadMap(): SettingsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as SettingsMap)
      : {}
  } catch {
    return {}
  }
}

function saveMap(map: SettingsMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Storage unavailable — per-session memory just won't persist.
  }
}

/** Settings last used in a session, or null if never recorded. */
export function loadSessionSettings(sessionId: string): RunSettings | null {
  const entry = loadMap()[sessionId]
  return entry ? sanitizeRunSettings(entry) : null
}

/** Remember the settings used in a session. */
export function saveSessionSettings(sessionId: string, settings: RunSettings): void {
  const map = loadMap()
  map[sessionId] = settings
  saveMap(map)
}

/** Drop a session's remembered settings (after deleting the session). */
export function removeSessionSettings(sessionId: string): void {
  const map = loadMap()
  if (sessionId in map) {
    delete map[sessionId]
    saveMap(map)
  }
}
