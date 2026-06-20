import { useCallback, useEffect, useRef, useState } from 'react'
import type { RunEvent, TranscriptMessage } from '../../shared/types'

export type RunStatus = 'idle' | 'running' | 'done' | 'error'

export interface UseClaudeRun {
  status: RunStatus
  /** Loaded transcript plus any messages produced during this app session. */
  messages: TranscriptMessage[]
  /** Live assistant text accumulating from stream deltas, if any. */
  streamingText: string
  /** The session id currently in focus (loaded or freshly created). */
  sessionId: string | null
  error: string | null
  /** Replace the transcript (e.g. after loading a historical session). */
  setMessages: (messages: TranscriptMessage[], sessionId: string | null) => void
  /** Start a run in the given cwd; resumes `sessionId` when one is set. */
  start: (prompt: string, cwd: string) => Promise<void>
  /** Cancel the in-flight run, if any. */
  cancel: () => void
}

/**
 * Manages a single logical Claude Code conversation: its transcript, the
 * streaming run, and lifecycle. `onComplete` fires once per run when it
 * finishes (success, error, or cancel) — the app uses this to pause Stremio
 * and surface the cockpit.
 */
export function useClaudeRun(onComplete: (ok: boolean) => void): UseClaudeRun {
  const [status, setStatus] = useState<RunStatus>('idle')
  const [messages, setMessagesState] = useState<TranscriptMessage[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Track the active run id so we ignore stray events from prior runs.
  const activeRunId = useRef<string | null>(null)
  // Keep the latest onComplete without resubscribing on every render.
  const onCompleteRef = useRef(onComplete)
  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    const unsubscribe = window.claude.onRunEvent((event: RunEvent) => {
      if (event.runId !== activeRunId.current) return

      switch (event.type) {
        case 'started':
          if (event.sessionId) setSessionId(event.sessionId)
          break

        case 'delta':
          setStreamingText((prev) => prev + event.text)
          break

        case 'message':
          // A finalized assistant message supersedes the streaming buffer.
          setStreamingText('')
          setMessagesState((prev) => [...prev, event.message])
          break

        case 'error':
          setError(event.message)
          break

        case 'completed': {
          if (event.sessionId) setSessionId(event.sessionId)
          // Flush any trailing streamed text that never arrived as a message.
          setStreamingText((trailing) => {
            if (trailing.trim()) {
              setMessagesState((prev) => [
                ...prev,
                {
                  id: `stream-${Date.now()}`,
                  role: 'assistant',
                  text: trailing,
                  timestamp: Date.now()
                }
              ])
            }
            return ''
          })
          setStatus(event.ok ? 'done' : 'error')
          activeRunId.current = null
          onCompleteRef.current(event.ok)
          break
        }
      }
    })
    return unsubscribe
  }, [])

  const setMessages = useCallback(
    (next: TranscriptMessage[], nextSessionId: string | null) => {
      setMessagesState(next)
      setSessionId(nextSessionId)
      setStreamingText('')
      setError(null)
      setStatus('idle')
    },
    []
  )

  const start = useCallback(
    async (prompt: string, cwd: string) => {
      const trimmed = prompt.trim()
      if (!trimmed || activeRunId.current) return

      // Optimistically show the user's prompt immediately.
      const userMessage: TranscriptMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: trimmed,
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

  return {
    status,
    messages,
    streamingText,
    sessionId,
    error,
    setMessages,
    start,
    cancel
  }
}
