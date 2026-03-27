// Professional Technical Indicators
// Core indicators powered by trading-signals (tested against TradingView data)
// Advanced indicators (SuperTrend, Ichimoku, Keltner) implemented from TradingView specs

import {
  RSI as TSrsi,
  EMA as TSema,
  SMA as TSsma,
  BollingerBands as TSbb,
  ADX as TSadx,
  ATR as TSatr,
  StochasticRSI as TSstochRsi,
  StochasticOscillator as TSstoch,
  CCI as TScci,
  ROC as TSroc,
  WilliamsR as TSwr,
} from "trading-signals";
import type { OHLC } from "@/lib/types";

// --- Core Indicators ---

export function ema(data: number[], period: number): number[] {
  const indicator = new TSema(period);
  const result: number[] = [];
  for (const v of data) {
    indicator.add(v);
    const r = indicator.getResult();
    result.push(r !== null ? Number(r) : v);
  }
  return result;
}

export function sma(data: number[], period: number): number[] {
  const indicator = new TSsma(period);
  const result: number[] = [];
  for (const v of data) {
    indicator.add(v);
    const r = indicator.getResult();
    result.push(r !== null ? Number(r) : NaN);
  }
  return result;
}

export function rsi(closes: number[], period = 14): number[] {
  const indicator = new TSrsi(period);
  const result: number[] = [];
  for (const v of closes) {
    indicator.add(v);
    const r = indicator.getResult();
    result.push(r !== null ? Number(r) : NaN);
  }
  return result;
}

export interface BollingerBands {
  upper: number[];
  middle: number[];
  lower: number[];
  bandwidth: number[];
}

export function bollingerBands(closes: number[], period = 20, stdDevMultiplier = 2): BollingerBands {
  const indicator = new TSbb(period, stdDevMultiplier);
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];
  const bandwidth: number[] = [];

  for (const v of closes) {
    indicator.add(v);
    const r = indicator.getResult();
    if (r) {
      const u = Number(r.upper);
      const m = Number(r.middle);
      const l = Number(r.lower);
      upper.push(u);
      middle.push(m);
      lower.push(l);
      bandwidth.push(m > 0 ? ((u - l) / m) * 100 : 0);
    } else {
      upper.push(NaN);
      middle.push(NaN);
      lower.push(NaN);
      bandwidth.push(NaN);
    }
  }
  return { upper, middle, lower, bandwidth };
}

export interface ADXResult {
  adx: number[];
  plusDI: number[];
  minusDI: number[];
}

export function adx(candles: OHLC[], period = 14): ADXResult {
  // ADX from trading-signals returns a single number (the ADX value)
  // We compute +DI/-DI ourselves for strategy use
  const indicator = new TSadx(period);
  const adxArr: number[] = [];

  // Manual +DI/-DI computation
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    indicator.add({ high: candles[i].high, low: candles[i].low, close: candles[i].close });
    const adxR = indicator.getResult();
    adxArr.push(adxR !== null ? Number(adxR) : NaN);

    if (i > 0) {
      const highDiff = candles[i].high - candles[i - 1].high;
      const lowDiff = candles[i - 1].low - candles[i].low;
      plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
      minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);
      tr.push(Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      ));
    }
  }

  const smoothedTR = ema(tr, period);
  const smoothedPlusDM = ema(plusDM, period);
  const smoothedMinusDM = ema(minusDM, period);

  const plusDI = [NaN, ...smoothedPlusDM.map((v, i) => smoothedTR[i] > 0 ? (v / smoothedTR[i]) * 100 : 0)];
  const minusDI = [NaN, ...smoothedMinusDM.map((v, i) => smoothedTR[i] > 0 ? (v / smoothedTR[i]) * 100 : 0)];

  return { adx: adxArr, plusDI, minusDI };
}

export function atr(candles: OHLC[], period = 14): number[] {
  const indicator = new TSatr(period);
  const result: number[] = [];
  for (const c of candles) {
    indicator.add({ high: c.high, low: c.low, close: c.close });
    const atrR = indicator.getResult();
    result.push(atrR !== null ? Number(atrR) : c.high - c.low);
  }
  return result;
}

export interface MACDResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MACDResult {
  // MACD constructor: new MACD(shortEMA, longEMA, signalEMA)
  const { MACD: TSmacd } = require("trading-signals") as typeof import("trading-signals");
  const indicator = new TSmacd(new TSema(fast), new TSema(slow), new TSema(signalPeriod));

  const macdLine: number[] = [];
  const signalLine: number[] = [];
  const histogram: number[] = [];

  for (const v of closes) {
    indicator.add(v);
    const r = indicator.getResult();
    if (r) {
      macdLine.push(Number(r.macd));
      signalLine.push(Number(r.signal));
      histogram.push(Number(r.histogram));
    } else {
      macdLine.push(0);
      signalLine.push(0);
      histogram.push(0);
    }
  }
  return { macd: macdLine, signal: signalLine, histogram };
}

// --- Advanced Indicators ---

export interface StochRSIResult {
  k: number[];
  d: number[];
}

export function stochasticRSI(closes: number[], period = 14): StochRSIResult {
  const indicator = new TSstochRsi(period);
  const k: number[] = [];
  const d: number[] = [];
  const dSma = new TSsma(3);

  for (const v of closes) {
    indicator.add(v);
    const kResult = indicator.getResult();
    if (kResult !== null) {
      const kVal = Number(kResult) * 100; // Normalize to 0-100
      k.push(kVal);
      dSma.add(kVal);
      const dResult = dSma.getResult();
      d.push(dResult !== null ? Number(dResult) : kVal);
    } else {
      k.push(NaN);
      d.push(NaN);
    }
  }
  return { k, d };
}

export interface StochasticResult {
  k: number[];
  d: number[];
}

export function stochastic(candles: OHLC[], period = 14, smoothK = 3, smoothD = 3): StochasticResult {
  const indicator = new TSstoch(period, smoothK, smoothD);
  const k: number[] = [];
  const d: number[] = [];

  for (const c of candles) {
    indicator.add({ high: c.high, low: c.low, close: c.close });
    const r = indicator.getResult();
    if (r) {
      k.push(Number(r.stochK));
      d.push(Number(r.stochD));
    } else {
      k.push(NaN);
      d.push(NaN);
    }
  }
  return { k, d };
}

export function cci(candles: OHLC[], period = 20): number[] {
  const indicator = new TScci(period);
  const result: number[] = [];
  for (const c of candles) {
    indicator.add({ high: c.high, low: c.low, close: c.close });
    const r = indicator.getResult();
    result.push(r !== null ? Number(r) : 0);
  }
  return result;
}

export function roc(closes: number[], period = 12): number[] {
  const indicator = new TSroc(period);
  const result: number[] = [];
  for (const v of closes) {
    indicator.add(v);
    const r = indicator.getResult();
    result.push(r !== null ? Number(r) * 100 : 0); // % change
  }
  return result;
}

export function williamsR(candles: OHLC[], period = 14): number[] {
  const indicator = new TSwr(period);
  const result: number[] = [];
  for (const c of candles) {
    indicator.add({ high: c.high, low: c.low, close: c.close });
    const r = indicator.getResult();
    result.push(r !== null ? Number(r) : NaN);
  }
  return result;
}

// --- Custom Advanced Indicators (TradingView spec implementations) ---

export function vwap(candles: OHLC[]): number[] {
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  const result: number[] = [];

  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumulativeTPV += typicalPrice * c.volume;
    cumulativeVolume += c.volume;
    result.push(cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : typicalPrice);
  }
  return result;
}

export function obv(candles: OHLC[]): number[] {
  const result: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) result.push(result[i - 1] + candles[i].volume);
    else if (candles[i].close < candles[i - 1].close) result.push(result[i - 1] - candles[i].volume);
    else result.push(result[i - 1]);
  }
  return result;
}

export interface SuperTrendResult {
  superTrend: number[];
  direction: (1 | -1)[]; // 1 = bullish, -1 = bearish
  upperBand: number[];
  lowerBand: number[];
}

export function superTrend(candles: OHLC[], period = 10, multiplier = 3): SuperTrendResult {
  const atrValues = atr(candles, period);
  const st: number[] = [];
  const dir: (1 | -1)[] = [];
  const ub: number[] = [];
  const lb: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const a = atrValues[i];

    let upper = hl2 + multiplier * a;
    let lower = hl2 - multiplier * a;

    if (i > 0) {
      // Carry forward bands that haven't been broken
      if (lb[i - 1] && lower > lb[i - 1] && candles[i - 1].close > lb[i - 1]) {
        lower = Math.max(lower, lb[i - 1]);
      }
      if (ub[i - 1] && upper < ub[i - 1] && candles[i - 1].close < ub[i - 1]) {
        upper = Math.min(upper, ub[i - 1]);
      }
    }

    ub.push(upper);
    lb.push(lower);

    if (i === 0) {
      dir.push(1);
      st.push(lower);
    } else {
      const prevDir = dir[i - 1];
      if (prevDir === 1 && candles[i].close < lb[i]) {
        dir.push(-1);
        st.push(upper);
      } else if (prevDir === -1 && candles[i].close > ub[i]) {
        dir.push(1);
        st.push(lower);
      } else {
        dir.push(prevDir);
        st.push(prevDir === 1 ? lower : upper);
      }
    }
  }

  return { superTrend: st, direction: dir, upperBand: ub, lowerBand: lb };
}

export interface IchimokuResult {
  tenkanSen: number[];    // Conversion line (9-period)
  kijunSen: number[];     // Base line (26-period)
  senkouSpanA: number[];  // Leading span A
  senkouSpanB: number[];  // Leading span B
  chikouSpan: number[];   // Lagging span
  cloudTop: number[];
  cloudBottom: number[];
  signal: ("bullish" | "bearish" | "neutral")[];
}

function highLowMid(candles: OHLC[], end: number, period: number): number {
  let high = -Infinity;
  let low = Infinity;
  for (let i = end; i >= Math.max(0, end - period + 1); i--) {
    if (candles[i].high > high) high = candles[i].high;
    if (candles[i].low < low) low = candles[i].low;
  }
  return (high + low) / 2;
}

export function ichimoku(
  candles: OHLC[],
  tenkanPeriod = 9,
  kijunPeriod = 26,
  senkouBPeriod = 52,
): IchimokuResult {
  const tenkanSen: number[] = [];
  const kijunSen: number[] = [];
  const senkouSpanA: number[] = [];
  const senkouSpanB: number[] = [];
  const chikouSpan: number[] = [];
  const cloudTop: number[] = [];
  const cloudBottom: number[] = [];
  const signal: ("bullish" | "bearish" | "neutral")[] = [];

  for (let i = 0; i < candles.length; i++) {
    const tenkan = i >= tenkanPeriod - 1 ? highLowMid(candles, i, tenkanPeriod) : NaN;
    tenkanSen.push(tenkan);

    const kijun = i >= kijunPeriod - 1 ? highLowMid(candles, i, kijunPeriod) : NaN;
    kijunSen.push(kijun);

    const spanA = !isNaN(tenkan) && !isNaN(kijun) ? (tenkan + kijun) / 2 : NaN;
    senkouSpanA.push(spanA);

    const spanB = i >= senkouBPeriod - 1 ? highLowMid(candles, i, senkouBPeriod) : NaN;
    senkouSpanB.push(spanB);

    chikouSpan.push(candles[i].close);

    if (!isNaN(spanA) && !isNaN(spanB)) {
      cloudTop.push(Math.max(spanA, spanB));
      cloudBottom.push(Math.min(spanA, spanB));
    } else {
      cloudTop.push(NaN);
      cloudBottom.push(NaN);
    }

    // Multi-condition signal
    if (!isNaN(tenkan) && !isNaN(kijun) && !isNaN(spanA) && !isNaN(spanB)) {
      const price = candles[i].close;
      const aboveCloud = price > cloudTop[i];
      const belowCloud = price < cloudBottom[i];
      const tkBullish = tenkan > kijun;
      const tkBearish = tenkan < kijun;

      if (aboveCloud && tkBullish) signal.push("bullish");
      else if (belowCloud && tkBearish) signal.push("bearish");
      else signal.push("neutral");
    } else {
      signal.push("neutral");
    }
  }

  return { tenkanSen, kijunSen, senkouSpanA, senkouSpanB, chikouSpan, cloudTop, cloudBottom, signal };
}

export interface KeltnerChannelResult {
  upper: number[];
  middle: number[];
  lower: number[];
}

export function keltnerChannels(candles: OHLC[], emaPeriod = 20, atrPeriod = 10, multiplier = 2): KeltnerChannelResult {
  const closes = candles.map(c => c.close);
  const emaValues = ema(closes, emaPeriod);
  const atrValues = atr(candles, atrPeriod);

  return {
    upper: emaValues.map((e, i) => e + multiplier * atrValues[i]),
    middle: emaValues,
    lower: emaValues.map((e, i) => e - multiplier * atrValues[i]),
  };
}

// --- Volume Profile ---

export function volumeProfile(candles: OHLC[], lookback = 50): { poc: number; valueAreaHigh: number; valueAreaLow: number } {
  const recent = candles.slice(-lookback);
  const priceMin = Math.min(...recent.map(c => c.low));
  const priceMax = Math.max(...recent.map(c => c.high));
  const bucketSize = (priceMax - priceMin) / 50 || 1;
  const buckets = new Map<number, number>();

  for (const c of recent) {
    const bucket = Math.floor((c.close - priceMin) / bucketSize);
    buckets.set(bucket, (buckets.get(bucket) || 0) + c.volume);
  }

  let maxVol = 0;
  let pocBucket = 0;
  for (const [bucket, vol] of buckets) {
    if (vol > maxVol) { maxVol = vol; pocBucket = bucket; }
  }

  const poc = priceMin + (pocBucket + 0.5) * bucketSize;
  const totalVol = [...buckets.values()].reduce((a, b) => a + b, 0);
  const targetVol = totalVol * 0.7;

  let cumVol = maxVol;
  let lo = pocBucket;
  let hi = pocBucket;
  while (cumVol < targetVol && (lo > 0 || hi < 50)) {
    const loVol = lo > 0 ? buckets.get(lo - 1) || 0 : 0;
    const hiVol = hi < 50 ? buckets.get(hi + 1) || 0 : 0;
    if (loVol >= hiVol && lo > 0) { lo--; cumVol += loVol; }
    else if (hi < 50) { hi++; cumVol += hiVol; }
    else { lo--; cumVol += loVol; }
  }

  return { poc, valueAreaHigh: priceMin + (hi + 1) * bucketSize, valueAreaLow: priceMin + lo * bucketSize };
}

export function zScore(data: number[], period = 20): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(0); continue; }
    const slice = data.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const stdDev = Math.sqrt(slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period);
    result.push(stdDev > 0 ? (data[i] - mean) / stdDev : 0);
  }
  return result;
}

// --- Multi-timeframe helpers ---

export function resampleCandles(candles: OHLC[], factor: number): OHLC[] {
  const resampled: OHLC[] = [];
  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (chunk.length === 0) continue;
    resampled.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map(c => c.high)),
      low: Math.min(...chunk.map(c => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((sum, c) => sum + c.volume, 0),
    });
  }
  return resampled;
}
