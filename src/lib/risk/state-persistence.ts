// Risk engine state persistence
// Saves circuit breaker status, drawdown tracking, and daily loss counters to disk.
// On startup, loads previous state. On corruption/missing file, falls back to
// conservative defaults (not permissive ones).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { BreakerState } from "./circuit-breakers";
import type { DrawdownState } from "./drawdown";

const DATA_DIR = join(process.cwd(), "data");
const STATE_FILE = join(DATA_DIR, "risk-state.json");

export interface PersistedRiskState {
  version: 1;
  savedAt: number;
  circuitBreakers: Record<string, BreakerState>;
  drawdown: DrawdownState;
  tradeResults: Record<string, { wins: number; losses: number; consecutiveLosses: number }>;
}

// Conservative defaults used when state file is missing or corrupted.
// These are deliberately restrictive to prevent trading without verified state.
function conservativeDefaults(): PersistedRiskState {
  const today = new Date().toISOString().slice(0, 10);
  return {
    version: 1,
    savedAt: Date.now(),
    circuitBreakers: {},
    drawdown: {
      highWaterMark: 0,
      currentEquity: 0,
      currentDrawdown: 0,
      maxDrawdown: 0,
      drawdownStart: null,
      recoveryTarget: 0,
      dailyStartEquity: 0,
      dailyPnl: 0,
      dailyPnlPercent: 0,
      lastResetDate: today,
    },
    tradeResults: {},
  };
}

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function validate(data: unknown): data is PersistedRiskState {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (d.version !== 1) return false;
  if (typeof d.savedAt !== "number") return false;
  if (!d.circuitBreakers || typeof d.circuitBreakers !== "object") return false;
  if (!d.drawdown || typeof d.drawdown !== "object") return false;
  const dd = d.drawdown as Record<string, unknown>;
  if (typeof dd.highWaterMark !== "number") return false;
  if (typeof dd.currentEquity !== "number") return false;
  if (typeof dd.currentDrawdown !== "number") return false;
  return true;
}

export function loadRiskState(): PersistedRiskState {
  try {
    if (!existsSync(STATE_FILE)) {
      console.log("[risk-state] No state file found, using conservative defaults");
      return conservativeDefaults();
    }
    const raw = readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!validate(parsed)) {
      console.warn("[risk-state] State file validation failed, using conservative defaults");
      return conservativeDefaults();
    }
    const age = Date.now() - parsed.savedAt;
    console.log(`[risk-state] Loaded state from ${STATE_FILE} (${(age / 1000).toFixed(0)}s old)`);
    return parsed;
  } catch (err) {
    console.warn(`[risk-state] Failed to load state file: ${err instanceof Error ? err.message : err}`);
    console.warn("[risk-state] Using conservative defaults (not permissive)");
    return conservativeDefaults();
  }
}

export function saveRiskState(state: PersistedRiskState): void {
  try {
    ensureDataDir();
    state.savedAt = Date.now();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error(`[risk-state] Failed to save state: ${err instanceof Error ? err.message : err}`);
  }
}

// Convert a Map<string, BreakerState> to a plain object for serialization
export function breakersToRecord(
  breakers: Map<string, BreakerState>
): Record<string, BreakerState> {
  const record: Record<string, BreakerState> = {};
  for (const [key, value] of breakers) {
    record[key] = value;
  }
  return record;
}

// Restore a Map from a serialized record
export function recordToBreakers(
  record: Record<string, BreakerState>
): Map<string, BreakerState> {
  const map = new Map<string, BreakerState>();
  for (const [key, value] of Object.entries(record)) {
    map.set(key, value);
  }
  return map;
}
