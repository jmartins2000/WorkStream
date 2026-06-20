/**
 * Secure bridge between the sandboxed renderer and the main process. Only the
 * typed ClaudeBridge surface is exposed on `window.claude`.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type ClaudeBridge,
  type ProjectSummary,
  type RunEvent,
  type SessionSummary,
  type StartRunOptions,
  type StartRunResult,
  type TranscriptMessage
} from '../shared/types.js'

const api: ClaudeBridge = {
  listProjects: () => ipcRenderer.invoke(IPC.listProjects) as Promise<ProjectSummary[]>,
  listSessions: (projectDir: string) =>
    ipcRenderer.invoke(IPC.listSessions, projectDir) as Promise<SessionSummary[]>,
  getMessages: (projectDir: string, sessionId: string) =>
    ipcRenderer.invoke(IPC.getMessages, projectDir, sessionId) as Promise<TranscriptMessage[]>,
  startRun: (options: StartRunOptions) =>
    ipcRenderer.invoke(IPC.startRun, options) as Promise<StartRunResult>,
  cancelRun: (runId: string) => ipcRenderer.invoke(IPC.cancelRun, runId) as Promise<void>,
  onRunEvent: (listener: (event: RunEvent) => void) => {
    const handler = (_event: IpcRendererEvent, payload: RunEvent): void => listener(payload)
    ipcRenderer.on(IPC.runEvent, handler)
    return () => ipcRenderer.removeListener(IPC.runEvent, handler)
  }
}

contextBridge.exposeInMainWorld('claude', api)
