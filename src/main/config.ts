import os from 'node:os'
import path from 'node:path'
import type { AppSettings, CategoryRow } from '@shared/types'

export function defaultSettings(): AppSettings {
  return {
    downloadDir: path.join(os.homedir(), 'Downloads', 'TurboDownload'),
    maxConcurrent: 3,
    segmentsPerDownload: 4,
    globalSpeedLimitKbps: 0,
    retryCount: 4,
    timeoutSeconds: 30,
    autoStart: true,
    monitorClipboard: true,
    autoDetectVideos: true,
    // Detection is enabled by default, but never start unexpected transfers
    // without the user's explicit opt-in.
    autoDownloadDetectedVideos: false,
    playSounds: false,
    minimizeToTray: true,
    startMinimized: false,
    launchAtStartup: false,
    theme: 'system',
    autoCategorize: true,
    confirmOnDelete: true,
    preallocate: true,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  }
}

export interface SeedCategory {
  name: string
  folder: string
  extensions: string[]
}

/** Default IDM-style auto-categorisation buckets (spec §auto-categorized folders). */
export const SEED_CATEGORIES: SeedCategory[] = [
  { name: 'Compressed', folder: 'Compressed', extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst', 'iso'] },
  { name: 'Documents', folder: 'Documents', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv', 'epub', 'odt'] },
  { name: 'Music', folder: 'Music', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus', 'alac'] },
  { name: 'Videos', folder: 'Videos', extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg', 'ts'] },
  { name: 'Images', folder: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff'] },
  { name: 'Programs', folder: 'Programs', extensions: ['exe', 'msi', 'dmg', 'apk', 'deb', 'rpm', 'appimage', 'bin'] },
  { name: 'Other', folder: '', extensions: [] }
]

export function seedCategoriesIfEmpty(repo: { list(): CategoryRow[]; create(name: string, folder: string, exts: string[]): CategoryRow }): void {
  if (repo.list().length > 0) return
  for (const c of SEED_CATEGORIES) repo.create(c.name, c.folder, c.extensions)
}
