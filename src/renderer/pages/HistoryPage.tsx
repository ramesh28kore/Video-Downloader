import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Trash2, RotateCcw } from 'lucide-react'
import type { CategoryRow, DownloadRecord, DownloadStatus, HistoryFilter } from '@shared/types'
import { useDownloads } from '../stores/downloads'
import { StatusBadge } from '../components/downloads/StatusBadge'
import { ProgressBar } from '../components/downloads/ProgressBar'
import { formatBytes, formatDateTime, hostnameOf } from '@shared/format'

type SortKey = NonNullable<HistoryFilter['sort']>

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'created_desc', label: 'Newest first' },
  { key: 'created_asc', label: 'Oldest first' },
  { key: 'name_asc', label: 'Name A–Z' },
  { key: 'name_desc', label: 'Name Z–A' },
  { key: 'size_desc', label: 'Largest first' }
]

const STATUSES: (DownloadStatus | 'all')[] = ['all', 'completed', 'failed', 'cancelled', 'paused', 'downloading', 'queued']

export default function HistoryPage(): React.JSX.Element {
  const [rows, setRows] = useState<DownloadRecord[]>([])
  const [text, setText] = useState('')
  const [status, setStatus] = useState<DownloadStatus | 'all'>('all')
  const [categoryId, setCategoryId] = useState<number | 'all'>('all')
  const [sort, setSort] = useState<SortKey>('created_desc')
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const records = useDownloads((s) => s.records)
  const remove = useDownloads((s) => s.remove)

  const query = useCallback(async () => {
    const filter: HistoryFilter = { text: text || undefined, status, categoryId, sort, limit: 500 }
    setRows(await window.turbo.history.query(filter))
  }, [text, status, categoryId, sort])

  useEffect(() => {
    void window.turbo.categories.list().then(setCategories)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void query(), 250)
    return () => clearTimeout(t)
  }, [query])

  // Live-refresh rows from store ticks while on this page.
  const merged = useMemo(
    () => rows.map((r) => records[r.id] ?? r),
    [rows, records]
  )

  const clear = useCallback(
    async (which: DownloadStatus[]) => {
      const label = which.join(', ')
      if (!window.confirm(`Remove these history entries (${label})? Files on disk are kept.`)) return
      const n = await window.turbo.history.clear(which)
      if (n > 0) {
        for (const r of merged) if (which.includes(r.status)) remove(r.id)
      }
      void query()
    },
    [merged, remove, query]
  )

  return (
    <div className="flex h-full flex-col" data-testid="page-history">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-[12px]">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="input !w-60 !py-1 pl-7"
            placeholder="Search name or URL…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            data-testid="history-search"
          />
        </div>
        <select className="input !w-auto !py-1" value={status} onChange={(e) => setStatus(e.target.value as DownloadStatus | 'all')}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All statuses' : s}
            </option>
          ))}
        </select>
        <select className="input !w-auto !py-1" value={categoryId} onChange={(e) => setCategoryId(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="input !w-auto !py-1" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <button className="btn !py-1" onClick={() => void query()} title="Refresh">
          <RotateCcw size={13} />
        </button>
        <div className="ml-auto flex gap-2">
          <button className="btn !py-1 text-[12px]" onClick={() => void clear(['completed'])} data-testid="btn-clear-completed">
            Clear completed
          </button>
          <button className="btn btn-danger !py-1 text-[12px]" onClick={() => void clear(['failed', 'cancelled'])} data-testid="btn-clear-failed">
            <Trash2 size={12} /> Clear failed
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {merged.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[13px] text-muted">No history matches your filters.</div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Size</th>
                <th className="px-2 py-2">Source</th>
                <th className="px-2 py-2">Date</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {merged.map((r) => (
                <tr
                  key={r.id}
                  className={`border-t border-border hover:bg-rowhover ${selectedId === r.id ? 'bg-selected' : ''}`}
                  onClick={() => setSelectedId(r.id)}
                  data-testid={`history-row-${r.id}`}
                >
                  <td className="max-w-72 truncate px-3 py-1.5 font-medium" title={r.filename}>
                    {r.filename}
                  </td>
                  <td className="px-2 py-1.5">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">
                    {r.totalBytes >= 0 ? formatBytes(r.totalBytes) : '—'}
                    {r.status === 'downloading' && (
                      <div className="mt-1 w-28">
                        <ProgressBar done={r.downloadedBytes} total={r.totalBytes} status={r.status} />
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-muted">{hostnameOf(r.url)}</td>
                  <td className="px-2 py-1.5 tabular-nums text-muted">{formatDateTime(r.completedAt ?? r.updatedAt)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      {r.status === 'failed' || r.status === 'cancelled' ? (
                        <button className="btn !py-0.5 !px-2 text-[11px]" onClick={() => void window.turbo.download.retry(r.id)}>
                          Retry
                        </button>
                      ) : null}
                      {r.status === 'completed' ? (
                        <>
                          <button className="btn !py-0.5 !px-2 text-[11px]" onClick={() => void window.turbo.download.openFile(r.id)}>
                            Open
                          </button>
                          <button className="btn !py-0.5 !px-2 text-[11px]" onClick={() => void window.turbo.download.showInFolder(r.id)}>
                            Folder
                          </button>
                        </>
                      ) : null}
                      <button
                        className="btn btn-ghost btn-danger !py-0.5 !px-2 text-[11px]"
                        onClick={() => {
                          if (window.confirm(`Remove "${r.filename}" from history?`)) {
                            void window.turbo.download.remove(r.id).then(() => remove(r.id))
                          }
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted">{merged.length} entries (max 500 shown)</div>
    </div>
  )
}
