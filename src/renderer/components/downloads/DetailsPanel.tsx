import { X, ExternalLink, FolderOpen, Gauge } from 'lucide-react'
import { useDownloads } from '../../stores/downloads'
import { StatusBadge } from './StatusBadge'
import { ProgressBar } from './ProgressBar'
import { formatBytes, formatSpeed, formatEta, formatDateTime, formatPercent } from '@shared/format'
import { friendlyMessageForReason } from '@shared/errors'

export default function DetailsPanel({ id }: { id: string }): React.JSX.Element | null {
  const record = useDownloads((s) => s.records[id])
  const toggle = useDownloads((s) => s.toggleDetails)
  if (!record) return null
  const r = record

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-panel" data-testid="details-panel">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[13px] font-bold">Details</span>
        <button className="btn btn-ghost !p-1.5" onClick={() => toggle(false)} aria-label="Close details">
          <X size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3 text-[12px]">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <StatusBadge status={r.status} />
            <span className="truncate font-semibold" title={r.filename}>
              {r.filename}
            </span>
          </div>
          <ProgressBar done={r.downloadedBytes} total={r.totalBytes} status={r.status} />
          <div className="mt-1 text-muted">
            {r.totalBytes > 0 ? `${formatPercent(r.downloadedBytes, r.totalBytes)} · ` : ''}
            {formatBytes(r.downloadedBytes)} / {r.totalBytes >= 0 ? formatBytes(r.totalBytes) : 'unknown'}
          </div>
        </div>

        {r.failureReason && (
          <div className="rounded-md border border-err/40 bg-err/10 p-2.5 text-err">
            <div className="font-semibold">Failed</div>
            <div className="mt-0.5 text-[11px] leading-4">{r.failureDetail ?? friendlyMessageForReason(r.failureReason)}</div>
          </div>
        )}

        <Section title="Transfer">
          <KV k="Speed" v={formatSpeed(r.speedBps)} />
          <KV k="ETA" v={formatEta(r.etaSeconds)} />
          <KV k="Connections" v={String(r.segments.filter((s) => s.state !== 'done').length || (r.status === 'completed' ? 0 : 1))} />
          <KV k="Resumable" v={r.supportsResume ? 'Yes (HTTP Range)' : 'No'} />
          <KV k="HTTP status" v={r.httpStatus != null ? String(r.httpStatus) : '—'} />
        </Section>

        <Section title="Segments">
          {r.segments.length === 0 ? (
            <div className="text-muted">No segment plan yet.</div>
          ) : (
            <div className="space-y-1">
              {r.segments.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="w-10 text-muted">#{s.index + 1}</span>
                  <div className="flex-1">
                    <ProgressBar done={s.done} total={s.end - s.start + 1} status={s.state === 'done' ? 'completed' : s.state === 'failed' ? 'failed' : 'downloading'} />
                  </div>
                  <span className="w-12 text-right tabular-nums text-muted">{s.end >= 0 ? formatPercent(s.done, s.end - s.start + 1) : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Source">
          <div className="break-all leading-4 text-muted" title={r.url}>
            {r.url}
          </div>
          {r.finalUrl && r.finalUrl !== r.url && (
            <div className="mt-1 break-all leading-4 text-muted" title={r.finalUrl}>
              → {r.finalUrl}
            </div>
          )}
          <button className="btn mt-2 w-full justify-center" onClick={() => void window.turbo.download.openFile(r.id)}>
            <ExternalLink size={13} /> Open file
          </button>
          <button className="btn mt-1 w-full justify-center" onClick={() => void window.turbo.download.showInFolder(r.id)}>
            <FolderOpen size={13} /> Open folder
          </button>
        </Section>

        <Section title="Timeline">
          <KV k="Added" v={formatDateTime(r.createdAt)} />
          <KV k="Started" v={r.startedAt ? formatDateTime(r.startedAt) : '—'} />
          <KV k="Completed" v={r.completedAt ? formatDateTime(r.completedAt) : '—'} />
          <KV k="Category" v={r.category} />
          <KV k="Retries" v={`${r.retryCount} / ${r.maxRetries}`} />
        </Section>
      </div>
      <div className="border-t border-border px-3 py-2 text-[11px] text-muted">
        <Gauge size={11} className="mr-1 inline" />
        Partial data is never discarded; .part files survive crashes.
      </div>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function KV({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted">{k}</span>
      <span className="truncate text-right font-medium" title={v}>
        {v}
      </span>
    </div>
  )
}
