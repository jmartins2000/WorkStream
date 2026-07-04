import { useEffect, useRef, useState, type JSX } from 'react'
import type { MessagePart, TranscriptMessage } from '../../../shared/types'
import { Markdown } from './Markdown'

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

/**
 * How many messages to render initially and to load per scroll-to-top.
 * Keeps the DOM small for long sessions while making history accessible.
 */
const PAGE_SIZE = 20

/** Plain-text rendering of a message's parts, for copy-to-clipboard. */
function messageToText(message: TranscriptMessage): string {
  return message.parts
    .map((part) => {
      if (part.kind === 'text' || part.kind === 'thinking') return part.text
      return `${part.name}${part.detail ? ': ' + part.detail : ''}`
    })
    .join('\n\n')
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

/** A tool call chip; expands to show the tool's output when available. */
function ToolPart({
  name,
  detail,
  result,
  isError
}: {
  name: string
  detail: string
  result?: string
  isError?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const hasResult = typeof result === 'string' && result.length > 0
  return (
    <div className="tool">
      <button
        type="button"
        className={'tool-chip' + (hasResult ? ' tool-chip--clickable' : '')}
        onClick={() => hasResult && setOpen((o) => !o)}
      >
        {hasResult && <span className="tool-chip__caret">{open ? '▾' : '▸'}</span>}
        <span className="tool-chip__name">{name}</span>
        {detail && <span className="tool-chip__detail">{detail}</span>}
        {isError && <span className="tool-chip__error">error</span>}
      </button>
      {open && hasResult && <pre className="tool-output">{result}</pre>}
    </div>
  )
}

/** Render a single message part (text, tool chip, or thinking). */
function Part({ part }: { part: MessagePart }): JSX.Element | null {
  switch (part.kind) {
    case 'text':
      return (
        <div className="message__text">
          <Markdown>{part.text}</Markdown>
        </div>
      )
    case 'tool':
      return (
        <ToolPart
          name={part.name}
          detail={part.detail}
          result={part.result}
          isError={part.isError}
        />
      )
    case 'thinking':
      return <Thinking text={part.text} />
    default:
      return null
  }
}

/**
 * Scrolling list of curated conversation messages plus the live stream.
 *
 * Only the most recent PAGE_SIZE messages are rendered initially. Scrolling
 * to the top loads the previous page, with scroll-position restoration so
 * the viewport doesn't jump.
 */
export function Transcript({ messages, streamingText, running }: TranscriptProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // Refs used for scroll-position management. Using refs (not state) avoids
  // extra render cycles.
  const prevScrollHeightRef = useRef(0)
  const loadingMoreRef = useRef(false)
  // Set to true by the session-reset effect so the visibleCount effect knows
  // to scroll to the bottom rather than restore the old scroll position.
  const pendingScrollToBottomRef = useRef(false)

  const hasMore = visibleCount < messages.length
  const visibleMessages = messages.slice(-visibleCount)

  // Reset windowing whenever the session changes (different first message id).
  // Mark pendingScrollToBottomRef so the visibleCount effect scrolls to the
  // bottom after the DOM reflects the new (smaller) slice.
  const firstMsgId = messages[0]?.id
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
    loadingMoreRef.current = false
    pendingScrollToBottomRef.current = true
  }, [firstMsgId])

  // Auto-scroll to the bottom when new messages arrive or streaming progresses.
  // Skip only when loading older history (scroll position is restored separately).
  // When a session just changed (pendingScrollToBottomRef), use instant scroll
  // instead of smooth — and always clear the flag so it doesn't linger.
  useEffect(() => {
    if (loadingMoreRef.current) return
    endRef.current?.scrollIntoView({
      behavior: pendingScrollToBottomRef.current ? 'instant' : 'smooth'
    })
    pendingScrollToBottomRef.current = false
  }, [messages, streamingText])

  // After visibleCount changes due to loading older messages: restore the
  // scroll position so the viewport stays on the same message, not the new top.
  useEffect(() => {
    if (!loadingMoreRef.current) return
    const el = scrollRef.current
    if (el && prevScrollHeightRef.current > 0) {
      el.scrollTop = el.scrollHeight - prevScrollHeightRef.current
    }
    prevScrollHeightRef.current = 0
    loadingMoreRef.current = false
  }, [visibleCount])

  const handleScroll = (): void => {
    const el = scrollRef.current
    if (!el || !hasMore || loadingMoreRef.current) return
    if (el.scrollTop < 80) {
      loadingMoreRef.current = true
      prevScrollHeightRef.current = el.scrollHeight
      setVisibleCount((c) => Math.min(c + PAGE_SIZE, messages.length))
    }
  }

  if (messages.length === 0 && !streamingText && !running) {
    return (
      <div className="transcript transcript--empty">
        <p>Pick a session or start a new one, then send a prompt.</p>
        <p className="hint">
          Claude works in the background while you watch. When it finishes, playback pauses and
          this view comes forward.
        </p>
      </div>
    )
  }

  return (
    <div className="transcript" ref={scrollRef} onScroll={handleScroll}>
      {hasMore && (
        <p className="transcript__more">↑ {messages.length - visibleCount} older messages</p>
      )}

      {visibleMessages.map((message) => (
        <article key={message.id} className={`message message--${message.role}`}>
          <header className="message__role">
            {ROLE_LABEL[message.role]}
            <button
              type="button"
              className="message__copy"
              title="Copy message"
              onClick={() => void navigator.clipboard.writeText(messageToText(message))}
            >
              ⧉
            </button>
          </header>
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
            <div className="message__text message__text--stream">{streamingText}</div>
          </div>
        </article>
      )}

      {running && !streamingText && <div className="thinking">Claude is working…</div>}

      <div ref={endRef} />
    </div>
  )
}
