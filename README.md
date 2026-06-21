# ClaudeCode · Stremio

A macOS desktop app that runs **Claude Code** sessions in the background while
you watch **Stremio** — then pauses your video and brings Claude forward the
moment a session finishes.

The idea: fire off a Claude Code task, flip over to Stremio and watch something,
and the app taps you on the shoulder (pauses playback, surfaces the cockpit)
when Claude is done and waiting on you.

## How it works

```
┌─────────────────────────────────────────────┐
│  Electron app (one window)                    │
│                                               │
│  Renderer (React) ── tabs ──┐                 │
│   • Claude cockpit          │                 │
│   • Stremio <webview>       │                 │
│             ↕ IPC (preload bridge)            │
│  Main process (Node)                          │
│   • Claude Agent SDK  → runs / streams        │
│   • reads ~/.claude/projects (shared store)   │
└───────────────────────────────────────────────┘
```

- **Shared sessions.** The app reads and writes the *same* session store the
  Claude Code CLI uses (`~/.claude/projects/<project>/<id>.jsonl`, or
  `$CLAUDE_CONFIG_DIR`). A session you started in the terminal shows up here,
  and runs you start here are resumable from the terminal.
- **Background runs.** Prompts run via the
  [`@anthropic-ai/claude-agent-sdk`](https://code.claude.com/docs/en/agent-sdk)
  in the main process, streaming tokens into the cockpit. Because you're away
  watching, runs use `bypassPermissions` so they don't stall on prompts.
- **Stremio.** The hosted Stremio web app (`web.stremio.com`) is embedded in an
  Electron `<webview>`, so you get the full, maintenance-free Stremio.
- **Pause-on-finish.** When a run completes, the app pauses any playing
  `<video>` in the Stremio webview and switches to the Claude tab.

## Project layout

| Path | What |
|------|------|
| `src/main/` | Electron main process: window, IPC, Claude integration |
| `src/main/claude/transcript.ts` | Pure JSONL parsing helpers (unit-tested) |
| `src/main/claude/sessions.ts` | Reads the `~/.claude` session store |
| `src/main/claude/runner.ts` | Runs/streams Claude via the Agent SDK |
| `src/preload/` | `contextBridge` exposing a typed `window.claude` API |
| `src/renderer/` | React UI (cockpit, Stremio pane, transcript, composer) |
| `src/shared/types.ts` | Types + IPC channel names shared across processes |

## Prerequisites

- **Node.js 22+** (npm ships with it — nothing else to install)
- A working **Claude Code** login (the app reuses your existing `~/.claude`
  credentials and sessions).

## Develop

```bash
npm install
npm run dev     # launches the app with hot reload
```

> Note: this is a desktop GUI app, so it must be run on a machine with a
> display (your Mac). It will not render in a headless environment.

## Quality gates

```bash
npm run typecheck  # tsc for both Node and web configs
npm test           # vitest unit + filesystem integration tests
npm run lint       # eslint
npm run build      # production build into ./out
```

## Package a macOS app

```bash
npm run package    # electron-builder → ./release (.dmg + .zip)
```

Code signing / notarization are configured at release time.

## Status

Early MVP. Working: shared-session browsing, resuming/starting runs with live
streaming, the Stremio pane, and pause-on-finish. Not yet done: completion
notifications outside the window, multiple concurrent runs, and a self-hosted
(forkable) Stremio build option.
