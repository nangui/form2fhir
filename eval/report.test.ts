import { describe, expect, it } from 'vitest'
import { estimateCostUsd, scoreCodes, toMarkdown, type EvalRow } from './report'

const usage = { inputTokens: 1_000, outputTokens: 5_000, cacheReadTokens: 2_000, cacheWriteTokens: 10_000 }

describe('estimateCostUsd', () => {
  it('prices uncached input, cache writes (1.25×), cache reads and output for Sonnet 5.5', () => {
    // 1k × $2 + 10k × $2.50 + 2k × $0.20 + 5k × $10, per million tokens
    expect(estimateCostUsd('claude-sonnet-5-5', usage)).toBeCloseTo(0.0774, 4)
  })

  it('returns undefined for a model without a known price', () => {
    expect(estimateCostUsd('some-new-model', usage)).toBeUndefined()
  })
})

describe('toMarkdown', () => {
  it('renders one row per fixture and a totals line', () => {
    const rows: EvalRow[] = [
      { id: 'phq-9', name: 'PHQ-9', language: 'en', valid: true, iterations: 2, coded: 10, total: 10, durationMs: 26_755, usage, costUsd: 0.0774 },
      { id: 'broken', name: 'Broken', language: 'fr', valid: false, iterations: 0, coded: 0, total: 0, durationMs: 1_200, error: 'Claude is busy right now.' }
    ]

    expect(toMarkdown(rows, { model: 'claude-sonnet-5-5', date: '2026-10-16' })).toBe([
      '## Form2FHIR eval — claude-sonnet-5-5 — 2026-10-16',
      '',
      '| Form | Lang | Valid | Claude calls | LOINC coverage | Code accuracy | Time | Est. cost |',
      '|---|---|---|---|---|---|---|---|',
      '| PHQ-9 | en | ✅ | 2 | 10/10 (100%) | — | 26.8 s | $0.077 |',
      '| Broken | fr | ❌ Claude is busy right now. | 0 | — | — | 1.2 s | — |',
      '',
      '**1/2 valid** · median 14.0 s · total est. cost $0.077'
    ].join('\n'))
  })
})

describe('scoreCodes', () => {
  const q = {
    resourceType: 'Questionnaire',
    item: [
      { linkId: 'g', type: 'group', text: 'Vitals', item: [
        { linkId: 'hr', type: 'integer', text: 'Heart rate', code: [{ system: 'http://loinc.org', code: '8867-4' }] },
        { linkId: 'rr', type: 'integer', text: 'Respiratory rate', code: [{ system: 'http://loinc.org', code: '9303-9' }] },
        { linkId: 'w', type: 'decimal', text: 'Body weight' }
      ] }
    ]
  }

  it('compares each expected item with the LOINC code the agent chose', () => {
    const score = scoreCodes(q, [
      { item: 'heart rate', codes: ['8867-4'] },
      { item: 'respiratory', codes: ['9279-1'] },
      { item: 'weight', codes: ['29463-7', '3141-9'] },
      { item: 'temperature', codes: ['8310-5'] }
    ])

    expect(score).toEqual({
      correct: 1,
      wrong: 1,
      missing: 2,
      checks: [
        { item: 'heart rate', expected: ['8867-4'], got: '8867-4', verdict: 'correct' },
        { item: 'respiratory', expected: ['9279-1'], got: '9303-9', verdict: 'wrong' },
        { item: 'weight', expected: ['29463-7', '3141-9'], verdict: 'missing' },
        { item: 'temperature', expected: ['8310-5'], verdict: 'missing' }
      ]
    })
  })

  it('matches item text case-insensitively, as a regular expression', () => {
    expect(scoreCodes(q, [{ item: '^HEART', codes: ['8867-4'] }]).correct).toBe(1)
  })
})

describe('toMarkdown with code accuracy', () => {
  it('shows correct/expected codes and the wrong ones', () => {
    const row: EvalRow = {
      id: 'v', name: 'Vitals', language: 'en', valid: true, iterations: 2, coded: 8, total: 10, durationMs: 1_000,
      codes: { correct: 7, wrong: 1, missing: 2 }
    }

    const markdown = toMarkdown([row], { model: 'm', date: 'd' })

    expect(markdown).toContain('| Form | Lang | Valid | Claude calls | LOINC coverage | Code accuracy | Time | Est. cost |')
    expect(markdown).toContain('| Vitals | en | ✅ | 2 | 8/10 (80%) | 7/10 (1 wrong) | 1.0 s | — |')
    expect(markdown).toContain('code accuracy 7/10 (70%), 1 wrong')
  })
})
