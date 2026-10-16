type Env = Record<string, string | undefined>

export interface AppConfig {
  apiKey: string
  model: string
  fastModel: string
  validatorUrl: string
  loincSearchUrl: string
  rateLimitPerHour: number
  rateLimitPerDay: number
  maxTextChars: number
  maxFileBytes: number
  maxPdfPages: number
}

export function loadConfig(env: Env = process.env): AppConfig {
  const apiKey = env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  return {
    apiKey,
    model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    fastModel: env.ANTHROPIC_FAST_MODEL || 'claude-haiku-5-5',
    validatorUrl: trimSlash(env.VALIDATOR_URL || 'https://hapi.fhir.org/baseR4'),
    loincSearchUrl: env.LOINC_SEARCH_URL || 'https://clinicaltables.nlm.nih.gov/api/loinc_items/v3/search',
    rateLimitPerHour: positiveInt(env, 'RATE_LIMIT_PER_HOUR', 5),
    rateLimitPerDay: positiveInt(env, 'RATE_LIMIT_PER_DAY', 100),
    maxTextChars: positiveInt(env, 'MAX_TEXT_CHARS', 20_000),
    maxFileBytes: positiveInt(env, 'MAX_FILE_BYTES', 3 * 1024 * 1024),
    maxPdfPages: positiveInt(env, 'MAX_PDF_PAGES', 5)
  }
}

function positiveInt(env: Env, name: string, fallback: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}
