import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { runMigrations } from './migrations'
import { createLogger } from '../util/logger'

const log = createLogger('db')

/**
 * Thin, typed wrapper over Electron's built-in `node:sqlite` (verified present
 * in Electron 44 — see scripts/verify-electron-sqlite.mjs).
 *
 * Pragmas chosen for a download manager: WAL so progress writes never block
 * reads from the UI; synchronous=NORMAL (durable enough — .part files are the
 * real source of truth and are fsynced at completion); busy_timeout so the
 * batched persister and UI reads never throw SQLITE_BUSY.
 */
export class Database {
  readonly db: DatabaseSync

  constructor(file: string) {
    if (file !== ':memory:') {
      mkdirSync(path.dirname(file), { recursive: true })
    }
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.db.exec('PRAGMA foreign_keys = ON')
    runMigrations(this.db)
    log.info('database ready at', file)
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* ignore */
      }
      throw err
    }
  }

  close(): void {
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      /* non-fatal */
    }
    this.db.close()
  }
}
