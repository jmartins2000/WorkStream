/**
 * Pure helpers for decoding Claude Code's on-disk session format.
 *
 * Claude Code stores sessions as newline-delimited JSON (JSONL) under
 *   ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
 * where <encoded-cwd> is the absolute working directory with path separators
 * and dots replaced by dashes. Each line is one transcript entry.
 *
 * The format is not a stable public contract, so every helper here is
 * defensive: unknown shapes degrade gracefully rather than throwing.
 */

import type { MessageRole, SessionSummary, TranscriptMessage } from '../../shared/types.js'

/**
 * Decode an encoded project directory name back into a best-effort absolute
 * path. Claude Code replaces both '/' and '.' with '-', which is lossy, so we
 * cannot perfectly recover the original — we reconstruct a plausible POSIX
 * path. Callers that have a real `cwd` from inside a transcript should prefer
 * that over this reconstruction.
 */
export function decodeProjectDir(dirName: string): string {
  if (!dirName) return ''
  // A leading dash represents the leading '/' of an absolute path.
  const withRoot = dirName.startsWith('-') ? dirName.slice(1) : dirName
  return '/' + withRoot.replace(/-/g, '/')
}

/** Parse a timestamp that may be an ISO string or epoch ms into epoch ms. */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isNaN(ms) ? null : ms
  }
  return null
}

/** True for plain objects (not arrays, not null). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Extract displayable plain text from a message `content` field, which may be a
 * bare string or an array of content blocks (text / tool_use / tool_result).
 */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block)
      continue
    }
    if (!isRecord(block)) continue
    const blockType = block.type
    if (blockType === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    } else if (blockType === 'tool_use') {
      const name = typeof block.name === 'string' ? block.name : 'tool'
      parts.push(`[tool: ${name}]`)
    } else if (blockType === 'tool_result') {
      parts.push(extractText(block.content))
    } else if (blockType === 'thinking' && typeof block.thinking === 'string') {
      // Skip thinking blocks in the default view but keep a marker.
      parts.push('')
    }
  }
  return parts.join('\n').trim()
}

/** Map a raw entry to one of our display roles. */
function classifyRole(entry: Record<string, unknown>): MessageRole {
  const type = typeof entry.type === 'string' ? entry.type : ''
  if (type === 'user') return 'user'
  if (type === 'assistant') return 'assistant'
  if (type === 'system' || type === 'summary') return 'system'
  // Fall back to the nested message role when the outer type is unknown.
  const message = isRecord(entry.message) ? entry.message : undefined
  const role = message && typeof message.role === 'string' ? message.role : ''
  if (role === 'user') return 'user'
  if (role === 'assistant') return 'assistant'
  return 'system'
}

/** Pull the content out of an entry, whether nested under `message` or inline. */
function entryContent(entry: Record<string, unknown>): unknown {
  if (isRecord(entry.message) && 'content' in entry.message) {
    return entry.message.content
  }
  if ('content' in entry) return entry.content
  if (typeof entry.summary === 'string') return entry.summary
  return ''
}

/**
 * Convert one parsed JSONL entry into a TranscriptMessage, or null if it has no
 * displayable text (e.g. pure tool plumbing we choose to hide).
 */
export function entryToMessage(entry: unknown, index: number): TranscriptMessage | null {
  if (!isRecord(entry)) return null
  const role = classifyRole(entry)
  const text = extractText(entryContent(entry))
  if (!text) return null
  const id =
    (typeof entry.uuid === 'string' && entry.uuid) ||
    (typeof entry.id === 'string' && entry.id) ||
    `entry-${index}`
  return {
    id,
    role,
    text,
    timestamp: parseTimestamp(entry.timestamp)
  }
}

/** Parse the raw text of a .jsonl file into displayable transcript messages. */
export function parseTranscript(raw: string): TranscriptMessage[] {
  const messages: TranscriptMessage[] = []
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue // tolerate truncated / partially written lines
    }
    const message = entryToMessage(parsed, i)
    if (message) messages.push(message)
  }
  return messages
}

/** The earliest `cwd` recorded anywhere in a session's raw entries, if any. */
export function extractCwd(raw: string): string | null {
  const lines = raw.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (isRecord(parsed) && typeof parsed.cwd === 'string' && parsed.cwd) {
        return parsed.cwd
      }
    } catch {
      continue
    }
  }
  return null
}

/**
 * Build a SessionSummary from a session's raw transcript text.
 * `fallbackCwd` is used when no `cwd` is embedded in the transcript.
 */
export function summarizeSession(args: {
  sessionId: string
  projectDir: string
  raw: string
  fallbackCwd: string
}): SessionSummary {
  const { sessionId, projectDir, raw, fallbackCwd } = args
  const messages = parseTranscript(raw)
  const firstUser = messages.find((m) => m.role === 'user')
  const timestamps = messages
    .map((m) => m.timestamp)
    .filter((t): t is number => t !== null)
  const createdAt = timestamps.length ? Math.min(...timestamps) : null
  const lastActivity = timestamps.length ? Math.max(...timestamps) : null
  return {
    sessionId,
    projectDir,
    cwd: extractCwd(raw) ?? fallbackCwd,
    title: truncateTitle(firstUser?.text ?? '(no prompt)'),
    createdAt,
    lastActivity,
    messageCount: messages.length
  }
}

/** Collapse whitespace and clip a prompt to a one-line title. */
export function truncateTitle(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine || '(no prompt)'
  return oneLine.slice(0, max - 1).trimEnd() + '…'
}
