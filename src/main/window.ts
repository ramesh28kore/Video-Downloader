import { BrowserWindow, screen, app, nativeTheme } from 'electron'
import { join } from 'node:path'
import { getServices } from './services'
import type { WindowBounds } from '@shared/types'

const DEFAULT_BOUNDS: WindowBounds = { x: 0, y: 0, width: 1400, height: 850, maximized: false }

let win: BrowserWindow | null = null
let quitting = false

export function setQuitting(): void {
  quitting = true
}

export function getWindow(): BrowserWindow | null {
  return win
}

function loadBounds(): WindowBounds {
  try {
    const raw = getServices().settingsRepo.getRaw('windowBounds')
    if (raw) {
      const b = JSON.parse(raw) as WindowBounds
      // Validate the remembered position is still on a connected display.
      const displays = screen.getAllDisplays()
      const inside = displays.some((d) => {
        const { x, y, width, height } = d.bounds
        return b.x >= x - 40 && b.y >= y - 40 && b.x < x + width && b.y < y + height
      })
      if (inside && b.width >= 1000 && b.height >= 650) return b
    }
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_BOUNDS
}

function saveBounds(): void {
  if (!win) return
  const b = win.getBounds()
  const maximized = win.isMaximized()
  getServices().settingsRepo.setRaw('windowBounds', JSON.stringify({ ...b, maximized } satisfies WindowBounds))
}

export function createWindow(): BrowserWindow {
  const bounds = loadBounds()
  const s = getServices().settings()
  nativeTheme.themeSource = s.theme
  win = new BrowserWindow({
    x: bounds.maximized ? undefined : bounds.x || undefined,
    y: bounds.maximized ? undefined : bounds.y || undefined,
    width: bounds.width,
    height: bounds.height,
    minWidth: 1000,
    minHeight: 650,
    show: !s.startMinimized && !bounds.maximized,
    backgroundColor: s.theme === 'dark' ? '#0b0f17' : '#f5f7fa',
    autoHideMenuBar: true,
    title: 'TurboDownload',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (bounds.maximized) win.maximize()

  // Bounds persistence with debounce.
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const persist = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveBounds(), 400)
  }
  win.on('resize', persist)
  win.on('move', persist)
  win.on('maximize', persist)
  win.on('unmaximize', persist)

  // Minimize-to-tray (spec): closing hides when the tray is enabled.
  win.on('close', (e) => {
    const settings = getServices().settings()
    if (!quitting && settings.minimizeToTray) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => {
    win = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  app.on('before-quit', () => setQuitting())
  return win
}

export function showWindow(): void {
  if (!win) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
