import type { ItemSource } from '../../shared/types'
import type { FormInput } from './input'

const MAX_EXCERPT = 300
// Shorter quotes ("Yes", "No", a heading word) would be found almost anywhere: they prove nothing.
const MIN_CHECKED = 8

/**
 * The passage of the original form each item comes from, as the agent quoted it. For pasted text
 * the quote is checked against the text (found: true or false); a PDF, an image or a quote too
 * short to mean anything cannot be checked (found: null). Quotes for unknown linkIds are dropped.
 * Found only means the words are in the form, not that they belong to that item.
 */
export function itemSources(raw: unknown, questionnaire: unknown, input: FormInput): ItemSource[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const quotes = raw as Record<string, unknown>
  const source = input.kind === 'text' ? normalize(input.text) : undefined
  const sources: ItemSource[] = []
  for (const linkId of linkIdsOf(questionnaire)) {
    const quote = quotes[linkId]
    if (typeof quote !== 'string' || !quote.trim()) continue
    const excerpt = quote.trim().slice(0, MAX_EXCERPT)
    const quoted = normalize(excerpt)
    sources.push({ linkId, excerpt, found: source === undefined || quoted.length < MIN_CHECKED ? null : source.includes(quoted) })
  }
  return sources
}

/** Case, spacing, Unicode forms and typographic quotes and dashes do not count as differences. */
function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase()
    .replace(/[\u2018\u2019\u201A\u2032]/g, '\'')
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Every linkId, depth first, once. */
function linkIdsOf(questionnaire: unknown): string[] {
  const ids = new Set<string>()
  const walk = (items: unknown) => {
    if (!Array.isArray(items)) return
    for (const item of items as { linkId?: unknown, item?: unknown }[]) {
      if (typeof item?.linkId === 'string') ids.add(item.linkId)
      walk(item?.item)
    }
  }
  walk((questionnaire as { item?: unknown } | null)?.item)
  return [...ids]
}
