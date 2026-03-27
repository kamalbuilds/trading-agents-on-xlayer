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

export function getRiskLimits(): RiskLimits {
  return {
    maxPositionSize: safeFloat(process.env.MAX_POSITION_SIZE, 5),      // 5% per position
    maxDrawdown: safeFloat(process.env.MAX_DRAWDOWN, 15),              // 15% max drawdown
    maxDailyLoss: safeFloat(process.env.MAX_DAILY_LOSS, 3),            // 3% max daily loss
    maxOpenPositions: safeInt(process.env.MAX_OPEN_POSITIONS, 5),
    maxLeverage: safeFloat(process.env.MAX_LEVERAGE, 1),               // no leverage by default
    stopLossPercent: safeFloat(process.env.STOP_LOSS_PERCENT, 2),
    takeProfitPercent: safeFloat(process.env.TAKE_PROFIT_PERCENT, 4),
    maxCorrelation: safeFloat(process.env.MAX_CORRELATION, 0.7),
    cooldownAfterLoss: safeFloat(process.env.COOLDOWN_AFTER_LOSS, 300), // 5 minutes
  };
}

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
  evolved_trend: 0.25,
  funding_rate_arb: 0.15,
  trend_following: 0.15,
  mean_reversion: 0.12,
  momentum: 0.10,
  breakout: 0.08,
  ichimoku_cloud: 0.08,
  supertrend: 0.07,
};

// Auth
export const API_SECRET = process.env.API_SECRET ?? process.env.TRADING_API_KEY ?? "";
