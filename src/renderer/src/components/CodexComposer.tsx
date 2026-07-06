import { useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import type { CodexModel, CodexRunSettings } from '../../../shared/types'

/**
 * Codex's access presets ("collaboration modes"): one pill instead of two
 * separate approval/sandbox selectors — matching how the Codex app frames it.
 */
export const ACCESS_MODES: {
  id: string
  label: string
  settings: Pick<CodexRunSettings, 'approvalPolicy' | 'sandbox'>
}[] = [
  { id: 'read', label: 'Read-only', settings: { approvalPolicy: 'on-request', sandbox: 'readOnly' } },
  { id: 'agent', label: 'Agent', settings: { approvalPolicy: 'on-request', sandbox: 'workspaceWrite' } },
  {
    id: 'full',
    label: 'Full access',
    settings: { approvalPolicy: 'never', sandbox: 'dangerFullAccess' }
  }
]

interface CodexComposerProps {
  running: boolean
  disabled: boolean
  models: CodexModel[]
  settings: CodexRunSettings
  accessMode: string
  onSettingsChange: (settings: CodexRunSettings) => void
  onAccessModeChange: (id: string) => void
  onSend: (prompt: string) => void
  onCancel: () => void
}

/** Codex-styled composer: rounded field with inline model/effort/access pills. */
export function CodexComposer({
  running,
  disabled,
  models,
  settings,
  accessMode,
  onSettingsChange,
  onAccessModeChange,
  onSend,
  onCancel
}: CodexComposerProps): JSX.Element {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const max = Math.round(window.innerHeight * 0.3)
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [value])

  const submit = (): void => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const selectedModel = models.find((m) => m.id === settings.model)

  return (
    <div className="cx-composer">
      <textarea
        ref={inputRef}
        className="cx-composer__input"
        placeholder={running ? 'Reply to steer Codex…' : 'Describe a task…'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        spellCheck={false}
      />
      <div className="cx-composer__bar">
        <div className="cx-composer__pills">
          <select
            className="cx-pill"
            value={settings.model ?? ''}
            onChange={(e) => {
              const model = models.find((m) => m.id === e.target.value)
              onSettingsChange({
                ...settings,
                model: e.target.value,
                effort: model?.defaultEffort ?? settings.effort
              })
            }}
            title="Model"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
          <select
            className="cx-pill"
            value={settings.effort ?? ''}
            onChange={(e) => onSettingsChange({ ...settings, effort: e.target.value })}
            title="Reasoning effort"
          >
            {(selectedModel?.efforts ?? []).map((effort) => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </select>
          <select
            className="cx-pill"
            value={accessMode}
            onChange={(e) => onAccessModeChange(e.target.value)}
            title="What Codex may touch"
          >
            {ACCESS_MODES.map((mode) => (
              <option key={mode.id} value={mode.id}>
                {mode.label}
              </option>
            ))}
          </select>
        </div>
        {running ? (
          <button type="button" className="cx-send cx-send--stop" onClick={onCancel} title="Stop">
            ■
          </button>
        ) : (
          <button
            type="button"
            className="cx-send"
            onClick={submit}
            disabled={disabled || !value.trim()}
            title="Send"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  )
}
