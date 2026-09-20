// ---------------------------------------------------------------------------
// Shared type definitions — imported by main, preload and renderer.
// This file must stay free of Node/Electron imports.
// ---------------------------------------------------------------------------

export const DOWNLOAD_STATUSES = [
  'idle',
  'queued',
  'connecting',
  'downloading',
  'paused',
  'waiting',
  'retrying',
  'completed',
  'failed',
  'cancelled'
] as const

export type DownloadStatus = (typeof DOWNLOAD_STATUSES)[number]

/** Statuses that occupy a slot in the concurrent-download queue. */
export const ACTIVE_STATUSES: readonly DownloadStatus[] = [
  'connecting',
  'downloading',
  'retrying'
]

export const CATEGORIES = [
  'Documents',
  'Videos',
  'Music',
  'Images',
  'Archives',
  'Software',
  'Compressed',
  'Programs',
  'Other'
] as const

export type CategoryName = (typeof CATEGORIES)[number]

export type DuplicateMode = 'rename' | 'replace' | 'cancel'

export type ThemeMode = 'light' | 'dark' | 'system'

/** Result of a URL probe (HEAD/ranged-GET) — shared between main and renderer. */
export interface ProbeResult {
  ok: boolean
  /** Original URL requested. */
  url: string
  /** URL after redirects. */
  finalUrl: string
  status: number | null
  /** Total size in bytes, -1 if unknown. */
  totalBytes: number
  contentLength: number | null
  contentType: string | null
  acceptsRanges: boolean
  supportsResume: boolean
  etag: string | null
  lastModified: string | null
  /** Best-guess filename (sanitized, no directory). */
  filename: string
  /** Category name inferred from type/extension/magic bytes. */
  categoryHint: string | null
  /** Detected media kind from magic bytes, e.g. 'mp4', 'mkv', 'zip', 'pdf'. */
  magicKind: string | null
  /** True when the server ignored a Range probe (returned 200 for bytes=0-0). */
  rangeIgnored: boolean
  error?: { code: string; message: string }
}

export interface CategoryRow {
  id: number
  name: string
  /** Default sub-folder under the base downloads dir, e.g. "Videos". */
  folder: string
  /** Extension list owned by this category, lowercase without dots. */
  extensions: string[]
}

export interface DownloadSegmentDTO {
  id: number
  index: number
  start: number
  end: number
  done: number
  state: 'pending' | 'running' | 'done' | 'failed'
}

/** Full record — sent on create/update events and for the details panel. */
export interface DownloadRecord {
  id: string
  url: string
  /** URL after redirects (recorded once known). */
  finalUrl: string | null
  filename: string
  /** Absolute path of the final file once complete. */
  filePath: string | null
  /** Absolute path of the .part file while in flight. */
  partPath: string | null
  categoryId: number
  category: string
  status: DownloadStatus
  /** -1 when the server did not advertise a size. */
  totalBytes: number
  /** Bytes already committed to disk across all segments. */
  downloadedBytes: number
  /** Instantaneous bytes/sec (EMA smoothed). */
  speedBps: number
  etaSeconds: number | null
  /** Number of parallel HTTP connections actually in use. */
  segments: DownloadSegmentDTO[]
  supportsResume: boolean
  /** Per-download speed cap in bytes/sec; 0 = unlimited. */
  speedLimitBps: number
  retryCount: number
  maxRetries: number
  /** Epoch ms; used by the scheduler + history sorting. */
  createdAt: number
  startedAt: number | null
  completedAt: number | null
  updatedAt: number
  queuePos: number
  /** Friendly failure reason code when status === 'failed'. */
  failureReason: FailureReason | null
  /** Human-readable detail for the failure. */
  failureDetail: string | null
  /** ETag / Last-Modified captured for resume validation. */
  validatorEtag: string | null
  validatorLastModified: string | null
  httpStatus: number | null
  /** User note shown in the details panel. */
  note: string | null
}

/** Compact progress tick — throttled IPC payload for the table rows. */
export interface ProgressTick {
  id: string
  status: DownloadStatus
  done: number
  total: number
  speed: number
  eta: number | null
}

export type FailureReason =
  | 'invalid_url'
  | 'unsupported_scheme'
  | 'not_found'
  | 'forbidden'
  | 'unauthorized'
  | 'server_error'
  | 'network'
  | 'timeout'
  | 'connection_dropped'
  | 'disk_full'
  | 'permission_denied'
  | 'unsupported_resume'
  | 'too_many_redirects'
  | 'cancelled'
  | 'rate_limited'
  | 'unknown'

export interface AddDownloadOptions {
  url: string
  /** Desired destination directory; when null the category folder is used. */
  saveIn?: string | null
  /** Override the detected filename. */
  filename?: string | null
  /** Force a category id; when null it is auto-detected. */
  categoryId?: number | null
  /** Start immediately vs. keep queued. */
  startNow?: boolean
  /** Duplicate handling policy for this item. */
  duplicateMode?: DuplicateMode
  /** User-supplied Cookie header for their own authorized downloads. */
  headers?: Record<string, string> | null
}

export interface CreateDownloadResult {
  record: DownloadRecord
  /** True when a duplicate was detected and the renderer must ask the user. */
  duplicateDetected?: { suggestedName: string } | false
}

export interface QueueStats {
  active: number
  queued: number
  maxConcurrent: number
  /** Global throughput of active downloads, bytes/sec. */
  speedBps: number
}

export interface AppSettings {
  downloadDir: string
  maxConcurrent: number
  /** Connections (segments) per download, 1–16. */
  segmentsPerDownload: number
  /** Global speed cap in KiB/sec; 0 = unlimited. */
  globalSpeedLimitKbps: number
  retryCount: number
  /** Network timeout in seconds for connect/read. */
  timeoutSeconds: number
  autoStart: boolean
  monitorClipboard: boolean
  autoDetectVideos: boolean
  /** Immediately queue verified direct videos reported by the browser companion. */
  autoDownloadDetectedVideos: boolean
  playSounds: boolean
  minimizeToTray: boolean
  startMinimized: boolean
  launchAtStartup: boolean
  theme: ThemeMode
  /** Move completed files into category sub-folders. */
  autoCategorize: boolean
  confirmOnDelete: boolean
  /** Pre-allocate sparse .part files (NTFS). */
  preallocate: boolean
  /** User-Agent override sent on requests. */
  userAgent: string
}

export interface ScheduleRow {
  id: number
  /** Epoch ms to auto-start the queue; null = disabled. */
  startAt: number | null
  /** Epoch ms to auto-stop/pause everything; null = disabled. */
  stopAt: number | null
  enabled: boolean
  /** 'once' schedules auto-disable after firing. */
  mode: 'once' | 'daily'
}

// ---- Clipboard / multi-URL import -----------------------------------------

export interface ClipboardUrlInfo {
  url: string
  filename: string | null
  detected: boolean
  kind: 'video' | 'link'
}

export interface DetectedMediaQuality {
  label: string
  url: string
  width?: number
  height?: number
  bitrate?: number
}

export interface DetectedMedia {
  id: string
  url: string
  pageUrl: string
  title: string | null
  filename: string | null
  kind: 'direct' | 'hls' | 'dash'
  mimeType: string | null
  quality: string | null
  qualities: DetectedMediaQuality[]
  playing: boolean
  visible: boolean
}

// ---- History queries -------------------------------------------------------

export interface HistoryFilter {
  text?: string
  status?: DownloadStatus | 'all'
  categoryId?: number | 'all'
  since?: number | null
  until?: number | null
  sort?: 'created_desc' | 'created_asc' | 'name_asc' | 'name_desc' | 'size_desc'
  limit?: number
  offset?: number
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}
