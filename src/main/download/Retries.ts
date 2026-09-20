import { sleep } from './Throttle'

/**
 * Exponential backoff retry schedule required by the spec: 2s, 5s, 10s, 30s
 * (then stay at 30s), plus ±20% jitter so parallel segments don't stampede.
 */
export const BACKOFF_MS = [2_000, 5_000, 10_000, 30_000]

export function backoffDelay(attempt: number): number {
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!
  const jitter = base * 0.2 * (Math.random() * 2 - 1)
  return Math.max(250, Math.round(base + jitter))
}

/** Errors worth retrying — transient network/server conditions. */
const RETRYABLE_CODES = new Set([
  '408', '425', '429', '500', '502', '503', '504',
  'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE',
  'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT', 'network', 'socket hang up'
])

export function isRetryable(err: { code?: string; statusCode?: number } | unknown): boolean {
  const e = err as { code?: string; statusCode?: number }
  if (e?.statusCode != null) return RETRYABLE_CODES.has(String(e.statusCode))
  if (e?.code) return RETRYABLE_CODES.has(e.code)
  return false
}

/** Honour a Retry-After header (seconds or HTTP-date), capped at 5 minutes. */
export function retryAfterMs(header: string | string[] | undefined): number | null {
  if (!header) return null
  const value = (Array.isArray(header) ? header[0] : header)?.trim()
  if (!value) return null
  const secs = Number(value)
  if (Number.isFinite(secs)) return Math.min(Math.max(secs, 0) * 1000, 300_000)
  const date = Date.parse(value)
  if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), 300_000)
  return null
}

/**
 * Run `fn` with retries. `onRetry(attempt, err, delayMs)` lets the caller
 * surface "Retrying in 5s (2/4)" state to the UI.
 */
export async function withRetries<T>(
  attempts: number,
  fn: (signal: AbortSignal) => Promise<T>,
  opts: {
    signal: AbortSignal
    isFatal?: (err: unknown) => boolean
    onRetry?: (attempt: number, err: unknown, delayMs: number) => void | Promise<void>
    delayFor?: (attempt: number, err: unknown) => number
  }
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
    if (opts.signal.aborted) throw Object.assign(new Error('aborted'), { code: 'aborted' })
    try {
      return await fn(opts.signal)
    } catch (err) {
      lastErr = err
      const e = err as { code?: string }
      if (e?.code === 'aborted') throw err
      if (opts.isFatal?.(err)) throw err
      if (!isRetryable(err)) throw err
      if (attempt === attempts - 1) throw err
      const delay = opts.delayFor?.(attempt, err) ?? backoffDelay(attempt)
      await opts.onRetry?.(attempt + 1, err, delay)
      // Abort-aware sleep
      await Promise.race([sleep(delay), abortPromise(opts.signal)])
      if (opts.signal.aborted) throw Object.assign(new Error('aborted'), { code: 'aborted' })
    }
  }
  throw lastErr
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) return reject(Object.assign(new Error('aborted'), { code: 'aborted' }))
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'aborted' })), {
      once: true
    })
  })
}
