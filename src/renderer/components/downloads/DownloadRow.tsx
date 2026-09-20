import { memo, useCallback } from 'react'
import { Play, Pause, RotateCw, X, FolderOpen, Trash2 } from 'lucide-react'
import type { DownloadRecord } from '@shared/types'
import { formatBytes, formatSpeed, formatEta, formatPercent, hostnameOf } from '@shared/format'
import { useDownloads } from '../../stores/downloads'
import { useSettings } from '../../stores/settings'
import { StatusBadge } from './StatusBadge'
import { ProgressBar } from './ProgressBar'
import { cn } from '../../lib/cn'

interface RowProps {
  record: DownloadRecord
  selected: boolean
  style: React.CSSProperties
}

const ACTIVE = new Set(['downloading', 'connecting', 'retrying', 'queued', 'waiting'])

function DownloadRowBase({ record: r, selected, style }: RowProps): React.JSX.Element {
  const select = useDownloads((s) => s.select)
  const toggleDetails = useDownloads((s) => s.toggleDetails)
  const removeLocal = useDownloads((s) => s.remove)

  const onClick = useCallback(() => {
    select(r.id)
    toggleDetails(true)
  }, [r.id, select, toggleDetails])

  const act = useCallback(
    (fn: (id: string) => Promise<unknown> | void) => (e: React.MouseEvent) => {
      e.stopPropagation()
      void fn(r.id)
    },
    [r.id]
  )

  const pct = r.totalBytes > 0 ? formatPercent(r.downloadedBytes, r.totalBytes) : r.status === 'completed' ? '100%' : '—'

  return (
    <div
      style={style}
      onClick={onClick}
      onDoubleClick={() => void window.turbo.download.openFile(r.id)}
      className={cn(
        'flex cursor-default items-center gap-3 border-b border-border px-3 hover:bg-rowhover',
        selected && 'bg-selected'
      )}
      data-testid={`row-${r.id}`}
    >
      <div className="min-w-0 flex-[2.2]">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold" title={r.filename}>
            {r.filename}
          </span>
          <StatusBadge status={r.status} />
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
          <span className="truncate">{r.category}</span>
          <span>•</span>
          <span className="truncate" title={r.url}>
            {hostnameOf(r.url)}
          </span>
          {r.retryCount > 0 && (
            <>
              <span>•</span>
              <span className="text-warn">retry {r.retryCount}</span>
            </>
          )}
        </div>
      </div>

      <div className="w-40 shrink-0">
        <ProgressBar done={r.downloadedBytes} total={r.totalBytes} status={r.status} />
        <div className="mt-1 text-[11px] tabular-nums text-muted">
          {pct} · {formatBytes(r.downloadedBytes)} / {r.totalBytes >= 0 ? formatBytes(r.totalBytes) : '?'}
        </div>
      </div>

      <div className="w-24 shrink-0 text-right text-[12px] tabular-nums">
        {ACTIVE.has(r.status) ? formatSpeed(r.speedBps) : r.status === 'completed' ? formatBytes(r.totalBytes) : '—'}
      </div>
      <div className="w-24 shrink-0 text-right text-[12px] tabular-nums text-muted">
        {ACTIVE.has(r.status) ? formatEta(r.etaSeconds) : '—'}
      </div>

      <div className="flex w-44 shrink-0 items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
        {ACTIVE.has(r.status) && r.status !== 'queued' ? (
          <button className="btn btn-ghost !p-1.5" title="Pause (Space)" onClick={act((id) => window.turbo.download.pause(id))}>
            <Pause size={14} />
          </button>
        ) : r.status === 'paused' || r.status === 'waiting' || r.status === 'cancelled' ? (
          <button className="btn btn-ghost !p-1.5" title="Resume (Space)" onClick={act((id) => window.turbo.download.resume(id))}>
            <Play size={14} />
          </button>
        ) : null}
        {r.status === 'failed' && (
          <button className="btn btn-ghost !p-1.5" title="Retry (Ctrl+R)" onClick={act((id) => window.turbo.download.retry(id))}>
            <RotateCw size={14} />
          </button>
        )}
        {(r.status === 'completed' || r.status === 'failed') && (
          <button className="btn btn-ghost !p-1.5" title="Open folder" onClick={act((id) => window.turbo.download.showInFolder(id))}>
            <FolderOpen size={14} />
          </button>
        )}
        {r.status !== 'cancelled' && r.status !== 'completed' && r.status !== 'failed' && (
          <button className="btn btn-ghost !p-1.5" title="Cancel" onClick={act((id) => window.turbo.download.cancel(id))}>
            <X size={14} />
          </button>
        )}
        <button
          className="btn btn-ghost btn-danger !p-1.5"
          title="Delete (Del)"
          onClick={(e) => {
            e.stopPropagation()
            const confirmDel = useSettings.getState().settings?.confirmOnDelete ?? true
            if (confirmDel && !window.confirm(`Remove "${r.filename}" and its partial file?`)) return
            void window.turbo.download.remove(r.id).then(() => removeLocal(r.id))
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

export const DownloadRow = memo(DownloadRowBase)
