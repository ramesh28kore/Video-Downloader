/**
 * Shared harness for engine integration tests: a real SQLite DB (node:sqlite),
 * real files in a temp dir, and a DownloadTask wired exactly the way the
 * DownloadManager wires it — but driven head-lessly against the local test
 * server. No Electron anywhere.
 */
import { inject } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/main/db/migrations'
import { DownloadTask, type TaskDeps } from '../../src/main/download/DownloadTask'
import { GlobalThrottle } from '../../src/main/download/Throttle'
import { FileManager } from '../../src/main/fs/FileManager'
import type { DownloadStatus } from '@shared/types'

export interface Harness {
  dir: string
  db: DatabaseSync
  deps: TaskDeps
  globalThrottle: GlobalThrottle
  cleanup: () => Promise<void>
}

export async function makeHarness(opts: { segments?: number; retries?: number; timeoutSec?: number } = {}): Promise<Harness> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'turbo-it-'))
  const db = new DatabaseSync(':memory:')
  runMigrations(db)
  const globalThrottle = new GlobalThrottle()
  const fileManager = new FileManager()
  const deps: TaskDeps = {
    fileManager,
    globalThrottle,
    settings: () => ({
      segmentsPerDownload: opts.segments ?? 4,
      retryCount: opts.retries ?? 4,
      timeoutSeconds: opts.timeoutSec ?? 20,
      userAgent: 'TurboDownloadTest/1.0',
      preallocate: false
    })
  }
  return {
    dir,
    db,
    deps,
    globalThrottle,
    cleanup: async () => {
      db.close()
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
    }
  }
}

export function serverUrl(p: string): string {
  const base = inject('testServerUrl')
  return p.startsWith('/') ? `${base}${p}` : `${base}/${p}`
}

export async function resetDrops(): Promise<void> {
  const res = await fetch(serverUrl('/admin/reset-drops'))
  if (!res.ok) throw new Error(`resetDrops failed: ${res.status}`)
}

export async function mutateFile(name: string): Promise<void> {
  const res = await fetch(serverUrl(`/admin/mutate/${encodeURIComponent(name)}`))
  if (!res.ok) throw new Error(`mutateFile failed: ${res.status}`)
}

export function makeTask(h: Harness, url: string, filename: string, opts: { maxRetries?: number; speedLimit?: number } = {}): DownloadTask {
  const partPath = path.join(h.dir, filename + '.part')
  const filePath = path.join(h.dir, filename)
  return new DownloadTask(
    'task-' + Math.random().toString(36).slice(2, 8),
    url,
    filename,
    partPath,
    filePath,
    opts.speedLimit ?? 0,
    opts.maxRetries ?? 4
  )
}

export async function waitForStatus(task: DownloadTask, statuses: DownloadStatus[], ms = 60_000): Promise<void> {
  if (statuses.includes(task.status)) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      task.off('state', onState)
      reject(new Error(`timeout waiting for ${statuses.join('/')} — stuck at '${task.status}' (${task.failureDetail ?? 'no detail'})`))
    }, ms)
    const onState = (): void => {
      if (statuses.includes(task.status)) {
        clearTimeout(timer)
        task.off('state', onState)
        resolve()
      }
    }
    task.on('state', onState)
  })
}

/** Wait until the task is running and has downloaded at least `bytes`. */
export async function waitForBytes(task: DownloadTask, bytes: number, ms = 30_000): Promise<void> {
  if (task.downloadedBytes >= bytes) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      task.off('progress', onProgress)
      reject(new Error(`timeout waiting for ${bytes} bytes — got ${task.downloadedBytes}`))
    }, ms)
    const onProgress = (): void => {
      if (task.downloadedBytes >= bytes) {
        clearTimeout(timer)
        task.off('progress', onProgress)
        resolve()
      }
    }
    task.on('progress', onProgress)
  })
}
