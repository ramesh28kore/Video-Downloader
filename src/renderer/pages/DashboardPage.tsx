import { useMemo, useState } from 'react'
import { DownloadList } from '../components/downloads/DownloadList'
import { SpeedGraph } from '../components/downloads/SpeedGraph'
import { useDownloads } from '../stores/downloads'
import { cn } from '../lib/cn'
import type { DownloadStatus } from '@shared/types'

type Filter = 'all' | 'active' | 'paused' | 'done' | 'failed'

const FILTERS: { key: Filter; label: string; match: (s: DownloadStatus) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  {
    key: 'active',
    label: 'Active',
    match: (s) => s === 'downloading' || s === 'connecting' || s === 'retrying' || s === 'queued' || s === 'waiting'
  },
  { key: 'paused', label: 'Paused', match: (s) => s === 'paused' || s === 'cancelled' },
  { key: 'done', label: 'Completed', match: (s) => s === 'completed' },
  { key: 'failed', label: 'Failed', match: (s) => s === 'failed' }
]

export default function DashboardPage(): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('all')
  const order = useDownloads((s) => s.order)
  const records = useDownloads((s) => s.records)
  const queue = useDownloads((s) => s.queue)
  const ids = useMemo(() => order.filter((id) => records[id]?.status !== 'completed'), [order, records])

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)
    if (!f || f.key === 'all') return ids
    return ids.filter((id) => f.match(records[id]?.status ?? 'idle'))
  }, [filter, ids, records])

  return (
    <div className="flex h-full flex-col" data-testid="page-dashboard">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={cn('btn !py-1 text-[12px]', filter === f.key && 'btn-primary')}
              onClick={() => setFilter(f.key)}
              data-testid={`filter-${f.key}`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-2 text-[12px] text-muted">
            {visible.length} of {ids.length} shown
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right text-[11px] leading-4 text-muted">
            <div>
              {queue.active} / {queue.maxConcurrent} active
            </div>
            <div>{queue.queued} queued</div>
          </div>
          <SpeedGraph />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <DownloadList ids={visible} />
      </div>
    </div>
  )
}
