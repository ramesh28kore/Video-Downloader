import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, Sun, Moon, MonitorSmartphone, Plus, Trash2 } from 'lucide-react'
import { useSettings } from '../stores/settings'
import type { AppSettings, CategoryRow, ScheduleRow, ThemeMode } from '@shared/types'

export default function SettingsPage(): React.JSX.Element {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const [schedule, setSchedule] = useState<ScheduleRow | null>(null)
  const [bridge, setBridge] = useState<{ endpoint: string; token: string } | null>(null)

  useEffect(() => {
    void window.turbo.schedule.get().then(setSchedule)
    void window.turbo.settings.mediaBridgeConfig().then(setBridge)
  }, [])

  useEffect(() => {
    if (!settings?.autoDetectVideos) {
      setBridge(null)
      return
    }
    void window.turbo.settings.mediaBridgeConfig().then(setBridge)
  }, [settings?.autoDetectVideos])

  if (!settings) {
    return <div className="p-6 text-[13px] text-muted">Loading settings…</div>
  }

  const set = (patch: Partial<AppSettings>): void => {
    void update(patch)
  }

  const pickDir = useCallback(async () => {
    const dir = await window.turbo.settings.pickFolder()
    if (dir) set({ downloadDir: dir })
  }, [settings])

  return (
    <div className="h-full overflow-auto p-4" data-testid="page-settings">
      <div className="mx-auto grid max-w-4xl grid-cols-2 gap-4">
        <Group title="General">
          <ThemePicker value={settings.theme} onChange={(theme) => set({ theme })} />
          <Toggle label="Minimize to tray instead of closing" hint="Keep downloading with the window hidden." checked={settings.minimizeToTray} onChange={(v) => set({ minimizeToTray: v })} />
          <Toggle label="Start minimized to tray" checked={settings.startMinimized} onChange={(v) => set({ startMinimized: v })} />
          <Toggle label="Launch at Windows startup" checked={settings.launchAtStartup} onChange={(v) => set({ launchAtStartup: v })} />
          <Toggle label="Confirm before deleting" checked={settings.confirmOnDelete} onChange={(v) => set({ confirmOnDelete: v })} />
          <Toggle label="Play sounds on completion" checked={settings.playSounds} onChange={(v) => set({ playSounds: v })} />
        </Group>

        <Group title="Downloads">
          <label className="block">
            <span className="label">Default download folder</span>
            <div className="flex gap-2">
              <input className="input font-mono text-[12px]" value={settings.downloadDir} readOnly />
              <button className="btn shrink-0" onClick={() => void pickDir()} data-testid="btn-pick-dir">
                <FolderOpen size={14} /> Browse
              </button>
            </div>
          </label>
          <Toggle label="Auto-categorize into sub-folders" hint="Completed files move into Videos / Music / Documents…" checked={settings.autoCategorize} onChange={(v) => set({ autoCategorize: v })} />
          <Toggle label="Start downloads automatically" hint="Otherwise new items wait in the queue." checked={settings.autoStart} onChange={(v) => set({ autoStart: v })} />
          <Toggle label="Monitor clipboard for copied links" checked={settings.monitorClipboard} onChange={(v) => set({ monitorClipboard: v })} />
          <Toggle label="Detect playing browser videos" hint="Requires the companion Chrome/Edge extension. Only direct, non-protected media files are detected." checked={settings.autoDetectVideos} onChange={(v) => set({ autoDetectVideos: v })} />
          <Toggle label="Automatically download detected videos" hint="Starts an eligible direct video as soon as it begins playing. HLS/DASH, DRM and protected streams are excluded." checked={settings.autoDownloadDetectedVideos} onChange={(v) => set({ autoDownloadDetectedVideos: v })} />
          <Toggle label="Pre-allocate .part files (NTFS)" hint="Reduces fragmentation for very large downloads." checked={settings.preallocate} onChange={(v) => set({ preallocate: v })} />
          <Num label="Retry attempts" min={0} max={10} value={settings.retryCount} onChange={(retryCount) => set({ retryCount })} />
          <Num label="Network timeout (seconds)" min={5} max={300} value={settings.timeoutSeconds} onChange={(timeoutSeconds) => set({ timeoutSeconds })} />
        </Group>

        <Group title="Performance">
          <Num label="Max simultaneous downloads" min={1} max={16} value={settings.maxConcurrent} onChange={(maxConcurrent) => set({ maxConcurrent })} hint="Queue slots filled top-to-bottom." />
          <Num label="Connections per download" min={1} max={16} value={settings.segmentsPerDownload} onChange={(segmentsPerDownload) => set({ segmentsPerDownload })} hint="IDM-style segmented downloading." />
          <Num
            label="Global speed limit (KiB/s, 0 = unlimited)"
            min={0}
            max={10_000_000}
            value={settings.globalSpeedLimitKbps}
            onChange={(globalSpeedLimitKbps) => set({ globalSpeedLimitKbps })}
          />
          <label className="block">
            <span className="label">User-Agent</span>
            <input className="input font-mono text-[11px]" value={settings.userAgent} onChange={(e) => set({ userAgent: e.target.value })} data-testid="input-useragent" />
          </label>
        </Group>

        <Group title="Scheduler">
          <ScheduleEditor schedule={schedule} onChange={setSchedule} />
        </Group>

        <Group title="Browser video detector">
          <p className="text-[12px] text-muted">Load the unpacked <span className="font-mono">extension</span> folder in Chrome or Edge, then configure its bridge with this session’s values.</p>
          {bridge ? (
            <div className="space-y-2">
              <input className="input font-mono text-[11px]" readOnly value={bridge.endpoint} aria-label="Bridge endpoint" />
              <input className="input font-mono text-[11px]" readOnly value={bridge.token} aria-label="Bridge token" />
              <button className="btn" onClick={() => void navigator.clipboard.writeText(JSON.stringify(bridge))}>Copy extension config</button>
            </div>
          ) : <div className="text-[12px] text-muted">Enable Auto Detect Videos to create a bridge session.</div>}
        </Group>

        <div className="col-span-2">
          <CategoryEditor />
        </div>

        <div className="col-span-2 text-[11px] text-muted">
          TurboDownload only fetches direct, user-authorized URLs. It will not bypass DRM, paywalls, logins or CAPTCHAs.
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function Group({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="panel p-4">
      <h2 className="mb-3 text-[13px] font-bold">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function ThemePicker({ value, onChange }: { value: ThemeMode; onChange: (v: ThemeMode) => void }): React.JSX.Element {
  const opts: { key: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { key: 'light', label: 'Light', icon: <Sun size={14} /> },
    { key: 'dark', label: 'Dark', icon: <Moon size={14} /> },
    { key: 'system', label: 'System', icon: <MonitorSmartphone size={14} /> }
  ]
  return (
    <div>
      <span className="label">Theme</span>
      <div className="flex gap-1" data-testid="theme-picker">
        {opts.map((o) => (
          <button key={o.key} className={`btn flex-1 justify-center ${value === o.key ? 'btn-primary' : ''}`} onClick={() => onChange(o.key)} data-testid={`theme-${o.key}`}>
            {o.icon} {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <label className="flex items-start gap-2 text-[12px]" title={hint}>
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-[11px] text-muted">{hint}</span>}
      </span>
    </label>
  )
}

function Num({ label, value, min, max, onChange, hint }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; hint?: string }): React.JSX.Element {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        type="number"
        className="input !w-32"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, Math.round(n))))
        }}
      />
      {hint && <span className="ml-2 text-[11px] text-muted">{hint}</span>}
    </label>
  )
}

// ---------------------------------------------------------------------------

function ScheduleEditor({ schedule, onChange }: { schedule: ScheduleRow | null; onChange: (s: ScheduleRow | null) => void }): React.JSX.Element {
  const [startAt, setStartAt] = useState('')
  const [stopAt, setStopAt] = useState('')
  const [mode, setMode] = useState<'once' | 'daily'>('once')
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    if (!schedule) return
    setEnabled(schedule.enabled)
    setMode(schedule.mode)
    setStartAt(schedule.startAt ? toLocalInput(schedule.startAt) : '')
    setStopAt(schedule.stopAt ? toLocalInput(schedule.stopAt) : '')
  }, [schedule])

  const save = (): void => {
    const patch = {
      startAt: startAt ? new Date(startAt).getTime() : null,
      stopAt: stopAt ? new Date(stopAt).getTime() : null,
      enabled,
      mode
    }
    void window.turbo.schedule.set(patch).then(onChange)
  }

  return (
    <div className="space-y-3" data-testid="schedule-editor">
      <Toggle label="Enable scheduler" hint="Automatically start / pause the whole queue at set times (e.g. off-peak hours)." checked={enabled} onChange={(v) => setEnabled(v)} />
      <label className="block">
        <span className="label">Start downloads at</span>
        <input type="datetime-local" className="input" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">Pause downloads at</span>
        <input type="datetime-local" className="input" value={stopAt} onChange={(e) => setStopAt(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">Repeat</span>
        <select className="input !w-auto" value={mode} onChange={(e) => setMode(e.target.value as 'once' | 'daily')}>
          <option value="once">Once</option>
          <option value="daily">Every day</option>
        </select>
      </label>
      <button className="btn btn-primary" onClick={save} data-testid="btn-schedule-save">
        Save schedule
      </button>
    </div>
  )
}

function toLocalInput(epochMs: number): string {
  const d = new Date(epochMs)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------------------------------------------------------------------------

function CategoryEditor(): React.JSX.Element {
  const [rows, setRows] = useState<CategoryRow[]>([])
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [exts, setExts] = useState('')

  const reload = useCallback((): void => {
    void window.turbo.categories.list().then(setRows)
  }, [])
  useEffect(reload, [reload])

  const create = (): void => {
    if (!name.trim() || !folder.trim()) return
    void window.turbo.categories
      .create(
        name.trim(),
        folder.trim(),
        exts.split(',').map((s) => s.trim().toLowerCase().replace(/^\./, '')).filter(Boolean)
      )
      .then(() => {
        setName('')
        setFolder('')
        setExts('')
        reload()
      })
  }

  const removeCat = (c: CategoryRow): void => {
    if (!window.confirm(`Delete category "${c.name}"? Existing downloads keep their folder.`)) return
    void window.turbo.categories.delete(c.id).then(reload)
  }

  return (
    <section className="panel p-4" data-testid="category-editor">
      <h2 className="mb-3 text-[13px] font-bold">Categories &amp; folders</h2>
      <div className="mb-3 grid grid-cols-[1fr_1fr_2fr_auto] gap-2">
        <input className="input" placeholder="Name (e.g. Games)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="Sub-folder" value={folder} onChange={(e) => setFolder(e.target.value)} />
        <input className="input" placeholder="Extensions: iso,zip" value={exts} onChange={(e) => setExts(e.target.value)} />
        <button className="btn btn-primary" onClick={create} disabled={!name.trim() || !folder.trim()}>
          <Plus size={14} /> Add
        </button>
      </div>
      <table className="w-full text-[12px]">
        <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
          <tr>
            <th className="py-1 pr-2">Category</th>
            <th className="py-1 pr-2">Folder</th>
            <th className="py-1">Extensions</th>
            <th className="py-1 text-right"> </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t border-border">
              <td className="py-1.5 pr-2 font-medium">{c.name}</td>
              <td className="py-1.5 pr-2 font-mono text-[11px] text-muted">{c.folder}</td>
              <td className="max-w-96 truncate py-1.5 text-[11px] text-muted" title={c.extensions.join(', ')}>
                {c.extensions.join(', ') || '—'}
              </td>
              <td className="py-1.5 text-right">
                <button className="btn btn-ghost btn-danger !p-1" onClick={() => removeCat(c)} aria-label={`Delete ${c.name}`}>
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
