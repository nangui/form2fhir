import type { ItemSource } from '../../shared/types'
import type { FormInput } from './input'

const MAX_EXCERPT = 300

/**
 * The passage of the original form each item comes from, as the agent quoted it. For pasted text
 * the quote is checked against the text (found: true or false); a PDF or an image cannot be
 * checked (found: null). Quotes for unknown linkIds are dropped.
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
    sources.push({ linkId, excerpt, found: source === undefined ? null : source.includes(normalize(excerpt)) })
  }
  return sources
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
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
