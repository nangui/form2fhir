import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createSseParser } from './sse'

describe('createSseParser', () => {
  it('emits one payload per event, across arbitrary chunk boundaries', () => {
    const received: string[] = []
    const parser = createSseParser(data => received.push(data))

    parser.push('data: {"a"')
    parser.push(':1}\n\nda')
    parser.push('ta: {"b":2}\r\n\r\n')

    expect(received).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('joins multi-line data and ignores comments and other fields', () => {
    const received: string[] = []
    const parser = createSseParser(data => received.push(data))

    parser.push(': keep-alive\n\nevent: message\nid: 1\ndata: line 1\ndata: line 2\n\n')

    expect(received).toEqual(['line 1\nline 2'])
  })

  it('emits a final event left without a trailing blank line when the stream ends', () => {
    const received: string[] = []
    const parser = createSseParser(data => received.push(data))

    parser.push('data: {"a":1}\n\ndata: {"type":"result"}')
    parser.end()

    expect(received).toEqual(['{"a":1}', '{"type":"result"}'])
  })

  it('parses a recorded /api/convert stream', () => {
    const received: string[] = []
    const parser = createSseParser(data => received.push(data))

    parser.push(readFileSync(new URL('../../test/recordings/convert-phq9.sse', import.meta.url), 'utf8'))

    const events = received.map(data => JSON.parse(data) as { type: string })
    expect(events.at(-1)!.type).toBe('result')
    expect(events.filter(e => e.type === 'step')).toHaveLength(8)
  })
})
