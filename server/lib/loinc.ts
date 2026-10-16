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
}

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
  const results = await mapWithLimit(jobs, CONCURRENCY, job => searchOne(job.query, job.kind, options))
  if (results.every(result => result.error)) {
    throw new ServiceUnavailableError('loinc', 'LOINC search is unavailable right now. Try again in a minute.')
  }
  return results
}

/** Every code the model is allowed to use: question/panel codes plus their answer (LA) codes. */
export function collectCodes(results: LoincQueryResult[]): Set<string> {
  const codes = new Set<string>()
  for (const hit of results.flatMap(result => result.hits)) {
    codes.add(hit.code)
    for (const answer of hit.answers ?? []) codes.add(answer.code)
  }
  return codes
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

async function searchOne(query: string, kind: LoincQueryResult['kind'], options: HttpOptions): Promise<LoincQueryResult> {
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
    return { query, kind, hits: parseSearchResponse(await response.json()) }
  } catch (error) {
    if (request.callerAborted()) throw error
    const reason = request.timedOut() ? 'timed out' : 'failed'
    return { query, kind, hits: [], error: `LOINC search ${reason}` }
  }
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
