# Intermittent silent-audio investigation (ON HOLD — awaiting reproduction)

## Symptom
Stremio playback in the webview sometimes has no sound. Intermittent: same
torrent can have sound one app launch and none the next; sometimes no torrent
has sound at all. Video always plays fine. Native Stremio unaffected.

## Ruled out (verified live during a silent-playback repro, 2026-07-05)
- **Server side is healthy.** While a video played silently, `ps aux` showed
  BOTH ffmpeg track jobs running: video `-c:v copy` and audio
  `-map a:0 -c:a aac -ac:a 2 -ab 384000 -ar:a 48000`. The audio track is being
  produced and served.
- **No persisted mute state.** The webview partition's localStorage
  (`~/Library/Application Support/workstream/Partitions/stremio/Local Storage`)
  contains only library/profile data — no volume/muted keys.
- **Autoplay policy already addressed**: `autoplay-policy=no-user-gesture-required`
  command-line switch + `setPermissionRequestHandler` on `persist:stremio`
  (src/main/index.ts). These fixed an earlier always-muted issue; the current
  problem is intermittent, so it's something else.

## Remaining hypotheses (need one instrumented repro to discriminate)
1. **Player element muted / volume 0** (client state) → fix: force-unmute on
   play via executeJavaScript.
2. **Audio rendition dropped at load**: hls.js gives up on the alternate-audio
   track when its first segments time out, then plays video-only permanently.
   Supporting evidence: earlier `[stremio-net]` logs showed
   `audio0/segment….m4s ERR_ABORTED 10002ms` (10s player timeout) during the
   slow-loading investigation. Coin-flip per restart matches warm-up timing
   variance. → fix: attack audio warm-up latency server-side.
3. **Decode fine, output routing broken** (least likely) → different hunt.

## Instrumentation already in place (src/main/index.ts, STREMIO_DEBUG=1)
Run `npm run dev:debug`, play a silent video ~30s, read the terminal:
- `[stremio-audio] {...}` every 5s from inside the webview:
  - `muted: true` / `volume: 0` → hypothesis 1
  - `aBytes` stays 0 while `vBytes` grows → hypothesis 2 (track never in MSE)
  - `aBytes` grows while silent → hypothesis 3
- `[stremio-net]` lines: watch for `audio0` playlist/segment errors/timeouts.

## Related observation (2026-07-05): "Error occurred when Decoding" mid-playback
Separate failure mode, captured with the probe. Healthy playback (aBytes/vBytes
growing, ~100ms segment serves) → sudden fatal decode error ~38min in → player
tears the element down; probe then shows `paused:true t:0 readyState:0
vBytes:0 aBytes:0` (all-zero = element reset, NOT the silent-audio symptom).
Video track is copied H264, so this is Chromium's decoder rejecting the source
bitstream at that point (likely corrupt torrent piece or unusual encode; mpv in
native Stremio tolerates these). MITIGATED in two stages: (1) StremioPane injects a recovery script
(DECODE_RECOVERY_SCRIPT) — on fatal video error mid-playback it reloads the
player and seeks back to the death position, capped at 3 recoveries per 10 min.
(2) On the 2nd error for a stream, main/index.ts arms a webRequest rewrite that
strips `videoCodecs` from that stream's hlsv2 playlist requests — the server
then RE-ENCODEs the video track (ffmpeg tolerates the bad bitstream), which
prevents further decode errors on that stream at a quality/CPU cost. Bonus: this session proves the audio pipeline healthy end-to-end
(aBytes growing, unmuted).

## Mitigation shipped (2026-07-06): audio-liveness auto-recovery
Couldn't catch it live — the app pauses Stremio whenever Claude is working, so
any diagnostic runs against a paused player; and the probe is dev-only. So
instead of catching it, we recover from it: StremioPane's injected script now
monitors `webkitAudioDecodedByteCount`. When the video is advancing, unmuted,
volume up, video bytes growing, but audio bytes are stalled for >8s on real
content (duration >90s), it treats the audio track as dead and runs the same
reload+seek recovery as decode errors (which also re-negotiates the stream and
can escalate to a transcoded AAC audio rendition). Shared 3-per-10min cap.
Events log `[ws-audio-dead] …`; the main process mirrors both recovery lines to
the macOS unified log as `[stremio-recovery] …`, so on an INSTALLED build they
can be read after the fact with:
  `log show --last 30m --predicate 'processImagePath CONTAINS "WorkStream"' --style compact | grep stremio-recovery`
That capture (does aBytes stay 0? was it muted? did recovery fire?) is the next
data point if the auto-recovery doesn't fully solve it.

## When it reproduces
Capture the `[stremio-audio]` and `[stremio-net] …audio0…` lines and decide by
the table above. Delete this file once fixed.
