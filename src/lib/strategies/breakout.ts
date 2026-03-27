// Breakout Detection Strategy - Multi-Indicator Confluence
// S/R levels + SuperTrend + Volume Profile + ATR expansion + BB squeeze release
// TradingView-grade: false breakout filter using volume, ATR, and SuperTrend confirmation
// Best on 1h-4h timeframes

import type { OHLC, TradeSignal, StrategyResult } from "@/lib/types";
import {
  atr, ema, volumeProfile, superTrend, bollingerBands, keltnerChannels,
  rsi, adx, obv,
} from "./indicators";

export interface BreakoutConfig {
  lookbackPeriod: number;
  volumeMultiplier: number;
  atrMultiplier: number;
  confirmCandles: number;
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

function findSupportResistance(candles: OHLC[], lookback: number): { supports: number[]; resistances: number[] } {
  const recent = candles.slice(-lookback);
  const supports: number[] = [];
  const resistances: number[] = [];

  // 5-candle swing high/low detection
  for (let i = 2; i < recent.length - 2; i++) {
    const isSwingHigh = recent[i].high > recent[i - 1].high && recent[i].high > recent[i - 2].high &&
      recent[i].high > recent[i + 1].high && recent[i].high > recent[i + 2].high;
    const isSwingLow = recent[i].low < recent[i - 1].low && recent[i].low < recent[i - 2].low &&
      recent[i].low < recent[i + 1].low && recent[i].low < recent[i + 2].low;

    if (isSwingHigh) resistances.push(recent[i].high);
    if (isSwingLow) supports.push(recent[i].low);
  }

  // Cluster nearby levels (within 0.5%)
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
    // Most touched levels first
    return clusters.sort((a, b) => b.length - a.length).slice(0, 5)
      .map(c => c.reduce((a, b) => a + b, 0) / c.length);
  };

  return { supports: cluster(supports), resistances: cluster(resistances) };
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

  const closes = candles.map(c => c.close);

  // --- Compute all indicators ---
  const atrValues = atr(candles, 14);
  const ema20 = ema(closes, 20);
  const vp = volumeProfile(candles, cfg.lookbackPeriod);
  const st = superTrend(candles, 10, 3);
  const bb = bollingerBands(closes, 20, 2);
  const kc = keltnerChannels(candles, 20, 10, 1.5);
  const rsiValues = rsi(closes, 14);
  const adxResult = adx(candles, 14);
  const obvValues = obv(candles);
  const obvEma = ema(obvValues, 20);

  const { supports, resistances } = findSupportResistance(candles, cfg.lookbackPeriod);

  const i = candles.length - 1;
  const currentPrice = closes[i];
  const currentATR = atrValues[i];
  const currentVolume = candles[i].volume;
  const avgVolume = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
  const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
  const currentRSI = rsiValues[i] ?? 50;
  const currentADX = adxResult.adx[i] ?? 0;

  // BB squeeze detection (BB inside Keltner)
  const bbSqueeze = bb.upper[i] < kc.upper[i] && bb.lower[i] > kc.lower[i];
  const wasSqueezing = i > 0 && bb.upper[i - 1] < kc.upper[i - 1] && bb.lower[i - 1] > kc.lower[i - 1];
  const squeezeRelease = !bbSqueeze && wasSqueezing;

  // ATR expansion (current ATR vs 20-period average ATR)
  const atrAvg = atrValues.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const atrExpanding = currentATR > atrAvg * 1.2;

  const signals: TradeSignal[] = [];
  let analysis = "";

  // Find nearest S/R levels
  const nearestResistance = resistances.find(r => r > currentPrice - currentATR);
  const nearestSupport = supports.find(s => s < currentPrice + currentATR) ?? supports[supports.length - 1];

  // --- Resistance breakout detection ---
  if (nearestResistance && currentPrice > nearestResistance) {
    const breakoutMagnitude = (currentPrice - nearestResistance) / currentATR;
    let breakoutScore = 0;
    const reasons: string[] = [];

    // 1. Breakout magnitude (bigger = more legit)
    if (breakoutMagnitude > 0.5) { breakoutScore += 1; reasons.push(`Magnitude: ${breakoutMagnitude.toFixed(1)} ATR`); }
    if (breakoutMagnitude > cfg.atrMultiplier) { breakoutScore += 0.5; }

    // 2. Volume confirmation
    if (volumeRatio > cfg.volumeMultiplier) { breakoutScore += 1; reasons.push(`Volume: ${volumeRatio.toFixed(1)}x`); }
    if (volumeRatio > 3) { breakoutScore += 0.5; }

    // 3. SuperTrend alignment
    if (st.direction[i] === 1) { breakoutScore += 1; reasons.push("SuperTrend bullish"); }
    if (i > 0 && st.direction[i] === 1 && st.direction[i - 1] === -1) {
      breakoutScore += 0.5; reasons.push("SuperTrend FLIP");
    }

    // 4. Close confirmation (previous candles also above level)
    let confirmed = true;
    if (cfg.falseBreakoutFilter) {
      for (let j = 1; j <= Math.min(cfg.confirmCandles, 2); j++) {
        if (i - j >= 0 && closes[i - j] < nearestResistance) { confirmed = false; break; }
      }
    }
    if (confirmed) { breakoutScore += 1; reasons.push("Multi-candle confirmed"); }

    // 5. ADX rising (trend forming)
    if (!isNaN(currentADX) && currentADX > 20) { breakoutScore += 0.5; reasons.push(`ADX ${currentADX.toFixed(0)}`); }

    // 6. OBV confirming (accumulation)
    if (obvValues[i] > obvEma[i]) { breakoutScore += 0.5; reasons.push("OBV accumulation"); }

    // 7. BB squeeze release (breakout after compression)
    if (squeezeRelease) { breakoutScore += 1; reasons.push("Squeeze release"); }

    // 8. ATR expansion
    if (atrExpanding) { breakoutScore += 0.5; reasons.push("ATR expanding"); }

    // 9. Above Value Area High
    if (currentPrice > vp.valueAreaHigh) { breakoutScore += 0.5; reasons.push("Above VA high"); }

    const minScore = 3;
    if (breakoutScore >= minScore) {
      const confidence = Math.min(0.92, 0.35 + breakoutScore * 0.07);
      signals.push({
        id: `bo-${Date.now()}`,
        strategy: "breakout",
        pair: cfg.pair,
        side: "buy",
        type: "market",
        price: currentPrice,
        amount: 0,
        confidence,
        reasoning: `Resistance breakout (${breakoutScore.toFixed(1)}/8): ${reasons.join(", ")}`,
        timestamp: Date.now(),
        metadata: {
          breakoutLevel: nearestResistance,
          breakoutMagnitude,
          volumeRatio,
          confirmed,
          superTrendDir: st.direction[i],
          bbSqueeze: squeezeRelease,
          adx: currentADX,
          confluenceScore: breakoutScore,
          stopLoss: Math.max(nearestResistance - currentATR * 0.5, st.superTrend[i]),
          takeProfit: currentPrice + currentATR * 3,
        },
      });
      analysis = `RESISTANCE BREAKOUT at ${nearestResistance.toFixed(0)} (${breakoutScore.toFixed(1)}/8). Price: ${currentPrice.toFixed(0)}, vol: ${volumeRatio.toFixed(1)}x${squeezeRelease ? ", SQUEEZE RELEASE" : ""}`;
    }
  }

  // --- Support breakdown detection ---
  if (nearestSupport && currentPrice < nearestSupport && signals.length === 0) {
    const breakdownMagnitude = (nearestSupport - currentPrice) / currentATR;
    let breakdownScore = 0;
    const reasons: string[] = [];

    if (breakdownMagnitude > 0.5) { breakdownScore += 1; reasons.push(`Magnitude: ${breakdownMagnitude.toFixed(1)} ATR`); }
    if (breakdownMagnitude > cfg.atrMultiplier) { breakdownScore += 0.5; }
    if (volumeRatio > cfg.volumeMultiplier) { breakdownScore += 1; reasons.push(`Volume: ${volumeRatio.toFixed(1)}x`); }
    if (volumeRatio > 3) { breakdownScore += 0.5; }
    if (st.direction[i] === -1) { breakdownScore += 1; reasons.push("SuperTrend bearish"); }
    if (i > 0 && st.direction[i] === -1 && st.direction[i - 1] === 1) {
      breakdownScore += 0.5; reasons.push("SuperTrend FLIP");
    }

    let confirmed = true;
    if (cfg.falseBreakoutFilter) {
      for (let j = 1; j <= Math.min(cfg.confirmCandles, 2); j++) {
        if (i - j >= 0 && closes[i - j] > nearestSupport) { confirmed = false; break; }
      }
    }
    if (confirmed) { breakdownScore += 1; reasons.push("Multi-candle confirmed"); }
    if (!isNaN(currentADX) && currentADX > 20) { breakdownScore += 0.5; reasons.push(`ADX ${currentADX.toFixed(0)}`); }
    if (obvValues[i] < obvEma[i]) { breakdownScore += 0.5; reasons.push("OBV distribution"); }
    if (squeezeRelease) { breakdownScore += 1; reasons.push("Squeeze release"); }
    if (atrExpanding) { breakdownScore += 0.5; reasons.push("ATR expanding"); }
    if (currentPrice < vp.valueAreaLow) { breakdownScore += 0.5; reasons.push("Below VA low"); }

    const minScore = 3;
    if (breakdownScore >= minScore) {
      const confidence = Math.min(0.92, 0.35 + breakdownScore * 0.07);
      signals.push({
        id: `bo-${Date.now()}`,
        strategy: "breakout",
        pair: cfg.pair,
        side: "sell",
        type: "market",
        price: currentPrice,
        amount: 0,
        confidence,
        reasoning: `Support breakdown (${breakdownScore.toFixed(1)}/8): ${reasons.join(", ")}`,
        timestamp: Date.now(),
        metadata: {
          breakoutLevel: nearestSupport,
          breakoutMagnitude: breakdownMagnitude,
          volumeRatio,
          confirmed,
          superTrendDir: st.direction[i],
          bbSqueeze: squeezeRelease,
          adx: currentADX,
          confluenceScore: breakdownScore,
          stopLoss: Math.min(nearestSupport + currentATR * 0.5, st.superTrend[i]),
          takeProfit: currentPrice - currentATR * 3,
        },
      });
      analysis = `SUPPORT BREAKDOWN at ${nearestSupport.toFixed(0)} (${breakdownScore.toFixed(1)}/8). Price: ${currentPrice.toFixed(0)}, vol: ${volumeRatio.toFixed(1)}x`;
    }
  }

  if (signals.length === 0 && !analysis) {
    analysis = `No breakout. R: ${nearestResistance?.toFixed(0) ?? "N/A"}, S: ${nearestSupport?.toFixed(0) ?? "N/A"}. ATR: ${currentATR.toFixed(0)}, vol: ${volumeRatio.toFixed(1)}x${bbSqueeze ? ", SQUEEZING" : ""}${squeezeRelease ? ", SQUEEZE RELEASED" : ""}`;
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
      superTrendDir: st.direction[i],
      superTrendLevel: st.superTrend[i],
      bbSqueeze: bbSqueeze ? 1 : 0,
      squeezeRelease: squeezeRelease ? 1 : 0,
      adx: currentADX,
      rsi: currentRSI,
    },
    timestamp: Date.now(),
  };
}
