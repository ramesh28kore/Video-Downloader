import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { IPC } from '@shared/ipc'
import { getServices } from '../services'
import { getWindow } from '../window'
import { ignoreClipboardUrl } from '../clipboard'
import { notifyCompleted, notifyFailed, openFileOrFolder } from '../notifications'
import { rebuildTrayMenu } from '../tray'
import { probeUrl } from '../download/Metadata'
import { isHttpUrl } from '../fs/PathValidator'
import { createLogger } from '../util/logger'
import { syncMediaBridge } from '../bridge/MediaBridgeRuntime'
import type { AddDownloadOptions, AppSettings, DownloadStatus, HistoryFilter, ScheduleRow } from '@shared/types'
import { getMediaBridge } from '../bridge/MediaBridge'

const log = createLogger('ipc')

function send(channel: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

export function registerIpc(): void {
  const s = getServices()

  // ---------------------------------------------------------- downloads
  ipcMain.handle(IPC.AddDownload, (_e, opts: AddDownloadOptions) => s.manager.addDownload(opts))
  ipcMain.handle(IPC.ProbeUrl, async (_e, url: string) => {
    if (!isHttpUrl(url)) return { ok: false, error: { code: 'invalid_url', message: 'Not a valid http(s) URL' } }
    return probeUrl(url, { userAgent: s.settings().userAgent })
  })
  ipcMain.handle(IPC.List, () => s.manager.list())
  ipcMain.handle(IPC.Get, (_e, id: string) => s.manager.get(id))
  ipcMain.handle(IPC.Start, (_e, id: string) => s.manager.start(id))
  ipcMain.handle(IPC.Pause, (_e, id: string) => s.manager.pause(id))
  ipcMain.handle(IPC.Resume, (_e, id: string) => s.manager.resume(id))
  ipcMain.handle(IPC.Cancel, (_e, id: string) => s.manager.cancel(id))
  ipcMain.handle(IPC.Retry, (_e, id: string) => s.manager.retry(id))
  ipcMain.handle(IPC.Remove, (_e, id: string) => s.manager.remove(id))
  ipcMain.handle(IPC.SetSpeedLimit, (_e, id: string, bps: number) => s.manager.setSpeedLimit(id, Math.max(0, bps | 0)))
  ipcMain.handle(IPC.OpenFile, (_e, id: string) => {
    const r = s.manager.get(id)
    if (r) openFileOrFolder(r)
  })
  ipcMain.handle(IPC.OpenFolder, (_e, id: string) => {
    const r = s.manager.get(id)
    const dir = r?.filePath ? path.dirname(r.filePath) : r?.partPath ? path.dirname(r.partPath) : s.settings().downloadDir
    void shell.openPath(dir)
  })
  ipcMain.handle(IPC.ShowInFolder, (_e, id: string) => {
    const r = s.manager.get(id)
    const target = r?.filePath && existsSync(r.filePath) ? r.filePath : r?.partPath
    if (target && existsSync(target)) shell.showItemInFolder(target)
    else void shell.openPath(s.settings().downloadDir)
  })
  ipcMain.handle(
    IPC.DuplicateResolved,
    (_e, id: string, mode: 'rename' | 'replace' | 'cancel', filename?: string) => {
      // Re-add flow is handled by the renderer (it re-calls add with a chosen
      // duplicateMode); this channel simply records the user's decision.
      log.info(`duplicate ${id} resolved: ${mode} ${filename ?? ''}`)
    }
  )

  // -------------------------------------------------------------- queue
  ipcMain.handle(IPC.QueueStats, () => s.manager.stats())
  ipcMain.handle(IPC.QueueStartAll, () => s.manager.startAll())
  ipcMain.handle(IPC.QueuePauseAll, () => s.manager.pauseAll())
  ipcMain.handle(IPC.QueueStopAll, () => s.manager.stopAll())
  ipcMain.handle(IPC.QueueReorder, (_e, orderedIds: string[]) => s.manager.reorder(orderedIds))

  // ------------------------------------------------------------ history
  ipcMain.handle(IPC.HistoryQuery, (_e, filter: HistoryFilter) => s.manager.history(filter ?? {}))
  ipcMain.handle(IPC.HistoryClear, (_e, statuses: DownloadStatus[]) => s.manager.clearHistory(statuses))

  // ------------------------------------------------------------ settings
  ipcMain.handle(IPC.SettingsGet, () => s.settings())
  ipcMain.handle(IPC.SettingsUpdate, async (_e, patch: Partial<AppSettings>) => {
    const previousAutoDetect = s.settings().autoDetectVideos
    const next = s.updateSettings(patch)
    if (patch.autoDetectVideos !== undefined && patch.autoDetectVideos !== previousAutoDetect) {
      await syncMediaBridge(next.autoDetectVideos)
    }
    send(IPC.EvSettings, next)
    return next
  })
  ipcMain.handle(IPC.PickFolder, async () => {
    const w = getWindow()
    const options = {
      title: 'Choose download folder',
      defaultPath: s.settings().downloadDir,
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
    }
    const res = w ? await dialog.showOpenDialog(w, options) : await dialog.showOpenDialog(options)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC.MediaBridgeConfig, () => {
    const bridge = getMediaBridge()
    return bridge ? { endpoint: `http://127.0.0.1:${bridge.port}/media`, token: bridge.token } : null
  })

  // ---------------------------------------------------------- categories
  ipcMain.handle(IPC.CategoryList, () => s.categories.list())
  ipcMain.handle(IPC.CategoryCreate, (_e, name: string, folder: string, extensions: string[]) =>
    s.categories.create(name, folder, extensions)
  )
  ipcMain.handle(IPC.CategoryUpdate, (_e, id: number, patch: { name?: string; folder?: string; extensions?: string[] }) =>
    s.categories.update(id, patch)
  )
  ipcMain.handle(IPC.CategoryDelete, (_e, id: number) => s.categories.remove(id))

  // ----------------------------------------------------------- clipboard
  ipcMain.handle(IPC.ClipboardIgnore, () => ignoreClipboardUrl())

  // -------------------------------------------------------------- window
  ipcMain.handle(IPC.WinMinimize, () => getWindow()?.minimize())
  ipcMain.handle(IPC.WinMaximize, () => {
    const w = getWindow()
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.handle(IPC.WinClose, () => getWindow()?.close())

  // ------------------------------------------------------------ schedule
  ipcMain.handle('schedule:get', () => s.schedules.get())
  ipcMain.handle('schedule:set', (_e, patch: Partial<ScheduleRow>) => {
    const row = s.schedules.upsert(patch)
    send(IPC.EvSettings, s.settings())
    return row
  })

  // --------------------------------------------- manager -> renderer push
  s.manager.on('created', (rec) => send(IPC.EvCreated, rec))
  s.manager.on('updated', (rec) => send(IPC.EvUpdated, rec))
  s.manager.on('progress', (ticks) => send(IPC.EvProgress, ticks))
  s.manager.on('completed', (rec) => {
    send(IPC.EvCompleted, rec)
    send(IPC.EvHistoryChanged, undefined)
    notifyCompleted(rec)
    rebuildTrayMenu()
  })
  s.manager.on('failed', (rec) => {
    send(IPC.EvFailed, rec)
    send(IPC.EvHistoryChanged, undefined)
    notifyFailed(rec)
    rebuildTrayMenu()
  })
  s.manager.on('queue', (stats) => {
    send(IPC.EvQueue, stats)
    rebuildTrayMenu()
  })
  s.manager.on('removed', () => send(IPC.EvHistoryChanged, undefined))

  // Scheduler -> queue control
  s.scheduler.on('start', () => s.manager.startAll())
  s.scheduler.on('stop', () => s.manager.pauseAll())
}
