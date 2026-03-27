import type { TradeSignal, PortfolioState, RiskLimits, OHLC } from "@/lib/types";

// Kelly Criterion: f* = (bp - q) / b
// where b = odds ratio, p = win probability, q = 1 - p
export function kellyFraction(winRate: number, avgWin: number, avgLoss: number): number {
  if (avgLoss === 0 || winRate <= 0 || winRate >= 1) return 0;
  const b = avgWin / avgLoss;
  const p = winRate;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  // Half-Kelly for safety (reduces variance by 75% while keeping 75% of growth)
  return Math.max(0, Math.min(kelly * 0.5, 0.25));
}

// Fixed fractional: risk a fixed % of portfolio per trade
export function fixedFractional(
  portfolioEquity: number,
  riskPercent: number,
  entryPrice: number,
  stopLossPrice: number
): number {
  const riskPerUnit = Math.abs(entryPrice - stopLossPrice);
  if (riskPerUnit === 0) return 0;
  const dollarRisk = portfolioEquity * (riskPercent / 100);
  return dollarRisk / riskPerUnit;
}

// ATR-based position sizing: volatility-adjusted
export function atrBasedSize(
  portfolioEquity: number,
  riskPercent: number,
  atr: number,
  atrMultiplier: number = 2
): number {
  if (atr <= 0) return 0;
  const dollarRisk = portfolioEquity * (riskPercent / 100);
  return dollarRisk / (atr * atrMultiplier);
}

// Calculate ATR from OHLC data
export function calculateATR(candles: OHLC[], period: number = 14): number {
  if (candles.length < period + 1) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }

  // Simple moving average of true ranges for the period
  const recent = trueRanges.slice(-period);
  return recent.reduce((sum, tr) => sum + tr, 0) / recent.length;
}

// Dynamic stop-loss based on ATR
export function atrStopLoss(
  entryPrice: number,
  side: "buy" | "sell",
  atr: number,
  multiplier: number = 2
): number {
  const offset = atr * multiplier;
  return side === "buy" ? entryPrice - offset : entryPrice + offset;
}

// Take-profit using risk:reward ratio
export function takeProfitFromRR(
  entryPrice: number,
  stopLoss: number,
  rrRatio: number = 2
): number {
  const risk = Math.abs(entryPrice - stopLoss);
  return entryPrice > stopLoss
    ? entryPrice + risk * rrRatio  // long
    : entryPrice - risk * rrRatio; // short
}

// Main position sizing function that combines methods
export function calculatePositionSize(
  signal: TradeSignal,
  portfolio: PortfolioState,
  limits: RiskLimits,
  candles?: OHLC[]
): { size: number; stopLoss: number; takeProfit: number; method: string } {
  const equity = portfolio.equity;
  const maxPositionValue = equity * (limits.maxPositionSize / 100);
  const currentPrice = signal.price ?? 0;

  if (currentPrice <= 0 || equity <= 0) {
    return { size: 0, stopLoss: 0, takeProfit: 0, method: "rejected_invalid_inputs" };
  }

  let size: number;
  let stopLoss: number;
  let method: string;

  // If we have candle data, use ATR-based sizing
  if (candles && candles.length >= 15) {
    const atr = calculateATR(candles);
    if (atr > 0) {
      stopLoss = atrStopLoss(currentPrice, signal.side, atr);
      size = atrBasedSize(equity, limits.maxPositionSize, atr);
      method = "atr_based";
    } else {
      // Fallback to fixed fractional with default stop
      stopLoss = signal.side === "buy"
        ? currentPrice * (1 - limits.stopLossPercent / 100)
        : currentPrice * (1 + limits.stopLossPercent / 100);
      size = fixedFractional(equity, limits.maxPositionSize, currentPrice, stopLoss);
      method = "fixed_fractional";
    }
  } else {
    // No candle data: use fixed fractional with configured stop-loss
    stopLoss = signal.side === "buy"
      ? currentPrice * (1 - limits.stopLossPercent / 100)
      : currentPrice * (1 + limits.stopLossPercent / 100);
    size = fixedFractional(equity, limits.maxPositionSize, currentPrice, stopLoss);
    method = "fixed_fractional";
  }

  // Apply Kelly scaling based on strategy win rate and confidence
  if (portfolio.winRate > 0 && portfolio.totalTrades >= 10) {
    // Estimate avg win/loss from sharpe (rough proxy)
    const kellyF = kellyFraction(portfolio.winRate, 1.5, 1.0);
    const confidenceScale = signal.confidence;
    size = size * Math.min(kellyF * confidenceScale * 2, 1.0);
    method += "+kelly_scaled";
  } else {
    // Not enough history: scale by confidence only
    size = size * signal.confidence;
    method += "+confidence_scaled";
  }

  // Hard cap: never exceed max position size as % of equity
  const positionValue = size * currentPrice;
  if (positionValue > maxPositionValue) {
    size = maxPositionValue / currentPrice;
    method += "+capped";
  }

  // Minimum viable size check
  if (size * currentPrice < 1) {
    return { size: 0, stopLoss: 0, takeProfit: 0, method: "rejected_too_small" };
  }

  const takeProfit = takeProfitFromRR(currentPrice, stopLoss, limits.takeProfitPercent / limits.stopLossPercent);

  return {
    size: Math.max(0, size),
    stopLoss,
    takeProfit,
    method,
  };
}
