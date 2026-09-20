// Formatting helpers used by the renderer (pure functions, no DOM).

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : digits)} ${units[i]}`
}

/** Bytes/sec rendered as IDM-style "x.x MB/s". */
export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 B/s'
  return `${formatBytes(bytesPerSec)}/s`
}

export function formatEta(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—'
  const s = Math.round(seconds)
  if (s < 60) return `${s} sec`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} sec`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} hr ${String(m % 60).padStart(2, '0')} min`
  const d = Math.floor(h / 24)
  return `${d} days ${String(h % 24).padStart(2, '0')} hr`
}

export function formatPercent(done: number, total: number): string {
  if (total <= 0) return done > 0 ? '—' : '0%'
  const pct = (done / total) * 100
  return pct >= 99.9 && pct < 100 ? '99.9%' : `${pct.toFixed(pct < 10 ? 1 : 0)}%`
}

export function formatDateTime(epochMs: number | null): string {
  if (!epochMs) return '—'
  const d = new Date(epochMs)
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function formatDateOnly(epochMs: number | null): string {
  if (!epochMs) return '—'
  return new Date(epochMs).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  })
}

/** "video.mp4" -> "mp4" (lowercase, empty when none). */
export function extOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? ''
  const idx = base.lastIndexOf('.')
  if (idx <= 0 || idx === base.length - 1) return ''
  return base.slice(idx + 1).toLowerCase()
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return '—'
  }
}

/** Clamp helper used across progress bars. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
