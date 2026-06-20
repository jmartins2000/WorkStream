import { useEffect, useRef, type JSX } from 'react'
import type { TranscriptMessage } from '../../../shared/types'

interface TranscriptProps {
  messages: TranscriptMessage[]
  streamingText: string
  running: boolean
}

const ROLE_LABEL: Record<TranscriptMessage['role'], string> = {
  user: 'You',
  assistant: 'Claude',
  system: 'System',
  tool: 'Tool'
}

/** Scrolling list of conversation messages plus the live streaming bubble. */
export function Transcript({ messages, streamingText, running }: TranscriptProps): JSX.Element {
  const endRef = useRef<HTMLDivElement | null>(null)

  // Keep the newest content in view as it streams in.
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
          <div className="message__text">{message.text}</div>
        </article>
      ))}

      {streamingText && (
        <article className="message message--assistant message--streaming">
          <header className="message__role">Claude</header>
          <div className="message__text">{streamingText}</div>
        </article>
      )}

      {running && !streamingText && (
        <div className="thinking">Claude is working…</div>
      )}

      <div ref={endRef} />
    </div>
  )
}
