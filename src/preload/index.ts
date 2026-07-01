/**
 * Secure bridge between the sandboxed renderer and the main process. Only the
 * typed ClaudeBridge surface is exposed on `window.claude`.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type ClaudeBridge,
  type InputResponse,
  type ProjectSummary,
  type RunEvent,
  type SessionSummary,
  type StartRunOptions,
  type StartRunResult,
  type StremioServerStatus,
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
  endRun: (runId: string) => ipcRenderer.invoke(IPC.endRun, runId) as Promise<void>,
  respondInput: (requestId: string, response: InputResponse) =>
    ipcRenderer.invoke(IPC.respondInput, requestId, response) as Promise<void>,
  onRunEvent: (listener: (event: RunEvent) => void) => {
    const handler = (_event: IpcRendererEvent, payload: RunEvent): void => listener(payload)
    ipcRenderer.on(IPC.runEvent, handler)
    return () => ipcRenderer.removeListener(IPC.runEvent, handler)
  },
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
