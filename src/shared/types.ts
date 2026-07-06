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
  | {
      kind: 'permission'
      requestId: string
      toolName: string
      detail: string
      /** Full plan markdown when the request is ExitPlanMode (plan-mode review). */
      plan?: string
    }

/** The user's reply to an InputRequest, sent back to the runner. */
export type InputResponse =
  | { kind: 'question'; answers: Record<string, string> }
  | {
      kind: 'permission'
      decision: 'allow' | 'allow-always' | 'deny'
      /** Renderer-side: flip the live session to this mode after replying
       *  (plan approval switches out of plan mode, like the CLI). */
      setMode?: RunPermissionMode
    }

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
  /** Codex: up-to-date unified diff of all file changes in the current turn. */
  | { type: 'diff'; runId: string; diff: string }
  /** Codex: the agent's current plan (steps with statuses). */
  | {
      type: 'plan'
      runId: string
      plan: { step: string; status: 'pending' | 'inProgress' | 'completed' }[]
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
  permissionMode: 'bypassPermissions'
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
  /** Start the Remote Control bridge so the session appears on claude.ai/code. */
  remoteControl?: boolean
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

/** One category of the context-window breakdown (system prompt, tools, messages…). */
export interface ContextCategory {
  name: string
  tokens: number
}

/** Context-window usage for the live session (the /context data). */
export interface ContextUsage {
  totalTokens: number
  maxTokens: number
  /** 0–100. */
  percentage: number
  model: string
  categories: ContextCategory[]
}

/** Status of one configured MCP server (the /mcp data). */
export interface McpServerInfo {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  /** Error message when status is 'failed'. */
  error?: string
  /** Config scope (project, user, local…). */
  scope?: string
  /** Tool names provided by this server, when connected. */
  tools: string[]
}

/** An available subagent (the /agents data). */
export interface AgentSummary {
  name: string
  description: string
  model?: string
}

/** An available slash command / skill with its description (the /skills data). */
export interface CommandSummary {
  name: string
  description: string
  argumentHint?: string
}

/** Which CLAUDE.md a memory operation targets. */
export type MemoryScope = 'project' | 'user'

/** A memory (CLAUDE.md) file's location and content. */
export interface MemoryFile {
  scope: MemoryScope
  /** Absolute path of the file (whether or not it exists yet). */
  path: string
  exists: boolean
  content: string
}

/* ----------------------------------------------------------------------------
 * Codex (app-server protocol) — see docs/codex-integration.md
 * ------------------------------------------------------------------------- */

/** Codex auth/account state (from account/read). */
export interface CodexAccount {
  authenticated: boolean
  /** 'chatgpt' | 'apiKey' | … or null when logged out. */
  authMode: string | null
  email: string | null
  planType: string | null
}

/** A Codex model with its reasoning-effort options (from model/list). */
export interface CodexModel {
  id: string
  displayName: string
  efforts: string[]
  defaultEffort: string
  isDefault: boolean
}

/** A Codex thread for the sidebar (from thread/list). */
export interface CodexThreadSummary {
  threadId: string
  title: string
  cwd: string
  updatedAt: number | null
}

/** Per-run Codex settings (dynamic — models/efforts come from model/list). */
export interface CodexRunSettings {
  model?: string
  effort?: string
  approvalPolicy?: 'untrusted' | 'onRequest' | 'never'
  sandbox?: 'readOnly' | 'workspaceWrite' | 'dangerFullAccess'
}

/** Options for starting/resuming a Codex conversation. */
export interface StartCodexRunOptions {
  prompt: string
  cwd: string
  resumeThreadId?: string
  settings?: CodexRunSettings
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
  /** Stop a single background task (shell or subagent) without interrupting
   *  the rest of the session. */
  stopTask(runId: string, taskId: string): Promise<void>
  /** Fully end a streaming session (tear down the query). */
  endRun(runId: string): Promise<void>
  /** Reply to a mid-run InputRequest (question answer or permission decision). */
  respondInput(requestId: string, response: InputResponse): Promise<void>
  /** Context-window usage of the live session (/context). Null when the session is gone. */
  getContextUsage(runId: string): Promise<ContextUsage | null>
  /** MCP server statuses of the live session (/mcp). Null when the session is gone. */
  getMcpStatus(runId: string): Promise<McpServerInfo[] | null>
  /** Available subagents of the live session (/agents). Null when the session is gone. */
  getAgents(runId: string): Promise<AgentSummary[] | null>
  /** Available commands/skills of the live session (/skills). Null when the session is gone. */
  getCommands(runId: string): Promise<CommandSummary[] | null>
  /** Switch the live session's model mid-run (SDK setModel). */
  setRunModel(runId: string, model: RunModel): Promise<void>
  /** Switch the live session's permission mode mid-run (SDK setPermissionMode). */
  setRunPermissionMode(runId: string, mode: RunPermissionMode): Promise<void>
  /** Reconnect an MCP server on the live session. Rejects on failure. */
  reconnectMcpServer(runId: string, serverName: string): Promise<void>
  /** Enable/disable an MCP server on the live session. Rejects on failure. */
  toggleMcpServer(runId: string, serverName: string, enabled: boolean): Promise<void>
  /** Read a CLAUDE.md memory file (project scope needs the cwd). */
  readMemory(scope: MemoryScope, cwd: string): Promise<MemoryFile>
  /** Write a CLAUDE.md memory file (creates it if missing). */
  writeMemory(scope: MemoryScope, cwd: string, content: string): Promise<void>
  /** Subscribe to streaming run events. Returns an unsubscribe function. */
  onRunEvent(listener: (event: RunEvent) => void): () => void
  /** Enable/disable ad & tracker blocking on the given webview partitions. */
  setAdblock(enabled: boolean, partitions: string[]): Promise<void>
  /** Native folder picker; returns the chosen absolute path or null. */
  pickFolder(): Promise<string | null>
  /** Codex: binary presence (never spawns anything). */
  codexInstalled(): Promise<{ installed: boolean; path: string | null }>
  /** Codex: account/auth state (spawns the lazy server — Codex tab only). */
  codexAccount(): Promise<CodexAccount>
  /** Codex: run the ChatGPT browser login flow. */
  codexLogin(): Promise<{ success: boolean; error?: string }>
  /** Codex: available models with reasoning efforts. */
  codexModels(): Promise<CodexModel[]>
  /** Codex: threads across all projects (or scoped to one cwd). */
  codexThreads(cwd?: string): Promise<CodexThreadSummary[]>
  /** Codex: curated transcript of a thread (sidebar click). */
  codexThreadMessages(threadId: string): Promise<TranscriptMessage[]>
  /** Codex: start or resume a conversation; RunEvents arrive on onRunEvent. */
  startCodexRun(options: StartCodexRunOptions): Promise<StartRunResult>
  /** Codex: follow-up message (steers a live turn, or starts a new one). */
  sendCodexMessage(runId: string, prompt: string): Promise<void>
  /** Codex: interrupt the current turn. */
  cancelCodexRun(runId: string): Promise<void>
  /** Codex: end the conversation (idle server is reaped automatically). */
  endCodexRun(runId: string): Promise<void>
  /** Codex: reply to a pending approval/question. */
  respondCodexInput(requestId: string, response: InputResponse): Promise<void>
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
  stopTask: 'claude:stopTask',
  endRun: 'claude:endRun',
  respondInput: 'claude:respondInput',
  getContextUsage: 'claude:getContextUsage',
  getMcpStatus: 'claude:getMcpStatus',
  getAgents: 'claude:getAgents',
  getCommands: 'claude:getCommands',
  setRunModel: 'claude:setRunModel',
  setRunPermissionMode: 'claude:setRunPermissionMode',
  reconnectMcpServer: 'claude:reconnectMcpServer',
  toggleMcpServer: 'claude:toggleMcpServer',
  readMemory: 'claude:readMemory',
  writeMemory: 'claude:writeMemory',
  runEvent: 'claude:runEvent',
  setAdblock: 'app:setAdblock',
  pickFolder: 'app:pickFolder',
  codexInstalled: 'codex:installed',
  codexAccount: 'codex:account',
  codexLogin: 'codex:login',
  codexModels: 'codex:models',
  codexThreads: 'codex:threads',
  codexThreadMessages: 'codex:threadMessages',
  startCodexRun: 'codex:startRun',
  sendCodexMessage: 'codex:sendMessage',
  cancelCodexRun: 'codex:cancelRun',
  endCodexRun: 'codex:endRun',
  respondCodexInput: 'codex:respondInput',
  getStremioServerStatus: 'stremio:getServerStatus',
  installRosetta: 'stremio:installRosetta',
  stremioServerStatus: 'stremio:serverStatus'
} as const
