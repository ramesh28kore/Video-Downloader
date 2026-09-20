import { useEffect, useState, useCallback } from 'react'
import { X, Loader2, FolderOpen, Play, ListPlus } from 'lucide-react'
import { useDownloads } from '../../stores/downloads'
import { useSettings } from '../../stores/settings'
import { formatBytes, hostnameOf, extOf } from '@shared/format'
import type { CategoryRow, ProbeResult } from '@shared/types'

type Tab = 'single' | 'batch'

export default function AddDownloadDialog(): React.JSX.Element {
  const close = useDownloads((s) => s.closeAddDialog)
  const initialUrl = useDownloads((s) => s.addDialogUrl)
  const upsert = useDownloads((s) => s.upsert)
  const settings = useSettings((s) => s.settings)

  const [tab, setTab] = useState<Tab>('single')
  const [url, setUrl] = useState(initialUrl ?? '')
  const [batchText, setBatchText] = useState('')
  const [probing, setProbing] = useState(false)
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const isHtmlPage = probe?.ok === true && probe.contentType?.toLowerCase().startsWith('text/html') === true
  const [probeError, setProbeError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [filename, setFilename] = useState('')
  const [categoryId, setCategoryId] = useState<number | 0>(0)
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [saveIn, setSaveIn] = useState<string>('')
  const [startNow, setStartNow] = useState(true)
  const [dupMode, setDupMode] = useState<'rename' | 'replace'>('rename')

  useEffect(() => {
    void window.turbo.categories.list().then(setCategories)
  }, [])

  useEffect(() => {
    if (settings?.downloadDir && !saveIn) setSaveIn(settings.downloadDir)
  }, [settings, saveIn])

  const runProbe = useCallback(async (target: string) => {
    if (!/^https?:\/\//i.test(target)) return
    setProbing(true)
    setProbeError(null)
    try {
      const res = await window.turbo.download.probe(target)
      setProbe(res)
      if (res.ok) {
        setFilename(res.filename)
        setError(res.contentType?.toLowerCase().startsWith('text/html')
          ? 'This is a web page, not the video file. Play the video with the TurboDownload browser extension enabled so its accessible media URL can be detected.'
          : null)
      } else {
        setProbeError(res.error?.message ?? 'Unable to reach this URL.')
      }
    } catch (err) {
      setProbe(null)
      setProbeError(err instanceof Error ? err.message : 'Unable to reach this URL.')
    } finally {
      setProbing(false)
    }
  }, [])

  useEffect(() => {
    if (url.trim()) void runProbe(url.trim())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickFolder = useCallback(async () => {
    const dir = await window.turbo.settings.pickFolder()
    if (dir) setSaveIn(dir)
  }, [])

  const submitSingle = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.turbo.download.add({
        url: url.trim(),
        saveIn: saveIn || null,
        filename: filename || null,
        categoryId: categoryId || null,
        startNow,
        duplicateMode: dupMode
      })
      if (res.duplicateDetected) {
        setError(`A file named "${res.duplicateDetected.suggestedName}" already exists here. Choose a different folder or switch to "Keep both".`)
        return
      }
      upsert(res.record)
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the download.')
    } finally {
      setBusy(false)
    }
  }, [url, saveIn, filename, categoryId, startNow, dupMode, upsert, close])

  const submitBatch = useCallback(async () => {
    const urls = batchText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\//i.test(l))
    if (urls.length === 0) {
      setError('Paste one URL per line.')
      return
    }
    setBusy(true)
    setError(null)
    let added = 0
    for (const u of urls) {
      try {
        const res = await window.turbo.download.add({ url: u, saveIn: saveIn || null, startNow })
        if (!res.duplicateDetected) {
          upsert(res.record)
          added++
        }
      } catch {
        /* skip unreachable lines; they surface in the dashboard as failed if added */
      }
    }
    if (added === 0) setError('None of the URLs could be added.')
    setBusy(false)
    if (added > 0) close()
  }, [batchText, saveIn, startNow, upsert, close])

  const detected = probe?.ok
    ? {
        size: probe.totalBytes >= 0 ? formatBytes(probe.totalBytes) : 'unknown',
        type: extOf(probe.filename).toUpperCase() || (probe.contentType ?? '—'),
        host: hostnameOf(probe.finalUrl || url),
        resume: probe.supportsResume ? 'Yes' : 'No'
      }
    : null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-6" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="panel w-[620px] max-w-full shadow-2xl" role="dialog" aria-label="Add download" data-testid="add-dialog">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex gap-1">
            <button className={tab === 'single' ? 'btn btn-primary !py-1' : 'btn btn-ghost !py-1'} onClick={() => setTab('single')}>
              <Play size={13} /> Single URL
            </button>
            <button className={tab === 'batch' ? 'btn btn-primary !py-1' : 'btn btn-ghost !py-1'} onClick={() => setTab('batch')}>
              <ListPlus size={13} /> Batch / multi-URL
            </button>
          </div>
          <button className="btn btn-ghost !p-1.5" onClick={close} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 p-4">
          {tab === 'single' ? (
            <>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-muted">URL</span>
                <div className="flex gap-2">
                  <input
                    className="input font-mono"
                    placeholder="https://example.com/file.zip"
                    value={url}
                    autoFocus
                    spellCheck={false}
                    onChange={(e) => setUrl(e.target.value)}
                    onBlur={() => url.trim() && void runProbe(url.trim())}
                    onKeyDown={(e) => e.key === 'Enter' && url.trim() && void runProbe(url.trim())}
                    data-testid="input-url"
                  />
                  <button className="btn shrink-0" onClick={() => void runProbe(url.trim())} disabled={probing || !url.trim()}>
                    {probing ? <Loader2 size={14} className="animate-spin" /> : 'Detect'}
                  </button>
                </div>
              </label>

              {probing && <div className="text-[12px] text-muted">Contacting server…</div>}
              {probeError && <div className="rounded-md border border-err/40 bg-err/10 p-2 text-[12px] text-err">{probeError}</div>}

              {detected && (
                <div className="grid grid-cols-4 gap-2 rounded-md border border-border bg-panel2 p-2.5 text-[12px]" data-testid="probe-info">
                  <Info label="Size" value={detected.size} />
                  <Info label="Type" value={detected.type} />
                  <Info label="Host" value={detected.host} />
                  <Info label="Resume" value={detected.resume} />
                </div>
              )}
              {isHtmlPage && <div className="rounded-md border border-warn/40 bg-warn/10 p-2 text-[12px] text-warn">Web page detected. TurboDownload will not download this page as a video.</div>}

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-[12px] font-semibold text-muted">File name</span>
                  <input className="input" value={filename} onChange={(e) => setFilename(e.target.value)} data-testid="input-filename" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[12px] font-semibold text-muted">Category</span>
                  <select className="input" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
                    <option value={0}>Auto-detect</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-muted">Save in</span>
                <div className="flex gap-2">
                  <input className="input font-mono text-[12px]" value={saveIn} onChange={(e) => setSaveIn(e.target.value)} />
                  <button className="btn shrink-0" onClick={() => void pickFolder()} title="Browse">
                    <FolderOpen size={14} />
                  </button>
                </div>
              </label>

              <div className="flex flex-wrap items-center gap-4 text-[12px]">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} /> Start download now
                </label>
                <label className="flex items-center gap-1.5">
                  If the file exists:{' '}
                  <select className="input !w-auto !py-1" value={dupMode} onChange={(e) => setDupMode(e.target.value as 'rename' | 'replace')}>
                    <option value="rename">Keep both (rename)</option>
                    <option value="replace">Replace</option>
                  </select>
                </label>
              </div>
            </>
          ) : (
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-muted">URLs (one per line)</span>
              <textarea
                className="input h-44 font-mono text-[12px]"
                placeholder={'https://example.com/a.zip\nhttps://example.com/b.mp4'}
                value={batchText}
                autoFocus
                spellCheck={false}
                onChange={(e) => setBatchText(e.target.value)}
                data-testid="input-batch"
              />
              <div className="mt-2 flex items-center gap-4 text-[12px]">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} /> Start downloads now
                </label>
                <span className="text-muted">{batchText.split(/\r?\n/).filter((l) => /^https?:\/\//i.test(l.trim())).length} valid URLs</span>
              </div>
            </label>
          )}

          {error && <div className="rounded-md border border-err/40 bg-err/10 p-2 text-[12px] text-err">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || (tab === 'single' ? !url.trim() || isHtmlPage : !batchText.trim())}
            onClick={() => void (tab === 'single' ? submitSingle() : submitBatch())}
            data-testid="btn-confirm-add"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {tab === 'single' ? 'Add download' : 'Add all'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="truncate font-semibold" title={value}>
        {value}
      </div>
    </div>
  )
}
