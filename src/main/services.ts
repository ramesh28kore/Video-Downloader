import path from 'node:path'
import { app } from 'electron'
import { Database } from './db/Database'
import { DownloadsRepo } from './db/repositories/DownloadsRepo'
import { CategoriesRepo } from './db/repositories/CategoriesRepo'
import { SettingsRepo } from './db/repositories/SettingsRepo'
import { ScheduleRepo } from './db/repositories/ScheduleRepo'
import { FileManager } from './fs/FileManager'
import { DownloadManager } from './download/DownloadManager'
import { Scheduler } from './scheduler/Scheduler'
import { defaultSettings, seedCategoriesIfEmpty } from './config'
import type { AppSettings } from '@shared/types'

export interface Services {
  db: Database
  downloads: DownloadsRepo
  categories: CategoriesRepo
  settingsRepo: SettingsRepo
  schedules: ScheduleRepo
  fileManager: FileManager
  manager: DownloadManager
  scheduler: Scheduler
  settings: () => AppSettings
  updateSettings: (patch: Partial<AppSettings>) => AppSettings
}

let services: Services | null = null

export function initServices(): Services {
  if (services) return services
  const db = new Database(path.join(app.getPath('userData'), 'turbo-download.db'))
  const downloads = new DownloadsRepo(db.db)
  const categories = new CategoriesRepo(db.db)
  const settingsRepo = new SettingsRepo(db.db)
  const schedules = new ScheduleRepo(db.db)
  const fileManager = new FileManager()

  seedCategoriesIfEmpty(categories)

  let current = settingsRepo.getAll(defaultSettings())
  const settings = () => current

  const manager = new DownloadManager({
    downloads,
    categories,
    settingsRepo,
    fileManager,
    getSettings: settings,
    baseDir: () => current.downloadDir
  })

  const scheduler = new Scheduler(schedules)

  const updateSettings = (patch: Partial<AppSettings>): AppSettings => {
    settingsRepo.update(patch)
    current = settingsRepo.getAll(defaultSettings())
    manager.reloadSettings()
    return current
  }

  services = { db, downloads, categories, settingsRepo, schedules, fileManager, manager, scheduler, settings, updateSettings }
  return services
}

export function getServices(): Services {
  if (!services) throw new Error('services not initialised')
  return services
}

export async function disposeServices(): Promise<void> {
  if (!services) return
  try {
    services.scheduler.stop()
    await services.manager.shutdown()
  } finally {
    services.db.close()
    services = null
  }
}
