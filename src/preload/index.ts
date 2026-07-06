/**
 * Secure bridge between the sandboxed renderer and the main process. Only the
 * typed ClaudeBridge surface is exposed on `window.claude`.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type AgentSummary,
  type ClaudeBridge,
  type CodexAccount,
  type CodexModel,
  type CodexThreadSummary,
  type StartCodexRunOptions,
  type CommandSummary,
  type ContextUsage,
  type InputResponse,
  type McpServerInfo,
  type MemoryFile,
  type MemoryScope,
  type ProjectSummary,
  type RunEvent,
  type RunModel,
  type RunPermissionMode,
  type SessionSummary,
  type StartRunOptions,
  type StartRunResult,
  type StremioServerStatus,
  type UpdateStatus,
  type TranscriptMessage
} from '../shared/types.js'

const api: ClaudeBridge = {
  listProjects: () => ipcRenderer.invoke(IPC.listProjects) as Promise<ProjectSummary[]>,
  listSessions: (projectDir: string) =>
    ipcRenderer.invoke(IPC.listSessions, projectDir) as Promise<SessionSummary[]>,
  getMessages: (projectDir: string, sessionId: string) =>
    ipcRenderer.invoke(IPC.getMessages, projectDir, sessionId) as Promise<TranscriptMessage[]>,
  renameSession: (sessionId: string, title: string, cwd: string) =>
    ipcRenderer.invoke(IPC.renameSession, sessionId, title, cwd) as Promise<void>,
  deleteSession: (sessionId: string, cwd: string) =>
    ipcRenderer.invoke(IPC.deleteSession, sessionId, cwd) as Promise<void>,
  forkSession: (sessionId: string, cwd: string) =>
    ipcRenderer.invoke(IPC.forkSession, sessionId, cwd) as Promise<string>,
  exportTranscript: (defaultName: string, content: string) =>
    ipcRenderer.invoke(IPC.exportTranscript, defaultName, content) as Promise<string | null>,
  startRun: (options: StartRunOptions) =>
    ipcRenderer.invoke(IPC.startRun, options) as Promise<StartRunResult>,
  sendMessage: (runId: string, prompt: string) =>
    ipcRenderer.invoke(IPC.sendMessage, runId, prompt) as Promise<void>,
  cancelRun: (runId: string) => ipcRenderer.invoke(IPC.cancelRun, runId) as Promise<void>,
  stopTask: (runId: string, taskId: string) =>
    ipcRenderer.invoke(IPC.stopTask, runId, taskId) as Promise<void>,
  endRun: (runId: string) => ipcRenderer.invoke(IPC.endRun, runId) as Promise<void>,
  respondInput: (requestId: string, response: InputResponse) =>
    ipcRenderer.invoke(IPC.respondInput, requestId, response) as Promise<void>,
  getContextUsage: (runId: string) =>
    ipcRenderer.invoke(IPC.getContextUsage, runId) as Promise<ContextUsage | null>,
  getMcpStatus: (runId: string) =>
    ipcRenderer.invoke(IPC.getMcpStatus, runId) as Promise<McpServerInfo[] | null>,
  getAgents: (runId: string) =>
    ipcRenderer.invoke(IPC.getAgents, runId) as Promise<AgentSummary[] | null>,
  getCommands: (runId: string) =>
    ipcRenderer.invoke(IPC.getCommands, runId) as Promise<CommandSummary[] | null>,
  setRunModel: (runId: string, model: RunModel) =>
    ipcRenderer.invoke(IPC.setRunModel, runId, model) as Promise<void>,
  setRunPermissionMode: (runId: string, mode: RunPermissionMode) =>
    ipcRenderer.invoke(IPC.setRunPermissionMode, runId, mode) as Promise<void>,
  reconnectMcpServer: (runId: string, serverName: string) =>
    ipcRenderer.invoke(IPC.reconnectMcpServer, runId, serverName) as Promise<void>,
  toggleMcpServer: (runId: string, serverName: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.toggleMcpServer, runId, serverName, enabled) as Promise<void>,
  readMemory: (scope: MemoryScope, cwd: string) =>
    ipcRenderer.invoke(IPC.readMemory, scope, cwd) as Promise<MemoryFile>,
  writeMemory: (scope: MemoryScope, cwd: string, content: string) =>
    ipcRenderer.invoke(IPC.writeMemory, scope, cwd, content) as Promise<void>,
  onRunEvent: (listener: (event: RunEvent) => void) => {
    const handler = (_event: IpcRendererEvent, payload: RunEvent): void => listener(payload)
    ipcRenderer.on(IPC.runEvent, handler)
    return () => ipcRenderer.removeListener(IPC.runEvent, handler)
  },
  setAdblock: (enabled: boolean, partitions: string[]) =>
    ipcRenderer.invoke(IPC.setAdblock, enabled, partitions) as Promise<void>,
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder) as Promise<string | null>,
  getAppVersion: () => ipcRenderer.invoke(IPC.getAppVersion) as Promise<string>,
  checkForUpdate: () => ipcRenderer.invoke(IPC.checkForUpdate) as Promise<UpdateStatus>,
  performUpdate: () =>
    ipcRenderer.invoke(IPC.performUpdate) as Promise<{ started: boolean; error?: string }>,
  codexInstalled: () =>
    ipcRenderer.invoke(IPC.codexInstalled) as Promise<{ installed: boolean; path: string | null }>,
  codexAccount: () => ipcRenderer.invoke(IPC.codexAccount) as Promise<CodexAccount>,
  codexLogin: () =>
    ipcRenderer.invoke(IPC.codexLogin) as Promise<{ success: boolean; error?: string }>,
  codexModels: () => ipcRenderer.invoke(IPC.codexModels) as Promise<CodexModel[]>,
  codexThreads: (cwd?: string) =>
    ipcRenderer.invoke(IPC.codexThreads, cwd) as Promise<CodexThreadSummary[]>,
  codexThreadMessages: (threadId: string) =>
    ipcRenderer.invoke(IPC.codexThreadMessages, threadId) as Promise<TranscriptMessage[]>,
  startCodexRun: (options: StartCodexRunOptions) =>
    ipcRenderer.invoke(IPC.startCodexRun, options) as Promise<StartRunResult>,
  sendCodexMessage: (runId: string, prompt: string) =>
    ipcRenderer.invoke(IPC.sendCodexMessage, runId, prompt) as Promise<void>,
  cancelCodexRun: (runId: string) => ipcRenderer.invoke(IPC.cancelCodexRun, runId) as Promise<void>,
  endCodexRun: (runId: string) => ipcRenderer.invoke(IPC.endCodexRun, runId) as Promise<void>,
  respondCodexInput: (requestId: string, response: InputResponse) =>
    ipcRenderer.invoke(IPC.respondCodexInput, requestId, response) as Promise<void>,
  getStremioServerStatus: () =>
    ipcRenderer.invoke(IPC.getStremioServerStatus) as Promise<StremioServerStatus>,
  installRosetta: () => ipcRenderer.invoke(IPC.installRosetta) as Promise<void>,
  onStremioServerStatus: (listener: (status: StremioServerStatus) => void) => {
    const handler = (_event: IpcRendererEvent, payload: StremioServerStatus): void =>
      listener(payload)
    ipcRenderer.on(IPC.stremioServerStatus, handler)
    return () => ipcRenderer.removeListener(IPC.stremioServerStatus, handler)
  }
}

contextBridge.exposeInMainWorld('claude', api)
