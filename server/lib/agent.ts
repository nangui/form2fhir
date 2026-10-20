import type Anthropic from '@anthropic-ai/sdk'
import type { ConvertEvent, ConvertResult, TokenUsage, TraceStep, ValidationIssue } from '../../shared/types'
import { AgentError, ToolInputError } from './errors'
import { type FormInput, toContentBlocks } from './input'
import { collectEvidence, type LoincQueryResult, parseSearchInput, type SearchLoincInput } from './loinc'
import { LAST_TURN_PROMPT, NUDGE_PROMPT, SYSTEM_PROMPT, TASK_PROMPT, TOOLS } from './prompt'
import type { Evidence, ValidationResult } from './validate'

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam
type ToolUse = Anthropic.Beta.BetaToolUseBlock

export interface AgentDeps {
  model: string
  createMessage: (params: Params, options: { signal?: AbortSignal }) => Promise<Anthropic.Beta.BetaMessage>
  searchLoinc: (input: SearchLoincInput, signal?: AbortSignal) => Promise<LoincQueryResult[]>
  validate: (questionnaire: unknown, evidence: Evidence, signal?: AbortSignal) => Promise<ValidationResult>
  /** Token count of the form message (free endpoint), checked before any paid call. */
  countTokens?: (messages: Anthropic.Beta.BetaMessageParam[], signal?: AbortSignal) => Promise<number>
}

const MAX_ITERATIONS = 4
const MAX_TOKENS = 16_000
// The form is resent on every iteration; this bounds the cost of a long PDF whose pages
// our cheap page counter missed.
const MAX_FORM_TOKENS = 30_000
// search_loinc takes up to 25 terms per call, but the number of calls per turn is the model's.
const MAX_SEARCH_TERMS = 60
// Server-side refusal fallback (beta) is only accepted by these models (and their dated snapshots).
const FALLBACK_MODEL_PREFIXES = ['claude-sonnet-5-5', 'claude-opus-5', 'claude-fable-5-1']

type LastAction = 'start' | 'search' | 'tool_error' | 'invalid' | 'nudge'

/**
 * The model proposes, the validator decides: loop until submit_questionnaire passes validation,
 * at most MAX_ITERATIONS Claude calls. Every step is emitted as a trace event.
 */
export async function runAgent(
  input: FormInput,
  deps: AgentDeps,
  emit: (event: ConvertEvent) => void,
  signal?: AbortSignal
): Promise<ConvertResult> {
  const startedAt = Date.now()
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: 'user', content: [...toContentBlocks(input), { type: 'text', text: TASK_PROMPT }] }
  ]
  if (deps.countTokens) {
    const tokens = await deps.countTokens(messages, signal)
    if (tokens > MAX_FORM_TOKENS) {
      throw new AgentError(`This form is too long for the demo (about ${tokens.toLocaleString('en-US')} tokens, max ${MAX_FORM_TOKENS.toLocaleString('en-US')}). Try fewer pages.`)
    }
  }
  // Every search result of the run: validation checks codes, answer scores and panels against them.
  const found: LoincQueryResult[] = []
  const searchBudget = { remaining: MAX_SEARCH_TERMS }
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const trace = createTrace(emit)
  let lastSubmission: { questionnaire: unknown, validation: ValidationResult } | undefined
  let hadInvalidSubmission = false
  let lastAction: LastAction = 'start'

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    const response = await trace.run('model', modelLabel(lastAction), () =>
      deps.createMessage(requestParams(deps.model, messages), { signal }))
    addUsage(usage, response.usage)

    if (response.stop_reason === 'refusal') throw new AgentError('Claude declined to process this input. Try a different form.')
    if (response.stop_reason === 'max_tokens') {
      throw new AgentError('The form is too large to convert in one go. Try a shorter form or fewer pages.')
    }

    // Append-only history: assistant content (thinking blocks included) goes back unchanged.
    messages.push({ role: 'assistant', content: response.content })
    const toolUses = response.content.filter((block): block is ToolUse => block.type === 'tool_use')
    if (toolUses.length === 0) {
      messages.push({ role: 'user', content: NUDGE_PROMPT })
      lastAction = 'nudge'
      continue
    }

    const results: ToolResult[] = []
    // Searches first, so a submission in the same turn can use the codes they return.
    for (const toolUse of toolUses.filter(t => t.name !== 'submit_questionnaire')) {
      const result = await runSearch(toolUse, deps, found, searchBudget, trace, signal)
      results.push(result)
      lastAction = result.is_error ? 'tool_error' : 'search'
    }
    for (const toolUse of toolUses.filter(t => t.name === 'submit_questionnaire')) {
      const questionnaire = (toolUse.input as { questionnaire?: unknown }).questionnaire
      const validation = await trace.run('validate', 'Validating the Questionnaire', () =>
        deps.validate(questionnaire, collectEvidence(found), signal), result => validationLabel(result, hadInvalidSubmission))
      lastSubmission = { questionnaire, validation }
      results.push(validationResult(toolUse.id, validation))
      if (validation.valid) break
      hadInvalidSubmission = true
      lastAction = 'invalid'
    }

    if (lastSubmission?.validation.valid) return finish(lastSubmission, iteration)
    const nextIsLast = iteration + 1 === MAX_ITERATIONS
    messages.push({ role: 'user', content: nextIsLast ? [...results, { type: 'text', text: LAST_TURN_PROMPT }] : results })
  }

  // Out of iterations: return the last attempt, honestly marked as not valid.
  if (lastSubmission) return finish(lastSubmission, MAX_ITERATIONS)
  throw new AgentError(`The agent did not produce a Questionnaire within ${MAX_ITERATIONS} steps.`)

  function finish(submission: { questionnaire: unknown, validation: ValidationResult }, iterations: number): ConvertResult {
    const result: ConvertResult = {
      questionnaire: submission.questionnaire,
      valid: submission.validation.valid,
      issues: submission.validation.issues,
      iterations,
      model: deps.model,
      usage,
      durationMs: Date.now() - startedAt
    }
    emit({ type: 'result', result })
    return result
  }
}

function requestParams(model: string, messages: Anthropic.Beta.BetaMessageParam[]): Params {
  return {
    model,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    // Breakpoint on the system prompt caches tools + system; top-level auto-caching covers the
    // history, which matters because an uploaded PDF or image is resent on every iteration.
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    cache_control: { type: 'ephemeral' },
    tools: TOOLS,
    messages: [...messages],
    ...(FALLBACK_MODEL_PREFIXES.some(prefix => model.startsWith(prefix)) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
  }
}

async function runSearch(
  toolUse: ToolUse,
  deps: AgentDeps,
  found: LoincQueryResult[],
  searchBudget: { remaining: number },
  trace: Trace,
  signal?: AbortSignal
): Promise<ToolResult> {
  if (toolUse.name !== 'search_loinc') return toolError(toolUse.id, `Unknown tool "${toolUse.name}".`)
  let input: SearchLoincInput
  try {
    input = parseSearchInput(toolUse.input)
  } catch (error) {
    if (error instanceof ToolInputError) return toolError(toolUse.id, error.message)
    throw error
  }

  const count = (input.questions?.length ?? 0) + (input.panels?.length ?? 0)
  if (count > searchBudget.remaining) {
    return toolError(toolUse.id, `LOINC search budget used up (${MAX_SEARCH_TERMS} terms per run). Submit the Questionnaire with the codes you already have.`)
  }
  searchBudget.remaining -= count
  const results = await trace.run('search_loinc', `Searching LOINC ×${count}`, () => deps.searchLoinc(input, signal), found => ({
    label: `search_loinc ×${count}`,
    detail: `${found.filter(r => r.hits.length > 0).length} of ${count} terms matched`
  }))
  found.push(...results)
  return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(results) }
}

function validationResult(toolUseId: string, validation: ValidationResult): ToolResult {
  if (validation.valid) return { type: 'tool_result', tool_use_id: toolUseId, content: 'valid' }
  const errors = validation.issues.filter(issue => issue.severity === 'error')
  const lines = errors.map(issue => `- ${issue.location ? `${issue.location}: ` : ''}${issue.message}`)
  return toolError(toolUseId, `Validation failed with ${plural(errors.length, 'error')}. Fix all of them and submit the complete Questionnaire again.\n${lines.join('\n')}`)
}

function validationLabel(result: ValidationResult, fixesEarlierFailure: boolean) {
  if (result.valid) return { label: fixesEarlierFailure ? 'Fixed — valid FHIR R4' : 'Valid FHIR R4' }
  const errors = result.issues.filter((issue: ValidationIssue) => issue.severity === 'error').length
  return { label: `Validation failed (${plural(errors, 'error')})`, status: 'error' as const }
}

function modelLabel(lastAction: LastAction): string {
  return {
    start: 'Reading the form',
    search: 'Drafting the Questionnaire',
    tool_error: 'Correcting a tool call',
    invalid: 'Fixing validation errors',
    nudge: 'Asking for the Questionnaire'
  }[lastAction]
}

function toolError(toolUseId: string, message: string): ToolResult {
  return { type: 'tool_result', tool_use_id: toolUseId, content: message, is_error: true }
}

function addUsage(total: TokenUsage, usage: Anthropic.Beta.BetaUsage) {
  total.inputTokens += usage.input_tokens
  total.outputTokens += usage.output_tokens
  total.cacheReadTokens += usage.cache_read_input_tokens ?? 0
  total.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

type Trace = ReturnType<typeof createTrace>

/** Wraps a unit of work in running → done/error trace events with its duration. */
function createTrace(emit: (event: ConvertEvent) => void) {
  const counters: Record<string, number> = {}
  return {
    async run<T>(
      kind: TraceStep['kind'],
      label: string,
      work: () => Promise<T>,
      describe?: (result: T) => { label?: string, detail?: string, status?: TraceStep['status'] }
    ): Promise<T> {
      const id = `${kind}-${(counters[kind] = (counters[kind] ?? 0) + 1)}`
      const startedAt = Date.now()
      emit({ type: 'step', step: { id, kind, status: 'running', label } })
      try {
        const result = await work()
        const outcome = describe?.(result) ?? {}
        emit({ type: 'step', step: { id, kind, status: outcome.status ?? 'done', label: outcome.label ?? label, ...(outcome.detail ? { detail: outcome.detail } : {}), durationMs: Date.now() - startedAt } })
        return result
      } catch (error) {
        emit({ type: 'step', step: { id, kind, status: 'error', label, durationMs: Date.now() - startedAt } })
        throw error
      }
    }
  }
}
