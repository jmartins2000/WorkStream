import { useEffect, useRef, useState, type JSX } from 'react'
import type { MessagePart, TranscriptMessage } from '../../../shared/types'

interface TranscriptProps {
  messages: TranscriptMessage[]
  streamingText: string
  running: boolean
}

const ROLE_LABEL: Record<TranscriptMessage['role'], string> = {
  user: 'You',
  assistant: 'Claude',
  system: 'System'
}

/** A collapsed extended-thinking block, expandable on click. */
function Thinking({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="thinking-block">
      <button type="button" className="thinking-block__toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} Thinking
      </button>
      {open && <div className="thinking-block__body">{text}</div>}
    </div>
  )
}

/** Render a single message part (text, tool chip, or thinking). */
function Part({ part }: { part: MessagePart }): JSX.Element | null {
  switch (part.kind) {
    case 'text':
      return <div className="message__text">{part.text}</div>
    case 'tool':
      return (
        <div className="tool-chip">
          <span className="tool-chip__name">{part.name}</span>
          {part.detail && <span className="tool-chip__detail">{part.detail}</span>}
        </div>
      )
    case 'thinking':
      return <Thinking text={part.text} />
    default:
      return null
  }
}

/** Scrolling list of curated conversation messages plus the live stream. */
export function Transcript({ messages, streamingText, running }: TranscriptProps): JSX.Element {
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  if (messages.length === 0 && !streamingText && !running) {
    return (
      <div className="transcript transcript--empty">
        <p>Pick a session or start a new one, then send a prompt.</p>
        <p className="hint">
          Claude works in the background while you watch Stremio. When it finishes, playback
          pauses and this view comes forward.
        </p>
      </div>
    )
  }

  return (
    <div className="transcript">
      {messages.map((message) => (
        <article key={message.id} className={`message message--${message.role}`}>
          <header className="message__role">{ROLE_LABEL[message.role]}</header>
          <div className="message__parts">
            {message.parts.map((part, index) => (
              <Part key={index} part={part} />
            ))}
          </div>
        </article>
      ))}

      {streamingText && (
        <article className="message message--assistant message--streaming">
          <header className="message__role">Claude</header>
          <div className="message__parts">
            <div className="message__text">{streamingText}</div>
          </div>
        </article>
      )}

      {running && !streamingText && <div className="thinking">Claude is working…</div>}

      <div ref={endRef} />
    </div>
  )
}
