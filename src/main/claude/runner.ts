/**
 * Drives Claude Code runs via the Agent SDK and streams their progress out as
 * RunEvents. Because the SDK reads/writes the same session store as the CLI,
 * a run started here is visible from the terminal and vice-versa.
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
  type PermissionResult
} from '@anthropic-ai/claude-agent-sdk'
import type { InputResponse, RunEvent, RunUsage, StartRunOptions } from '../../shared/types.js'
import { contentToParts, toolDetail } from './transcript.js'
import { parseQuestions, withAnswers } from './interaction.js'

/**
 * Default mode surfaces tool permissions through `canUseTool` (bypass mode
 * would skip it, hiding both approvals and AskUserQuestion prompts). Read-only
 * tools are pre-approved to keep the prompting to meaningful actions.
 */
const DEFAULT_PERMISSION_MODE: PermissionMode = 'default'
const AUTO_ALLOWED_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite']

type Emit = (event: RunEvent) => void

interface ActiveRun {
  abort: AbortController
}

interface PendingInput {
  resolve: (response: InputResponse) => void
}

const activeRuns = new Map<string, ActiveRun>()
const pendingInputs = new Map<string, PendingInput>()

/** Start a run and stream events through `emit`. Returns the new run id. */
export function startRun(options: StartRunOptions, emit: Emit): string {
  const runId = randomUUID()
  const abort = new AbortController()
  activeRuns.set(runId, { abort })
  void drive(runId, options, emit, abort)
  return runId
}

/** Request cancellation of an in-flight run. No-op if already finished. */
export function cancelRun(runId: string): void {
  activeRuns.get(runId)?.abort.abort()
}

/** Resolve a pending input request with the user's reply. */
export function resolveInput(requestId: string, response: InputResponse): void {
  const pending = pendingInputs.get(requestId)
  if (pending) {
    pendingInputs.delete(requestId)
    pending.resolve(response)
  }
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

    // Generic tool approval.
    emit({
      type: 'needsInput',
      runId,
      request: { kind: 'permission', requestId, toolName, detail: toolDetail(input) }
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
  abort: AbortController
): Promise<void> {
  let sessionId: string | null = options.resumeSessionId ?? null

  const settings = options.settings
  const queryOptions: Options = {
    cwd: options.cwd,
    includePartialMessages: true,
    permissionMode: settings?.permissionMode ?? DEFAULT_PERMISSION_MODE,
    allowedTools: AUTO_ALLOWED_TOOLS,
    canUseTool: makeCanUseTool(runId, emit, abort),
    abortController: abort
  }
  if (options.resumeSessionId) queryOptions.resume = options.resumeSessionId
  // 'default' means "let the account/CLI pick" — leave the option unset.
  if (settings?.model && settings.model !== 'default') queryOptions.model = settings.model
  if (settings?.effort) queryOptions.effort = settings.effort

  try {
    const response = query({ prompt: options.prompt, options: queryOptions })

    for await (const msg of response) {
      if ('session_id' in msg && typeof msg.session_id === 'string' && msg.session_id) {
        sessionId = msg.session_id
      }

      switch (msg.type) {
        case 'system':
          if (msg.subtype === 'init') {
            emit({ type: 'started', runId, sessionId })
            if (Array.isArray(msg.slash_commands)) {
              emit({ type: 'slashCommands', runId, commands: msg.slash_commands })
            }
          }
          break

        case 'stream_event': {
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
          emit({ type: 'completed', runId, sessionId, ok: !msg.is_error })
          break
        }

        default:
          break
      }
    }
  } catch (err) {
    if (abort.signal.aborted) {
      emit({ type: 'completed', runId, sessionId, ok: false })
    } else {
      emit({ type: 'error', runId, message: errorMessage(err) })
      emit({ type: 'completed', runId, sessionId, ok: false })
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
