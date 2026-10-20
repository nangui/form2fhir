import { describe, expect, it, vi } from 'vitest'
import hapiValid from '../../test/recordings/hapi-valid.json'
import hapiInvalid from '../../test/recordings/hapi-invalid.json'
import hapiParseError from '../../test/recordings/hapi-parse-error.json'
import { ServiceUnavailableError } from './errors'
import { checkQuestionnaire, parseOperationOutcome, validateQuestionnaire, validateWithHapi } from './validate'

const BASE_URL = 'https://fhir.test/baseR4'
const LOINC = 'http://loinc.org'

function questionnaire(items: unknown[], extra: Record<string, unknown> = {}) {
  return { resourceType: 'Questionnaire', status: 'draft', title: 'Test', item: items, ...extra }
}

const heartRateItem = {
  linkId: 'hr',
  type: 'integer',
  text: 'Heart rate',
  code: [{ system: LOINC, code: '8867-4', display: 'Heart rate' }]
}

function errors(q: unknown, allowed: string[] = ['8867-4']) {
  return checkQuestionnaire(q, new Set(allowed)).filter(i => i.severity === 'error').map(i => i.message)
}

describe('checkQuestionnaire', () => {
  it('accepts a well-formed questionnaire with allowed codes', () => {
    expect(checkQuestionnaire(questionnaire([heartRateItem]), new Set(['8867-4']))).toEqual([])
  })

  it('rejects anything that is not a Questionnaire', () => {
    expect(errors('hello')).toEqual(['The submitted value must be a FHIR Questionnaire object (resourceType "Questionnaire").'])
    expect(errors({ resourceType: 'Patient' })).toHaveLength(1)
  })

  it('requires a valid status and at least one item', () => {
    expect(errors({ resourceType: 'Questionnaire', status: 'final' })).toEqual([
      'status must be one of draft, active, retired, unknown.',
      'The Questionnaire must contain at least one item.'
    ])
  })

  it('reports missing, duplicate and unknown linkIds/types with their location', () => {
    const issues = checkQuestionnaire(questionnaire([
      { linkId: 'a', type: 'string', text: 'A' },
      { linkId: 'a', type: 'text', text: 'A again' },
      { type: 'string', text: 'no id' },
      { linkId: 'b', type: 'dropdown', text: 'B' }
    ]), new Set())

    expect(issues.map(i => [i.location, i.message])).toEqual([
      ['Questionnaire.item[1]', 'Duplicate linkId "a". linkIds must be unique in the whole Questionnaire.'],
      ['Questionnaire.item[2]', 'Every item needs a non-empty string linkId.'],
      ['Questionnaire.item[3]', 'Unknown item type "dropdown". Use one of: group, display, boolean, decimal, integer, date, dateTime, time, string, text, url, choice, open-choice, attachment, reference, quantity.']
    ])
  })

  it('checks nested items', () => {
    const q = questionnaire([{ linkId: 'g', type: 'group', text: 'G', item: [{ linkId: 'g', type: 'string', text: 'dup' }] }])

    expect(checkQuestionnaire(q, new Set())[0]!.location).toBe('Questionnaire.item[0].item[0]')
  })

  it('requires a non-empty answerOption list on choice items', () => {
    expect(errors(questionnaire([{ linkId: 'c', type: 'choice', text: 'Pick one' }]))).toEqual([
      'Choice item "c" needs a non-empty answerOption list.'
    ])
    expect(errors(questionnaire([{ linkId: 'c', type: 'choice', text: 'Pick one', answerOption: [] }]))).toEqual([
      'Choice item "c" needs a non-empty answerOption list.'
    ])
    expect(errors(questionnaire([{ linkId: 'c', type: 'open-choice', text: 'Pick', answerOption: [{ valueString: 'Other' }] }]))).toEqual([])
  })

  it('rejects answerValueSet, which can reference an unverifiable LOINC answer list', () => {
    expect(errors(questionnaire([{ linkId: 'c', type: 'choice', text: 'Pick', answerValueSet: 'http://loinc.org/vs/LL9999-9' }]))).toEqual([
      'Item "c" uses answerValueSet. List the answers in answerOption instead.'
    ])
  })

  it('treats linkIds that differ only by whitespace as duplicates', () => {
    expect(errors(questionnaire([
      { linkId: 'a', type: 'string', text: 'A' },
      { linkId: 'a ', type: 'string', text: 'A' }
    ]))).toEqual(['Duplicate linkId "a". linkIds must be unique in the whole Questionnaire.'])
  })

  it('rejects LOINC codes that were not returned by search_loinc, anywhere in the resource', () => {
    const q = questionnaire([
      { ...heartRateItem, code: [{ system: LOINC, code: '99999-9', display: 'Invented' }] },
      {
        linkId: 'mood',
        type: 'choice',
        text: 'Mood',
        answerOption: [{ valueCoding: { system: LOINC, code: 'LA0000-0', display: 'Fine' } }]
      }
    ], { code: [{ system: LOINC, code: '44249-1' }] })

    expect(checkQuestionnaire(q, new Set(['44249-1'])).map(i => i.location)).toEqual([
      'Questionnaire.item[0].code[0]',
      'Questionnaire.item[1].answerOption[0].valueCoding'
    ])
    expect(errors(q, ['44249-1'])[0]).toBe(
      'LOINC code "99999-9" was not returned by search_loinc in this run. Search for it, or remove the code. Never invent LOINC codes.'
    )
  })

  it('applies the allowlist to every spelling of the LOINC system', () => {
    for (const system of ['http://loinc.org/', 'https://loinc.org', 'urn:oid:2.16.840.1.113883.6.1']) {
      const q = questionnaire([{ ...heartRateItem, code: [{ system, code: '99999-9' }] }])
      const messages = errors(q)

      expect(messages).toContain(`Use exactly "http://loinc.org" as the LOINC system (got "${system}").`)
      expect(messages.some(m => m.startsWith('LOINC code "99999-9" was not returned'))).toBe(true)
    }
  })

  it('ignores codes from other systems', () => {
    const q = questionnaire([{ ...heartRateItem, code: [{ system: 'http://snomed.info/sct', code: '364075005' }] }])

    expect(errors(q, [])).toEqual([])
  })

  it('bans rendering extensions so the preview never renders model-written markup', () => {
    for (const [name, value] of [['rendering-xhtml', 'valueString'], ['rendering-markdown', 'valueMarkdown']] as const) {
      const q = questionnaire([{
        ...heartRateItem,
        _text: { extension: [{ url: `http://hl7.org/fhir/StructureDefinition/${name}`, [value]: '<img src=x onerror=alert(1)>' }] }
      }])

      expect(errors(q)).toEqual(['Rendering extensions (xhtml, markdown, style) are not allowed. Use plain text.'])
    }
  })
})

describe('parseOperationOutcome', () => {
  it('keeps errors and warnings, drops information, and points at the location', () => {
    const issues = parseOperationOutcome(hapiInvalid)

    expect(issues.filter(i => i.severity === 'error')).toEqual([
      {
        severity: 'error',
        source: 'hapi',
        message: 'Constraint failed: que-1: \'Group items must have nested items, display items cannot have nested items\'',
        location: 'Questionnaire.item[1]'
      },
      {
        severity: 'error',
        source: 'hapi',
        message: 'Constraint failed: que-2: \'The link ids for groups and questions must be unique within the questionnaire\'',
        location: 'Questionnaire'
      }
    ])
    expect(issues.some(i => i.severity === 'warning' && i.message.includes('dom-6'))).toBe(true)
  })

  it('treats fatal parse errors as errors', () => {
    const [issue] = parseOperationOutcome(hapiParseError)

    expect(issue!.severity).toBe('error')
    expect(issue!.message).toContain('Unknown PublicationStatus code \'bogus\'')
  })

  it('collapses duplicate warnings', () => {
    const issue = { severity: 'warning', diagnostics: 'same', expression: ['Questionnaire'] }

    expect(parseOperationOutcome({ resourceType: 'OperationOutcome', issue: [issue, issue] })).toHaveLength(1)
  })
})

describe('validateWithHapi', () => {
  it('posts the resource as FHIR JSON to Questionnaire/$validate', async () => {
    const fetchFn = vi.fn(async () => Response.json(hapiValid))

    const issues = await validateWithHapi(questionnaire([heartRateItem]), { baseUrl: BASE_URL, fetch: fetchFn })

    expect(issues.every(i => i.severity === 'warning')).toBe(true)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://fhir.test/baseR4/Questionnaire/$validate')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('content-type')).toBe('application/fhir+json')
  })

  it('reads the OperationOutcome of a 400 response as validation errors', async () => {
    const fetchFn = vi.fn(async () => Response.json(hapiParseError, { status: 400 }))

    const issues = await validateWithHapi({}, { baseUrl: BASE_URL, fetch: fetchFn })

    expect(issues[0]!.severity).toBe('error')
  })

  it('throws ServiceUnavailableError on 5xx, non-validation 4xx, garbage or timeout', async () => {
    const emptyOutcome = { resourceType: 'OperationOutcome', issue: [{ severity: 'information', diagnostics: 'Too many requests' }] }
    const down = vi.fn(async () => new Response('Bad gateway', { status: 502 }))
    const rateLimited = vi.fn(async () => Response.json(emptyOutcome, { status: 429 }))
    const notFound = vi.fn(async () => Response.json(emptyOutcome, { status: 404 }))
    const garbage = vi.fn(async () => new Response('<html>maintenance</html>', { status: 200 }))
    const malformed = vi.fn(async () => Response.json({ resourceType: 'OperationOutcome', issue: { severity: 'error' } }))
    const hanging = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))))

    for (const fetchFn of [down, rateLimited, notFound, garbage, malformed, hanging]) {
      const error = await validateWithHapi({}, { baseUrl: BASE_URL, fetch: fetchFn, timeoutMs: 10 }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ServiceUnavailableError)
      expect((error as ServiceUnavailableError).service).toBe('validator')
    }
  })
})

describe('validateQuestionnaire', () => {
  it('is valid only when neither local checks nor HAPI report errors', async () => {
    const fetchFn = vi.fn(async () => Response.json(hapiValid))

    const result = await validateQuestionnaire(questionnaire([heartRateItem]), new Set(['8867-4']), { baseUrl: BASE_URL, fetch: fetchFn })

    expect(result.valid).toBe(true)
    expect(result.issues.length).toBeGreaterThan(0) // HAPI warnings are kept for the Validation tab
  })

  it('combines local and HAPI errors so the model can fix everything in one iteration', async () => {
    const fetchFn = vi.fn(async () => Response.json(hapiInvalid))

    const result = await validateQuestionnaire(questionnaire([heartRateItem]), new Set(), { baseUrl: BASE_URL, fetch: fetchFn })

    expect(result.valid).toBe(false)
    expect(result.issues.filter(i => i.severity === 'error').map(i => i.source)).toEqual(['local', 'hapi', 'hapi'])
  })

  it('does not call HAPI when the value is not a Questionnaire at all', async () => {
    const fetchFn = vi.fn(async () => Response.json(hapiValid))

    const result = await validateQuestionnaire('nope', new Set(), { baseUrl: BASE_URL, fetch: fetchFn })

    expect(result.valid).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('answer fidelity (ordinal weights)', () => {
  const ORDINAL = 'http://hl7.org/fhir/StructureDefinition/ordinalValue'
  const scored = (code: string, display: string, weight?: unknown) => ({
    valueCoding: { system: LOINC, code, display },
    ...(weight === undefined ? {} : { extension: [{ url: ORDINAL, ...(typeof weight === 'number' ? { valueDecimal: weight } : { valueString: weight }) }] })
  })
  const phqItem = (options: unknown[]) => questionnaire([{ linkId: 'phq9-1', type: 'choice', text: 'Little interest', code: [{ system: LOINC, code: '44250-9' }], answerOption: options }])
  const evidence = {
    codes: new Set(['44250-9', 'LA6568-5', 'LA6569-3']),
    answerScores: new Map([['44250-9', new Map<string, number | null>([['LA6568-5', 0], ['LA6569-3', 1]])]]),
    panels: new Map()
  }

  it('accepts LOINC answers that carry their LOINC score as a numeric ordinalValue', () => {
    expect(checkQuestionnaire(phqItem([scored('LA6568-5', 'Not at all', 0), scored('LA6569-3', 'Several days', 1)]), evidence)).toEqual([])
  })

  it('rejects a scored LOINC answer without its weight, telling the model which value to add', () => {
    const issues = checkQuestionnaire(phqItem([scored('LA6568-5', 'Not at all'), scored('LA6569-3', 'Several days')]), evidence)

    expect(issues.map(i => [i.location, i.message])).toContainEqual([
      'Questionnaire.item[0].answerOption[0]',
      'Answer "LA6568-5" (Not at all) has LOINC score 0: add it as an ordinalValue extension with valueDecimal 0.'
    ])
  })

  it('rejects a weight that differs from the LOINC score', () => {
    const issues = checkQuestionnaire(phqItem([scored('LA6568-5', 'Not at all', 0), scored('LA6569-3', 'Several days', 2)]), evidence)

    expect(issues.map(i => i.message)).toEqual(['Answer "LA6569-3" (Several days) has ordinalValue 2, but its LOINC score is 1.'])
  })

  it('rejects a weight coerced to a string', () => {
    const issues = checkQuestionnaire(phqItem([scored('LA6568-5', 'Not at all', '0'), scored('LA6569-3', 'Several days', 1)]), evidence)

    expect(issues.map(i => i.message)).toContain('The ordinalValue of an answer must be a number in valueDecimal.')
  })

  it('checks scores of the item\'s own question only: "Yes" scored elsewhere is not scored here', () => {
    const yesNo = (code: string) => ({ valueCoding: { system: LOINC, code, display: code } })
    const q = questionnaire([{ linkId: 'refugee', type: 'choice', text: 'Are you a refugee?', code: [{ system: LOINC, code: '93027-1' }], answerOption: [yesNo('LA33-6'), yesNo('LA32-8')] }])
    const prapare = {
      codes: new Set(['93027-1', '76501-6', 'LA33-6', 'LA32-8']),
      answerScores: new Map([
        ['76501-6', new Map<string, number | null>([['LA33-6', 1], ['LA32-8', 0]])],
        ['93027-1', new Map<string, number | null>([['LA33-6', null], ['LA32-8', null]])]
      ]),
      panels: new Map()
    }

    expect(checkQuestionnaire(q, prapare)).toEqual([])
  })

  it('does not require a weight on answers LOINC leaves unscored (e.g. "Don\'t know")', () => {
    const hunger = {
      codes: new Set(['88122-7', 'LA28397-0', 'LA28398-8', 'LA30968-4']),
      answerScores: new Map([['88122-7', new Map<string, number | null>([['LA28397-0', 1], ['LA28398-8', 0], ['LA30968-4', null]])]]),
      panels: new Map()
    }
    const q = questionnaire([{
      linkId: 'q1',
      type: 'choice',
      text: 'Worried food would run out',
      code: [{ system: LOINC, code: '88122-7' }],
      answerOption: [scored('LA28397-0', 'Often true', 1), scored('LA28398-8', 'Never true', 0), scored('LA30968-4', 'DK or refused')]
    }])

    expect(checkQuestionnaire(q, hunger)).toEqual([])
  })

  it('lets a form-specific answer stay unweighted next to a scored LOINC scale', () => {
    const q = phqItem([
      scored('LA6568-5', 'Not at all', 0),
      scored('LA6569-3', 'Several days', 1),
      { valueCoding: { system: 'http://example.org/answers', code: 'prefer-not', display: 'Prefer not to say' } }
    ])

    expect(checkQuestionnaire(q, evidence)).toEqual([])
  })

  it('rejects a scale where only some coded answers carry a weight', () => {
    const q = questionnaire([{
      linkId: 'mood',
      type: 'choice',
      text: 'Mood',
      answerOption: [
        { valueCoding: { system: 'http://example.org/mood', code: 'a' }, extension: [{ url: ORDINAL, valueDecimal: 0 }] },
        { valueCoding: { system: 'http://example.org/mood', code: 'b' } }
      ]
    }])

    expect(errors(q, [])).toEqual(['Item "mood": either every coded answer carries an ordinalValue or none does (1 of 2 do).'])
  })
})

describe('panel fidelity', () => {
  const evidence = {
    codes: new Set(['44249-1', '44250-9', '69722-7', '44256-6']),
    answerScores: new Map(),
    panels: new Map([['44249-1', new Set(['44250-9', '69722-7'])]])
  }

  it('warns (without blocking) when an item under a declared panel uses a code that is not one of its questions', () => {
    const q = questionnaire([
      { linkId: 'q1', type: 'string', text: 'Little interest', code: [{ system: LOINC, code: '44250-9' }] },
      { linkId: 'difficulty', type: 'string', text: 'How difficult…', code: [{ system: LOINC, code: '44256-6' }] }
    ], { code: [{ system: LOINC, code: '44249-1' }] })

    expect(checkQuestionnaire(q, evidence)).toEqual([{
      severity: 'warning',
      source: 'local',
      message: 'LOINC code 44256-6 is not one of the official questions of panel 44249-1. Check whether the panel has its own code for this question.',
      location: 'Questionnaire.item[1]'
    }])
  })

  it('applies to an instrument embedded as a group (e.g. AUDIT-C inside a longer form)', () => {
    const q = questionnaire([{
      linkId: 'g',
      type: 'group',
      text: 'Mood',
      code: [{ system: LOINC, code: '44249-1' }],
      item: [{ linkId: 'x', type: 'string', text: 'Other', code: [{ system: LOINC, code: '44256-6' }] }]
    }])

    expect(checkQuestionnaire(q, evidence).map(i => [i.severity, i.location])).toEqual([['warning', 'Questionnaire.item[0].item[0]']])
  })
})
