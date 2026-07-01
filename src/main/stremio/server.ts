/**
 * Manages the local Stremio streaming server: `stremio-runtime server.js` on
 * 127.0.0.1:11470. web.stremio.com (embedded in the app's webview) talks to
 * this server for everything stream-related — without it every title shows
 * "No streams found" / "Video is not supported", because the web app itself
 * has no torrent/transcoding engine; it's a thin client for this local
 * companion process (the same one Stremio's own desktop app bundles).
 *
 * Binaries are fetched at build/dev-setup time by scripts/fetch-stremio-service.mjs
 * (see CLAUDE.md) — never committed to this repo. They're macOS x86_64-only,
 * so on Apple Silicon this also has to make sure Rosetta 2 is installed.
 */

import { existsSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { app } from 'electron'
import type { StremioServerStatus } from '../../shared/types.js'

const execFileAsync = promisify(execFile)

const SERVER_URL = 'http://127.0.0.1:11470/settings'
const ROSETTA_PATH = '/Library/Apple/usr/share/rosetta/rosetta'
const READY_POLL_INTERVAL_MS = 500
const READY_TIMEOUT_MS = 20_000

type Emit = (status: StremioServerStatus) => void

let child: ChildProcess | null = null
let status: StremioServerStatus = { state: 'starting' }

function binDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'stremio-service')
    : join(app.getAppPath(), 'resources', 'stremio-service')
}

function binariesPresent(): boolean {
  const dir = binDir()
  return ['stremio-runtime', 'ffmpeg', 'ffprobe', 'server.js'].every((name) =>
    existsSync(join(dir, name))
  )
}

function needsRosetta(): boolean {
  return process.arch === 'arm64' && !existsSync(ROSETTA_PATH)
}

async function waitUntilReady(): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(SERVER_URL)
      if (res.ok) return true
    } catch {
      // Not up yet; keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS))
  }
  return false
}

function setStatus(next: StremioServerStatus, emit: Emit): void {
  status = next
  emit(next)
}

/** Current cached status (for a renderer that just subscribed). */
export function getStatus(): StremioServerStatus {
  return status
}

/** Start the streaming server if possible; emits status transitions via `emit`. */
export async function start(emit: Emit): Promise<void> {
  if (child) return // already running

  if (needsRosetta()) {
    setStatus({ state: 'rosetta-required' }, emit)
    return
  }
  if (!binariesPresent()) {
    setStatus({ state: 'missing-binaries' }, emit)
    return
  }

  setStatus({ state: 'starting' }, emit)

  const dir = binDir()
  const proc = spawn(join(dir, 'stremio-runtime'), [join(dir, 'server.js')], {
    cwd: dir,
    env: {
      ...process.env,
      FFMPEG_BIN: join(dir, 'ffmpeg'),
      FFPROBE_BIN: join(dir, 'ffprobe')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child = proc
  proc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[stremio-server] ${d}`))
  proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[stremio-server] ${d}`))
  proc.on('exit', (code) => {
    console.log(`[stremio-server] exited (code ${code})`)
    if (child === proc) child = null
  })
  proc.on('error', (err) => {
    console.error('[stremio-server] failed to start:', err)
    if (child === proc) child = null
    setStatus({ state: 'error', message: err.message }, emit)
  })

  const ready = await waitUntilReady()
  if (ready) {
    setStatus({ state: 'ready' }, emit)
  } else if (status.state === 'starting') {
    setStatus({ state: 'error', message: 'Streaming server did not respond in time.' }, emit)
  }
}

/** Stop the streaming server (app quit). */
export function stop(): void {
  if (!child) return
  child.kill('SIGTERM')
  child = null
}

/**
 * Trigger the one-time Rosetta 2 install via a privileged shell command (shows
 * the native macOS admin-password prompt). Retries start() on success.
 */
export async function installRosetta(emit: Emit): Promise<void> {
  setStatus({ state: 'installing-rosetta' }, emit)
  try {
    await execFileAsync('/usr/bin/osascript', [
      '-e',
      'do shell script "softwareupdate --install-rosetta --agree-to-license" with administrator privileges'
    ])
  } catch (err) {
    setStatus({ state: 'error', message: errorMessage(err) }, emit)
    return
  }
  await start(emit)
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
