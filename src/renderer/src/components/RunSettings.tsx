import { type JSX } from 'react'
import {
  RUN_EFFORTS,
  RUN_MODELS,
  RUN_PERMISSION_MODES,
  type RunSettings as RunSettingsType
} from '../../../shared/types'

interface RunSettingsBarProps {
  settings: RunSettingsType
  onChange: (settings: RunSettingsType) => void
  disabled: boolean
  /** Disable only the effort selector (it can't change mid-run, unlike
   *  model/permission mode which the SDK can switch on a live session). */
  disableEffort?: boolean
}

const PERMISSION_LABELS: Record<(typeof RUN_PERMISSION_MODES)[number], string> = {
  default: 'Ask',
  acceptEdits: 'Accept edits',
  plan: 'Plan',
  bypassPermissions: 'Bypass'
}

/** Compact selector bar mirroring /model, /effort and permission-mode cycling. */
export function RunSettingsBar({
  settings,
  onChange,
  disabled,
  disableEffort = false
}: RunSettingsBarProps): JSX.Element {
  return (
    <div className="run-settings">
      <label className="run-settings__field">
        <span>Model</span>
        <select
          value={settings.model}
          disabled={disabled}
          onChange={(e) => onChange({ ...settings, model: e.target.value as RunSettingsType['model'] })}
        >
          {RUN_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label className="run-settings__field">
        <span>Effort</span>
        <select
          value={settings.effort}
          disabled={disabled || disableEffort}
          onChange={(e) =>
            onChange({ ...settings, effort: e.target.value as RunSettingsType['effort'] })
          }
        >
          {RUN_EFFORTS.map((eff) => (
            <option key={eff} value={eff}>
              {eff}
            </option>
          ))}
        </select>
      </label>

      <label className="run-settings__field">
        <span>Permissions</span>
        <select
          value={settings.permissionMode}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...settings,
              permissionMode: e.target.value as RunSettingsType['permissionMode']
            })
          }
        >
          {RUN_PERMISSION_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {PERMISSION_LABELS[mode]}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
