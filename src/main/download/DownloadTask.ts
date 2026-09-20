import { EventEmitter } from 'node:events'
import path from 'node:path'
import { httpGet, HttpError, type HttpGetResponse } from './RangeHttpClient'
import { FileWriter } from './FileWriter'
import { Throttle, GlobalThrottle, sleep } from './Throttle'
import { withRetries, isRetryable, retryAfterMs, backoffDelay } from './Retries'
import { planSegments, planResume, type SegmentRange } from './SegmentPlanner'
import { probeUrl, type ProbeResult } from './Metadata'
import { hasSpaceFor } from '../fs/DiskSpace'
import { FileManager } from '../fs/FileManager'
import { createLogger } from '../util/logger'
import type { DownloadRecord, DownloadStatus, FailureReason } from '@shared/types'
import { reasonForHttpStatus, reasonForNodeError, friendlyMessageForStatus, friendlyMessageForNodeError } from '@shared/errors'

const READ_HIGH_WATER_MARK = 256 * 1024
void READ_HIGH_WATER_MARK

export interface SegmentState {
  index: number
  start: number
  end: number
  done: number
  state: 'pending' | 'running' | 'done' | 'failed'
}

export interface TaskEvents {
  progress: [{ id: string }]
  state: [{ id: string; status: DownloadStatus }]
}

export interface TaskDeps {
  fileManager: FileManager
  globalThrottle: GlobalThrottle
  settings: () => {
    segmentsPerDownload: number
    retryCount: number
    timeoutSeconds: number
    userAgent: string
    preallocate: boolean
  }
}

const log = createLogger('task')

/**
 * One download. Owns its segments, file handle, throttle and state machine.
 * Pure Node — no Electron imports; driven by DownloadManager.
 */
export class DownloadTask extends EventEmitter<TaskEvents> {
  status: DownloadStatus = 'queued'
  totalBytes = -1
  downloadedBytes = 0
  /** Bytes already on disk that fall outside the current segment windows. */
  private baseBytes = 0
  speedBps = 0
  etaSeconds: number | null = null
  segments: SegmentState[] = []
  supportsResume = false
  serverIgnoresRanges = false
  failureReason: FailureReason | null = null
  failureDetail: string | null = null
  retryCount = 0
  finalUrl: string | null = null
  etag: string | null = null
  lastModified: string | null = null
  httpStatus: number | null = null
  queuePos = 0
  startedAt: number | null = null
  completedAt: number | null = null

  private controller: AbortController | null = null
  private writer: FileWriter | null = null
  private taskThrottle = new Throttle()
  private runPromise: Promise<void> | null = null
  private lastSampleBytes = 0
  private lastSampleAt = 0
  private speedEma = 0
  private pausedRequested = false
  private cancelled = false
  private probe: ProbeResult | null = null

  constructor(
    public readonly id: string,
    public url: string,
    public filename: string,
    public partPath: string,
    public filePath: string,
    public speedLimitBps: number,
    public maxRetries: number,
    public headers: Record<string, string> | null = null
  ) {
    super()
    this.taskThrottle.setRate(speedLimitBps)
  }

  // ---------------------------------------------------------------- start

  async start(deps: TaskDeps, fresh: boolean): Promise<void> {
    if (this.runPromise) return
    this.pausedRequested = false
    this.cancelled = false
    this.runPromise = this.run(deps, fresh).finally(() => {
      this.runPromise = null
    })
    await Promise.race([this.runPromise, sleep(50)])
  }

  get running(): boolean {
    return this.runPromise !== null
  }

  async waitUntilIdle(): Promise<void> {
    while (this.runPromise) {
      try {
        await this.runPromise
      } catch {
        /* errors already folded into status */
      }
    }
  }

  private async run(deps: TaskDeps, fresh: boolean): Promise<void> {
    const settings = deps.settings()
    this.controller = new AbortController()
    const signal = this.controller.signal
    this.failureReason = null
    this.failureDetail = null
    this.startedAt ??= Date.now()

    try {
      // 1. Metadata ------------------------------------------------------------
      if (this.totalBytes < 0 || !this.probe) {
        this.setStatus('connecting')
        const probe = await probeUrl(this.url, {
          headers: this.headers ?? undefined,
          signal,
          userAgent: settings.userAgent
        })
        if (signal.aborted) return this.finishPause()
        if (!probe.ok) {
          const code = probe.error?.code ?? 'network'
          const statusCode = /^\d+$/.test(code) ? Number(code) : undefined
          return this.failFromError(new HttpError(code, probe.error?.message ?? 'Probe failed', statusCode))
        }
        this.applyProbe(probe, deps)
      }

      // 2. Disk space ----------------------------------------------------------
      if (this.totalBytes >= 0) {
        const remaining = this.totalBytes - this.downloadedBytes
        if (!(await hasSpaceFor(this.partPath, remaining))) {
          return this.fail('disk_full', 'Not enough disk space to store this file. Free up space and press Retry.')
        }
      }

      // 3. Segment plan --------------------------------------------------------
      if (fresh || this.segments.length === 0) {
        this.buildInitialPlan()
      } else {
        this.buildResumePlan()
      }

      // 4. Open file -----------------------------------------------------------
      this.writer = new FileWriter(this.partPath, settings.preallocate && fresh)
      await this.writer.open(this.totalBytes >= 0 ? this.totalBytes : null)

      // 5. Run segments with per-segment retry ---------------------------------
      this.setStatus('downloading')
      this.lastSampleAt = Date.now()
      this.lastSampleBytes = this.downloadedBytes

      const failed: SegmentState[] = []
      const runners = this.segments
        .filter((s) => s.state !== 'done')
        .map((seg) => this.runSegment(deps, seg, signal, failed))
      await Promise.allSettled(runners)

      if (this.cancelled) return
      if (this.pausedRequested) return this.finishPause()
      if (signal.aborted) return this.finishPause()

      const anyFailed = this.segments.some((s) => s.state === 'failed')
      if (anyFailed) {
        // Failure detail was already recorded by runSegment.
        this.setStatus('failed')
        return
      }

      // 6. Verify + finalise ---------------------------------------------------
      await this.verifyAndFinalise(deps)
    } catch (err) {
      if (this.cancelled) return
      if ((err as { code?: string })?.code === 'aborted' || this.pausedRequested) {
        return this.finishPause()
      }
      this.failFromError(err)
    } finally {
      await this.closeWriter()
      this.controller = null
    }
  }

  // -------------------------------------------------------------- segments

  private buildInitialPlan(): void {
    const plan: SegmentRange[] = this.probe && this.totalBytes >= 0
      ? planSegments(this.totalBytes, this.supportsResume, this.desiredConnections())
      : [{ index: 0, start: 0, end: -1 }]
    this.segments = plan.map((r) => ({ ...r, done: 0, state: 'pending' as const }))
    this.baseBytes = 0
    this.downloadedBytes = 0
  }

  private buildResumePlan(): void {
    if (this.totalBytes >= 0 && this.supportsResume && this.segments.length > 0) {
      const windows = this.segments.map((s) => ({ start: s.start, end: s.end, done: s.done }))
      const plan = planResume(this.totalBytes, this.supportsResume, this.desiredConnections(), windows)
      if (plan.length === 0) {
        // Every byte is already on disk (e.g. a crash between the final chunk
        // and the rename). Keep the completed segments so verifyAndFinalise
        // can finish the file — wiping progress here would corrupt recovery.
        return
      }
      // planResume returns windows for exactly the *missing* bytes; anything
      // not covered by a new window is already on disk and must still count
      // toward downloadedBytes, or final verification would fail.
      const missing = plan.reduce((sum, r) => sum + (r.end >= 0 ? r.end - r.start + 1 : 0), 0)
      this.baseBytes = Math.max(0, this.totalBytes - missing)
      this.segments = plan.map((r) => {
        // Keep prior progress only when the segment start is unchanged.
        const prev = this.segments.find((s) => s.start === r.start)
        const done = prev ? Math.min(prev.done, r.end - r.start + 1) : 0
        return { ...r, done, state: done >= r.end - r.start + 1 ? ('done' as const) : ('pending' as const) }
      })
      this.downloadedBytes = this.computeTotal()
    } else {
      // Single-stream resume: continue at the contiguous prefix.
      const prefix = this.contiguousPrefix()
      this.baseBytes = prefix
      this.segments = [{ index: 0, start: prefix, end: this.totalBytes >= 0 ? this.totalBytes - 1 : -1, done: 0, state: 'pending' }]
      this.downloadedBytes = this.computeTotal()
    }
  }

  /** Largest P such that bytes [0..P) are fully written. */
  contiguousPrefix(): number {
    const sorted = [...this.segments].sort((a, b) => a.start - b.start)
    let prefix = 0
    for (const seg of sorted) {
      if (seg.start > prefix) break
      const end = seg.start + seg.done
      if (end > prefix) prefix = end
    }
    return prefix
  }

  private desiredConnections(): number {
    return this.depsConnections
  }
  /** set by manager each run */
  depsConnections = 4

  private async runSegment(
    deps: TaskDeps,
    seg: SegmentState,
    signal: AbortSignal,
    _failed: SegmentState[]
  ): Promise<void> {
    seg.state = 'running'
    try {
      await withRetries(
        Math.max(1, this.maxRetries),
        async (attemptSignal) => this.attemptSegment(deps, seg, attemptSignal),
        {
          signal,
          isFatal: (err) => {
            const e = err as HttpError
            if (e?.statusCode && [400, 401, 403, 404, 409].includes(e.statusCode)) return true
            return false
          },
          delayFor: (attempt, err) => {
            const e = err as HttpError
            if (e?.statusCode === 429) {
              const ra = retryAfterMs((e as unknown as { retryAfter?: string }).retryAfter ?? undefined)
              if (ra != null) return ra
            }
            return backoffDelay(attempt)
          },
          onRetry: async (attempt, err) => {
            this.retryCount = attempt
            const retryable = isRetryable(err)
            if (!retryable) return
            this.setStatus('retrying')
          }
        }
      )
      if (this.cancelled || this.pausedRequested) return
      seg.state = 'done'
    } catch (err) {
      if (this.cancelled || this.pausedRequested || (err as { code?: string })?.code === 'aborted') {
        seg.state = 'pending'
        return
      }
      seg.state = 'failed'
      this.failFromError(err)
    }
  }

  /**
   * One HTTP attempt for a segment.
   *
   * CRITICAL integrity rule: if we asked for `bytes=offset-` and the server
   * answered 200 (ignoring Range), the body starts at byte 0 — we must DISCARD
   * the first `offset` bytes, never append them at the segment offset.
   */
  private async attemptSegment(deps: TaskDeps, seg: SegmentState, signal: AbortSignal): Promise<void> {
    const settings = deps.settings()
    const writer = this.writer
    if (!writer) throw new Error('writer missing')

    const offset = seg.start + seg.done
    const sendRange = this.supportsResume && !this.serverIgnoresRanges
    const range = sendRange
      ? { start: offset, end: seg.end >= 0 ? seg.end : undefined }
      : undefined

    const res = await httpGet({
      url: this.finalUrl ?? this.url,
      range,
      headers: {
        ...(this.headers ?? {}),
        ...(settings.userAgent ? { 'User-Agent': settings.userAgent } : {})
      },
      signal
    })

    this.finalUrl = res.finalUrl
    this.httpStatus = res.statusCode
    if (this.status === 'retrying') this.setStatus('downloading')

    // 416 → the range we asked for is beyond EOF → segment already complete.
    if (res.statusCode === 416) {
      res.destroy()
      seg.done = seg.end - seg.start + 1
      return
    }

    // Server ignored our Range: full body from 0. Discard the prefix.
    let skipBytes = 0
    if (res.statusCode === 200 && res.askedRange && offset > 0) {
      this.serverIgnoresRanges = true
      this.supportsResume = false
      skipBytes = offset
    }

    // Known-total reconciliation: if the 200 body declares the full length,
    // learn total (single open-ended segment case).
    if (res.statusCode === 200 && this.totalBytes < 0 && res.contentLength != null) {
      this.totalBytes = res.contentLength
      seg.end = res.contentLength - 1
    }

    const timeoutMs = settings.timeoutSeconds * 1000
    const readLoop = this.consumeStream(deps, res, seg, writer, skipBytes, signal)
    await withReadTimeout(readLoop, timeoutMs, signal, () => res.destroy())
  }

  private async consumeStream(
    deps: TaskDeps,
    res: HttpGetResponse,
    seg: SegmentState,
    writer: FileWriter,
    skipBytes: number,
    signal: AbortSignal
  ): Promise<void> {
    const stream = res.stream
    stream.on('error', () => {
      /* surfaced via for-await throw */
    })
    let skipped = 0
    let writePos = seg.start + seg.done
    const segLen = seg.end >= 0 ? seg.end - seg.start + 1 : Infinity

    // Back-pressure: iterate the response stream (256KB reads) instead of
    // buffering; `for await` pauses the socket when we await throttled writes.
    for await (const raw of stream as AsyncIterable<Buffer | string>) {
      if (this.pausedRequested || this.cancelled || signal.aborted) {
        res.destroy()
        throw Object.assign(new Error('aborted'), { code: 'aborted' })
      }
      let chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)

      if (skipped < skipBytes) {
        const need = skipBytes - skipped
        if (chunk.length <= need) {
          skipped += chunk.length
          continue
        }
        chunk = chunk.subarray(need)
        skipped = skipBytes
      }

      // Guard against servers sending more than the segment window.
      const room = segLen - (writePos - seg.start)
      if (room <= 0) break
      if (chunk.length > room) chunk = chunk.subarray(0, room)

      await deps.globalThrottle.acquire(chunk.length)
      await this.taskThrottle.acquire(chunk.length)

      await writer.writeAt(chunk, writePos)
      writePos += chunk.length
      seg.done = writePos - seg.start
      this.downloadedBytes = this.computeTotal()
      this.sampleSpeed()
      this.emit('progress', { id: this.id })
    }

    res.destroy()

    if (seg.end >= 0 && seg.done < seg.end - seg.start + 1) {
      // Clean stream end but segment incomplete → connection dropped early.
      throw Object.assign(new Error('Server closed the connection before the segment finished.'), {
        code: 'ECONNRESET'
      })
    }
    if (this.totalBytes >= 0 && this.downloadedBytes > this.totalBytes) {
      throw Object.assign(new Error('Server sent more data than the declared file size.'), {
        code: 'size_mismatch'
      })
    }
  }

  private computeTotal(): number {
    return this.baseBytes + this.segments.reduce((sum, s) => sum + s.done, 0)
  }

  private sampleSpeed(): void {
    const now = Date.now()
    const dt = now - this.lastSampleAt
    if (dt < 500) return
    const bytes = this.downloadedBytes - this.lastSampleBytes
    const inst = (bytes / dt) * 1000
    this.speedEma = this.speedEma === 0 ? inst : this.speedEma * 0.7 + inst * 0.3
    this.speedBps = Math.max(0, this.speedEma)
    this.etaSeconds =
      this.totalBytes > 0 && this.speedBps > 0
        ? Math.max(1, Math.ceil((this.totalBytes - this.downloadedBytes) / this.speedBps))
        : null
    this.lastSampleAt = now
    this.lastSampleBytes = this.downloadedBytes
  }

  // ------------------------------------------------------------- transitions

  pause(): void {
    if (this.status === 'completed' || this.status === 'failed' || this.status === 'cancelled') return
    this.pausedRequested = true
    this.controller?.abort()
  }

  cancel(): void {
    this.cancelled = true
    this.pausedRequested = true
    this.controller?.abort()
    this.setStatus('cancelled')
  }

  private finishPause(): void {
    if (this.cancelled) return
    for (const seg of this.segments) if (seg.state === 'running') seg.state = 'pending'
    this.setStatus('paused')
  }

  setSpeedLimit(bytesPerSec: number): void {
    this.speedLimitBps = bytesPerSec
    this.taskThrottle.setRate(bytesPerSec)
  }

  private setStatus(status: DownloadStatus): void {
    if (this.status === status) return
    this.status = status
    if (status === 'completed') this.completedAt = Date.now()
    this.emit('state', { id: this.id, status })
  }

  private fail(reason: FailureReason, detail: string): void {
    this.failureReason = reason
    this.failureDetail = detail
    this.setStatus('failed')
  }

  private failFromError(err: unknown): void {
    if (this.cancelled) return
    const e = err as { code?: string; statusCode?: number; message?: string }
    if (e?.statusCode) {
      const reason = reasonForHttpStatus(e.statusCode)
      this.fail(reason, friendlyMessageForStatus(e.statusCode, this.finalUrl ?? this.url))
      return
    }
    const code = e?.code ?? 'unknown'
    const reason = reasonForNodeError(code)
    const msg = friendlyMessageForNodeError(code)
    this.fail(reason, e?.message && code === 'unknown' ? e.message : msg)
  }

  // ---------------------------------------------------------------- finalise

  private async verifyAndFinalise(deps: TaskDeps): Promise<void> {
    if (!this.writer) throw new Error('writer missing')
    if (this.totalBytes >= 0) {
      const allDone = this.segments.every((s) => s.state === 'done')
      if (!allDone || this.downloadedBytes !== this.totalBytes) {
        throw Object.assign(
          new Error(`Verification failed: ${this.downloadedBytes}/${this.totalBytes} bytes.`),
          { code: 'size_mismatch' }
        )
      }
    }
    await this.writer.sync()
    await this.writer.close()
    this.writer = null

    const size = await deps.fileManager.size(this.partPath)
    if (this.totalBytes >= 0 && size < this.totalBytes) {
      throw Object.assign(new Error('File on disk is shorter than expected.'), { code: 'size_mismatch' })
    }
    if (this.totalBytes >= 0 && size > this.totalBytes) {
      // trim preallocation slack
      const w = new FileWriter(this.partPath, false)
      await w.open(null)
      await w.truncateTo(this.totalBytes)
      await w.close()
    }
    await deps.fileManager.finalizeRename(this.partPath, this.filePath, true)
    this.setStatus('completed')
  }

  private async closeWriter(): Promise<void> {
    try {
      await this.writer?.close()
    } catch (err) {
      log.warn('writer close failed', err)
    }
    this.writer = null
  }

  private applyProbe(probe: ProbeResult, _deps: TaskDeps): void {
    this.probe = probe
    this.finalUrl = probe.finalUrl
    this.totalBytes = probe.totalBytes
    this.supportsResume = probe.supportsResume
    this.serverIgnoresRanges = probe.rangeIgnored
    this.etag = probe.etag
    this.lastModified = probe.lastModified
    this.httpStatus = probe.status
  }

  /** Snapshot for persistence / IPC. */
  toRecord(existing?: DownloadRecord): DownloadRecord {
    const category = existing?.category ?? 'Other'
    return {
      ...(existing as DownloadRecord),
      id: this.id,
      url: this.url,
      finalUrl: this.finalUrl,
      filename: this.filename,
      filePath: this.status === 'completed' ? this.filePath : null,
      partPath: this.status === 'completed' || this.status === 'cancelled' ? null : this.partPath,
      categoryId: existing?.categoryId ?? 0,
      category,
      status: this.status,
      totalBytes: this.totalBytes,
      downloadedBytes: this.downloadedBytes,
      speedBps: this.speedBps,
      etaSeconds: this.etaSeconds,
      segments: this.segments.map((s) => ({ id: s.index, index: s.index, start: s.start, end: s.end, done: s.done, state: s.state })),
      supportsResume: this.supportsResume,
      speedLimitBps: this.speedLimitBps,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries,
      createdAt: existing?.createdAt ?? Date.now(),
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      updatedAt: Date.now(),
      queuePos: existing?.queuePos ?? 0,
      failureReason: this.failureReason,
      failureDetail: this.failureDetail,
      validatorEtag: this.etag,
      validatorLastModified: this.lastModified,
      httpStatus: this.httpStatus,
      note: existing?.note ?? null
    }
  }

  setFilenameAndPaths(filename: string, dir: string): void {
    this.filename = filename
    this.filePath = path.join(dir, filename)
    this.partPath = `${this.filePath}.part`
  }

  /** Restore persisted segment progress (crash recovery). */
  restoreSegments(segments: Array<{ start: number; end: number; done: number }>): void {
    if (segments.length === 0) return
    this.segments = segments.map((s, i) => ({
      index: i,
      start: s.start,
      end: s.end,
      done: s.done,
      state: s.end >= 0 && s.done >= s.end - s.start + 1 ? ('done' as const) : ('pending' as const)
    }))
    this.downloadedBytes = this.segments.reduce((sum, s) => sum + s.done, 0)
    this.baseBytes = 0
  }
}

function withReadTimeout<T>(
  p: Promise<T>,
  ms: number,
  signal: AbortSignal,
  onTimeout: () => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      onTimeout() // destroy the socket so the read loop unblocks
      reject(Object.assign(new Error('Read timed out — the server stopped sending data.'), { code: 'ETIMEDOUT' }))
    }, ms)
    timer.unref?.()
    const onAbort = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(Object.assign(new Error('aborted'), { code: 'aborted' }))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => {
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e) => {
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        reject(e)
      }
    )
  })
}
