import type { JSX } from 'react'

const WATCHDOG_PRESETS: { label: string; ms: number }[] = [
  { label: '5 min', ms: 5 * 60 * 1000 },
  { label: '15 min', ms: 15 * 60 * 1000 },
  { label: '30 min', ms: 30 * 60 * 1000 },
  { label: '1 hr', ms: 60 * 60 * 1000 },
  { label: '2 hr', ms: 2 * 60 * 60 * 1000 },
  { label: 'Never', ms: 0 }
]

interface SettingsPanelProps {
  watchdogMs: number
  onWatchdogMsChange: (ms: number) => void
  onClose: () => void
}

export function SettingsPanel({
  watchdogMs,
  onWatchdogMsChange,
  onClose
}: SettingsPanelProps): JSX.Element {
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
              </div>
            </div>
          </section>
        </div>
      </aside>
    </>
  )
}
