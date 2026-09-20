import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'node:path'
import { showWindow } from './window'
import { getServices } from './services'

let tray: Tray | null = null

export function createTray(): void {
  if (tray) return
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('TurboDownload')
  rebuildTrayMenu()
  tray.on('click', () => showWindow())
  tray.on('double-click', () => showWindow())
}

export function rebuildTrayMenu(): void {
  if (!tray) return
  const stats = getServices().manager.stats()
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Active: ${stats.active}/${stats.maxConcurrent}   Queued: ${stats.queued}`, enabled: false },
      { type: 'separator' },
      { label: 'Show TurboDownload', click: () => showWindow() },
      {
        label: 'Pause all',
        click: () => getServices().manager.pauseAll()
      },
      {
        label: 'Resume all',
        click: () => getServices().manager.startAll()
      },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.quit() } }
    ])
  )
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
