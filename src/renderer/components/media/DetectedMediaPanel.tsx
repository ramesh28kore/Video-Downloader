import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { useDownloads } from '../../stores/downloads'
import { useSettings } from '../../stores/settings'
import type { DetectedMedia } from '@shared/types'

export default function DetectedMediaPanel(): React.JSX.Element | null {
  const upsert = useDownloads((s) => s.upsert)
  const autoDownload = useSettings((s) => s.settings?.autoDownloadDetectedVideos ?? false)
  const [media, setMedia] = useState<DetectedMedia | null>(null)
  const [quality, setQuality] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    const onDetected = (event: Event) => {
      const next = (event as CustomEvent<DetectedMedia>).detail
      setMedia(next)
      setQuality(next.qualities[0]?.url ?? next.url)
      setStatus(autoDownload && next.kind === 'direct' ? 'Automatic download is starting…' : null)
    }
    window.addEventListener('turbo:media-detected', onDetected)
    return () => window.removeEventListener('turbo:media-detected', onDetected)
  }, [autoDownload])

  if (!media) return null
  const downloadable = media.kind === 'direct' && !autoDownload
  const selected = media.qualities.find((item) => item.url === quality)
  const label = selected?.label ?? media.quality ?? 'Video'

  const download = async (): Promise<void> => {
    if (!downloadable) {
      setStatus('This manifest can be inspected, but segmented HLS/DASH downloading is not available yet.')
      return
    }
    setStatus('Starting download…')
    try {
      const result = await window.turbo.download.add({
        url: quality || media.url,
        filename: media.filename,
        headers: media.pageUrl ? { Referer: media.pageUrl } : null,
        saveIn: null,
        startNow: true
      })
      upsert(result.record)
      setStatus('Download started')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Download failed')
    }
  }

  return (
    <aside className="fixed bottom-4 right-4 z-30 w-[min(360px,calc(100vw-2rem))] panel border-accent shadow-xl" data-testid="detected-media-panel">
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">Video detected</div>
          <div className="truncate text-[12px] text-muted">{media.title || media.filename || label}</div>
          {media.qualities.length > 0 && (
            <label className="mt-2 block text-[11px] text-muted">
              Quality
              <select className="input mt-1 w-full" value={quality} onChange={(event) => setQuality(event.target.value)}>
                {media.qualities.map((item) => <option key={item.url} value={item.url}>{item.label}</option>)}
              </select>
            </label>
          )}
          {status && <div className="mt-2 text-[11px] text-muted">{status}</div>}
        </div>
        <button className="btn btn-ghost !p-1" aria-label="Dismiss detected video" onClick={() => setMedia(null)}><X size={15} /></button>
      </div>
      <div className="border-t border-border p-3">
        <button className="btn btn-primary w-full justify-center" disabled={!downloadable} onClick={() => void download()}>
          <Download size={14} /> {autoDownload && media.kind === 'direct' ? 'Automatic download enabled' : downloadable ? 'Download Video' : 'Manifest detected'}
        </button>
      </div>
    </aside>
  )
}
