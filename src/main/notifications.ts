import { Notification, shell } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { DownloadRecord } from '@shared/types'
import { getServices } from './services'

/**
 * Native notifications for completion / failure (spec §notifications).
 * Clicking a completed notification opens the containing folder.
 */
export function notifyCompleted(record: DownloadRecord): void {
  const s = getServices().settings()
  if (!s.playSounds && !Notification.isSupported()) return
  const n = new Notification({
    title: 'Download complete',
    body: record.filename,
    silent: !s.playSounds
  })
  n.on('click', () => {
    if (record.filePath && existsSync(record.filePath)) {
      shell.showItemInFolder(record.filePath)
    }
  })
  n.show()
}

export function notifyFailed(record: DownloadRecord): void {
  if (!Notification.isSupported()) return
  const n = new Notification({
    title: 'Download failed',
    body: `${record.filename} — ${record.failureDetail ?? record.failureReason ?? 'error'}`
  })
  n.show()
}

export function openFileOrFolder(record: DownloadRecord): void {
  if (record.filePath && existsSync(record.filePath)) {
    void shell.openPath(record.filePath)
  } else if (record.partPath && existsSync(record.partPath)) {
    shell.showItemInFolder(record.partPath)
  } else {
    const dir = record.filePath ? path.dirname(record.filePath) : getServices().settings().downloadDir
    void shell.openPath(dir)
  }
}
