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
import { app, ipcMain, session } from 'electron'
import { ElectronBlocker } from '@ghostery/adblocker-electron'

/**
 * enableBlockingInSession registers these ipcMain handlers GLOBALLY on every
 * call — enabling a second session throws "Attempted to register a second
 * handler". The handlers are identical (bound to the same blocker), so we
 * drop them before each enable and let the call re-register.
 */
const GHOSTERY_IPC_CHANNELS = [
  '@ghostery/adblocker/inject-cosmetic-filters',
  '@ghostery/adblocker/is-mutation-observer-enabled'
]

let blockerPromise: Promise<ElectronBlocker> | null = null
/** Partitions blocking is currently enabled on. */
const enabledPartitions = new Set<string>()

function getBlocker(): Promise<ElectronBlocker> {
  if (!blockerPromise) {
    // Ads+tracking lists only. The "full" bundle (annoyances + uBlock extras)
    // BROKE YouTube playback: it carries redirect-style rules this engine can
    // only hard-block, starving the player of requests it needs ("video never
    // loads"). Network-level ads+tracking is the well-tested baseline.
    blockerPromise = ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: join(app.getPath('userData'), 'adblocker-engine.bin'),
      read: fs.readFile,
      write: fs.writeFile
    }).then((blocker) => {
      // Cosmetic injection never worked inside webview guests (its
      // ipcRenderer round-trip rejects in every guest — the 3 unhandled
      // rejections in the startup log) — disable it and keep the network
      // layer, which is what actually blocks. The property is typed readonly
      // but is a plain field the enable path consults at runtime.
      ;(blocker.config as { loadCosmeticFilters: boolean }).loadCosmeticFilters = false
      return blocker
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
        try {
          blocker.disableBlockingInSession(session.fromPartition(partition))
        } catch (err) {
          console.warn(`[adblock] disable failed for ${partition}:`, err)
        }
        enabledPartitions.delete(partition)
      }
    }
    for (const partition of wanted) {
      if (!enabledPartitions.has(partition)) {
        try {
          for (const channel of GHOSTERY_IPC_CHANNELS) ipcMain.removeHandler(channel)
          blocker.enableBlockingInSession(session.fromPartition(partition))
          enabledPartitions.add(partition)
        } catch (err) {
          // Isolate per-partition failures — the rest must still enable.
          console.warn(`[adblock] enable failed for ${partition}:`, err)
        }
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
