/**
 * Registers IPC handlers that expose the Claude session store and runner to the
 * renderer. Streaming run events are pushed back to the WebContents that
 * started the run via the `IPC.runEvent` channel.
 */

import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  IPC,
  type InputResponse,
  type MemoryFile,
  type MemoryScope,
  type RunEvent,
  type RunModel,
  type RunPermissionMode,
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
import {
  cancelRun,
  endRun,
  getAgents,
  getCommands,
  getContextUsage,
  getMcpStatus,
  reconnectMcpServer,
  resolveInput,
  sendMessage,
  setRunModel,
  setRunPermissionMode,
  startRun,
  stopTask,
  toggleMcpServer
} from './claude/runner.js'
import * as stremioServer from './stremio/server.js'
import { setAdblock } from './adblock.js'
import { checkForUpdate } from './update/checker.js'
import { performUpdate } from './update/runner.js'
import { getAppVersion } from './version.js'
import {
  cancelCodexRun,
  codexAccount,
  codexInstalled,
  codexLogin,
  codexModels,
  codexThreadMessages,
  codexThreads,
  endCodexRun,
  resolveCodexInput,
  sendCodexMessage,
  startCodexRun
} from './codex/runner.js'

/** Resolve the CLAUDE.md path for a memory scope (mirrors the CLI's /memory). */
function memoryPath(scope: MemoryScope, cwd: string): string {
  if (scope === 'project') return join(cwd, 'CLAUDE.md')
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
  return join(configDir, 'CLAUDE.md')
}

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

  ipcMain.handle(IPC.stopTask, (_event, runId: string, taskId: string) => stopTask(runId, taskId))

  ipcMain.handle(IPC.endRun, (_event, runId: string) => {
    endRun(runId)
  })

  ipcMain.handle(IPC.respondInput, (_event, requestId: string, response: InputResponse) => {
    resolveInput(requestId, response)
  })

  ipcMain.handle(IPC.getContextUsage, (_event, runId: string) => getContextUsage(runId))

  ipcMain.handle(IPC.getMcpStatus, (_event, runId: string) => getMcpStatus(runId))

  ipcMain.handle(IPC.getAgents, (_event, runId: string) => getAgents(runId))

  ipcMain.handle(IPC.getCommands, (_event, runId: string) => getCommands(runId))

  ipcMain.handle(IPC.setRunModel, (_event, runId: string, model: RunModel) =>
    setRunModel(runId, model)
  )

  ipcMain.handle(IPC.setRunPermissionMode, (_event, runId: string, mode: RunPermissionMode) =>
    setRunPermissionMode(runId, mode)
  )

  ipcMain.handle(IPC.reconnectMcpServer, (_event, runId: string, serverName: string) =>
    reconnectMcpServer(runId, serverName)
  )

  ipcMain.handle(
    IPC.toggleMcpServer,
    (_event, runId: string, serverName: string, enabled: boolean) =>
      toggleMcpServer(runId, serverName, enabled)
  )

  ipcMain.handle(
    IPC.readMemory,
    async (_event, scope: MemoryScope, cwd: string): Promise<MemoryFile> => {
      const path = memoryPath(scope, cwd)
      const exists = existsSync(path)
      const content = exists ? await readFile(path, 'utf8') : ''
      return { scope, path, exists, content }
    }
  )

  ipcMain.handle(
    IPC.writeMemory,
    async (_event, scope: MemoryScope, cwd: string, content: string) => {
      const path = memoryPath(scope, cwd)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf8')
    }
  )

  ipcMain.handle(IPC.setAdblock, (_event, enabled: boolean, partitions: string[]) =>
    setAdblock(enabled, partitions)
  )

  ipcMain.handle(IPC.pickFolder, async (event: IpcMainInvokeEvent) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const { canceled, filePaths } = await dialog.showOpenDialog(window!, {
      properties: ['openDirectory', 'createDirectory']
    })
    return canceled || filePaths.length === 0 ? null : filePaths[0]
  })

  ipcMain.handle(IPC.getAppVersion, () => getAppVersion())

  ipcMain.handle(IPC.checkForUpdate, () => checkForUpdate())

  ipcMain.handle(IPC.performUpdate, () => performUpdate())

  // --- Codex (lazy app-server; see docs/codex-integration.md) ---

  ipcMain.handle(IPC.codexInstalled, () => codexInstalled())

  ipcMain.handle(IPC.codexAccount, () => codexAccount())

  ipcMain.handle(IPC.codexLogin, () => codexLogin())

  ipcMain.handle(IPC.codexModels, () => codexModels())

  ipcMain.handle(IPC.codexThreads, (_event, cwd?: string) => codexThreads(cwd))

  ipcMain.handle(IPC.codexThreadMessages, (_event, threadId: string) =>
    codexThreadMessages(threadId)
  )

  ipcMain.handle(IPC.startCodexRun, async (event: IpcMainInvokeEvent, options) => {
    const sender = event.sender
    const emit = (runEvent: RunEvent): void => {
      if (!sender.isDestroyed()) sender.send(IPC.runEvent, runEvent)
    }
    const runId = await startCodexRun(options, emit)
    return { runId }
  })

  ipcMain.handle(IPC.sendCodexMessage, (_event, runId: string, prompt: string) =>
    sendCodexMessage(runId, prompt)
  )

  ipcMain.handle(IPC.cancelCodexRun, (_event, runId: string) => cancelCodexRun(runId))

  ipcMain.handle(IPC.endCodexRun, (_event, runId: string) => endCodexRun(runId))

  ipcMain.handle(IPC.respondCodexInput, (_event, requestId: string, response: InputResponse) => {
    resolveCodexInput(requestId, response)
  })

  ipcMain.handle(IPC.getStremioServerStatus, () => stremioServer.getStatus())

  ipcMain.handle(IPC.installRosetta, () => stremioServer.installRosetta(broadcastStremioStatus))
}
