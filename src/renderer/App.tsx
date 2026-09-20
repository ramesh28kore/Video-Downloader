import { useCallback, useEffect, useState } from 'react'
import { Download, Play, X } from 'lucide-react'
import Sidebar from './components/layout/Sidebar'
import TopBar from './components/layout/TopBar'
import DashboardPage from './pages/DashboardPage'
import QueuePage from './pages/QueuePage'
import HistoryPage from './pages/HistoryPage'
import SettingsPage from './pages/SettingsPage'
import DetailsPanel from './components/downloads/DetailsPanel'
import AddDownloadDialog from './components/dialogs/AddDownloadDialog'
import { useIpcBridge } from './hooks/useIpcBridge'
import { useDownloads } from './stores/downloads'
import { useSettings } from './stores/settings'
import type { ClipboardUrlInfo } from '@shared/types'
import DetectedMediaPanel from './components/media/DetectedMediaPanel'

export default function App(): React.JSX.Element {
  useIpcBridge()
  const page = useDownloads((s) => s.page)
  const detailsOpen = useDownloads((s) => s.detailsOpen)
  const selectedId = useDownloads((s) => s.selectedId)
  const addDialogOpen = useDownloads((s) => s.addDialogOpen)
  const openAddDialog = useDownloads((s) => s.openAddDialog)
  const loadSettings = useSettings((s) => s.load)
  const [clip, setClip] = useState<ClipboardUrlInfo | null>(null)

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  // Clipboard detection toast (spec: "Download detected [Download][Ignore]").
  useEffect(() => {
    return window.turbo.events.onClipboardUrl((info) => setClip(info))
  }, [])

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      const st = useDownloads.getState()

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        st.openAddDialog(null)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !typing) {
        e.preventDefault()
        void navigator.clipboard.readText().then((text) => st.openAddDialog(text)).catch(() => st.openAddDialog(null))
        return
      }
      if (typing) return
      if (e.key === ' ' && st.selectedId) {
        e.preventDefault()
        const rec = st.records[st.selectedId]
        if (!rec) return
        if (rec.status === 'downloading' || rec.status === 'queued' || rec.status === 'connecting' || rec.status === 'retrying') {
          void window.turbo.download.pause(rec.id)
        } else if (rec.status === 'paused' || rec.status === 'waiting') {
          void window.turbo.download.resume(rec.id)
        }
        return
      }
      if (e.key === 'Delete' && st.selectedId) {
        e.preventDefault()
        const id = st.selectedId
        const confirm = useSettings.getState().settings?.confirmOnDelete ?? true
        if (!confirm || window.confirm('Remove this download and its partial file?')) {
          void window.turbo.download.remove(id).then(() => st.remove(id))
        }
        return
      }
      if (e.key === 'Enter' && st.selectedId) {
        e.preventDefault()
        void window.turbo.download.openFile(st.selectedId)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r' && st.selectedId) {
        e.preventDefault()
        void window.turbo.download.retry(st.selectedId)
      }
    },
    []
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  return (
    <div className="flex h-full flex-col bg-bg text-text" data-testid="app-shell">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-hidden">
          {page === 'dashboard' && <DashboardPage />}
          {page === 'queue' && <QueuePage />}
          {page === 'history' && <HistoryPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
        {detailsOpen && selectedId && <DetailsPanel id={selectedId} />}
      </div>

      {clip && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-border bg-panel px-4 py-3 shadow-xl">
          <Download size={18} className="text-accent" />
          <div className="max-w-80">
            <div className="text-[13px] font-semibold">{clip.kind === 'video' ? 'Video detected' : 'Download detected'}</div>
            <div className="truncate text-[12px] text-muted">{clip.url}</div>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => {
              openAddDialog(clip.url)
              setClip(null)
            }}
          >
            <Play size={14} /> Download
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setClip(null)
              void window.turbo.clipboard.ignore()
            }}
          >
            <X size={14} /> Ignore
          </button>
        </div>
      )}

      {addDialogOpen && <AddDownloadDialog />}
      <DetectedMediaPanel />
    </div>
  )
}
