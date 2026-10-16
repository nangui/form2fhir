import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { AgentError, InputError, ServiceUnavailableError } from './errors'
import { toUserError } from './user-error'

const headers = new Headers()

describe('toUserError', () => {
  it('passes through messages written for users', () => {
    expect(toUserError(new InputError('The file is too large (max 3 MB).', 413)))
      .toEqual({ message: 'The file is too large (max 3 MB).', status: 413 })
    expect(toUserError(new AgentError('Claude declined to process this input. Try a different form.')))
      .toEqual({ message: 'Claude declined to process this input. Try a different form.', status: 422 })
    expect(toUserError(new ServiceUnavailableError('validator', 'The FHIR validator (hapi.fhir.org) did not respond. Try again in a minute.')))
      .toEqual({ message: 'The FHIR validator (hapi.fhir.org) did not respond. Try again in a minute.', status: 503, service: 'validator' })
  })

  it('maps Claude API overload, rate limit and network errors to a retry message', () => {
    const busy = { message: 'Claude is busy right now. Try again in a minute.', status: 503, service: 'claude' }

    expect(toUserError(new Anthropic.RateLimitError(429, undefined, 'rate', headers))).toEqual(busy)
    expect(toUserError(new Anthropic.InternalServerError(529, undefined, 'overloaded', headers))).toEqual(busy)
    expect(toUserError(new Anthropic.APIConnectionError({ message: 'socket hang up' }))).toEqual(busy)
  })

  it('blames the input, not the server, when Claude rejects the request content', () => {
    const rejected = { message: 'Claude could not process this input (it may be too large or unreadable). Try a smaller or simpler form.', status: 422 }

    expect(toUserError(new Anthropic.BadRequestError(400, undefined, 'too many pages', headers))).toEqual(rejected)
    expect(toUserError(new Anthropic.APIError(413, undefined, 'request too large', headers))).toEqual(rejected)
  })

  it('hides configuration and unknown errors behind a generic message', () => {
    const generic = { message: 'Something went wrong on our side. Try again later.', status: 500 }

    expect(toUserError(new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key', headers))).toEqual(generic)
    expect(toUserError(new Error('boom'))).toEqual(generic)
  })

  it('explains a run stopped by the time budget, whatever error the abort produced', () => {
    const timeout = { message: 'The conversion took too long and was stopped. Try a shorter form.', status: 504 }

    expect(toUserError(new Anthropic.APIUserAbortError(), { timedOut: true })).toEqual(timeout)
    expect(toUserError(new DOMException('The operation timed out.', 'TimeoutError'), { timedOut: true })).toEqual(timeout)
  })
})
