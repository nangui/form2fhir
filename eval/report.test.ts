import { describe, expect, it } from 'vitest'
import { estimateCostUsd, toMarkdown, type EvalRow } from './report'

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
      '| Form | Lang | Valid | Claude calls | LOINC coverage | Time | Est. cost |',
      '|---|---|---|---|---|---|---|',
      '| PHQ-9 | en | ✅ | 2 | 10/10 (100%) | 26.8 s | $0.077 |',
      '| Broken | fr | ❌ Claude is busy right now. | 0 | — | 1.2 s | — |',
      '',
      '**1/2 valid** · median 14.0 s · total est. cost $0.077'
    ].join('\n'))
  })
})
