import Anthropic from '@anthropic-ai/sdk'
import type { ExternalService } from '../../shared/types'
import { AgentError, InputError, ServiceUnavailableError } from './errors'

export interface UserError {
  message: string
  status: number
  service?: ExternalService
}

/**
 * Turns any failure into a message that is safe and useful to show in the UI.
 * `timedOut` comes from the run budget signal: an aborted Claude call surfaces as
 * APIUserAbortError, an aborted fetch as a DOMException, so the error type alone can't tell.
 */
export function toUserError(error: unknown, { timedOut = false } = {}): UserError {
  if (timedOut) return { message: 'The conversion took too long and was stopped. Try a shorter form.', status: 504 }
  if (error instanceof InputError) return { message: error.message, status: error.status }
  if (error instanceof AgentError) return { message: error.message, status: 422 }
  if (error instanceof ServiceUnavailableError) return { message: error.message, status: 503, service: error.service }
  if (
    error instanceof Anthropic.RateLimitError
    || error instanceof Anthropic.InternalServerError
    || error instanceof Anthropic.APIConnectionError
  ) {
    return { message: 'Claude is busy right now. Try again in a minute.', status: 503, service: 'claude' }
  }
  // e.g. a PDF whose real page count our cheap guard missed, or an image Claude can't read.
  if (error instanceof Anthropic.APIError && (error.status === 400 || error.status === 413)) {
    return { message: 'Claude could not process this input (it may be too large or unreadable). Try a smaller or simpler form.', status: 422 }
  }
  return { message: 'Something went wrong on our side. Try again later.', status: 500 }
}
