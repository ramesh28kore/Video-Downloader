import { describe, it, expect } from 'vitest'
import { Throttle, GlobalThrottle, sleep } from '../../src/main/download/Throttle'

describe('Throttle', () => {
  it('is inactive and instant when no rate is set', async () => {
    const t = new Throttle()
    expect(t.active).toBe(false)
    const start = process.hrtime.bigint()
    await t.acquire(10 * 1024 * 1024)
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    expect(ms).toBeLessThan(20)
  })

  it('setRate(0) disables limiting', async () => {
    const t = new Throttle()
    t.setRate(100 * 1024)
    expect(t.active).toBe(true)
    t.setRate(0)
    expect(t.active).toBe(false)
  })

  it('delays roughly the right amount for the requested bytes', async () => {
    // Regression: a request larger than the burst capacity (rate/10) must NOT
    // deadlock — it goes into token debt and waits for refill instead.
    const t = new Throttle()
    t.setRate(20 * 1024) // capacity = 2KB
    const start = Date.now()
    await t.acquire(4 * 1024) // debt 2KB ⇒ ~100ms
    await t.acquire(4 * 1024) // debt 2KB ⇒ ~100ms
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(120)
    expect(elapsed).toBeLessThan(1500)
  })

  it('a single acquire larger than capacity completes (no deadlock)', async () => {
    const t = new Throttle()
    t.setRate(100 * 1024) // capacity = 10KB
    const start = Date.now()
    await t.acquire(64 * 1024) // 64KB chunk > capacity — the old bug
    const ms = Date.now() - start
    expect(ms).toBeGreaterThanOrEqual(300) // ~540ms of debt
    expect(ms).toBeLessThan(3000)
  }, 15_000)

  it('refills over time so a steady stream matches the rate within ~35%', async () => {
    const rate = 100 * 1024 // 100 KB/s
    const t = new Throttle()
    t.setRate(rate)
    const total = 300 * 1024
    const chunk = 10 * 1024
    const start = Date.now()
    for (let sent = 0; sent < total; sent += chunk) await t.acquire(chunk)
    const secs = (Date.now() - start) / 1000
    const achieved = total / secs
    expect(achieved).toBeLessThan(rate * 1.6)
    expect(achieved).toBeGreaterThan(rate * 0.5)
  })

  it('supports changing the rate mid-flight', async () => {
    const t = new Throttle()
    t.setRate(50 * 1024)
    await t.acquire(1024)
    t.setRate(10 * 1024)
    expect(t.active).toBe(true)
    const start = Date.now()
    await t.acquire(20 * 1024) // 20KB at 10KB/s ⇒ ≥ ~100ms after burst
    expect(Date.now() - start).toBeGreaterThanOrEqual(50)
  })
})

describe('GlobalThrottle', () => {
  it('shares one budget across independent acquirers', async () => {
    const g = new GlobalThrottle()
    g.setRate(50 * 1024)
    const start = Date.now()
    await Promise.all([g.acquire(30 * 1024), g.acquire(30 * 1024)])
    const elapsed = Date.now() - start
    // 60KB total at 50KB/s minus 5KB burst ⇒ ≳ 1000ms
    expect(elapsed).toBeGreaterThanOrEqual(700)
  })
})

describe('sleep', () => {
  it('resolves after the requested delay', async () => {
    const start = Date.now()
    await sleep(80)
    expect(Date.now() - start).toBeGreaterThanOrEqual(60)
  })
})
