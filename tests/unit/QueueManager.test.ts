import { describe, it, expect } from 'vitest'
import { QueueManager, isTerminal } from '../../src/main/queue/QueueManager'
import type { DownloadTask } from '../../src/main/download/DownloadTask'
import type { DownloadStatus } from '@shared/types'

function fakeTask(id: string, status: DownloadStatus, queuePos = 0): DownloadTask {
  return { id, status, queuePos } as unknown as DownloadTask
}

function managerWith(tasks: DownloadTask[]): QueueManager {
  const map = new Map(tasks.map((t) => [t.id, t]))
  const q = new QueueManager(() => map)
  return q
}

describe('QueueManager', () => {
  it('counts active vs queued correctly', () => {
    const q = managerWith([
      fakeTask('a', 'downloading'),
      fakeTask('b', 'connecting'),
      fakeTask('c', 'retrying'),
      fakeTask('d', 'queued'),
      fakeTask('e', 'waiting'),
      fakeTask('f', 'paused'),
      fakeTask('g', 'completed')
    ])
    expect(q.activeCount()).toBe(3)
    expect(q.queuedCount()).toBe(2)
  })

  it('orders the queue by queuePos ascending', () => {
    const q = managerWith([
      fakeTask('x', 'queued', 5),
      fakeTask('y', 'queued', 1),
      fakeTask('z', 'waiting', 3)
    ])
    expect(q.queuedOrder().map((t) => t.id)).toEqual(['y', 'z', 'x'])
  })

  it('fills exactly the free slots, in order', () => {
    const q = managerWith([
      fakeTask('run1', 'downloading'),
      fakeTask('q1', 'queued', 1),
      fakeTask('q2', 'queued', 2),
      fakeTask('q3', 'queued', 3)
    ])
    q.maxConcurrent = 3
    expect(q.nextToStart().map((t) => t.id)).toEqual(['q1', 'q2'])
  })

  it('returns nothing when saturated', () => {
    const q = managerWith([
      fakeTask('run1', 'downloading'),
      fakeTask('run2', 'connecting'),
      fakeTask('q1', 'queued', 1)
    ])
    q.maxConcurrent = 2
    expect(q.nextToStart()).toHaveLength(0)
  })

  it('handles maxConcurrent = 0 (everything waits)', () => {
    const q = managerWith([fakeTask('q1', 'queued', 1)])
    q.maxConcurrent = 0
    expect(q.nextToStart()).toHaveLength(0)
  })

  it('reorder maps ids to 1-based positions', () => {
    const q = managerWith([])
    const pos = q.reorder(['b', 'c', 'a'])
    expect(pos.get('b')).toBe(1)
    expect(pos.get('c')).toBe(2)
    expect(pos.get('a')).toBe(3)
  })

  it('does not mutate the task map', () => {
    const t1 = fakeTask('t1', 'queued', 1)
    const q = managerWith([t1])
    q.maxConcurrent = 5
    q.nextToStart()
    expect(t1.status).toBe('queued')
  })
})

describe('isTerminal', () => {
  it('recognises terminal states', () => {
    expect(isTerminal('completed')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('cancelled')).toBe(true)
    expect(isTerminal('downloading')).toBe(false)
    expect(isTerminal('queued')).toBe(false)
    expect(isTerminal('paused')).toBe(false)
  })
})
