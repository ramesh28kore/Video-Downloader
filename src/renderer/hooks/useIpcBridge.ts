import { useEffect } from 'react'
import { useDownloads } from '../stores/downloads'
import { useSettings } from '../stores/settings'

/**
 * Single place where preload events are mapped into Zustand stores.
 * Mounted once at the top of the app.
 */
export function useIpcBridge(): void {
  useEffect(() => {
    const d = useDownloads.getState()
    const off: Array<() => void> = []

    off.push(window.turbo.events.onCreated((rec) => useDownloads.getState().upsert(rec)))
    off.push(window.turbo.events.onUpdated((rec) => useDownloads.getState().upsert(rec)))
    off.push(window.turbo.events.onProgress((ticks) => useDownloads.getState().applyTicks(ticks)))
    off.push(window.turbo.events.onCompleted((rec) => useDownloads.getState().upsert(rec)))
    off.push(window.turbo.events.onFailed((rec) => useDownloads.getState().upsert(rec)))
    off.push(window.turbo.events.onQueue((q) => useDownloads.getState().setQueue(q)))
    off.push(window.turbo.events.onMediaDetected((media) => window.dispatchEvent(new CustomEvent('turbo:media-detected', { detail: media }))))
    off.push(window.turbo.events.onSettings((s) => useSettings.getState().setFromEvent(s)))
    void window.turbo.download.list().then((records) => d.init(records))
    void window.turbo.queue.stats().then((q) => useDownloads.getState().setQueue(q))

    return () => {
      for (const f of off) f()
    }
  }, [])
}
