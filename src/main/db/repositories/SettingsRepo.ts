import type { DatabaseSync } from 'node:sqlite'
import type { AppSettings } from '@shared/types'

export class SettingsRepo {
  constructor(private db: DatabaseSync) {}

  getAll(defaults: AppSettings): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{
      key: string
      value: string
    }>
    const map = new Map(rows.map((r) => [r.key, r.value]))
    const out: AppSettings = { ...defaults }
    for (const key of Object.keys(defaults) as Array<keyof AppSettings>) {
      const raw = map.get(key)
      if (raw == null) continue
      const def = defaults[key]
      try {
        if (typeof def === 'number') (out[key] as number) = Number(raw)
        else if (typeof def === 'boolean') (out[key] as boolean) = raw === 'true'
        else if (typeof def === 'string') (out[key] as string) = raw
      } catch {
        /* keep default on parse error */
      }
    }
    return out
  }

  update(patch: Partial<AppSettings>): void {
    const stmt = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    this.db.exec('BEGIN')
    try {
      for (const [key, value] of Object.entries(patch)) {
        stmt.run(key, String(value))
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  getRaw(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  setRaw(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }
}
