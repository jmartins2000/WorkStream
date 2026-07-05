import { describe, expect, it } from 'vitest'
import { describeTool, parseQuestions, withAnswers } from './interaction.js'

describe('parseQuestions', () => {
  it('extracts well-formed questions', () => {
    const input = {
      questions: [
        {
          question: 'Which approach?',
          header: 'Approach',
          multiSelect: false,
          options: [
            { label: 'A', description: 'first' },
            { label: 'B', description: 'second' }
          ]
        }
      ]
    }
    expect(parseQuestions(input)).toEqual([
      {
        question: 'Which approach?',
        header: 'Approach',
        multiSelect: false,
        options: [
          { label: 'A', description: 'first' },
          { label: 'B', description: 'second' }
        ]
      }
    ])
  })

  it('defaults header and tolerates missing descriptions', () => {
    const input = { questions: [{ question: 'Q', options: [{ label: 'X' }] }] }
    expect(parseQuestions(input)).toEqual([
      { question: 'Q', header: 'Question', multiSelect: false, options: [{ label: 'X', description: '' }] }
    ])
  })

  it('drops questions with no question text or no options', () => {
    const input = {
      questions: [
        { question: '', options: [{ label: 'X' }] },
        { question: 'Q', options: [] }
      ]
    }
    expect(parseQuestions(input)).toEqual([])
  })

  it('returns empty for malformed input', () => {
    expect(parseQuestions(null)).toEqual([])
    expect(parseQuestions({})).toEqual([])
    expect(parseQuestions({ questions: 'nope' })).toEqual([])
  })
})

describe('withAnswers', () => {
  it('merges answers into the original input', () => {
    const original = { questions: [{ question: 'Q' }], foo: 1 }
    expect(withAnswers(original, { Q: 'A' })).toEqual({
      questions: [{ question: 'Q' }],
      foo: 1,
      answers: { Q: 'A' }
    })
  })

  it('handles non-object input', () => {
    expect(withAnswers(null, { Q: 'A' })).toEqual({ answers: { Q: 'A' } })
  })
})

describe('describeTool', () => {
  it('appends detail when present', () => {
    expect(describeTool('Bash', 'npm test')).toBe('Bash: npm test')
    expect(describeTool('Read', '')).toBe('Read')
  })
})
