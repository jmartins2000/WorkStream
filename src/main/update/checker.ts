/**
 * Self-update check (distribution option C — see README "Updating").
 *
 * The app is installed as a managed git clone at ~/.workstream that builds a
 * real WorkStream.app into /Applications. This module answers "is there newer
 * code than the commit I was built from?" by comparing the built-from commit
 * against the GitHub remote, so the renderer can offer Later / Update.
 *
 * Nothing here mutates anything — it's a read-only network check. The actual
 * pull+rebuild lives in scripts/update.sh, spawned by update/runner.ts.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { UpdateStatus } from '../../shared/types.js'

const execFileAsync = promisify(execFile)

const REPO = 'jmartins2000/WorkStream'
const BRANCH = 'main'

/** The managed clone the app updates from (option C install location). */
export function cloneDir(): string {
  return join(app.getPath('home'), '.workstream')
}

/**
 * The commit this build was produced from. Packaged: build-info.json in
 * resources. Dev/local: build-info.json at repo root, else git HEAD of the
 * clone. Returns null when it genuinely can't be determined.
 */
async function builtFromCommit(): Promise<string | null> {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'build-info.json')]
    : [join(app.getAppPath(), 'build-info.json'), join(cloneDir(), 'build-info.json')]

  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      const info = JSON.parse(readFileSync(path, 'utf8')) as { commit?: string }
      if (info.commit && info.commit !== 'unknown') return info.commit
    } catch {
      // try the next candidate
    }
  }

  // Last resort (dev): the clone's current HEAD.
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: cloneDir() })
    return stdout.trim() || null
  } catch {
    return null
  }
}

/**
 * Check GitHub for commits newer than this build. Never throws — network or
 * API failure resolves to `{ available: false }` so a launch check is silent.
 */
export async function checkForUpdate(): Promise<UpdateStatus> {
  const current = await builtFromCommit()
  if (!current) return { available: false }

  try {
    // The compare API tells us directly whether `current` is behind BRANCH.
    const url = `https://api.github.com/repos/${REPO}/compare/${current}...${BRANCH}`
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'WorkStream' },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return { available: false, currentCommit: current }

    const data = (await res.json()) as {
      status?: string
      ahead_by?: number
      commits?: { commit?: { message?: string } }[]
    }
    // compare/<ours>...main: `status` describes main relative to our commit.
    // "ahead" means main has commits ours doesn't → an update is available.
    // (ahead_by counts those commits.)
    const behindBy = data.status === 'ahead' ? (data.ahead_by ?? 0) : 0
    if (behindBy <= 0) return { available: false, currentCommit: current }

    // Latest commit message (last entry) for the banner.
    const latest = data.commits?.[data.commits.length - 1]?.commit?.message?.split('\n')[0]
    return {
      available: true,
      currentCommit: current,
      behindBy,
      latestMessage: latest
    }
  } catch {
    return { available: false, currentCommit: current }
  }
}
