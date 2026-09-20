export interface SegmentRange {
  index: number
  /** inclusive start offset */
  start: number
  /** inclusive end offset; -1 means "until EOF" (single-segment unknown size) */
  end: number
}

export const MIN_SEGMENT_BYTES = 1 * 1024 * 1024 // 1 MB minimum per connection
export const SEGMENT_THRESHOLD_BYTES = 4 * 1024 * 1024 // only split above 4 MB

/**
 * IDM-style segment plan.
 *
 * Rules (spec):
 *  - Segment only when the server advertises Accept-Ranges AND the total size
 *    is known and >= 4 MB.
 *  - Each segment >= 1 MB; count clamped to [1, 16].
 *  - Unknown-size resources download as a single open-ended segment.
 *  - When resuming, already-completed byte ranges are excluded by the caller;
 *    this planner only produces the geometric split for a [from..to] window.
 */
export function planSegments(
  totalBytes: number,
  supportsRanges: boolean,
  desiredConnections: number,
  from = 0
): SegmentRange[] {
  const remaining = totalBytes >= 0 ? totalBytes - from : -1

  if (!supportsRanges || remaining < 0) {
    return [{ index: 0, start: from, end: -1 }]
  }
  if (remaining < SEGMENT_THRESHOLD_BYTES) {
    return [{ index: 0, start: from, end: totalBytes - 1 }]
  }

  const connections = Math.max(1, Math.min(16, Math.floor(desiredConnections)))
  const maxBySize = Math.max(1, Math.floor(remaining / MIN_SEGMENT_BYTES))
  const count = Math.min(connections, maxBySize)
  if (count <= 1) {
    return [{ index: 0, start: from, end: totalBytes - 1 }]
  }

  const size = Math.ceil(remaining / count)
  const ranges: SegmentRange[] = []
  let cursor = from
  for (let i = 0; i < count; i++) {
    const start = cursor
    const end = Math.min(start + size - 1, totalBytes - 1)
    if (start > end) break
    ranges.push({ index: ranges.length, start, end })
    cursor = end + 1
    if (cursor >= totalBytes) break
  }
  return ranges
}

/**
 * Re-plan remaining ranges for a resume: given per-segment progress, emit
 * fresh ranges covering only the missing byte windows.
 */
export function planResume(
  totalBytes: number,
  supportsRanges: boolean,
  desiredConnections: number,
  doneByOffset: Array<{ start: number; end: number; done: number }>
): SegmentRange[] {
  if (!supportsRanges || totalBytes < 0) {
    // Without ranges we can only continue the tail of the single stream.
    const written = doneByOffset.reduce((m, s) => m + s.done, 0)
    return [{ index: 0, start: written, end: -1 }]
  }
  const windows: Array<{ start: number; end: number }> = []
  for (const seg of doneByOffset) {
    if (seg.done <= 0) {
      windows.push({ start: seg.start, end: seg.end })
    } else if (seg.done < seg.end - seg.start + 1) {
      windows.push({ start: seg.start + seg.done, end: seg.end })
    }
  }
  // Flatten into one contiguous missing span per window, then re-split the
  // total missing bytes across the desired connections.
  windows.sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = []
  for (const w of windows) {
    const last = merged[merged.length - 1]
    if (last && w.start <= last.end + 1) {
      last.end = Math.max(last.end, w.end)
    } else {
      merged.push({ ...w })
    }
  }

  const totalMissing = merged.reduce((s, w) => s + (w.end - w.start + 1), 0)
  const out: SegmentRange[] = []
  if (totalMissing < SEGMENT_THRESHOLD_BYTES) {
    for (const w of merged) out.push({ index: out.length, start: w.start, end: w.end })
    return out
  }
  const connections = Math.max(1, Math.min(16, Math.floor(desiredConnections)))
  for (const w of merged) {
    const span = w.end - w.start + 1
    const per = Math.max(MIN_SEGMENT_BYTES, Math.ceil(span / connections))
    for (let s = w.start; s <= w.end; s += per) {
      out.push({ index: out.length, start: s, end: Math.min(s + per - 1, w.end) })
    }
  }
  return out
}
