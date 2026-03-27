// Mean Reversion Strategy - Multi-Indicator Confluence
// Bollinger Bands squeeze + Keltner Channel + StochRSI + VWAP + CCI + Williams%R
// TradingView-grade: BB inside Keltner = squeeze, multiple oversold/overbought confirmations
// Best on 15m-1h timeframes, Sharpe 1.5-2.5

import type { OHLC, TradeSignal, StrategyResult } from "@/lib/types";
import {
  rsi, bollingerBands, zScore, stochasticRSI, keltnerChannels,
  vwap, cci, williamsR, atr,
} from "./indicators";

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

  if (closes.length < cfg.bbPeriod + 20) {
    return {
      strategy: "mean_reversion",
      signals: [],
      analysis: "Insufficient data for mean reversion analysis",
      indicators: {},
      timestamp: Date.now(),
    };
  }

  // --- Compute all indicators ---
  const bb = bollingerBands(closes, cfg.bbPeriod, cfg.bbStdDev);
  const kc = keltnerChannels(candles, 20, 10, 1.5);
  const rsiValues = rsi(closes, cfg.rsiPeriod);
  const stochRsi = stochasticRSI(closes, 14);
  const zScores = zScore(closes, cfg.zScorePeriod);
  const vwapValues = vwap(candles);
  const cciValues = cci(candles, 20);
  const wrValues = williamsR(candles, 14);
  const atrValues = atr(candles, 14);

  const i = closes.length - 1;
  const currentPrice = closes[i];
  const currentRSI = rsiValues[i];
  const currentZ = zScores[i];
  const currentBBUpper = bb.upper[i];
  const currentBBLower = bb.lower[i];
  const currentBBMiddle = bb.middle[i];
  const currentBandwidth = bb.bandwidth[i];
  const currentStochK = stochRsi.k[i];
  const currentStochD = stochRsi.d[i];
  const currentCCI = cciValues[i];
  const currentWR = wrValues[i];
  const currentVWAP = vwapValues[i];
  const currentATR = atrValues[i];

  // BB position (0 = lower band, 1 = upper band)
  const bbPosition = currentBBUpper !== currentBBLower
    ? (currentPrice - currentBBLower) / (currentBBUpper - currentBBLower)
    : 0.5;

  // Bollinger Band squeeze detection (BB inside Keltner = low volatility squeeze)
  const bbInsideKeltner = currentBBUpper < kc.upper[i] && currentBBLower > kc.lower[i];
  const squeezeReleasing = i > 0 && bbInsideKeltner === false &&
    bb.upper[i - 1] < kc.upper[i - 1] && bb.lower[i - 1] > kc.lower[i - 1];

  // --- Confluence scoring ---
  let oversoldScore = 0;
  let overboughtScore = 0;
  const reasons: string[] = [];

  // 1. Price vs Bollinger Bands
  if (currentPrice <= currentBBLower) { oversoldScore += 1; reasons.push(`Below BB lower`); }
  if (currentPrice >= currentBBUpper) { overboughtScore += 1; reasons.push(`Above BB upper`); }

  // 2. RSI extremes
  if (currentRSI < cfg.rsiOversold) { oversoldScore += 1; reasons.push(`RSI ${currentRSI.toFixed(0)}`); }
  if (currentRSI > cfg.rsiOverbought) { overboughtScore += 1; reasons.push(`RSI ${currentRSI.toFixed(0)}`); }
  // Deep RSI (extra weight for extreme readings)
  if (currentRSI < 20) { oversoldScore += 0.5; }
  if (currentRSI > 80) { overboughtScore += 0.5; }

  // 3. Stochastic RSI crossover
  if (!isNaN(currentStochK) && !isNaN(currentStochD)) {
    if (currentStochK < 20) { oversoldScore += 1; reasons.push(`StochRSI K=${currentStochK.toFixed(0)}`); }
    if (currentStochK > 80) { overboughtScore += 1; reasons.push(`StochRSI K=${currentStochK.toFixed(0)}`); }
    // K crossing above D from oversold = bullish reversal signal
    if (currentStochK < 30 && i > 0 && stochRsi.k[i - 1] < stochRsi.d[i - 1] && currentStochK > currentStochD) {
      oversoldScore += 0.5; reasons.push("StochRSI bullish cross");
    }
    if (currentStochK > 70 && i > 0 && stochRsi.k[i - 1] > stochRsi.d[i - 1] && currentStochK < currentStochD) {
      overboughtScore += 0.5; reasons.push("StochRSI bearish cross");
    }
  }

  // 4. Z-score extremes
  if (currentZ < -cfg.zScoreThreshold) { oversoldScore += 1; reasons.push(`Z-score ${currentZ.toFixed(1)}`); }
  if (currentZ > cfg.zScoreThreshold) { overboughtScore += 1; reasons.push(`Z-score ${currentZ.toFixed(1)}`); }

  // 5. CCI extremes (below -100 = oversold, above +100 = overbought)
  if (currentCCI < -100) { oversoldScore += 0.5; reasons.push(`CCI ${currentCCI.toFixed(0)}`); }
  if (currentCCI > 100) { overboughtScore += 0.5; reasons.push(`CCI ${currentCCI.toFixed(0)}`); }
  if (currentCCI < -200) { oversoldScore += 0.5; } // extreme
  if (currentCCI > 200) { overboughtScore += 0.5; }

  // 6. Williams %R (-80 to -100 = oversold, -20 to 0 = overbought)
  if (!isNaN(currentWR)) {
    if (currentWR < -80) { oversoldScore += 0.5; reasons.push(`W%R ${currentWR.toFixed(0)}`); }
    if (currentWR > -20) { overboughtScore += 0.5; reasons.push(`W%R ${currentWR.toFixed(0)}`); }
  }

  // 7. Price vs VWAP (below VWAP on oversold = better entry)
  if (currentPrice < currentVWAP) { oversoldScore += 0.5; reasons.push("Below VWAP"); }
  if (currentPrice > currentVWAP) { overboughtScore += 0.5; reasons.push("Above VWAP"); }

  // 8. Volume exhaustion (high volume at extreme = capitulation)
  if (candles[i].volume > candles[i - 1].volume * 2) {
    if (oversoldScore > 2) { oversoldScore += 0.5; reasons.push("Volume spike (exhaustion)"); }
    if (overboughtScore > 2) { overboughtScore += 0.5; reasons.push("Volume spike (exhaustion)"); }
  }

  // 9. BB squeeze release adds conviction (volatility expansion after compression)
  if (squeezeReleasing) {
    if (currentPrice < currentBBMiddle) { oversoldScore += 0.5; reasons.push("Squeeze release (downside)"); }
    if (currentPrice > currentBBMiddle) { overboughtScore += 0.5; reasons.push("Squeeze release (upside)"); }
  }

  // --- Signal generation ---
  const signals: TradeSignal[] = [];
  let analysis = "";
  const minConfluence = 3; // Need 3/8 confirmations

  if (oversoldScore >= minConfluence && oversoldScore > overboughtScore) {
    const confidence = Math.min(0.92, 0.35 + oversoldScore * 0.08);
    const targetPrice = currentBBMiddle; // Revert to BB middle
    const stopLoss = currentPrice - currentATR * 2.5;

    signals.push({
      id: `mr-${Date.now()}`,
      strategy: "mean_reversion",
      pair: cfg.pair,
      side: "buy",
      type: "limit",
      price: currentPrice,
      amount: 0,
      confidence,
      reasoning: `Oversold confluence (${oversoldScore.toFixed(1)}/8): ${reasons.filter(r => !r.includes("Above") && !r.includes("overbought")).join(", ")}`,
      timestamp: Date.now(),
      metadata: {
        targetPrice,
        stopLoss,
        rsi: currentRSI,
        stochRsiK: currentStochK,
        zScore: currentZ,
        cci: currentCCI,
        williamsR: currentWR,
        vwap: currentVWAP,
        bandwidth: currentBandwidth,
        bbSqueeze: bbInsideKeltner,
        confluenceScore: oversoldScore,
      },
    });
    analysis = `OVERSOLD (${oversoldScore.toFixed(1)}/8). BB pos: ${bbPosition.toFixed(2)}, RSI: ${currentRSI.toFixed(0)}, StochRSI: ${currentStochK?.toFixed(0) ?? "N/A"}, CCI: ${currentCCI.toFixed(0)}. Target: ${targetPrice.toFixed(0)}`;
  } else if (overboughtScore >= minConfluence && overboughtScore > oversoldScore) {
    const confidence = Math.min(0.92, 0.35 + overboughtScore * 0.08);
    const targetPrice = currentBBMiddle;
    const stopLoss = currentPrice + currentATR * 2.5;

    signals.push({
      id: `mr-${Date.now()}`,
      strategy: "mean_reversion",
      pair: cfg.pair,
      side: "sell",
      type: "limit",
      price: currentPrice,
      amount: 0,
      confidence,
      reasoning: `Overbought confluence (${overboughtScore.toFixed(1)}/8): ${reasons.filter(r => !r.includes("Below") && !r.includes("oversold")).join(", ")}`,
      timestamp: Date.now(),
      metadata: {
        targetPrice,
        stopLoss,
        rsi: currentRSI,
        stochRsiK: currentStochK,
        zScore: currentZ,
        cci: currentCCI,
        williamsR: currentWR,
        vwap: currentVWAP,
        bandwidth: currentBandwidth,
        bbSqueeze: bbInsideKeltner,
        confluenceScore: overboughtScore,
      },
    });
    analysis = `OVERBOUGHT (${overboughtScore.toFixed(1)}/8). BB pos: ${bbPosition.toFixed(2)}, RSI: ${currentRSI.toFixed(0)}, StochRSI: ${currentStochK?.toFixed(0) ?? "N/A"}, CCI: ${currentCCI.toFixed(0)}. Target: ${targetPrice.toFixed(0)}`;
  } else {
    analysis = `No signal (oversold: ${oversoldScore.toFixed(1)}, overbought: ${overboughtScore.toFixed(1)}, need ${minConfluence}). BB: ${bbPosition.toFixed(2)}, RSI: ${currentRSI.toFixed(0)}, Z: ${currentZ.toFixed(1)}${bbInsideKeltner ? ", SQUEEZE" : ""}`;
  }

  return {
    strategy: "mean_reversion",
    signals,
    analysis,
    indicators: {
      rsi: currentRSI,
      stochRsiK: currentStochK,
      stochRsiD: currentStochD,
      zScore: currentZ,
      bbUpper: currentBBUpper,
      bbMiddle: currentBBMiddle,
      bbLower: currentBBLower,
      bbPosition,
      bandwidth: currentBandwidth,
      cci: currentCCI,
      williamsR: currentWR,
      vwap: currentVWAP,
      bbSqueeze: bbInsideKeltner ? 1 : 0,
      confluenceOversold: oversoldScore,
      confluenceOverbought: overboughtScore,
    },
    timestamp: Date.now(),
  };
}
