// ============================================================
// RBI Event Bus - Simple pub/sub for agent communication
// ============================================================

import type { RBIEvent, RBIEventType } from "./types";

class RBIEventBus {
  private handlers = new Map<RBIEventType, ((event: RBIEvent) => void)[]>();
  private log: RBIEvent[] = [];

  on(type: RBIEventType, handler: (event: RBIEvent) => void) {
    const list = this.handlers.get(type) || [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  emit(event: RBIEvent) {
    this.log.push(event);
    const handlers = this.handlers.get(event.type) || [];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (e) {
        console.error(`[RBI EventBus] Handler error for ${event.type}:`, e);
      }
    }
  }

  getLog(): RBIEvent[] {
    return [...this.log];
  }

  clear() {
    this.log = [];
  }
}

// Singleton
export const eventBus = new RBIEventBus();
