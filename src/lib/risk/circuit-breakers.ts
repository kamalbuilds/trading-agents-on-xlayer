import type { PortfolioState, RiskLimits } from "@/lib/types";

export type BreakerLevel = "trade" | "strategy" | "portfolio";
export type BreakerStatus = "closed" | "tripped" | "cooldown";

export interface BreakerState {
  level: BreakerLevel;
  status: BreakerStatus;
  reason: string;
  trippedAt: number;
  resumeAt: number;
  consecutiveLosses: number;
}

export interface CircuitBreakerSystem {
  breakers: Map<string, BreakerState>;
  check(level: BreakerLevel, key: string, portfolio: PortfolioState, limits: RiskLimits): BreakerState;
  trip(level: BreakerLevel, key: string, reason: string, cooldownMs: number): void;
  reset(level: BreakerLevel, key: string): void;
  isBlocked(level: BreakerLevel, key: string): boolean;
  getActiveBreakers(): BreakerState[];
}

export function createCircuitBreakerSystem(): CircuitBreakerSystem {
  const breakers = new Map<string, BreakerState>();

  function getKey(level: BreakerLevel, key: string): string {
    return `${level}:${key}`;
  }

  function getOrCreate(level: BreakerLevel, key: string): BreakerState {
    const k = getKey(level, key);
    if (!breakers.has(k)) {
      breakers.set(k, {
        level,
        status: "closed",
        reason: "",
        trippedAt: 0,
        resumeAt: 0,
        consecutiveLosses: 0,
      });
    }
    return breakers.get(k)!;
  }

  function trip(level: BreakerLevel, key: string, reason: string, cooldownMs: number): void {
    const k = getKey(level, key);
    const now = Date.now();
    const state = getOrCreate(level, key);
    state.status = "tripped";
    state.reason = reason;
    state.trippedAt = now;
    state.resumeAt = now + cooldownMs;
    breakers.set(k, state);
  }

  function reset(level: BreakerLevel, key: string): void {
    const k = getKey(level, key);
    const state = getOrCreate(level, key);
    state.status = "closed";
    state.reason = "";
    state.trippedAt = 0;
    state.resumeAt = 0;
    state.consecutiveLosses = 0;
    breakers.set(k, state);
  }

  function isBlocked(level: BreakerLevel, key: string): boolean {
    const k = getKey(level, key);
    const state = breakers.get(k);
    if (!state) return false;

    const now = Date.now();
    if (state.status === "tripped") {
      if (now >= state.resumeAt && state.resumeAt > 0) {
        // Auto-transition to cooldown
        state.status = "cooldown";
        return false;
      }
      return true;
    }
    return false;
  }

  function check(
    level: BreakerLevel,
    key: string,
    portfolio: PortfolioState,
    limits: RiskLimits
  ): BreakerState {
    const state = getOrCreate(level, key);
    const now = Date.now();

    // If currently tripped, check if cooldown expired
    if (state.status === "tripped" && now >= state.resumeAt && state.resumeAt > 0) {
      state.status = "cooldown";
    }

    switch (level) {
      case "trade": {
        // Per-trade breaker: trip after consecutive losses
        if (state.consecutiveLosses >= 3) {
          if (state.status !== "tripped") {
            trip(level, key, `${state.consecutiveLosses} consecutive losses`, limits.cooldownAfterLoss * 1000);
          }
        }
        break;
      }

      case "strategy": {
        // Per-strategy breaker: trip if strategy is underperforming
        // Track by strategy-level P&L (checked by risk engine)
        if (state.consecutiveLosses >= 5) {
          if (state.status !== "tripped") {
            trip(level, key, `Strategy ${key} hit ${state.consecutiveLosses} consecutive losses`, limits.cooldownAfterLoss * 2000);
          }
        }
        break;
      }

      case "portfolio": {
        // Portfolio-level breaker: drawdown and daily loss checks
        if (portfolio.maxDrawdown >= limits.maxDrawdown) {
          if (state.status !== "tripped") {
            trip(level, key, `Max drawdown ${portfolio.maxDrawdown.toFixed(2)}% exceeded limit ${limits.maxDrawdown}%`, limits.cooldownAfterLoss * 5000);
          }
        }
        break;
      }
    }

    return state;
  }

  function getActiveBreakers(): BreakerState[] {
    return Array.from(breakers.values()).filter((b) => b.status === "tripped");
  }

  return {
    breakers,
    check,
    trip,
    reset,
    isBlocked,
    getActiveBreakers,
  };
}

// Record a trade result for circuit breaker tracking
export function recordTradeResult(
  system: CircuitBreakerSystem,
  strategy: string,
  isWin: boolean
): void {
  const tradeKey = strategy;
  const stratKey = strategy;

  // Get or create states
  const k1 = `trade:${tradeKey}`;
  const k2 = `strategy:${stratKey}`;

  let tradeState = system.breakers.get(k1);
  if (!tradeState) {
    tradeState = {
      level: "trade",
      status: "closed",
      reason: "",
      trippedAt: 0,
      resumeAt: 0,
      consecutiveLosses: 0,
    };
    system.breakers.set(k1, tradeState);
  }

  let stratState = system.breakers.get(k2);
  if (!stratState) {
    stratState = {
      level: "strategy",
      status: "closed",
      reason: "",
      trippedAt: 0,
      resumeAt: 0,
      consecutiveLosses: 0,
    };
    system.breakers.set(k2, stratState);
  }

  if (isWin) {
    tradeState.consecutiveLosses = 0;
    stratState.consecutiveLosses = 0; // A win breaks ANY consecutive loss streak
  } else {
    tradeState.consecutiveLosses++;
    stratState.consecutiveLosses++;
  }
}
