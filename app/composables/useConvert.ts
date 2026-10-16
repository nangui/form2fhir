import type { ConvertEvent, ConvertResult, TraceStep } from '../../shared/types'
import { loincCoverage } from '../utils/questionnaire'
import { createSseParser } from '../utils/sse'

export type ConvertInput = { text: string } | { file: File }

/** Runs POST /api/convert and exposes its trace and result as reactive state. */
export function useConvert() {
  const status = ref<'idle' | 'running' | 'done' | 'error'>('idle')
  const steps = ref<TraceStep[]>([])
  const result = ref<ConvertResult>()
  const error = ref<string>()
  // Derived once per result and shared by the trace summary, the Codes tab and its badge.
  const coverage = computed(() => (result.value ? loincCoverage(result.value.questionnaire) : undefined))
  let current: AbortController | undefined

  async function convert(input: ConvertInput) {
    current?.abort()
    const controller = new AbortController()
    current = controller
    status.value = 'running'
    steps.value = []
    result.value = undefined
    error.value = undefined

    const body = new FormData()
    if ('text' in input) body.append('text', input.text)
    else body.append('file', input.file)

    try {
      const response = await fetch('/api/convert', { method: 'POST', body, signal: controller.signal })
      if (!response.ok || !response.body) throw new Error(await errorMessage(response))
      await readEvents(response.body, handle)
      if (status.value === 'running') fail('The connection closed before the conversion finished.')
    } catch (e) {
      // This run was replaced or cancelled: its errors must not touch the newer run's state.
      if (controller.signal.aborted) return
      fail(e instanceof Error && e.message ? e.message : 'Could not reach the server.')
    }
  }

  function handle(event: ConvertEvent) {
    if (event.type === 'step') {
      const index = steps.value.findIndex(step => step.id === event.step.id)
      if (index === -1) steps.value.push(event.step)
      else steps.value[index] = event.step
    } else if (event.type === 'result') {
      result.value = event.result
      status.value = 'done'
    } else {
      fail(event.message)
    }
  }

  function fail(message: string) {
    error.value = message
    status.value = 'error'
  }

  onScopeDispose(() => current?.abort())

  return { status, steps, result, coverage, error, convert }
}

async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (event: ConvertEvent) => void) {
  const parser = createSseParser(data => onEvent(JSON.parse(data) as ConvertEvent))
  const decoder = new TextDecoder()
  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parser.push(decoder.decode(value, { stream: true }))
  }
  parser.push(decoder.decode())
  parser.end()
}

async function errorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => undefined) as { data?: { message?: string }, statusMessage?: string } | undefined
  return body?.data?.message ?? body?.statusMessage ?? `The server answered ${response.status}.`
}
