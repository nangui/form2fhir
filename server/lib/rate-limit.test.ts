import { describe, expect, it } from 'vitest'
import { createRateLimiter } from './rate-limit'

const HOUR = 60 * 60 * 1000

describe('createRateLimiter', () => {
  it('allows up to the hourly limit per IP, then blocks with a retry time', () => {
    let now = 0
    const limiter = createRateLimiter({ perHour: 2, perDay: 100, now: () => now })

    expect(limiter.take('1.1.1.1')).toEqual({ allowed: true })
    expect(limiter.take('1.1.1.1')).toEqual({ allowed: true })
    now = 10 * 60 * 1000
    expect(limiter.take('1.1.1.1')).toEqual({ allowed: false, retryAfterSeconds: 50 * 60 })
    expect(limiter.take('2.2.2.2')).toEqual({ allowed: true })
  })

  it('opens a new window after an hour', () => {
    let now = 0
    const limiter = createRateLimiter({ perHour: 1, perDay: 100, now: () => now })

    limiter.take('ip')
    now = HOUR
    expect(limiter.take('ip')).toEqual({ allowed: true })
  })

  it('caps all IPs together per day', () => {
    let now = 0
    const limiter = createRateLimiter({ perHour: 10, perDay: 2, now: () => now })

    limiter.take('a')
    limiter.take('b')
    expect(limiter.take('c')).toEqual({ allowed: false, retryAfterSeconds: 24 * 60 * 60 })
    now = 24 * HOUR
    expect(limiter.take('c')).toEqual({ allowed: true })
  })

  it('does not count blocked requests against the daily cap', () => {
    const limiter = createRateLimiter({ perHour: 1, perDay: 2, now: () => 0 })

    limiter.take('a')
    limiter.take('a')
    limiter.take('a')
    expect(limiter.take('b')).toEqual({ allowed: true })
  })

  it('forgets expired windows so memory stays bounded', () => {
    let now = 0
    const limiter = createRateLimiter({ perHour: 1, perDay: 1000, now: () => now })
    for (let i = 0; i < 50; i++) limiter.take(`ip-${i}`)

    now = 2 * HOUR
    limiter.take('fresh')

    expect(limiter.size()).toBe(1)
  })
})
