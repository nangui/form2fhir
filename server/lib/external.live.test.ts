// Smoke tests against the real NLM Clinical Tables and HAPI FHIR APIs (no Claude calls).
// Run with `pnpm test:live`. They catch upstream format changes the recordings can't.
import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'
import { collectCodes, collectEvidence, searchLoinc } from './loinc'
import { validateQuestionnaire } from './validate'

const config = loadConfig({ ...process.env, ANTHROPIC_API_KEY: 'unused' })

describe('live: LOINC search', () => {
  it('finds standard vital-sign codes and the PHQ-9 panel with its answer list', async () => {
    const results = await searchLoinc(
      { questions: ['heart rate', 'systolic blood pressure', 'little interest or pleasure in doing things'], panels: ['PHQ-9'] },
      { baseUrl: config.loincSearchUrl }
    )

    expect(results.map(r => r.hits[0]?.code)).toEqual(['8867-4', '8480-6', '44250-9', '44249-1'])
    expect(collectCodes(results).has('LA6568-5')).toBe(true)
  }, 30_000)

  it('expands the top panel hit with its official questions and answer scores', async () => {
    const results = await searchLoinc({ panels: ['PHQ-9'] }, { baseUrl: config.loincSearchUrl })
    const evidence = collectEvidence(results)

    expect(evidence.panels.get('44249-1')?.has('69722-7')).toBe(true) // the panel's own difficulty question
    expect(evidence.answerScores.get('44250-9')?.get('LA6571-9')).toBe(3)
  }, 30_000)
})

describe('live: HAPI $validate', () => {
  const heartRate = {
    resourceType: 'Questionnaire',
    status: 'draft',
    title: 'Heart rate check',
    item: [{ linkId: 'hr', type: 'integer', text: 'Heart rate', code: [{ system: 'http://loinc.org', code: '8867-4' }] }]
  }

  it('accepts a valid Questionnaire', async () => {
    const result = await validateQuestionnaire(heartRate, new Set(['8867-4']), { baseUrl: config.validatorUrl })

    expect(result.issues.filter(i => i.severity === 'error')).toEqual([])
    expect(result.valid).toBe(true)
  }, 60_000)

  it('accepts LOINC answers weighted with ordinalValue on answerOption', async () => {
    const phq = {
      ...heartRate,
      item: [{
        linkId: 'phq9-1',
        type: 'choice',
        text: 'Little interest or pleasure in doing things',
        code: [{ system: 'http://loinc.org', code: '44250-9' }],
        answerOption: [
          { valueCoding: { system: 'http://loinc.org', code: 'LA6568-5', display: 'Not at all' }, extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/ordinalValue', valueDecimal: 0 }] },
          { valueCoding: { system: 'http://loinc.org', code: 'LA6569-3', display: 'Several days' }, extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/ordinalValue', valueDecimal: 1 }] }
        ]
      }]
    }
    const evidence = { codes: new Set(['44250-9', 'LA6568-5', 'LA6569-3']), answerScores: new Map([['44250-9', new Map<string, number | null>([['LA6568-5', 0], ['LA6569-3', 1]])]]), panels: new Map() }

    const result = await validateQuestionnaire(phq, evidence, { baseUrl: config.validatorUrl })

    expect(result.issues.filter(i => i.severity === 'error')).toEqual([])
  }, 60_000)

  it('rejects an invalid one', async () => {
    const invalid = { ...heartRate, item: [...heartRate.item, { linkId: 'hr', type: 'group' }] }

    const result = await validateQuestionnaire(invalid, new Set(['8867-4']), { baseUrl: config.validatorUrl })

    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.source === 'hapi' && i.message.includes('que-1'))).toBe(true)
  }, 60_000)
})
