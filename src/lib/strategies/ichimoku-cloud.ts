// Ichimoku Cloud Strategy - Full 5-Line System
// Tenkan/Kijun cross + Cloud position + Chikou span + MACD + Volume
// TradingView-grade: implements all 5 Ichimoku signals with multi-indicator confirmation
// Best on 4h/1d timeframes, works especially well on BTC/ETH

import type { OHLC, TradeSignal, StrategyResult } from "@/lib/types";
import { ichimoku, macd, rsi, atr, obv, ema, vwap } from "./indicators";

export interface IchimokuCloudConfig {
  tenkanPeriod: number;
  kijunPeriod: number;
  senkouBPeriod: number;
  pair: string;
}

const DEFAULT_CONFIG: IchimokuCloudConfig = {
  tenkanPeriod: 9,
  kijunPeriod: 26,
  senkouBPeriod: 52,
  pair: "BTC/USD",
};

export function analyzeIchimokuCloud(
  candles: OHLC[],
  config: Partial<IchimokuCloudConfig> = {}
): StrategyResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const closes = candles.map(c => c.close);

  if (closes.length < cfg.senkouBPeriod + 30) {
    return {
      strategy: "ichimoku_cloud",
      signals: [],
      analysis: "Insufficient data for Ichimoku analysis (need 82+ candles)",
      indicators: {},
      timestamp: Date.now(),
    };
  }

  // --- Compute indicators ---
  const ichi = ichimoku(candles, cfg.tenkanPeriod, cfg.kijunPeriod, cfg.senkouBPeriod);
  const macdResult = macd(closes);
  const rsiValues = rsi(closes, 14);
  const atrValues = atr(candles, 14);
  const obvValues = obv(candles);
  const obvEma20 = ema(obvValues, 20);
  const vwapValues = vwap(candles);

  const i = closes.length - 1;
  const currentPrice = closes[i];
  const tenkan = ichi.tenkanSen[i];
  const kijun = ichi.kijunSen[i];
  const spanA = ichi.senkouSpanA[i];
  const spanB = ichi.senkouSpanB[i];
  const cloudTop = ichi.cloudTop[i];
  const cloudBottom = ichi.cloudBottom[i];
  const currentRSI = rsiValues[i] ?? 50;
  const currentATR = atrValues[i];

  // --- 5 Ichimoku signals with confluence scoring ---
  let bullScore = 0;
  let bearScore = 0;
  const reasons: string[] = [];

  // 1. Tenkan-Kijun Cross (the primary signal)
  if (!isNaN(tenkan) && !isNaN(kijun)) {
    const tkBullish = tenkan > kijun;
    const tkBearish = tenkan < kijun;
    if (tkBullish) { bullScore += 1; reasons.push("TK cross bullish"); }
    if (tkBearish) { bearScore += 1; reasons.push("TK cross bearish"); }

    // Fresh crossover (stronger signal)
    if (i > 0 && !isNaN(ichi.tenkanSen[i - 1]) && !isNaN(ichi.kijunSen[i - 1])) {
      if (tkBullish && ichi.tenkanSen[i - 1] <= ichi.kijunSen[i - 1]) {
        bullScore += 1; reasons.push("Fresh TK cross UP");
      }
      if (tkBearish && ichi.tenkanSen[i - 1] >= ichi.kijunSen[i - 1]) {
        bearScore += 1; reasons.push("Fresh TK cross DOWN");
      }
    }
  }

  // 2. Price vs Cloud
  if (!isNaN(cloudTop) && !isNaN(cloudBottom)) {
    if (currentPrice > cloudTop) { bullScore += 1.5; reasons.push("Price ABOVE cloud"); }
    else if (currentPrice < cloudBottom) { bearScore += 1.5; reasons.push("Price BELOW cloud"); }
    else { reasons.push("Price INSIDE cloud (neutral zone)"); }

    // Cloud thickness = conviction strength
    const cloudThickness = Math.abs(spanA - spanB) / currentATR;
    if (cloudThickness > 2) {
      if (currentPrice > cloudTop) { bullScore += 0.5; reasons.push("Thick cloud support"); }
      if (currentPrice < cloudBottom) { bearScore += 0.5; reasons.push("Thick cloud resistance"); }
    }
  }

  // 3. Cloud color (future cloud direction)
  if (!isNaN(spanA) && !isNaN(spanB)) {
    if (spanA > spanB) { bullScore += 0.5; reasons.push("Green cloud (bullish kumo)"); }
    if (spanA < spanB) { bearScore += 0.5; reasons.push("Red cloud (bearish kumo)"); }

    // Cloud twist (color change = trend change ahead)
    if (i > 0 && !isNaN(ichi.senkouSpanA[i - 1]) && !isNaN(ichi.senkouSpanB[i - 1])) {
      const wasGreen = ichi.senkouSpanA[i - 1] > ichi.senkouSpanB[i - 1];
      const isGreen = spanA > spanB;
      if (!wasGreen && isGreen) { bullScore += 0.5; reasons.push("Cloud twist to green"); }
      if (wasGreen && !isGreen) { bearScore += 0.5; reasons.push("Cloud twist to red"); }
    }
  }

  // 4. Chikou Span (lagging span) confirmation
  // Chikou span is current close shifted back 26 periods
  // Bullish when chikou > price 26 periods ago
  if (i >= cfg.kijunPeriod) {
    const chikouPrice = ichi.chikouSpan[i]; // current close
    const priceBack = closes[i - cfg.kijunPeriod]; // price 26 periods ago
    if (chikouPrice > priceBack) { bullScore += 1; reasons.push("Chikou above past price"); }
    if (chikouPrice < priceBack) { bearScore += 1; reasons.push("Chikou below past price"); }
  }

  // 5. Price vs Kijun-sen (base line acts as dynamic S/R)
  if (!isNaN(kijun)) {
    if (currentPrice > kijun) { bullScore += 0.5; }
    if (currentPrice < kijun) { bearScore += 0.5; }
  }

  // --- Confirmation indicators ---

  // MACD alignment
  if (macdResult.histogram[i] > 0) { bullScore += 0.5; }
  if (macdResult.histogram[i] < 0) { bearScore += 0.5; }

  // OBV trend
  if (obvValues[i] > obvEma20[i]) { bullScore += 0.5; reasons.push("OBV accumulation"); }
  if (obvValues[i] < obvEma20[i]) { bearScore += 0.5; reasons.push("OBV distribution"); }

  // RSI filter
  const rsiBullOk = currentRSI < 78;
  const rsiBearOk = currentRSI > 22;

  // --- Signal generation ---
  const signals: TradeSignal[] = [];
  let analysis = "";
  const minConfluence = 3.5; // Ichimoku strategies need strong confluence

  if (bullScore >= minConfluence && rsiBullOk && bullScore > bearScore + 1) {
    const confidence = Math.min(0.93, 0.35 + bullScore * 0.07);
    const stopLoss = Math.max(kijun || currentPrice - currentATR * 3, cloudBottom || currentPrice - currentATR * 3);
    const takeProfit = currentPrice + currentATR * 4;

    signals.push({
      id: `ichi-${Date.now()}`,
      strategy: "ichimoku_cloud",
      pair: cfg.pair,
      side: "buy",
      type: "market",
      price: currentPrice,
      amount: 0,
      confidence,
      reasoning: `Ichimoku bullish (${bullScore.toFixed(1)}/8): ${reasons.filter(r => !r.includes("bearish") && !r.includes("BELOW") && !r.includes("below") && !r.includes("Red") && !r.includes("red")).join(", ")}`,
      timestamp: Date.now(),
      metadata: {
        stopLoss,
        takeProfit,
        tenkan,
        kijun,
        cloudTop,
        cloudBottom,
        rsi: currentRSI,
        confluenceScore: bullScore,
        ichimokuSignal: ichi.signal[i],
      },
    });
    analysis = `ICHIMOKU BULLISH (${bullScore.toFixed(1)}/8). Price above cloud, TK: ${tenkan > kijun ? "bull" : "bear"}, RSI: ${currentRSI.toFixed(0)}`;
  } else if (bearScore >= minConfluence && rsiBearOk && bearScore > bullScore + 1) {
    const confidence = Math.min(0.93, 0.35 + bearScore * 0.07);
    const stopLoss = Math.min(kijun || currentPrice + currentATR * 3, cloudTop || currentPrice + currentATR * 3);
    const takeProfit = currentPrice - currentATR * 4;

    signals.push({
      id: `ichi-${Date.now()}`,
      strategy: "ichimoku_cloud",
      pair: cfg.pair,
      side: "sell",
      type: "market",
      price: currentPrice,
      amount: 0,
      confidence,
      reasoning: `Ichimoku bearish (${bearScore.toFixed(1)}/8): ${reasons.filter(r => !r.includes("bullish") && !r.includes("ABOVE") && !r.includes("above") && !r.includes("Green") && !r.includes("green")).join(", ")}`,
      timestamp: Date.now(),
      metadata: {
        stopLoss,
        takeProfit,
        tenkan,
        kijun,
        cloudTop,
        cloudBottom,
        rsi: currentRSI,
        confluenceScore: bearScore,
        ichimokuSignal: ichi.signal[i],
      },
    });
    analysis = `ICHIMOKU BEARISH (${bearScore.toFixed(1)}/8). Price below cloud, TK: ${tenkan < kijun ? "bear" : "bull"}, RSI: ${currentRSI.toFixed(0)}`;
  } else {
    const inCloud = !isNaN(cloudTop) && !isNaN(cloudBottom) && currentPrice <= cloudTop && currentPrice >= cloudBottom;
    analysis = `No signal (bull: ${bullScore.toFixed(1)}, bear: ${bearScore.toFixed(1)}, need ${minConfluence}). ${inCloud ? "IN CLOUD (avoid trading)" : ichi.signal[i]}. RSI: ${currentRSI.toFixed(0)}`;
  }

  return {
    strategy: "ichimoku_cloud",
    signals,
    analysis,
    indicators: {
      tenkan,
      kijun,
      senkouSpanA: spanA,
      senkouSpanB: spanB,
      cloudTop,
      cloudBottom,
      cloudColor: spanA > spanB ? 1 : -1, // 1 = green (bullish), -1 = red (bearish)
      rsi: currentRSI,
      macdHistogram: macdResult.histogram[i],
      confluenceBull: bullScore,
      confluenceBear: bearScore,
    },
    timestamp: Date.now(),
  };
}
