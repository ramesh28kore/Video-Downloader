import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { DownloadTask, type TaskDeps } from './DownloadTask'
import { QueueManager } from '../queue/QueueManager'
import { ProgressPersister } from '../db/ProgressPersister'
import { probeUrl, categorize, suggestUniqueFilename } from './Metadata'
import { isHttpUrl } from '../fs/PathValidator'
import { GlobalThrottle } from './Throttle'
import { validateResume } from './Recovery'
import { getDiskSpace, hasSpaceFor } from '../fs/DiskSpace'
import { FileManager } from '../fs/FileManager'
import type { DownloadsRepo } from '../db/repositories/DownloadsRepo'
import type { CategoriesRepo } from '../db/repositories/CategoriesRepo'
import type { SettingsRepo } from '../db/repositories/SettingsRepo'
import type {
  AddDownloadOptions,
  AppSettings,
  CreateDownloadResult,
  DownloadRecord,
  DownloadStatus,
  FailureReason,
  ProgressTick,
  QueueStats
} from '@shared/types'
import { createLogger } from '../util/logger'

const log = createLogger('manager')

export interface ManagerEvents {
  created: [DownloadRecord]
  updated: [DownloadRecord]
  progress: [ProgressTick[]]
  completed: [DownloadRecord]
  failed: [DownloadRecord]
  queue: [QueueStats]
  removed: [string]
}

export interface ManagerDeps {
  downloads: DownloadsRepo
  categories: CategoriesRepo
  settingsRepo: SettingsRepo
  fileManager: FileManager
  getSettings: () => AppSettings
  /** Base downloads root, e.g. %USERPROFILE%\Downloads\TurboDownload */
  baseDir: () => string
}

/**
 * Orchestrates every DownloadTask: creation, the queue, persistence batching,
 * progress fan-out (≤5 Hz) and crash recovery. Pure Node — the Electron layer
 * subscribes to its events and forwards them over IPC.
 */
export class DownloadManager extends EventEmitter<ManagerEvents> {
  private tasks = new Map<string, DownloadTask>()
  private queue: QueueManager
  private persister: ProgressPersister
  private globalThrottle = new GlobalThrottle()
  private progressTimer: ReturnType<typeof setInterval> | null = null
  private dirtyProgress = new Set<string>()
  private shuttingDown = false

  constructor(private deps: ManagerDeps) {
    super()
    this.queue = new QueueManager(() => this.tasks)
    this.persister = new ProgressPersister(deps.downloads, 1000)
    this.applyGlobalSettings()
  }

  // ------------------------------------------------------------- lifecycle

  /** Load persisted state and re-queue interrupted downloads (crash recovery). */
  async recover(): Promise<void> {
    const interrupted = this.deps.downloads.listInterrupted()
    log.info(`recovery: ${interrupted.length} interrupted downloads`)
    const settings = this.deps.getSettings()
    for (const record of interrupted) {
      const task = this.taskFromRecord(record)
      this.tasks.set(task.id, task)
      if (record.status === 'downloading' || record.status === 'connecting' || record.status === 'retrying') {
        // Mark as paused until we validate the .part file.
        task.status = 'paused'
        this.deps.downloads.setStatus(task.id, 'paused')
      }
    }
    // Validate each .part against the server before resuming.
    for (const record of interrupted) {
      const task = this.tasks.get(record.id)
      if (!task) continue
      const part = record.partPath
      const partExists = !!part && (await this.deps.fileManager.exists(part))
      const partSize = partExists && part ? await this.deps.fileManager.size(part) : 0
      const decision = await validateResume(
        record,
        partExists,
        partSize,
        settings.userAgent,
        this.deps.downloads.getHeaders(record.id)
      )
      if (decision.action === 'restart') {
        log.info(`recovery: restart ${record.filename} (${decision.reason})`)
        if (part) await this.deps.fileManager.removeIfExists(part)
        if (part) {
          await this.deps.fileManager.ensureDir(path.dirname(part))
          await writeFile(part, Buffer.alloc(0))
        }
        task.segments = []
        task.downloadedBytes = 0
        task.supportsResume = false // re-probe will re-evaluate on start
        this.deps.downloads.updateProgress(task.id, 0, 0)
      } else {
        log.info(`recovery: resume ${record.filename} (${decision.reason})`)
      }
      if (settings.autoStart) {
        task.status = 'queued'
        this.deps.downloads.setStatus(task.id, 'queued')
      }
    }
    this.pump()
    this.emitQueue()
  }

  /** Rebuild a live task from a persisted record (crash recovery). */
  private taskFromRecord(record: DownloadRecord): DownloadTask {
    const settings = this.deps.getSettings()
    const partPath = record.partPath ?? `${path.join(this.deps.baseDir(), record.filename)}.part`
    const filePath = record.filePath ?? (record.partPath ? partPath.slice(0, -'.part'.length) : path.join(this.deps.baseDir(), record.filename))
    const task = new DownloadTask(
      record.id,
      record.url,
      record.filename,
      partPath,
      filePath,
      record.speedLimitBps,
      record.maxRetries,
      this.deps.downloads.getHeaders(record.id)
    )
    task.status = record.status
    task.totalBytes = record.totalBytes
    task.downloadedBytes = record.downloadedBytes
    task.supportsResume = record.supportsResume
    task.finalUrl = record.finalUrl
    task.etag = record.validatorEtag
    task.lastModified = record.validatorLastModified
    task.queuePos = record.queuePos
    task.startedAt = record.startedAt
    task.failureReason = record.failureReason
    task.failureDetail = record.failureDetail
    task.restoreSegments(record.segments.map((s) => ({ start: s.start, end: s.end, done: s.done })))
    this.registerTask(task)
    void settings
    return task
  }

  /** Kick the queue: start as many queued tasks as slots allow. */
  pump(): void {
    if (this.shuttingDown) return
    const toStart = this.queue.nextToStart()
    for (const task of toStart) {
      void this.runTask(task, false)
    }
    this.emitQueue()
  }

  private taskDeps(): TaskDeps {
    const s = this.deps.getSettings()
    return {
      fileManager: this.deps.fileManager,
      globalThrottle: this.globalThrottle,
      settings: () => ({
        segmentsPerDownload: s.segmentsPerDownload,
        retryCount: s.retryCount,
        timeoutSeconds: s.timeoutSeconds,
        userAgent: s.userAgent,
        preallocate: s.preallocate
      })
    }
  }

  private async runTask(task: DownloadTask, fresh: boolean): Promise<void> {
    const deps = this.taskDeps()
    task.depsConnections = deps.settings().segmentsPerDownload
    try {
      await task.start(deps, fresh)
    } catch (err) {
      log.error('runTask threw', err)
    }
  }

  // --------------------------------------------------------------- actions

  async addDownload(opts: AddDownloadOptions): Promise<CreateDownloadResult> {
    const url = (opts.url ?? '').trim()
    if (!isHttpUrl(url)) {
      throw new Error('INVALID_URL')
    }
    const settings = this.deps.getSettings()

    // Probe for size/filename/type/resumability.
    const probe = await probeUrl(url, {
      headers: opts.headers ?? undefined,
      userAgent: settings.userAgent
    })
    if (!probe.ok) {
      throw new Error(probe.error?.message ?? 'PROBE_FAILED')
    }
    if (probe.contentType?.toLowerCase().split(';', 1)[0] === 'text/html') {
      throw new Error('This URL is a web page, not a directly downloadable video. Play the video with the browser extension enabled so its media resource can be detected.')
    }

    const categoryHint = probe.categoryHint ?? categorize(probe.filename, probe.contentType, probe.magicKind)
    const categoryId = opts.categoryId ?? this.deps.categories.idForName(categoryHint)
    const category = this.deps.categories.get(categoryId)
    const saveIn = opts.saveIn?.trim()
    const saveDir = saveIn
      ? saveIn
      : settings.autoCategorize && category
        ? path.join(this.deps.baseDir(), category.folder)
        : this.deps.baseDir()
    await this.deps.fileManager.ensureDir(saveDir)

    // Disk-space preflight.
    if (probe.totalBytes >= 0 && !(await hasSpaceFor(path.join(saveDir, probe.filename), probe.totalBytes))) {
      throw new Error('DISK_FULL')
    }

    // Duplicate handling.
    const taken = this.deps.downloads.namesInDir(saveDir)
    const desired = probe.filename
    let filename = desired
    if (taken.has(desired.toLowerCase())) {
      const mode = opts.duplicateMode ?? 'rename'
      if (mode === 'cancel') {
        return { record: this.draftRecord(url, probe, categoryId, category?.name ?? categoryHint, saveDir, desired, opts), duplicateDetected: { suggestedName: desired } }
      }
      if (mode === 'rename') {
        filename = suggestUniqueFilename(desired, taken)
      }
      // 'replace' keeps the same name and overwrites.
    }

    const id = randomUUID()
    const filePath = path.join(saveDir, filename)
    const partPath = `${filePath}.part`
    const now = Date.now()
    const queuePos = this.deps.downloads.nextQueuePos()

    const record: DownloadRecord = {
      id,
      url,
      finalUrl: probe.finalUrl,
      filename,
      filePath: null,
      partPath,
      categoryId,
      category: category?.name ?? categoryHint,
      status: opts.startNow === false ? 'queued' : 'queued',
      totalBytes: probe.totalBytes,
      downloadedBytes: 0,
      speedBps: 0,
      etaSeconds: null,
      segments: [],
      supportsResume: probe.supportsResume,
      speedLimitBps: 0,
      retryCount: 0,
      maxRetries: settings.retryCount,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
      queuePos,
      failureReason: null,
      failureDetail: null,
      validatorEtag: probe.etag,
      validatorLastModified: probe.lastModified,
      httpStatus: probe.status,
      note: null
    }

    this.deps.downloads.insert(record, opts.headers ?? null, saveDir)

    const task = new DownloadTask(
      id,
      url,
      filename,
      partPath,
      filePath,
      0,
      settings.retryCount,
      opts.headers ?? null
    )
    task.totalBytes = probe.totalBytes
    task.supportsResume = probe.supportsResume
    task.serverIgnoresRanges = probe.rangeIgnored
    task.etag = probe.etag
    task.lastModified = probe.lastModified
    task.finalUrl = probe.finalUrl
    task.queuePos = queuePos
    this.registerTask(task)
    this.tasks.set(id, task)

    const finalRecord = task.toRecord(record)
    this.deps.downloads.updateFull(finalRecord)
    this.emit('created', finalRecord)

    // If server ignored ranges, we cannot segment — force single connection.
    this.pump()
    return { record: finalRecord, duplicateDetected: false }
  }

  private draftRecord(
    url: string,
    probe: Awaited<ReturnType<typeof probeUrl>>,
    categoryId: number,
    category: string,
    saveDir: string,
    filename: string,
    opts: AddDownloadOptions
  ): DownloadRecord {
    const now = Date.now()
    return {
      id: 'draft',
      url,
      finalUrl: probe.finalUrl,
      filename,
      filePath: path.join(saveDir, filename),
      partPath: null,
      categoryId,
      category,
      status: 'idle',
      totalBytes: probe.totalBytes,
      downloadedBytes: 0,
      speedBps: 0,
      etaSeconds: null,
      segments: [],
      supportsResume: probe.supportsResume,
      speedLimitBps: 0,
      retryCount: 0,
      maxRetries: this.deps.getSettings().retryCount,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
      queuePos: 0,
      failureReason: null,
      failureDetail: null,
      validatorEtag: probe.etag,
      validatorLastModified: probe.lastModified,
      httpStatus: probe.status,
      note: opts.filename ?? null
    }
  }

  private registerTask(task: DownloadTask): void {
    task.on('progress', () => {
      this.dirtyProgress.add(task.id)
      this.persister.schedule(task.id, task.downloadedBytes, task.retryCount)
    })
    task.on('state', ({ status }) => {
      this.onTaskStateChange(task, status)
    })
  }

  private onTaskStateChange(task: DownloadTask, status: DownloadStatus): void {
    const record = task.toRecord(this.deps.downloads.get(task.id) ?? undefined)
    this.persister.flushNow(task.id, task.downloadedBytes, task.retryCount)
    this.deps.downloads.updateFull(record)
    if (status === 'completed') {
      this.emit('completed', record)
      this.pump()
    } else if (status === 'failed') {
      this.emit('failed', record)
      this.pump()
    } else if (status === 'paused' || status === 'cancelled') {
      this.emit('updated', record)
      this.pump()
    } else {
      this.emit('updated', record)
    }
    this.emitQueue()
    this.ensureProgressTicker()
  }

  start(id: string): void {
    const task = this.tasks.get(id)
    if (!task) return
    if (task.status === 'completed') return
    task.status = 'queued'
    this.deps.downloads.setStatus(id, 'queued')
    this.pump()
  }

  pause(id: string): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.pause()
  }

  async resume(id: string): Promise<void> {
    const task = this.tasks.get(id)
    if (!task) return
    if (task.status === 'completed' || task.status === 'downloading') return
    // Re-check disk space before each resume (spec).
    if (task.totalBytes >= 0) {
      const remaining = task.totalBytes - task.downloadedBytes
      if (!(await hasSpaceFor(task.partPath, remaining))) {
        task.failureReason = 'disk_full'
        task.failureDetail = 'Not enough disk space to resume. Free up space and try again.'
        const rec = task.toRecord(this.deps.downloads.get(task.id) ?? undefined)
        rec.status = 'failed'
        this.deps.downloads.updateFull(rec)
        this.emit('failed', rec)
        return
      }
    }
    task.status = 'queued'
    this.deps.downloads.setStatus(id, 'queued')
    this.pump()
  }

  cancel(id: string): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.cancel()
    void this.deps.fileManager.removeIfExists(task.partPath)
  }

  async retry(id: string): Promise<void> {
    const task = this.tasks.get(id)
    if (!task) return
    task.failureReason = null
    task.failureDetail = null
    task.retryCount = 0
    // If resume is unsupported, restart the whole file from scratch.
    const fresh = !task.supportsResume
    if (fresh) {
      task.segments = []
      task.downloadedBytes = 0
      await this.deps.fileManager.removeIfExists(task.partPath)
    }
    task.status = 'queued'
    this.deps.downloads.setStatus(id, 'queued')
    this.pump()
  }

  async remove(id: string): Promise<void> {
    const task = this.tasks.get(id)
    if (task) {
      task.cancel()
      await this.deps.fileManager.removeIfExists(task.partPath)
      this.tasks.delete(id)
    }
    this.deps.downloads.remove(id)
    this.emit('removed', id)
    this.emitQueue()
  }

  setSpeedLimit(id: string, bytesPerSec: number): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.setSpeedLimit(bytesPerSec)
    this.persister.flushNow(id, task.downloadedBytes, task.retryCount)
  }

  // ----------------------------------------------------------------- queue

  startAll(): void {
    for (const t of this.tasks.values()) {
      if (t.status === 'paused' || t.status === 'queued' || t.status === 'waiting') {
        t.status = 'queued'
        this.deps.downloads.setStatus(t.id, 'queued')
      }
    }
    this.pump()
  }

  pauseAll(): void {
    for (const t of this.tasks.values()) {
      if (t.status === 'downloading' || t.status === 'connecting' || t.status === 'retrying' || t.status === 'queued') {
        t.pause()
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const t of [...this.tasks.values()]) {
      if (t.status !== 'completed') await this.remove(t.id)
    }
  }

  reorder(orderedIds: string[]): void {
    const pos = this.queue.reorder(orderedIds)
    for (const [id, p] of pos) {
      const t = this.tasks.get(id)
      if (t) t.queuePos = p
      this.deps.downloads.setQueuePos(id, p)
    }
    this.pump()
  }

  stats(): QueueStats {
    let speed = 0
    for (const t of this.tasks.values()) {
      if (t.status === 'downloading' || t.status === 'connecting' || t.status === 'retrying') speed += t.speedBps
    }
    return {
      active: this.queue.activeCount(),
      queued: this.queue.queuedCount(),
      maxConcurrent: this.queue.maxConcurrent,
      speedBps: speed
    }
  }

  // -------------------------------------------------------------- settings

  applyGlobalSettings(): void {
    const s = this.deps.getSettings()
    this.queue.maxConcurrent = Math.max(1, s.maxConcurrent)
    this.globalThrottle.setRate(s.globalSpeedLimitKbps > 0 ? s.globalSpeedLimitKbps * 1024 : 0)
  }

  reloadSettings(): void {
    this.applyGlobalSettings()
    this.emitQueue()
  }

  // ----------------------------------------------------------------- reads

  list(): DownloadRecord[] {
    return [...this.tasks.values()]
      .sort((a, b) => a.queuePos - b.queuePos)
      .map((t) => this.decorate(t))
  }

  get(id: string): DownloadRecord | null {
    const t = this.tasks.get(id)
    if (t) return this.decorate(t)
    return this.deps.downloads.get(id)
  }

  private decorate(t: DownloadTask): DownloadRecord {
    const base = this.deps.downloads.get(t.id)
    return t.toRecord(base ?? undefined)
  }

  /** History from the DB (includes completed/failed not in the live map). */
  history(filter: Parameters<DownloadsRepo['historyQuery']>[0]): DownloadRecord[] {
    return this.deps.downloads.historyQuery(filter).map((r) => this.overlayLive(r))
  }

  private overlayLive(record: DownloadRecord): DownloadRecord {
    const live = this.tasks.get(record.id)
    if (!live) return record
    return live.toRecord(record)
  }

  clearHistory(statuses: DownloadStatus[]): number {
    const removed = this.deps.downloads.clearHistory(statuses)
    for (const [id, t] of [...this.tasks.entries()]) {
      if (statuses.includes(t.status) && (t.status === 'completed' || t.status === 'cancelled' || t.status === 'failed')) {
        this.tasks.delete(id)
      }
    }
    this.emit('removed', '*')
    return removed
  }

  getRecordForFile(id: string): { filePath: string | null; filename: string } | null {
    const r = this.get(id)
    if (!r) return null
    return { filePath: r.filePath, filename: r.filename }
  }

  // ------------------------------------------------------- progress ticker

  private ensureProgressTicker(): void {
    if (this.progressTimer) return
    this.progressTimer = setInterval(() => this.tickProgress(), 200)
    this.progressTimer.unref?.()
  }

  private tickProgress(): void {
    if (this.dirtyProgress.size === 0) {
      if (this.tasks.size === 0 && this.progressTimer) {
        clearInterval(this.progressTimer)
        this.progressTimer = null
      }
      return
    }
    const ticks: ProgressTick[] = []
    for (const id of this.dirtyProgress) {
      const t = this.tasks.get(id)
      if (!t) continue
      ticks.push({ id, status: t.status, done: t.downloadedBytes, total: t.totalBytes, speed: t.speedBps, eta: t.etaSeconds })
    }
    this.dirtyProgress.clear()
    if (ticks.length) this.emit('progress', ticks)
  }

  private emitQueue(): void {
    this.emit('queue', this.stats())
  }

  // ------------------------------------------------------------ shutdown

  /**
   * Graceful shutdown order (spec):
   *  1. stop accepting new work
   *  2. pause active downloads (persisting state)
   *  3. abort in-flight requests
   *  4. drain + fsync writers
   *  5. flush the DB
   * .part files always survive.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true
    if (this.progressTimer) {
      clearInterval(this.progressTimer)
      this.progressTimer = null
    }
    this.pauseAll()
    for (const t of this.tasks.values()) {
      await t.waitUntilIdle()
    }
    this.persister.stop()
  }

  /** Test helper / status surface. */
  diskSnapshot() {
    return getDiskSpace(this.deps.baseDir())
  }

  failureReasonFor(id: string): FailureReason | null {
    return this.tasks.get(id)?.failureReason ?? null
  }
}
