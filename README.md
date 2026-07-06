<div align="center">
  <img src="build/icon.png" width="220" alt="WorkStream" />
  <h1>WorkStream</h1>
  <p><strong>Let your coding agents work while you actually enjoy the wait.</strong></p>
  <p>
    Kick off a task in Claude Code or Codex &rarr; flip to Stremio, YouTube, or the web &rarr; get pulled back the moment the agent finishes or needs you.
  </p>
  <p>
    <img src="https://img.shields.io/badge/platform-macOS-lightgray" alt="macOS" />
    <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node.js 22+" />
    <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT" />
  </p>
</div>

---

## Why this exists

Agentic coding tasks take time. A refactor, a test suite, a multi-step research run — you kick it off and then just sit there, switching windows, watching tokens stream by, waiting.

WorkStream changes that flow. It runs **Claude Code** and **Codex** sessions in the background, lets you flip over to watch or browse something, and automatically pauses playback and pulls you back to the cockpit the moment an agent finishes — or needs a decision from you.

You stay in the loop. You just stop wasting the idle time.

## What's inside

Two groups of tabs: **coding agents** you drive, and **entertainment** you're "given" while they work.

### Coding agents

- **Claude cockpit** — start and resume runs, browse past sessions, stream output token-by-token, and answer questions or approve tool calls inline. Shared session store (see below), mid-run steering, plan-mode review, per-conversation model/effort/permission memory, a live context-usage meter, MCP server status and controls, a CLAUDE.md memory editor, `/compact`, transcript export, and optional Remote Control so a session shows up on claude.ai/code.
- **Codex cockpit** — the same idea for OpenAI's Codex, built on its open **app-server protocol** and styled after the Codex desktop app: a threads sidebar grouped by project, a live **diff review pane** rendered from the agent's file changes, inline approvals, plan checklists, and a composer with model / reasoning-effort / access-mode controls. Sign in with your ChatGPT account or an API key. Codex's background server is **lazy** — it only starts when you actually open the tab, and shuts down when idle.

Both agents are toggleable in Settings; run one or both.

### Entertainment

- **Stremio** — full embedded Stremio with its local streaming server bundled, so content actually resolves and plays. Includes tuned torrent-engine limits for faster loading and automatic recovery from mid-stream decode errors.
- **YouTube** — embedded as a persistent tab; playback survives switching away and back. Ads are network-blocked, and in-player ads are muted and fast-forwarded where possible.
- **Browser** — a real in-app browser with an address bar, back/forward, a favorites bar (star the current page, rename bookmarks), right-click menus, and working OAuth pop-ups (Google sign-in and friends).
- **Custom tabs** — add any site as its own tab (e.g. `x.com` named "Twitter"), each with its own persistent login session.
- **Ad blocking** — network-level ad & tracker blocking across YouTube, the browser, and custom tabs (Stremio is never filtered). Toggle in Settings.

The entertainment tabs are **earned**: they unlock while an agent is working, so they're there for the wait, not as a distraction from an empty prompt.

## The magic bit: pause on finish

When an agent needs you — it finished, hit an error, or is asking a question or for tool approval — WorkStream pauses playback across every tab, exits fullscreen, and brings that agent's cockpit forward. Answer or send the next prompt, and you're handed straight back to whatever you were watching.

A **watchdog** covers long-running background work: if a task or subagent runs longer than a threshold you set, WorkStream pulls you back to check on it, where you can snooze the alert, dismiss it, or kill the task.

```
  You                   WorkStream              Agent
   │                        │                     │
   ├─ start a task ────────►│                     │
   │                        ├─ run in background ►│
   ├─ flip to Stremio ─────►│                     │
   │                        │           working...│
   │                        │◄── done ────────────┤
   │◄─ playback pauses ─────┤                     │
   │◄─ cockpit opens ───────┤                     │
   ├─ review + reply ──────►│                     │
   ├─ flip back to Stremio ►│                     │
```

## Shared session stores

WorkStream reads and writes the **same on-disk stores** the agents' own CLIs use:

- **Claude** — the `~/.claude` project store. A session started in WorkStream resumes from the terminal, and vice-versa.
- **Codex** — the `~/.codex` thread store. Threads started in the Codex desktop app or CLI show up here, and threads you start here show up there.

Nothing is locked into WorkStream; it's a window onto the same conversations, not a separate silo.

## Prerequisites

- **macOS** (Apple Silicon or Intel; Stremio streaming requires Rosetta 2 on Apple Silicon — the app offers to install it)
- **Node.js 22+**
- **Claude Code** — the app reuses your existing `~/.claude` login
- **Codex** (optional) — install the [Codex app](https://developers.openai.com/codex/app) or `npm i -g @openai/codex`, and sign in with a ChatGPT (Plus/Pro) account or API key. Only needed if you use the Codex tab.

## Build from source

```bash
git clone https://github.com/jmartins2000/WorkStream.git
cd WorkStream
npm install        # also fetches the bundled Stremio streaming server binaries
npm run dev        # hot-reload dev build (requires a display)
```

```bash
npm run typecheck  # tsc for both Node and renderer configs
npm test           # vitest unit + integration tests
npm run lint       # eslint
npm run build      # production build → ./out
npm run package    # electron-builder → ./release (.dmg + .zip)
```

## Project layout

| Path | What |
|------|------|
| `src/main/claude/` | Claude Agent SDK integration: runner, session store, transcript parser |
| `src/main/codex/` | Codex app-server client: JSON-RPC transport, runner, binary discovery |
| `src/main/stremio/` | Local Stremio streaming server lifecycle |
| `src/main/adblock.ts` | Network-level ad & tracker blocking |
| `src/preload/` | `contextBridge` exposing a typed `window.claude` API |
| `src/renderer/` | React UI — Claude & Codex cockpits, Stremio / YouTube / Browser / custom panes |
| `src/shared/types.ts` | Types and IPC channel names shared across all three processes |
| `docs/` | Design notes (Codex integration map, investigations) |

## License

MIT
