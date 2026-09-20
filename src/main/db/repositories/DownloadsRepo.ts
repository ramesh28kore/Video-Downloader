import type { DatabaseSync } from 'node:sqlite'
import type { DownloadRecord, DownloadSegmentDTO, DownloadStatus, FailureReason } from '@shared/types'

export interface DownloadRow {
  id: string
  url: string
  final_url: string | null
  filename: string
  file_path: string | null
  part_path: string | null
  category_id: number
  category_name: string
  status: string
  total_bytes: number
  downloaded_bytes: number
  supports_resume: number
  speed_limit_bps: number
  retry_count: number
  max_retries: number
  created_at: number
  started_at: number | null
  completed_at: number | null
  updated_at: number
  queue_pos: number
  failure_reason: string | null
  failure_detail: string | null
  validator_etag: string | null
  validator_lastmod: string | null
  http_status: number | null
  note: string | null
  headers: string | null
  save_dir: string | null
}

const SELECT_BASE = `
  SELECT d.*, c.name AS category_name
  FROM downloads d
  LEFT JOIN categories c ON c.id = d.category_id
`

function toRecord(row: DownloadRow, segments: DownloadSegmentDTO[]): DownloadRecord {
  return {
    id: row.id,
    url: row.url,
    finalUrl: row.final_url,
    filename: row.filename,
    filePath: row.file_path,
    partPath: row.part_path,
    categoryId: row.category_id,
    category: row.category_name ?? 'Other',
    status: row.status as DownloadStatus,
    totalBytes: Number(row.total_bytes),
    downloadedBytes: Number(row.downloaded_bytes),
    speedBps: 0,
    etaSeconds: null,
    segments,
    supportsResume: row.supports_resume === 1,
    speedLimitBps: Number(row.speed_limit_bps),
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    createdAt: Number(row.created_at),
    startedAt: row.started_at == null ? null : Number(row.started_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
    updatedAt: Number(row.updated_at),
    queuePos: row.queue_pos,
    failureReason: (row.failure_reason as FailureReason | null) ?? null,
    failureDetail: row.failure_detail,
    validatorEtag: row.validator_etag,
    validatorLastModified: row.validator_lastmod,
    httpStatus: row.http_status,
    note: row.note
  }
}

export interface InsertDownloadParams {
  record: DownloadRecord
  headers: Record<string, string> | null
  saveDir: string
}

export class DownloadsRepo {
  constructor(private db: DatabaseSync) {}

  insert(record: DownloadRecord, headers: Record<string, string> | null, saveDir: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO downloads (
        id, url, final_url, filename, file_path, part_path, category_id, status,
        total_bytes, downloaded_bytes, supports_resume, speed_limit_bps,
        retry_count, max_retries, created_at, started_at, completed_at, updated_at,
        queue_pos, failure_reason, failure_detail, validator_etag, validator_lastmod,
        http_status, note, headers, save_dir
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      record.id,
      record.url,
      record.finalUrl,
      record.filename,
      record.filePath,
      record.partPath,
      record.categoryId,
      record.status,
      record.totalBytes,
      record.downloadedBytes,
      record.supportsResume ? 1 : 0,
      record.speedLimitBps,
      record.retryCount,
      record.maxRetries,
      record.createdAt,
      record.startedAt,
      record.completedAt,
      record.updatedAt,
      record.queuePos,
      record.failureReason,
      record.failureDetail,
      record.validatorEtag,
      record.validatorLastModified,
      record.httpStatus,
      record.note,
      headers ? JSON.stringify(headers) : null,
      saveDir
    )
    this.replaceSegments(record.id, record.segments)
  }

  replaceSegments(id: string, segments: DownloadSegmentDTO[]): void {
    this.db.prepare('DELETE FROM segments WHERE download_id = ?').run(id)
    const ins = this.db.prepare(
      'INSERT INTO segments (download_id, idx, start, end, done, state) VALUES (?, ?, ?, ?, ?, ?)'
    )
    for (const s of segments) {
      ins.run(id, s.index, s.start, s.end, s.done, s.state)
    }
  }

  updateProgress(id: string, downloadedBytes: number, retryCount: number): void {
    this.updateStmt().run(downloadedBytes, retryCount, Date.now(), id)
  }
  private _updateProgress: ReturnType<DatabaseSync['prepare']> | null = null
  private updateStmt(): ReturnType<DatabaseSync['prepare']> {
    if (!this._updateProgress) {
      this._updateProgress = this.db.prepare(
        'UPDATE downloads SET downloaded_bytes = ?, retry_count = ?, updated_at = ? WHERE id = ?'
      )
    }
    return this._updateProgress
  }

  updateFull(record: DownloadRecord): void {
    this.db
      .prepare(
        `UPDATE downloads SET
           url = ?, final_url = ?, filename = ?, file_path = ?, part_path = ?,
           category_id = ?, status = ?, total_bytes = ?, downloaded_bytes = ?,
           supports_resume = ?, speed_limit_bps = ?, retry_count = ?, max_retries = ?,
           started_at = ?, completed_at = ?, updated_at = ?, queue_pos = ?,
           failure_reason = ?, failure_detail = ?, validator_etag = ?, validator_lastmod = ?,
           http_status = ?, note = ?
         WHERE id = ?`
      )
      .run(
        record.url,
        record.finalUrl,
        record.filename,
        record.filePath,
        record.partPath,
        record.categoryId,
        record.status,
        record.totalBytes,
        record.downloadedBytes,
        record.supportsResume ? 1 : 0,
        record.speedLimitBps,
        record.retryCount,
        record.maxRetries,
        record.startedAt,
        record.completedAt,
        Date.now(),
        record.queuePos,
        record.failureReason,
        record.failureDetail,
        record.validatorEtag,
        record.validatorLastModified,
        record.httpStatus,
        record.note,
        record.id
      )
    this.replaceSegments(record.id, record.segments)
  }

  getHeaders(id: string): Record<string, string> | null {
    const row = this.db.prepare('SELECT headers FROM downloads WHERE id = ?').get(id) as
      | { headers: string | null }
      | undefined
    if (!row?.headers) return null
    try {
      return JSON.parse(row.headers) as Record<string, string>
    } catch {
      return null
    }
  }

  getSaveDir(id: string): string | null {
    const row = this.db.prepare('SELECT save_dir FROM downloads WHERE id = ?').get(id) as
      | { save_dir: string | null }
      | undefined
    return row?.save_dir ?? null
  }

  get(id: string): DownloadRecord | null {
    const row = this.db.prepare(`${SELECT_BASE} WHERE d.id = ?`).get(id) as DownloadRow | undefined
    if (!row) return null
    return toRecord(row, this.getSegments(id))
  }

  getSegments(id: string): DownloadSegmentDTO[] {
    const rows = this.db
      .prepare('SELECT idx, start, end, done, state FROM segments WHERE download_id = ? ORDER BY idx')
      .all(id) as Array<{ idx: number; start: number; end: number; done: number; state: string }>
    return rows.map((r) => ({
      id: r.idx,
      index: r.idx,
      start: Number(r.start),
      end: Number(r.end),
      done: Number(r.done),
      state: r.state as DownloadSegmentDTO['state']
    }))
  }

  listActive(): DownloadRecord[] {
    const rows = this.db
      .prepare(
        `${SELECT_BASE} WHERE d.status IN ('queued','downloading','paused','connecting','retrying','waiting','idle') ORDER BY d.queue_pos ASC`
      )
      .all() as unknown as DownloadRow[]
    return rows.map((r) => toRecord(r, this.getSegments(r.id)))
  }

  listAll(): DownloadRecord[] {
    const rows = this.db.prepare(`${SELECT_BASE} ORDER BY d.created_at DESC`).all() as unknown as DownloadRow[]
    return rows.map((r) => toRecord(r, this.getSegments(r.id)))
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM downloads WHERE id = ?').run(id)
  }

  /** Names currently used in a destination dir (final + in-flight). */
  namesInDir(saveDir: string): Set<string> {
    const rows = this.db
      .prepare(
        `SELECT filename FROM downloads
         WHERE save_dir = ? AND status NOT IN ('cancelled','failed')`
      )
      .all(saveDir) as Array<{ filename: string }>
    return new Set(rows.map((r) => r.filename.toLowerCase()))
  }

  nextQueuePos(): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(queue_pos), 0) AS m FROM downloads').get() as {
      m: number
    }
    return Number(row.m) + 1
  }

  setQueuePos(id: string, pos: number): void {
    this.db.prepare('UPDATE downloads SET queue_pos = ? WHERE id = ?').run(pos, id)
  }

  setStatus(id: string, status: DownloadStatus): void {
    this.db.prepare('UPDATE downloads SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id)
  }

  /** Rows with a .part file that survived a crash — recovery candidates. */
  listInterrupted(): DownloadRecord[] {
    const rows = this.db
      .prepare(
        `${SELECT_BASE} WHERE d.status IN ('downloading','connecting','retrying','queued','waiting','idle') ORDER BY d.queue_pos ASC`
      )
      .all() as unknown as DownloadRow[]
    return rows.map((r) => toRecord(r, this.getSegments(r.id)))
  }

  historyQuery(opts: {
    text?: string
    status?: DownloadStatus | 'all'
    categoryId?: number | 'all'
    since?: number | null
    until?: number | null
    sort?: string
    limit?: number
    offset?: number
  }): DownloadRecord[] {
    const where: string[] = []
    const params: (string | number)[] = []
    if (opts.text) {
      where.push('(LOWER(d.filename) LIKE ? OR LOWER(d.url) LIKE ?)')
      const like = `%${opts.text.toLowerCase()}%`
      params.push(like, like)
    }
    if (opts.status && opts.status !== 'all') {
      where.push('d.status = ?')
      params.push(opts.status)
    }
    if (opts.categoryId != null && opts.categoryId !== 'all') {
      where.push('d.category_id = ?')
      params.push(opts.categoryId)
    }
    if (opts.since != null) {
      where.push('d.created_at >= ?')
      params.push(opts.since)
    }
    if (opts.until != null) {
      where.push('d.created_at <= ?')
      params.push(opts.until)
    }
    const sortMap: Record<string, string> = {
      created_desc: 'd.created_at DESC',
      created_asc: 'd.created_at ASC',
      name_asc: 'd.filename COLLATE NOCASE ASC',
      name_desc: 'd.filename COLLATE NOCASE DESC',
      size_desc: 'd.total_bytes DESC'
    }
    const orderBy = sortMap[opts.sort ?? 'created_desc'] ?? 'd.created_at DESC'
    const sql = `${SELECT_BASE}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    params.push(opts.limit ?? 500, opts.offset ?? 0)
    const rows = this.db.prepare(sql).all(...params) as unknown as DownloadRow[]
    return rows.map((r) => toRecord(r, this.getSegments(r.id)))
  }

  clearHistory(statuses: DownloadStatus[]): number {
    const placeholders = statuses.map(() => '?').join(',')
    const result = this.db
      .prepare(`DELETE FROM downloads WHERE status IN (${placeholders})`)
      .run(...statuses)
    return Number(result.changes ?? 0)
  }
}
