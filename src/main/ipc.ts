/**
 * Registers IPC handlers that expose the Claude session store and runner to the
 * renderer. Streaming run events are pushed back to the WebContents that
 * started the run via the `IPC.runEvent` channel.
 */

import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { writeFile } from 'node:fs/promises'
import {
  IPC,
  type InputResponse,
  type RunEvent,
  type StartRunOptions,
  type StremioServerStatus
} from '../shared/types.js'
import {
  deleteSession,
  forkSession,
  getMessages,
  listProjects,
  listSessions,
  renameSession
} from './claude/sessions.js'
import { cancelRun, endRun, resolveInput, sendMessage, startRun } from './claude/runner.js'
import * as stremioServer from './stremio/server.js'

/** Push a status update to every open window (there's only ever one). */
export function broadcastStremioStatus(status: StremioServerStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) window.webContents.send(IPC.stremioServerStatus, status)
  }
}

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

  ipcMain.handle(IPC.forkSession, (_event, sessionId: string, cwd: string) =>
    forkSession(sessionId, cwd)
  )

  ipcMain.handle(
    IPC.exportTranscript,
    async (event: IpcMainInvokeEvent, defaultName: string, content: string) => {
      const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const { canceled, filePath } = await dialog.showSaveDialog(window!, {
        title: 'Export transcript',
        defaultPath: defaultName,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (canceled || !filePath) return null
      await writeFile(filePath, content, 'utf8')
      return filePath
    }
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

  ipcMain.handle(IPC.sendMessage, (_event, runId: string, prompt: string) => {
    sendMessage(runId, prompt)
  })

  ipcMain.handle(IPC.cancelRun, (_event, runId: string) => {
    cancelRun(runId)
  })

  ipcMain.handle(IPC.endRun, (_event, runId: string) => {
    endRun(runId)
  })

  ipcMain.handle(IPC.respondInput, (_event, requestId: string, response: InputResponse) => {
    resolveInput(requestId, response)
  })

  ipcMain.handle(IPC.getStremioServerStatus, () => stremioServer.getStatus())

  ipcMain.handle(IPC.installRosetta, () => stremioServer.installRosetta(broadcastStremioStatus))
}
