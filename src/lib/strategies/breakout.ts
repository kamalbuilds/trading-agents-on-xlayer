// Breakout Detection Strategy
// Support/resistance levels, volume spike confirmation, false breakout filters

import type { OHLC, TradeSignal, StrategyResult } from "@/lib/types";
import { atr, ema, volumeProfile } from "./indicators";

export interface BreakoutConfig {
  lookbackPeriod: number;   // Candles to find S/R levels
  volumeMultiplier: number; // Volume must exceed this x average
  atrMultiplier: number;    // Breakout must exceed this x ATR
  confirmCandles: number;   // Candles to confirm breakout
  falseBreakoutFilter: boolean;
  pair: string;
}

const DEFAULT_CONFIG: BreakoutConfig = {
  lookbackPeriod: 50,
  volumeMultiplier: 2.0,
  atrMultiplier: 1.5,
  confirmCandles: 2,
  falseBreakoutFilter: true,
  pair: "BTC/USD",
};

function findSupportResistance(
  candles: OHLC[],
  lookback: number
): { supports: number[]; resistances: number[] } {
  const recent = candles.slice(-lookback);
  const supports: number[] = [];
  const resistances: number[] = [];

  // Find swing highs and lows (using 5-candle window)
  for (let i = 2; i < recent.length - 2; i++) {
    const isSwingHigh =
      recent[i].high > recent[i - 1].high &&
      recent[i].high > recent[i - 2].high &&
      recent[i].high > recent[i + 1].high &&
      recent[i].high > recent[i + 2].high;
    const isSwingLow =
      recent[i].low < recent[i - 1].low &&
      recent[i].low < recent[i - 2].low &&
      recent[i].low < recent[i + 1].low &&
      recent[i].low < recent[i + 2].low;

    if (isSwingHigh) resistances.push(recent[i].high);
    if (isSwingLow) supports.push(recent[i].low);
  }

  // Cluster nearby levels (within 0.5% of each other)
  const cluster = (levels: number[]): number[] => {
    if (levels.length === 0) return [];
    const sorted = [...levels].sort((a, b) => a - b);
    const clusters: number[][] = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
      const lastCluster = clusters[clusters.length - 1];
      const lastAvg = lastCluster.reduce((a, b) => a + b, 0) / lastCluster.length;
      if (Math.abs(sorted[i] - lastAvg) / lastAvg < 0.005) {
        lastCluster.push(sorted[i]);
      } else {
        clusters.push([sorted[i]]);
      }
    }
    // Return average of each cluster, sorted by touch count (most touched first)
    return clusters
      .sort((a, b) => b.length - a.length)
      .slice(0, 5)
      .map((c) => c.reduce((a, b) => a + b, 0) / c.length);
  };

  return {
    supports: cluster(supports),
    resistances: cluster(resistances),
  };
}

export function analyzeBreakout(
  candles: OHLC[],
  config: Partial<BreakoutConfig> = {}
): StrategyResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (candles.length < cfg.lookbackPeriod + 10) {
    return {
      strategy: "breakout",
      signals: [],
      analysis: "Insufficient data for breakout analysis",
      indicators: {},
      timestamp: Date.now(),
    };
  }

  const closes = candles.map((c) => c.close);
  const atrValues = atr(candles, 14);
  const ema20 = ema(closes, 20);
  const vp = volumeProfile(candles, cfg.lookbackPeriod);

  const { supports, resistances } = findSupportResistance(candles, cfg.lookbackPeriod);

  const i = candles.length - 1;
  const currentPrice = closes[i];
  const currentATR = atrValues[i];
  const currentVolume = candles[i].volume;
  const avgVolume =
    candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
  const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

  const signals: TradeSignal[] = [];
  let analysis = "";

  // Check for resistance breakout
  const nearestResistance = resistances.find((r) => r > currentPrice - currentATR);
  const nearestSupport = supports.find(
    (s) => s < currentPrice + currentATR
  ) ?? supports[supports.length - 1];

  if (nearestResistance && currentPrice > nearestResistance) {
    const breakoutMagnitude = ((currentPrice - nearestResistance) / currentATR);
    const volumeConfirms = volumeRatio > cfg.volumeMultiplier;
    const aboveValue = currentPrice > vp.valueAreaHigh;

    // False breakout filter: check if previous candles also closed above
    let confirmed = true;
    if (cfg.falseBreakoutFilter) {
      for (let j = 1; j <= Math.min(cfg.confirmCandles, 2); j++) {
        if (i - j >= 0 && closes[i - j] < nearestResistance) {
          confirmed = false;
          break;
        }
      }
    }

    if (
      breakoutMagnitude > cfg.atrMultiplier * 0.5 &&
      volumeConfirms &&
      (confirmed || breakoutMagnitude > cfg.atrMultiplier)
    ) {
      let confidence = 0.5;
      if (breakoutMagnitude > cfg.atrMultiplier) confidence += 0.1;
      if (volumeRatio > 3) confidence += 0.1;
      if (confirmed) confidence += 0.1;
      if (aboveValue) confidence += 0.05;
      confidence = Math.min(0.9, confidence);

      signals.push({
        id: `bo-${Date.now()}`,
        strategy: "breakout",
        pair: cfg.pair,
        side: "buy",
        type: "market",
        amount: 0,
        confidence,
        reasoning: `Resistance breakout at ${nearestResistance.toFixed(2)}. Magnitude: ${breakoutMagnitude.toFixed(2)} ATR, volume: ${volumeRatio.toFixed(1)}x avg${confirmed ? ", confirmed" : ", unconfirmed"}`,
        timestamp: Date.now(),
        metadata: {
          breakoutLevel: nearestResistance,
          breakoutMagnitude,
          volumeRatio,
          confirmed,
          stopLoss: nearestResistance - currentATR * 0.5,
          takeProfit: currentPrice + currentATR * 3,
        },
      });
      analysis = `RESISTANCE BREAKOUT at ${nearestResistance.toFixed(2)}. Price: ${currentPrice.toFixed(2)}, vol: ${volumeRatio.toFixed(1)}x`;
    }
  }

  // Check for support breakdown
  if (nearestSupport && currentPrice < nearestSupport && signals.length === 0) {
    const breakdownMagnitude = ((nearestSupport - currentPrice) / currentATR);
    const volumeConfirms = volumeRatio > cfg.volumeMultiplier;

    let confirmed = true;
    if (cfg.falseBreakoutFilter) {
      for (let j = 1; j <= Math.min(cfg.confirmCandles, 2); j++) {
        if (i - j >= 0 && closes[i - j] > nearestSupport) {
          confirmed = false;
          break;
        }
      }
    }

    if (
      breakdownMagnitude > cfg.atrMultiplier * 0.5 &&
      volumeConfirms &&
      (confirmed || breakdownMagnitude > cfg.atrMultiplier)
    ) {
      let confidence = 0.5;
      if (breakdownMagnitude > cfg.atrMultiplier) confidence += 0.1;
      if (volumeRatio > 3) confidence += 0.1;
      if (confirmed) confidence += 0.1;
      confidence = Math.min(0.9, confidence);

      signals.push({
        id: `bo-${Date.now()}`,
        strategy: "breakout",
        pair: cfg.pair,
        side: "sell",
        type: "market",
        amount: 0,
        confidence,
        reasoning: `Support breakdown at ${nearestSupport.toFixed(2)}. Magnitude: ${breakdownMagnitude.toFixed(2)} ATR, volume: ${volumeRatio.toFixed(1)}x avg`,
        timestamp: Date.now(),
        metadata: {
          breakoutLevel: nearestSupport,
          breakoutMagnitude: breakdownMagnitude,
          volumeRatio,
          confirmed,
          stopLoss: nearestSupport + currentATR * 0.5,
          takeProfit: currentPrice - currentATR * 3,
        },
      });
      analysis = `SUPPORT BREAKDOWN at ${nearestSupport.toFixed(2)}. Price: ${currentPrice.toFixed(2)}, vol: ${volumeRatio.toFixed(1)}x`;
    }
  }

  if (signals.length === 0) {
    analysis = `No breakout. Nearest R: ${nearestResistance?.toFixed(2) ?? "N/A"}, S: ${nearestSupport?.toFixed(2) ?? "N/A"}. Price: ${currentPrice.toFixed(2)}, ATR: ${currentATR.toFixed(2)}`;
  }

  return {
    strategy: "breakout",
    signals,
    analysis,
    indicators: {
      nearestResistance: nearestResistance ?? 0,
      nearestSupport: nearestSupport ?? 0,
      atr: currentATR,
      volumeRatio,
      ema20: ema20[i],
      poc: vp.poc,
      valueAreaHigh: vp.valueAreaHigh,
      valueAreaLow: vp.valueAreaLow,
      supportCount: supports.length,
      resistanceCount: resistances.length,
    },
    timestamp: Date.now(),
  };
}
