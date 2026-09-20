/**
 * Local test server for the download-engine integration tests (spec §72).
 *
 * Serves deterministic, synthetic payloads with full HTTP Range support plus
 * every hostile behaviour the engine must survive: servers that ignore Range,
 * 416 responses, throttled ("slow") links, connections dropped mid-stream,
 * redirect chains, 4xx/5xx failures and MIME / Content-Disposition variety.
 *
 * Run standalone:   npm run test:server   (listens on :8787 by default)
 * Used by tests:    startTestServer() from tests/integration/globalSetup.ts
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'

/**
 * Byte at absolute offset `n` of a payload. Cheap, O(1), identical for every
 * process — so a client can recompute SHA-256 without materialising the body.
 */
export function patternByte(n: number): number {
  return (n * 31 + (n >>> 5) + 7) & 0xff
}

/** SHA-256 hex of the first `size` bytes of the pattern for `seed`. */
export function patternSha256(size: number): string {
  const hash = createHash('sha256')
  const CHUNK = 1 << 20
  const buf = Buffer.allocUnsafe(CHUNK)
  let written = 0
  while (written < size) {
    const take = Math.min(CHUNK, size - written)
    for (let i = 0; i < take; i++) buf[i] = patternByte(written + i)
    hash.update(buf.subarray(0, take))
    written += take
  }
  return hash.digest('hex')
}

function fillRange(buf: Buffer, start: number, end: number): void {
  for (let n = start; n <= end; n++) buf[n - start] = patternByte(n)
}

export interface TestServerOptions {
  /** Fixed port for standalone runs; tests use 0 (ephemeral). */
  port?: number
}

export interface TestServerHandle {
  server: Server
  port: number
  url: (path: string) => string
  close: () => Promise<void>
  /** Invalidation switch for recovery tests: makes /file/<name> validators change. */
  mutateFile: (name: string) => void
  /** Reset the drop-counter so `drop` routes fail exactly once more. */
  resetDrops: () => void
}

const KB = 1024
const MB = 1024 * KB

/** Named fixtures: path segment -> size in bytes. */
const SIZES: Record<string, number> = {
  '10kb': 10 * KB,
  '1mb': 1 * MB,
  '5mb': 5 * MB,
  '10mb': 10 * MB,
  '50mb': 50 * MB
}

const MIME: Record<string, string> = {
  bin: 'application/octet-stream',
  txt: 'text/plain',
  html: 'text/html',
  json: 'application/json',
  zip: 'application/zip',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  jpg: 'image/jpeg',
  png: 'image/png',
  exe: 'application/x-msdownload'
}

const SEC = 1000

export function startTestServer(opts: TestServerOptions = {}): Promise<TestServerHandle> {
  // Per-request failure injections, keyed by route counters (reset between tests
  // by restarting the server or via resetDrops()).
  const dropCounters = new Map<string, number>()
  // Files whose ETag/Last-Modified have been "changed" (restarted upstream).
  const mutated = new Set<string>()

  const server = createServer((req, res) => {
    try {
      route(req, res)
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
      }
      res.end('test-server error: ' + String((err as Error).message))
    }
  })

  function route(req: IncomingMessage, res: ServerResponse): void {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1')
    const parts = u.pathname.split('/').filter(Boolean)
    const kind = parts[0] ?? ''

    switch (kind) {
      case 'health':
        return json(res, 200, { ok: true })
      case 'admin':
        return serveAdmin(res, parts.slice(1))
      case 'file':
        return serveFile(req, res, parts[1] ?? '1mb.bin', false)
      case 'noranges':
        return serveFile(req, res, parts[1] ?? '1mb.bin', true)
      case 'ignore-range':
        return serveFileIgnoreRange(req, res, parts[1] ?? '1mb.bin')
      case 'slow':
        return serveSlow(req, res, parts[1] ?? '1mb.bin')
      case 'drop':
        return serveDrop(req, res, u, parts[1] ?? '10mb.bin')
      case 'redirect':
        return serveRedirect(req, res, parts.slice(1))
      case 'redirect-loop':
        return serveRedirectLoop(req, res)
      case 'fail':
        return serveFail(req, res, parts[1] ?? '404')
      case 'meta':
        return serveMeta(req, res, parts[1] ?? 'report.pdf')
      default:
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('not found')
    }
  }

  /** Admin hooks for tests running in separate Vitest workers. */
  function serveAdmin(res: ServerResponse, parts: string[]): void {
    const action = parts[0] ?? ''
    if (action === 'reset-drops') {
      dropCounters.clear()
      return json(res, 200, { ok: true })
    }
    if (action === 'mutate') {
      const name = parts[1]
      if (!name) return json(res, 400, { ok: false, error: 'missing name' })
      mutated.add(name)
      return json(res, 200, { ok: true })
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('unknown admin action')
  }

  /** Common headers for a virtual file. */
  function fileMeta(name: string): { etag: string; lastMod: string; mime: string } {
    const ext = (name.split('.').pop() ?? 'bin').toLowerCase()
    const seed = mutated.has(name) ? 'v2' : 'v1'
    return {
      etag: `"${createHash('sha1').update(name + seed).digest('hex').slice(0, 16)}"`,
      lastMod: new Date(mutated.has(name) ? Date.now() - SEC : 1700000000000).toUTCString(),
      mime: MIME[ext] ?? 'application/octet-stream'
    }
  }

  function parseSize(name: string): number {
    const key = name.replace(/\.[^.]+$/, '')
    const size = SIZES[key]
    if (size == null) throw new Error(`unknown fixture '${name}' (have: ${Object.keys(SIZES).join(', ')})`)
    return size
  }

  /** Full Range support: 206 slices, 416 past EOF, 200 when no Range header. */
  function serveFile(req: IncomingMessage, res: ServerResponse, name: string, advertiseNoRanges: boolean): void {
    const size = parseSize(name)
    const { etag, lastMod, mime } = fileMeta(name)
    const base: Record<string, string> = {
      'Content-Type': mime,
      ETag: etag,
      'Last-Modified': lastMod,
      'Accept-Ranges': advertiseNoRanges ? 'none' : 'bytes'
    }
    const rangeRaw = req.headers.range
    if (advertiseNoRanges || !rangeRaw) {
      base['Content-Length'] = String(size)
      res.writeHead(200, base)
      streamBytes(res, 0, size - 1, req)
      return
    }
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(rangeRaw))
    if (!m) {
      res.writeHead(400, { ...base, 'Content-Range': `bytes */${size}` })
      res.end()
      return
    }
    const start = m[1] ? parseInt(m[1], 10) : 0
    const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
    if (start >= size || start > end) {
      res.writeHead(416, { ...base, 'Content-Range': `bytes */${size}` })
      res.end()
      return
    }
    res.writeHead(206, {
      ...base,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1)
    })
    streamBytes(res, start, end, req)
  }

  /** Advertises Accept-Ranges but answers every Range request with a full 200. */
  function serveFileIgnoreRange(req: IncomingMessage, res: ServerResponse, name: string): void {
    void req
    const size = parseSize(name)
    const { etag, lastMod, mime } = fileMeta(name)
    res.writeHead(200, {
      'Content-Type': mime,
      ETag: etag,
      'Last-Modified': lastMod,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(size)
    })
    streamBytes(res, 0, size - 1, req)
  }

  /** Throttled to `bps` bytes/sec (default 40 KB/s) — for speed-limit tests. Honours Range. */
  function serveSlow(req: IncomingMessage, res: ServerResponse, name: string): void {
    const size = parseSize(name)
    const u = new URL(req.url ?? '/', 'http://x')
    const bps = Math.max(1024, Number(u.searchParams.get('bps') ?? 40 * KB))
    const { etag, lastMod, mime } = fileMeta(name)
    const rangeRaw = req.headers.range
    const m = rangeRaw ? /^bytes=(\d*)-(\d*)$/.exec(String(rangeRaw)) : null
    const start = m?.[1] ? parseInt(m[1], 10) : 0
    const end = m?.[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
    res.writeHead(m ? 206 : 200, {
      'Content-Type': mime,
      ETag: etag,
      'Last-Modified': lastMod,
      'Accept-Ranges': 'bytes',
      ...(m ? { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } : { 'Content-Length': String(size) })
    })
    let pos = start
    const chunk = Math.max(1024, Math.floor(bps / 10))
    const timer = setInterval(() => {
      if (res.destroyed || req.destroyed) return clearInterval(timer)
      if (pos > end) {
        clearInterval(timer)
        res.end()
        return
      }
      const buf = Buffer.allocUnsafe(Math.min(chunk, end - pos + 1))
      fillRange(buf, pos, pos + buf.length - 1)
      pos += buf.length
      res.write(buf)
    }, 100)
    ;(timer as { unref?: () => void }).unref?.()
    req.on('close', () => clearInterval(timer))
  }

  /**
   * Sends `keep` bytes of a segment then hard-kills the socket. The first
   * `times` requests (default 1) drop; later requests succeed fully, so the
   * engine's retry loop should recover byte-exactly.
   */
  function serveDrop(req: IncomingMessage, res: ServerResponse, u: URL, name: string): void {
    const size = parseSize(name)
    const times = Number(u.searchParams.get('times') ?? 1)
    const keep = Number(u.searchParams.get('keep') ?? 100 * KB)
    const key = name
    const seen = dropCounters.get(key) ?? 0
    const { etag, lastMod, mime } = fileMeta(name)
    const rangeRaw = req.headers.range
    const m = rangeRaw ? /^bytes=(\d*)-(\d*)$/.exec(String(rangeRaw)) : null
    const start = m?.[1] ? parseInt(m[1], 10) : 0
    const end = m?.[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
    res.writeHead(m ? 206 : 200, {
      'Content-Type': mime,
      ETag: etag,
      'Last-Modified': lastMod,
      'Accept-Ranges': 'bytes',
      ...(m ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : { 'Content-Length': String(size) })
    })
    // The metadata probe asks for bytes=0-0. Do not consume a hostile drop
    // there; the failure should exercise a real download segment.
    if (seen < times && end - start > 1) {
      dropCounters.set(key, seen + 1)
      const cut = Math.min(keep, Math.max(1, end - start))
      const buf = Buffer.allocUnsafe(cut)
      fillRange(buf, start, start + cut - 1)
      res.write(buf)
      setTimeout(() => res.socket?.destroy(), 50) // abrupt FIN/RST
      return
    }
    streamBytes(res, start, end, req)
  }

  /** /redirect/<n>/file/... — n hops (302) then the real target. */
  function serveRedirect(req: IncomingMessage, res: ServerResponse, rest: string[]): void {
    void req
    const hops = Number(rest[0] ?? 3)
    if (hops > 0) {
      res.writeHead(302, { Location: `/redirect/${hops - 1}/${rest.slice(1).join('/')}` })
      res.end()
      return
    }
    const target = rest.slice(1).join('/') // e.g. "file/5mb.bin"
    const seg = target.split('/')
    if (seg[0] === 'file') return serveFile(req, res, seg[1] ?? '1mb.bin', false)
    if (seg[0] === 'meta') return serveMeta(req, res, seg[1] ?? 'report.pdf')
    res.writeHead(404)
    res.end()
  }

  /** Infinite 302 loop — must hit the redirect cap, not hang. */
  function serveRedirectLoop(req: IncomingMessage, res: ServerResponse): void {
    void req
    res.writeHead(302, { Location: '/redirect-loop' })
    res.end()
  }

  /** /fail/404, /fail/403, /fail/401, /fail/429 (with Retry-After), /fail/500 … */
  function serveFail(req: IncomingMessage, res: ServerResponse, codeStr: string): void {
    void req
    const code = Number(codeStr) || 500
    const headers: Record<string, string> = { 'Content-Type': 'text/plain' }
    if (code === 429) headers['Retry-After'] = '1'
    if (code === 503) headers['Retry-After'] = String(60 * 60 * 24 * 30) // absurd: must be capped
    res.writeHead(code, headers)
    res.end(`simulated ${code}`)
  }

  /** /meta/<name> — zero-byte body with rich headers (probe tests). */
  function serveMeta(req: IncomingMessage, res: ServerResponse, name: string): void {
    void req
    const cd = new URL(req.url ?? '/', 'http://x').searchParams.get('cd')
    const headers: Record<string, string> = {
      'Content-Type': MIME[(name.split('.').pop() ?? 'bin').toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': '0',
      'Accept-Ranges': 'bytes'
    }
    if (cd) headers['Content-Disposition'] = cd
    res.writeHead(200, headers)
    res.end()
  }

  /** Stream pattern bytes [start..end], honouring client aborts. */
  function streamBytes(res: ServerResponse, start: number, end: number, req: IncomingMessage): void {
    let pos = start
    const CHUNK = 64 * KB
    const push = (): void => {
      if (res.destroyed || req.destroyed) return
      while (pos <= end) {
        const take = Math.min(CHUNK, end - pos + 1)
        const buf = Buffer.allocUnsafe(take)
        fillRange(buf, pos, pos + take - 1)
        pos += take
        if (!res.write(buf)) {
          res.once('drain', push)
          return
        }
      }
      res.end()
    }
    push()
  }

  function json(res: ServerResponse, code: number, body: unknown): void {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      resolve({
        server,
        port,
        url: (p: string) => `http://127.0.0.1:${port}${p}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.()
            server.close(() => done())
          }),
        mutateFile: (name: string) => void mutated.add(name),
        resetDrops: () => dropCounters.clear()
      })
    })
  })
}

// ---------------------------------------------------------------- standalone

if (process.argv[1] && process.argv[1].includes('test-server')) {
  const port = Number(process.env.PORT ?? 8787)
  startTestServer({ port }).then((h) => {
    /* eslint-disable no-console */
    console.log(`TurboDownload test server on http://127.0.0.1:${h.port}`)
    console.log('routes: /file/<size> /noranges /ignore-range /slow /drop /redirect/<n>/… /redirect-loop /fail/<code> /meta/<name>')
    console.log('sizes : ' + Object.keys(SIZES).join(', '))
  })
}
