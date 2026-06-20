/**
 * Shared domain + IPC types used by the main process, preload bridge, and
 * renderer. Keep this file free of any Node or DOM imports so it can be
 * consumed from every layer.
 */

/** A Claude Code project directory (one per working directory). */
export interface ProjectSummary {
  /** Encoded directory name as stored under ~/.claude/projects. */
  dirName: string
  /** Best-effort decoded absolute working-directory path. */
  cwd: string
  /** Number of sessions discovered in the project. */
  sessionCount: number
  /** Most recent activity across the project's sessions (epoch ms), or null. */
  lastActivity: number | null
}

/** Lightweight summary of a single session (one .jsonl transcript file). */
export interface SessionSummary {
  sessionId: string
  /** Encoded project dir the session belongs to. */
  projectDir: string
  /** Decoded working directory for the session. */
  cwd: string
  /** First human prompt, used as a human-readable title. */
  title: string
  /** Epoch ms of the first message, or null if unknown. */
  createdAt: number | null
  /** Epoch ms of the most recent message, or null if unknown. */
  lastActivity: number | null
  /** Total number of transcript entries. */
  messageCount: number
}

/** Role of a message rendered in the transcript view. */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

/** A single transcript entry flattened for display. */
export interface TranscriptMessage {
  /** Stable id (the source uuid when present, else a synthesized index). */
  id: string
  role: MessageRole
  /** Plain-text content suitable for display. */
  text: string
  /** Epoch ms timestamp, or null. */
  timestamp: number | null
}

/** Streaming events emitted while a query runs, pushed to the renderer. */
export type RunEvent =
  | { type: 'started'; runId: string; sessionId: string | null }
  | { type: 'delta'; runId: string; text: string }
  | { type: 'message'; runId: string; message: TranscriptMessage }
  | { type: 'error'; runId: string; message: string }
  | {
      type: 'completed'
      runId: string
      sessionId: string | null
      /** True when the run ended without an error. */
      ok: boolean
    }

/** Options for starting a new or resumed run. */
export interface StartRunOptions {
  prompt: string
  /** Working directory to run Claude Code in. */
  cwd: string
  /** Existing session id to resume; omit to start a fresh session. */
  resumeSessionId?: string
}

export interface StartRunResult {
  runId: string
}

/** The API surface exposed to the renderer via contextBridge. */
export interface ClaudeBridge {
  listProjects(): Promise<ProjectSummary[]>
  listSessions(projectDir: string): Promise<SessionSummary[]>
  getMessages(projectDir: string, sessionId: string): Promise<TranscriptMessage[]>
  startRun(options: StartRunOptions): Promise<StartRunResult>
  cancelRun(runId: string): Promise<void>
  /** Subscribe to streaming run events. Returns an unsubscribe function. */
  onRunEvent(listener: (event: RunEvent) => void): () => void
}

export const IPC = {
  listProjects: 'claude:listProjects',
  listSessions: 'claude:listSessions',
  getMessages: 'claude:getMessages',
  startRun: 'claude:startRun',
  cancelRun: 'claude:cancelRun',
  runEvent: 'claude:runEvent'
} as const
