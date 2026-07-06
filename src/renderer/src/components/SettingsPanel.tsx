import { useState, type JSX } from 'react'
import type { RunSettings } from '../../../shared/types'
import type { MediaTabConfig } from '../useSettings'
import { RunSettingsBar } from './RunSettings'

const WATCHDOG_PRESETS: { label: string; ms: number }[] = [
  { label: '5 min', ms: 5 * 60 * 1000 },
  { label: '15 min', ms: 15 * 60 * 1000 },
  { label: '30 min', ms: 30 * 60 * 1000 },
  { label: '1 hr', ms: 60 * 60 * 1000 },
  { label: 'Never', ms: 0 }
]

interface SettingsPanelProps {
  watchdogMs: number
  onWatchdogMsChange: (ms: number) => void
  runDefaults: RunSettings
  onRunDefaultsChange: (defaults: RunSettings) => void
  remoteControl: boolean
  onRemoteControlChange: (enabled: boolean) => void
  mediaTabs: MediaTabConfig[]
  onMediaTabsChange: (tabs: MediaTabConfig[]) => void
  adblock: boolean
  onAdblockChange: (enabled: boolean) => void
  claudeEnabled: boolean
  onClaudeEnabledChange: (enabled: boolean) => void
  codexEnabled: boolean
  onCodexEnabledChange: (enabled: boolean) => void
  onClose: () => void
}

/** Normalize a user-typed site URL (bare domains get https://). */
function normalizeUrl(raw: string): string | null {
  let url = raw.trim()
  if (!url) return null
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  try {
    return new URL(url).toString()
  } catch {
    return null
  }
}

export function SettingsPanel({
  watchdogMs,
  onWatchdogMsChange,
  runDefaults,
  onRunDefaultsChange,
  remoteControl,
  onRemoteControlChange,
  mediaTabs,
  onMediaTabsChange,
  adblock,
  onAdblockChange,
  claudeEnabled,
  onClaudeEnabledChange,
  codexEnabled,
  onCodexEnabledChange,
  onClose
}: SettingsPanelProps): JSX.Element {
  const [newLabel, setNewLabel] = useState('')
  const [newUrl, setNewUrl] = useState('')

  // Custom watchdog interval (minutes). Active when the stored value doesn't
  // match any preset; the input mirrors it.
  const isPresetWatchdog = WATCHDOG_PRESETS.some((preset) => preset.ms === watchdogMs)
  const [customMinutes, setCustomMinutes] = useState(() =>
    !isPresetWatchdog && watchdogMs > 0 ? String(Math.round(watchdogMs / 60000)) : ''
  )

  const applyCustomMinutes = (raw: string): void => {
    setCustomMinutes(raw)
    const minutes = Number(raw)
    // Any positive number, fractions included (0.5 = 30s).
    if (Number.isFinite(minutes) && minutes > 0) {
      onWatchdogMsChange(Math.round(minutes * 60 * 1000))
    }
  }

  const toggleTab = (id: string): void => {
    onMediaTabsChange(
      mediaTabs.map((tab) => (tab.id === id ? { ...tab, enabled: !tab.enabled } : tab))
    )
  }

  const removeTab = (id: string): void => {
    onMediaTabsChange(mediaTabs.filter((tab) => tab.id !== id))
  }

  const addTab = (): void => {
    const url = normalizeUrl(newUrl)
    const label = newLabel.trim()
    if (!url || !label) return
    onMediaTabsChange([
      ...mediaTabs,
      { id: crypto.randomUUID(), kind: 'custom', label, url, enabled: true }
    ])
    setNewLabel('')
    setNewUrl('')
  }
  return (
    <>
      {/* Backdrop — click to close */}
      <div className="settings-backdrop" onClick={onClose} aria-hidden="true" />

      <aside className="settings-panel" aria-label="Settings">
        <div className="settings-panel__header">
          <h2 className="settings-panel__title">Settings</h2>
          <button
            type="button"
            className="settings-panel__close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className="settings-panel__body">
          <section className="settings-section">
            <h3 className="settings-section__title">New-conversation defaults</h3>
            <div className="settings-field">
              <label className="settings-field__label">
                Model, effort & permissions
                <span className="settings-field__hint">
                  Applied when a new conversation opens. You can still change them per run in
                  the cockpit bar.
                </span>
              </label>
              <RunSettingsBar settings={runDefaults} onChange={onRunDefaultsChange} disabled={false} />
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">Remote Control</h3>
            <div className="settings-field">
              <label className="settings-field__label settings-field__label--row">
                <input
                  type="checkbox"
                  checked={remoteControl}
                  onChange={(e) => onRemoteControlChange(e.target.checked)}
                />
                Start sessions remote-controllable
                <span className="settings-field__hint">
                  New sessions start the Remote Control bridge, so they appear on claude.ai/code
                  and can be followed or driven from your phone or browser. Applies to sessions
                  started after toggling.
                </span>
              </label>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">Coding tabs</h3>
            <div className="settings-field">
              <label className="settings-field__label settings-field__label--row">
                <input
                  type="checkbox"
                  checked={claudeEnabled}
                  disabled={claudeEnabled && !codexEnabled}
                  onChange={(e) => onClaudeEnabledChange(e.target.checked)}
                />
                Claude
                <span className="settings-field__hint">
                  Claude Code — sessions shared with the CLI (~/.claude).
                </span>
              </label>
              <label className="settings-field__label settings-field__label--row">
                <input
                  type="checkbox"
                  checked={codexEnabled}
                  disabled={codexEnabled && !claudeEnabled}
                  onChange={(e) => onCodexEnabledChange(e.target.checked)}
                />
                Codex
                <span className="settings-field__hint">
                  OpenAI&rsquo;s coding agent. Its background server only runs while the tab is
                  in use. At least one coding tab stays enabled.
                </span>
              </label>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">Entertainment tabs</h3>
            <div className="settings-field">
              <label className="settings-field__label">
                Tabs to show
                <span className="settings-field__hint">
                  Toggle the built-in tabs, or add your own sites (e.g. x.com named
                  &ldquo;Twitter&rdquo;). Custom tabs keep their own login sessions.
                </span>
              </label>
              <ul className="tab-list">
                {mediaTabs.map((tab) => (
                  <li key={tab.id} className="tab-list__item">
                    <label className="tab-list__toggle">
                      <input
                        type="checkbox"
                        checked={tab.enabled}
                        onChange={() => toggleTab(tab.id)}
                      />
                      <span className="tab-list__name">{tab.label}</span>
                      {tab.kind === 'custom' && tab.url && (
                        <span className="tab-list__url" title={tab.url}>
                          {tab.url}
                        </span>
                      )}
                    </label>
                    {tab.kind === 'custom' && (
                      <button
                        type="button"
                        className="tab-list__remove"
                        title="Remove tab"
                        onClick={() => removeTab(tab.id)}
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <div className="tab-add">
                <input
                  className="tab-add__input tab-add__input--name"
                  placeholder="Name (e.g. Twitter)"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addTab()
                  }}
                />
                <input
                  className="tab-add__input"
                  placeholder="URL (e.g. x.com)"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addTab()
                  }}
                />
                <button
                  type="button"
                  className="btn btn--primary btn--small"
                  onClick={addTab}
                  disabled={!newLabel.trim() || !normalizeUrl(newUrl)}
                >
                  Add
                </button>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">Ad blocking</h3>
            <div className="settings-field">
              <label className="settings-field__label settings-field__label--row">
                <input
                  type="checkbox"
                  checked={adblock}
                  onChange={(e) => onAdblockChange(e.target.checked)}
                />
                Block ads &amp; trackers
                <span className="settings-field__hint">
                  Network-level blocking (EasyList filters) in the YouTube, Browser and custom
                  tabs. Stremio is never filtered. Applies immediately.
                </span>
              </label>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">Background Tasks</h3>

            <div className="settings-field">
              <label className="settings-field__label">
                Call me back after
                <span className="settings-field__hint">
                  How long a background task can run before WorkStream interrupts you to check in.
                  Set to "Never" to disable the watchdog entirely.
                </span>
              </label>
              <div className="settings-presets">
                {WATCHDOG_PRESETS.map((preset) => (
                  <button
                    key={preset.ms}
                    type="button"
                    className={
                      'settings-preset' +
                      (preset.ms === watchdogMs ? ' settings-preset--selected' : '')
                    }
                    onClick={() => onWatchdogMsChange(preset.ms)}
                  >
                    {preset.label}
                  </button>
                ))}
                <span
                  className={
                    'settings-preset settings-preset--custom' +
                    (!isPresetWatchdog && watchdogMs > 0 ? ' settings-preset--selected' : '')
                  }
                >
                  <input
                    type="number"
                    min={0}
                    step="any"
                    className="settings-custom-minutes"
                    placeholder="Custom"
                    value={customMinutes}
                    onChange={(e) => applyCustomMinutes(e.target.value)}
                  />
                  min
                </span>
              </div>
            </div>
          </section>
        </div>
      </aside>
    </>
  )
}
