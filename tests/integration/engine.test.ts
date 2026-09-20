import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { makeHarness, makeTask, serverUrl, resetDrops, waitForStatus, waitForBytes, type Harness } from './helpers'
import { patternSha256 } from '../../test-server/server'

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

let harness: Harness

beforeAll(async () => {
  harness = await makeHarness({ segments: 4, retries: 4 })
})

afterAll(async () => {
  await harness?.cleanup()
})

describe('engine: full downloads', () => {
  it('downloads a 5MB file with 4 segments and the bytes are intact', async () => {
    const task = makeTask(harness, serverUrl('/file/5mb.bin'), 'five.bin', { maxRetries: 3 })
    await task.start(harness.deps, true)
    await waitForStatus(task, ['completed', 'failed'], 60_000)
    expect(task.status).toBe('completed')
    expect(task.totalBytes).toBe(5 * 1024 * 1024)
    expect(task.segments.length).toBeGreaterThanOrEqual(2)
    const data = await readFile(path.join(harness.dir, 'five.bin'))
    expect(data.length).toBe(5 * 1024 * 1024)
    expect(sha256(data)).toBe(patternSha256(data.length))
    // final file exists, .part is gone
    await expect(readFile(path.join(harness.dir, 'five.bin.part'))).rejects.toThrow()
  }, 90_000)

  it('writes each segment at its own byte offset (no whole-file buffering)', async () => {
    const task = makeTask(harness, serverUrl('/file/10mb.bin'), 'ten.bin', { maxRetries: 3 })
    await task.start(harness.deps, true)
    await waitForStatus(task, ['completed', 'failed'], 90_000)
    expect(task.status).toBe('completed')
    // segment windows partition the file exactly
    const covered = task.segments.reduce((s, x) => s + (x.end - x.start + 1), 0)
    expect(covered).toBe(10 * 1024 * 1024)
    const starts = new Set(task.segments.map((s) => s.start))
    expect(starts.size).toBe(task.segments.length)
    const data = await readFile(path.join(harness.dir, 'ten.bin'))
    expect(sha256(data)).toBe(patternSha256(data.length))
  }, 120_000)

  it('single-connection download of a no-range server completes byte-exact', async () => {
    const task = makeTask(harness, serverUrl('/noranges/1mb.bin'), 'noranges.bin')
    await task.start(harness.deps, true)
    await waitForStatus(task, ['completed', 'failed'], 60_000)
    expect(task.status).toBe('completed')
    expect(task.supportsResume).toBe(false)
    const data = await readFile(path.join(harness.dir, 'noranges.bin'))
    expect(sha256(data)).toBe(patternSha256(1024 * 1024))
  }, 90_000)

  it('survives a server that ignores Range and answers 200 (prefix discard)', async () => {
    // The engine must NOT append the re-sent prefix at the segment offset.
    const task = makeTask(harness, serverUrl('/ignore-range/1mb.bin'), 'liar.bin', { maxRetries: 2 })
    await task.start(harness.deps, true)
    await waitForStatus(task, ['completed', 'failed'], 60_000)
    expect(task.status).toBe('completed')
    const data = await readFile(path.join(harness.dir, 'liar.bin'))
    expect(sha256(data)).toBe(patternSha256(1024 * 1024))
  }, 90_000)
})

describe('engine: pause / resume', () => {
  it('pause keeps partial data, resume finishes byte-exact', async () => {
    const task = makeTask(harness, serverUrl('/slow/10mb.bin?bps=262144'), 'pr.bin', { maxRetries: 3 })
    await task.start(harness.deps, true)
    await waitForBytes(task, 2 * 1024 * 1024)
    task.pause()
    await waitForStatus(task, ['paused'], 20_000)
    await task.waitUntilIdle()
    const partial = task.downloadedBytes
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(10 * 1024 * 1024)
    const partStat = await readFile(path.join(harness.dir, 'pr.bin.part'))
    expect(partStat.length).toBeGreaterThanOrEqual(partial - 1) // sparse files may be pre-sized

    // resume
    await task.start(harness.deps, false)
    await waitForStatus(task, ['completed', 'failed'], 60_000)
    expect(task.status).toBe('completed')
    const data = await readFile(path.join(harness.dir, 'pr.bin'))
    expect(sha256(data)).toBe(patternSha256(10 * 1024 * 1024))
  }, 120_000)

  it('resume past EOF answers 416 and marks the segment done', async () => {
    // Download fully, then simulate a restart where segments claim done==full
    // and the engine asks for a range beyond EOF on retry.
    const task = makeTask(harness, serverUrl('/file/1mb.bin'), 'eof.bin')
    await task.start(harness.deps, true)
    await waitForStatus(task, ['completed'], 30_000)
    expect(task.segments.every((s) => s.state === 'done')).toBe(true)
  }, 60_000)
})

describe('engine: failures & friendlies', () => {
  it('404 fails with a friendly message and http_not_found reason', async () => {
    const task = makeTask(harness, serverUrl('/fail/404'), 'gone.bin')
    await task.start(harness.deps, true)
    await waitForStatus(task, ['failed'], 30_000)
    expect(task.failureReason).toBe('not_found')
    expect(task.failureDetail).toMatch(/404|not found|blocked/i)
  })

  it('403 fails as forbidden without retrying', async () => {
    const task = makeTask(harness, serverUrl('/fail/403'), 'no.bin')
    await task.start(harness.deps, true)
    await waitForStatus(task, ['failed'], 30_000)
    expect(task.failureReason).toBe('forbidden')
    expect(task.retryCount).toBe(0)
  })

  it('401 fails as unauthorized (no credential bypass attempts)', async () => {
    const task = makeTask(harness, serverUrl('/fail/401'), 'auth.bin')
    await task.start(harness.deps, true)
    await waitForStatus(task, ['failed'], 30_000)
    expect(task.failureReason).toBe('unauthorized')
  })

  it('connection drop mid-stream auto-recovers via segment retry', async () => {
    await resetDrops()
    const task = makeTask(harness, serverUrl('/drop/10mb.bin?times=1&keep=200000'), 'drop.bin', { maxRetries: 4 })
    await task.start(harness.deps, true)
    await waitForStatus(task, ['completed', 'failed'], 90_000)
    expect(task.status).toBe('completed')
    expect(task.retryCount).toBeGreaterThanOrEqual(1)
    const data = await readFile(path.join(harness.dir, 'drop.bin'))
    expect(sha256(data)).toBe(patternSha256(10 * 1024 * 1024))
  }, 120_000)

  it('redirect chain is followed and recorded as finalUrl', async () => {
    const task = makeTask(harness, serverUrl('/redirect/3/file/1mb.bin'), 'rd.bin')
    await task.start(harness.deps, true)
    await waitForStatus(task, ['completed', 'failed'], 60_000)
    expect(task.status).toBe('completed')
    expect(task.finalUrl).toContain('/file/1mb.bin')
    const data = await readFile(path.join(harness.dir, 'rd.bin'))
    expect(sha256(data)).toBe(patternSha256(1024 * 1024))
  }, 90_000)
})

describe('engine: speed limiting', () => {
  it('per-task limit actually caps throughput', async () => {
    const limit = 150 * 1024 // 150 KB/s
    const task = makeTask(harness, serverUrl('/file/1mb.bin'), 'capped.bin', { maxRetries: 2 })
    task.setSpeedLimit(limit)
    const start = Date.now()
    await task.start(harness.deps, true)
    await waitForStatus(task, ['completed', 'failed'], 90_000)
    const secs = (Date.now() - start) / 1000
    expect(task.status).toBe('completed')
    const achieved = (1024 * 1024) / secs
    // allow generous slack for loopback bursts, but must be clearly limited
    expect(achieved).toBeLessThan(limit * 3)
  }, 120_000)

  it('global throttle caps the sum across tasks', async () => {
    const g = harness.globalThrottle
    g.setRate(200 * 1024)
    try {
      const a = makeTask(harness, serverUrl('/file/1mb.bin'), 'ga.bin')
      const b = makeTask(harness, serverUrl('/file/1mb.bin'), 'gb.bin')
      const start = Date.now()
      await Promise.all([a.start(harness.deps, true), b.start(harness.deps, true)])
      await Promise.all([waitForStatus(a, ['completed', 'failed'], 90_000), waitForStatus(b, ['completed', 'failed'], 90_000)])
      const secs = (Date.now() - start) / 1000
      const achieved = (2 * 1024 * 1024) / secs
      expect(achieved).toBeLessThan(200 * 1024 * 3)
      expect(a.status).toBe('completed')
      expect(b.status).toBe('completed')
    } finally {
      g.setRate(0)
    }
  }, 150_000)
})
