import { useCallback, useEffect, useRef, useState } from 'react'
import type { InputRequest, InputResponse, RunEvent, TranscriptMessage } from '../../shared/types'

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
  setMessages: (messages: TranscriptMessage[], sessionId: string | null) => void
  start: (prompt: string, cwd: string) => Promise<void>
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
          setStreamingText((prev) => prev + event.text)
          break

        case 'message':
          setStreamingText('')
          setMessagesState((prev) => [...prev, event.message])
          break

        case 'needsInput':
          setPendingRequest(event.request)
          setStatus('awaiting-input')
          onAttentionRef.current()
          break

        case 'error':
          setError(event.message)
          break

        case 'completed': {
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
          activeRunId.current = null
          onAttentionRef.current()
          break
        }
      }
    })
    return unsubscribe
  }, [])

  const setMessages = useCallback((next: TranscriptMessage[], nextSessionId: string | null) => {
    setMessagesState(next)
    setSessionId(nextSessionId)
    setStreamingText('')
    setError(null)
    setStatus('idle')
    setPendingRequest(null)
  }, [])

  const start = useCallback(
    async (prompt: string, cwd: string) => {
      const trimmed = prompt.trim()
      if (!trimmed || activeRunId.current) return

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

      const { runId } = await window.claude.startRun({
        prompt: trimmed,
        cwd,
        resumeSessionId: sessionId ?? undefined
      })
      activeRunId.current = runId
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
    setMessages,
    start,
    cancel,
    respond
  }
}
