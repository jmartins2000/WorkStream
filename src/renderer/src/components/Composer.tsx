import { useState, type JSX, type KeyboardEvent } from 'react'

interface ComposerProps {
  running: boolean
  disabled: boolean
  onSend: (prompt: string) => void
  onCancel: () => void
}

/** Prompt input. Enter sends, Shift+Enter inserts a newline. */
export function Composer({ running, disabled, onSend, onCancel }: ComposerProps): JSX.Element {
  const [value, setValue] = useState('')

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

  return (
    <div className="composer">
      <textarea
        className="composer__input"
        placeholder={
          running ? 'Claude is working — you can queue your next thought…' : 'Message Claude…'
        }
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
      />
      <div className="composer__actions">
        {running ? (
          <button type="button" className="btn btn--danger" onClick={onCancel}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={submit}
            disabled={disabled || !value.trim()}
          >
            Send
          </button>
        )}
      </div>
    </div>
  )
}
