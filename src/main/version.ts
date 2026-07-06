/**
 * The app version string shown in Settings. Reads build-info.json (stamped at
 * build time by scripts/write-build-info.mjs) — packaged from resources, dev
 * from the repo root. The build number is the git commit count, so it bumps
 * on every commit and visibly changes after a self-update.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

interface BuildInfo {
  version?: string
  build?: number
}

export function getAppVersion(): string {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'build-info.json')]
    : [join(app.getAppPath(), 'build-info.json')]

  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      const info = JSON.parse(readFileSync(path, 'utf8')) as BuildInfo
      const version = info.version ?? app.getVersion()
      return info.build ? `v${version} · build ${info.build}` : `v${version}`
    } catch {
      // fall through
    }
  }
  // Dev without a stamp: just the package version.
  return `v${app.getVersion()} · dev`
}
