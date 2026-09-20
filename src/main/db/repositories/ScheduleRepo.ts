import type { DatabaseSync } from 'node:sqlite'
import type { ScheduleRow } from '@shared/types'

interface SchRow {
  id: number
  start_at: number | null
  stop_at: number | null
  enabled: number
  mode: string
}

function toRow(r: SchRow): ScheduleRow {
  return {
    id: r.id,
    startAt: r.start_at == null ? null : Number(r.start_at),
    stopAt: r.stop_at == null ? null : Number(r.stop_at),
    enabled: r.enabled === 1,
    mode: r.mode === 'daily' ? 'daily' : 'once'
  }
}

export class ScheduleRepo {
  constructor(private db: DatabaseSync) {}

  get(): ScheduleRow | null {
    const r = this.db.prepare('SELECT * FROM schedules ORDER BY id LIMIT 1').get() as SchRow | undefined
    return r ? toRow(r) : null
  }

  upsert(patch: Partial<ScheduleRow> & { id?: number }): ScheduleRow {
    const cur = this.get()
    if (cur) {
      this.db
        .prepare('UPDATE schedules SET start_at = ?, stop_at = ?, enabled = ?, mode = ? WHERE id = ?')
        .run(
          patch.startAt ?? cur.startAt,
          patch.stopAt ?? cur.stopAt,
          (patch.enabled ?? cur.enabled) ? 1 : 0,
          patch.mode ?? cur.mode,
          cur.id
        )
      return this.get()!
    }
    const res = this.db
      .prepare('INSERT INTO schedules (start_at, stop_at, enabled, mode) VALUES (?, ?, ?, ?)')
      .run(patch.startAt ?? null, patch.stopAt ?? null, patch.enabled ? 1 : 0, patch.mode ?? 'once')
    return this.get() ?? { id: Number(res.lastInsertRowid), startAt: null, stopAt: null, enabled: false, mode: 'once' }
  }

  disable(id: number): void {
    this.db.prepare('UPDATE schedules SET enabled = 0 WHERE id = ?').run(id)
  }
}
