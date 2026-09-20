import { app, BrowserWindow, nativeTheme } from 'electron'
import { initServices, disposeServices } from './services'
import { createWindow, showWindow, setQuitting } from './window'
import { createTray } from './tray'
import { startClipboardWatch, stopClipboardWatch } from './clipboard'
import { registerIpc } from './ipc/handlers'
import { createLogger } from './util/logger'
import { closeMediaBridge, syncMediaBridge } from './bridge/MediaBridgeRuntime'

const log = createLogger('main')

// Single-instance lock (spec): a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
}

void app.whenReady().then(async () => {
  log.info('app ready')
  void app.setAppUserModelId('com.turbo.download')

  const services = initServices()
  await syncMediaBridge(services.settings().autoDetectVideos)

  // Apply persisted theme + login item before any window appears.
  const s = services.settings()
  nativeTheme.themeSource = s.theme
  void app.setLoginItemSettings({ openAtLogin: s.launchAtStartup })

  registerIpc()
  await services.manager.recover()
  services.scheduler.start()

  createWindow()
  if (s.minimizeToTray) createTray()
  startClipboardWatch()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showWindow()
  })
})

// Graceful shutdown order (spec §shutdown): manager.pauseAll + fsync + WAL
// checkpoint happen inside disposeServices(); only quit afterwards.
let cleaningUp = false
async function cleanupAndQuit(): Promise<void> {
  if (cleaningUp) return
  cleaningUp = true
  setQuitting()
  stopClipboardWatch()
  try {
    await closeMediaBridge()
    await Promise.race([disposeServices(), new Promise((r) => setTimeout(r, 5000))])
  } catch (err) {
    log.error('shutdown error', err)
  }
  app.quit()
}

app.on('window-all-closed', () => {
  void cleanupAndQuit()
})

app.on('before-quit', (e) => {
  if (cleaningUp) return
  e.preventDefault()
  void cleanupAndQuit()
})

process.on('uncaughtException', (err) => {
  log.error('uncaught exception', err)
})
