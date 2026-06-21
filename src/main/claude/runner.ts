/**
 * Drives Claude Code runs via the Agent SDK and streams their progress out as
 * RunEvents. Because the SDK reads/writes the same session store as the CLI,
 * a run started here is visible from the terminal and vice-versa.
 */

import { randomUUID } from 'node:crypto'
import { query, type Options, type PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import type { RunEvent, StartRunOptions } from '../../shared/types.js'
import { contentToParts } from './transcript.js'

/**
 * Background runs are autonomous — the user is off watching Stremio — so we
 * cannot pause to ask for tool permissions. `bypassPermissions` keeps the run
 * moving without prompts. This is a deliberate trade-off for the "fire and
 * walk away" workflow; it is surfaced in the UI so the user understands it.
 */
const DEFAULT_PERMISSION_MODE: PermissionMode = 'bypassPermissions'

type Emit = (event: RunEvent) => void

interface ActiveRun {
  abort: AbortController
}

const activeRuns = new Map<string, ActiveRun>()

/** Start a run and stream events through `emit`. Returns the new run id. */
export function startRun(options: StartRunOptions, emit: Emit): string {
  const runId = randomUUID()
  const abort = new AbortController()
  activeRuns.set(runId, { abort })
  // Fire-and-forget; all outcomes are reported through `emit`.
  void drive(runId, options, emit, abort)
  return runId
}

/** Request cancellation of an in-flight run. No-op if already finished. */
export function cancelRun(runId: string): void {
  activeRuns.get(runId)?.abort.abort()
}

/** Number of runs currently in flight (used for shutdown handling/tests). */
export function activeRunCount(): number {
  return activeRuns.size
}

async function drive(
  runId: string,
  options: StartRunOptions,
  emit: Emit,
  abort: AbortController
): Promise<void> {
  let sessionId: string | null = options.resumeSessionId ?? null
  let sawError = false

  const queryOptions: Options = {
    cwd: options.cwd,
    includePartialMessages: true,
    permissionMode: DEFAULT_PERMISSION_MODE,
    abortController: abort
  }
  if (options.resumeSessionId) queryOptions.resume = options.resumeSessionId

  try {
    const response = query({ prompt: options.prompt, options: queryOptions })

    for await (const msg of response) {
      // Every SDK message carries the canonical session id; capture it so a
      // freshly created session can be surfaced and resumed later.
      if ('session_id' in msg && typeof msg.session_id === 'string' && msg.session_id) {
        sessionId = msg.session_id
      }

      switch (msg.type) {
        case 'system':
          if (msg.subtype === 'init') {
            emit({ type: 'started', runId, sessionId })
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
          if (msg.is_error) sawError = true
          emit({ type: 'completed', runId, sessionId, ok: !msg.is_error })
          break
        }

        default:
          break
      }
    }
  } catch (err) {
    if (abort.signal.aborted) {
      // User-initiated cancellation: report a clean (not-ok) completion.
      emit({ type: 'completed', runId, sessionId, ok: false })
    } else {
      sawError = true
      emit({ type: 'error', runId, message: errorMessage(err) })
      emit({ type: 'completed', runId, sessionId, ok: false })
    }
  } finally {
    activeRuns.delete(runId)
    void sawError // tracked for potential future telemetry
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
