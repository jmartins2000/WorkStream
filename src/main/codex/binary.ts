/**
 * Locates the `codex` CLI binary. Codex can arrive several ways — npm global,
 * Homebrew, a standalone binary, or bundled inside the Codex desktop app —
 * and we accept any of them. Nothing is spawned here; discovery only.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

/** Candidate locations, in preference order (PATH first — user's choice wins). */
const CANDIDATE_PATHS = [
  '/opt/homebrew/bin/codex',
  '/usr/local/bin/codex',
  join(homedir(), '.local', 'bin', 'codex'),
  join(homedir(), '.npm-global', 'bin', 'codex'),
  // The Codex desktop app bundles the CLI — piggyback when it's installed.
  '/Applications/Codex.app/Contents/Resources/codex'
]

let cached: string | null | undefined

/** Absolute path to a codex binary, or null when none can be found. Cached. */
export async function findCodexBinary(): Promise<string | null> {
  if (cached !== undefined) return cached

  // PATH lookup — but Electron GUI apps get a minimal PATH on macOS, so this
  // often misses Homebrew installs; the static candidates below cover those.
  try {
    const { stdout } = await execFileAsync('/usr/bin/which', ['codex'])
    const found = stdout.trim()
    if (found) {
      cached = found
      return cached
    }
  } catch {
    // Not on PATH; fall through to candidates.
  }

  cached = CANDIDATE_PATHS.find((path) => existsSync(path)) ?? null
  return cached
}

/** Version string of the resolved binary (e.g. "codex-cli 0.142.5"), or null. */
export async function codexVersion(): Promise<string | null> {
  const binary = await findCodexBinary()
  if (!binary) return null
  try {
    const { stdout } = await execFileAsync(binary, ['--version'], { timeout: 5000 })
    return stdout.trim() || null
  } catch {
    return null
  }
}

/** Drop the cache (used by tests and by "re-check" UI actions). */
export function resetBinaryCache(): void {
  cached = undefined
}
