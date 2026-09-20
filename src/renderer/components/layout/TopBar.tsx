import { Plus, Play, Pause, Gauge } from 'lucide-react'
import { useDownloads } from '../../stores/downloads'
import { formatSpeed } from '@shared/format'

export default function TopBar(): React.JSX.Element {
  const openAddDialog = useDownloads((s) => s.openAddDialog)
  const queue = useDownloads((s) => s.queue)

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-panel px-3">
      <div className="flex items-center gap-2 pr-2">
        <Gauge size={20} className="text-accent" />
        <span className="text-[15px] font-bold tracking-tight">TurboDownload</span>
      </div>
      <button className="btn btn-primary" onClick={() => openAddDialog(null)} data-testid="btn-add-url">
        <Plus size={15} /> Add URL
      </button>
      <div className="mx-1 h-6 w-px bg-border" />
      <button className="btn" onClick={() => void window.turbo.queue.startAll()} title="Start all (Resume Queue)">
        <Play size={15} /> Resume all
      </button>
      <button className="btn" onClick={() => void window.turbo.queue.pauseAll()} title="Pause all">
        <Pause size={15} /> Pause all
      </button>
      <div className="ml-auto flex items-center gap-4 text-[12px] text-muted">
        <span data-testid="topbar-active">
          Active <b className="text-text">{queue.active}</b>/{queue.maxConcurrent}
        </span>
        <span data-testid="topbar-queued">
          Queued <b className="text-text">{queue.queued}</b>
        </span>
        <span className="w-28 text-right tabular-nums" data-testid="topbar-speed">
          {formatSpeed(queue.speedBps)}
        </span>
      </div>
    </header>
  )
}
