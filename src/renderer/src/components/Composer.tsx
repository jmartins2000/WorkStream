import { useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'

interface ComposerProps {
  running: boolean
  disabled: boolean
  commands: string[]
  onSend: (prompt: string) => void
  onCancel: () => void
}

/** Normalize a slash-command name to a bare name without the leading slash. */
function bareName(command: string): string {
  return command.startsWith('/') ? command.slice(1) : command
}

/**
 * Prompt input with slash-command autocomplete. Enter sends, Shift+Enter newline.
 *
 * Sending stays available while Claude is working (like the CLI): the message
 * is queued into the live streaming session. While running, the single action
 * button shows Stop — mid-run sends go through Enter.
 */
export function Composer({
  running,
  disabled,
  commands,
  onSend,
  onCancel
}: ComposerProps): JSX.Element {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow: start at a single line and expand with content, capped so long
  // prompts scroll instead of swallowing the transcript.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto' // reset so shrinking works too
    const max = Math.round(window.innerHeight * 0.3)
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [value])

  // Show command suggestions while typing a leading slash token (no space yet).
  const suggestions = useMemo(() => {
    if (!value.startsWith('/') || value.includes(' ')) return []
    const query = value.slice(1).toLowerCase()
    return commands
      .map(bareName)
      .filter((name) => name.toLowerCase().startsWith(query))
      .slice(0, 8)
  }, [value, commands])

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
      {suggestions.length > 0 && (
        <ul className="command-menu">
          {suggestions.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="command-menu__item"
                onClick={() => setValue(`/${name} `)}
              >
                /{name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="composer__row">
        <textarea
          ref={inputRef}
          className="composer__input"
          placeholder={
            running
              ? 'Claude is working — hit Enter to queue a message…'
              : 'Message Claude…  (try / for commands)'
          }
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
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
    </div>
  )
}
