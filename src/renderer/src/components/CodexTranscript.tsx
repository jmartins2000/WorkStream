import { useEffect, useRef, useState, type JSX } from 'react'
import type { InputRequest, InputResponse, TranscriptMessage } from '../../../shared/types'
import { Markdown } from './Markdown'

interface CodexTranscriptProps {
  messages: TranscriptMessage[]
  streamingText: string
  running: boolean
  plan: { step: string; status: 'pending' | 'inProgress' | 'completed' }[] | null
  /** Pending approval/question — rendered INLINE (Codex-style), not as a modal. */
  pendingRequest: InputRequest | null
  onRespond: (response: InputResponse) => void
}

/** Collapsible reasoning, Codex-style ("Thought for a moment"). */
function Reasoning({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="cx-reasoning">
      <button type="button" className="cx-reasoning__toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} Thinking
      </button>
      {open && <div className="cx-reasoning__body">{text}</div>}
    </div>
  )
}

/** A command execution as a terminal-style block. */
function CommandBlock({
  command,
  output,
  isError
}: {
  command: string
  output?: string
  isError?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const hasOutput = typeof output === 'string' && output.length > 0
  return (
    <div className={'cx-command' + (isError ? ' cx-command--error' : '')}>
      <button
        type="button"
        className="cx-command__header"
        onClick={() => hasOutput && setOpen((o) => !o)}
      >
        <span className="cx-command__prompt">$</span>
        <span className="cx-command__text">{command}</span>
        {hasOutput && <span className="cx-command__caret">{open ? '▾' : '▸'}</span>}
      </button>
      {open && hasOutput && <pre className="cx-command__output">{output}</pre>}
    </div>
  )
}

/** A file-change card (Edit chips). */
function FileChangeCard({ detail, isError }: { detail: string; isError?: boolean }): JSX.Element {
  const files = detail.split(',').map((f) => f.trim()).filter(Boolean)
  return (
    <div className={'cx-filechange' + (isError ? ' cx-filechange--error' : '')}>
      <span className="cx-filechange__icon">±</span>
      <span className="cx-filechange__files">
        {files.length > 0 ? files.join('  ·  ') : 'File changes'}
      </span>
    </div>
  )
}

/** The agent's live plan as a checklist card. */
function PlanCard({
  plan
}: {
  plan: { step: string; status: 'pending' | 'inProgress' | 'completed' }[]
}): JSX.Element {
  return (
    <div className="cx-plan">
      <div className="cx-plan__title">Plan</div>
      <ul className="cx-plan__steps">
        {plan.map((step, i) => (
          <li key={i} className={`cx-plan__step cx-plan__step--${step.status}`}>
            <span className="cx-plan__mark">
              {step.status === 'completed' ? '✓' : step.status === 'inProgress' ? '›' : '○'}
            </span>
            {step.step}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Inline approval card — how the Codex app surfaces approvals. */
function ApprovalCard({
  request,
  onRespond
}: {
  request: InputRequest
  onRespond: (response: InputResponse) => void
}): JSX.Element {
  const [selections, setSelections] = useState<Record<string, string>>({})

  if (request.kind === 'permission') {
    return (
      <div className="cx-approval">
        <div className="cx-approval__title">
          {request.toolName === 'Edit files' ? 'Codex wants to edit files' : 'Codex wants to run'}
        </div>
        {request.detail && <code className="cx-approval__detail">{request.detail}</code>}
        <div className="cx-approval__actions">
          <button
            type="button"
            className="cx-btn cx-btn--primary"
            onClick={() => onRespond({ kind: 'permission', decision: 'allow' })}
          >
            Allow
          </button>
          <button
            type="button"
            className="cx-btn"
            onClick={() => onRespond({ kind: 'permission', decision: 'allow-always' })}
          >
            Allow for session
          </button>
          <button
            type="button"
            className="cx-btn cx-btn--danger"
            onClick={() => onRespond({ kind: 'permission', decision: 'deny' })}
          >
            Deny
          </button>
        </div>
      </div>
    )
  }

  const allAnswered = request.questions.every((q) => selections[q.question])
  return (
    <div className="cx-approval">
      {request.questions.map((q) => (
        <div key={q.question} className="cx-approval__question">
          <div className="cx-approval__title">{q.question}</div>
          <div className="cx-approval__options">
            {q.options.map((opt) => (
              <button
                key={opt.label}
                type="button"
                className={
                  'cx-option' + (selections[q.question] === opt.label ? ' cx-option--selected' : '')
                }
                onClick={() => setSelections((prev) => ({ ...prev, [q.question]: opt.label }))}
              >
                <span className="cx-option__label">{opt.label}</span>
                {opt.description && <span className="cx-option__desc">{opt.description}</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="cx-approval__actions">
        <button
          type="button"
          className="cx-btn cx-btn--primary"
          disabled={!allAnswered}
          onClick={() => onRespond({ kind: 'question', answers: selections })}
        >
          Submit
        </button>
      </div>
    </div>
  )
}

/** Codex-styled conversation view. */
export function CodexTranscript({
  messages,
  streamingText,
  running,
  plan,
  pendingRequest,
  onRespond
}: CodexTranscriptProps): JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText, pendingRequest])

  if (messages.length === 0 && !streamingText && !running && !pendingRequest) {
    return (
      <div className="cx-transcript cx-transcript--empty">
        <p>What are we coding next?</p>
      </div>
    )
  }

  return (
    <div className="cx-transcript">
      {messages.map((message) => (
        <div key={message.id} className={`cx-msg cx-msg--${message.role}`}>
          {message.parts.map((part, index) => {
            if (part.kind === 'thinking') return <Reasoning key={index} text={part.text} />
            if (part.kind === 'tool') {
              if (part.name === 'Command') {
                return (
                  <CommandBlock
                    key={index}
                    command={part.detail}
                    output={part.result}
                    isError={part.isError}
                  />
                )
              }
              if (part.name === 'Edit') {
                return <FileChangeCard key={index} detail={part.detail} isError={part.isError} />
              }
              return (
                <div key={index} className="cx-toolnote">
                  {part.name} {part.detail && <span className="cx-toolnote__detail">{part.detail}</span>}
                </div>
              )
            }
            return message.role === 'user' ? (
              <div key={index} className="cx-user-bubble">
                {part.text}
              </div>
            ) : (
              <div key={index} className="cx-agent-text">
                <Markdown>{part.text}</Markdown>
              </div>
            )
          })}
        </div>
      ))}

      {plan && <PlanCard plan={plan} />}

      {streamingText && (
        <div className="cx-msg cx-msg--assistant">
          <div className="cx-agent-text cx-agent-text--streaming">{streamingText}</div>
        </div>
      )}

      {running && !streamingText && !pendingRequest && (
        <div className="cx-working">Working…</div>
      )}

      {pendingRequest && <ApprovalCard request={pendingRequest} onRespond={onRespond} />}

      <div ref={endRef} />
    </div>
  )
}
