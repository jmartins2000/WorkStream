import { useState } from 'react'
import {
  DEFAULT_RUN_SETTINGS,
  RUN_EFFORTS,
  RUN_MODELS,
  RUN_PERMISSION_MODES,
  type RunSettings
} from '../../shared/types'
import { DEFAULT_WATCHDOG_MS } from './useTaskWatchdog'

const STORAGE_KEY = 'workstream:settings'

/** One entertainment tab: a built-in pane or a user-added site. */
export interface MediaTabConfig {
  /** Stable id — built-ins use their kind; customs get a uuid. */
  id: string
  kind: 'stremio' | 'youtube' | 'browser' | 'custom'
  /** Tab label shown in the topbar (customs: user-chosen, e.g. "Twitter"). */
  label: string
  /** Site URL for custom tabs. */
  url?: string
  enabled: boolean
}

export const DEFAULT_MEDIA_TABS: MediaTabConfig[] = [
  { id: 'stremio', kind: 'stremio', label: 'Stremio', enabled: true },
  { id: 'youtube', kind: 'youtube', label: 'YouTube', enabled: true },
  { id: 'browser', kind: 'browser', label: 'Browser', enabled: true }
]

interface Settings {
  /** How long a background task can run before the watchdog fires (ms). 0 = never. */
  watchdogMs: number
  /** Model/effort/permission defaults applied to new conversations. */
  runDefaults: RunSettings
  /** Start sessions with the Remote Control bridge (visible on claude.ai/code). */
  remoteControl: boolean
  /** Entertainment tabs: built-ins (toggleable) + user-added custom sites. */
  mediaTabs: MediaTabConfig[]
  /** Block ads & trackers in the media webviews (YouTube/Browser/custom tabs). */
  adblock: boolean
  /** Show the Claude coding tab. */
  claudeEnabled: boolean
  /** Show the Codex coding tab (its server only spawns when the tab is used). */
  codexEnabled: boolean
}

const DEFAULTS: Settings = {
  watchdogMs: DEFAULT_WATCHDOG_MS,
  runDefaults: DEFAULT_RUN_SETTINGS,
  remoteControl: false,
  mediaTabs: DEFAULT_MEDIA_TABS,
  adblock: true,
  claudeEnabled: true,
  codexEnabled: true
}

/**
 * Validate persisted media tabs: built-ins are always present (their enabled
 * flag is restored), customs must have an id, label and url.
 */
function sanitizeMediaTabs(value: unknown): MediaTabConfig[] {
  const raw = Array.isArray(value) ? (value as Partial<MediaTabConfig>[]) : []
  const builtins = DEFAULT_MEDIA_TABS.map((def) => {
    const saved = raw.find((t) => t.id === def.id)
    return { ...def, enabled: saved ? saved.enabled !== false : def.enabled }
  })
  const customs = raw.filter(
    (t): t is MediaTabConfig =>
      t.kind === 'custom' &&
      typeof t.id === 'string' &&
      typeof t.label === 'string' &&
      typeof t.url === 'string' &&
      t.label.trim().length > 0 &&
      t.url.trim().length > 0
  )
  return [...builtins, ...customs.map((t) => ({ ...t, enabled: t.enabled !== false }))]
}

/** Validate a persisted RunSettings shape, falling back per-field. */
export function sanitizeRunSettings(value: unknown): RunSettings {
  return sanitizeRunDefaults(value)
}

function sanitizeRunDefaults(value: unknown): RunSettings {
  const raw = (value ?? {}) as Partial<RunSettings>
  return {
    model: RUN_MODELS.includes(raw.model as RunSettings['model'])
      ? (raw.model as RunSettings['model'])
      : DEFAULT_RUN_SETTINGS.model,
    effort: RUN_EFFORTS.includes(raw.effort as RunSettings['effort'])
      ? (raw.effort as RunSettings['effort'])
      : DEFAULT_RUN_SETTINGS.effort,
    permissionMode: RUN_PERMISSION_MODES.includes(
      raw.permissionMode as RunSettings['permissionMode']
    )
      ? (raw.permissionMode as RunSettings['permissionMode'])
      : DEFAULT_RUN_SETTINGS.permissionMode
  }
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>
      return {
        watchdogMs:
          typeof parsed.watchdogMs === 'number' ? parsed.watchdogMs : DEFAULT_WATCHDOG_MS,
        runDefaults: sanitizeRunDefaults(parsed.runDefaults),
        remoteControl: parsed.remoteControl === true,
        mediaTabs: sanitizeMediaTabs(parsed.mediaTabs),
        adblock: parsed.adblock !== false,
        // At least one coding tab must stay enabled — Claude wins ties.
        claudeEnabled: parsed.claudeEnabled !== false || parsed.codexEnabled === false,
        codexEnabled: parsed.codexEnabled !== false
      }
    }
  } catch {
    // Ignore parse errors — fall through to defaults.
  }
  return DEFAULTS
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
  setRunDefaults: (defaults: RunSettings) => void
  setRemoteControl: (enabled: boolean) => void
  setMediaTabs: (tabs: MediaTabConfig[]) => void
  setAdblock: (enabled: boolean) => void
  setClaudeEnabled: (enabled: boolean) => void
  setCodexEnabled: (enabled: boolean) => void
} {
  const [settings, setSettings] = useState<Settings>(load)

  const update = (patch: Partial<Settings>): void => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      save(next)
      return next
    })
  }

  return {
    settings,
    setWatchdogMs: (ms) => update({ watchdogMs: ms }),
    setRunDefaults: (defaults) => update({ runDefaults: defaults }),
    setRemoteControl: (enabled) => update({ remoteControl: enabled }),
    setMediaTabs: (tabs) => update({ mediaTabs: tabs }),
    setAdblock: (enabled) => update({ adblock: enabled }),
    setClaudeEnabled: (enabled) => update({ claudeEnabled: enabled }),
    setCodexEnabled: (enabled) => update({ codexEnabled: enabled })
  }
}
