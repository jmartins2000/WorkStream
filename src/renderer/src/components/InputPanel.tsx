import { useState, type JSX } from 'react'
import type { InputRequest, InputResponse, UiQuestion } from '../../../shared/types'
import { Markdown } from './Markdown'

interface InputPanelProps {
  request: InputRequest
  onRespond: (response: InputResponse) => void
}

/**
 * Plan-mode review (the CLI's ExitPlanMode flow): show the full plan and let
 * the user approve (optionally with auto-accepted edits) or keep planning.
 * Approval also flips the live session out of plan mode via `setMode`.
 */
function PlanPrompt({
  plan,
  onRespond
}: {
  plan: string
  onRespond: (response: InputResponse) => void
}): JSX.Element {
  return (
    <div className="input-panel input-panel--plan">
      <div className="input-panel__title">Claude has a plan ready</div>
      <div className="plan-body">
        <Markdown>{plan}</Markdown>
      </div>
      <div className="input-panel__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => onRespond({ kind: 'permission', decision: 'allow', setMode: 'default' })}
        >
          Approve & execute
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            onRespond({ kind: 'permission', decision: 'allow', setMode: 'acceptEdits' })
          }
        >
          Approve, auto-accept edits
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => onRespond({ kind: 'permission', decision: 'deny' })}
        >
          Keep planning
        </button>
      </div>
    </div>
  )
}

/** Permission approval prompt for a tool Claude wants to run. */
function PermissionPrompt({
  toolName,
  detail,
  onRespond
}: {
  toolName: string
  detail: string
  onRespond: (response: InputResponse) => void
}): JSX.Element {
  const reply = (decision: 'allow' | 'allow-always' | 'deny'): void =>
    onRespond({ kind: 'permission', decision })

  return (
    <div className="input-panel">
      <div className="input-panel__title">Claude wants to use a tool</div>
      <div className="tool-chip">
        <span className="tool-chip__name">{toolName}</span>
        {detail && <span className="tool-chip__detail">{detail}</span>}
      </div>
      <div className="input-panel__actions">
        <button type="button" className="btn btn--primary" onClick={() => reply('allow')}>
          Allow once
        </button>
        <button type="button" className="btn" onClick={() => reply('allow-always')}>
          Allow always
        </button>
        <button type="button" className="btn btn--danger" onClick={() => reply('deny')}>
          Deny
        </button>
      </div>
    </div>
  )
}

/** Multiple-choice questions Claude asked via AskUserQuestion. */
function QuestionPrompt({
  questions,
  onRespond
}: {
  questions: UiQuestion[]
  onRespond: (response: InputResponse) => void
}): JSX.Element {
  // selections[i] = chosen labels for question i.
  const [selections, setSelections] = useState<string[][]>(() => questions.map(() => []))

  const toggle = (qi: number, label: string, multi: boolean): void => {
    setSelections((prev) => {
      const next = prev.map((s) => [...s])
      if (multi) {
        next[qi] = next[qi].includes(label)
          ? next[qi].filter((l) => l !== label)
          : [...next[qi], label]
      } else {
        next[qi] = [label]
      }
      return next
    })
  }

  const allAnswered = selections.every((s) => s.length > 0)

  const submit = (): void => {
    const answers: Record<string, string> = {}
    questions.forEach((q, i) => {
      answers[q.question] = selections[i].join(', ')
    })
    onRespond({ kind: 'question', answers })
  }

  return (
    <div className="input-panel">
      {questions.map((q, qi) => (
        <div key={qi} className="question">
          <div className="question__header">{q.header}</div>
          <div className="question__text">{q.question}</div>
          <div className="question__options">
            {q.options.map((opt) => {
              const selected = selections[qi].includes(opt.label)
              return (
                <button
                  key={opt.label}
                  type="button"
                  className={'option' + (selected ? ' option--selected' : '')}
                  onClick={() => toggle(qi, opt.label, q.multiSelect)}
                >
                  <span className="option__label">{opt.label}</span>
                  {opt.description && <span className="option__desc">{opt.description}</span>}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <div className="input-panel__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={submit}
          disabled={!allAnswered}
        >
          Submit
        </button>
      </div>
    </div>
  )
}

/** Renders whichever interaction Claude is waiting on. */
export function InputPanel({ request, onRespond }: InputPanelProps): JSX.Element {
  if (request.kind === 'permission') {
    if (request.plan) return <PlanPrompt plan={request.plan} onRespond={onRespond} />
    return (
      <PermissionPrompt
        toolName={request.toolName}
        detail={request.detail}
        onRespond={onRespond}
      />
    )
  }
  return <QuestionPrompt questions={request.questions} onRespond={onRespond} />
}
