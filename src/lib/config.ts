// Single source of truth for all system configuration
// Every module imports from here instead of defining its own defaults

import type { RiskLimits, StrategyConfig } from "@/lib/types";

// Risk limits: env vars override these defaults
function safeFloat(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const parsed = parseFloat(val);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeInt(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// HARDCODED DEFAULTS (lowest priority)
const RISK_DEFAULTS: RiskLimits = {
  maxPositionSize: 5,        // 5% per position
  maxDrawdown: 15,           // 15% max drawdown
  maxDailyLoss: 3,           // 3% max daily loss
  maxOpenPositions: 5,
  maxLeverage: 1,            // no leverage by default
  stopLossPercent: 2,
  takeProfitPercent: 4,
  maxCorrelation: 0.7,
  cooldownAfterLoss: 300,    // 5 minutes
};

// ENV VAR MAPPING: env var name -> RiskLimits key
const ENV_OVERRIDES: Record<string, keyof RiskLimits> = {
  MAX_POSITION_SIZE: "maxPositionSize",
  MAX_DRAWDOWN: "maxDrawdown",
  MAX_DAILY_LOSS: "maxDailyLoss",
  MAX_OPEN_POSITIONS: "maxOpenPositions",
  MAX_LEVERAGE: "maxLeverage",
  STOP_LOSS_PERCENT: "stopLossPercent",
  TAKE_PROFIT_PERCENT: "takeProfitPercent",
  MAX_CORRELATION: "maxCorrelation",
  COOLDOWN_AFTER_LOSS: "cooldownAfterLoss",
};

// Single source of truth for risk limits.
// Hierarchy: env vars override defaults. All consumers MUST use this function.
let _logged = false;
export function getRiskLimits(): RiskLimits {
  const limits: RiskLimits = { ...RISK_DEFAULTS };
  const overrides: string[] = [];

  for (const [envKey, limitKey] of Object.entries(ENV_OVERRIDES)) {
    const val = process.env[envKey];
    if (val !== undefined && val !== "") {
      const isInt = limitKey === "maxOpenPositions";
      const parsed = isInt ? parseInt(val, 10) : parseFloat(val);
      if (!Number.isFinite(parsed)) {
        throw new Error(
          `FATAL: Risk config env var "${envKey}" has invalid value "${val}" (parsed as NaN). ` +
          `Fix the value or remove it to use the default (${RISK_DEFAULTS[limitKey]}).`
        );
      }
      (limits as unknown as Record<string, number>)[limitKey] = parsed;
      overrides.push(`${limitKey}=${parsed} (from ${envKey})`);
    }
  }

  // Log active limits once at startup for auditability
  if (!_logged) {
    _logged = true;
    console.log("[risk-limits] Active risk limits (single source of truth):");
    for (const [key, value] of Object.entries(limits)) {
      const source = overrides.find((o) => o.startsWith(key)) ? "ENV" : "DEFAULT";
      console.log(`  ${key}: ${value} [${source}]`);
    }
    if (overrides.length > 0) {
      console.log(`[risk-limits] ${overrides.length} env var override(s) applied`);
    }
  }

  return limits;
}

// Validate risk config eagerly on module load.
// If any risk-critical env var is set to a non-numeric value, the process
// crashes immediately rather than silently disabling risk checks at runtime.
getRiskLimits();

export const INITIAL_BALANCE = safeFloat(process.env.INITIAL_BALANCE, 10_000);

export const DEFAULT_STRATEGIES: StrategyConfig[] = [
  {
    name: "Trend Following",
    type: "trend_following",
    pairs: ["BTC/USD"],
    timeframe: "1h",
    allocation: 25,
    enabled: true,
    params: { lookback: 20, threshold: 0.02 },
  },
  {
    name: "Mean Reversion",
    type: "mean_reversion",
    pairs: ["BTC/USD", "ETH/USD"],
    timeframe: "15m",
    allocation: 20,
    enabled: true,
    params: { zScoreThreshold: 2, lookback: 50 },
  },
  {
    name: "Momentum",
    type: "momentum",
    pairs: ["BTC/USD"],
    timeframe: "4h",
    allocation: 15,
    enabled: true,
    params: { period: 14, overbought: 70, oversold: 30 },
  },
  {
    name: "Breakout",
    type: "breakout",
    pairs: ["BTC/USD", "ETH/USD"],
    timeframe: "1h",
    allocation: 10,
    enabled: true,
    params: { lookback: 20, breakoutThreshold: 0.015 },
  },
  {
    name: "Funding Rate Arbitrage",
    type: "funding_rate_arb",
    pairs: ["BTC/USD"],
    timeframe: "8h",
    allocation: 30,
    enabled: true,
    params: { minFundingRate: 0.0001, lookback: 7 },
  },
];

// Strategy weights for ensemble (must match strategy types above)
export const ENSEMBLE_WEIGHTS: Record<string, number> = {
  evolved_trend: 0.22,
  smart_money: 0.12,
  funding_rate_arb: 0.13,
  trend_following: 0.13,
  mean_reversion: 0.10,
  momentum: 0.09,
  breakout: 0.07,
  ichimoku_cloud: 0.07,
  supertrend: 0.07,
};

// Regime detection thresholds (Tier 1 - technical only)
export const REGIME_THRESHOLDS = {
  adxTrend: 25,           // ADX above this = trending
  adxRange: 20,           // ADX below this = ranging
  bbBandwidthRange: 4,    // BB bandwidth below this % = ranging
  atrHighVolMultiplier: 2, // ATR > 2x median = high volatility
};

// Auth
export const API_SECRET = process.env.API_SECRET ?? process.env.TRADING_API_KEY ?? "";
