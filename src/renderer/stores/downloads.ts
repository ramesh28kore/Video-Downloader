import { create } from 'zustand'
import type { DownloadRecord, ProgressTick, QueueStats } from '@shared/types'

export type Page = 'dashboard' | 'queue' | 'history' | 'settings'

interface DownloadsState {
  records: Record<string, DownloadRecord>
  order: string[]
  speedSamples: number[]
  queue: QueueStats
  selectedId: string | null
  page: Page
  detailsOpen: boolean
  addDialogOpen: boolean
  addDialogUrl: string | null

  init: (records: DownloadRecord[]) => void
  upsert: (rec: DownloadRecord) => void
  remove: (id: string) => void
  applyTicks: (ticks: ProgressTick[]) => void
  setQueue: (q: QueueStats) => void
  select: (id: string | null) => void
  setPage: (p: Page) => void
  toggleDetails: (open?: boolean) => void
  openAddDialog: (url?: string | null) => void
  closeAddDialog: () => void
}

export const useDownloads = create<DownloadsState>((set, get) => ({
  records: {},
  order: [],
  speedSamples: [],
  queue: { active: 0, queued: 0, maxConcurrent: 3, speedBps: 0 },
  selectedId: null,
  page: 'dashboard',
  detailsOpen: false,
  addDialogOpen: false,
  addDialogUrl: null,

  init: (records) =>
    set({
      records: Object.fromEntries(records.map((r) => [r.id, r])),
      order: records.map((r) => r.id)
    }),

  upsert: (rec) => {
    const { order, records } = get()
    const nextOrder = records[rec.id] ? order : [...order, rec.id]
    set({ records: { ...records, [rec.id]: rec }, order: nextOrder })
  },

  remove: (id) => {
    const { records, order, selectedId } = get()
    const next = { ...records }
    delete next[id]
    set({
      records: next,
      order: order.filter((x) => x !== id),
      selectedId: selectedId === id ? null : selectedId,
      detailsOpen: get().detailsOpen && selectedId !== id
    })
  },

  applyTicks: (ticks) => {
    if (ticks.length === 0) return
    const { records } = get()
    const next = { ...records }
    let totalSpeed = 0
    for (const t of ticks) {
      const rec = next[t.id]
      if (!rec) continue
      next[t.id] = { ...rec, status: t.status, downloadedBytes: t.done, totalBytes: t.total, speedBps: t.speed, etaSeconds: t.eta }
      totalSpeed += t.speed
    }
    const samples = get().speedSamples
    let speedSamples = samples
    const last = samples[samples.length - 1]
    if (last === undefined || Math.abs(last - totalSpeed) > 1024) {
      speedSamples = [...samples.slice(-119), totalSpeed]
    }
    set({ records: next, speedSamples })
  },

  setQueue: (q) => set({ queue: q }),
  select: (id) => set({ selectedId: id }),
  setPage: (p) => set({ page: p }),
  toggleDetails: (open) => set((s) => ({ detailsOpen: open ?? !s.detailsOpen })),
  openAddDialog: (url) => set({ addDialogOpen: true, addDialogUrl: url ?? null }),
  closeAddDialog: () => set({ addDialogOpen: false, addDialogUrl: null })
}))

/** Stable list of visible rows for the dashboard (non-terminal, queue order). */
export const selectActiveRows = (s: DownloadsState): string[] =>
  s.order.filter((id) => {
    const r = s.records[id]
    return r && r.status !== 'completed'
  })
