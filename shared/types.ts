export interface ValidationIssue {
  severity: 'error' | 'warning'
  source: 'local' | 'hapi'
  message: string
  /** FHIRPath-like location, e.g. `Questionnaire.item[1]`. */
  location?: string
}

export type ExternalService = 'loinc' | 'validator' | 'claude'

export interface TraceStep {
  id: string
  kind: 'model' | 'search_loinc' | 'validate'
  status: 'running' | 'done' | 'error'
  label: string
  detail?: string
  durationMs?: number
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** Where an item comes from in the original form, as quoted by the agent. */
export interface ItemSource {
  linkId: string
  excerpt: string
  /** Found in the pasted text (true/false); null when it cannot be checked (PDF, image, very short quote). */
  found: boolean | null
}

export interface ConvertResult {
  /** The last submitted Questionnaire (FHIR JSON). */
  questionnaire: unknown
  /** The form's own words behind each item, from the same submission. */
  sources: ItemSource[]
  /** True only when local checks and HAPI $validate reported no errors. */
  valid: boolean
  issues: ValidationIssue[]
  /** Number of Claude calls used. */
  iterations: number
  model: string
  usage: TokenUsage
  durationMs: number
}

/** Server-sent events emitted by POST /api/convert, one JSON object per `data:` line. */
export type ConvertEvent
  = | { type: 'step', step: TraceStep }
    | { type: 'result', result: ConvertResult }
    | { type: 'error', message: string, service?: ExternalService }
