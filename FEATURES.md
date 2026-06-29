# Claude Code parity roadmap

Tracking how close the in-app cockpit is to the full Claude Code CLI. Goal:
everything from the CLI that makes sense in a desktop GUI, backed by the
Agent SDK. Legend: ✅ done · 🟡 partial · ⬜ planned · 🚫 not applicable to a GUI.

## Conversation & transcript
- ✅ Send prompt, stream response (token-by-token)
- ✅ Markdown rendering (code blocks, lists, tables, links)
- ✅ Tool calls shown as compact chips
- ✅ Thinking blocks (collapsible)
- ✅ Noise curation (task-notifications, command echoes, caveats hidden)
- 🟡 Tool result / output display (expandable in history; live runs pending)
- ⬜ Diffs for Edit/Write (syntax-highlighted)
- ✅ Copy message to clipboard
- ⬜ Image paste / attach (needs streaming-input mode)

## Sessions
- ✅ List projects & sessions from the shared `~/.claude` store
- ✅ Resume a session, real (/rename) titles, git branch
- ✅ Rename session (`/rename`)
- ✅ Delete session
- ✅ Fork / branch session (`/branch`, `forkSession`)
- ✅ Export transcript (`/export`) to markdown
- ⬜ Search sessions / command history
- ⬜ New-session naming

## Running & control
- ✅ Slash-command autocomplete (from session `init`)
- ✅ Interactive questions (AskUserQuestion) + answers
- ✅ Tool permission prompts (allow once / always / deny)
- ✅ Cancel / interrupt a run
- ✅ Model selector (`/model`: default, opus, sonnet, haiku, fable, opusplan)
- ✅ Effort / thinking level (`/effort`: low…max)
- ✅ Permission mode selector (default, acceptEdits, plan, bypassPermissions)
- ✅ Streaming-input session — the runner stays alive across turns/results
- ✅ Background task auto-continue: Bash `run_in_background` keeps the session
  open; the agent resumes and reports when it finishes, and pause-on-finish
  re-fires (pulls you back from Stremio). Shows a "Background task running…" status.
- ⬜ Mid-run model / mode switch (SDK `setModel`/`setPermissionMode` now reachable)
- ⬜ Message queuing while running (streaming-input mode)
- ⬜ Plan mode workflow (present plan → approve → execute)
- ⬜ Background tasks panel (`/tasks`) — list/controls view; auto-continue already works

## Context & cost
- ✅ Per-run cost + token usage (`/cost`, `/usage`) from the result message
- ⬜ Context window usage meter (`/context`)
- ⬜ Compact conversation (`/compact`)
- ⬜ Memory / CLAUDE.md viewing & editing (`/memory`, `#`)

## Tools & integrations
- ✅ All built-in tools run via the SDK (Bash, Read, Edit, Write, Grep, …)
- ✅ Read-only tools auto-allowed to cut prompt noise
- ⬜ Todo / task list panel (TaskCreate/TaskList)
- ⬜ MCP servers status & toggle (`/mcp`)
- ⬜ Subagents view (`/agents`, Task tool)
- ⬜ Custom skills / commands surfaced explicitly (`/skills`)
- ⬜ Hooks (settings-driven)

## Config & UX
- ⬜ Settings panel (`/config`: theme, defaults, output style)
- ⬜ Permission rules editor (`/permissions`)
- ⬜ Checkpoints / rewind (`/rewind`)
- 🟡 Keyboard shortcuts (Esc interrupts a run; more planned)
- 🚫 Terminal-only: fullscreen TUI, vim mode, status line, voice, IDE
  integrations, `/teleport`, `/desktop`, color/theme of the prompt bar

## Notes
- The runner now uses the SDK's **streaming-input mode** (async-generator
  prompt) and keeps one live session per conversation, which is what unlocked
  background-task auto-continuation. The remaining "advanced control" items
  (mid-run switches, queuing, images, plan mode) build on this same foundation —
  the SDK control methods (`setModel`, `setPermissionMode`, `interrupt`,
  priority queuing on input messages) are now reachable.
- This file is the source of truth for parity progress — update it as items land.
