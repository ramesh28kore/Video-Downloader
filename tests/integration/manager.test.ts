import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/main/db/migrations'
import { DownloadsRepo } from '../../src/main/db/repositories/DownloadsRepo'
import { CategoriesRepo } from '../../src/main/db/repositories/CategoriesRepo'
import { SettingsRepo } from '../../src/main/db/repositories/SettingsRepo'
import { DownloadManager, type ManagerDeps } from '../../src/main/download/DownloadManager'
import { FileManager } from '../../src/main/fs/FileManager'
import { probeUrl } from '../../src/main/download/Metadata'
import { defaultSettings, seedCategoriesIfEmpty } from '../../src/main/config'
import { patternByte } from '../../test-server/server'
import type { AppSettings, DownloadRecord } from '@shared/types'
import { serverUrl } from './helpers'

const server = { url: (p: string) => serverUrl(p) }
let dir: string

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'turbo-mgr-'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
})

interface Ctx {
  manager: DownloadManager
  db: DatabaseSync
  downloads: DownloadsRepo
  categories: CategoriesRepo
  settings: AppSettings
}

/** Build a manager over a DB. `seed` populates categories + settings (first boot). */
function ctxFrom(db: DatabaseSync, overrides: Partial<AppSettings> = {}, seed = false): Ctx {
  runMigrations(db)
  const downloads = new DownloadsRepo(db)
  const categories = new CategoriesRepo(db)
  const settingsRepo = new SettingsRepo(db)
  if (seed) seedCategoriesIfEmpty(categories)
  const settings: AppSettings = { ...defaultSettings(), downloadDir: dir, autoStart: true, ...overrides }
  const deps: ManagerDeps = {
    downloads,
    categories,
    settingsRepo,
    fileManager: new FileManager(),
    getSettings: () => settings,
    baseDir: () => dir
  }
  return { manager: new DownloadManager(deps), db, downloads, categories, settings }
}

function until(predicate: () => boolean, ms = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = setInterval(() => {
      let ok = false
      try {
        ok = predicate()
      } catch {
        ok = false
      }
      if (ok) {
        clearInterval(tick)
        resolve()
      } else if (Date.now() - started > ms) {
        clearInterval(tick)
        reject(new Error('timeout in until()'))
      }
    }, 50)
    tick.unref?.()
  })
}

/**
 * Insert a "crashed" download row directly (bypasses the manager so pump()
 * can't race us). Validators are probed live so resume validation matches.
 */
async function stageCrashed(
  ctx: Ctx,
  opts: {
    url: string
    filename: string
    subdir: string
    partBytes: number
    totalBytes: number
    fillPattern?: boolean
    etag?: string | null
    lastModified?: string | null
  }
): Promise<DownloadRecord> {
  const saveDir = path.join(dir, opts.subdir)
  await new FileManager().ensureDir(saveDir)
  const filePath = path.join(saveDir, opts.filename)
  const partPath = `${filePath}.part`
  const buf = Buffer.allocUnsafe(opts.partBytes)
  if (opts.fillPattern) {
    for (let i = 0; i < opts.partBytes; i++) buf[i] = patternByte(i)
  } else {
    buf.fill(0)
  }
  await writeFile(partPath, buf)
  const now = Date.now()
  const record: DownloadRecord = {
    id: randomUUID(),
    url: opts.url,
    finalUrl: opts.url,
    filename: opts.filename,
    filePath: null,
    partPath,
    categoryId: 7,
    category: 'Other',
    status: 'downloading',
    totalBytes: opts.totalBytes,
    downloadedBytes: opts.partBytes,
    speedBps: 0,
    etaSeconds: null,
    segments: [
      { id: 0, index: 0, start: 0, end: opts.totalBytes - 1, done: opts.partBytes, state: 'running' }
    ],
    supportsResume: true,
    speedLimitBps: 0,
    retryCount: 0,
    maxRetries: 0,
    createdAt: now,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    queuePos: ctx.downloads.nextQueuePos(),
    failureReason: null,
    failureDetail: null,
    validatorEtag: opts.etag ?? null,
    validatorLastModified: opts.lastModified ?? null,
    httpStatus: 206,
    note: null
  }
  ctx.downloads.insert(record, null, saveDir)
  return record
}

describe('DownloadManager', () => {
  it('addDownload probes, persists a record and completes the file', async () => {
    const ctx = ctxFrom(new DatabaseSync(':memory:'), {}, true)
    try {
      const res = await ctx.manager.addDownload({ url: server.url('/file/1mb.bin'), startNow: true })
      expect(res.record.id).not.toBe('draft')
      expect(res.record.totalBytes).toBe(1024 * 1024)
      expect(res.duplicateDetected).toBe(false)
      // Persisted in the DB immediately (crash-safe).
      expect(ctx.downloads.get(res.record.id)).not.toBeNull()
      await until(() => ctx.manager.get(res.record.id)?.status === 'completed', 40_000)
      const rec = ctx.manager.get(res.record.id)!
      expect(rec.status).toBe('completed')
      expect(rec.category).toBeTruthy()
      const finalPath = rec.filePath ?? path.join(dir, rec.filename)
      const data = await readFile(finalPath)
      expect(data.length).toBe(1024 * 1024)
      expect(existsSync(`${finalPath}.part`)).toBe(false)
      await ctx.manager.shutdown()
    } finally {
      ctx.db.close()
    }
  }, 60_000)

  it('duplicate add with rename produces "file (1).ext"', async () => {
    const ctx = ctxFrom(new DatabaseSync(':memory:'), {}, true)
    try {
      const first = await ctx.manager.addDownload({ url: server.url('/meta/report.pdf'), startNow: false })
      const second = await ctx.manager.addDownload({ url: server.url('/meta/report.pdf'), startNow: false })
      expect(first.record.filename).toBe('report.pdf')
      expect(second.record.filename).toBe('report (1).pdf')
      await ctx.manager.shutdown()
    } finally {
      ctx.db.close()
    }
  })

  it('duplicate add with cancel returns a draft + duplicateDetected', async () => {
    const ctx = ctxFrom(new DatabaseSync(':memory:'), {}, true)
    try {
      await ctx.manager.addDownload({ url: server.url('/meta/report.pdf'), startNow: false })
      const res = await ctx.manager.addDownload({
        url: server.url('/meta/report.pdf'),
        startNow: false,
        duplicateMode: 'cancel'
      })
      expect(res.duplicateDetected).toBeTruthy()
      if (!res.duplicateDetected) throw new Error('expected duplicate info')
      expect(res.duplicateDetected.suggestedName).toBe('report.pdf')
      expect(res.record.id).toBe('draft')
      await ctx.manager.shutdown()
    } finally {
      ctx.db.close()
    }
  })

  it('rejects non-http URLs', async () => {
    const ctx = ctxFrom(new DatabaseSync(':memory:'), {}, true)
    try {
      await expect(ctx.manager.addDownload({ url: 'ftp://x/y', startNow: true })).rejects.toThrow('INVALID_URL')
      await ctx.manager.shutdown()
    } finally {
      ctx.db.close()
    }
  })

  it('respects maxConcurrent — never runs more than the cap', async () => {
    const ctx = ctxFrom(new DatabaseSync(':memory:'), { maxConcurrent: 2 }, true)
    try {
      for (let i = 0; i < 5; i++) {
        await ctx.manager.addDownload({ url: server.url(`/slow/5mb.bin?bps=${4 * 1024 * 1024}&i=${i}`), startNow: true })
      }
      let peak = 0
      for (let s = 0; s < 30; s++) {
        peak = Math.max(peak, ctx.manager.stats().active)
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(peak).toBeLessThanOrEqual(2)
      await ctx.manager.shutdown()
    } finally {
      ctx.db.close()
    }
  }, 30_000)

  it('reorder changes queue positions', async () => {
    const ctx = ctxFrom(new DatabaseSync(':memory:'), { maxConcurrent: 1 }, true)
    try {
      const a = await ctx.manager.addDownload({ url: server.url('/slow/1mb.bin?bps=1024'), startNow: true })
      const b = await ctx.manager.addDownload({ url: server.url('/meta/one.bin?x=1'), startNow: true })
      const c = await ctx.manager.addDownload({ url: server.url('/meta/two.bin?x=2'), startNow: true })
      ctx.manager.reorder([c.record.id, b.record.id, a.record.id])
      expect(ctx.manager.get(c.record.id)!.queuePos).toBe(1)
      expect(ctx.downloads.get(b.record.id)!.queuePos).toBe(2)
      await ctx.manager.shutdown()
    } finally {
      ctx.db.close()
    }
  })

  it('history query finds completed downloads by filename text', async () => {
    const ctx = ctxFrom(new DatabaseSync(':memory:'), {}, true)
    try {
      const r = await ctx.manager.addDownload({ url: server.url('/meta/quarter.pdf'), startNow: false })
      await until(() => ctx.manager.get(r.record.id)?.status === 'completed', 20_000)
      const hits = ctx.manager.history({ text: 'quarter', status: 'all' })
      expect(hits.some((h) => h.filename === 'quarter.pdf')).toBe(true)
      await ctx.manager.shutdown()
    } finally {
      ctx.db.close()
    }
  })
})

describe('crash recovery', () => {
  it('resumes a partial .part whose validators still match', async () => {
    const db = new DatabaseSync(':memory:')
    const ctx = ctxFrom(db, {}, true)
    const url = server.url('/file/10mb.bin')
    const probe = await probeUrl(url)
    expect(probe.ok).toBe(true)
    const have = 3 * 1024 * 1024
    const rec = await stageCrashed(ctx, {
      url,
      filename: 'resume-10mb.bin',
      subdir: 'Software',
      partBytes: have,
      totalBytes: 10 * 1024 * 1024,
      fillPattern: true,
      etag: probe.etag,
      lastModified: probe.lastModified
    })

    // A fresh manager over the SAME db simulates an app restart.
    const ctx2 = ctxFrom(db)
    try {
      await ctx2.manager.recover()
      const after = ctx2.manager.get(rec.id)!
      // Recovery keeps the partial data (validators match) — never below 3MB.
      expect(after.downloadedBytes).toBeGreaterThanOrEqual(have)
      expect(['queued', 'downloading', 'connecting', 'retrying', 'paused']).toContain(after.status)
      await until(() => ctx2.manager.get(rec.id)?.status === 'completed', 60_000)
      const finalRec = ctx2.manager.get(rec.id)!
      const finalData = await readFile(finalRec.filePath ?? path.join(dir, 'Software', rec.filename))
      expect(finalData.length).toBe(10 * 1024 * 1024)
      // Spot-check bytes around the resume seam and at EOF — this is what
      // proves the partial prefix was kept AND correctly accounted for.
      expect(finalData[have - 1]).toBe(patternByte(have - 1))
      expect(finalData[have]).toBe(patternByte(have))
      expect(finalData[finalData.length - 1]).toBe(patternByte(finalData.length - 1))
      await ctx2.manager.shutdown()
    } finally {
      db.close()
    }
  }, 90_000)

  it('wipes and restarts when the remote size changed', async () => {
    const db = new DatabaseSync(':memory:')
    const ctx = ctxFrom(db, {}, true)
    const url = server.url('/file/1mb.bin')
    const probe = await probeUrl(url)
    const rec = await stageCrashed(ctx, {
      url,
      filename: 'sizechanged.bin',
      subdir: 'Software',
      partBytes: 500 * 1024,
      totalBytes: 999 * 1024 * 1024, // wrong size → must wipe
      etag: probe.etag,
      lastModified: probe.lastModified
    })
    const ctx2 = ctxFrom(db)
    try {
      await ctx2.manager.recover()
      const after = ctx2.manager.get(rec.id)!
      expect(after.downloadedBytes).toBeLessThanOrEqual(1024 * 1024)
      expect(existsSync(`${path.join(dir, 'Software', rec.filename)}.part`)).toBe(true) // re-created from scratch
      await until(() => ctx2.manager.get(rec.id)?.status === 'completed', 40_000)
      const finalData = await readFile(path.join(dir, 'Software', rec.filename))
      expect(finalData.length).toBe(1024 * 1024)
      await ctx2.manager.shutdown()
    } finally {
      db.close()
    }
  }, 60_000)

  it('keeps partial data when the server is unreachable during validation', async () => {
    const db = new DatabaseSync(':memory:')
    const ctx = ctxFrom(db, {}, true)
    // Dead port → validation probe fails → data must be preserved, not wiped.
    const rec = await stageCrashed(ctx, {
      url: 'http://127.0.0.1:1/file/1mb.bin',
      filename: 'unreachable.bin',
      subdir: 'Software',
      partBytes: 400 * 1024,
      totalBytes: 1024 * 1024
    })
    const partPath = path.join(dir, 'Software', rec.filename) + '.part'
    const ctx2 = ctxFrom(db)
    try {
      await ctx2.manager.recover()
      const after = ctx2.manager.get(rec.id)!
      // Must NOT wipe — unreachable ≠ changed.
      expect(after.downloadedBytes).toBe(400 * 1024)
      expect(existsSync(partPath)).toBe(true)
      // Eventually fails (retries exhausted against a dead port) with data kept.
      await until(() => ctx2.manager.get(rec.id)?.status === 'failed', 60_000)
      expect(existsSync(partPath)).toBe(true)
      await ctx2.manager.shutdown()
    } finally {
      db.close()
    }
  }, 90_000)
})
