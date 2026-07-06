import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CodexRunSettings,
  InputRequest,
  InputResponse,
  RunEvent,
  RunUsage,
  TranscriptMessage
} from '../../shared/types'

export type CodexRunStatus = 'idle' | 'running' | 'awaiting-input' | 'done' | 'error'

export interface UseCodexRun {
  status: CodexRunStatus
  messages: TranscriptMessage[]
  streamingText: string
  /** Codex thread id of the open conversation (protocol sessionId). */
  threadId: string | null
  runId: string | null
  error: string | null
  pendingRequest: InputRequest | null
  usage: RunUsage | null
  setMessages: (messages: TranscriptMessage[], threadId: string | null) => void
  start: (prompt: string, cwd: string, settings?: CodexRunSettings) => Promise<void>
  cancel: () => void
  respond: (response: InputResponse) => void
}

/**
 * One logical Codex conversation. Mirrors useClaudeRun but leaner: Codex
 * steers live turns (turn/steer), so mid-run sends join the conversation
 * immediately — no queued-prompt bookkeeping. Events arrive on the shared
 * RunEvent channel, filtered by our runId.
 */
export function useCodexRun(onAttention: () => void): UseCodexRun {
  const [status, setStatus] = useState<CodexRunStatus>('idle')
  const [messages, setMessagesState] = useState<TranscriptMessage[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [threadId, setThreadId] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingRequest, setPendingRequest] = useState<InputRequest | null>(null)
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
          if (event.sessionId) setThreadId(event.sessionId)
          setStatus('running')
          break

        case 'delta':
          setStatus((s) => (s === 'awaiting-input' ? s : 'running'))
          setStreamingText((prev) => prev + event.text)
          break

        case 'message':
          setStatus((s) => (s === 'awaiting-input' ? s : 'running'))
          // A full agent message replaces its streamed buffer.
          if (event.message.parts.some((p) => p.kind === 'text')) setStreamingText('')
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

        case 'error':
          setError(event.message)
          break

        case 'completed':
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

        case 'closed':
          setPendingRequest(null)
          activeRunId.current = null
          setRunId(null)
          break

        default:
          break
      }
    })
    return unsubscribe
  }, [])

  const setMessages = useCallback((next: TranscriptMessage[], nextThreadId: string | null) => {
    if (activeRunId.current) {
      void window.claude.endCodexRun(activeRunId.current)
      activeRunId.current = null
      setRunId(null)
    }
    setMessagesState(next)
    setThreadId(nextThreadId)
    setStreamingText('')
    setError(null)
    setStatus('idle')
    setPendingRequest(null)
  }, [])

  const start = useCallback(
    async (prompt: string, cwd: string, settings?: CodexRunSettings) => {
      const trimmed = prompt.trim()
      if (!trimmed) return

      setMessagesState((prev) => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          role: 'user',
          parts: [{ kind: 'text', text: trimmed }],
          timestamp: Date.now()
        }
      ])
      setError(null)
      setStatus('running')

      try {
        if (activeRunId.current) {
          // Live conversation: steers the active turn or starts the next one.
          await window.claude.sendCodexMessage(activeRunId.current, trimmed)
        } else {
          const { runId: startedId } = await window.claude.startCodexRun({
            prompt: trimmed,
            cwd,
            resumeThreadId: threadId ?? undefined,
            settings
          })
          activeRunId.current = startedId
          setRunId(startedId)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      }
    },
    [threadId]
  )

  const cancel = useCallback(() => {
    if (activeRunId.current) void window.claude.cancelCodexRun(activeRunId.current)
  }, [])

  const respond = useCallback(
    (response: InputResponse) => {
      if (!pendingRequest) return
      void window.claude.respondCodexInput(pendingRequest.requestId, response)
      setPendingRequest(null)
      setStatus('running')
    },
    [pendingRequest]
  )

  return {
    status,
    messages,
    streamingText,
    threadId,
    runId,
    error,
    pendingRequest,
    usage,
    setMessages,
    start,
    cancel,
    respond
  }
}
