#!/usr/bin/env node
/**
 * Stamps build-info.json at the repo root with the git commit the app is
 * being built from, plus a timestamp. The main process reads this at runtime
 * to know "which commit am I" and compares it against the GitHub remote to
 * decide whether an update is available (see src/main/update/checker.ts).
 *
 * Bundled into the packaged app via electron-builder.yml `files`. In a dev
 * run the file may be absent/stale — the checker falls back to reading git
 * HEAD directly there.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: repoRoot, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
// Total commit count is the build number — it bumps on every commit, so the
// version string in Settings changes with each update (visible confirmation
// that a self-update landed).
const build = Number(git('rev-list --count HEAD')) || 0

const info = {
  version: pkg.version,
  build,
  commit: git('rev-parse HEAD') || 'unknown',
  branch: git('rev-parse --abbrev-ref HEAD') || 'unknown',
  builtAt: new Date().toISOString()
}

writeFileSync(join(repoRoot, 'build-info.json'), JSON.stringify(info, null, 2) + '\n')
console.log(`[write-build-info] v${info.version} build ${info.build} · ${info.commit.slice(0, 8)}`)
