import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getMessages, listProjects, listSessions } from './sessions.js'

/**
 * Exercises the real filesystem layer against a temporary CLAUDE_CONFIG_DIR
 * shaped like a real ~/.claude directory.
 */
describe('sessions (filesystem)', () => {
  let configDir: string
  const prevEnv = process.env.CLAUDE_CONFIG_DIR

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'cc-stremio-'))
    process.env.CLAUDE_CONFIG_DIR = configDir

    const projectDir = join(configDir, 'projects', '-work-demo')
    mkdirSync(projectDir, { recursive: true })

    const transcript = [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-01-01T00:00:00.000Z',
        cwd: '/work/demo',
        message: { role: 'user', content: 'Fix the bug' }
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-01-01T00:05:00.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed it.' }] }
      })
    ].join('\n')
    writeFileSync(join(projectDir, 'session-123.jsonl'), transcript)

    // A non-jsonl file and an empty dir should be ignored.
    writeFileSync(join(projectDir, 'notes.txt'), 'ignore me')
    mkdirSync(join(configDir, 'projects', '-empty-proj'), { recursive: true })
  })

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true })
    if (prevEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevEnv
  })

  it('lists only projects that contain sessions', async () => {
    const projects = await listProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({
      dirName: '-work-demo',
      cwd: '/work/demo',
      sessionCount: 1
    })
    expect(projects[0].lastActivity).toBeTypeOf('number')
  })

  it('lists sessions for a project with parsed summaries', async () => {
    const sessions = await listSessions('-work-demo')
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      sessionId: 'session-123',
      cwd: '/work/demo',
      title: 'Fix the bug',
      messageCount: 2
    })
  })

  it('reads a full transcript by session id', async () => {
    const messages = await getMessages('-work-demo', 'session-123')
    const flattened = messages.map((m) => ({
      role: m.role,
      text: m.parts[0].kind === 'text' ? m.parts[0].text : ''
    }))
    expect(flattened).toEqual([
      { role: 'user', text: 'Fix the bug' },
      { role: 'assistant', text: 'Fixed it.' }
    ])
  })

  it('returns an empty array for an unknown session', async () => {
    expect(await getMessages('-work-demo', 'nope')).toEqual([])
  })
})
