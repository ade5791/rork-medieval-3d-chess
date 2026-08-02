/** Minimal typed event emitter — no dependencies, no globals. */
export class Emitter<Events> {
  private listeners: { [K in keyof Events]?: Set<(payload: Events[K]) => void> } = {};

  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
    let set = this.listeners[event];
    if (!set) {
      set = new Set();
      this.listeners[event] = set;
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners[event];
    if (!set) return;
    for (const listener of Array.from(set)) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`[emitter] listener for "${String(event)}" failed`, error);
      }
    }
  }

  clear(): void {
    this.listeners = {};
  }
}
