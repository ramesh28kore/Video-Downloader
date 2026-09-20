import type { DownloadsRepo } from './repositories/DownloadsRepo'
import { createLogger } from '../util/logger'

const log = createLogger('persist')

/**
 * Batches high-frequency progress updates into one transaction per interval
 * (spec: "throttle persistence to a few hundred ms"). State transitions must
 * be persisted immediately via {@link flushNow}; periodic ticks go through
 * {@link schedule}, which coalesces by download id.
 */
export class ProgressPersister {
  private dirty = new Map<string, { downloadedBytes: number; retryCount: number }>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  constructor(
    private repo: DownloadsRepo,
    private intervalMs = 1000
  ) {}

  schedule(id: string, downloadedBytes: number, retryCount: number): void {
    if (this.stopped) return
    this.dirty.set(id, { downloadedBytes, retryCount })
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.flush()
      }, this.intervalMs)
      this.timer.unref?.()
    }
  }

  /** Persist a single download immediately (state transition). */
  flushNow(id: string, downloadedBytes: number, retryCount: number): void {
    this.dirty.set(id, { downloadedBytes, retryCount })
    this.flush()
  }

  flush(): void {
    if (this.dirty.size === 0) return
    const batch = [...this.dirty.entries()]
    this.dirty.clear()
    try {
      for (const [id, p] of batch) {
        this.repo.updateProgress(id, p.downloadedBytes, p.retryCount)
      }
    } catch (err) {
      log.error('progress flush failed', err)
    }
  }

  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.flush()
  }
}
