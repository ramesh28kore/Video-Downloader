import { httpGet, readPrefix, HttpError } from './RangeHttpClient'
import { sanitizeFilename, uniqueName } from '../fs/PathValidator'
import type { ProbeResult } from '@shared/types'

export type { ProbeResult }

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff'])
const VIDEO_EXT = new Set(['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg', 'ts'])
const AUDIO_EXT = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus'])
const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst'])
const DOC_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv', 'epub'])
const SOFTWARE_EXT = new Set(['exe', 'msi', 'dmg', 'apk', 'deb', 'rpm', 'appimage', 'iso', 'bin'])

/**
 * Probe a URL with a tiny ranged GET to learn size, resumability, filename and
 * type without downloading anything meaningful. Falls back to HEAD.
 */
export async function probeUrl(
  url: string,
  opts: { headers?: Record<string, string>; signal?: AbortSignal; userAgent?: string } = {}
): Promise<ProbeResult> {
  const base: ProbeResult = {
    ok: false,
    url,
    finalUrl: url,
    status: null,
    totalBytes: -1,
    contentLength: null,
    contentType: null,
    acceptsRanges: false,
    supportsResume: false,
    etag: null,
    lastModified: null,
    filename: filenameFromUrl(url),
    categoryHint: null,
    magicKind: null,
    rangeIgnored: false
  }

  const headers = { ...(opts.headers ?? {}) }
  if (opts.userAgent) headers['User-Agent'] = opts.userAgent

  let res
  try {
    res = await httpGet({ url, range: { start: 0, end: 0 }, headers, signal: opts.signal })
  } catch (err) {
    // Some servers reject Range on a resource; retry as a plain HEAD-like GET.
    if (err instanceof HttpError && (err.statusCode === 400 || err.statusCode === 405 || err.statusCode === 416)) {
      try {
        const plainHeaders = { ...headers }
        delete plainHeaders['Range']
        res = await httpGet({ url, headers: plainHeaders, signal: opts.signal })
        base.rangeIgnored = true
      } catch (err2) {
        return fail(base, err2)
      }
    } else {
      return fail(base, err)
    }
  }

  try {
    base.ok = true
    base.status = res.statusCode
    base.finalUrl = res.finalUrl
    base.contentType = (res.headers['content-type'] as string | undefined) ?? null
    base.etag = (res.headers['etag'] as string | undefined) ?? null
    base.lastModified = (res.headers['last-modified'] as string | undefined) ?? null

    const ar = res.headers['accept-ranges']
    base.acceptsRanges = typeof ar === 'string' ? ar.toLowerCase().includes('bytes') : false
    base.rangeIgnored = res.askedRange && res.statusCode === 200
    base.supportsResume = base.acceptsRanges && !base.rangeIgnored

    if (res.statusCode === 206 && res.contentRangeTotal != null) {
      base.totalBytes = res.contentRangeTotal
      base.contentLength = res.contentRangeTotal
    } else if (res.contentLength != null) {
      // 200 full length (or server ignored range → Content-Length is whole file)
      base.totalBytes = res.contentLength
      base.contentLength = res.contentLength
    }

    // Magic-byte sniffing: read the first few bytes we already have (the 1-byte
    // range only gives 1 byte, so do a slightly larger read when cheap).
    const sniff = await safeSniff(res, opts.signal)
    base.magicKind = sniff

    const disp = parseContentDisposition(res.headers['content-disposition'])
    const nameSource = disp ?? filenameFromUrl(res.finalUrl)
    base.filename = sanitizeFilename(nameSource) || 'download'

    base.categoryHint = categorize(base.filename, base.contentType, base.magicKind)
    return base
  } finally {
    res.destroy()
  }
}

async function safeSniff(
  res: Awaited<ReturnType<typeof httpGet>>,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    // We requested only 1 byte; open a fresh 0-15 range for magic bytes.
    const r2 = await httpGet({ url: res.finalUrl, range: { start: 0, end: 15 }, signal })
    const buf = await readPrefix(r2.stream, 16)
    r2.destroy()
    return sniffMagic(buf)
  } catch {
    return null
  }
}

/** Detect known container signatures from the first bytes. Never trust ext. */
export function sniffMagic(buf: Buffer): string | null {
  if (buf.length >= 12) {
    // MP4/MOV/M4V: bytes 4-8 == 'ftyp'
    if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'mp4'
  }
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return 'mkv' // EBML (Matroska/WebM)
  }
  if (buf.length >= 4 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
    return 'riff' // AVI/WAV container (RIFF....WEBM/AVI/WAVE)
  }
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) return 'zip' // ZIP/DOCX/XLSX (OOXML is zip)
  if (buf.length >= 4 && buf[0] === 0x37 && buf[1] === 0x7a && buf[2] === 0xbc && buf[3] === 0xaf) return '7z'
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return 'gzip'
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'pdf'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf.length >= 4 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'mp3'
  return null
}

export function extOfFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? ''
  const idx = base.lastIndexOf('.')
  if (idx <= 0 || idx === base.length - 1) return ''
  return base.slice(idx + 1).toLowerCase()
}

/**
 * Choose a category from filename extension, HTTP mime, and magic bytes —
 * in that priority order, but magic bytes can override a lying extension.
 */
export function categorize(filename: string, contentType: string | null, magic: string | null): string {
  const ext = extOfFilename(filename)
  const mime = (contentType ?? '').toLowerCase()

  if (magic === 'mp4' || magic === 'mkv' || magic === 'riff') return 'Videos'
  if (magic === 'pdf') return 'Documents'
  if (magic === 'zip' || magic === '7z' || magic === 'gzip') {
    // OOXML docs are zips; keep zip as Archives unless the ext says otherwise.
    if (DOC_EXT.has(ext)) return 'Documents'
    return 'Archives'
  }
  if (magic === 'jpeg' || magic === 'png') return 'Images'

  if (mime.startsWith('video/')) return 'Videos'
  if (mime.startsWith('audio/')) return 'Music'
  if (mime.startsWith('image/')) return 'Images'
  if (mime.startsWith('text/') || mime.includes('pdf') || mime.includes('word') || mime.includes('document'))
    return 'Documents'
  if (mime.includes('zip') || mime.includes('compressed') || mime.includes('x-7z') || mime.includes('tar'))
    return 'Archives'
  if (mime.includes('octet-stream') && SOFTWARE_EXT.has(ext)) return 'Software'

  if (VIDEO_EXT.has(ext)) return 'Videos'
  if (AUDIO_EXT.has(ext)) return 'Music'
  if (IMAGE_EXT.has(ext)) return 'Images'
  if (ARCHIVE_EXT.has(ext)) return 'Archives'
  if (SOFTWARE_EXT.has(ext)) return 'Software'
  if (DOC_EXT.has(ext)) return 'Documents'
  return 'Other'
}

export function filenameFromUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    const last = u.pathname.split('/').filter(Boolean).pop()
    if (!last) return hostnameToName(u.hostname)
    const decoded = decodeURIComponent(last)
    return sanitizeFilename(decoded) || hostnameToName(u.hostname)
  } catch {
    return 'download'
  }
}

function hostnameToName(host: string): string {
  return sanitizeFilename(host.replace(/\W+/g, '_')) || 'download'
}

/**
 * Parse Content-Disposition, honouring RFC 5987 `filename*=UTF-8''name`.
 * Returns the raw (unsanitized) name or null.
 */
export function parseContentDisposition(header: string | string[] | undefined): string | null {
  if (!header) return null
  const value = Array.isArray(header) ? header[0] : header
  if (!value) return null
  // Prefer extended filename* (RFC 5987/6266).
  const ext = /filename\*\s*=\s*([^;]+)/i.exec(value)
  if (ext?.[1]) {
    let raw = ext[1].trim().replace(/^["']|["']$/g, '')
    const parts = raw.split("'")
    if (parts.length >= 3) {
      // charset'lang'percent-encoded-name
      raw = parts.slice(2).join("'")
      try {
        return decodeURIComponent(raw)
      } catch {
        return raw
      }
    }
    return raw
  }
  const plain = /filename\s*=\s*([^;]+)/i.exec(value)
  if (plain?.[1]) {
    return plain[1].trim().replace(/^["']|["']$/g, '')
  }
  return null
}

function fail(base: ProbeResult, err: unknown): ProbeResult {
  if (err instanceof HttpError) {
    return { ...base, error: { code: err.code, message: err.message } }
  }
  return { ...base, error: { code: 'network', message: (err as Error)?.message ?? 'Unknown error' } }
}

/**
 * Given a desired filename and a set of already-taken names in a directory,
 * produce a unique name ("video (1).mp4"). Re-exported for the manager.
 */
export function suggestUniqueFilename(desired: string, taken: Set<string>): string {
  return uniqueName(desired, taken)
}
