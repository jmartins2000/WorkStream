import { describe, expect, it } from 'vitest'
import {
  decodeProjectDir,
  entryToMessage,
  extractText,
  extractCwd,
  parseTimestamp,
  parseTranscript,
  summarizeSession,
  truncateTitle
} from './transcript.js'

describe('decodeProjectDir', () => {
  it('reconstructs an absolute path from an encoded dir', () => {
    expect(decodeProjectDir('-home-user-ClaudeCode-Stremio')).toBe(
      '/home/user/ClaudeCode/Stremio'
    )
  })

  it('handles an empty string', () => {
    expect(decodeProjectDir('')).toBe('')
  })
})

describe('parseTimestamp', () => {
  it('parses ISO strings', () => {
    expect(parseTimestamp('2026-01-01T00:00:00.000Z')).toBe(Date.parse('2026-01-01T00:00:00.000Z'))
  })

  it('passes through epoch numbers', () => {
    expect(parseTimestamp(1700000000000)).toBe(1700000000000)
  })

  it('returns null for junk', () => {
    expect(parseTimestamp('not-a-date')).toBeNull()
    expect(parseTimestamp(undefined)).toBeNull()
    expect(parseTimestamp({})).toBeNull()
  })
})

describe('extractText', () => {
  it('returns plain string content unchanged', () => {
    expect(extractText('hello')).toBe('hello')
  })

  it('joins text blocks and labels tool use', () => {
    const content = [
      { type: 'text', text: 'first' },
      { type: 'tool_use', name: 'Bash', input: {} },
      { type: 'text', text: 'second' }
    ]
    expect(extractText(content)).toBe('first\n[tool: Bash]\nsecond')
  })

  it('recurses into tool_result content', () => {
    const content = [{ type: 'tool_result', content: [{ type: 'text', text: 'output' }] }]
    expect(extractText(content)).toBe('output')
  })

  it('returns empty string for unknown shapes', () => {
    expect(extractText(null)).toBe('')
    expect(extractText(42)).toBe('')
  })
})

describe('entryToMessage', () => {
  it('maps an assistant entry with nested content', () => {
    const entry = {
      type: 'assistant',
      uuid: 'abc',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] }
    }
    const msg = entryToMessage(entry, 0)
    expect(msg).toEqual({
      id: 'abc',
      role: 'assistant',
      text: 'hi there',
      timestamp: Date.parse('2026-01-01T00:00:00.000Z')
    })
  })

  it('falls back to nested role when outer type is unknown', () => {
    const entry = { message: { role: 'user', content: 'a question' } }
    expect(entryToMessage(entry, 1)?.role).toBe('user')
  })

  it('synthesizes an id when none is present', () => {
    const entry = { type: 'user', message: { role: 'user', content: 'x' } }
    expect(entryToMessage(entry, 7)?.id).toBe('entry-7')
  })

  it('returns null for entries with no displayable text', () => {
    expect(entryToMessage({ type: 'assistant', message: { content: [] } }, 0)).toBeNull()
    expect(entryToMessage('garbage', 0)).toBeNull()
  })
})

describe('parseTranscript', () => {
  const raw = [
    JSON.stringify({
      type: 'user',
      uuid: 'u1',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: '/work/proj',
      message: { role: 'user', content: 'Do the thing' }
    }),
    '', // blank line tolerated
    'this is not json', // malformed line tolerated
    JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-01-01T00:01:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Done' }] }
    })
  ].join('\n')

  it('parses valid lines and skips invalid ones', () => {
    const messages = parseTranscript(raw)
    expect(messages.map((m) => m.text)).toEqual(['Do the thing', 'Done'])
  })

  it('extracts the embedded cwd', () => {
    expect(extractCwd(raw)).toBe('/work/proj')
  })

  it('summarizes a session', () => {
    const summary = summarizeSession({
      sessionId: 's1',
      projectDir: '-work-proj',
      raw,
      fallbackCwd: '/fallback'
    })
    expect(summary).toMatchObject({
      sessionId: 's1',
      projectDir: '-work-proj',
      cwd: '/work/proj',
      title: 'Do the thing',
      messageCount: 2
    })
    expect(summary.createdAt).toBe(Date.parse('2026-01-01T00:00:00.000Z'))
    expect(summary.lastActivity).toBe(Date.parse('2026-01-01T00:01:00.000Z'))
  })

  it('uses the fallback cwd when none is embedded', () => {
    const noCwd = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'hi' }
    })
    const summary = summarizeSession({
      sessionId: 's2',
      projectDir: 'd',
      raw: noCwd,
      fallbackCwd: '/fallback'
    })
    expect(summary.cwd).toBe('/fallback')
  })
})

describe('truncateTitle', () => {
  it('collapses whitespace', () => {
    expect(truncateTitle('a\n  b   c')).toBe('a b c')
  })

  it('clips long titles with an ellipsis', () => {
    const title = truncateTitle('x'.repeat(200), 10)
    expect(title).toHaveLength(10)
    expect(title.endsWith('…')).toBe(true)
  })

  it('falls back for empty input', () => {
    expect(truncateTitle('   ')).toBe('(no prompt)')
  })
})
