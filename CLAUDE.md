# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A macOS Electron app that runs **Claude Code** sessions in the background (via the Agent SDK) while you watch **Stremio**, then pauses the video and surfaces the Claude cockpit the moment a run finishes or needs you. `FEATURES.md` is the source of truth for CLI-parity progress — update it as items land.

## Commands

```bash
npm install            # uses legacy-peer-deps (see .npmrc); postinstall fetches the Stremio server binaries
npm run dev            # electron-vite dev, hot reload — must run on a machine with a display
npm run typecheck      # tsc for BOTH node and web configs (run after non-trivial changes)
npm test               # vitest run (unit + filesystem integration)
npm run test:watch     # vitest watch
npm run lint           # eslint . --ext .ts,.tsx
npm run build          # typecheck + electron-vite build → ./out
npm run package        # build + electron-builder --mac → ./release
npm run fetch:stremio  # re-fetch resources/stremio-service/ (binaries; see below)
```

Run a single test: `npx vitest run src/main/claude/transcript.test.ts` (or `-t "<name>"` for a single case).

Dev env vars: `OPEN_DEVTOOLS=1` opens detached DevTools; `CLAUDE_CONFIG_DIR` overrides the `~/.claude` store the app reads/writes.

This is a GUI app — it cannot render headless. To verify behavior, run `npm run dev` on the Mac.

## Architecture

Three Electron layers, each a separate electron-vite build target, all sharing `src/shared/types.ts` (kept free of Node/DOM imports so every layer can import it):

- **`src/main/`** — Node main process. `index.ts` creates the window (webview tag enabled for Stremio); `ipc.ts` registers handlers; `claude/` is the integration core.
- **`src/preload/index.ts`** — `contextBridge` exposing the typed `ClaudeBridge` as `window.claude`. Renderer is sandboxed (`contextIsolation: true`, `nodeIntegration: false`); this is the only main↔renderer surface.
- **`src/renderer/`** — React 19 UI. `App.tsx` toggles between the Claude cockpit and the Stremio `<webview>` (both stay mounted; only visibility toggles, so playback survives).

### The shared session store (key design point)

The app reads and writes the **same** store the Claude Code CLI uses: `<config>/projects/<encoded-dir>/<sessionId>.jsonl` where `<config>` is `$CLAUDE_CONFIG_DIR` or `~/.claude`. A run started here is resumable from the terminal and vice-versa. Consequences:

- Session **list/read** is direct filesystem access (`claude/sessions.ts` + `claude/transcript.ts` JSONL parsing).
- Session **mutations** (rename/delete/fork) delegate to the Agent SDK's `renameSession`/`deleteSession`/`forkSession`, which take a `{ dir: cwd }`.
- The SDK is the source of truth for display **titles** (`/rename` custom titles, summaries); raw JSONL doesn't expose them conveniently, so titles come from `sdkListSessions()` with a fallback to the first parsed prompt.
- The encoded project dir name (slashes→dashes) is **lossy** when a real path contains `-` or `.`. Never trust `decodeProjectDir()` for the cwd — read the true cwd from the transcript (`extractCwd`); only fall back to the decoded name.

### Running Claude (`claude/runner.ts`)

`startRun` drives `query()` from `@anthropic-ai/claude-agent-sdk` in **streaming-input mode** and streams `RunEvent`s back to the WebContents that started the run. State lives in module-level `activeRuns`/`pendingInputs` maps keyed by `runId`.

- **One live session per conversation (key design point).** The prompt is an async stream (`makeInputStream`) kept open, so the query stays alive past the first `result`. This is what lets the agent auto-continue when a background task (Bash `run_in_background` / Task) finishes: the SDK yields a `task_notification` and the agent wakes itself, all through the same stream. A `result` ends a **turn** (`completed` event), not the session; the session ends only on `closed`. Follow-up turns go through `sendMessage` (push into the live stream), **not** a new `startRun`. Switching/closing a conversation calls `endRun`. Don't reintroduce single-shot string prompts — that strands background work.
- `cancelRun` calls `query.interrupt()` (ends the current turn, keeps the session); `endRun` is the full teardown (closes the input stream + aborts). Esc in the UI calls `cancel`.
- Permission mode defaults to `'default'` (not bypass) so tool approvals **and** `AskUserQuestion` prompts surface through the `canUseTool` callback. `AUTO_ALLOWED_TOOLS` (Read/Glob/Grep/WebFetch/WebSearch/TodoWrite) are pre-approved to cut prompt noise.
- Mid-run interaction is request/response: `canUseTool` emits a `needsInput` event and `await`s `awaitInput(requestId)`; the renderer replies via `respondInput` → `resolveInput`. Aborting the run rejects pending inputs.
- `includePartialMessages: true` gives token-by-token `delta` events; full `assistant` messages also arrive and replace the streaming buffer. `init` arrives once per turn (including continuations) — slash commands are emitted only on the first.

### Transcript curation (`claude/transcript.ts`)

Pure, unit-tested JSONL helpers. Parsing **drops noise** (task-notifications, command echoes/output, caveats — see `NOISE_TAGS`/`NOISE_PREFIXES`) and flattens entries into `TranscriptMessage` with typed `MessagePart`s (`text` | `tool` | `thinking`). Keep this file pure and test-covered.

### Renderer run lifecycle (`useClaudeRun.ts`)

Owns one logical conversation (transcript, streaming, pending input, status). The `onAttention` callback fires whenever Claude needs the user (finished, error, or `needsInput`) — `App.tsx` wires it to pause the Stremio webview (`executeJavaScript` pausing every `<video>`) and switch to the cockpit. This is the whole "pause-on-finish" mechanism.

### The local Stremio streaming server (`stremio/server.ts`) — key design point

`web.stremio.com` (the embedded webview) is **not self-contained**: it has no torrent/transcoding engine of its own and depends entirely on a companion local server on `127.0.0.1:11470` (the same one Stremio's own desktop app bundles) for resolving and playing every stream. Without it, every title shows "No streams found" / "Video is not supported" — the webview's requests to `127.0.0.1:11470` just get refused.

- **Binaries are fetched, not committed.** `scripts/fetch-stremio-service.mjs` downloads Stremio's official `stremio-service-macos.zip` release (GPLv2; safe to bundle as a subprocess — we don't link against it) and extracts `stremio-runtime` (a custom Node build), `ffmpeg`, `ffprobe`, and `server.js` into `resources/stremio-service/` (gitignored, ~150MB). Runs via `postinstall` and `npm run fetch:stremio`; `electron-builder.yml` bundles the folder as `extraResources` so packaged builds work offline.
- **`server.js` is CommonJS** but has no `package.json` of its own — Node would otherwise walk up to *this* repo's `"type": "module"` and fail with `require is not defined`. The fetch script writes a `{"type": "commonjs"}` marker into `resources/stremio-service/` to pin it. Don't delete that file.
- **Apple Silicon needs Rosetta 2** — the official binaries are x86_64-only. `server.ts` checks for `/Library/Apple/usr/share/rosetta/rosetta`; if missing, status goes to `'rosetta-required'` and the UI offers an install button (`installRosetta()`, a privileged `softwareupdate --install-rosetta` via `osascript`).
- **Spawned once per app launch**, independent of which pane is visible (the webview is always mounted — see above), via `stremio-runtime server.js` with `FFMPEG_BIN`/`FFPROBE_BIN` env vars; killed on `before-quit`. Status (`starting` / `ready` / `missing-binaries` / `rosetta-required` / `installing-rosetta` / `error`) is broadcast over `IPC.stremioServerStatus` to every window; `StremioPane.tsx` overlays the webview until `ready`.

## Conventions

- Adding an IPC method: add the type to `ClaudeBridge` + channel to `IPC` in `src/shared/types.ts`, implement the handler in `src/main/ipc.ts`, and expose it in `src/preload/index.ts`. All three stay in lockstep.
- `RunModel`/`RunEffort`/`RunPermissionMode` are `as const` arrays in `types.ts`; the runner maps them to SDK `Options` (note: `model: 'default'` means leave the SDK option unset).
- ESLint relies on tsc for undefined identifiers (`no-undef` off); unused args must be `_`-prefixed.
