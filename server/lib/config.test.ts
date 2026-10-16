import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'

describe('loadConfig', () => {
  it('uses safe defaults when only the API key is set', () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: 'test-key' })

    expect(config).toEqual({
      apiKey: 'test-key',
      model: 'claude-sonnet-5-5',
      fastModel: 'claude-haiku-5-5',
      validatorUrl: 'https://hapi.fhir.org/baseR4',
      loincSearchUrl: 'https://clinicaltables.nlm.nih.gov/api/loinc_items/v3/search',
      rateLimitPerHour: 5,
      rateLimitPerDay: 100,
      maxTextChars: 20_000,
      maxFileBytes: 3 * 1024 * 1024,
      maxPdfPages: 5
    })
  })

  it('reads overrides from env', () => {
    const config = loadConfig({
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_MODEL: 'claude-haiku-5-5',
      VALIDATOR_URL: 'http://localhost:8080/fhir/',
      RATE_LIMIT_PER_HOUR: '50'
    })

    expect(config.model).toBe('claude-haiku-5-5')
    expect(config.validatorUrl).toBe('http://localhost:8080/fhir')
    expect(config.rateLimitPerHour).toBe(50)
  })

  it('rejects a missing API key', () => {
    expect(() => loadConfig({})).toThrow('ANTHROPIC_API_KEY is not set')
  })

  it('rejects non-numeric limits instead of silently disabling them', () => {
    expect(() => loadConfig({ ANTHROPIC_API_KEY: 'k', MAX_PDF_PAGES: 'lots' }))
      .toThrow('MAX_PDF_PAGES must be a positive integer')
  })
})
