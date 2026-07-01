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
  | {
      kind: 'tool'
      name: string
      detail: string
      /** Tool-use id, used to correlate the result fed back to the model. */
      toolUseId?: string
      /** The tool's output, attached once available (history view). */
      result?: string
      /** True when the tool reported an error. */
      isError?: boolean
    }
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
  | { type: 'usage'; runId: string; usage: RunUsage }
  | { type: 'error'; runId: string; message: string }
  /** A background task (Bash run_in_background / Task) started during the session. */
  | { type: 'taskStarted'; runId: string; taskId: string; description: string }
  /** A background task finished; the agent will auto-continue from here. */
  | {
      type: 'taskCompleted'
      runId: string
      taskId: string
      status: 'completed' | 'failed' | 'stopped'
      summary: string
    }
  | {
      type: 'completed'
      runId: string
      sessionId: string | null
      /** True when the turn ended without an error. */
      ok: boolean
    }
  /**
   * The streaming session itself ended (input closed, cancelled, or the query
   * terminated). Distinct from `completed`, which only ends a single turn while
   * the session stays alive to receive follow-ups and background continuations.
   */
  | { type: 'closed'; runId: string; sessionId: string | null }

/** Model aliases offered in the UI (maps to the SDK `model` option). */
export const RUN_MODELS = ['default', 'opus', 'sonnet', 'haiku', 'fable', 'opusplan'] as const
export type RunModel = (typeof RUN_MODELS)[number]

/** Reasoning effort levels (maps to the SDK `effort` option). */
export const RUN_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type RunEffort = (typeof RUN_EFFORTS)[number]

/** Permission modes selectable per run (subset of the SDK's modes). */
export const RUN_PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const
export type RunPermissionMode = (typeof RUN_PERMISSION_MODES)[number]

/** Per-run configuration mirroring /model, /effort and permission-mode cycling. */
export interface RunSettings {
  model: RunModel
  effort: RunEffort
  permissionMode: RunPermissionMode
}

export const DEFAULT_RUN_SETTINGS: RunSettings = {
  model: 'default',
  effort: 'high',
  permissionMode: 'default'
}

/** Options for starting a new or resumed run. */
export interface StartRunOptions {
  prompt: string
  /** Working directory to run Claude Code in. */
  cwd: string
  /** Existing session id to resume; omit to start a fresh session. */
  resumeSessionId?: string
  /** Per-run model / effort / permission settings. */
  settings?: RunSettings
}

/** Cost and token usage reported at the end of a run. */
export interface RunUsage {
  costUsd: number
  inputTokens: number
  outputTokens: number
  numTurns: number
}

export interface StartRunResult {
  runId: string
}

/**
 * State of the local Stremio streaming server (`stremio-runtime server.js` on
 * 127.0.0.1:11470). web.stremio.com cannot resolve or play any stream without
 * it — see claude/stremioServer.ts.
 */
export type StremioServerStatus =
  | { state: 'starting' }
  | { state: 'ready' }
  | { state: 'missing-binaries' }
  | { state: 'rosetta-required' }
  | { state: 'installing-rosetta' }
  | { state: 'error'; message: string }

/** The API surface exposed to the renderer via contextBridge. */
export interface ClaudeBridge {
  listProjects(): Promise<ProjectSummary[]>
  listSessions(projectDir: string): Promise<SessionSummary[]>
  getMessages(projectDir: string, sessionId: string): Promise<TranscriptMessage[]>
  /** Set a session's custom title (like /rename). */
  renameSession(sessionId: string, title: string, cwd: string): Promise<void>
  /** Permanently delete a session's transcript. */
  deleteSession(sessionId: string, cwd: string): Promise<void>
  /** Fork a session at its current point (like /branch); returns new id. */
  forkSession(sessionId: string, cwd: string): Promise<string>
  /** Save transcript markdown to a file; returns the path or null if cancelled. */
  exportTranscript(defaultName: string, content: string): Promise<string | null>
  startRun(options: StartRunOptions): Promise<StartRunResult>
  /** Send a follow-up turn into an already-live streaming session. */
  sendMessage(runId: string, prompt: string): Promise<void>
  /** Interrupt the current turn without ending the session. */
  cancelRun(runId: string): Promise<void>
  /** Fully end a streaming session (tear down the query). */
  endRun(runId: string): Promise<void>
  /** Reply to a mid-run InputRequest (question answer or permission decision). */
  respondInput(requestId: string, response: InputResponse): Promise<void>
  /** Subscribe to streaming run events. Returns an unsubscribe function. */
  onRunEvent(listener: (event: RunEvent) => void): () => void
  /** Current state of the local Stremio streaming server. */
  getStremioServerStatus(): Promise<StremioServerStatus>
  /** Trigger the one-time Rosetta 2 install (Apple Silicon only; prompts for admin password). */
  installRosetta(): Promise<void>
  /** Subscribe to streaming-server status changes. Returns an unsubscribe function. */
  onStremioServerStatus(listener: (status: StremioServerStatus) => void): () => void
}

export const IPC = {
  listProjects: 'claude:listProjects',
  listSessions: 'claude:listSessions',
  getMessages: 'claude:getMessages',
  renameSession: 'claude:renameSession',
  deleteSession: 'claude:deleteSession',
  forkSession: 'claude:forkSession',
  exportTranscript: 'claude:exportTranscript',
  startRun: 'claude:startRun',
  sendMessage: 'claude:sendMessage',
  cancelRun: 'claude:cancelRun',
  endRun: 'claude:endRun',
  respondInput: 'claude:respondInput',
  runEvent: 'claude:runEvent',
  getStremioServerStatus: 'stremio:getServerStatus',
  installRosetta: 'stremio:installRosetta',
  stremioServerStatus: 'stremio:serverStatus'
} as const
