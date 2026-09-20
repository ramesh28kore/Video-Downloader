import { describe, it, expect } from 'vitest'
import { sanitizeFilename, splitName, uniqueName, isInsideAllowed } from '../../src/main/fs/PathValidator'
import path from 'node:path'

describe('sanitizeFilename', () => {
  it('strips directory components (traversal via names)', () => {
    expect(sanitizeFilename('C:\\evil\\payload.exe')).toBe('payload.exe')
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('/var/log/x.txt')).toBe('x.txt')
  })

  it('removes illegal characters and control codes', () => {
    const out = sanitizeFilename('bad<>:"|?*name\x00\x1f.bin')
    expect(out).not.toMatch(/[<>:"|?*\x00-\x1f]/)
    expect(out).toBe('badname.bin')
  })

  it('trims trailing dots and spaces (Windows)', () => {
    expect(sanitizeFilename('file...')).toBe('file')
    expect(sanitizeFilename('name   ')).toBe('name')
  })

  it('neutralises reserved Windows device names', () => {
    expect(sanitizeFilename('CON')).toBe('_CON')
    expect(sanitizeFilename('nul.txt')).toBe('_nul.txt')
    expect(sanitizeFilename('com1')).toBe('_com1')
    expect(sanitizeFilename('lpt9.log')).toBe('_lpt9.log')
  })

  it('prefixes reserved names but leaves dotfiles alone', () => {
    expect(sanitizeFilename('.bashrc')).toBe('.bashrc')
  })

  it('caps the base name length but keeps the extension', () => {
    const long = 'a'.repeat(500)
    const out = sanitizeFilename(long + '.zip')
    expect(out.length).toBeLessThanOrEqual(130)
    expect(out.endsWith('.zip')).toBe(true)
  })

  it('returns an empty string for blank input (caller substitutes)', () => {
    expect(sanitizeFilename('   ')).toBe('')
    expect(sanitizeFilename('')).toBe('')
    // An extension-only name is preserved as-is.
    expect(sanitizeFilename('.zip')).toBe('.zip')
  })

  it('collapses repeated whitespace', () => {
    expect(sanitizeFilename('two   spaces.txt')).toBe('two spaces.txt')
  })
})

describe('splitName', () => {
  it('splits base and extension', () => {
    expect(splitName('archive.tar.gz')).toEqual({ base: 'archive.tar', ext: '.gz' })
    expect(splitName('noext')).toEqual({ base: 'noext', ext: '' })
    expect(splitName('.hidden')).toMatchObject({ ext: '' })
  })
})

describe('uniqueName', () => {
  it('returns the desired name when free', () => {
    expect(uniqueName('file.txt', new Set())).toBe('file.txt')
  })

  it('appends (n) counters on collision, case-insensitively', () => {
    const taken = new Set(['file.txt'])
    expect(uniqueName('file.txt', taken)).toBe('file (1).txt')
    const taken2 = new Set(['file.txt', 'file (1).txt'])
    expect(uniqueName('FILE.TXT', taken2)).toBe('FILE (2).TXT')
  })

  it('handles names without an extension', () => {
    expect(uniqueName('README', new Set(['readme']))).toBe('README (1)')
  })
})

describe('isInsideAllowed', () => {
  const root = path.join(process.cwd(), 'fixtures-tmp')

  it('accepts paths under an allowed root', () => {
    expect(isInsideAllowed(path.join(root, 'a', 'b.txt'), [root])).toBe(true)
    expect(isInsideAllowed(root, [root])).toBe(true)
  })

  it('rejects siblings sharing a prefix and traversal', () => {
    expect(isInsideAllowed(root + '-evil/x', [root])).toBe(false)
    expect(isInsideAllowed(path.join(root, '..', 'outside.txt'), [root])).toBe(false)
  })

  it('rejects everything when no roots are allowed', () => {
    expect(isInsideAllowed(path.join(root, 'x.txt'), [])).toBe(false)
    expect(isInsideAllowed(path.resolve(path.sep, 'Windows', 'x'), [root])).toBe(false)
  })
})
