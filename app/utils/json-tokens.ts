export interface JsonToken {
  type: 'key' | 'string' | 'number' | 'literal' | 'punct' | 'plain'
  text: string
}

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g

/**
 * Splits pretty-printed JSON into typed tokens for syntax highlighting. Rendered as text in
 * <span>s (never v-html), so model-written strings can't inject markup.
 */
export function tokenizeJson(json: string): JsonToken[] {
  const tokens: JsonToken[] = []
  let last = 0
  for (const match of json.matchAll(TOKEN)) {
    if (match.index > last) tokens.push({ type: 'plain', text: json.slice(last, match.index) })
    const [whole, string, colon, number, literal] = match
    if (string && colon) {
      tokens.push({ type: 'key', text: string })
      const spaces = colon.slice(0, -1)
      if (spaces) tokens.push({ type: 'plain', text: spaces })
      tokens.push({ type: 'punct', text: ':' })
    } else if (string) {
      tokens.push({ type: 'string', text: string })
    } else if (number) {
      tokens.push({ type: 'number', text: number })
    } else if (literal) {
      tokens.push({ type: 'literal', text: literal })
    } else {
      tokens.push({ type: 'punct', text: whole })
    }
    last = match.index + whole.length
  }
  if (last < json.length) tokens.push({ type: 'plain', text: json.slice(last) })
  return tokens
}
