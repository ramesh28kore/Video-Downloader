import { createLogger } from '../util/logger'
import { getMediaBridge, startMediaBridge, type MediaBridge } from './MediaBridge'
import { getServices } from '../services'

const log = createLogger('media-bridge')
let bridge: MediaBridge | null = null

export async function syncMediaBridge(enabled: boolean): Promise<void> {
  if (enabled) {
    bridge = bridge ?? getMediaBridge()
    if (bridge) return
    bridge = await startMediaBridge((media) => {
      // The extension only reports a source that belongs to an actively playing
      // HTML5 video. Manifests are deliberately excluded: this app downloads
      // single, direct media files and does not reconstruct segmented streams.
      if (media.kind !== 'direct' || !getServices().settings().autoDownloadDetectedVideos) return
      void getServices().manager.addDownload({
        url: media.url,
        filename: media.filename,
        headers: media.pageUrl ? { Referer: media.pageUrl } : null,
        startNow: true
      }).catch((error: unknown) => {
        log.warn(`automatic video download was not started: ${error instanceof Error ? error.message : String(error)}`)
      })
    })
    log.info(`media bridge started on 127.0.0.1:${bridge.port}`)
    return
  }
  const current = bridge ?? getMediaBridge()
  if (!current) return
  await current.close()
  bridge = null
  log.info('media bridge stopped')
}

export async function closeMediaBridge(): Promise<void> {
  await syncMediaBridge(false)
}
