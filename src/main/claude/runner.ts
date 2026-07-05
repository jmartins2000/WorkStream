/**
 * Drives Claude Code runs via the Agent SDK and streams their progress out as
 * RunEvents. Because the SDK reads/writes the same session store as the CLI,
 * a run started here is visible from the terminal and vice-versa.
 *
 * Each conversation is a single, long-lived **streaming-input** session: the
 * prompt is an async stream we keep open, so the query stays alive past the
 * first `result`. This is what lets the agent continue on its own when a
 * background task (Bash `run_in_background` / Task) finishes — the SDK yields a
 * `task_notification` and the agent wakes itself to report back, all through the
 * same stream. One-shot mode (a string prompt) would tear the query down at the
 * first `result`, stranding any background work.
 *
 * Runs are interactive: tool permissions and AskUserQuestion prompts are
 * surfaced to the renderer via `needsInput` events and resolved when the user
 * replies through `resolveInput`.
 */

import { randomUUID } from 'node:crypto'
import {
  query,
  type CanUseTool,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type {
  AgentSummary,
  CommandSummary,
  ContextUsage,
  InputResponse,
  McpServerInfo,
  RunEvent,
  RunModel,
  RunPermissionMode,
  RunUsage,
  StartRunOptions
} from '../../shared/types.js'
import { contentToParts, toolDetail } from './transcript.js'
import { parseQuestions, withAnswers } from './interaction.js'

/**
 * Default mode surfaces tool permissions through `canUseTool` (bypass mode
 * would skip it, hiding both approvals and AskUserQuestion prompts). Read-only
 * tools are pre-approved to keep the prompting to meaningful actions.
 */
const DEFAULT_PERMISSION_MODE: PermissionMode = 'bypassPermissions'
const AUTO_ALLOWED_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite']

type Emit = (event: RunEvent) => void

/** A manually-driven async stream of user turns that stays open for the session. */
interface InputStream {
  iterable: AsyncGenerator<SDKUserMessage>
  push: (text: string) => void
  close: () => void
}

interface ActiveRun {
  abort: AbortController
  input: InputStream
  /** The live Query handle, set once the query starts (for interrupt()). */
  query?: Query
}

interface PendingInput {
  resolve: (response: InputResponse) => void
}

const activeRuns = new Map<string, ActiveRun>()
const pendingInputs = new Map<string, PendingInput>()

/** Build an async-iterable input the caller can push turns into and later close. */
function makeInputStream(): InputStream {
  let resolveNext: (() => void) | null = null
  const buffer: SDKUserMessage[] = []
  let done = false
  const signal = (): void => {
    const r = resolveNext
    resolveNext = null
    if (r) r()
  }
  async function* gen(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (buffer.length) yield buffer.shift() as SDKUserMessage
      if (done) return
      await new Promise<void>((res) => {
        resolveNext = res
      })
    }
  }
  return {
    iterable: gen(),
    push: (text: string) => {
      buffer.push({
        type: 'user',
        message: { role: 'user', content: text },
        parent_tool_use_id: null
      })
      signal()
    },
    close: () => {
      done = true
      signal()
    }
  }
}

/**
 * Start a streaming session. Returns the run id.
 *
 * An empty prompt opens a *warm* session: the CLI boots (connects MCP servers,
 * loads commands/agents — so the control APIs work) but no turn runs until the
 * first message is pushed via `sendMessage`. Used by the Session panel to
 * inspect a conversation before anything has been sent.
 */
export function startRun(options: StartRunOptions, emit: Emit): string {
  const runId = randomUUID()
  const abort = new AbortController()
  const input = makeInputStream()
  const run: ActiveRun = { abort, input }
  activeRuns.set(runId, run)
  if (options.prompt.trim()) input.push(options.prompt)
  void drive(runId, options, emit, run)
  return runId
}

/** Push a follow-up turn into an already-live session. No-op if it's gone. */
export function sendMessage(runId: string, prompt: string): void {
  activeRuns.get(runId)?.input.push(prompt)
}

/**
 * Interrupt the current turn while keeping the session alive (mirrors Esc in
 * the CLI). The query yields a result for the interrupted turn and remains
 * ready for the next push.
 */
export function cancelRun(runId: string): void {
  const run = activeRuns.get(runId)
  if (!run) return
  if (run.query) {
    void run.query.interrupt().catch(() => {
      // Already settled or not in streaming mode; fall back to a hard stop.
      run.abort.abort()
    })
  } else {
    run.abort.abort()
  }
}

/** Fully end a session: close the input stream and abort the query. */
export function endRun(runId: string): void {
  const run = activeRuns.get(runId)
  if (!run) return
  run.input.close()
  run.abort.abort()
  activeRuns.delete(runId)
}

/** Resolve a pending input request with the user's reply. */
export function resolveInput(requestId: string, response: InputResponse): void {
  const pending = pendingInputs.get(requestId)
  if (pending) {
    pendingInputs.delete(requestId)
    pending.resolve(response)
  }
}

/* ----------------------------------------------------------------------------
 * Live-session control APIs (the SDK's control requests — /context, /mcp,
 * /agents, /skills, and mid-run model/mode switching). These only work while
 * a streaming session is alive; they return null / no-op otherwise.
 * ------------------------------------------------------------------------- */

function liveQuery(runId: string): Query | undefined {
  return activeRuns.get(runId)?.query
}

/** Context-window usage breakdown for the live session (/context). */
export async function getContextUsage(runId: string): Promise<ContextUsage | null> {
  const q = liveQuery(runId)
  if (!q) return null
  const r = await q.getContextUsage()
  return {
    totalTokens: r.totalTokens,
    maxTokens: r.maxTokens,
    percentage: r.percentage,
    model: r.model,
    categories: r.categories.map((c) => ({ name: c.name, tokens: c.tokens }))
  }
}

/** MCP server statuses for the live session (/mcp). */
export async function getMcpStatus(runId: string): Promise<McpServerInfo[] | null> {
  const q = liveQuery(runId)
  if (!q) return null
  const servers = await q.mcpServerStatus()
  return servers.map((s) => ({
    name: s.name,
    status: s.status,
    error: s.error,
    scope: s.scope,
    tools: (s.tools ?? []).map((t) => t.name)
  }))
}

/** Available subagents for the live session (/agents). */
export async function getAgents(runId: string): Promise<AgentSummary[] | null> {
  const q = liveQuery(runId)
  if (!q) return null
  const agents = await q.supportedAgents()
  return agents.map((a) => ({ name: a.name, description: a.description, model: a.model }))
}

/** Available commands/skills for the live session (/skills). */
export async function getCommands(runId: string): Promise<CommandSummary[] | null> {
  const q = liveQuery(runId)
  if (!q) return null
  const commands = await q.supportedCommands()
  return commands.map((c) => ({
    name: c.name,
    description: c.description,
    argumentHint: c.argumentHint || undefined
  }))
}

/** Switch the live session's model mid-run ('default' clears the override). */
export async function setRunModel(runId: string, model: RunModel): Promise<void> {
  await liveQuery(runId)?.setModel(model === 'default' ? undefined : model)
}

/** Switch the live session's permission mode mid-run. */
export async function setRunPermissionMode(
  runId: string,
  mode: RunPermissionMode
): Promise<void> {
  await liveQuery(runId)?.setPermissionMode(mode)
}

/**
 * Stop one background task (shell command or subagent) without touching the
 * rest of the session. A task_notification with status 'stopped' follows.
 */
export async function stopTask(runId: string, taskId: string): Promise<void> {
  await liveQuery(runId)?.stopTask(taskId)
}

/** Reconnect an MCP server by name (throws on failure, like the SDK). */
export async function reconnectMcpServer(runId: string, serverName: string): Promise<void> {
  const q = liveQuery(runId)
  if (!q) throw new Error('No live session.')
  await q.reconnectMcpServer(serverName)
}

/** Enable or disable an MCP server by name (throws on failure). */
export async function toggleMcpServer(
  runId: string,
  serverName: string,
  enabled: boolean
): Promise<void> {
  const q = liveQuery(runId)
  if (!q) throw new Error('No live session.')
  await q.toggleMcpServer(serverName, enabled)
}

/** Number of runs currently in flight (used for shutdown handling/tests). */
export function activeRunCount(): number {
  return activeRuns.size
}

/** Await the user's reply to a surfaced input request. */
function awaitInput(requestId: string, abort: AbortController): Promise<InputResponse> {
  return new Promise<InputResponse>((resolve, reject) => {
    pendingInputs.set(requestId, { resolve })
    // If the run is cancelled while waiting, abandon the request.
    abort.signal.addEventListener(
      'abort',
      () => {
        if (pendingInputs.delete(requestId)) reject(new Error('aborted'))
      },
      { once: true }
    )
  })
}

/** Build the canUseTool callback that surfaces questions/permissions to the UI. */
function makeCanUseTool(runId: string, emit: Emit, abort: AbortController): CanUseTool {
  return async (toolName, input, { suggestions }): Promise<PermissionResult> => {
    const requestId = randomUUID()

    if (toolName === 'AskUserQuestion') {
      const questions = parseQuestions(input)
      if (questions.length === 0) return { behavior: 'allow', updatedInput: input }
      emit({ type: 'needsInput', runId, request: { kind: 'question', requestId, questions } })
      const response = await awaitInput(requestId, abort)
      if (response.kind === 'question') {
        return { behavior: 'allow', updatedInput: withAnswers(input, response.answers) }
      }
      return { behavior: 'deny', message: 'User dismissed the question.' }
    }

    // ExitPlanMode carries the full plan — surface it for the plan-review UI.
    const plan =
      toolName === 'ExitPlanMode' &&
      typeof input === 'object' &&
      input !== null &&
      typeof (input as Record<string, unknown>).plan === 'string'
        ? ((input as Record<string, unknown>).plan as string)
        : undefined

    // Generic tool approval.
    emit({
      type: 'needsInput',
      runId,
      request: { kind: 'permission', requestId, toolName, detail: toolDetail(input), plan }
    })
    const response = await awaitInput(requestId, abort)
    if (response.kind !== 'permission' || response.decision === 'deny') {
      return { behavior: 'deny', message: 'User denied this action.' }
    }
    return {
      behavior: 'allow',
      updatedInput: input,
      updatedPermissions: response.decision === 'allow-always' ? suggestions : undefined
    }
  }
}

async function drive(
  runId: string,
  options: StartRunOptions,
  emit: Emit,
  run: ActiveRun
): Promise<void> {
  const { abort } = run
  let sessionId: string | null = options.resumeSessionId ?? null

  const settings = options.settings
  const queryOptions: Options = {
    cwd: options.cwd,
    includePartialMessages: true,
    permissionMode: settings?.permissionMode ?? DEFAULT_PERMISSION_MODE,
    allowedTools: AUTO_ALLOWED_TOOLS,
    canUseTool: makeCanUseTool(runId, emit, abort),
    abortController: abort,
    // Surface CLI diagnostics in the dev terminal to aid debugging.
    stderr: (data: string) => process.stderr.write(`[claude-cli] ${data}`)
  }
  if (options.resumeSessionId) queryOptions.resume = options.resumeSessionId
  // 'default' means "let the account/CLI pick" — leave the option unset.
  if (settings?.model && settings.model !== 'default') queryOptions.model = settings.model
  if (settings?.effort) queryOptions.effort = settings.effort
  // Start the Remote Control bridge so the session shows up on claude.ai/code
  // and can be driven from the phone/web while this app runs it.
  if (options.remoteControl) queryOptions.settings = { remoteControlAtStartup: true }

  // Slash commands arrive on every `init` (including background continuations);
  // only surface them once per session.
  let slashEmitted = false

  try {
    const response = query({ prompt: run.input.iterable, options: queryOptions })
    run.query = response

    for await (const msg of response) {
      if ('session_id' in msg && typeof msg.session_id === 'string' && msg.session_id) {
        sessionId = msg.session_id
      }

      switch (msg.type) {
        case 'system':
          if (msg.subtype === 'init') {
            emit({ type: 'started', runId, sessionId })
            if (!slashEmitted && Array.isArray(msg.slash_commands)) {
              emit({ type: 'slashCommands', runId, commands: msg.slash_commands })
              slashEmitted = true
            }
          } else if (msg.subtype === 'task_started') {
            emit({
              type: 'taskStarted',
              runId,
              taskId: msg.task_id,
              description: msg.description
            })
          } else if (msg.subtype === 'task_notification') {
            emit({
              type: 'taskCompleted',
              runId,
              taskId: msg.task_id,
              status: msg.status,
              summary: msg.summary
            })
          } else if (msg.subtype === 'task_updated') {
            // Terminal states can arrive via task_updated without a
            // task_notification (e.g. a killed task). Emit completion so the
            // renderer's task list never leaks entries; duplicates are
            // harmless (removal is idempotent).
            const status = msg.patch.status
            if (status === 'completed' || status === 'failed' || status === 'killed') {
              emit({
                type: 'taskCompleted',
                runId,
                taskId: msg.task_id,
                status: status === 'killed' ? 'stopped' : status,
                summary: msg.patch.error ?? ''
              })
            }
          } else if (msg.subtype === 'local_command_output') {
            // Output of a locally-handled slash command (e.g. /remote-control's
            // claude.ai link, /compact's summary note). Surface it in the
            // transcript so passthrough commands aren't silent.
            if (typeof msg.content === 'string' && msg.content.trim()) {
              emit({
                type: 'message',
                runId,
                message: {
                  id: msg.uuid,
                  role: 'system',
                  parts: [{ kind: 'text', text: msg.content.trim() }],
                  timestamp: Date.now()
                }
              })
            }
          } else if (msg.subtype === 'compact_boundary') {
            emit({
              type: 'message',
              runId,
              message: {
                id: msg.uuid,
                role: 'system',
                parts: [
                  {
                    kind: 'text',
                    text: `Conversation compacted (${msg.compact_metadata.trigger === 'auto' ? 'automatic' : 'manual'}).`
                  }
                ],
                timestamp: Date.now()
              }
            })
          }
          break

        case 'stream_event': {
          // Skip subagent-internal streams — only the top-level conversation
          // belongs in the transcript.
          if (msg.parent_tool_use_id) break
          const event = msg.event
          if (
            event?.type === 'content_block_delta' &&
            event.delta?.type === 'text_delta' &&
            typeof event.delta.text === 'string'
          ) {
            emit({ type: 'delta', runId, text: event.delta.text })
          }
          break
        }

        case 'assistant': {
          // Subagent messages surface in the parent stream tagged with the
          // spawning tool_use id; showing them would interleave the agent's
          // internal work with the real conversation (and flap the status).
          if (msg.parent_tool_use_id) break
          const parts = contentToParts(msg.message?.content)
          if (parts.length > 0) {
            emit({
              type: 'message',
              runId,
              message: { id: msg.uuid, role: 'assistant', parts, timestamp: Date.now() }
            })
          }
          break
        }

        case 'result': {
          const usage = extractUsage(msg)
          if (usage) emit({ type: 'usage', runId, usage })
          // A turn ended — but the session stays open for follow-ups and for the
          // agent to auto-continue when a background task reports in.
          emit({ type: 'completed', runId, sessionId, ok: !msg.is_error })
          break
        }

        default:
          break
      }
    }
    // The input stream was closed (or the query ended): the session is over.
    emit({ type: 'closed', runId, sessionId })
  } catch (err) {
    if (abort.signal.aborted) {
      emit({ type: 'closed', runId, sessionId })
    } else {
      console.error('[workstream] run failed:', err)
      emit({ type: 'error', runId, message: errorMessage(err) })
      emit({ type: 'closed', runId, sessionId })
    }
  } finally {
    activeRuns.delete(runId)
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** Pull cost/token usage out of a result message, defensively. */
function extractUsage(msg: unknown): RunUsage | null {
  if (typeof msg !== 'object' || msg === null) return null
  const record = msg as Record<string, unknown>
  const usage = (record.usage ?? {}) as Record<string, unknown>
  const num = (value: unknown): number => (typeof value === 'number' ? value : 0)
  return {
    costUsd: num(record.total_cost_usd),
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    numTurns: num(record.num_turns)
  }
}
