// Runs every fixture in eval/fixtures.json through POST /api/convert and reports validity,
// Claude calls, LOINC coverage, time and estimated cost. COSTS API MONEY: one paid run per fixture.
//
//   node eval/run.ts [--url http://localhost:3000] [--only phq-9,bilan-diabete]
//
// Start the server first (pnpm dev, or the production URL). To compare models, start the server
// with ANTHROPIC_MODEL set to another model. Results are written to eval/results/<timestamp>/.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { parseArgs } from 'node:util'
import type { ConvertEvent, ConvertResult } from '../shared/types'
import { loincCoverage } from '../app/utils/questionnaire.ts'
import { createSseParser } from '../app/utils/sse.ts'
import { estimateCostUsd, toMarkdown, type EvalRow } from './report.ts'

interface Fixture {
  id: string
  name: string
  language: string
  file: string
}

const MEDIA_TYPES: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
const RUN_TIMEOUT_MS = 180_000

const { values: args } = parseArgs({ options: { url: { type: 'string', default: 'http://localhost:3000' }, only: { type: 'string' } } })
const evalDir = new URL('./', import.meta.url)

const fixtures = (JSON.parse(await readFile(new URL('fixtures.json', evalDir), 'utf8')) as Fixture[])
  .filter(fixture => !args.only || args.only.split(',').includes(fixture.id))

const outDir = new URL(`results/${new Date().toISOString().replace(/[:.]/g, '-')}/`, evalDir)
await mkdir(outDir, { recursive: true })

const rows: EvalRow[] = []
let model = 'unknown'
for (const fixture of fixtures) {
  process.stdout.write(`→ ${fixture.name} … `)
  const startedAt = Date.now()
  try {
    const result = await convert(fixture)
    model = result.model
    const coverage = loincCoverage(result.questionnaire)
    rows.push({
      id: fixture.id, name: fixture.name, language: fixture.language,
      valid: result.valid, iterations: result.iterations, ...coverage,
      durationMs: result.durationMs, usage: result.usage, costUsd: estimateCostUsd(result.model, result.usage)
    })
    await writeFile(new URL(`${fixture.id}.json`, outDir), JSON.stringify(result, null, 2))
    console.log(`${result.valid ? 'valid' : 'NOT valid'} · ${result.iterations} calls · ${coverage.coded}/${coverage.total} coded · ${(result.durationMs / 1000).toFixed(1)} s`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    rows.push({ id: fixture.id, name: fixture.name, language: fixture.language, valid: false, iterations: 0, coded: 0, total: 0, durationMs: Date.now() - startedAt, error: message })
    console.log(`ERROR · ${message}`)
  }
}

const markdown = toMarkdown(rows, { model, date: new Date().toISOString().slice(0, 10) })
await writeFile(new URL('summary.md', outDir), `${markdown}\n`)
await writeFile(new URL('summary.json', outDir), JSON.stringify({ url: args.url, model, rows }, null, 2))
console.log(`\n${markdown}\n\nSaved to ${outDir.pathname}`)

async function convert(fixture: Fixture): Promise<ConvertResult> {
  const path = new URL(fixture.file, evalDir)
  const form = new FormData()
  const mediaType = MEDIA_TYPES[extname(fixture.file).toLowerCase()]
  if (mediaType) form.append('file', new Blob([await readFile(path)], { type: mediaType }), fixture.file.split('/').pop())
  else form.append('text', await readFile(path, 'utf8'))

  // Serialize the multipart body first so the request carries a Content-Length (the API requires it).
  const encoded = new Request('http://local/', { method: 'POST', body: form })
  const response = await fetch(new URL('/api/convert', args.url), {
    method: 'POST',
    headers: { 'content-type': encoded.headers.get('content-type')! },
    body: await encoded.arrayBuffer(),
    signal: AbortSignal.timeout(RUN_TIMEOUT_MS)
  })
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => undefined) as { data?: { message?: string } } | undefined
    throw new Error(body?.data?.message ?? `HTTP ${response.status}`)
  }

  let result: ConvertResult | undefined
  let failure: string | undefined
  const parser = createSseParser((data) => {
    const event = JSON.parse(data) as ConvertEvent
    if (event.type === 'result') result = event.result
    if (event.type === 'error') failure = event.message
  })
  const decoder = new TextDecoder()
  for await (const chunk of response.body) parser.push(decoder.decode(chunk, { stream: true }))
  parser.end()

  if (result) return result
  throw new Error(failure ?? 'The stream ended without a result.')
}
