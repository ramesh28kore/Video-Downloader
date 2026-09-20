import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { URL } from 'node:url'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type { DetectedMedia } from '@shared/types'

const MAX_BODY = 128 * 1024
const MEDIA_BRIDGE_PORT = 47831

export interface MediaBridge {
  port: number
  token: string
  close: () => Promise<void>
}

export type MediaDetectedHandler = (media: DetectedMedia) => void

let activeBridge: MediaBridge | null = null

export async function startMediaBridge(onDetected?: MediaDetectedHandler): Promise<MediaBridge> {
  const token = randomBytes(32).toString('hex')
  const seen = new Set<string>()

  const send = (media: DetectedMedia): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.EvMediaDetected, media)
    }
  }

  const server = createServer((req, res) => {
    void handle(req, res, token, seen, send, onDetected)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(MEDIA_BRIDGE_PORT, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('media bridge failed to bind')
  const bridge: MediaBridge = {
    port: address.port,
    token,
    close: async () => {
      activeBridge = null
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
  activeBridge = bridge
  return bridge
}

export function getMediaBridge(): MediaBridge | null {
  return activeBridge
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  seen: Set<string>,
  send: (media: DetectedMedia) => void,
  onDetected?: MediaDetectedHandler
): Promise<void> {
  const origin = req.headers.origin
  if (origin && origin !== 'null' && !origin.startsWith('chrome-extension://') && !origin.startsWith('moz-extension://')) {
    return respond(res, 403, { error: 'origin_not_allowed' })
  }

  const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
  const pathname = requestUrl.pathname
  if (req.method === 'OPTIONS' && pathname === '/media') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' })
    res.end()
    return
  }
  if (req.method !== 'POST' || pathname !== '/media') {
    return respond(res, 404, { error: 'not_found' })
  }

  const bearerToken = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  const queryToken = requestUrl.searchParams.get('token')
  if (bearerToken !== token && queryToken !== token) {
    return respond(res, 401, { error: 'unauthorized' })
  }

  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk)
    if (size > MAX_BODY) return respond(res, 413, { error: 'payload_too_large' })
    chunks.push(Buffer.from(chunk))
  }

  try {
    const media = JSON.parse(Buffer.concat(chunks).toString('utf8')) as DetectedMedia
    if (!validMedia(media)) return respond(res, 400, { error: 'invalid_media' })
    const key = createHash('sha256').update(media.url).digest('hex')
    if (!seen.has(key)) {
      seen.add(key)
      const detected = { ...media, id: key }
      send(detected)
      onDetected?.(detected)
    }
    respond(res, 204, null)
  } catch {
    respond(res, 400, { error: 'invalid_json' })
  }
}

function validMedia(media: DetectedMedia): boolean {
  if (!media || typeof media.url !== 'string' || media.url.length > 8192) return false
  try {
    const url = new URL(media.url)
    return (url.protocol === 'http:' || url.protocol === 'https:') && (media.kind === 'direct' || media.kind === 'hls' || media.kind === 'dash')
  } catch {
    return false
  }
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' })
  if (body == null) {
    res.end()
    return
  }
  res.end(JSON.stringify(body))
}

export function mediaBridgeSetupUrl(bridge: MediaBridge): string {
  return `http://127.0.0.1:${bridge.port}/media?token=${encodeURIComponent(bridge.token)}`
}
