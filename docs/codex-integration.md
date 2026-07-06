# Codex integration — research & design map

Research date: 2026-07-06 (repo read at openai/codex `be33f80b`, docs as published).
Goal: a **Codex tab** in the coding group, powered by the open `codex app-server`
protocol, replicating the Codex desktop app's UX where it earns its keep.

## Verdict up front

- The **app-server protocol is the official, intended path** for rich clients —
  it powers OpenAI's own CLI TUI, VS Code/JetBrains/Xcode extensions, web app,
  and the desktop app. OpenAI tried MCP for this and abandoned it.
- The desktop app's **UI is proprietary** — nothing to borrow. Its *data* is
  all protocol, though; several signature features (diff pane!) are trivially
  fed by protocol events.
- **License is clean**: repo, npm packages, binary — all Apache-2.0. We may
  bundle the binary or require `brew install --cask codex` / `npm i -g @openai/codex`.
- The `@openai/codex-sdk` npm package wraps `codex exec` (one-shot turns, no
  interactive approvals, no steering) — **wrong tool for a cockpit; we speak
  the app-server protocol directly.**
- Architecture maps almost 1:1 onto our existing Claude runner: long-lived
  process per conversation, streamed deltas, server-initiated approval
  requests, shared on-disk session store (`~/.codex` ≙ `~/.claude`).

## 1. Protocol essentials

- Spawn: `codex app-server` (default stdio). Wire = newline-delimited JSON-RPC
  2.0 **without** the `"jsonrpc"` field: `{id, method, params?}` requests,
  `{method, params?}` notifications, `{id, result|error}` responses.
- Handshake: exactly one `initialize` (send `clientInfo {name:"workstream",...}`,
  `capabilities {experimentalApi?, optOutNotificationMethods?}`) → then the
  `initialized` notification. Everything else first is rejected.
- Backpressure: JSON-RPC error `-32001` "Server overloaded; retry later" —
  retry with backoff.
- Typed bindings: `codex app-server generate-ts --out <dir>` generates
  TypeScript types **from the installed binary**, guaranteed in sync. Use this
  in a build step rather than hand-writing protocol types.
- Stability: stable surface is backward-compatible by design; anything
  experimental is gated behind `capabilities.experimentalApi` (avoid in v1).

### Core lifecycle (the happy path we implement)

```
spawn codex app-server (stdio)
→ initialize + initialized
→ account/read                      # null → run login flow (§4)
→ thread/start {cwd, model, approvalPolicy, sandbox}   # or thread/resume {threadId}
→ turn/start {threadId, input:[{type:"text",text}]}
→ stream:  item/started → item/*/delta → item/completed
           turn/diff/updated        # aggregated unified diff (feeds diff pane)
           turn/plan/updated        # plan steps with statuses
           thread/tokenUsage/updated
→ answer server-requests:
           item/commandExecution/requestApproval → {decision}
           item/fileChange/requestApproval       → {decision}
           tool/requestUserInput                 → {answers}   # AskUserQuestion analog
→ turn/completed {status: completed|interrupted|failed}
```

- Mid-turn: `turn/steer {threadId, input, expectedTurnId}` — **true steering**
  (Claude CLI queues to next turn; Codex injects into the live one).
- Interrupt: `turn/interrupt` → `turn/completed {status:"interrupted"}` (≙ Esc).
- Approval decisions: `accept | acceptForSession | decline | cancel`
  (acceptForSession ≙ our "Allow always"; cancel also interrupts the turn).
- Item types to render: `userMessage, agentMessage, reasoning, plan,
  commandExecution (with commandActions + outputDelta), fileChange (path/kind/
  diff per file), mcpToolCall, webSearch, imageView, enteredReviewMode,
  exitedReviewMode, contextCompaction`.
- Caveat: `turn/started`/`turn/completed` carry an empty `items` array today —
  rely on `item/*` notifications (README-documented bug).
- Errors: turn failures carry `codexErrorInfo` (`ContextWindowExceeded`,
  `UsageLimitExceeded`, `Unauthorized`, `SandboxError`, …) — map to friendly
  banners.

### Thread management (all protocol, no file parsing needed)

`thread/list {cwd?, searchTerm?, archived?, cursor}` · `thread/read` ·
`thread/resume` · `thread/fork` · `thread/archive|unarchive|delete` ·
`thread/name/set` · `thread/compact/start` (≙ /compact) ·
`thread/tokenUsage/updated` (≙ /context data) · `model/list` (models + their
`supportedReasoningEfforts` — build the settings bar from this, don't hardcode).

## 2. Mapping onto WorkStream's architecture

| WorkStream concept (Claude) | Codex equivalent |
|---|---|
| `query()` streaming session | spawned `codex app-server` + `thread/start\|resume` |
| `sendMessage` push (queued next turn) | `turn/start` when idle, `turn/steer` mid-turn |
| `cancelRun` (interrupt) | `turn/interrupt` |
| `endRun` | `thread/unsubscribe` + kill process (or keep one shared server) |
| `canUseTool` permission → `needsInput` | `item/commandExecution/requestApproval`, `item/fileChange/requestApproval` |
| AskUserQuestion | `tool/requestUserInput` |
| `delta` events | `item/agentMessage/delta` |
| thinking parts | `item/reasoning/summaryTextDelta` |
| tool chips | `commandExecution` / `fileChange` / `mcpToolCall` items (richer: live output deltas, parsed `commandActions`) |
| `completed` (turn end) | `turn/completed` |
| task_started/notification (bg tasks) | `thread/backgroundTerminals/*` [E] — defer |
| `getContextUsage` | `thread/tokenUsage/updated` (pushed, includes `modelContextWindow`) |
| sessions from `~/.claude` JSONL | threads from `thread/list` (rollout JSONL at `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, sqlite metadata — prefer RPC over raw files) |
| `/compact` | `thread/compact/start` |
| plan mode / ExitPlanMode review | closest: `review/start` + `turn/plan/updated`; not the same concept — design separately |
| model/effort settings | `model/list` → per-turn `model` + `effort` overrides (sticky per thread) |
| permission mode | `approvalPolicy` (`untrusted\|on-request\|on-failure\|never` — **kebab-case on the wire**, verified) × `sandboxPolicy` (`readOnly\|workspaceWrite\|dangerFullAccess` — **camelCase**, verified; the two enums differ in casing) — richer than Claude's, needs its own selector UI |

**Process model decision**: one `codex app-server` process can host many
threads (they're multiplexed; threads auto-unload after 30 idle minutes and
emit `thread/closed`). One shared app-server process, threads created/resumed
per conversation. This differs from the per-conversation Claude query and is
*simpler*.

**Process hygiene (hard requirement)**: the server is **lazy** — spawned only
when the Codex tab is first opened, never at app startup. Killed when the
user disables the Codex tab in settings, and reaped by an idle timeout when
no thread has been active for a while. A Claude-only user must never have a
codex process running. (Contrast with the Stremio server, which is
intentionally eager because the webview needs it warm.) Settings gets a
coding-tabs toggle (Claude / Codex on-off) mirroring the entertainment-tabs
toggles.

**Renderer reuse**: `RunEvent` stays the lingua franca. A new
`src/main/codex/runner.ts` translates protocol traffic → the same `RunEvent`
stream (plus a few new event types: `diffUpdated`, `planUpdated`,
`tokenUsage`). The cockpit components (Transcript, Composer, InputPanel,
SessionSidebar, watchdog) are reused with a backend switch; Codex-specific
chrome (settings bar options, diff pane) is per-backend.

## 3. Replicating the desktop app's UX

Verified feature → source mapping:

| App feature | Protocol or app-side? | Our plan |
|---|---|---|
| Threads sidebar (rename/archive/fork) | Protocol | v1 |
| Streaming transcript + reasoning | Protocol | v1 |
| Approval modals (scoped grants) | Protocol | v1 (reuse InputPanel) |
| **Diff review pane** | **Protocol emits the diff** (`turn/diff/updated`, per-file `fileChange.changes[].diff`); stage/commit/push buttons are plain git, app-side | v2 — our marquee addition |
| Inline diff comments → Codex addresses them | App-side UI; serialized into `turn/steer`/`turn/start` input | v2/v3 |
| Thread modes: Local | Protocol (`cwd`) | v1 |
| Thread modes: **Worktree** | App-side orchestration (`git worktree add` under `~/.codex/worktrees`, thread↔worktree bookkeeping, retention 15) | v3 |
| Thread modes: Cloud | ChatGPT backend — **not replicable** | skip |
| Automations (scheduled prompts, Triage inbox) | **App-only, local** ("if you close the App, automations do not run") — a cron + `thread/resume`+`turn/start` loop | v3/v4 |
| Integrated terminal (Cmd+J) | Protocol (`command/exec` PTY family, `thread/shellCommand`) | later |
| Skills picker | Protocol (`skills/list`) | later |
| Artifact viewer / in-app browser | App-only rendering (we have our own Browser tab) | skip/reuse ours |
| Computer use ("Appshots") | App-only + OS permissions | skip |
| Voice dictation | App-side (protocol has experimental realtime) | skip |
| Phone remote control | ChatGPT backend pairing | skip |

**Minimum lovable version (v1)** ≈ 70% of the app's perceived value:
threads sidebar + streaming transcript + approvals + interrupt + steer +
model/effort/sandbox settings + token meter. **v2 adds the diff pane** —
which the protocol makes cheap and is the app's signature UX.

## 4. Auth

Fully delegated to the harness — we never touch tokens:
- `account/read` → current auth (`apiKey | chatgpt | ...`, planType, email)
- `account/login/start {type:"chatgpt"}` → `{authUrl}` — open in system
  browser; app-server hosts the localhost callback; await
  `account/login/completed` + `account/updated`
- API-key alternative: `account/login/start {type:"apiKey", apiKey}`
- Requires ChatGPT Plus/Pro/Business/Edu/Enterprise or platform API key
- Credentials live in `~/.codex/auth.json` (or keyring) — shared with CLI/app
- Rate limits: `account/rateLimits/read` + pushed updates (surfaced in UI later)

## 5. Distribution

- v1: require `codex` on PATH (`brew install --cask codex` or
  `npm i -g @openai/codex`), detect & show install instructions (same pattern
  as Stremio's missing-binaries overlay). Locate via `which codex` +
  common paths.
- Later option: bundle platform binary via npm `@openai/codex-darwin-arm64`
  (Apache-2.0 permits) — mirrors the Agent SDK's bundled CLI approach.
- Version cadence is fast (stable every few days). Generate protocol types at
  build time from a pinned version; the protocol's backward-compat guarantee
  covers drift.

## 6. Risks / open questions

- **Protocol is young** (public since ~Feb 2026); stable core is
  backward-compatible by promise, but expect additive churn. Pin + regenerate
  types deliberately.
- `turn/started|completed` empty-items quirk — code against `item/*` only.
- Background terminals & several niceties are experimental-gated — v1 sticks
  to the stable surface.
- Sandbox/approval matrix is richer than Claude's — UI must not pretend
  they're the same; needs its own two selectors (approval policy × sandbox).
- Cross-surface history visibility has upstream rough edges (their own app
  doesn't list CLI sessions — issue #21079); `thread/list` filters by `cwd`
  which fits our project-scoped sidebar.
- Watchdog semantics: Codex has no direct `task_started` analog in stable
  surface; v1 watchdog can key off turn duration instead.

## 7. Phased plan

1. **Phase 0 — plumbing**: codex binary detection; JSONL JSON-RPC client
   (spawn, framing, request/response correlation, server-request dispatch);
   `generate-ts` types in build; auth flow.
2. **Phase 1 — Codex tab MVP**: coding-tabs group gets "Codex"; thread
   sidebar (`thread/list` by cwd); transcript from `item/*` events mapped to
   `RunEvent`; composer with `turn/start`/`turn/steer`; approvals via
   InputPanel; interrupt; model/effort from `model/list`; approval-policy +
   sandbox selectors; token-usage meter; entertainment-tab gating hooks into
   Codex runs like Claude runs.
3. **Phase 2 — diff pane**: right-hand pane rendering `turn/diff/updated` +
   per-file `fileChange` items; stage/commit/push via plain git in main.
4. **Phase 3 — worktree mode + inline diff comments**: `git worktree add`
   orchestration with thread↔worktree bookkeeping; line-anchored comments
   serialized into turn input.
5. **Phase 4 — automations**: local scheduler → `thread/resume` +
   `turn/start`, triage-style inbox in the sidebar.

## Sources

- github.com/openai/codex — `codex-rs/app-server/README.md`,
  `codex-rs/app-server-protocol/src/**` (read at SHA `be33f80b`)
- developers.openai.com/codex/{app-server,app,app/features,app/worktrees,
  app/automations,app/review,cli,sdk,auth,config-reference}
- openai.com/index/unlocking-the-codex-harness,
  openai.com/index/introducing-the-codex-app
- infoq.com/news/2026/02/opanai-codex-app-server
- npm: @openai/codex, @openai/codex-sdk (Apache-2.0; SDK wraps `codex exec`)
