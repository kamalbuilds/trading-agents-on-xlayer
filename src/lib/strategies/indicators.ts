// Technical Indicators for Trading Strategies

import type { OHLC } from "@/lib/types";

export function ema(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

export function sma(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(sum / period);
  }
  return result;
}

export function rsi(closes: number[], period = 14): number[] {
  const result: number[] = new Array(period).fill(NaN);
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta > 0) avgGain += delta;
    else avgLoss += Math.abs(delta);
  }
  avgGain /= period;
  avgLoss /= period;

  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

export interface BollingerBands {
  upper: number[];
  middle: number[];
  lower: number[];
  bandwidth: number[];
}

export function bollingerBands(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2
): BollingerBands {
  const middle = sma(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];
  const bandwidth: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
      bandwidth.push(NaN);
      continue;
    }
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    upper.push(mean + stdDevMultiplier * stdDev);
    lower.push(mean - stdDevMultiplier * stdDev);
    bandwidth.push(mean > 0 ? ((upper[i] - lower[i]) / mean) * 100 : 0);
  }

  return { upper, middle, lower, bandwidth };
}

export interface ADXResult {
  adx: number[];
  plusDI: number[];
  minusDI: number[];
}

export function adx(candles: OHLC[], period = 14): ADXResult {
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const highDiff = candles[i].high - candles[i - 1].high;
    const lowDiff = candles[i - 1].low - candles[i].low;
    plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
    minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);
    tr.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      )
    );
  }

  const smoothedTR = ema(tr, period);
  const smoothedPlusDM = ema(plusDM, period);
  const smoothedMinusDM = ema(minusDM, period);

  const plusDI = smoothedPlusDM.map((v, i) =>
    smoothedTR[i] > 0 ? (v / smoothedTR[i]) * 100 : 0
  );
  const minusDI = smoothedMinusDM.map((v, i) =>
    smoothedTR[i] > 0 ? (v / smoothedTR[i]) * 100 : 0
  );
  const dx = plusDI.map((v, i) => {
    const sum = v + minusDI[i];
    return sum > 0 ? (Math.abs(v - minusDI[i]) / sum) * 100 : 0;
  });
  const adxLine = ema(dx, period);

  // Pad with NaN to match original candle length
  const pad = [NaN];
  return {
    adx: [...pad, ...adxLine],
    plusDI: [...pad, ...plusDI],
    minusDI: [...pad, ...minusDI],
  };
}

export function atr(candles: OHLC[], period = 14): number[] {
  const trValues: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    trValues.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      )
    );
  }
  return ema(trValues, period);
}

export interface MACDResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): MACDResult {
  const fastEMA = ema(closes, fast);
  const slowEMA = ema(closes, slow);
  const macdLine = fastEMA.map((v, i) => v - slowEMA[i]);
  const signalLine = ema(macdLine, signalPeriod);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  return { macd: macdLine, signal: signalLine, histogram };
}

export function volumeProfile(candles: OHLC[], lookback = 50): { poc: number; valueAreaHigh: number; valueAreaLow: number } {
  const recent = candles.slice(-lookback);
  const priceMin = Math.min(...recent.map((c) => c.low));
  const priceMax = Math.max(...recent.map((c) => c.high));
  const bucketSize = (priceMax - priceMin) / 50 || 1;
  const buckets = new Map<number, number>();

  for (const c of recent) {
    const bucket = Math.floor((c.close - priceMin) / bucketSize);
    buckets.set(bucket, (buckets.get(bucket) || 0) + c.volume);
  }

  let maxVol = 0;
  let pocBucket = 0;
  for (const [bucket, vol] of buckets) {
    if (vol > maxVol) {
      maxVol = vol;
      pocBucket = bucket;
    }
  }

  const poc = priceMin + (pocBucket + 0.5) * bucketSize;
  const totalVol = [...buckets.values()].reduce((a, b) => a + b, 0);
  const targetVol = totalVol * 0.7;

  // Expand from POC to find value area
  let cumVol = maxVol;
  let lo = pocBucket;
  let hi = pocBucket;
  while (cumVol < targetVol && (lo > 0 || hi < 50)) {
    const loVol = lo > 0 ? buckets.get(lo - 1) || 0 : 0;
    const hiVol = hi < 50 ? buckets.get(hi + 1) || 0 : 0;
    if (loVol >= hiVol && lo > 0) {
      lo--;
      cumVol += loVol;
    } else if (hi < 50) {
      hi++;
      cumVol += hiVol;
    } else {
      lo--;
      cumVol += loVol;
    }
  }

  return {
    poc,
    valueAreaHigh: priceMin + (hi + 1) * bucketSize,
    valueAreaLow: priceMin + lo * bucketSize,
  };
}

export function zScore(data: number[], period = 20): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(0);
      continue;
    }
    const slice = data.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const stdDev = Math.sqrt(
      slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period
    );
    result.push(stdDev > 0 ? (data[i] - mean) / stdDev : 0);
  }
  return result;
}
