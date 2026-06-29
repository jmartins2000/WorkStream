import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  InputRequest,
  InputResponse,
  RunEvent,
  RunSettings,
  RunUsage,
  TranscriptMessage
} from '../../shared/types'

export type RunStatus = 'idle' | 'running' | 'awaiting-input' | 'done' | 'error'

export interface UseClaudeRun {
  status: RunStatus
  messages: TranscriptMessage[]
  streamingText: string
  sessionId: string | null
  error: string | null
  /** Slash commands available in the current session (from the init event). */
  commands: string[]
  /** A pending question/permission Claude is waiting on, if any. */
  pendingRequest: InputRequest | null
  /** True while a background task is running and a continuation is expected. */
  backgroundActive: boolean
  /** Cost/token usage from the most recent completed run, if any. */
  usage: RunUsage | null
  setMessages: (messages: TranscriptMessage[], sessionId: string | null) => void
  start: (prompt: string, cwd: string, settings?: RunSettings) => Promise<void>
  cancel: () => void
  /** Reply to the pending input request. */
  respond: (response: InputResponse) => void
}

/**
 * Manages a single logical Claude Code conversation: transcript, streaming run,
 * interactive prompts, and lifecycle. `onAttention` fires whenever Claude needs
 * the user — either it finished or it is asking a question / requesting
 * permission — so the app can pause Stremio and surface the cockpit.
 */
export function useClaudeRun(onAttention: () => void): UseClaudeRun {
  const [status, setStatus] = useState<RunStatus>('idle')
  const [messages, setMessagesState] = useState<TranscriptMessage[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [commands, setCommands] = useState<string[]>([])
  const [pendingRequest, setPendingRequest] = useState<InputRequest | null>(null)
  const [backgroundActive, setBackgroundActive] = useState(false)
  const [usage, setUsage] = useState<RunUsage | null>(null)

  const activeRunId = useRef<string | null>(null)
  const onAttentionRef = useRef(onAttention)
  useEffect(() => {
    onAttentionRef.current = onAttention
  }, [onAttention])

  useEffect(() => {
    const unsubscribe = window.claude.onRunEvent((event: RunEvent) => {
      if (event.runId !== activeRunId.current) return

      switch (event.type) {
        case 'started':
          if (event.sessionId) setSessionId(event.sessionId)
          break

        case 'slashCommands':
          setCommands(event.commands)
          break

        case 'delta':
          // A new turn may begin on its own (background-task continuation):
          // reflect that we're working again unless we're blocked on input.
          setStatus((s) => (s === 'awaiting-input' ? s : 'running'))
          setStreamingText((prev) => prev + event.text)
          break

        case 'message':
          setStatus((s) => (s === 'awaiting-input' ? s : 'running'))
          setStreamingText('')
          setMessagesState((prev) => [...prev, event.message])
          break

        case 'needsInput':
          setPendingRequest(event.request)
          setStatus('awaiting-input')
          onAttentionRef.current()
          break

        case 'usage':
          setUsage(event.usage)
          break

        case 'taskStarted':
          setBackgroundActive(true)
          break

        case 'taskCompleted':
          setBackgroundActive(false)
          break

        case 'error':
          setError(event.message)
          break

        case 'completed': {
          // A single turn ended. The streaming session stays alive, so we keep
          // activeRunId — the agent can continue (e.g. when a background task
          // finishes) and the user can send a follow-up without resuming.
          if (event.sessionId) setSessionId(event.sessionId)
          setStreamingText((trailing) => {
            if (trailing.trim()) {
              setMessagesState((prev) => [
                ...prev,
                {
                  id: `stream-${Date.now()}`,
                  role: 'assistant',
                  parts: [{ kind: 'text', text: trailing }],
                  timestamp: Date.now()
                }
              ])
            }
            return ''
          })
          setStatus(event.ok ? 'done' : 'error')
          setPendingRequest(null)
          onAttentionRef.current()
          break
        }

        case 'closed':
          // The session itself ended; a fresh send will start/resume a new one.
          if (event.sessionId) setSessionId(event.sessionId)
          setBackgroundActive(false)
          setPendingRequest(null)
          activeRunId.current = null
          break
      }
    })
    return unsubscribe
  }, [])

  const setMessages = useCallback((next: TranscriptMessage[], nextSessionId: string | null) => {
    // Switching conversations: tear down any live streaming session first.
    if (activeRunId.current) {
      void window.claude.endRun(activeRunId.current)
      activeRunId.current = null
    }
    setMessagesState(next)
    setSessionId(nextSessionId)
    setStreamingText('')
    setError(null)
    setStatus('idle')
    setPendingRequest(null)
    setBackgroundActive(false)
  }, [])

  const start = useCallback(
    async (prompt: string, cwd: string, settings?: RunSettings) => {
      const trimmed = prompt.trim()
      if (!trimmed) return

      const userMessage: TranscriptMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        parts: [{ kind: 'text', text: trimmed }],
        timestamp: Date.now()
      }
      setMessagesState((prev) => [...prev, userMessage])
      setStreamingText('')
      setError(null)
      setStatus('running')

      // Push into the live session if one exists; otherwise open a new one
      // (resuming the on-disk session when we have its id).
      if (activeRunId.current) {
        await window.claude.sendMessage(activeRunId.current, trimmed)
      } else {
        const { runId } = await window.claude.startRun({
          prompt: trimmed,
          cwd,
          resumeSessionId: sessionId ?? undefined,
          settings
        })
        activeRunId.current = runId
      }
    },
    [sessionId]
  )

  const cancel = useCallback(() => {
    if (activeRunId.current) window.claude.cancelRun(activeRunId.current)
  }, [])

  const respond = useCallback(
    (response: InputResponse) => {
      if (!pendingRequest) return
      void window.claude.respondInput(pendingRequest.requestId, response)
      setPendingRequest(null)
      setStatus('running')
    },
    [pendingRequest]
  )

  return {
    status,
    messages,
    streamingText,
    sessionId,
    error,
    commands,
    pendingRequest,
    backgroundActive,
    usage,
    setMessages,
    start,
    cancel,
    respond
  }
}
