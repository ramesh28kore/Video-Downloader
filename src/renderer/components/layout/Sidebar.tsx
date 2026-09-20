import { Gauge, ListVideo, History, Settings2 } from 'lucide-react'
import { useDownloads, type Page } from '../../stores/downloads'
import { cn } from '../../lib/cn'

const items: Array<{ page: Page; label: string; icon: typeof Gauge }> = [
  { page: 'dashboard', label: 'Dashboard', icon: Gauge },
  { page: 'queue', label: 'Queue', icon: ListVideo },
  { page: 'history', label: 'History', icon: History },
  { page: 'settings', label: 'Settings', icon: Settings2 }
]

export default function Sidebar(): React.JSX.Element {
  const page = useDownloads((s) => s.page)
  const setPage = useDownloads((s) => s.setPage)
  const queue = useDownloads((s) => s.queue)

  return (
    <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-border bg-panel p-2" aria-label="Primary">
      {items.map(({ page: p, label, icon: Icon }) => (
        <button
          key={p}
          onClick={() => setPage(p)}
          className={cn(
            'flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] font-medium transition-colors',
            page === p ? 'bg-accent text-white' : 'text-muted hover:bg-panel2 hover:text-text'
          )}
        >
          <Icon size={16} />
          <span className="flex-1">{label}</span>
          {p === 'queue' && queue.queued > 0 && (
            <span className="rounded-full bg-warn/20 px-1.5 text-[11px] text-warn">{queue.queued}</span>
          )}
        </button>
      ))}
      <div className="mt-auto rounded-md bg-panel2 p-2.5 text-[11px] leading-4 text-muted">
        <div className="font-semibold text-text">TurboDownload</div>
        <div>Segmented IDM-style engine</div>
      </div>
    </nav>
  )
}
