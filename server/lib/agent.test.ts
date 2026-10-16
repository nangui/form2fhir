import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import type { ConvertEvent, ValidationIssue } from '../../shared/types'
import { type AgentDeps, runAgent } from './agent'
import { AgentError, ServiceUnavailableError } from './errors'
import type { LoincQueryResult } from './loinc'
import { LAST_TURN_PROMPT, NUDGE_PROMPT, SYSTEM_PROMPT } from './prompt'

type Block = Anthropic.Beta.BetaContentBlock
type Params = Anthropic.Beta.MessageCreateParamsNonStreaming

const QUESTIONNAIRE = { resourceType: 'Questionnaire', status: 'draft', item: [{ linkId: 'hr', type: 'integer', text: 'Heart rate' }] }
const HEART_RATE: LoincQueryResult[] = [{ query: 'heart rate', kind: 'question', hits: [{ code: '8867-4', display: 'Heart rate' }] }]
const ERROR: ValidationIssue = { severity: 'error', source: 'hapi', message: 'que-1 failed', location: 'Questionnaire.item[0]' }
const WARNING: ValidationIssue = { severity: 'warning', source: 'hapi', message: 'dom-6' }

let toolId = 0
const thinking = (): Block => ({ type: 'thinking', thinking: '', signature: 'sig' } as Block)
const searchCall = (input: unknown = { questions: ['heart rate'] }): Block => ({ type: 'tool_use', id: `t${++toolId}`, name: 'search_loinc', input } as Block)
const submitCall = (questionnaire: unknown = QUESTIONNAIRE): Block => ({ type: 'tool_use', id: `t${++toolId}`, name: 'submit_questionnaire', input: { questionnaire } } as Block)

function reply(content: Block[], stop_reason: Anthropic.Beta.BetaStopReason = 'tool_use'): Anthropic.Beta.BetaMessage {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content,
    stop_reason,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 }
  } as unknown as Anthropic.Beta.BetaMessage
}

function setup(replies: Anthropic.Beta.BetaMessage[], overrides: Partial<AgentDeps> = {}) {
  const calls: Params[] = []
  const createMessage = vi.fn(async (params: Params) => {
    calls.push(structuredClone(params))
    const next = replies.shift()
    if (!next) throw new Error('no scripted reply left')
    return next
  })
  const deps: AgentDeps = {
    model: 'claude-sonnet-5-5',
    createMessage,
    searchLoinc: vi.fn(async () => HEART_RATE),
    validate: vi.fn(async () => ({ valid: true, issues: [WARNING] })),
    ...overrides
  }
  const events: ConvertEvent[] = []
  const run = () => runAgent({ kind: 'text', text: 'Heart rate: ____' }, deps, event => events.push(event))
  return { deps, calls, events, run }
}

function steps(events: ConvertEvent[]) {
  return events.flatMap(e => (e.type === 'step' && e.step.status !== 'running' ? [`${e.step.status}: ${e.step.label}`] : []))
}

function lastToolResults(params: Params) {
  const last = params.messages.at(-1)!
  return last.content as Anthropic.Beta.BetaToolResultBlockParam[]
}

describe('runAgent', () => {
  it('searches, submits a valid Questionnaire and reports the result', async () => {
    const { deps, calls, events, run } = setup([
      reply([thinking(), searchCall()]),
      reply([submitCall()])
    ])

    const result = await run()

    expect(result).toMatchObject({ valid: true, questionnaire: QUESTIONNAIRE, issues: [WARNING], iterations: 2, model: 'claude-sonnet-5-5' })
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 100, cacheReadTokens: 20, cacheWriteTokens: 10 })
    expect(events.at(-1)).toEqual({ type: 'result', result })
    expect(steps(events)).toEqual([
      'done: Reading the form',
      'done: search_loinc ×1',
      'done: Drafting the Questionnaire',
      'done: Valid FHIR R4'
    ])
    expect(deps.validate).toHaveBeenCalledWith(QUESTIONNAIRE, new Set(['8867-4']), undefined)
    expect(calls).toHaveLength(2)
  })

  it('sends a cached system prompt, tools, capped tokens and the fenced form', async () => {
    const { calls, run } = setup([reply([submitCall()])])

    await run()

    const params = calls[0]!
    expect(params).toMatchObject({
      model: 'claude-sonnet-5-5',
      max_tokens: 16_000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default'
    })
    expect(params.tools!.map(t => (t as { name: string }).name)).toEqual(['search_loinc', 'submit_questionnaire'])
    expect(params.tool_choice).toBeUndefined() // forced tool choice returns 400 on 5.5 models
    expect(params.messages[0]!.content).toEqual([
      { type: 'text', text: '<form_content>\nHeart rate: ____\n</form_content>' },
      { type: 'text', text: 'Convert this form into a valid FHIR R4 Questionnaire.' }
    ])
  })

  it('omits the fallback beta for models that do not support it', async () => {
    const { calls, run } = setup([reply([submitCall()])], { model: 'claude-haiku-5-5' })

    await run()

    expect(calls[0]).not.toHaveProperty('fallbacks')
    expect(calls[0]).not.toHaveProperty('betas')
  })

  it('returns validation errors to the model as is_error and stops once it fixes them', async () => {
    const validate = vi.fn()
      .mockResolvedValueOnce({ valid: false, issues: [ERROR, WARNING] })
      .mockResolvedValueOnce({ valid: true, issues: [] })
    const { calls, events, run } = setup([
      reply([searchCall()]),
      reply([submitCall()]),
      reply([submitCall()])
    ], { validate })

    const result = await run()

    expect(result).toMatchObject({ valid: true, iterations: 3 })
    const [toolResult] = lastToolResults(calls[2]!)
    expect(toolResult).toMatchObject({ type: 'tool_result', is_error: true })
    expect(toolResult!.content).toBe('Validation failed with 1 error. Fix all of them and submit the complete Questionnaire again.\n- Questionnaire.item[0]: que-1 failed')
    expect(steps(events)).toContain('error: Validation failed (1 error)')
    expect(steps(events)).toContain('done: Fixing validation errors')
    expect(steps(events).at(-1)).toBe('done: Fixed — valid FHIR R4')
  })

  it('stops after 4 Claude calls and returns the last attempt as not valid', async () => {
    const { deps, run } = setup(
      Array.from({ length: 5 }, () => reply([submitCall()])),
      { validate: vi.fn(async () => ({ valid: false, issues: [ERROR] })) }
    )

    const result = await run()

    expect(deps.createMessage).toHaveBeenCalledTimes(4)
    expect(result).toMatchObject({ valid: false, iterations: 4, questionnaire: QUESTIONNAIRE, issues: [ERROR] })
  })

  it('throws when the model refuses, without running tools', async () => {
    const { deps, run } = setup([reply([submitCall()], 'refusal')])

    await expect(run()).rejects.toThrow(new AgentError('Claude declined to process this input. Try a different form.'))
    expect(deps.validate).not.toHaveBeenCalled()
  })

  it('throws when the output was cut off by max_tokens, without running the truncated tool call', async () => {
    const { deps, run } = setup([reply([submitCall({ resourceType: 'Questionnaire' })], 'max_tokens')])

    await expect(run()).rejects.toThrow('The form is too large to convert in one go. Try a shorter form or fewer pages.')
    expect(deps.validate).not.toHaveBeenCalled()
  })

  it('nudges the model once when it ends a turn without calling a tool', async () => {
    const { calls, run } = setup([
      reply([{ type: 'text', text: 'Here is the questionnaire…' } as Block], 'end_turn'),
      reply([submitCall()])
    ])

    const result = await run()

    expect(result.valid).toBe(true)
    expect(calls[1]!.messages.at(-1)).toEqual({ role: 'user', content: NUDGE_PROMPT })
  })

  it('tells the model when its next turn is the last one', async () => {
    const { calls, run } = setup([
      reply([searchCall()]),
      reply([searchCall()]),
      reply([searchCall()]),
      reply([submitCall()])
    ])

    await run()

    const lastTurn = calls[3]!.messages.at(-1)!.content as Anthropic.Beta.BetaContentBlockParam[]
    expect(lastTurn.at(-1)).toEqual({ type: 'text', text: LAST_TURN_PROMPT })
    const earlier = calls[2]!.messages.at(-1)!.content as Anthropic.Beta.BetaContentBlockParam[]
    expect(earlier.every(block => block.type === 'tool_result')).toBe(true)
  })

  it('labels a turn after a failed tool call as a correction, not as drafting', async () => {
    const { events, run } = setup([
      reply([searchCall({})]),
      reply([submitCall()])
    ])

    await run()

    expect(steps(events)).toEqual(['done: Reading the form', 'done: Correcting a tool call', 'done: Valid FHIR R4'])
  })

  it('uses the refusal fallback for dated snapshots of supported models', async () => {
    const { calls, run } = setup([reply([submitCall()])], { model: 'claude-sonnet-5-5-20261001' })

    await run()

    expect(calls[0]).toMatchObject({ fallbacks: 'default' })
  })

  it('throws when no Questionnaire was ever submitted', async () => {
    const { run } = setup(Array.from({ length: 4 }, () => reply([searchCall()])))

    await expect(run()).rejects.toThrow('The agent did not produce a Questionnaire within 4 steps.')
  })

  it('answers parallel tool calls in one user message, searching before validating', async () => {
    const validate = vi.fn(async () => ({ valid: true, issues: [] }))
    const { calls, run } = setup([
      reply([submitCall(), searchCall()]),
      reply([{ type: 'text', text: 'Done.' } as Block], 'end_turn')
    ], { validate })

    await run()

    expect(validate).toHaveBeenCalledWith(QUESTIONNAIRE, new Set(['8867-4']), undefined)
    expect(calls).toHaveLength(1)
  })

  it('keeps the history append-only, passing assistant content back unchanged', async () => {
    const first = [thinking(), searchCall()]
    const { calls, run } = setup([reply(first), reply([submitCall()])])

    await run()

    expect(calls[1]!.messages[1]).toEqual({ role: 'assistant', content: first })
    expect(calls[1]!.messages[0]).toEqual(calls[0]!.messages[0])
  })

  it('reports bad tool input and unknown tools to the model instead of failing', async () => {
    const { calls, run } = setup([
      reply([searchCall({ questions: [] }), { type: 'tool_use', id: 'x', name: 'fetch_url', input: {} } as Block, submitCall('not json')]),
      reply([submitCall()])
    ], {
      validate: vi.fn()
        .mockResolvedValueOnce({ valid: false, issues: [{ severity: 'error', source: 'local', message: 'Not a Questionnaire' }] })
        .mockResolvedValueOnce({ valid: true, issues: [] })
    })

    await run()

    expect(lastToolResults(calls[1]!).map(r => [r.is_error, r.content])).toEqual([
      [true, 'Provide at least one entry in "questions" or "panels".'],
      [true, 'Unknown tool "fetch_url".'],
      [true, 'Validation failed with 1 error. Fix all of them and submit the complete Questionnaire again.\n- Not a Questionnaire']
    ])
  })

  it('refuses a form whose token count exceeds the budget before any paid call', async () => {
    const { deps, run } = setup([reply([submitCall()])], { countTokens: vi.fn(async () => 45_000) })

    await expect(run()).rejects.toThrow('This form is too long for the demo (about 45,000 tokens, max 30,000). Try fewer pages.')
    expect(deps.createMessage).not.toHaveBeenCalled()
  })

  it('caps the total number of LOINC searches per run', async () => {
    const searchLoinc = vi.fn(async () => HEART_RATE)
    const many = (n: number) => searchCall({ questions: Array.from({ length: n }, (_, i) => `term ${i}`) })
    const { calls, run } = setup([
      reply([many(25), many(25), many(25)]),
      reply([submitCall()])
    ], { searchLoinc })

    await run()

    expect(searchLoinc).toHaveBeenCalledTimes(2)
    expect(lastToolResults(calls[1]!)[2]).toMatchObject({
      is_error: true,
      content: 'LOINC search budget used up (60 terms per run). Submit the Questionnaire with the codes you already have.'
    })
  })

  it('lets an unavailable external service end the run', async () => {
    const { run } = setup([reply([searchCall()])], {
      searchLoinc: vi.fn(async () => {
        throw new ServiceUnavailableError('loinc', 'LOINC search is unavailable right now. Try again in a minute.')
      })
    })

    await expect(run()).rejects.toThrow(ServiceUnavailableError)
  })
})
