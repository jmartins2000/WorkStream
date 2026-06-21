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
- 🟡 Tool result / output display (currently hidden; planned: expandable)
- ⬜ Diffs for Edit/Write (syntax-highlighted)
- ⬜ Copy message / copy code block
- ⬜ Image paste / attach (needs streaming-input mode)

## Sessions
- ✅ List projects & sessions from the shared `~/.claude` store
- ✅ Resume a session, real (/rename) titles, git branch
- ✅ Rename session (`/rename`)
- ✅ Delete session
- 🟡 Fork / branch session (`/branch`, `forkSession`)
- ⬜ Export transcript (`/export`)
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
- ⬜ Mid-run model / mode switch (needs streaming-input mode)
- ⬜ Message queuing while running (streaming-input mode)
- ⬜ Plan mode workflow (present plan → approve → execute)
- ⬜ Background tasks panel (`/tasks`, Bash run_in_background)

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
- ⬜ Keyboard shortcuts (Esc interrupt, Shift+Tab cycle mode, etc.)
- 🚫 Terminal-only: fullscreen TUI, vim mode, status line, voice, IDE
  integrations, `/teleport`, `/desktop`, color/theme of the prompt bar

## Notes
- Several "advanced control" items (mid-run switches, queuing, images, plan
  mode) all depend on migrating the runner to the SDK's **streaming-input
  mode** (async-generator prompt). That's a planned dedicated wave.
- This file is the source of truth for parity progress — update it as items land.
