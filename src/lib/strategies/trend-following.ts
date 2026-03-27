// Trend Following Strategy - Multi-Indicator Confluence
// SuperTrend + EMA ribbon + ADX/DI + MACD + Ichimoku cloud alignment
// TradingView-grade: 5 independent confirmations required for high-confidence signals
// Best on 4h/1d timeframes

import type { OHLC, TradeSignal, StrategyResult } from "@/lib/types";
import {
  ema, adx, atr, macd, superTrend, ichimoku, rsi,
  resampleCandles,
} from "./indicators";

export interface TrendFollowingConfig {
  fastEMA: number;
  mediumEMA: number;
  slowEMA: number;
  adxThreshold: number;
  atrMultiplierStop: number;
  atrMultiplierTP: number;
  superTrendPeriod: number;
  superTrendMultiplier: number;
  pair: string;
}

const DEFAULT_CONFIG: TrendFollowingConfig = {
  fastEMA: 9,
  mediumEMA: 21,
  slowEMA: 50,
  adxThreshold: 20,
  atrMultiplierStop: 2,
  atrMultiplierTP: 4,
  superTrendPeriod: 10,
  superTrendMultiplier: 3,
  pair: "BTC/USD",
};

export function analyzeTrendFollowing(
  candles: OHLC[],
  config: Partial<TrendFollowingConfig> = {}
): StrategyResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const closes = candles.map((c) => c.close);

  if (closes.length < 60) {
    return {
      strategy: "trend_following",
      signals: [],
      analysis: "Insufficient data for trend following analysis (need 60+ candles)",
      indicators: {},
      timestamp: Date.now(),
    };
  }

  // --- Compute all indicators ---
  const fastLine = ema(closes, cfg.fastEMA);
  const mediumLine = ema(closes, cfg.mediumEMA);
  const slowLine = ema(closes, cfg.slowEMA);
  const ema200 = ema(closes, 200 > closes.length ? closes.length - 1 : 200);
  const adxResult = adx(candles, 14);
  const atrValues = atr(candles, 14);
  const macdResult = macd(closes);
  const rsiValues = rsi(closes, 14);
  const st = superTrend(candles, cfg.superTrendPeriod, cfg.superTrendMultiplier);
  const ichi = ichimoku(candles);

  // Higher timeframe confirmation (4x resample for multi-TF)
  const htfCandles = resampleCandles(candles, 4);
  const htfST = htfCandles.length >= 20 ? superTrend(htfCandles, 10, 3) : null;

  const i = closes.length - 1;
  const currentPrice = closes[i];
  const currentATR = atrValues[i];
  const currentADX = adxResult.adx[i] ?? 0;
  const plusDI = adxResult.plusDI[i] ?? 0;
  const minusDI = adxResult.minusDI[i] ?? 0;
  const currentRSI = rsiValues[i] ?? 50;
  const macdHist = macdResult.histogram[i];
  const macdLine = macdResult.macd[i];
  const macdSignalLine = macdResult.signal[i];

  // --- Confluence scoring (each confirmation adds weight) ---
  let bullScore = 0;
  let bearScore = 0;
  const reasons: string[] = [];

  // 1. EMA ribbon alignment (fast > medium > slow = bullish)
  const emaRibbonBull = fastLine[i] > mediumLine[i] && mediumLine[i] > slowLine[i];
  const emaRibbonBear = fastLine[i] < mediumLine[i] && mediumLine[i] < slowLine[i];
  const emaCross = fastLine[i - 1] <= mediumLine[i - 1] && fastLine[i] > mediumLine[i];
  const emaCrossBear = fastLine[i - 1] >= mediumLine[i - 1] && fastLine[i] < mediumLine[i];

  if (emaRibbonBull) { bullScore += 1; reasons.push("EMA ribbon bullish"); }
  if (emaRibbonBear) { bearScore += 1; reasons.push("EMA ribbon bearish"); }
  if (emaCross) { bullScore += 0.5; reasons.push("Fresh EMA crossover"); }
  if (emaCrossBear) { bearScore += 0.5; reasons.push("Fresh bearish EMA crossover"); }

  // 2. ADX trend strength + DI direction
  const strongTrend = !isNaN(currentADX) && currentADX > cfg.adxThreshold;
  if (strongTrend && plusDI > minusDI) { bullScore += 1; reasons.push(`ADX ${currentADX.toFixed(0)} +DI>${"-"}DI`); }
  if (strongTrend && minusDI > plusDI) { bearScore += 1; reasons.push(`ADX ${currentADX.toFixed(0)} ${"-"}DI>+DI`); }

  // 3. SuperTrend direction
  if (st.direction[i] === 1) { bullScore += 1; reasons.push("SuperTrend bullish"); }
  if (st.direction[i] === -1) { bearScore += 1; reasons.push("SuperTrend bearish"); }

  // SuperTrend flip (direction change = strong signal)
  if (i > 0 && st.direction[i] !== st.direction[i - 1]) {
    if (st.direction[i] === 1) { bullScore += 0.5; reasons.push("SuperTrend FLIP to bull"); }
    if (st.direction[i] === -1) { bearScore += 0.5; reasons.push("SuperTrend FLIP to bear"); }
  }

  // 4. MACD histogram + crossover
  if (macdHist > 0) { bullScore += 0.5; }
  if (macdHist < 0) { bearScore += 0.5; }
  if (macdLine > macdSignalLine && macdResult.macd[i - 1] <= macdResult.signal[i - 1]) {
    bullScore += 0.5; reasons.push("MACD bullish crossover");
  }
  if (macdLine < macdSignalLine && macdResult.macd[i - 1] >= macdResult.signal[i - 1]) {
    bearScore += 0.5; reasons.push("MACD bearish crossover");
  }

  // 5. Ichimoku cloud alignment
  if (ichi.signal[i] === "bullish") { bullScore += 1; reasons.push("Price above Ichimoku cloud, TK cross up"); }
  if (ichi.signal[i] === "bearish") { bearScore += 1; reasons.push("Price below Ichimoku cloud, TK cross down"); }

  // 6. Price vs EMA200 (macro trend)
  if (currentPrice > ema200[i]) { bullScore += 0.5; }
  if (currentPrice < ema200[i]) { bearScore += 0.5; }

  // 7. Higher timeframe SuperTrend confirmation
  if (htfST) {
    const htfI = htfST.direction.length - 1;
    if (htfST.direction[htfI] === 1) { bullScore += 1; reasons.push("HTF SuperTrend bullish"); }
    if (htfST.direction[htfI] === -1) { bearScore += 1; reasons.push("HTF SuperTrend bearish"); }
  }

  // 8. RSI filter (don't buy overbought, don't sell oversold)
  const rsiBullOk = currentRSI < 75;
  const rsiBearOk = currentRSI > 25;

  // --- Signal generation ---
  const signals: TradeSignal[] = [];
  let analysis = "";

  // Require minimum 3/7 confluence score for a signal
  const minConfluence = 3;

  if (bullScore >= minConfluence && rsiBullOk && bullScore > bearScore) {
    const confidence = Math.min(0.95, 0.4 + bullScore * 0.08);
    const stopLoss = Math.max(
      st.superTrend[i], // SuperTrend as dynamic stop
      currentPrice - cfg.atrMultiplierStop * currentATR
    );
    const takeProfit = currentPrice + cfg.atrMultiplierTP * currentATR;

    signals.push({
      id: `tf-${Date.now()}`,
      strategy: "trend_following",
      pair: cfg.pair,
      side: "buy",
      type: "market",
      price: currentPrice,
      amount: 0,
      confidence,
      reasoning: `Bullish confluence (${bullScore.toFixed(1)}/7): ${reasons.filter(r => !r.includes("bearish")).join(", ")}`,
      timestamp: Date.now(),
      metadata: {
        stopLoss,
        takeProfit,
        adx: currentADX,
        atr: currentATR,
        rsi: currentRSI,
        confluenceScore: bullScore,
        superTrendLevel: st.superTrend[i],
        ichimokuSignal: ichi.signal[i],
      },
    });
    analysis = `BULLISH (${bullScore.toFixed(1)}/7 confluence). SuperTrend: bull, ADX: ${currentADX.toFixed(0)}, RSI: ${currentRSI.toFixed(0)}. Stop: ${stopLoss.toFixed(0)}, TP: ${takeProfit.toFixed(0)}`;
  } else if (bearScore >= minConfluence && rsiBearOk && bearScore > bullScore) {
    const confidence = Math.min(0.95, 0.4 + bearScore * 0.08);
    const stopLoss = Math.min(
      st.superTrend[i],
      currentPrice + cfg.atrMultiplierStop * currentATR
    );
    const takeProfit = currentPrice - cfg.atrMultiplierTP * currentATR;

    signals.push({
      id: `tf-${Date.now()}`,
      strategy: "trend_following",
      pair: cfg.pair,
      side: "sell",
      type: "market",
      price: currentPrice,
      amount: 0,
      confidence,
      reasoning: `Bearish confluence (${bearScore.toFixed(1)}/7): ${reasons.filter(r => !r.includes("bullish")).join(", ")}`,
      timestamp: Date.now(),
      metadata: {
        stopLoss,
        takeProfit,
        adx: currentADX,
        atr: currentATR,
        rsi: currentRSI,
        confluenceScore: bearScore,
        superTrendLevel: st.superTrend[i],
        ichimokuSignal: ichi.signal[i],
      },
    });
    analysis = `BEARISH (${bearScore.toFixed(1)}/7 confluence). SuperTrend: bear, ADX: ${currentADX.toFixed(0)}, RSI: ${currentRSI.toFixed(0)}. Stop: ${stopLoss.toFixed(0)}, TP: ${takeProfit.toFixed(0)}`;
  } else {
    const bias = bullScore > bearScore ? "bullish" : bearScore > bullScore ? "bearish" : "neutral";
    analysis = `No signal (bull: ${bullScore.toFixed(1)}, bear: ${bearScore.toFixed(1)}, need ${minConfluence}). Bias: ${bias}, ADX: ${currentADX.toFixed(0)}, RSI: ${currentRSI.toFixed(0)}, SuperTrend: ${st.direction[i] === 1 ? "bull" : "bear"}`;
  }

  return {
    strategy: "trend_following",
    signals,
    analysis,
    indicators: {
      emaFast: fastLine[i],
      emaMedium: mediumLine[i],
      emaSlow: slowLine[i],
      ema200: ema200[i],
      adx: currentADX,
      plusDI,
      minusDI,
      atr: currentATR,
      macdHistogram: macdHist,
      rsi: currentRSI,
      superTrend: st.superTrend[i],
      superTrendDir: st.direction[i],
      ichimokuSignal: ichi.signal[i] === "bullish" ? 1 : ichi.signal[i] === "bearish" ? -1 : 0,
      confluenceBull: bullScore,
      confluenceBear: bearScore,
    },
    timestamp: Date.now(),
  };
}
