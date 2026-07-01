#!/usr/bin/env node
/**
 * Downloads the official Stremio Service release for macOS and extracts the
 * four binaries the local streaming server needs: stremio-runtime, ffmpeg,
 * ffprobe, server.js. Without these, web.stremio.com can't resolve or play
 * any stream — it talks to this server on 127.0.0.1:11470 for everything.
 *
 * Mirrors Stremio's own build process (github.com/Stremio/stremio-service):
 * fetched from their official GitHub release at build/dev-setup time, not
 * committed to this repo (see resources/stremio-service/ in .gitignore).
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { chmod } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'

const STREMIO_SERVICE_VERSION = 'v0.1.21'
const RELEASE_URL = `https://github.com/Stremio/stremio-service/releases/download/${STREMIO_SERVICE_VERSION}/stremio-service-macos.zip`

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const destDir = join(repoRoot, 'resources', 'stremio-service')
const versionFile = join(destDir, '.version')
const zipPath = join(repoRoot, 'resources', '.stremio-service.zip')

async function main() {
  if (existsSync(versionFile) && readFileSync(versionFile, 'utf8').trim() === STREMIO_SERVICE_VERSION) {
    console.log(`[fetch-stremio-service] already at ${STREMIO_SERVICE_VERSION}, skipping`)
    return
  }

  mkdirSync(destDir, { recursive: true })
  console.log(`[fetch-stremio-service] downloading ${RELEASE_URL}`)

  const response = await fetch(RELEASE_URL, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`)
  }
  await pipeline(response.body, createWriteStream(zipPath))

  console.log('[fetch-stremio-service] extracting...')
  // macOS ships /usr/bin/unzip; avoid pulling in a zip dependency for a
  // macOS-only app.
  execFileSync('/usr/bin/unzip', ['-o', '-q', zipPath, '-d', destDir])
  rmSync(zipPath)

  const binaries = ['stremio-runtime', 'ffmpeg', 'ffprobe']
  for (const name of binaries) {
    const path = join(destDir, name)
    if (!existsSync(path)) throw new Error(`Expected binary missing after extraction: ${name}`)
    await chmod(path, 0o755)
  }
  if (!existsSync(join(destDir, 'server.js'))) {
    throw new Error('Expected server.js missing after extraction')
  }
  // The packaged app's own GUI binary isn't needed — only the streaming
  // engine pieces above are spawned by our runner.
  rmSync(join(destDir, 'stremio-service'), { force: true })

  // server.js is a CommonJS (webpack) bundle. Without its own package.json,
  // Node resolves module type by walking up to this repo's package.json
  // ("type": "module") and tries to load it as ESM, which fails with
  // "require is not defined". Pin this directory to CommonJS explicitly.
  writeFileSync(join(destDir, 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n')

  writeFileSync(versionFile, STREMIO_SERVICE_VERSION)
  console.log(`[fetch-stremio-service] done — ${destDir}`)
}

main().catch((err) => {
  console.error('[fetch-stremio-service] failed:', err.message)
  console.error('Stremio playback will not work until this succeeds. Re-run with: npm run fetch:stremio')
  // Non-fatal for npm install / CI: don't block installs without network.
  process.exitCode = 0
})
