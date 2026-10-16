import type { TokenUsage } from '../shared/types'

export interface EvalRow {
  id: string
  name: string
  language: string
  valid: boolean
  iterations: number
  /** Question items coded in LOINC / all question items. */
  coded: number
  total: number
  durationMs: number
  usage?: TokenUsage
  costUsd?: number
  error?: string
}

// USD per million tokens (Claude API list prices; 5-minute cache writes cost 1.25× input).
const PRICES: Record<string, { input: number, output: number, cacheRead: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 }
}

export function estimateCostUsd(model: string, usage: TokenUsage): number | undefined {
  const price = Object.entries(PRICES).find(([prefix]) => model.startsWith(prefix))?.[1]
  if (!price) return undefined
  return (usage.inputTokens * price.input
    + usage.cacheWriteTokens * price.input * 1.25
    + usage.cacheReadTokens * price.cacheRead
    + usage.outputTokens * price.output) / 1_000_000
}

export function toMarkdown(rows: EvalRow[], meta: { model: string, date: string }): string {
  const lines = rows.map((row) => {
    const valid = row.valid ? '✅' : `❌${row.error ? ` ${row.error}` : ''}`
    const coverage = row.total ? `${row.coded}/${row.total} (${Math.round((row.coded / row.total) * 100)}%)` : '—'
    return `| ${row.name} | ${row.language} | ${valid} | ${row.iterations} | ${coverage} | ${seconds(row.durationMs)} | ${row.costUsd === undefined ? '—' : `$${row.costUsd.toFixed(3)}`} |`
  })
  const validCount = rows.filter(row => row.valid).length
  const totalCost = rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0)
  return [
    `## Form2FHIR eval — ${meta.model} — ${meta.date}`,
    '',
    '| Form | Lang | Valid | Claude calls | LOINC coverage | Time | Est. cost |',
    '|---|---|---|---|---|---|---|',
    ...lines,
    '',
    `**${validCount}/${rows.length} valid** · median ${seconds(median(rows.map(row => row.durationMs)))} · total est. cost $${totalCost.toFixed(3)}`
  ].join('\n')
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}
