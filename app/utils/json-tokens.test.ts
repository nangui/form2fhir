import { describe, expect, it } from 'vitest'
import { tokenizeJson } from './json-tokens'

describe('tokenizeJson', () => {
  it('classifies keys, strings, numbers, booleans, null and punctuation', () => {
    const tokens = tokenizeJson('{"a": "x", "n": -1.5e3, "b": true, "z": null}')

    expect(tokens.filter(t => t.type !== 'plain')).toEqual([
      { type: 'punct', text: '{' },
      { type: 'key', text: '"a"' },
      { type: 'punct', text: ':' },
      { type: 'string', text: '"x"' },
      { type: 'punct', text: ',' },
      { type: 'key', text: '"n"' },
      { type: 'punct', text: ':' },
      { type: 'number', text: '-1.5e3' },
      { type: 'punct', text: ',' },
      { type: 'key', text: '"b"' },
      { type: 'punct', text: ':' },
      { type: 'literal', text: 'true' },
      { type: 'punct', text: ',' },
      { type: 'key', text: '"z"' },
      { type: 'punct', text: ':' },
      { type: 'literal', text: 'null' },
      { type: 'punct', text: '}' }
    ])
  })

  it('keeps every character so the output reads back as the input', () => {
    const json = JSON.stringify({ text: 'Say "hi" \\ <script>', list: [1, { k: false }] }, null, 2)

    expect(tokenizeJson(json).map(t => t.text).join('')).toBe(json)
  })

  it('treats escaped quotes inside strings as part of the string', () => {
    expect(tokenizeJson('"a \\"b\\" c"')).toEqual([{ type: 'string', text: '"a \\"b\\" c"' }])
  })
})
