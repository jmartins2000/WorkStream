/**
 * Drives Codex threads via the app-server protocol and streams progress as
 * the same RunEvents the Claude runner emits — the renderer reuses its whole
 * run pipeline (transcript, approvals, gating) with a different backend.
 *
 * Process hygiene (hard requirement, see docs/codex-integration.md): ONE
 * shared `codex app-server` process hosts all threads, spawned lazily on
 * first use — never at app startup — and reaped after an idle period once no
 * conversation is live. A Claude-only user never has a codex process.
 *
 * Protocol notes (docs/codex-integration.md has the full map):
 * - `params` is mandatory on every request, even when empty.
 * - turn/started|completed carry an empty `items` array upstream — rely on
 *   item/* notifications for content.
 * - Approvals arrive as server→client REQUESTS that block their item until
 *   we respond; they map onto the existing needsInput/respondInput flow.
 */

import { randomUUID } from 'node:crypto'
import { shell } from 'electron'
import type {
  CodexAccount,
  CodexRunSettings,
  CodexThreadSummary,
  InputResponse,
  RunEvent,
  StartCodexRunOptions,
  UiQuestion
} from '../../shared/types.js'
import { findCodexBinary } from './binary.js'
import { CodexProcess, CodexRpcError } from './rpc.js'

type Emit = (event: RunEvent) => void

interface CodexRun {
  runId: string
  threadId: string
  emit: Emit
  activeTurnId: string | null
  /** Latest cumulative token usage (from thread/tokenUsage/updated). */
  lastUsage: { inputTokens: number; outputTokens: number } | null
}

/** How long the shared server may sit with zero live conversations. */
const IDLE_REAP_MS = 5 * 60 * 1000

let server: CodexProcess | null = null
let initPromise: Promise<CodexProcess> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null

const runsById = new Map<string, CodexRun>()
const runsByThread = new Map<string, CodexRun>()
const pendingInputs = new Map<string, (response: InputResponse) => void>()
/** login flows awaiting account/login/completed, keyed by loginId. */
const pendingLogins = new Map<string, (ok: boolean, error?: string) => void>()

function scheduleIdleReap(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (runsById.size === 0 && server) {
      console.log('[codex] idle — stopping app-server')
      server.kill()
      server = null
      initPromise = null
    }
  }, IDLE_REAP_MS)
}

/** Spawn + initialize the shared server (idempotent). */
async function ensureServer(): Promise<CodexProcess> {
  if (server?.alive && initPromise) return initPromise
  const binary = await findCodexBinary()
  if (!binary) {
    throw new Error(
      'Codex is not installed. Install the Codex app or `npm i -g @openai/codex`, then retry.'
    )
  }

  const proc = new CodexProcess(binary, (code) => {
    if (server === proc) {
      server = null
      initPromise = null
      // Fail every live conversation loudly rather than hanging.
      for (const run of runsById.values()) {
        run.emit({ type: 'error', runId: run.runId, message: `Codex server exited (${code}).` })
        run.emit({ type: 'closed', runId: run.runId, sessionId: run.threadId })
      }
      runsById.clear()
      runsByThread.clear()
    }
  })
  server = proc
  wireServer(proc)

  initPromise = (async () => {
    await proc.rpc.request('initialize', {
      clientInfo: { name: 'workstream', title: 'WorkStream', version: '0.1.0' }
    })
    proc.rpc.notify('initialized')
    scheduleIdleReap()
    return proc
  })()
  return initPromise
}

/* ----------------------------------------------------------------------------
 * Notification / server-request wiring
 * ------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>
}

function runForParams(params: unknown): CodexRun | undefined {
  const threadId = asRecord(params).threadId
  return typeof threadId === 'string' ? runsByThread.get(threadId) : undefined
}

function wireServer(proc: CodexProcess): void {
  const rpc = proc.rpc

  rpc.onNotification('turn/started', (params) => {
    const run = runForParams(params)
    if (!run) return
    const turn = asRecord(asRecord(params).turn)
    run.activeTurnId = typeof turn.id === 'string' ? turn.id : null
    run.emit({ type: 'started', runId: run.runId, sessionId: run.threadId })
  })

  rpc.onNotification('turn/completed', (params) => {
    const run = runForParams(params)
    if (!run) return
    run.activeTurnId = null
    const turn = asRecord(asRecord(params).turn)
    const status = turn.status as string
    if (status === 'failed') {
      const error = asRecord(turn.error)
      const message = typeof error.message === 'string' ? error.message : 'Turn failed.'
      run.emit({ type: 'error', runId: run.runId, message })
    }
    if (run.lastUsage) {
      run.emit({
        type: 'usage',
        runId: run.runId,
        usage: {
          costUsd: 0,
          inputTokens: run.lastUsage.inputTokens,
          outputTokens: run.lastUsage.outputTokens,
          numTurns: 1
        }
      })
    }
    run.emit({
      type: 'completed',
      runId: run.runId,
      sessionId: run.threadId,
      ok: status !== 'failed'
    })
  })

  rpc.onNotification('item/agentMessage/delta', (params) => {
    const run = runForParams(params)
    const delta = asRecord(params).delta
    if (run && typeof delta === 'string') {
      run.emit({ type: 'delta', runId: run.runId, text: delta })
    }
  })

  rpc.onNotification('item/started', (params) => {
    const run = runForParams(params)
    if (!run) return
    const item = asRecord(asRecord(params).item)
    // Tool-ish items get their chip as soon as they start (mirrors how
    // Claude's tool_use blocks appear before execution finishes).
    const chip = toolChipFor(item, /* completed */ false)
    if (chip) {
      run.emit({
        type: 'message',
        runId: run.runId,
        message: {
          id: String(item.id ?? randomUUID()),
          role: 'assistant',
          parts: [chip],
          timestamp: Date.now()
        }
      })
    }
  })

  rpc.onNotification('item/completed', (params) => {
    const run = runForParams(params)
    if (!run) return
    const item = asRecord(asRecord(params).item)
    const type = item.type as string

    if (type === 'agentMessage' && typeof item.text === 'string' && item.text.trim()) {
      run.emit({
        type: 'message',
        runId: run.runId,
        message: {
          id: String(item.id ?? randomUUID()),
          role: 'assistant',
          parts: [{ kind: 'text', text: item.text }],
          timestamp: Date.now()
        }
      })
      return
    }

    if (type === 'reasoning') {
      const summary = Array.isArray(item.summary) ? item.summary.filter((s) => typeof s === 'string') : []
      const text = summary.join('\n\n').trim()
      if (text) {
        run.emit({
          type: 'message',
          runId: run.runId,
          message: {
            id: String(item.id ?? randomUUID()),
            role: 'assistant',
            parts: [{ kind: 'thinking', text }],
            timestamp: Date.now()
          }
        })
      }
      return
    }

    // fileChange chips only make sense once the change list exists.
    if (type === 'fileChange') {
      const chip = toolChipFor(item, true)
      if (chip) {
        run.emit({
          type: 'message',
          runId: run.runId,
          message: {
            id: String(item.id ?? randomUUID()),
            role: 'assistant',
            parts: [chip],
            timestamp: Date.now()
          }
        })
      }
    }
  })

  rpc.onNotification('thread/tokenUsage/updated', (params) => {
    const run = runForParams(params)
    if (!run) return
    const usage = asRecord(asRecord(asRecord(params).tokenUsage).total)
    run.lastUsage = {
      inputTokens: Number(usage.inputTokens ?? 0),
      outputTokens: Number(usage.outputTokens ?? 0)
    }
  })

  rpc.onNotification('error', (params) => {
    const run = runForParams(params)
    const error = asRecord(asRecord(params).error)
    const message = typeof error.message === 'string' ? error.message : 'Codex error.'
    if (run) run.emit({ type: 'error', runId: run.runId, message })
  })

  rpc.onNotification('account/login/completed', (params) => {
    const record = asRecord(params)
    const loginId = String(record.loginId ?? '')
    const resolve = pendingLogins.get(loginId)
    if (resolve) {
      pendingLogins.delete(loginId)
      resolve(record.success === true, typeof record.error === 'string' ? record.error : undefined)
    }
  })

  // --- Approvals (server→client requests; they block the item until answered)

  rpc.onServerRequest('item/commandExecution/requestApproval', async (params) => {
    const record = asRecord(params)
    const command = Array.isArray(record.command)
      ? (record.command as string[]).join(' ')
      : String(record.command ?? '')
    const reason = typeof record.reason === 'string' ? record.reason : ''
    const detail = [command, reason && `(${reason})`].filter(Boolean).join(' ')
    const response = await askPermission(params, 'Run command', detail)
    return { decision: mapDecision(response) }
  })

  rpc.onServerRequest('item/fileChange/requestApproval', async (params) => {
    const record = asRecord(params)
    const reason = typeof record.reason === 'string' ? record.reason : 'Apply file changes'
    const response = await askPermission(params, 'Edit files', reason)
    return { decision: mapDecision(response) }
  })

  rpc.onServerRequest('tool/requestUserInput', async (params) => {
    const run = runForParams(params)
    if (!run) return { answers: [] }
    const record = asRecord(params)
    const rawQuestions = Array.isArray(record.questions) ? record.questions : []
    const questions: UiQuestion[] = rawQuestions.map((q) => {
      const question = asRecord(q)
      const options = Array.isArray(question.options) ? question.options : []
      return {
        question: String(question.question ?? question.prompt ?? ''),
        header: String(question.header ?? 'Codex'),
        multiSelect: question.multiSelect === true,
        options: options.map((opt) => {
          const option = asRecord(opt)
          return {
            label: String(option.label ?? option.value ?? ''),
            description: String(option.description ?? '')
          }
        })
      }
    })
    const requestId = randomUUID()
    const answerPromise = new Promise<InputResponse>((resolve) => {
      pendingInputs.set(requestId, resolve)
    })
    run.emit({ type: 'needsInput', runId: run.runId, request: { kind: 'question', requestId, questions } })
    const response = await answerPromise
    if (response.kind !== 'question') return { answers: [] }
    // Protocol expects ordered answers; our renderer answers keyed by question.
    return {
      answers: questions.map((q) => ({ answer: response.answers[q.question] ?? '' }))
    }
  })
}

/** Emit a permission needsInput and await the user's decision. */
async function askPermission(
  params: unknown,
  toolName: string,
  detail: string
): Promise<InputResponse> {
  const run = runForParams(params)
  if (!run) return { kind: 'permission', decision: 'deny' }
  const requestId = randomUUID()
  const promise = new Promise<InputResponse>((resolve) => {
    pendingInputs.set(requestId, resolve)
  })
  run.emit({
    type: 'needsInput',
    runId: run.runId,
    request: { kind: 'permission', requestId, toolName, detail }
  })
  return promise
}

function mapDecision(response: InputResponse): string {
  if (response.kind !== 'permission' || response.decision === 'deny') return 'decline'
  return response.decision === 'allow-always' ? 'acceptForSession' : 'accept'
}

/** Compact chip for tool-ish items (command runs, file edits, web searches). */
function toolChipFor(
  item: Record<string, unknown>,
  completed: boolean
): { kind: 'tool'; name: string; detail: string; result?: string; isError?: boolean } | null {
  const type = item.type as string
  if (type === 'commandExecution' && !completed) {
    const command = Array.isArray(item.command)
      ? (item.command as string[]).join(' ')
      : String(item.command ?? '')
    return { kind: 'tool', name: 'Command', detail: truncate(command, 120) }
  }
  if (type === 'webSearch' && !completed) {
    return { kind: 'tool', name: 'WebSearch', detail: truncate(String(item.query ?? ''), 120) }
  }
  if (type === 'mcpToolCall' && !completed) {
    return {
      kind: 'tool',
      name: `MCP:${String(item.server ?? '')}`,
      detail: truncate(String(item.tool ?? ''), 120)
    }
  }
  if (type === 'fileChange' && completed) {
    const changes = Array.isArray(item.changes) ? item.changes : []
    const paths = changes.map((c) => String(asRecord(c).path ?? '')).filter(Boolean)
    return {
      kind: 'tool',
      name: 'Edit',
      detail: truncate(paths.join(', '), 120),
      isError: item.status === 'failed'
    }
  }
  return null
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…'
}

/* ----------------------------------------------------------------------------
 * Public API (called from ipc.ts)
 * ------------------------------------------------------------------------- */

/** Binary presence only — safe to call anytime, never spawns anything. */
export async function codexInstalled(): Promise<{ installed: boolean; path: string | null }> {
  const path = await findCodexBinary()
  return { installed: path !== null, path }
}

/** Account info (spawns the server — call only from the Codex tab). */
export async function codexAccount(): Promise<CodexAccount> {
  const proc = await ensureServer()
  const result = asRecord(await proc.rpc.request('account/read', {}))
  const account = result.account ? asRecord(result.account) : null
  return {
    authenticated: account !== null,
    authMode: account ? String(account.type ?? '') : null,
    email: account && typeof account.email === 'string' ? account.email : null,
    planType: account && typeof account.planType === 'string' ? account.planType : null
  }
}

/** Start the ChatGPT browser login; resolves when the flow completes. */
export async function codexLogin(): Promise<{ success: boolean; error?: string }> {
  const proc = await ensureServer()
  const result = asRecord(await proc.rpc.request('account/login/start', { type: 'chatgpt' }))
  const loginId = String(result.loginId ?? '')
  const authUrl = String(result.authUrl ?? '')
  if (!authUrl) return { success: false, error: 'Codex did not return a login URL.' }
  void shell.openExternal(authUrl)
  return new Promise((resolve) => {
    pendingLogins.set(loginId, (success, error) => resolve({ success, error }))
    setTimeout(() => {
      if (pendingLogins.delete(loginId)) {
        resolve({ success: false, error: 'Login timed out.' })
      }
    }, 5 * 60 * 1000)
  })
}

/** Models + reasoning efforts for the settings bar. */
export async function codexModels(): Promise<
  { id: string; displayName: string; efforts: string[]; defaultEffort: string; isDefault: boolean }[]
> {
  const proc = await ensureServer()
  const result = asRecord(await proc.rpc.request('model/list', {}))
  const data = Array.isArray(result.data) ? result.data : []
  return data.map((m) => {
    const model = asRecord(m)
    const efforts = Array.isArray(model.supportedReasoningEfforts)
      ? model.supportedReasoningEfforts.map((e) => String(asRecord(e).reasoningEffort ?? ''))
      : []
    return {
      id: String(model.id ?? model.model ?? ''),
      displayName: String(model.displayName ?? model.id ?? ''),
      efforts: efforts.filter(Boolean),
      defaultEffort: String(model.defaultReasoningEffort ?? efforts[0] ?? 'medium'),
      isDefault: model.isDefault === true
    }
  })
}

/** Threads for the sidebar, scoped to a project directory. */
export async function codexThreads(cwd: string): Promise<CodexThreadSummary[]> {
  const proc = await ensureServer()
  const result = asRecord(
    await proc.rpc.request('thread/list', {
      cwd,
      limit: 50,
      sortKey: 'updated_at',
      sortDirection: 'desc'
    })
  )
  const data = Array.isArray(result.data) ? result.data : []
  return data.map((t) => {
    const thread = asRecord(t)
    return {
      threadId: String(thread.id ?? ''),
      title: String(thread.name ?? thread.preview ?? '(no prompt)').trim() || '(no prompt)',
      cwd: String(thread.cwd ?? cwd),
      updatedAt: parseTimestamp(thread.updatedAt ?? thread.recencyAt)
    }
  })
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Heuristic: seconds vs milliseconds.
    return value > 10_000_000_000 ? value : value * 1000
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isNaN(ms) ? null : ms
  }
  return null
}

/** Curated transcript of a thread (for opening it from the sidebar). */
export async function codexThreadMessages(threadId: string): Promise<
  import('../../shared/types.js').TranscriptMessage[]
> {
  const proc = await ensureServer()
  const result = asRecord(
    await proc.rpc.request('thread/read', { threadId, includeTurns: true })
  )
  const thread = asRecord(result.thread)
  const turns = Array.isArray(thread.turns) ? thread.turns : []
  const messages: import('../../shared/types.js').TranscriptMessage[] = []

  for (const rawTurn of turns) {
    const turn = asRecord(rawTurn)
    const items = Array.isArray(turn.items) ? turn.items : []
    for (const rawItem of items) {
      const item = asRecord(rawItem)
      const type = item.type as string
      const id = String(item.id ?? `item-${messages.length}`)

      if (type === 'userMessage') {
        const content = Array.isArray(item.content) ? item.content : []
        const text = content
          .map((c) => (asRecord(c).type === 'text' ? String(asRecord(c).text ?? '') : ''))
          .filter(Boolean)
          .join('\n')
          .trim()
        if (text) {
          messages.push({ id, role: 'user', parts: [{ kind: 'text', text }], timestamp: null })
        }
        continue
      }

      if (type === 'agentMessage' && typeof item.text === 'string' && item.text.trim()) {
        messages.push({
          id,
          role: 'assistant',
          parts: [{ kind: 'text', text: item.text }],
          timestamp: null
        })
        continue
      }

      if (type === 'reasoning') {
        const summary = Array.isArray(item.summary)
          ? item.summary.filter((s) => typeof s === 'string')
          : []
        const text = summary.join('\n\n').trim()
        if (text) {
          messages.push({ id, role: 'assistant', parts: [{ kind: 'thinking', text }], timestamp: null })
        }
        continue
      }

      const chip = toolChipFor(item, true) ?? toolChipFor(item, false)
      if (chip) {
        // Attach outputs for completed command executions in history view.
        if (type === 'commandExecution' && typeof item.aggregatedOutput === 'string') {
          chip.result = truncate(item.aggregatedOutput, 4000)
          chip.isError = item.status === 'failed'
        }
        messages.push({ id, role: 'assistant', parts: [chip], timestamp: null })
      }
    }
  }
  return messages
}

/** Per-turn overrides from our settings shape. */
function turnOverrides(settings?: CodexRunSettings): Record<string, unknown> {
  if (!settings) return {}
  const overrides: Record<string, unknown> = {}
  if (settings.model) overrides.model = settings.model
  if (settings.effort) overrides.effort = settings.effort
  if (settings.approvalPolicy) overrides.approvalPolicy = settings.approvalPolicy
  if (settings.sandbox === 'workspaceWrite') {
    overrides.sandboxPolicy = { type: 'workspaceWrite', writableRoots: [], networkAccess: true }
  } else if (settings.sandbox === 'readOnly') {
    overrides.sandboxPolicy = { type: 'readOnly' }
  } else if (settings.sandbox === 'dangerFullAccess') {
    overrides.sandboxPolicy = { type: 'dangerFullAccess' }
  }
  return overrides
}

/** Start (or resume) a Codex conversation and fire its first turn. */
export async function startCodexRun(options: StartCodexRunOptions, emit: Emit): Promise<string> {
  const proc = await ensureServer()
  const runId = randomUUID()

  const threadResult = asRecord(
    options.resumeThreadId
      ? await proc.rpc.request('thread/resume', { threadId: options.resumeThreadId })
      : await proc.rpc.request('thread/start', {
          cwd: options.cwd,
          ...(options.settings?.approvalPolicy
            ? { approvalPolicy: options.settings.approvalPolicy }
            : {})
        })
  )
  const thread = asRecord(threadResult.thread)
  const threadId = String(thread.id ?? '')
  if (!threadId) throw new Error('Codex did not return a thread id.')

  const run: CodexRun = { runId, threadId, emit, activeTurnId: null, lastUsage: null }
  runsById.set(runId, run)
  runsByThread.set(threadId, run)
  if (idleTimer) clearTimeout(idleTimer)

  emit({ type: 'started', runId, sessionId: threadId })

  await proc.rpc.request('turn/start', {
    threadId,
    input: [{ type: 'text', text: options.prompt }],
    ...turnOverrides(options.settings)
  }).catch((err) => {
    emit({ type: 'error', runId, message: friendlyError(err) })
    emit({ type: 'completed', runId, sessionId: threadId, ok: false })
  })

  return runId
}

/** Follow-up message: steers the live turn, or starts a new one when idle. */
export async function sendCodexMessage(runId: string, prompt: string): Promise<void> {
  const run = runsById.get(runId)
  if (!run || !server?.alive) return
  const rpc = server.rpc
  try {
    if (run.activeTurnId) {
      await rpc.request('turn/steer', {
        threadId: run.threadId,
        expectedTurnId: run.activeTurnId,
        input: [{ type: 'text', text: prompt }]
      })
    } else {
      await rpc.request('turn/start', {
        threadId: run.threadId,
        input: [{ type: 'text', text: prompt }]
      })
    }
  } catch (err) {
    run.emit({ type: 'error', runId, message: friendlyError(err) })
  }
}

/** Interrupt the current turn (Esc). The thread stays live. */
export async function cancelCodexRun(runId: string): Promise<void> {
  const run = runsById.get(runId)
  if (!run || !run.activeTurnId || !server?.alive) return
  await server.rpc
    .request('turn/interrupt', { threadId: run.threadId, turnId: run.activeTurnId })
    .catch(() => {
      /* turn may have just completed */
    })
}

/** End a conversation: unregister and let the idle reaper stop the server. */
export async function endCodexRun(runId: string): Promise<void> {
  const run = runsById.get(runId)
  if (!run) return
  runsById.delete(runId)
  runsByThread.delete(run.threadId)
  run.emit({ type: 'closed', runId, sessionId: run.threadId })
  if (server?.alive) {
    await server.rpc.request('thread/unsubscribe', { threadId: run.threadId }).catch(() => {
      /* best-effort; the idle reaper cleans up regardless */
    })
    scheduleIdleReap()
  }
}

/** Resolve a pending approval/question with the user's reply. */
export function resolveCodexInput(requestId: string, response: InputResponse): void {
  const resolve = pendingInputs.get(requestId)
  if (resolve) {
    pendingInputs.delete(requestId)
    resolve(response)
  }
}

/** Stop the shared server outright (app quit). */
export function stopCodexServer(): void {
  server?.kill()
  server = null
  initPromise = null
}

function friendlyError(err: unknown): string {
  if (err instanceof CodexRpcError) {
    return `Codex: ${err.message}`
  }
  return err instanceof Error ? err.message : String(err)
}
