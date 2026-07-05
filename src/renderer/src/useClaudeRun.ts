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

/** A background task (Bash run_in_background or SDK sub-agent) tracked for the watchdog. */
export interface BackgroundTask {
  taskId: string
  description: string
  /** 'process' for shell commands, 'agent' for sub-agents (heuristic). */
  kind: 'process' | 'agent'
  /** Epoch ms when the taskStarted event arrived. */
  startedAt: number
  /** When true the watchdog will never fire for this task again. */
  dismissedWatchdog: boolean
  /** Epoch ms until which watchdog alerts are snoozed, or null. */
  snoozedUntil: number | null
}

export interface UseClaudeRun {
  status: RunStatus
  messages: TranscriptMessage[]
  streamingText: string
  /** Prompts sent while Claude was mid-turn, not yet picked up. They join the
   *  transcript when the CLI starts the turn that includes them. */
  queuedPrompts: string[]
  sessionId: string | null
  /** Id of the live streaming session, if any — needed for control APIs
   *  (/context, /mcp, mid-run switches). Null when no session is live. */
  runId: string | null
  error: string | null
  /** Slash commands available in the current session (from the init event). */
  commands: string[]
  /** A pending question/permission Claude is waiting on, if any. */
  pendingRequest: InputRequest | null
  /** True while any background task is still running. */
  backgroundActive: boolean
  /** All currently tracked background tasks for this session. */
  backgroundTasks: BackgroundTask[]
  /** Cost/token usage from the most recent completed run, if any. */
  usage: RunUsage | null
  setMessages: (messages: TranscriptMessage[], sessionId: string | null) => void
  start: (
    prompt: string,
    cwd: string,
    settings?: RunSettings,
    remoteControl?: boolean
  ) => Promise<void>
  /** Make sure a live streaming session exists for the open conversation
   *  (warm-opens one with no prompt if needed), so the control APIs
   *  (/context, /mcp, …) work before the first message is sent. */
  ensureSession: (cwd: string, settings?: RunSettings, remoteControl?: boolean) => Promise<void>
  cancel: () => void
  /** Reply to the pending input request. */
  respond: (response: InputResponse) => void
  /** Remove a task from monitoring and interrupt Claude's current turn. */
  killTask: (taskId: string) => void
  /** Snooze watchdog alerts for a task until now + durationMs. */
  snoozeTask: (taskId: string, durationMs: number) => void
  /** Stop watchdog alerts for a task permanently (task stays tracked). */
  dismissTask: (taskId: string) => void
}

/** Heuristic: does the description look like a shell command? */
const SHELL_CMD_RE = /^(npm|npx|node|python3?|ruby|cargo|go |make|bash|sh |curl|wget|cd |ls |git |grep|find|cat |echo|mkdir|cp |mv |rm |touch|chmod|docker|kubectl|yarn|pnpm)/i

function inferTaskKind(description: string): 'process' | 'agent' {
  return SHELL_CMD_RE.test(description.trim()) ? 'process' : 'agent'
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
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([])
  const [usage, setUsage] = useState<RunUsage | null>(null)

  // Derived: any task still running
  const backgroundActive = backgroundTasks.length > 0

  const activeRunId = useRef<string | null>(null)
  // State mirror of activeRunId so components can react to it (panels that
  // need the live session's control APIs).
  const [runId, setRunId] = useState<string | null>(null)

  // Prompts pushed while a turn was in flight. The CLI queues them and starts
  // a fresh turn per queued prompt once the current one ends (verified: no
  // mid-turn steering, no user-message echo in the stream). The ref is the
  // source of truth (event handlers read it synchronously); the state mirrors
  // it for rendering.
  const queueRef = useRef<string[]>([])
  const [queuedPrompts, setQueuedPrompts] = useState<string[]>([])

  // status mirror so callbacks can read the current value without re-binding.
  const statusRef = useRef<RunStatus>(status)
  useEffect(() => {
    statusRef.current = status
  }, [status])

  // Task-list mirror for the same reason (the event handler must know whether
  // background work is still running when a turn completes).
  const tasksRef = useRef<BackgroundTask[]>(backgroundTasks)
  useEffect(() => {
    tasksRef.current = backgroundTasks
  }, [backgroundTasks])

  /** Move all queued prompts into the transcript (they've been consumed). */
  const flushQueue = (): void => {
    if (queueRef.current.length === 0) return
    const queued = queueRef.current
    queueRef.current = []
    setQueuedPrompts([])
    setMessagesState((prev) => [
      ...prev,
      ...queued.map((text, i) => ({
        id: `user-${Date.now()}-${i}`,
        role: 'user' as const,
        parts: [{ kind: 'text' as const, text }],
        timestamp: Date.now()
      }))
    ])
  }
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
          // A new turn began — any prompts queued mid-run are part of it now,
          // so this is where they join the transcript.
          flushQueue()
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
          setBackgroundTasks((prev) => [
            ...prev,
            {
              taskId: event.taskId,
              description: event.description,
              kind: inferTaskKind(event.description),
              startedAt: Date.now(),
              dismissedWatchdog: false,
              snoozedUntil: null
            }
          ])
          break

        case 'taskCompleted':
          setBackgroundTasks((prev) => prev.filter((t) => t.taskId !== event.taskId))
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
          // Queued prompts mean the CLI is about to start the next turn for
          // them — don't flip to done or grab the user's attention in between.
          if (queueRef.current.length > 0) {
            setPendingRequest(null)
            break
          }
          setStatus(event.ok ? 'done' : 'error')
          setPendingRequest(null)
          // Background work (shell command or subagent) still running: leave
          // the user in their media tab — the agent auto-continues when the
          // task reports in, and the watchdog covers stale ones. Attention is
          // grabbed only when everything is actually done (or errored).
          if (event.ok && tasksRef.current.length > 0) break
          onAttentionRef.current()
          break
        }

        case 'closed':
          // The session itself ended; a fresh send will start/resume a new one.
          // Flush any still-queued prompts so the text isn't silently lost.
          flushQueue()
          if (event.sessionId) setSessionId(event.sessionId)
          setBackgroundTasks([])
          setPendingRequest(null)
          activeRunId.current = null
          setRunId(null)
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
      setRunId(null)
    }
    setMessagesState(next)
    setSessionId(nextSessionId)
    setStreamingText('')
    setError(null)
    setStatus('idle')
    setPendingRequest(null)
    setBackgroundTasks([])
    queueRef.current = []
    setQueuedPrompts([])
  }, [])

  const start = useCallback(
    async (prompt: string, cwd: string, settings?: RunSettings, remoteControl?: boolean) => {
      const trimmed = prompt.trim()
      if (!trimmed) return

      // Sent while a turn is in flight: the CLI queues it and runs it as the
      // next turn. Keep it out of the transcript until then — it renders as a
      // dimmed "queued" entry and joins the history at its injection point.
      if (activeRunId.current && statusRef.current === 'running') {
        queueRef.current = [...queueRef.current, trimmed]
        setQueuedPrompts(queueRef.current)
        await window.claude.sendMessage(activeRunId.current, trimmed)
        return
      }

      const userMessage: TranscriptMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        parts: [{ kind: 'text', text: trimmed }],
        timestamp: Date.now()
      }
      setMessagesState((prev) => [...prev, userMessage])
      setError(null)
      setStatus('running')

      // Push into the live session if one exists; otherwise open a new one
      // (resuming the on-disk session when we have its id).
      if (activeRunId.current) {
        await window.claude.sendMessage(activeRunId.current, trimmed)
      } else {
        setStreamingText('')
        const started = await window.claude.startRun({
          prompt: trimmed,
          cwd,
          resumeSessionId: sessionId ?? undefined,
          settings,
          remoteControl
        })
        activeRunId.current = started.runId
        setRunId(started.runId)
      }
    },
    [sessionId]
  )

  // Open a warm streaming session (no prompt) so control APIs work before the
  // first message. Status stays as-is — nothing is running yet; the first real
  // send pushes into this same session.
  const ensureSession = useCallback(
    async (cwd: string, settings?: RunSettings, remoteControl?: boolean) => {
      if (activeRunId.current || !cwd) return
      const started = await window.claude.startRun({
        prompt: '',
        cwd,
        resumeSessionId: sessionId ?? undefined,
        settings,
        remoteControl
      })
      activeRunId.current = started.runId
      setRunId(started.runId)
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
      // Plan approval flips the session out of plan mode (like the CLI).
      if (response.kind === 'permission' && response.setMode && activeRunId.current) {
        void window.claude.setRunPermissionMode(activeRunId.current, response.setMode)
      }
      setPendingRequest(null)
      setStatus('running')
    },
    [pendingRequest]
  )

  const killTask = useCallback(
    (taskId: string) => {
      // Optimistic removal; the runner's 'stopped' notification is idempotent.
      setBackgroundTasks((prev) => prev.filter((t) => t.taskId !== taskId))
      // Stop just this task (shell or subagent) — the session and any other
      // background work keep running.
      if (activeRunId.current) void window.claude.stopTask(activeRunId.current, taskId)
    },
    []
  )

  const snoozeTask = useCallback((taskId: string, durationMs: number) => {
    setBackgroundTasks((prev) =>
      prev.map((t) =>
        t.taskId === taskId ? { ...t, snoozedUntil: Date.now() + durationMs } : t
      )
    )
  }, [])

  const dismissTask = useCallback((taskId: string) => {
    setBackgroundTasks((prev) =>
      prev.map((t) => (t.taskId === taskId ? { ...t, dismissedWatchdog: true } : t))
    )
  }, [])

  return {
    status,
    messages,
    streamingText,
    queuedPrompts,
    sessionId,
    runId,
    error,
    commands,
    pendingRequest,
    backgroundActive,
    backgroundTasks,
    usage,
    setMessages,
    start,
    ensureSession,
    cancel,
    respond,
    killTask,
    snoozeTask,
    dismissTask
  }
}
