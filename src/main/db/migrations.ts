import type { DatabaseSync } from 'node:sqlite'

/**
 * Forward-only migrations tracked in `schema_migrations`. SQLite via
 * node:sqlite has no async API, so this is synchronous by design — it runs
 * once at startup on a small local file.
 */
const MIGRATIONS: Array<{ id: number; sql: string }> = [
  {
    id: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS categories (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE,
        folder     TEXT NOT NULL,
        extensions TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS downloads (
        id                   TEXT PRIMARY KEY,
        url                  TEXT NOT NULL,
        final_url            TEXT,
        filename             TEXT NOT NULL,
        file_path            TEXT,
        part_path            TEXT,
        category_id          INTEGER NOT NULL DEFAULT 9,
        status               TEXT NOT NULL,
        total_bytes          INTEGER NOT NULL DEFAULT -1,
        downloaded_bytes     INTEGER NOT NULL DEFAULT 0,
        supports_resume      INTEGER NOT NULL DEFAULT 0,
        speed_limit_bps      INTEGER NOT NULL DEFAULT 0,
        retry_count          INTEGER NOT NULL DEFAULT 0,
        max_retries          INTEGER NOT NULL DEFAULT 4,
        created_at           INTEGER NOT NULL,
        started_at           INTEGER,
        completed_at         INTEGER,
        updated_at           INTEGER NOT NULL,
        queue_pos            INTEGER NOT NULL DEFAULT 0,
        failure_reason       TEXT,
        failure_detail       TEXT,
        validator_etag       TEXT,
        validator_lastmod    TEXT,
        http_status          INTEGER,
        note                 TEXT,
        headers              TEXT,
        save_dir             TEXT,
        FOREIGN KEY (category_id) REFERENCES categories(id)
      );

      CREATE TABLE IF NOT EXISTS segments (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        download_id  TEXT NOT NULL REFERENCES downloads(id) ON DELETE CASCADE,
        idx          INTEGER NOT NULL,
        start        INTEGER NOT NULL,
        end          INTEGER NOT NULL,
        done         INTEGER NOT NULL DEFAULT 0,
        state        TEXT NOT NULL DEFAULT 'pending'
      );

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schedules (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        start_at INTEGER,
        stop_at  INTEGER,
        enabled  INTEGER NOT NULL DEFAULT 0,
        mode     TEXT NOT NULL DEFAULT 'once'
      );

      CREATE INDEX IF NOT EXISTS idx_downloads_status    ON downloads(status);
      CREATE INDEX IF NOT EXISTS idx_downloads_category  ON downloads(category_id);
      CREATE INDEX IF NOT EXISTS idx_downloads_filename  ON downloads(filename);
      CREATE INDEX IF NOT EXISTS idx_downloads_created   ON downloads(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_downloads_updated   ON downloads(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_downloads_queue     ON downloads(queue_pos);
      CREATE INDEX IF NOT EXISTS idx_segments_download   ON segments(download_id);
    `
  }
]

export function runMigrations(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id        INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`)

  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: number }>).map((r) => r.id)
  )

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue
    db.exec('BEGIN')
    try {
      db.exec(migration.sql)
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        migration.id,
        Date.now()
      )
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}
