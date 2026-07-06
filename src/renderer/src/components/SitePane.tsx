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
 * stitched into the player's own stream. This helper mutes ads and clicks
 * Skip/close the moment those buttons appear. An earlier version also seeked
 * the ad to its end at 16× — that WEDGED playback entirely when the ad
 * request was blocked upstream (player stuck in ad state while we hammered
 * the shared <video> element), so: buttons and mute only.
 */
const YT_AD_SKIP_SCRIPT = `(() => {
  if (window.__wsAdSkipInstalled) return
  window.__wsAdSkipInstalled = true
  // Deliberately conservative: mute the ad and click Skip/close buttons.
  // NO seeking and NO playbackRate games — mutating the player's single
  // <video> element while YouTube is (or thinks it is) in ad state also
  // sabotages the upcoming content video and can wedge playback entirely.
  let mutedByUs = false
  setInterval(() => {
    const player = document.querySelector('.html5-video-player')
    const video = player ? player.querySelector('video') : null
    const inAd = !!(player && player.classList.contains('ad-showing'))
    if (video) {
      if (inAd && !video.muted) {
        video.muted = true
        mutedByUs = true
      } else if (!inAd && mutedByUs) {
        video.muted = false
        mutedByUs = false
      }
    }
    const skip = document.querySelector(
      '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern'
    )
    if (skip) skip.click()
    const overlayClose = document.querySelector('.ytp-ad-overlay-close-button')
    if (overlayClose) overlayClose.click()
  }, 500)
  console.log('[workstream] youtube ad auto-skip armed (conservative)')
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
      ).catch(() => {})
    },
    play: () => {
      void webviewRef.current?.executeJavaScript(
        `(() => { const v = document.querySelector('video, audio'); if (v) v.play(); })();`
      ).catch(() => {})
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
