import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { WebviewElement } from '../webview'
import type { MediaHandle } from './StremioPane'

interface SitePaneProps {
  /** The site to embed (e.g. https://www.youtube.com/ or a custom tab's URL). */
  url: string
  /** Session partition — persist: prefixed so logins survive restarts. */
  partition: string
  /** When true and the site is YouTube, inject the video-ad auto-skipper. */
  adblock?: boolean
}

/**
 * YouTube in-player ads can't be removed by network filtering — they're
 * stitched into the player's own stream. Real ad blockers beat them with
 * in-page JS; this is our version: when the player enters ad state, mute,
 * jump to the ad's end, and click Skip the moment it appears. Worst case an
 * ad flashes for a second instead of playing out.
 */
const YT_AD_SKIP_SCRIPT = `(() => {
  if (window.__wsAdSkipInstalled) return
  window.__wsAdSkipInstalled = true
  setInterval(() => {
    const ad = document.querySelector('.ad-showing video, .ad-interrupting video')
    if (ad) {
      ad.muted = true
      ad.playbackRate = 16
      if (Number.isFinite(ad.duration) && ad.duration > 0) {
        try { ad.currentTime = ad.duration } catch { /* not seekable yet */ }
      }
    }
    const skip = document.querySelector(
      '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern'
    )
    if (skip) skip.click()
    const overlayClose = document.querySelector('.ytp-ad-overlay-close-button')
    if (overlayClose) overlayClose.click()
  }, 500)
  console.log('[workstream] youtube ad auto-skip armed')
})();`

function isYouTube(url: string): boolean {
  try {
    return /(^|\.)youtube\.com$/.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/**
 * A site embedded as a persistent webview — stays mounted so playback and
 * login state survive tab switches. Backs the YouTube tab and every
 * user-added custom tab (X, Instagram, …).
 */
export const SitePane = forwardRef<MediaHandle, SitePaneProps>(function SitePane(
  { url, partition, adblock = false },
  ref
) {
  const webviewRef = useRef<WebviewElement | null>(null)

  // Arm the YouTube ad auto-skipper on every page load (and immediately, in
  // case the page beat this effect); no-op for non-YouTube sites.
  useEffect(() => {
    if (!adblock || !isYouTube(url)) return
    const wv = webviewRef.current
    if (!wv) return
    const inject = (): void => {
      void wv.executeJavaScript(YT_AD_SKIP_SCRIPT).catch(() => {
        // Page not ready; next dom-ready retries.
      })
    }
    wv.addEventListener('dom-ready', inject)
    inject()
    return () => wv.removeEventListener('dom-ready', inject)
  }, [adblock, url])

  useImperativeHandle(ref, () => ({
    pause: () => {
      void webviewRef.current?.executeJavaScript(
        `(() => { document.querySelectorAll('video, audio').forEach(v => v.pause()); })();`
      )
    },
    play: () => {
      void webviewRef.current?.executeJavaScript(
        `(() => { const v = document.querySelector('video, audio'); if (v) v.play(); })();`
      )
    },
    reload: () => webviewRef.current?.reload(),
    exitFullscreen: async () => {
      await webviewRef.current?.executeJavaScript(
        `document.fullscreenElement ? document.exitFullscreen() : undefined`
      )
    }
  }))

  return (
    <div className="media-pane">
      <webview
        ref={webviewRef as never}
        src={url}
        partition={partition}
        allowpopups={'true' as unknown as boolean} // string on purpose: react-dom drops boolean true (unknown attr) — see webview.d.ts
        className="media-webview"
      />
    </div>
  )
})
