import { clipboard } from 'electron'
import { IPC } from '@shared/ipc'
import { getServices } from './services'
import { getWindow } from './window'
import { createLogger } from './util/logger'
import type { ClipboardUrlInfo } from '@shared/types'

const log = createLogger('clipboard')

let timer: ReturnType<typeof setInterval> | null = null
let lastSeen = ''
let ignored = ''
let polling = false

function extractHttpUrl(s: string): string | null {
  if (!s || s.length > 16384) return null
  const candidate = /https?:\/\/[^\s<>"']+/i.exec(s)?.[0]?.replace(/[),.;]+$/, '')
  if (!candidate) return null
  try {
    const u = new URL(candidate)
    return u.protocol === 'http:' || u.protocol === 'https:' ? candidate : null
  } catch {
    return null
  }
}

function isVideoUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return /\.(mp4|webm|mkv|mov|m4v|avi|m3u8|mpd)(?:$|[?#])/i.test(u.pathname + u.search) ||
      /(?:video|videoplayback|manifest|stream|playlist|hls|dash)/i.test(u.hostname + u.pathname + u.search)
  } catch {
    return false
  }
}

export function startClipboardWatch(): void {
  if (timer) return
  timer = setInterval(() => {
    if (!getServices().settings().monitorClipboard) return
    void poll()
  }, 1500)
  timer.unref?.()
}

async function poll(): Promise<void> {
  if (polling) return
  polling = true
  try {
    let text = ''
    try {
      text = await clipboard.readText()
    } catch {
      return
    }
    const url = extractHttpUrl(text)
    if (!url || url === lastSeen || url === ignored) return
    lastSeen = url
    const info: ClipboardUrlInfo = {
      url,
      filename: null,
      detected: true,
      kind: isVideoUrl(url) ? 'video' : 'link'
    }
    getWindow()?.webContents.send(IPC.EvClipboardUrl, info)
    log.info('clipboard URL detected')
  } finally {
    polling = false
  }
}

export function stopClipboardWatch(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/** Called when the user presses "Ignore" on the detection toast. */
export function ignoreClipboardUrl(): void {
  ignored = lastSeen
}
