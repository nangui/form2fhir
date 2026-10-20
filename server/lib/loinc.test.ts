import { describe, expect, it, vi } from 'vitest'
import heartRate from '../../test/recordings/loinc-heart-rate.json'
import phq9Item1 from '../../test/recordings/loinc-phq9-item1.json'
import phq9Panel from '../../test/recordings/loinc-phq9-panel.json'
import oxygen from '../../test/recordings/loinc-oxygen-saturation.json'
import noResults from '../../test/recordings/loinc-no-results.json'
import phq9Form from '../../test/recordings/loinc-form-phq9.json'
import { ServiceUnavailableError, ToolInputError } from './errors'
import { collectCodes, collectEvidence, parseFormDefinition, parseSearchInput, parseSearchResponse, searchLoinc } from './loinc'

const BASE_URL = 'https://loinc.test/search'

function jsonFetch(byTerms: Record<string, unknown>) {
  return vi.fn(async (url: string | URL | Request) => {
    const terms = new URL(String(url)).searchParams.get('terms') ?? ''
    if (!(terms in byTerms)) return new Response('not found', { status: 404 })
    return Response.json(byTerms[terms])
  })
}

describe('parseSearchResponse', () => {
  it('maps codes, displays, datatype and units', () => {
    const hits = parseSearchResponse(heartRate)

    expect(hits[0]).toEqual({
      code: '8867-4',
      display: 'Heart rate',
      datatype: 'REAL',
      units: ['{beats}/min', '{counts}/min']
    })
  })

  it('returns the first answer list with LA codes in sequence order', () => {
    const [first] = parseSearchResponse(phq9Item1)

    expect(first!.code).toBe('44250-9')
    expect(first!.datatype).toBe('CNE')
    expect(first!.answers).toEqual([
      { code: 'LA6568-5', display: 'Not at all', score: 0 },
      { code: 'LA6569-3', display: 'Several days', score: 1 },
      { code: 'LA6570-1', display: 'More than half the days', score: 2 },
      { code: 'LA6571-9', display: 'Nearly every day', score: 3 }
    ])
  })

  it('drops deprecated terms', () => {
    const displays = parseSearchResponse(oxygen).map(hit => hit.display)

    expect(displays).toContain('Oxygen saturation')
    expect(displays.some(display => display.startsWith('Deprecated'))).toBe(false)
  })

  it('handles panels without extra fields and empty results', () => {
    expect(parseSearchResponse(phq9Panel)[0]).toEqual({
      code: '44249-1',
      display: 'PHQ-9 quick depression assessment panel [Reported.PHQ]'
    })
    expect(parseSearchResponse(noResults)).toEqual([])
  })

  it('skips null answer lists instead of losing the whole query', () => {
    const body = [1, ['44250-9'], { AnswerLists: [[null, { answers: [{ AnswerStringID: 'LA6568-5', DisplayText: 'Not at all', SequenceNo: 1 }] }]] }, [['Little interest']]]

    expect(parseSearchResponse(body)[0]!.answers).toEqual([{ code: 'LA6568-5', display: 'Not at all' }])
  })

  it('rejects a malformed body', () => {
    expect(() => parseSearchResponse({ nope: true })).toThrow('Unexpected LOINC search response')
  })
})

describe('parseSearchInput', () => {
  it('accepts questions and panels', () => {
    expect(parseSearchInput({ questions: [' heart rate '], panels: ['PHQ-9'] }))
      .toEqual({ questions: ['heart rate'], panels: ['PHQ-9'] })
  })

  it('rejects empty, oversized or malformed input with a message the model can act on', () => {
    expect(() => parseSearchInput({})).toThrow(ToolInputError)
    expect(() => parseSearchInput({ questions: [''] })).toThrow('non-empty strings')
    expect(() => parseSearchInput({ questions: 'heart rate' })).toThrow('array')
    expect(() => parseSearchInput({ questions: Array.from({ length: 26 }, (_, i) => `q${i}`) }))
      .toThrow('at most 25')
  })
})

describe('searchLoinc', () => {
  it('queries questions and panels with tuned search fields', async () => {
    const fetchFn = jsonFetch({ 'heart rate': heartRate, 'PHQ-9': phq9Panel })

    const results = await searchLoinc(
      { questions: ['heart rate'], panels: ['PHQ-9'] },
      { baseUrl: BASE_URL, fetch: fetchFn }
    )

    expect(results.map(r => [r.query, r.kind, r.hits[0]?.code])).toEqual([
      ['heart rate', 'question', '8867-4'],
      ['PHQ-9', 'panel', '44249-1']
    ])
    const questionUrl = new URL(String(fetchFn.mock.calls[0]![0]))
    expect(questionUrl.searchParams.get('type')).toBe('question')
    expect(questionUrl.searchParams.get('sf')).toBe('LONG_COMMON_NAME,SHORTNAME,COMPONENT,SURVEY_QUEST_TEXT')
    expect(questionUrl.searchParams.get('ef')).toBe('datatype,units,AnswerLists')
    expect(new URL(String(fetchFn.mock.calls[1]![0])).searchParams.get('type')).toBe('form')
  })

  it('reports a failed query without failing the others', async () => {
    const fetchFn = jsonFetch({ 'heart rate': heartRate })

    const results = await searchLoinc(
      { questions: ['heart rate', 'broken'] },
      { baseUrl: BASE_URL, fetch: fetchFn }
    )

    expect(results[0]!.hits[0]!.code).toBe('8867-4')
    expect(results[1]).toEqual({ query: 'broken', kind: 'question', hits: [], error: 'LOINC search failed (HTTP 404)' })
  })

  it('returns no results, without calling the API, when there is nothing to search', async () => {
    const fetchFn = vi.fn(async () => Response.json(noResults))

    expect(await searchLoinc({ questions: [] }, { baseUrl: BASE_URL, fetch: fetchFn })).toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('throws ServiceUnavailableError when every query fails', async () => {
    const fetchFn = vi.fn(async () => new Response('down', { status: 503 }))

    await expect(searchLoinc({ questions: ['a', 'b'] }, { baseUrl: BASE_URL, fetch: fetchFn }))
      .rejects.toThrow(ServiceUnavailableError)
  })

  it('times out slow requests', async () => {
    const hangingFetch = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
      }))

    const error = await searchLoinc({ questions: ['a'] }, { baseUrl: BASE_URL, fetch: hangingFetch, timeoutMs: 10 })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ServiceUnavailableError)
    expect((error as ServiceUnavailableError).service).toBe('loinc')
  })

  it('limits concurrent requests to the NLM API', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const fetchFn = vi.fn(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(resolve => setTimeout(resolve, 5))
      inFlight--
      return Response.json(noResults)
    })

    await searchLoinc(
      { questions: Array.from({ length: 12 }, (_, i) => `q${i}`) },
      { baseUrl: BASE_URL, fetch: fetchFn }
    )

    expect(fetchFn).toHaveBeenCalledTimes(12)
    expect(maxInFlight).toBeLessThanOrEqual(5)
  })
})

describe('collectCodes', () => {
  it('collects question, panel and answer codes for the allowlist', () => {
    const codes = collectCodes([
      { query: 'q', kind: 'question', hits: parseSearchResponse(phq9Item1).slice(0, 1) },
      { query: 'p', kind: 'panel', hits: parseSearchResponse(phq9Panel) }
    ])

    expect([...codes].sort()).toEqual(
      ['44249-1', '44250-9', '89206-7', 'LA6568-5', 'LA6569-3', 'LA6570-1', 'LA6571-9'].sort()
    )
  })
})

describe('parseFormDefinition', () => {
  it('flattens the official panel questions with their answers and scores', () => {
    const members = parseFormDefinition(phq9Form)

    expect(members.map(m => m.code)).toEqual([
      '44250-9', '44255-8', '44259-0', '44254-1', '44251-7', '44258-2', '44252-5', '44253-3', '44260-8', '69722-7', '44261-6'
    ])
    expect(members[0]).toEqual({
      code: '44250-9',
      display: 'Little interest or pleasure in doing things',
      answers: [
        { code: 'LA6568-5', display: 'Not at all', score: 0 },
        { code: 'LA6569-3', display: 'Several days', score: 1 },
        { code: 'LA6570-1', display: 'More than half the days', score: 2 },
        { code: 'LA6571-9', display: 'Nearly every day', score: 3 }
      ]
    })
    expect(members[9]!.answers!.every(a => a.score === undefined)).toBe(true) // difficulty: not scored
  })

  it('returns nothing for a body that is not a form definition', () => {
    expect(parseFormDefinition({ error: 'not found' })).toEqual([])
  })

  it('skips malformed items and answers instead of losing the whole definition', () => {
    const body = { items: [null, { questionCode: '1-1', question: 'Q', answers: [null, { text: 'no code' }, { code: 'LA1-1', text: 'A', score: '2' }] }] }

    expect(parseFormDefinition(body)).toEqual([{ code: '1-1', display: 'Q', answers: [{ code: 'LA1-1', display: 'A' }] }])
  })
})

describe('searchLoinc with panels', () => {
  it('attaches the official questions of the top panel hit', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url))
      if (u.pathname === '/loinc_form_definitions') {
        return u.searchParams.get('loinc_num') === '44249-1' ? Response.json(phq9Form) : new Response('none', { status: 404 })
      }
      return Response.json(phq9Panel)
    })

    const [result] = await searchLoinc({ panels: ['PHQ-9'] }, { baseUrl: BASE_URL, fetch: fetchFn })

    expect(result!.hits[0]!.members!.map(m => m.code)).toContain('69722-7')
    expect(result!.hits[1]!.members).toBeUndefined() // only the top hit is expanded
    expect(String(fetchFn.mock.calls[1]![0])).toBe('https://loinc.test/loinc_form_definitions?loinc_num=44249-1')
  })

  it('fetches a definition once when two queries hit the same panel', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      new URL(String(url)).pathname === '/loinc_form_definitions' ? Response.json(phq9Form) : Response.json(phq9Panel))

    await searchLoinc({ panels: ['PHQ-9', 'PHQ9'] }, { baseUrl: BASE_URL, fetch: fetchFn })

    expect(fetchFn.mock.calls.filter(([url]) => String(url).includes('loinc_form_definitions'))).toHaveLength(1)
  })

  it('leaves huge panels unexpanded (MDS 3.0 has 3,132 questions)', async () => {
    const huge = { items: Array.from({ length: 61 }, (_, i) => ({ questionCode: `${i}-0`, question: 'Q' })) }
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      new URL(String(url)).pathname === '/loinc_form_definitions' ? Response.json(huge) : Response.json(phq9Panel))

    const [result] = await searchLoinc({ panels: ['MDS'] }, { baseUrl: BASE_URL, fetch: fetchFn })

    expect(result!.hits[0]!.members).toBeUndefined()
  })

  it('keeps the panel hit when its definition cannot be fetched', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      new URL(String(url)).pathname === '/loinc_form_definitions' ? new Response('down', { status: 503 }) : Response.json(phq9Panel))

    const [result] = await searchLoinc({ panels: ['PHQ-9'] }, { baseUrl: BASE_URL, fetch: fetchFn })

    expect(result!.hits[0]!.code).toBe('44249-1')
    expect(result!.hits[0]!.members).toBeUndefined()
    expect(result!.error).toBeUndefined()
  })
})

describe('collectEvidence', () => {
  const panelResult = { query: 'PHQ-9', kind: 'panel' as const, hits: [{ code: '44249-1', display: 'PHQ-9 panel', members: parseFormDefinition(phq9Form) }] }

  it('allows panel members and their answers, and records answer scores and panel membership', () => {
    const evidence = collectEvidence([panelResult])

    expect(evidence.codes.has('69722-7')).toBe(true)
    expect(evidence.codes.has('LA6574-3')).toBe(true)
    expect(evidence.answerScores.get('44250-9')!.get('LA6571-9')).toBe(3)
    expect(evidence.answerScores.get('69722-7')!.get('LA6572-7')).toBeNull() // difficulty: unscored
    expect(evidence.panels.get('44249-1')!.has('44260-8')).toBe(true)
  })

  it('keeps scores per question, and drops one when two sources disagree rather than guessing', () => {
    const other = { query: 'q', kind: 'question' as const, hits: [
      { code: '1-1', display: 'x', answers: [{ code: 'LA6568-5', display: 'Not at all', score: 5 }] },
      { code: '44250-9', display: 'Little interest', answers: [{ code: 'LA6568-5', display: 'Not at all', score: 7 }] }
    ] }
    const evidence = collectEvidence([panelResult, other])

    expect(evidence.answerScores.get('1-1')!.get('LA6568-5')).toBe(5)
    expect(evidence.answerScores.get('44250-9')!.get('LA6568-5')).toBeNull()
    expect(evidence.answerScores.get('44250-9')!.get('LA6569-3')).toBe(1)
  })
})
