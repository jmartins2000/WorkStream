/**
 * Pure helpers for translating between the SDK's tool-permission surface and
 * the app's interaction model (multiple-choice questions and approvals).
 * Kept free of SDK/Node imports so it is trivially unit-testable.
 */

import type { UiQuestion } from '../../shared/types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Extract renderable questions from an AskUserQuestion tool input. Malformed or
 * optionless questions are dropped rather than throwing.
 */
export function parseQuestions(input: unknown): UiQuestion[] {
  if (!isRecord(input) || !Array.isArray(input.questions)) return []
  const result: UiQuestion[] = []
  for (const q of input.questions) {
    if (!isRecord(q)) continue
    const question = typeof q.question === 'string' ? q.question : ''
    const header = typeof q.header === 'string' && q.header ? q.header : 'Question'
    const multiSelect = q.multiSelect === true
    const options = Array.isArray(q.options)
      ? q.options.reduce<UiQuestion['options']>((acc, o) => {
          if (isRecord(o) && typeof o.label === 'string') {
            acc.push({
              label: o.label,
              description: typeof o.description === 'string' ? o.description : ''
            })
          }
          return acc
        }, [])
      : []
    if (!question || options.length === 0) continue
    result.push({ question, header, multiSelect, options })
  }
  return result
}

/**
 * Build the `updatedInput` for an answered AskUserQuestion: the original input
 * with the user's `answers` map merged in (question text -> chosen label(s)).
 */
export function withAnswers(
  originalInput: unknown,
  answers: Record<string, string>
): Record<string, unknown> {
  const base = isRecord(originalInput) ? originalInput : {}
  return { ...base, answers }
}

/** A short label for a tool, used in the permission prompt UI. */
export function describeTool(toolName: string, detail: string): string {
  return detail ? `${toolName}: ${detail}` : toolName
}
