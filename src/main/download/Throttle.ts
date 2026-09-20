/**
 * Shared monotonic token-bucket throttler.
 *
 * One bucket per download (per-task cap) plus a single global bucket. A writer
 * must acquire tokens from BOTH before consuming bytes from the socket, so the
 * effective rate is min(perTask, global). Unlimited (0) is a no-op fast path —
 * when no limits are configured this code costs nothing on the hot path.
 *
 * The throttle works by *delaying the next socket read*, which applies real
 * TCP backpressure — it is not a UI simulation.
 */

interface Bucket {
  capacity: number
  tokens: number
  ratePerMs: number
  lastRefill: number
}

function nowMs(): number {
  const [s, ns] = process.hrtime()
  return s * 1000 + ns / 1e6
}

function makeBucket(bytesPerSec: number): Bucket {
  const capacity = Math.max(1, Math.floor(bytesPerSec / 10)) // 100ms of burst
  return { capacity, tokens: capacity, ratePerMs: bytesPerSec / 1000, lastRefill: nowMs() }
}

class TokenBucket {
  private bucket: Bucket | null = null
  /** bytes/sec currently enforced; 0 = unlimited */
  private rate = 0

  setRate(bytesPerSec: number): void {
    if (bytesPerSec === this.rate) return
    this.rate = bytesPerSec
    this.bucket = bytesPerSec > 0 ? makeBucket(bytesPerSec) : null
  }

  get active(): boolean {
    return this.bucket !== null
  }

  /**
   * Resolve when `bytes` tokens are available; consumes them.
   *
   * Debt model: we charge the request up-front (tokens may go negative) and
   * then wait for the bucket to refill to >= 0. This is what makes a single
   * request LARGER than the burst capacity safe — the old "wait until
   * tokens >= bytes" loop could never satisfy bytes > capacity (rate/10) and
   * deadlocked at low speed limits (e.g. a 50 KB/s cap vs a 64 KB read chunk).
   */
  async acquire(bytes: number): Promise<void> {
    const bucket = this.bucket
    if (!bucket) return
    bucket.tokens -= bytes
    for (;;) {
      const t = nowMs()
      bucket.tokens = Math.min(
        bucket.capacity,
        bucket.tokens + (t - bucket.lastRefill) * bucket.ratePerMs
      )
      bucket.lastRefill = t
      if (bucket.tokens >= 0) return
      const waitMs = Math.ceil(-bucket.tokens / bucket.ratePerMs)
      // Sleep in bounded slices so a rate change / cancel is noticed promptly.
      await sleep(Math.min(waitMs, 500))
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

/** Per-download speed cap. */
export class Throttle extends TokenBucket {}

/** Global throughput governor shared by every DownloadTask. */
export class GlobalThrottle extends TokenBucket {}
