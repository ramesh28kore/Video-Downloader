import { describe, it, expect } from 'vitest'
import {
  sniffMagic,
  categorize,
  filenameFromUrl,
  parseContentDisposition,
  suggestUniqueFilename,
  extOfFilename
} from '../../src/main/download/Metadata'

function buf(bytes: number[]): Buffer {
  return Buffer.from(bytes)
}

describe('sniffMagic', () => {
  it('detects MP4 via the ftyp box at offset 4', () => {
    expect(sniffMagic(buf([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]))).toBe('mp4')
  })
  it('detects Matroska/WebM (EBML)', () => {
    expect(sniffMagic(buf([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]))).toBe('mkv')
  })
  it('detects RIFF (AVI/WAV)', () => {
    expect(sniffMagic(buf([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]))).toBe('riff')
  })
  it('detects ZIP (and OOXML)', () => {
    expect(sniffMagic(buf([0x50, 0x4b, 3, 4]))).toBe('zip')
  })
  it('detects 7z, gzip, pdf, jpeg, png, mp3', () => {
    expect(sniffMagic(buf([0x37, 0x7a, 0xbc, 0xaf]))).toBe('7z')
    expect(sniffMagic(buf([0x1f, 0x8b]))).toBe('gzip')
    expect(sniffMagic(buf([0x25, 0x50, 0x44, 0x46]))).toBe('pdf')
    expect(sniffMagic(buf([0xff, 0xd8, 0xff]))).toBe('jpeg')
    expect(sniffMagic(buf([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))).toBe('png')
    expect(sniffMagic(buf([0x49, 0x44, 0x33, 0x04]))).toBe('mp3')
  })
  it('returns null for unknown or too-short buffers', () => {
    expect(sniffMagic(buf([0, 1, 2, 3]))).toBeNull()
    expect(sniffMagic(buf([]))).toBeNull()
  })
})

describe('extOfFilename', () => {
  it('extracts a lowercase extension, ignoring directories', () => {
    expect(extOfFilename('C:\\a\\Movie.MP4')).toBe('mp4')
    expect(extOfFilename('archive.tar.gz')).toBe('gz')
    expect(extOfFilename('noext')).toBe('')
    expect(extOfFilename('trailing.')).toBe('')
  })
})

describe('categorize', () => {
  it('magic bytes win over a lying extension', () => {
    expect(categorize('song.mp3', 'audio/mpeg', 'mp4')).toBe('Videos')
    expect(categorize('data.bin', null, 'pdf')).toBe('Documents')
    expect(categorize('photo.jpg', 'image/jpeg', 'png')).toBe('Images')
  })
  it('an OOXML doc is Documents even though it is a zip', () => {
    expect(categorize('report.docx', 'application/octet-stream', 'zip')).toBe('Documents')
    expect(categorize('stuff.xlsx', null, 'zip')).toBe('Documents')
    // a real zip stays Archives
    expect(categorize('backup.zip', 'application/zip', 'zip')).toBe('Archives')
  })
  it('falls back to mime when no magic', () => {
    expect(categorize('clip', 'video/mp4', null)).toBe('Videos')
    expect(categorize('song', 'audio/flac', null)).toBe('Music')
    expect(categorize('pic', 'image/png', null)).toBe('Images')
    expect(categorize('page', 'text/html', null)).toBe('Documents')
  })
  it('octet-stream + software extension ⇒ Software', () => {
    expect(categorize('installer.exe', 'application/octet-stream', null)).toBe('Software')
  })
  it('falls back to extension when mime is generic', () => {
    expect(categorize('movie.mkv', 'application/octet-stream', null)).toBe('Videos')
    expect(categorize('song.m4a', 'application/octet-stream', null)).toBe('Music')
    expect(categorize('shot.png', 'application/octet-stream', null)).toBe('Images')
    expect(categorize('pack.7z', 'application/octet-stream', null)).toBe('Archives')
  })
  it('unknown everything ⇒ Other', () => {
    expect(categorize('mystery', 'application/octet-stream', null)).toBe('Other')
  })
})

describe('filenameFromUrl', () => {
  it('uses the last path segment, decoded', () => {
    expect(filenameFromUrl('https://x.com/files/My%20Movie.mp4')).toBe('My Movie.mp4')
  })
  it('strips query strings and sanitises', () => {
    expect(filenameFromUrl('https://x.com/a/bad<name>.zip?token=1')).toBe('badname.zip')
  })
  it('derives a name from the hostname when there is no file part', () => {
    expect(filenameFromUrl('https://cdn.example.com/')).toBe('cdn_example_com')
  })
  it('returns "download" for an unparseable URL', () => {
    expect(filenameFromUrl('not a url')).toBe('download')
  })
})

describe('parseContentDisposition', () => {
  it('reads a plain quoted filename', () => {
    expect(parseContentDisposition('attachment; filename="report.pdf"')).toBe('report.pdf')
  })
  it('prefers the RFC 5987 extended filename* and decodes UTF-8', () => {
    expect(parseContentDisposition("attachment; filename*=UTF-8''%E2%98%95%20tea.txt")).toBe('☕ tea.txt')
  })
  it('extended wins over plain when both present', () => {
    const h = "attachment; filename=\"fallback.txt\"; filename*=UTF-8''real%20name.pdf"
    expect(parseContentDisposition(h)).toBe('real name.pdf')
  })
  it('returns null when there is no filename', () => {
    expect(parseContentDisposition('attachment')).toBeNull()
    expect(parseContentDisposition(undefined)).toBeNull()
  })
})

describe('suggestUniqueFilename', () => {
  it('delegates to uniqueName with lowercase-taken semantics', () => {
    expect(suggestUniqueFilename('a.txt', new Set())).toBe('a.txt')
    expect(suggestUniqueFilename('a.txt', new Set(['a.txt']))).toBe('a (1).txt')
  })
})
