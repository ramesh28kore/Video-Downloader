import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'
import { Readable } from 'node:stream'
import type { IncomingHttpHeaders } from 'node:http'

/**
 * A deliberately low-level HTTP(S) GET client built on node:https so that we
 * keep *explicit* control over:
 *   - Range headers (the download engine must know exactly what was requested)
 *   - Redirect tracking (record original + final URL, loop-detect, cap hops)
 *   - The 200-vs-206 distinction (a server that ignores Range and streams the
 *     whole body must be detected so a segment is restarted at 0, never appended)
 *
 * A single keep-alive agent is shared for connection reuse across segments.
 */

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, timeout: 0 })
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64, timeout: 0 })

export interface HttpGetRequest {
  url: string
  /** Byte range to request: [start, endInclusive]. Omit for a full GET. */
  range?: { start: number; end?: number }
  headers?: Record<string, string>
  signal?: AbortSignal
  /** Redirects already followed by the caller (for loop detection). */
  visited?: string[]
  maxRedirects?: number
}

export interface HttpGetResponse {
  statusCode: number
  headers: IncomingHttpHeaders
  /** The URL that ultimately produced this response (after redirects). */
  finalUrl: string
  /** The URL we originally requested. */
  requestedUrl: string
  /** True when we asked for a byte range and the server honoured it with 206.
   * When we asked for a range but got 200, the body is the FULL resource. */
  rangeHonoured: boolean
  /** True when the caller requested a Range header at all. */
  askedRange: boolean
  /** Parsed Content-Range total, when present. */
  contentRangeTotal: number | null
  contentLength: number | null
  stream: NodeJS.ReadableStream
  destroy(): void
}

export class HttpError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode?: number
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36 TurboDownload/1.0'

export function setDefaultUserAgent(_ua: string): void {
  // Reserved hook: engine reads settings.userAgent per-request instead.
}

export function httpGet(req: HttpGetRequest): Promise<HttpGetResponse> {
  return performGet(req, req.visited ?? [])
}

function normalizeUrl(raw: string): URL {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new HttpError('invalid_url', `Not a valid URL: ${raw}`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new HttpError('unsupported_scheme', `Unsupported protocol: ${u.protocol}`)
  }
  return u
}

function performGet(req: HttpGetRequest, visited: string[]): Promise<HttpGetResponse> {
  const url = normalizeUrl(req.url)
  const href = url.href

  if (visited.includes(href)) {
    return Promise.reject(new HttpError('ERR_TOO_MANY_REDIRECTS', 'Redirect loop detected.'))
  }
  const maxRedirects = req.maxRedirects ?? 10
  if (visited.length > maxRedirects) {
    return Promise.reject(
      new HttpError('ERR_TOO_MANY_REDIRECTS', `Exceeded ${maxRedirects} redirects.`)
    )
  }

  const isHttps = url.protocol === 'https:'
  const mod = isHttps ? https : http

  const headers: Record<string, string> = {
    'User-Agent': req.headers?.['User-Agent'] ?? req.headers?.['user-agent'] ?? DEFAULT_UA,
    Accept: '*/*',
    'Accept-Encoding': 'identity', // never gzip — byte ranges must be literal
    Connection: 'keep-alive',
    ...req.headers
  }
  delete headers['user-agent']
  headers['User-Agent'] = req.headers?.['User-Agent'] ?? DEFAULT_UA

  const askedRange = !!req.range
  if (req.range) {
    const end = req.range.end != null ? String(req.range.end) : ''
    headers['Range'] = `bytes=${req.range.start}-${end}`
  }

  return new Promise<HttpGetResponse>((resolve, reject) => {
    const options: https.RequestOptions = {
      method: 'GET',
      hostname: url.hostname,
      port: url.port ? Number(url.port) : isHttps ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      headers,
      agent: isHttps ? httpsAgent : httpAgent,
      timeout: 0 // handled by caller via signal + engine-level timers
    }

    const request = mod.request(options, (res) => {
      const status = res.statusCode ?? 0

      // --- Redirect handling (301/302/303/307/308) ---
      if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
        const loc = res.headers.location
        res.resume() // drain to free the socket
        if (!loc) {
          reject(new HttpError('too_many_redirects', `Redirect (${status}) with no Location.`))
          return
        }
        let nextUrl: string
        try {
          nextUrl = new URL(loc, url).href
        } catch {
          reject(new HttpError('invalid_url', `Invalid redirect Location: ${loc}`))
          return
        }
        // 303 must switch to GET without a range; 307/308 preserve method+range.
        const stripRange = status === 303
        performGet(
          {
            ...req,
            url: nextUrl,
            range: stripRange ? undefined : req.range,
            visited: [...visited, href]
          },
          [...visited, href]
        ).then(resolve, reject)
        return
      }

      if (status >= 400) {
        res.resume()
        reject(new HttpError(String(status), `HTTP ${status}`, status))
        return
      }

      const contentRangeTotal = parseContentRangeTotal(res.headers['content-range'])
      const contentLength = parseLength(res.headers['content-length'])
      const rangeHonoured = status === 206

      // We asked for a range but the server answered 200 with the whole body.
      // The caller MUST treat this as "restart at 0" — flag via rangeHonoured.
      let destroyed = false
      const destroy = (): void => {
        if (destroyed) return
        destroyed = true
        res.destroy()
        request.destroy()
      }

      if (req.signal) {
        if (req.signal.aborted) {
          destroy()
          reject(new HttpError('aborted', 'Request aborted before response.'))
          return
        }
        req.signal.addEventListener('abort', destroy, { once: true })
      }

      resolve({
        statusCode: status,
        headers: res.headers,
        finalUrl: href,
        requestedUrl: req.url,
        rangeHonoured,
        askedRange,
        contentRangeTotal,
        contentLength,
        stream: res,
        destroy
      })
    })

    request.on('error', (err: NodeJS.ErrnoException) => {
      reject(new HttpError(err.code ?? 'network', err.message))
    })
    request.on('timeout', () => {
      request.destroy(new HttpError('ETIMEDOUT', 'Connection timed out.'))
    })
    if (req.signal) {
      if (req.signal.aborted) {
        request.destroy()
        reject(new HttpError('aborted', 'Request aborted.'))
        return
      }
      req.signal.addEventListener('abort', () => request.destroy(), { once: true })
    }
    request.end()
  })
}

export function parseContentRangeTotal(header: string | string[] | undefined): number | null {
  if (!header) return null
  const value = Array.isArray(header) ? header[0] : header
  const m = /\/(\d+)\s*$/.exec(value ?? '')
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export function parseLength(header: string | string[] | undefined): number | null {
  if (!header) return null
  const value = Array.isArray(header) ? header[0] : header
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Read a bounded number of bytes from a stream (used by the metadata probe to
 * grab magic bytes without downloading the whole file).
 */
export async function readPrefix(stream: NodeJS.ReadableStream, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  const reader = Readable.from(stream as Readable)
  for await (const chunk of reader) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer)
    chunks.push(buf)
    size += buf.length
    if (size >= maxBytes) break
  }
  reader.destroy()
  return Buffer.concat(chunks).subarray(0, maxBytes)
}
