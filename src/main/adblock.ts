/**
 * Native ad/tracker blocking for the media webviews, powered by
 * @ghostery/adblocker-electron (EasyList/EasyPrivacy filter lists): network
 * requests to ad/tracker hosts are blocked at the session's webRequest layer
 * and cosmetic CSS hides ad containers. This blocks better than any Chrome
 * extension Electron could load (Electron lacks the full blocking APIs).
 *
 * The compiled filter engine is cached in userData so startup is instant and
 * offline-safe after the first run. Stremio's partition is deliberately never
 * touched — no ads there, and filter rules must stay away from the local
 * streaming server's requests.
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app, session } from 'electron'
import { ElectronBlocker } from '@ghostery/adblocker-electron'

let blockerPromise: Promise<ElectronBlocker> | null = null
/** Partitions blocking is currently enabled on. */
const enabledPartitions = new Set<string>()

function getBlocker(): Promise<ElectronBlocker> {
  if (!blockerPromise) {
    // "Full" = ads + tracking + annoyances lists, including the scriptlet
    // filters that matter for YouTube's in-player ads.
    blockerPromise = ElectronBlocker.fromPrebuiltFull(fetch, {
      path: join(app.getPath('userData'), 'adblocker-engine-full.bin'),
      read: fs.readFile,
      write: fs.writeFile
    })
  }
  return blockerPromise
}

/**
 * Enable blocking on exactly `partitions` (when `enabled`), disabling any
 * previously-covered partition that's no longer listed. Idempotent.
 */
export async function setAdblock(enabled: boolean, partitions: string[]): Promise<void> {
  try {
    const blocker = await getBlocker()
    const wanted = enabled ? new Set(partitions) : new Set<string>()

    for (const partition of [...enabledPartitions]) {
      if (!wanted.has(partition)) {
        blocker.disableBlockingInSession(session.fromPartition(partition))
        enabledPartitions.delete(partition)
      }
    }
    for (const partition of wanted) {
      if (!enabledPartitions.has(partition)) {
        blocker.enableBlockingInSession(session.fromPartition(partition))
        enabledPartitions.add(partition)
      }
    }
    console.log(
      enabledPartitions.size > 0
        ? `[adblock] active on: ${[...enabledPartitions].join(', ')}`
        : '[adblock] disabled'
    )
  } catch (err) {
    // First run offline (filter lists not downloadable yet) — degrade quietly.
    console.warn('[adblock] could not initialize:', err)
  }
}
