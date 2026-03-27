// ============================================================
// Trading Event System
// Typed event emitter for trade lifecycle events.
// ============================================================

import type { TradingEvent, EventType, Order, Position, TradeSignal, RiskAssessment } from "@/lib/types";

type EventCallback = (event: TradingEvent) => void;

class TradingEventBus {
  private listeners = new Map<EventType | "*", Set<EventCallback>>();
  private history: TradingEvent[] = [];
  private maxHistory = 1000;

  on(type: EventType | "*", callback: EventCallback): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(type)?.delete(callback);
    };
  }

  off(type: EventType | "*", callback: EventCallback): void {
    this.listeners.get(type)?.delete(callback);
  }

  emit(type: EventType, data: unknown, source: string): TradingEvent {
    const event: TradingEvent = {
      type,
      data,
      timestamp: Date.now(),
      source,
    };

    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    // Notify specific listeners
    this.listeners.get(type)?.forEach((cb) => {
      try {
        cb(event);
      } catch (err) {
        console.error(`Event handler error for ${type}:`, err);
      }
    });

    // Notify wildcard listeners
    this.listeners.get("*")?.forEach((cb) => {
      try {
        cb(event);
      } catch (err) {
        console.error(`Wildcard event handler error:`, err);
      }
    });

    return event;
  }

  // Convenience emitters
  emitSignal(signal: TradeSignal, source: string): TradingEvent {
    return this.emit("trade_signal", signal, source);
  }

  emitOrderPlaced(order: Order, source: string): TradingEvent {
    return this.emit("order_placed", order, source);
  }

  emitOrderFilled(order: Order, source: string): TradingEvent {
    return this.emit("order_filled", order, source);
  }

  emitPositionOpened(position: Position, source: string): TradingEvent {
    return this.emit("position_opened", position, source);
  }

  emitPositionClosed(position: Position, source: string): TradingEvent {
    return this.emit("position_closed", position, source);
  }

  emitRiskAlert(assessment: RiskAssessment, source: string): TradingEvent {
    return this.emit("risk_alert", assessment, source);
  }

  emitCircuitBreaker(reason: string, source: string): TradingEvent {
    return this.emit("circuit_breaker", { reason }, source);
  }

  emitError(error: string, source: string): TradingEvent {
    return this.emit("system_error", { error }, source);
  }

  getHistory(type?: EventType, limit?: number): TradingEvent[] {
    let events = type ? this.history.filter((e) => e.type === type) : this.history;
    if (limit) events = events.slice(-limit);
    return events;
  }

  clear(): void {
    this.history = [];
    this.listeners.clear();
  }
}

// Singleton
export const tradingEvents = new TradingEventBus();
export type { TradingEventBus };
