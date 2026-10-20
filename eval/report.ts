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
  /** Agent codes compared with the fixture's expected codes (absent when the fixture has none). */
  codes?: { correct: number, wrong: number, missing: number }
  usage?: TokenUsage
  costUsd?: number
  error?: string
}

/**
 * An item of the form and the LOINC codes accepted for it. The item is found by a case-insensitive
 * regex on its text or, failing that, on its group's text ("Glycémie à jeun" › "Résultat").
 */
export interface ExpectedCode {
  item: string
  codes: string[]
}

export interface CodeCheck {
  item: string
  expected: string[]
  got?: string
  verdict: 'correct' | 'wrong' | 'missing'
}

interface Item { type?: string, text?: string, code?: { system?: string, code?: string }[], item?: Item[] }
interface Question { item: Item, groups: string }

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

/**
 * Code accuracy, beyond coverage: is the code on each known item one of the accepted ones?
 * "missing" covers both an uncoded item and an item the agent dropped or reworded.
 */
export function scoreCodes(questionnaire: unknown, expected: ExpectedCode[]) {
  const questions = questionItems((questionnaire as { item?: Item[] } | undefined)?.item, '')
  const used = new Set<Item>()
  const checks = expected.map((entry): CodeCheck => {
    const pattern = new RegExp(entry.item, 'i')
    const free = questions.filter(question => !used.has(question.item))
    const item = (free.find(question => pattern.test(question.item.text ?? ''))
      ?? free.find(question => pattern.test(question.groups)))?.item
    if (item) used.add(item)
    const got = item?.code?.find(coding => coding.system === 'http://loinc.org' && coding.code)?.code
    const verdict = got === undefined ? 'missing' : entry.codes.includes(got) ? 'correct' : 'wrong'
    return { item: entry.item, expected: entry.codes, ...(got === undefined ? {} : { got }), verdict }
  })
  const count = (verdict: CodeCheck['verdict']) => checks.filter(check => check.verdict === verdict).length
  return { correct: count('correct'), wrong: count('wrong'), missing: count('missing'), checks }
}

export function toMarkdown(rows: EvalRow[], meta: { model: string, date: string }): string {
  const lines = rows.map((row) => {
    const valid = row.valid ? '✅' : `❌${row.error ? ` ${row.error}` : ''}`
    const coverage = row.total ? `${row.coded}/${row.total} (${Math.round((row.coded / row.total) * 100)}%)` : '—'
    return `| ${row.name} | ${row.language} | ${valid} | ${row.iterations} | ${coverage} | ${accuracy(row.codes)} | ${seconds(row.durationMs)} | ${row.costUsd === undefined ? '—' : `$${row.costUsd.toFixed(3)}`} |`
  })
  const validCount = rows.filter(row => row.valid).length
  const totalCost = rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0)
  const scored = rows.flatMap(row => (row.codes ? [row.codes] : []))
  const correct = scored.reduce((sum, codes) => sum + codes.correct, 0)
  const wrong = scored.reduce((sum, codes) => sum + codes.wrong, 0)
  const expected = scored.reduce((sum, codes) => sum + codes.correct + codes.wrong + codes.missing, 0)
  const accuracyTotal = expected ? ` · code accuracy ${correct}/${expected} (${Math.round((correct / expected) * 100)}%), ${wrong} wrong` : ''
  return [
    `## Form2FHIR eval — ${meta.model} — ${meta.date}`,
    '',
    '| Form | Lang | Valid | Claude calls | LOINC coverage | Code accuracy | Time | Est. cost |',
    '|---|---|---|---|---|---|---|---|',
    ...lines,
    '',
    `**${validCount}/${rows.length} valid** · median ${seconds(median(rows.map(row => row.durationMs)))} · total est. cost $${totalCost.toFixed(3)}${accuracyTotal}`
  ].join('\n')
}

function accuracy(codes: EvalRow['codes']): string {
  if (!codes) return '—'
  return `${codes.correct}/${codes.correct + codes.wrong + codes.missing}${codes.wrong ? ` (${codes.wrong} wrong)` : ''}`
}

function questionItems(items: Item[] | undefined, groups: string): Question[] {
  return (items ?? []).flatMap(item => [
    ...(item.type === 'group' || item.type === 'display' ? [] : [{ item, groups }]),
    ...questionItems(item.item, item.type === 'group' ? `${groups} › ${item.text ?? ''}` : groups)
  ])
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}
