/**
 * Filesystem access to the shared Claude Code session store.
 *
 * All sessions live under <config>/projects, where <config> is
 * $CLAUDE_CONFIG_DIR if set, otherwise ~/.claude. Reading from this same
 * directory is what makes sessions in this app identical to the ones in the
 * terminal CLI.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProjectSummary, SessionSummary, TranscriptMessage } from '../../shared/types.js'
import { decodeProjectDir, parseTranscript, summarizeSession } from './transcript.js'

/** Absolute path to the Claude config directory. */
export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
}

/** Absolute path to the projects directory holding all session transcripts. */
export function projectsDir(): string {
  return join(claudeConfigDir(), 'projects')
}

async function safeReaddir(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

/** List every project directory, newest activity first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const root = projectsDir()
  const entries = await safeReaddir(root)
  const projects: ProjectSummary[] = []

  for (const dirName of entries) {
    const dirPath = join(root, dirName)
    let isDir = false
    try {
      isDir = (await stat(dirPath)).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) continue

    const files = (await safeReaddir(dirPath)).filter((f) => f.endsWith('.jsonl'))
    if (files.length === 0) continue

    let lastActivity: number | null = null
    for (const file of files) {
      try {
        const mtime = (await stat(join(dirPath, file))).mtimeMs
        if (lastActivity === null || mtime > lastActivity) lastActivity = mtime
      } catch {
        // ignore unreadable files
      }
    }

    projects.push({
      dirName,
      cwd: decodeProjectDir(dirName),
      sessionCount: files.length,
      lastActivity
    })
  }

  projects.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0))
  return projects
}

/** List sessions within a single project directory, newest first. */
export async function listSessions(projectDir: string): Promise<SessionSummary[]> {
  const dirPath = join(projectsDir(), projectDir)
  const files = (await safeReaddir(dirPath)).filter((f) => f.endsWith('.jsonl'))
  const fallbackCwd = decodeProjectDir(projectDir)
  const sessions: SessionSummary[] = []

  for (const file of files) {
    const sessionId = file.replace(/\.jsonl$/, '')
    let raw = ''
    try {
      raw = await readFile(join(dirPath, file), 'utf8')
    } catch {
      continue
    }
    sessions.push(summarizeSession({ sessionId, projectDir, raw, fallbackCwd }))
  }

  sessions.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0))
  return sessions
}

/** Read and parse the full transcript for one session. */
export async function getMessages(
  projectDir: string,
  sessionId: string
): Promise<TranscriptMessage[]> {
  const filePath = join(projectsDir(), projectDir, `${sessionId}.jsonl`)
  let raw = ''
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return []
  }
  return parseTranscript(raw)
}
