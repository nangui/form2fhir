export interface HttpOptions {
  baseUrl: string
  fetch?: typeof fetch
  /** Caller cancellation (e.g. the browser disconnected). Rethrown as-is, never reported as an outage. */
  signal?: AbortSignal
  timeoutMs?: number
}

/** Combines the caller's signal with a per-request timeout. */
export function requestSignal(options: HttpOptions, defaultTimeoutMs: number) {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? defaultTimeoutMs)
  return {
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    timedOut: () => timeout.aborted,
    callerAborted: () => options.signal?.aborted === true
  }
}
