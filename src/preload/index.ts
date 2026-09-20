import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AddDownloadOptions,
  AppSettings,
  CategoryRow,
  ClipboardUrlInfo,
  CreateDownloadResult,
  DownloadRecord,
  DownloadStatus,
  HistoryFilter,
  ProgressTick,
  QueueStats,
  ScheduleRow,
  ProbeResult
  ,DetectedMedia
} from '@shared/types'

/** Event channel -> payload map for renderer subscriptions. */
const eventChannels: Record<string, true> = {
  [IPC.EvCreated]: true,
  [IPC.EvUpdated]: true,
  [IPC.EvProgress]: true,
  [IPC.EvCompleted]: true,
  [IPC.EvFailed]: true,
  [IPC.EvQueue]: true,
  [IPC.EvClipboardUrl]: true,
  [IPC.EvMediaDetected]: true,
  [IPC.EvSettings]: true,
  [IPC.EvHistoryChanged]: true
}

type Handler = (payload: never) => void

function on(channel: string, handler: Handler): () => void {
  if (!eventChannels[channel]) throw new Error(`Unknown event channel: ${channel}`)
  const wrapped = (_e: unknown, payload: unknown) => handler(payload as never)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api = {
  download: {
    add: (opts: AddDownloadOptions): Promise<CreateDownloadResult> => ipcRenderer.invoke(IPC.AddDownload, opts),
    probe: (url: string): Promise<ProbeResult> => ipcRenderer.invoke(IPC.ProbeUrl, url),
    list: (): Promise<DownloadRecord[]> => ipcRenderer.invoke(IPC.List),
    get: (id: string): Promise<DownloadRecord | null> => ipcRenderer.invoke(IPC.Get, id),
    start: (id: string): Promise<void> => ipcRenderer.invoke(IPC.Start, id),
    pause: (id: string): Promise<void> => ipcRenderer.invoke(IPC.Pause, id),
    resume: (id: string): Promise<void> => ipcRenderer.invoke(IPC.Resume, id),
    cancel: (id: string): Promise<void> => ipcRenderer.invoke(IPC.Cancel, id),
    retry: (id: string): Promise<void> => ipcRenderer.invoke(IPC.Retry, id),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(IPC.Remove, id),
    setSpeedLimit: (id: string, bps: number): Promise<void> => ipcRenderer.invoke(IPC.SetSpeedLimit, id, bps),
    openFile: (id: string): Promise<void> => ipcRenderer.invoke(IPC.OpenFile, id),
    openFolder: (id: string): Promise<void> => ipcRenderer.invoke(IPC.OpenFolder, id),
    showInFolder: (id: string): Promise<void> => ipcRenderer.invoke(IPC.ShowInFolder, id),
    duplicateResolved: (id: string, mode: string, filename?: string): Promise<void> =>
      ipcRenderer.invoke(IPC.DuplicateResolved, id, mode, filename)
  },
  queue: {
    stats: (): Promise<QueueStats> => ipcRenderer.invoke(IPC.QueueStats),
    startAll: (): Promise<void> => ipcRenderer.invoke(IPC.QueueStartAll),
    pauseAll: (): Promise<void> => ipcRenderer.invoke(IPC.QueuePauseAll),
    stopAll: (): Promise<void> => ipcRenderer.invoke(IPC.QueueStopAll),
    reorder: (orderedIds: string[]): Promise<void> => ipcRenderer.invoke(IPC.QueueReorder, orderedIds)
  },
  history: {
    query: (filter: HistoryFilter): Promise<DownloadRecord[]> => ipcRenderer.invoke(IPC.HistoryQuery, filter),
    clear: (statuses: DownloadStatus[]): Promise<number> => ipcRenderer.invoke(IPC.HistoryClear, statuses)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SettingsGet),
    update: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(IPC.SettingsUpdate, patch),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.PickFolder)
    ,mediaBridgeConfig: (): Promise<{ endpoint: string; token: string } | null> => ipcRenderer.invoke(IPC.MediaBridgeConfig)
  },
  categories: {
    list: (): Promise<CategoryRow[]> => ipcRenderer.invoke(IPC.CategoryList),
    create: (name: string, folder: string, extensions: string[]): Promise<CategoryRow> =>
      ipcRenderer.invoke(IPC.CategoryCreate, name, folder, extensions),
    update: (id: number, patch: Partial<Pick<CategoryRow, 'name' | 'folder' | 'extensions'>>): Promise<void> =>
      ipcRenderer.invoke(IPC.CategoryUpdate, id, patch),
    delete: (id: number): Promise<void> => ipcRenderer.invoke(IPC.CategoryDelete, id)
  },
  schedule: {
    get: (): Promise<ScheduleRow | null> => ipcRenderer.invoke('schedule:get'),
    set: (patch: Partial<ScheduleRow>): Promise<ScheduleRow> => ipcRenderer.invoke('schedule:set', patch)
  },
  clipboard: {
    ignore: (): Promise<void> => ipcRenderer.invoke(IPC.ClipboardIgnore)
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke(IPC.WinMinimize),
    maximize: (): Promise<void> => ipcRenderer.invoke(IPC.WinMaximize),
    close: (): Promise<void> => ipcRenderer.invoke(IPC.WinClose)
  },
  events: {
    onCreated: (h: (r: DownloadRecord) => void) => on(IPC.EvCreated, h as Handler),
    onUpdated: (h: (r: DownloadRecord) => void) => on(IPC.EvUpdated, h as Handler),
    onProgress: (h: (t: ProgressTick[]) => void) => on(IPC.EvProgress, h as Handler),
    onCompleted: (h: (r: DownloadRecord) => void) => on(IPC.EvCompleted, h as Handler),
    onFailed: (h: (r: DownloadRecord) => void) => on(IPC.EvFailed, h as Handler),
    onQueue: (h: (q: QueueStats) => void) => on(IPC.EvQueue, h as Handler),
    onClipboardUrl: (h: (c: ClipboardUrlInfo) => void) => on(IPC.EvClipboardUrl, h as Handler),
    onMediaDetected: (h: (m: DetectedMedia) => void) => on(IPC.EvMediaDetected, h as Handler),
    onSettings: (h: (s: AppSettings) => void) => on(IPC.EvSettings, h as Handler),
    onHistoryChanged: (h: () => void) => on(IPC.EvHistoryChanged, h as Handler)
  }
} as const satisfies Record<string, unknown>

export type TurboApi = typeof api

contextBridge.exposeInMainWorld('turbo', api)
