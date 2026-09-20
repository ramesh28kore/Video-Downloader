import { EventEmitter } from 'node:events'
import type { ScheduleRepo } from '../db/repositories/ScheduleRepo'
import { createLogger } from '../util/logger'

const log = createLogger('scheduler')

export interface SchedulerEvents {
  start: []
  stop: []
  changed: []
}

/**
 * Time-based queue scheduling (spec: "works even when minimized"). A single
 * one-minute tick compares wall-clock time against the stored schedule and
 * fires start/stop once each (for 'once' mode it disables itself after firing).
 */
export class Scheduler extends EventEmitter<SchedulerEvents> {
  private timer: ReturnType<typeof setInterval> | null = null
  private firedStart = false
  private firedStop = false

  constructor(private repo: ScheduleRepo) {
    super()
  }

  /** Called by the manager when the app is shutting down. */
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), 30_000)
    this.timer.unref?.()
    this.tick()
  }

  private tick(): void {
    const schedule = this.repo.get()
    if (!schedule || !schedule.enabled) return
    const now = Date.now()
    if (schedule.startAt != null && now >= schedule.startAt && !this.firedStart) {
      this.firedStart = true
      log.info('scheduler: start time reached')
      this.emit('start')
      if (schedule.mode === 'once' && (schedule.stopAt == null || now >= schedule.stopAt)) {
        this.repo.disable(schedule.id)
      }
    }
    if (schedule.stopAt != null && now >= schedule.stopAt && !this.firedStop) {
      this.firedStop = true
      log.info('scheduler: stop time reached')
      this.emit('stop')
      if (schedule.mode === 'once' && schedule.startAt != null && now >= schedule.startAt) {
        this.repo.disable(schedule.id)
      }
    }
    if (schedule.mode === 'daily') {
      // Reset the fired flags at midnight so the schedule repeats tomorrow.
      const d = new Date()
      if (d.getHours() === 0 && d.getMinutes() === 0) {
        this.firedStart = false
        this.firedStop = false
      }
    }
  }

  /** Test hook. */
  forceTick(): void {
    this.tick()
  }
}
