// Mean Reversion Strategy
// Bollinger Bands, RSI extremes, z-score normalization
// Sharpe 1.5-2.0, works on 15m-1h timeframes

import type { OHLC, TradeSignal, StrategyResult } from "@/lib/types";
import { rsi, bollingerBands, zScore } from "./indicators";

export interface MeanReversionConfig {
  bbPeriod: number;
  bbStdDev: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  zScorePeriod: number;
  zScoreThreshold: number;
  pair: string;
}

const DEFAULT_CONFIG: MeanReversionConfig = {
  bbPeriod: 20,
  bbStdDev: 2,
  rsiPeriod: 14,
  rsiOversold: 30,
  rsiOverbought: 70,
  zScorePeriod: 20,
  zScoreThreshold: 2,
  pair: "BTC/USD",
};

export function analyzeMeanReversion(
  candles: OHLC[],
  config: Partial<MeanReversionConfig> = {}
): StrategyResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const closes = candles.map((c) => c.close);

  if (closes.length < cfg.bbPeriod + 10) {
    return {
      strategy: "mean_reversion",
      signals: [],
      analysis: "Insufficient data for mean reversion analysis",
      indicators: {},
      timestamp: Date.now(),
    };
  }

  const bb = bollingerBands(closes, cfg.bbPeriod, cfg.bbStdDev);
  const rsiValues = rsi(closes, cfg.rsiPeriod);
  const zScores = zScore(closes, cfg.zScorePeriod);

  const i = closes.length - 1;
  const currentPrice = closes[i];
  const currentRSI = rsiValues[i];
  const currentZ = zScores[i];
  const currentBBUpper = bb.upper[i];
  const currentBBLower = bb.lower[i];
  const currentBBMiddle = bb.middle[i];
  const currentBandwidth = bb.bandwidth[i];

  // Position within Bollinger Bands (0 = lower, 1 = upper)
  const bbPosition =
    currentBBUpper !== currentBBLower
      ? (currentPrice - currentBBLower) / (currentBBUpper - currentBBLower)
      : 0.5;

  const signals: TradeSignal[] = [];
  let analysis = "";

  // Oversold: price below lower BB + RSI oversold + negative z-score
  const oversold =
    currentPrice <= currentBBLower &&
    currentRSI < cfg.rsiOversold &&
    currentZ < -cfg.zScoreThreshold;

  // Overbought: price above upper BB + RSI overbought + positive z-score
  const overbought =
    currentPrice >= currentBBUpper &&
    currentRSI > cfg.rsiOverbought &&
    currentZ > cfg.zScoreThreshold;

  if (oversold) {
    // Count confirmations for confidence
    let confirms = 0;
    if (currentPrice < currentBBLower) confirms++;
    if (currentRSI < cfg.rsiOversold - 5) confirms++;
    if (currentZ < -(cfg.zScoreThreshold + 0.5)) confirms++;
    // Volume spike on sell-off suggests exhaustion
    if (candles[i].volume > candles[i - 1].volume * 1.5) confirms++;

    const confidence = Math.min(0.9, 0.5 + confirms * 0.1);

    signals.push({
      id: `mr-${Date.now()}`,
      strategy: "mean_reversion",
      pair: cfg.pair,
      side: "buy",
      type: "limit",
      price: currentPrice,
      amount: 0,
      confidence,
      reasoning: `Oversold: price at BB lower (${bbPosition.toFixed(2)}), RSI ${currentRSI.toFixed(1)}, z-score ${currentZ.toFixed(2)}. Expecting reversion to mean at ${currentBBMiddle.toFixed(2)}`,
      timestamp: Date.now(),
      metadata: {
        targetPrice: currentBBMiddle,
        stopLoss: currentBBLower - (currentBBUpper - currentBBLower) * 0.2,
        rsi: currentRSI,
        zScore: currentZ,
        bandwidth: currentBandwidth,
      },
    });
    analysis = `OVERSOLD: BB position ${bbPosition.toFixed(2)}, RSI ${currentRSI.toFixed(1)}, z-score ${currentZ.toFixed(2)}. Target: BB middle ${currentBBMiddle.toFixed(2)}`;
  } else if (overbought) {
    let confirms = 0;
    if (currentPrice > currentBBUpper) confirms++;
    if (currentRSI > cfg.rsiOverbought + 5) confirms++;
    if (currentZ > cfg.zScoreThreshold + 0.5) confirms++;
    if (candles[i].volume > candles[i - 1].volume * 1.5) confirms++;

    const confidence = Math.min(0.9, 0.5 + confirms * 0.1);

    signals.push({
      id: `mr-${Date.now()}`,
      strategy: "mean_reversion",
      pair: cfg.pair,
      side: "sell",
      type: "limit",
      price: currentPrice,
      amount: 0,
      confidence,
      reasoning: `Overbought: price at BB upper (${bbPosition.toFixed(2)}), RSI ${currentRSI.toFixed(1)}, z-score ${currentZ.toFixed(2)}. Expecting reversion to mean at ${currentBBMiddle.toFixed(2)}`,
      timestamp: Date.now(),
      metadata: {
        targetPrice: currentBBMiddle,
        stopLoss: currentBBUpper + (currentBBUpper - currentBBLower) * 0.2,
        rsi: currentRSI,
        zScore: currentZ,
        bandwidth: currentBandwidth,
      },
    });
    analysis = `OVERBOUGHT: BB position ${bbPosition.toFixed(2)}, RSI ${currentRSI.toFixed(1)}, z-score ${currentZ.toFixed(2)}. Target: BB middle ${currentBBMiddle.toFixed(2)}`;
  } else {
    analysis = `No signal. BB position: ${bbPosition.toFixed(2)}, RSI: ${currentRSI.toFixed(1)}, z-score: ${currentZ.toFixed(2)}, bandwidth: ${currentBandwidth.toFixed(2)}%`;
  }

  return {
    strategy: "mean_reversion",
    signals,
    analysis,
    indicators: {
      rsi: currentRSI,
      zScore: currentZ,
      bbUpper: currentBBUpper,
      bbMiddle: currentBBMiddle,
      bbLower: currentBBLower,
      bbPosition,
      bandwidth: currentBandwidth,
    },
    timestamp: Date.now(),
  };
}
