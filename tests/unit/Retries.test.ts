import { describe, it, expect, vi } from 'vitest'
import { BACKOFF_MS, backoffDelay, isRetryable, retryAfterMs, withRetries } from '../../src/main/download/Retries'

const neverAborted = new AbortController().signal

describe('backoffDelay', () => {
  it('follows the 2s/5s/10s/30s ladder with ±20% jitter', () => {
    for (let i = 0; i < 50; i++) {
      expect(backoffDelay(0)).toBeGreaterThanOrEqual(BACKOFF_MS[0]! * 0.8)
      expect(backoffDelay(0)).toBeLessThanOrEqual(BACKOFF_MS[0]! * 1.2)
      expect(backoffDelay(1)).toBeGreaterThanOrEqual(BACKOFF_MS[1]! * 0.8)
      expect(backoffDelay(3)).toBeGreaterThanOrEqual(BACKOFF_MS[3]! * 0.8)
      // attempts beyond the ladder clamp to the last rung
      expect(backoffDelay(9)).toBeLessThanOrEqual(BACKOFF_MS[3]! * 1.2)
    }
  })

  it('never returns less than the 250ms floor', () => {
    for (let i = 0; i < 50; i++) expect(backoffDelay(0)).toBeGreaterThanOrEqual(250)
  })
})

describe('isRetryable', () => {
  it('treats transient HTTP statuses as retryable', () => {
    for (const s of [408, 425, 429, 500, 502, 503, 504]) {
      expect(isRetryable({ statusCode: s })).toBe(true)
    }
  })

  it('treats permanent HTTP statuses as fatal', () => {
    for (const s of [400, 401, 403, 404, 405, 409, 410]) {
      expect(isRetryable({ statusCode: s })).toBe(false)
    }
  })

  it('treats socket-level errors as retryable', () => {
    for (const c of ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT']) {
      expect(isRetryable({ code: c })).toBe(true)
    }
    // HttpError carries these strings in its `code` field.
    expect(isRetryable({ code: 'socket hang up' })).toBe(true)
    expect(isRetryable({ code: 'network' })).toBe(true)
  })

  it('rejects unknown errors and empty objects', () => {
    expect(isRetryable({ code: 'EPERM_WEIRD' })).toBe(false)
    expect(isRetryable({})).toBe(false)
    expect(isRetryable(null)).toBe(false)
  })
})

describe('retryAfterMs', () => {
  it('parses delta-seconds', () => {
    expect(retryAfterMs('5')).toBe(5000)
    expect(retryAfterMs(' 12 ')).toBe(12000)
  })

  it('caps absurd waits at 300s', () => {
    expect(retryAfterMs('999999')).toBe(300_000)
  })

  it('parses HTTP dates', () => {
    const date = new Date(Date.now() + 30_000).toUTCString()
    const ms = retryAfterMs(date)
    expect(ms).not.toBeNull()
    expect(ms!).toBeGreaterThan(20_000)
    expect(ms!).toBeLessThanOrEqual(40_000)
  })

  it('clamps past dates to zero and rejects garbage', () => {
    expect(retryAfterMs(new Date(Date.now() - 60_000).toUTCString())).toBe(0)
    expect(retryAfterMs('soon')).toBeNull()
    expect(retryAfterMs(undefined)).toBeNull()
  })
})

describe('withRetries', () => {
  it('returns on first success', async () => {
    const fn = vi.fn(async () => 42)
    await expect(withRetries(3, fn, { signal: neverAborted, delayFor: () => 1 })).resolves.toBe(42)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries transient failures then succeeds', async () => {
    let calls = 0
    const onRetry = vi.fn()
    const fn = async () => {
      calls++
      if (calls < 3) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' })
      return 'ok'
    }
    await expect(withRetries(5, fn, { signal: neverAborted, onRetry, delayFor: () => 1 })).resolves.toBe('ok')
    expect(calls).toBe(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(onRetry.mock.calls[0]![0]).toBe(1) // attempt number passed to onRetry
  })

  it('throws fatal errors immediately without retrying', async () => {
    const fn = vi.fn(async (): Promise<number> => {
      throw Object.assign(new Error('not found'), { statusCode: 404 })
    })
    await expect(withRetries(5, fn, { signal: neverAborted, delayFor: () => 1 })).rejects.toThrow('not found')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('honours isFatal predicates', async () => {
    const fn = vi.fn(async (): Promise<number> => {
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    })
    await expect(
      withRetries(5, fn, { signal: neverAborted, isFatal: (e) => (e as Error).message === 'disk full', delayFor: () => 1 })
    ).rejects.toThrow('disk full')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('rethrows the last error when attempts are exhausted', async () => {
    const fn = vi.fn(async (): Promise<number> => {
      throw Object.assign(new Error('flaky'), { code: 'ECONNRESET' })
    })
    await expect(withRetries(3, fn, { signal: neverAborted, delayFor: () => 1 })).rejects.toThrow('flaky')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('stops immediately when the signal aborts', async () => {
    const ac = new AbortController()
    let calls = 0
    const fn = async (): Promise<number> => {
      calls++
      ac.abort()
      throw Object.assign(new Error('reset'), { code: 'ECONNRESET' })
    }
    await expect(withRetries(10, fn, { signal: ac.signal, delayFor: () => 1 })).rejects.toThrow()
    expect(calls).toBe(1)
  })
})
