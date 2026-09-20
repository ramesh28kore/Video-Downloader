import { useCallback, useMemo } from 'react'
import { ArrowUp, ArrowDown, Play, Pause, OctagonX, Settings2 } from 'lucide-react'
import { useDownloads } from '../stores/downloads'
import { useSettings } from '../stores/settings'
import { StatusBadge } from '../components/downloads/StatusBadge'
import { formatBytes, formatSpeed, hostnameOf } from '@shared/format'

export default function QueuePage(): React.JSX.Element {
  const records = useDownloads((s) => s.records)
  const order = useDownloads((s) => s.order)
  const queue = useDownloads((s) => s.queue)
  const settings = useSettings((s) => s.settings)
  const updateSettings = useSettings((s) => s.update)

  const { queued, active } = useMemo(() => {
    const all = order.map((id) => records[id]).filter((r): r is NonNullable<typeof r> => !!r)
    const q = all
      .filter((r) => r.status === 'queued' || r.status === 'waiting')
      .sort((a, b) => a.queuePos - b.queuePos || a.createdAt - b.createdAt)
    const a = all.filter((r) => r.status === 'downloading' || r.status === 'connecting' || r.status === 'retrying')
    return { queued: q, active: a }
  }, [order, records])

  const move = useCallback(
    (index: number, dir: -1 | 1) => {
      const ids = queued.map((r) => r.id)
      const target = index + dir
      if (target < 0 || target >= ids.length) return
      const next = [...ids]
      const a = next[index]
      const b = next[target]
      if (a === undefined || b === undefined) return
      next[index] = b
      next[target] = a
      void window.turbo.queue.reorder(next)
    },
    [queued]
  )

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4" data-testid="page-queue">
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Active now" value={`${queue.active} / ${queue.maxConcurrent}`} />
        <Stat label="Waiting in queue" value={String(queue.queued)} />
        <Stat label="Global speed" value={formatSpeed(queue.speedBps)} />
        <div className="panel flex flex-col justify-center gap-1 p-3">
          <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            <Settings2 size={12} /> Max simultaneous
          </label>
          <input
            type="number"
            min={1}
            max={16}
            className="input !py-1 !text-[13px]"
            value={settings?.maxConcurrent ?? 3}
            onChange={(e) => {
              const v = Math.max(1, Math.min(16, Number(e.target.value) || 1))
              void updateSettings({ maxConcurrent: v })
            }}
            data-testid="input-max-concurrent"
          />
        </div>
      </div>

      <div className="panel flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <h2 className="text-[13px] font-bold">Queue order</h2>
          <div className="flex gap-2">
            <button className="btn !py-1 text-[12px]" onClick={() => void window.turbo.queue.startAll()} data-testid="btn-start-all">
              <Play size={13} /> Start all
            </button>
            <button className="btn !py-1 text-[12px]" onClick={() => void window.turbo.queue.pauseAll()} data-testid="btn-pause-all">
              <Pause size={13} /> Pause all
            </button>
            <button className="btn !py-1 text-[12px]" onClick={() => void window.turbo.queue.stopAll()} data-testid="btn-stop-all">
              <OctagonX size={13} /> Stop all
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {queued.length === 0 && active.length === 0 ? (
            <div className="p-6 text-center text-[13px] text-muted">The queue is empty.</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 w-10">#</th>
                  <th className="px-2 py-2">File</th>
                  <th className="px-2 py-2">Host</th>
                  <th className="px-2 py-2 text-right">Size</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Order</th>
                </tr>
              </thead>
              <tbody>
                {active.map((r, i) => (
                  <tr key={r.id} className="border-t border-border bg-accent/5">
                    <td className="px-3 py-1.5 tabular-nums text-muted">{i + 1}</td>
                    <td className="max-w-64 truncate px-2 py-1.5 font-medium" title={r.filename}>
                      {r.filename}
                    </td>
                    <td className="px-2 py-1.5 text-muted">{hostnameOf(r.url)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.totalBytes >= 0 ? formatBytes(r.totalBytes) : '?'}</td>
                    <td className="px-2 py-1.5">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-1.5 text-right text-muted">running</td>
                  </tr>
                ))}
                {queued.map((r, i) => (
                  <tr key={r.id} className="border-t border-border hover:bg-rowhover" data-testid={`queue-row-${r.id}`}>
                    <td className="px-3 py-1.5 tabular-nums text-muted">{active.length + i + 1}</td>
                    <td className="max-w-64 truncate px-2 py-1.5 font-medium" title={r.filename}>
                      {r.filename}
                    </td>
                    <td className="px-2 py-1.5 text-muted">{hostnameOf(r.url)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.totalBytes >= 0 ? formatBytes(r.totalBytes) : '?'}</td>
                    <td className="px-2 py-1.5">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex justify-end gap-1">
                        <button className="btn btn-ghost !p-1" title="Move up" disabled={i === 0} onClick={() => move(i, -1)} data-testid={`queue-up-${r.id}`}>
                          <ArrowUp size={13} />
                        </button>
                        <button
                          className="btn btn-ghost !p-1"
                          title="Move down"
                          disabled={i === queued.length - 1}
                          onClick={() => move(i, 1)}
                          data-testid={`queue-down-${r.id}`}
                        >
                          <ArrowDown size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="border-t border-border px-3 py-2 text-[11px] text-muted">
          Downloads run top-to-bottom; new rows start as slots free up. {settings?.segmentsPerDownload ?? 4} connections per download.
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="panel p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-[18px] font-bold tabular-nums">{value}</div>
    </div>
  )
}
