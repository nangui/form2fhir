import { ServiceUnavailableError, ToolInputError } from './errors'
import { type HttpOptions, requestSignal } from './http'

export interface LoincAnswer {
  code: string
  display: string
  score?: number
}

export interface LoincHit {
  code: string
  display: string
  datatype?: string
  units?: string[]
  answers?: LoincAnswer[]
  /** For a panel hit: its official questions (LOINC form definition), with their answers and scores. */
  members?: LoincHit[]
}

/** What the searches of a run returned: what the model may use, and what validation can check against. */
export interface SearchEvidence {
  codes: Set<string>
  /**
   * Question code → its answers (LA code → LOINC score). Scores belong to a question/answer pair:
   * "Yes" scores 1 on one question and nothing on another. null = LOINC gives no score (e.g.
   * "Don't know", or a source without scores, e.g. AHC HRSN embedding Hunger Vital Sign);
   * 'disputed' = two sources give different numbers, so the score cannot be verified.
   */
  answerScores: Map<string, Map<string, AnswerScore>>
  /** Panel code → the codes of its official questions. */
  panels: Map<string, Set<string>>
}

export type AnswerScore = number | null | 'disputed'

export interface LoincQueryResult {
  query: string
  kind: 'question' | 'panel'
  hits: LoincHit[]
  error?: string
}

export interface SearchLoincInput {
  questions?: string[]
  panels?: string[]
}

const MAX_QUERIES = 25
const MAX_QUERY_LENGTH = 200
const MAX_HITS = 7
const CONCURRENCY = 5
// MDS 3.0 has 3,132 questions (~275k tokens): past this size a panel stays unexpanded.
const MAX_MEMBERS = 60
// The default search fields rank vital signs poorly (e.g. systolic BP 8480-6 is not in the top 10).
const SEARCH_FIELDS = 'LONG_COMMON_NAME,SHORTNAME,COMPONENT,SURVEY_QUEST_TEXT'

export function parseSearchInput(raw: unknown): SearchLoincInput {
  const input = (raw ?? {}) as Record<string, unknown>
  const questions = stringList(input.questions, 'questions')
  const panels = stringList(input.panels, 'panels')
  const total = questions.length + panels.length
  if (total === 0) throw new ToolInputError('Provide at least one entry in "questions" or "panels".')
  if (total > MAX_QUERIES) throw new ToolInputError(`Send at most ${MAX_QUERIES} queries per call (got ${total}).`)
  return { questions, panels }
}

export async function searchLoinc(input: SearchLoincInput, options: HttpOptions): Promise<LoincQueryResult[]> {
  const jobs = [
    ...(input.questions ?? []).map(query => ({ query, kind: 'question' as const })),
    ...(input.panels ?? []).map(query => ({ query, kind: 'panel' as const }))
  ]
  if (jobs.length === 0) return []
  // Two names for the same instrument ("PHQ-9", "PHQ9") fetch its definition once.
  const definitions = new Map<string, Promise<LoincHit[]>>()
  const definition = (code: string) => {
    if (!definitions.has(code)) definitions.set(code, fetchFormDefinition(code, options))
    return definitions.get(code)!
  }
  const results = await mapWithLimit(jobs, CONCURRENCY, job => searchOne(job.query, job.kind, options, definition))
  if (results.every(result => result.error)) {
    throw new ServiceUnavailableError('loinc', 'LOINC search is unavailable right now. Try again in a minute.')
  }
  return results
}

/** Every code the model is allowed to use: question/panel codes plus their answer (LA) codes. */
export function collectCodes(results: LoincQueryResult[]): Set<string> {
  return collectEvidence(results).codes
}

export function collectEvidence(results: LoincQueryResult[]): SearchEvidence {
  const evidence: SearchEvidence = { codes: new Set(), answerScores: new Map(), panels: new Map() }
  const add = (hit: LoincHit) => {
    evidence.codes.add(hit.code)
    if (hit.answers?.length) {
      const scores = evidence.answerScores.get(hit.code) ?? new Map<string, AnswerScore>()
      for (const answer of hit.answers) {
        evidence.codes.add(answer.code)
        const score = answer.score ?? null
        const known = scores.get(answer.code)
        scores.set(answer.code, mergeScores(known, score))
      }
      evidence.answerScores.set(hit.code, scores)
    }
    if (hit.members) {
      evidence.panels.set(hit.code, new Set(hit.members.map(member => member.code)))
      for (const member of hit.members) add(member)
    }
  }
  for (const hit of results.flatMap(result => result.hits)) add(hit)
  return evidence
}

/**
 * Two different numbers for the same question/answer pair cannot both be LOINC's score: 'disputed'
 * (validation refuses it). A source without a score is not a contradiction: the pair is left
 * unchecked, as panels that embed a scored instrument often drop its scores.
 */
export function mergeScores(known: AnswerScore | undefined, score: AnswerScore): AnswerScore {
  if (known === undefined || known === score) return score
  if (known === 'disputed' || score === 'disputed') return 'disputed'
  if (known === null || score === null) return null
  return 'disputed'
}

/** LOINC form definition (Clinical Tables /loinc_form_definitions): nested items, flattened. */
export function parseFormDefinition(body: unknown): LoincHit[] {
  const items = (body as { items?: unknown } | undefined)?.items
  if (!Array.isArray(items)) return []
  const members: LoincHit[] = []
  const walk = (list: unknown[]) => {
    for (const raw of list.filter(isObject)) {
      if (typeof raw.questionCode === 'string') {
        const member: LoincHit = { code: raw.questionCode, display: String(raw.question ?? '') }
        const answers = Array.isArray(raw.answers)
          ? raw.answers.filter(isObject).filter(a => typeof a.code === 'string').map(a => ({
              code: a.code as string,
              display: String(a.text ?? ''),
              ...(typeof a.score === 'number' ? { score: a.score } : {})
            }))
          : []
        if (answers.length) member.answers = answers
        members.push(member)
      }
      if (Array.isArray(raw.items)) walk(raw.items)
    }
  }
  walk(items)
  return members
}

/** Clinical Tables response: [total, codes[], extraFields | null, displays[][]]. */
export function parseSearchResponse(body: unknown): LoincHit[] {
  if (!Array.isArray(body) || !Array.isArray(body[1]) || !Array.isArray(body[3])) {
    throw new Error('Unexpected LOINC search response')
  }
  const codes = body[1] as string[]
  const extra = (body[2] ?? {}) as Record<string, unknown[] | undefined>
  const displays = body[3] as string[][]

  return codes
    .map((code, i) => toHit(code, displays[i]?.[0] ?? '', extra, i))
    .filter(hit => !hit.display.startsWith('Deprecated'))
}

async function searchOne(
  query: string,
  kind: LoincQueryResult['kind'],
  options: HttpOptions,
  definition: (code: string) => Promise<LoincHit[]>
): Promise<LoincQueryResult> {
  const url = new URL(options.baseUrl)
  url.search = new URLSearchParams({
    terms: query,
    type: kind === 'panel' ? 'form' : 'question', // `type=panel` returns sub-questions, not panels
    sf: SEARCH_FIELDS,
    df: 'LONG_COMMON_NAME',
    ef: 'datatype,units,AnswerLists',
    maxList: String(MAX_HITS)
  }).toString()

  const request = requestSignal(options, 8000)
  try {
    const response = await (options.fetch ?? fetch)(url, { signal: request.signal })
    if (!response.ok) return { query, kind, hits: [], error: `LOINC search failed (HTTP ${response.status})` }
    const hits = parseSearchResponse(await response.json())
    // The top panel hit carries its official questions, so the model can code each item with the
    // panel's own code (e.g. PHQ-9 difficulty = 69722-7, not the generic 44256-6).
    const top = hits[0]
    if (kind === 'panel' && top) {
      const members = await definition(top.code)
      if (members.length) top.members = members
    }
    return { query, kind, hits }
  } catch (error) {
    if (request.callerAborted()) throw error
    const reason = request.timedOut() ? 'timed out' : 'failed'
    return { query, kind, hits: [], error: `LOINC search ${reason}` }
  }
}

/** A panel's official questions; [] when unavailable or too large (the search result stays usable without them). */
async function fetchFormDefinition(code: string, options: HttpOptions): Promise<LoincHit[]> {
  const url = new URL('/loinc_form_definitions', options.baseUrl)
  url.searchParams.set('loinc_num', code)
  const request = requestSignal(options, 5000)
  try {
    const response = await (options.fetch ?? fetch)(url, { signal: request.signal })
    const members = response.ok ? parseFormDefinition(await response.json()) : []
    return members.length <= MAX_MEMBERS ? members : []
  } catch (error) {
    if (request.callerAborted()) throw error
    return []
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function toHit(code: string, display: string, extra: Record<string, unknown[] | undefined>, i: number): LoincHit {
  const hit: LoincHit = { code, display }
  const datatype = extra.datatype?.[i]
  if (typeof datatype === 'string') hit.datatype = datatype

  const units = extra.units?.[i]
  if (Array.isArray(units) && units.length) hit.units = units.map(u => (u as { unit: string }).unit)

  // Only the first answer list is shown to the model (the normative one comes first), so only its
  // LA codes enter the allowlist: a code from another list would be one the model never saw.
  const answerLists = extra.AnswerLists?.[i]
  const firstList = Array.isArray(answerLists) ? answerLists.find(list => list && typeof list === 'object') : undefined
  const answers = firstList ? toAnswers(firstList) : []
  if (answers.length) hit.answers = answers
  return hit
}

function toAnswers(list: object): LoincAnswer[] {
  const answers = (list as { answers?: unknown }).answers
  if (!Array.isArray(answers)) return []
  return [...(answers as Record<string, unknown>[])]
    .sort((a, b) => Number(a.SequenceNo) - Number(b.SequenceNo))
    .map(answer => ({
      code: String(answer.AnswerStringID),
      display: String(answer.DisplayText),
      ...(typeof answer.Score === 'number' ? { score: answer.Score } : {})
    }))
}

function stringList(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new ToolInputError(`"${field}" must be an array of strings.`)
  const list = value.map(item => (typeof item === 'string' ? item.trim() : ''))
  if (list.some(item => !item || item.length > MAX_QUERY_LENGTH)) {
    throw new ToolInputError(`"${field}" must contain non-empty strings of at most ${MAX_QUERY_LENGTH} characters.`)
  }
  return list
}

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
