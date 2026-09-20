import path from 'node:path'
import { realpathSync } from 'node:fs'

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001F]/g
const RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
])
const MAX_BASENAME = 120

/**
 * Make a user/server supplied filename safe for Windows.
 *  - strips directory components (no path traversal via filename)
 *  - removes control chars and <>:"/\|?*
 *  - neutralises reserved device names (CON, NUL, COM1…)
 *  - trims trailing dots/spaces (Windows forbids them)
 *  - caps length but preserves the extension
 */
export function sanitizeFilename(input: string): string {
  let name = String(input ?? '')
  // Drop any directory parts.
  name = name.split(/[\\/]/).pop() ?? ''
  // Strip BOM/zero-width and control characters.
  name = name.replace(/[\u200B-\u200D\uFEFF]/g, '')
  name = name.replace(ILLEGAL, '')
  // Collapse whitespace runs.
  name = name.replace(/\s{2,}/g, ' ').trim()
  // Windows: no trailing dots or spaces.
  name = name.replace(/[. ]+$/g, '')

  if (!name) return ''

  const extMatch = /\.([A-Za-z0-9]{1,10})$/.exec(name)
  const ext = extMatch ? extMatch[0] : ''
  let base = ext ? name.slice(0, -ext.length) : name

  // Reserved device name check (case-insensitive, before extension).
  const stem = base.split('.')[0]?.toUpperCase() ?? ''
  if (RESERVED.has(stem) || RESERVED.has(base.toUpperCase())) {
    base = `_${base}`
  }

  const budget = MAX_BASENAME - ext.length
  if (budget > 0 && base.length > budget) {
    base = base.slice(0, budget).replace(/[. ]+$/g, '')
  }

  const out = `${base}${ext}`.replace(/[. ]+$/g, '')
  return out || 'download'
}

/** Split "name.ext" into its parts. */
export function splitName(filename: string): { base: string; ext: string } {
  const idx = filename.lastIndexOf('.')
  if (idx <= 0 || idx === filename.length - 1) return { base: filename, ext: '' }
  return { base: filename.slice(0, idx), ext: filename.slice(idx) }
}

/**
 * Produce a collision-free name inside a directory: "video.mp4" ->
 * "video (1).mp4" -> "video (2).mp4" …
 * `taken` is a Set of lowercase names already present.
 */
export function uniqueName(desired: string, taken: Set<string>): string {
  const lower = desired.toLowerCase()
  if (!taken.has(lower)) return desired
  const { base, ext } = splitName(desired)
  for (let i = 1; i < 10000; i++) {
    const candidate = `${base} (${i})${ext}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return `${base} (${Date.now()})${ext}`
}

/**
 * Validate that `target` resolves to a location inside one of `allowedRoots`.
 * Uses realpath on existing ancestors so a symlink cannot escape the sandbox —
 * a string prefix check alone is unsafe (C:\dl vs C:\dl-other).
 */
export function isInsideAllowed(target: string, allowedRoots: string[]): boolean {
  const resolvedTarget = path.resolve(target)
  return allowedRoots.some((root) => {
    const realRoot = safeRealpath(path.resolve(root))
    const realTarget = safeRealpath(resolvedTarget)
    const rel = path.relative(realRoot, realTarget)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  })
}

function safeRealpath(p: string): string {
  // realpath on the deepest existing ancestor; the leaf may not exist yet.
  let cur = p
  const missing: string[] = []
  try {
    return realpathSync(cur)
  } catch {
    /* fall through */
  }
  while (!fileExists(cur)) {
    const parent = path.dirname(cur)
    if (parent === cur) break
    missing.unshift(path.basename(cur))
    cur = parent
  }
  try {
    const real = realpathSync(cur)
    return missing.length ? path.join(real, ...missing) : real
  } catch {
    return p
  }
}

function fileExists(p: string): boolean {
  try {
    realpathSync(p)
    return true
  } catch {
    return false
  }
}

/** Reject anything but http/https before it ever reaches the engine. */
export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
