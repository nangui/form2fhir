import type { ExternalService } from '../../shared/types'

/** An external API (LOINC search, FHIR validator) is down, slow or returned garbage. */
export class ServiceUnavailableError extends Error {
  constructor(readonly service: ExternalService, message: string) {
    super(message)
    this.name = 'ServiceUnavailableError'
  }
}

/** The model called a tool with input we can't use. The message is sent back to the model. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolInputError'
  }
}
