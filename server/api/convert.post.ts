import Anthropic from '@anthropic-ai/sdk'
import type { ConvertEvent } from '../../shared/types'
import { runAgent } from '../lib/agent'
import { type AppConfig, loadConfig } from '../lib/config'
import { InputError } from '../lib/errors'
import { parseFormInput } from '../lib/input'
import { searchLoinc } from '../lib/loinc'
import { clientKey, createRateLimiter } from '../lib/rate-limit'
import { toUserError } from '../lib/user-error'
import { validateQuestionnaire } from '../lib/validate'

const RUN_BUDGET_MS = 120_000
// Multipart overhead on top of the largest allowed file or text.
const BODY_OVERHEAD_BYTES = 256 * 1024

let limiter: ReturnType<typeof createRateLimiter> | undefined

/** POST multipart (`text` or `file`) → text/event-stream of ConvertEvent JSON objects. */
export default defineEventHandler(async (event) => {
  const config = loadConfig()
  let input
  try {
    checkSameSite(event)
    checkBodySize(event, config)
    input = parseFormInput(await readMultipartFormData(event), config)
    // Only requests that will reach Claude count against the limit.
    checkRateLimit(event, config)
  } catch (error) {
    throw userFacingError(error)
  }

  const runId = crypto.randomUUID()
  const stream = createEventStream(event)
  const disconnected = new AbortController()
  stream.onClosed(() => disconnected.abort())
  const budget = AbortSignal.timeout(RUN_BUDGET_MS)
  const signal = AbortSignal.any([disconnected.signal, budget])

  const client = new Anthropic({ apiKey: config.apiKey })
  const emit = (convertEvent: ConvertEvent) => {
    log(runId, convertEvent)
    // The client may have disconnected: writing to a closed stream must not crash the process.
    stream.push(JSON.stringify(convertEvent)).catch(() => {})
  }

  const run = async () => {
    try {
      await runAgent(input, {
        model: config.model,
        createMessage: (params, options) => client.beta.messages.create(params, options),
        searchLoinc: (query, s) => searchLoinc(query, { baseUrl: config.loincSearchUrl, signal: s }),
        validate: (q, codes, s) => validateQuestionnaire(q, codes, { baseUrl: config.validatorUrl, signal: s }),
        countTokens: async (messages, s) =>
          (await client.beta.messages.countTokens({ model: config.model, messages }, { signal: s })).input_tokens
      }, emit, signal)
    } catch (error) {
      if (disconnected.signal.aborted) return
      const userError = toUserError(error, { timedOut: budget.aborted })
      if (userError.status === 500) console.error(JSON.stringify({ runId, error: String(error) }))
      emit({ type: 'error', message: userError.message, ...(userError.service ? { service: userError.service } : {}) })
    } finally {
      await stream.close().catch(() => {})
    }
  }
  run().catch(error => console.error(JSON.stringify({ runId, error: String(error) })))

  return stream.send()
})

function checkRateLimit(event: Parameters<typeof getRequestIP>[0], config: AppConfig) {
  limiter ??= createRateLimiter({ perHour: config.rateLimitPerHour, perDay: config.rateLimitPerDay })
  // Vercel overwrites x-forwarded-for with the real client IP (client values are not forwarded,
  // to prevent spoofing); locally we fall back to the socket address.
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  const decision = limiter.take(clientKey(ip))
  if (!decision.allowed) {
    setResponseHeader(event, 'retry-after', decision.retryAfterSeconds)
    const minutes = Math.ceil(decision.retryAfterSeconds / 60)
    throw new InputError(`Demo limit reached. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, 429)
  }
}

/**
 * A plain HTML form on another site can POST multipart here without a CORS preflight, and each
 * visitor would spend paid runs. Browsers label such requests with Sec-Fetch-Site; non-browser
 * clients (curl, the eval script) send none and stay subject to the rate limit.
 */
function checkSameSite(event: Parameters<typeof getRequestHeader>[0]) {
  const site = getRequestHeader(event, 'sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') {
    throw new InputError('Cross-site requests are not allowed.', 403)
  }
}

/** Reject before buffering: readMultipartFormData reads the whole body into memory. */
function checkBodySize(event: Parameters<typeof getRequestHeader>[0], config: AppConfig) {
  const header = getRequestHeader(event, 'content-length')
  if (!header) throw new InputError('Missing Content-Length header.', 411)
  if (Number(header) > config.maxFileBytes + BODY_OVERHEAD_BYTES) throw new InputError('The upload is too large.', 413)
}

function userFacingError(error: unknown) {
  const { message, status } = toUserError(error)
  return createError({ statusCode: status, statusMessage: message, data: { message } })
}

/** One structured line per event. Never logs form content or the generated Questionnaire. */
function log(runId: string, event: ConvertEvent) {
  const summary = event.type === 'result'
    ? { valid: event.result.valid, iterations: event.result.iterations, issues: event.result.issues.length, usage: event.result.usage, durationMs: event.result.durationMs }
    : event.type === 'step' ? event.step : { message: event.message, service: event.service }
  console.log(JSON.stringify({ runId, type: event.type, ...summary }))
}
