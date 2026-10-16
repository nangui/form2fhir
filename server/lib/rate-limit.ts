const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

interface Window {
  startedAt: number
  count: number
}

export type RateLimitDecision = { allowed: true } | { allowed: false, retryAfterSeconds: number }

/**
 * Fixed-window limiter kept in memory: per IP per hour, plus a global daily cap.
 * On Vercel each instance has its own memory, so this is best-effort; the hard
 * backstop is the monthly spend limit set in the Anthropic console.
 */
export function createRateLimiter({ perHour, perDay, now = Date.now }: { perHour: number, perDay: number, now?: () => number }) {
  const perIp = new Map<string, Window>()
  let day: Window = { startedAt: now(), count: 0 }

  function take(ip: string): RateLimitDecision {
    const time = now()
    if (time - day.startedAt >= DAY_MS) day = { startedAt: time, count: 0 }
    forgetExpired(time)

    const window = perIp.get(ip) ?? { startedAt: time, count: 0 }
    if (window.count >= perHour) return { allowed: false, retryAfterSeconds: secondsUntil(window.startedAt + HOUR_MS, time) }
    if (day.count >= perDay) return { allowed: false, retryAfterSeconds: secondsUntil(day.startedAt + DAY_MS, time) }

    window.count++
    day.count++
    perIp.set(ip, window)
    return { allowed: true }
  }

  function forgetExpired(time: number) {
    for (const [ip, window] of perIp) {
      if (time - window.startedAt >= HOUR_MS) perIp.delete(ip)
    }
  }

  return { take, size: () => perIp.size }
}

function secondsUntil(target: number, time: number): number {
  return Math.ceil((target - time) / 1000)
}
