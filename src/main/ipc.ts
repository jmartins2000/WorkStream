/**
 * Registers IPC handlers that expose the Claude session store and runner to the
 * renderer. Streaming run events are pushed back to the WebContents that
 * started the run via the `IPC.runEvent` channel.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC, type InputResponse, type RunEvent, type StartRunOptions } from '../shared/types.js'
import {
  deleteSession,
  getMessages,
  listProjects,
  listSessions,
  renameSession
} from './claude/sessions.js'
import { cancelRun, resolveInput, startRun } from './claude/runner.js'

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.listProjects, () => listProjects())

  ipcMain.handle(IPC.listSessions, (_event, projectDir: string) => listSessions(projectDir))

  ipcMain.handle(IPC.getMessages, (_event, projectDir: string, sessionId: string) =>
    getMessages(projectDir, sessionId)
  )

  ipcMain.handle(IPC.renameSession, (_event, sessionId: string, title: string, cwd: string) =>
    renameSession(sessionId, title, cwd)
  )

  ipcMain.handle(IPC.deleteSession, (_event, sessionId: string, cwd: string) =>
    deleteSession(sessionId, cwd)
  )

  ipcMain.handle(IPC.startRun, (event: IpcMainInvokeEvent, options: StartRunOptions) => {
    const sender = event.sender
    const emit = (runEvent: RunEvent): void => {
      // The window may have been closed mid-run; guard against that.
      if (!sender.isDestroyed()) sender.send(IPC.runEvent, runEvent)
    }
    const runId = startRun(options, emit)
    return { runId }
  })

  ipcMain.handle(IPC.cancelRun, (_event, runId: string) => {
    cancelRun(runId)
  })

  ipcMain.handle(IPC.respondInput, (_event, requestId: string, response: InputResponse) => {
    resolveInput(requestId, response)
  })
}
