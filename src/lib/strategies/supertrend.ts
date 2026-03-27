// SuperTrend Strategy - Multi-Timeframe
// Dual SuperTrend (fast/slow) + EMA confirmation + ADX filter + Volume
// TradingView-grade: most popular overlay indicator, combined with multi-TF confirmation
// Best on 1h-4h, excellent for trend entries and trailing stops

import type { OHLC, TradeSignal, StrategyResult } from "@/lib/types";
import {
  superTrend, ema, adx, atr, rsi, macd, obv, vwap,
  resampleCandles,
} from "./indicators";

export interface SuperTrendConfig {
  fastPeriod: number;
  fastMultiplier: number;
  slowPeriod: number;
  slowMultiplier: number;
  pair: string;
}

const DEFAULT_CONFIG: SuperTrendConfig = {
  fastPeriod: 10,
  fastMultiplier: 2,
  slowPeriod: 10,
  slowMultiplier: 3,
  pair: "BTC/USD",
};

export function analyzeSuperTrend(
  candles: OHLC[],
  config: Partial<SuperTrendConfig> = {}
): StrategyResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const closes = candles.map(c => c.close);

  if (closes.length < 60) {
    return {
      strategy: "supertrend",
      signals: [],
      analysis: "Insufficient data for SuperTrend analysis (need 60+ candles)",
      indicators: {},
      timestamp: Date.now(),
    };
  }

  // --- Dual SuperTrend (fast for entries, slow for trend direction) ---
  const stFast = superTrend(candles, cfg.fastPeriod, cfg.fastMultiplier);
  const stSlow = superTrend(candles, cfg.slowPeriod, cfg.slowMultiplier);

  // Higher timeframe SuperTrend (4x for multi-TF)
  const htfCandles = resampleCandles(candles, 4);
  const htfST = htfCandles.length >= 20 ? superTrend(htfCandles, 10, 3) : null;

  // Supporting indicators
  const adxResult = adx(candles, 14);
  const atrValues = atr(candles, 14);
  const rsiValues = rsi(closes, 14);
  const macdResult = macd(closes);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const obvValues = obv(candles);
  const obvEma = ema(obvValues, 20);

  const i = closes.length - 1;
  const currentPrice = closes[i];
  const currentATR = atrValues[i];
  const currentADX = adxResult.adx[i] ?? 0;
  const currentRSI = rsiValues[i] ?? 50;

  // --- Confluence scoring ---
  let bullScore = 0;
  let bearScore = 0;
  const reasons: string[] = [];

  // 1. Fast SuperTrend direction
  if (stFast.direction[i] === 1) { bullScore += 1; reasons.push("Fast ST bullish"); }
  if (stFast.direction[i] === -1) { bearScore += 1; reasons.push("Fast ST bearish"); }

  // Fast ST flip (entry trigger)
  if (i > 0 && stFast.direction[i] !== stFast.direction[i - 1]) {
    if (stFast.direction[i] === 1) { bullScore += 1; reasons.push("Fast ST FLIP UP"); }
    if (stFast.direction[i] === -1) { bearScore += 1; reasons.push("Fast ST FLIP DOWN"); }
  }

  // 2. Slow SuperTrend direction (trend confirmation)
  if (stSlow.direction[i] === 1) { bullScore += 1; reasons.push("Slow ST bullish"); }
  if (stSlow.direction[i] === -1) { bearScore += 1; reasons.push("Slow ST bearish"); }

  // Both SuperTrends aligned = strong
  if (stFast.direction[i] === 1 && stSlow.direction[i] === 1) {
    bullScore += 0.5; reasons.push("Dual ST aligned bull");
  }
  if (stFast.direction[i] === -1 && stSlow.direction[i] === -1) {
    bearScore += 0.5; reasons.push("Dual ST aligned bear");
  }

  // 3. Higher timeframe alignment
  if (htfST) {
    const htfI = htfST.direction.length - 1;
    if (htfST.direction[htfI] === 1) { bullScore += 1; reasons.push("HTF ST bullish"); }
    if (htfST.direction[htfI] === -1) { bearScore += 1; reasons.push("HTF ST bearish"); }
  }

  // 4. EMA trend alignment
  if (ema20[i] > ema50[i] && currentPrice > ema20[i]) { bullScore += 0.5; reasons.push("EMA alignment bull"); }
  if (ema20[i] < ema50[i] && currentPrice < ema20[i]) { bearScore += 0.5; reasons.push("EMA alignment bear"); }

  // 5. ADX trend strength
  if (!isNaN(currentADX) && currentADX > 20) {
    const diPlus = adxResult.plusDI[i] ?? 0;
    const diMinus = adxResult.minusDI[i] ?? 0;
    if (diPlus > diMinus) { bullScore += 0.5; reasons.push(`ADX ${currentADX.toFixed(0)}`); }
    if (diMinus > diPlus) { bearScore += 0.5; reasons.push(`ADX ${currentADX.toFixed(0)}`); }
  }

  // 6. MACD confirmation
  if (macdResult.histogram[i] > 0) { bullScore += 0.5; }
  if (macdResult.histogram[i] < 0) { bearScore += 0.5; }

  // 7. OBV momentum
  if (obvValues[i] > obvEma[i]) { bullScore += 0.5; reasons.push("OBV rising"); }
  if (obvValues[i] < obvEma[i]) { bearScore += 0.5; reasons.push("OBV falling"); }

  // RSI filter
  const rsiBullOk = currentRSI < 78;
  const rsiBearOk = currentRSI > 22;

  // --- Signal generation ---
  const signals: TradeSignal[] = [];
  let analysis = "";
  const minConfluence = 3;

  if (bullScore >= minConfluence && rsiBullOk && bullScore > bearScore) {
    const confidence = Math.min(0.93, 0.38 + bullScore * 0.07);
    // Use fast SuperTrend as trailing stop level
    const stopLoss = stFast.superTrend[i];
    const takeProfit = currentPrice + currentATR * 4;

    signals.push({
      id: `st-${Date.now()}`,
      strategy: "supertrend",
      pair: cfg.pair,
      side: "buy",
      type: "market",
      price: currentPrice,
      amount: 0,
      confidence,
      reasoning: `SuperTrend bullish (${bullScore.toFixed(1)}/7): ${reasons.filter(r => !r.includes("bear")).join(", ")}`,
      timestamp: Date.now(),
      metadata: {
        stopLoss,
        takeProfit,
        fastSTLevel: stFast.superTrend[i],
        slowSTLevel: stSlow.superTrend[i],
        fastSTDir: stFast.direction[i],
        slowSTDir: stSlow.direction[i],
        adx: currentADX,
        rsi: currentRSI,
        confluenceScore: bullScore,
      },
    });
    analysis = `SUPERTREND BULLISH (${bullScore.toFixed(1)}/7). Fast: ${stFast.direction[i] === 1 ? "UP" : "DOWN"}, Slow: ${stSlow.direction[i] === 1 ? "UP" : "DOWN"}, ADX: ${currentADX.toFixed(0)}, RSI: ${currentRSI.toFixed(0)}. Trail stop: ${stopLoss.toFixed(0)}`;
  } else if (bearScore >= minConfluence && rsiBearOk && bearScore > bullScore) {
    const confidence = Math.min(0.93, 0.38 + bearScore * 0.07);
    const stopLoss = stFast.superTrend[i];
    const takeProfit = currentPrice - currentATR * 4;

    signals.push({
      id: `st-${Date.now()}`,
      strategy: "supertrend",
      pair: cfg.pair,
      side: "sell",
      type: "market",
      price: currentPrice,
      amount: 0,
      confidence,
      reasoning: `SuperTrend bearish (${bearScore.toFixed(1)}/7): ${reasons.filter(r => !r.includes("bull")).join(", ")}`,
      timestamp: Date.now(),
      metadata: {
        stopLoss,
        takeProfit,
        fastSTLevel: stFast.superTrend[i],
        slowSTLevel: stSlow.superTrend[i],
        fastSTDir: stFast.direction[i],
        slowSTDir: stSlow.direction[i],
        adx: currentADX,
        rsi: currentRSI,
        confluenceScore: bearScore,
      },
    });
    analysis = `SUPERTREND BEARISH (${bearScore.toFixed(1)}/7). Fast: ${stFast.direction[i] === 1 ? "UP" : "DOWN"}, Slow: ${stSlow.direction[i] === 1 ? "UP" : "DOWN"}, ADX: ${currentADX.toFixed(0)}, RSI: ${currentRSI.toFixed(0)}. Trail stop: ${stopLoss.toFixed(0)}`;
  } else {
    const fastDir = stFast.direction[i] === 1 ? "UP" : "DOWN";
    const slowDir = stSlow.direction[i] === 1 ? "UP" : "DOWN";
    analysis = `No signal (bull: ${bullScore.toFixed(1)}, bear: ${bearScore.toFixed(1)}, need ${minConfluence}). Fast ST: ${fastDir}, Slow ST: ${slowDir}, ADX: ${currentADX.toFixed(0)}, RSI: ${currentRSI.toFixed(0)}`;
  }

  return {
    strategy: "supertrend",
    signals,
    analysis,
    indicators: {
      fastST: stFast.superTrend[i],
      fastSTDir: stFast.direction[i],
      slowST: stSlow.superTrend[i],
      slowSTDir: stSlow.direction[i],
      adx: currentADX,
      rsi: currentRSI,
      macdHistogram: macdResult.histogram[i],
      ema20: ema20[i],
      ema50: ema50[i],
      confluenceBull: bullScore,
      confluenceBear: bearScore,
    },
    timestamp: Date.now(),
  };
}
