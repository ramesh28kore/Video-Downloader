import { describe, it, expect } from 'vitest'
import { planSegments, planResume, MIN_SEGMENT_BYTES, SEGMENT_THRESHOLD_BYTES } from '../../src/main/download/SegmentPlanner'

const MB = 1024 * 1024

function totalCovered(ranges: { start: number; end: number }[]): number {
  return ranges.reduce((s, r) => s + (r.end >= 0 ? r.end - r.start + 1 : 0), 0)
}

describe('planSegments', () => {
  it('returns a single open-ended segment when ranges are unsupported', () => {
    const plan = planSegments(100 * MB, false, 4)
    expect(plan).toEqual([{ index: 0, start: 0, end: -1 }])
  })

  it('returns a single open-ended segment when the size is unknown', () => {
    const plan = planSegments(-1, true, 4)
    expect(plan).toEqual([{ index: 0, start: 0, end: -1 }])
  })

  it('keeps small files in one segment (below the 4MB threshold)', () => {
    const plan = planSegments(2 * MB, true, 4)
    expect(plan).toHaveLength(1)
    expect(plan[0]).toEqual({ index: 0, start: 0, end: 2 * MB - 1 })
  })

  it('splits large files into contiguous, clamped, equal-ish segments', () => {
    const total = 40 * MB
    const plan = planSegments(total, true, 4)
    expect(plan.length).toBeGreaterThanOrEqual(2)
    expect(plan.length).toBeLessThanOrEqual(16)
    // contiguous from 0..total-1
    expect(plan[0]!.start).toBe(0)
    expect(plan[plan.length - 1]!.end).toBe(total - 1)
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i]!.start).toBe(plan[i - 1]!.end + 1)
    }
    expect(totalCovered(plan)).toBe(total)
    for (const r of plan) expect(r.end - r.start + 1).toBeGreaterThanOrEqual(MIN_SEGMENT_BYTES)
  })

  it('respects the desired connection count', () => {
    const plan = planSegments(64 * MB, true, 8)
    expect(plan.length).toBe(8)
  })

  it('never exceeds 16 connections and clamps absurd values', () => {
    expect(planSegments(1024 * MB, true, 999).length).toBeLessThanOrEqual(16)
    expect(planSegments(64 * MB, true, 0).length).toBe(1)
  })

  it('caps connections so each segment stays >= 1MB', () => {
    const total = 5 * MB
    const plan = planSegments(total, true, 16)
    for (const r of plan) expect(r.end - r.start + 1).toBeGreaterThanOrEqual(1 * MB - 1)
    expect(totalCovered(plan)).toBe(total)
  })

  it('honours a resume offset (from > 0)', () => {
    const plan = planSegments(40 * MB, true, 4, 20 * MB)
    expect(plan[0]!.start).toBe(20 * MB)
    expect(totalCovered(plan)).toBe(20 * MB)
  })

  it('single segment when remaining after offset is below threshold', () => {
    const plan = planSegments(40 * MB, true, 4, 40 * MB - SEGMENT_THRESHOLD_BYTES + 1)
    expect(plan).toHaveLength(1)
  })
})

describe('planResume', () => {
  it('continues at the written prefix when ranges are unsupported', () => {
    const plan = planResume(100 * MB, false, 4, [{ start: 0, end: 100 * MB - 1, done: 30 * MB }])
    expect(plan).toEqual([{ index: 0, start: 30 * MB, end: -1 }])
  })

  it('excludes already-finished segments', () => {
    const windows = [
      { start: 0, end: 10 * MB - 1, done: 10 * MB }, // complete
      { start: 10 * MB, end: 20 * MB - 1, done: 0 } // untouched
    ]
    const plan = planResume(20 * MB, true, 4, windows)
    expect(plan.every((r) => r.start >= 10 * MB)).toBe(true)
    expect(totalCovered(plan)).toBe(10 * MB)
  })

  it('re-plans partial windows starting exactly at the missing byte', () => {
    const plan = planResume(40 * MB, true, 4, [{ start: 0, end: 40 * MB - 1, done: 10 * MB }])
    expect(plan[0]!.start).toBe(10 * MB)
    expect(totalCovered(plan)).toBe(30 * MB)
    for (let i = 1; i < plan.length; i++) expect(plan[i]!.start).toBe(plan[i - 1]!.end + 1)
  })

  it('keeps separate missing windows apart and contiguous inside', () => {
    const windows = [
      { start: 0, end: 20 * MB - 1, done: 15 * MB },
      { start: 20 * MB, end: 40 * MB - 1, done: 5 * MB }
    ]
    const plan = planResume(40 * MB, true, 4, windows)
    // missing: [15MB..20MB-1] and [25MB..40MB-1] = 20MB total
    expect(totalCovered(plan)).toBe(20 * MB)
    expect(plan[0]!.start).toBe(15 * MB)
    expect(plan[plan.length - 1]!.end).toBe(40 * MB - 1)
    // the gap 20MB..25MB-1 must not be re-downloaded
    expect(plan.some((r) => r.start >= 20 * MB && r.start < 25 * MB)).toBe(false)
  })

  it('returns an empty plan when everything is done', () => {
    const plan = planResume(10 * MB, true, 4, [{ start: 0, end: 10 * MB - 1, done: 10 * MB }])
    expect(plan).toHaveLength(0)
  })
})
