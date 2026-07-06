/**
 * Kicks off a self-update: runs scripts/update.sh from the managed clone in a
 * DETACHED process, then quits the app so the script can rebuild and swap the
 * .app while nothing is holding it open. The script relaunches WorkStream when
 * it finishes (and rolls back to the previous build on failure).
 *
 * Detached + unref'd is essential: the update outlives the process that
 * started it. Logs go to ~/.workstream/update.log for post-mortem.
 */

import { spawn } from 'node:child_process'
import { existsSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { cloneDir } from './checker.js'

export interface UpdateStartResult {
  started: boolean
  error?: string
}

/** Begin the update. On success the app quits; the script takes over. */
export function performUpdate(): UpdateStartResult {
  const dir = cloneDir()
  const script = join(dir, 'scripts', 'update.sh')

  if (!existsSync(script)) {
    return {
      started: false,
      error:
        'Update script not found. WorkStream must be installed via the official install command to self-update.'
    }
  }

  try {
    const logFd = openSync(join(dir, 'update.log'), 'a')
    const child = spawn('/bin/bash', [script], {
      cwd: dir,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      // Let the script relaunch the app by bundle id after it rebuilds.
      env: { ...process.env, WORKSTREAM_RELAUNCH: '1' }
    })
    child.unref()
  } catch (err) {
    return { started: false, error: err instanceof Error ? err.message : String(err) }
  }

  // Give the detached process a beat to take hold, then quit so the rebuild
  // can replace the running .app.
  setTimeout(() => app.quit(), 400)
  return { started: true }
}
