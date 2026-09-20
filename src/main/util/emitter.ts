// Minimal typed event emitter (no Node dependency in the type surface used by
// the renderer; the main process uses node:events directly).

type Handler<T> = (payload: T) => void

export class Emitter<Events extends Record<string, unknown>> {
  private map = new Map<keyof Events, Set<Handler<never>>>()

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    let set = this.map.get(event)
    if (!set) {
      set = new Set()
      this.map.set(event, set)
    }
    set.add(handler as Handler<never>)
    return () => this.off(event, handler)
  }

  off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    this.map.get(event)?.delete(handler as Handler<never>)
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.map.get(event)
    if (!set) return
    for (const handler of [...set]) {
      try {
        ;(handler as Handler<Events[K]>)(payload)
      } catch (err) {
        // A broken listener must never take down the download pipeline.
        console.error('[emitter] listener threw for', String(event), err)
      }
    }
  }

  clear(): void {
    this.map.clear()
  }
}
