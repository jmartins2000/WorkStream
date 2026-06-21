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
  /** Display title: custom (/rename) title, else summary, else first prompt. */
  title: string
  /** Git branch recorded for the session, if any. */
  gitBranch?: string
  /** Epoch ms of the first message, or null if unknown. */
  createdAt: number | null
  /** Epoch ms of the most recent message, or null if unknown. */
  lastActivity: number | null
  /** Number of curated (displayable) messages. */
  messageCount: number
}

/** Role of a message rendered in the transcript view. */
export type MessageRole = 'user' | 'assistant' | 'system'

/** A renderable piece of a message. */
export type MessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; detail: string }
  | { kind: 'thinking'; text: string }

/** A single transcript entry, curated and flattened for display. */
export interface TranscriptMessage {
  /** Stable id (the source uuid when present, else a synthesized index). */
  id: string
  role: MessageRole
  /** Renderable parts; never empty (noise-only messages are dropped upstream). */
  parts: MessagePart[]
  /** Epoch ms timestamp, or null. */
  timestamp: number | null
}

/** A single option in a multiple-choice question. */
export interface UiQuestionOption {
  label: string
  description: string
}

/** A multiple-choice question Claude asks via the AskUserQuestion tool. */
export interface UiQuestion {
  question: string
  header: string
  multiSelect: boolean
  options: UiQuestionOption[]
}

/** Something Claude needs from the user mid-run: an answer or an approval. */
export type InputRequest =
  | { kind: 'question'; requestId: string; questions: UiQuestion[] }
  | { kind: 'permission'; requestId: string; toolName: string; detail: string }

/** The user's reply to an InputRequest, sent back to the runner. */
export type InputResponse =
  | { kind: 'question'; answers: Record<string, string> }
  | { kind: 'permission'; decision: 'allow' | 'allow-always' | 'deny' }

/** Streaming events emitted while a query runs, pushed to the renderer. */
export type RunEvent =
  | { type: 'started'; runId: string; sessionId: string | null }
  | { type: 'slashCommands'; runId: string; commands: string[] }
  | { type: 'delta'; runId: string; text: string }
  | { type: 'message'; runId: string; message: TranscriptMessage }
  | { type: 'needsInput'; runId: string; request: InputRequest }
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
  /** Reply to a mid-run InputRequest (question answer or permission decision). */
  respondInput(requestId: string, response: InputResponse): Promise<void>
  /** Subscribe to streaming run events. Returns an unsubscribe function. */
  onRunEvent(listener: (event: RunEvent) => void): () => void
}

export const IPC = {
  listProjects: 'claude:listProjects',
  listSessions: 'claude:listSessions',
  getMessages: 'claude:getMessages',
  startRun: 'claude:startRun',
  cancelRun: 'claude:cancelRun',
  respondInput: 'claude:respondInput',
  runEvent: 'claude:runEvent'
} as const
