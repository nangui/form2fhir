import type { ExternalService } from '../../shared/types'

/** An external API (LOINC search, FHIR validator) is down, slow or returned garbage. */
export class ServiceUnavailableError extends Error {
  constructor(readonly service: ExternalService, message: string) {
    super(message)
    this.name = 'ServiceUnavailableError'
  }
}

/** The user's request is unusable (empty, too big, wrong file type). The message is shown to the user. */
export class InputError extends Error {
  constructor(message: string, readonly status: 400 | 411 | 413 | 415 | 429 = 400) {
    super(message)
    this.name = 'InputError'
  }
}

/** The agent run ended without a Questionnaire (refusal, truncated output, no submission). */
export class AgentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentError'
  }
}

/** The model called a tool with input we can't use. The message is sent back to the model. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolInputError'
  }
}
