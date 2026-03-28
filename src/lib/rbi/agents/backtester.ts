// ============================================================
// Backtester Agent
// Walk-forward validation + Monte Carlo simulation
// Runs any strategy against historical OHLC data
// ============================================================

import type {
  OHLC,
} from "@/lib/types";
import type {
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
  WalkForwardResult,
  MonteCarloResult,
  StrategyResult,
} from "../types";

const DEFAULT_CONFIG: BacktestConfig = {
  pairs: ["BTC/USD"],
  timeframes: ["4h"],
  lookbackDays: 30,
  initialBalance: 10000,
  feeRate: 0.001,
  slippageBps: 5,
  walkForwardWindows: 3,
  monteCarloIterations: 100,
};

type StrategyFn = (candles: OHLC[], config?: Record<string, unknown>) => StrategyResult;

// --- Core Backtest Engine ---

function runSingleBacktest(
  strategyFn: StrategyFn,
  candles: OHLC[],
  config: BacktestConfig,
  strategyParams?: Record<string, unknown>
): { trades: BacktestTrade[]; equityCurve: { time: number; equity: number }[] } {
  let balance = config.initialBalance;
  let position: { side: "buy"; entry: number; amount: number } | null = null;
  const trades: BacktestTrade[] = [];
  const equityCurve: { time: number; equity: number }[] = [];

  const WARMUP = Math.min(120, Math.floor(candles.length * 0.2));

  // Build candle window incrementally instead of slice(0, i+1) on every iteration.
  // This avoids O(n²) array copies: push one candle per iteration instead.
  const candleWindow = candles.slice(0, WARMUP);

  for (let i = WARMUP; i < candles.length; i++) {
    candleWindow.push(candles[i]);
    let result: StrategyResult;

    try {
      result = strategyFn(candleWindow, strategyParams);
    } catch {
      // Strategy error on this candle, skip
      const equity = balance + (position ? candles[i].close * position.amount : 0);
      equityCurve.push({ time: candles[i].time, equity });
      continue;
    }

    const price = candles[i].close;
    const slippage = price * (config.slippageBps / 10000);

    // Bridge: strategies from @/lib/types return signals[] array, not a top-level signal field.
    // Extract the primary signal from the signals array if result.signal is missing.
    const rawResult = result as unknown as { signal?: string; signals?: { side: string }[]; strategy?: string };
    const signal = rawResult.signal ?? (rawResult.signals?.[0]?.side === "buy" ? "buy" : rawResult.signals?.[0]?.side === "sell" ? "sell" : "hold");

    if (signal === "buy" && !position && balance > 0) {
      const fillPrice = price + slippage;
      const fee = fillPrice * config.feeRate;
      const amount = (balance * 0.95) / (fillPrice + fee);
      position = { side: "buy", entry: fillPrice, amount };
      balance -= fillPrice * amount + fee * amount;
    } else if (signal === "sell" && position) {
      const fillPrice = price - slippage;
      const fee = fillPrice * config.feeRate;
      const pnl = (fillPrice - position.entry) * position.amount;
      balance += fillPrice * position.amount - fee * position.amount;
      trades.push({
        entryTime: candles[Math.max(0, i - 1)].time,
        exitTime: candles[i].time,
        side: position.side,
        entryPrice: position.entry,
        exitPrice: fillPrice,
        amount: position.amount,
        pnl,
        pnlPercent: (pnl / (position.entry * position.amount)) * 100,
        fees: fee * position.amount * 2,
        strategy: rawResult.strategy ?? "unknown",
      });
      position = null;
    }

    const equity = balance + (position ? price * position.amount : 0);
    equityCurve.push({ time: candles[i].time, equity });
  }

  // Close any open position at end
  if (position) {
    const lastPrice = candles[candles.length - 1].close;
    const fee = lastPrice * config.feeRate;
    const pnl = (lastPrice - position.entry) * position.amount;
    balance += lastPrice * position.amount - fee * position.amount;
    trades.push({
      entryTime: candles[candles.length - 2]?.time ?? candles[candles.length - 1].time,
      exitTime: candles[candles.length - 1].time,
      side: position.side,
      entryPrice: position.entry,
      exitPrice: lastPrice,
      amount: position.amount,
      pnl,
      pnlPercent: (pnl / (position.entry * position.amount)) * 100,
      fees: fee * position.amount * 2,
      strategy: "close",
    });
  }

  return { trades, equityCurve };
}

// --- Metrics Computation ---

function computeMetrics(
  trades: BacktestTrade[],
  equityCurve: { time: number; equity: number }[],
  config: BacktestConfig
): Omit<BacktestResult, "strategyId" | "config" | "walkForward" | "monteCarlo" | "timestamp"> {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);

  const totalReturn = equityCurve.length > 0
    ? ((equityCurve[equityCurve.length - 1].equity - config.initialBalance) / config.initialBalance) * 100
    : 0;

  // Max drawdown
  let peak = config.initialBalance;
  let maxDD = 0;
  let maxDDDuration = 0;
  let currentDDDuration = 0;
  for (const point of equityCurve) {
    if (point.equity > peak) {
      peak = point.equity;
      currentDDDuration = 0;
    } else {
      const dd = ((peak - point.equity) / peak) * 100;
      if (dd > maxDD) maxDD = dd;
      currentDDDuration++;
      if (currentDDDuration > maxDDDuration) maxDDDuration = currentDDDuration;
    }
  }

  // Returns for Sharpe/Sortino
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    returns.push(
      (equityCurve[i].equity - equityCurve[i - 1].equity) / equityCurve[i - 1].equity
    );
  }

  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdDev = returns.length > 1
    ? Math.sqrt(returns.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / (returns.length - 1))
    : 1;
  const downDev = returns.length > 1
    ? Math.sqrt(
        returns.filter((r) => r < 0).reduce((a, b) => a + b ** 2, 0) /
          Math.max(1, returns.filter((r) => r < 0).length)
      )
    : 1;

  // Annualize (assume 4h candles, 6 per day, 365 days)
  const periodsPerYear = 6 * 365;
  const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(periodsPerYear) : 0;
  const sortino = downDev > 0 ? (avgReturn / downDev) * Math.sqrt(periodsPerYear) : 0;

  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

  // Duration in days
  const durationDays = equityCurve.length > 0
    ? (equityCurve[equityCurve.length - 1].time - equityCurve[0].time) / (86400 * 1000)
    : 1;

  return {
    totalReturn,
    annualizedReturn: durationDays > 0 ? (totalReturn / durationDays) * 365 : 0,
    sharpeRatio: Math.round(sharpe * 100) / 100,
    sortinoRatio: Math.round(sortino * 100) / 100,
    maxDrawdown: Math.round(maxDD * 100) / 100,
    maxDrawdownDuration: maxDDDuration,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    profitFactor: Math.round(profitFactor * 100) / 100,
    totalTrades: trades.length,
    avgTradesPerDay: durationDays > 0 ? trades.length / durationDays : 0,
    avgWin: wins.length > 0 ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length : 0,
    avgLoss: losses.length > 0 ? losses.reduce((a, t) => a + t.pnl, 0) / losses.length : 0,
    largestWin: wins.length > 0 ? Math.max(...wins.map((t) => t.pnl)) : 0,
    largestLoss: losses.length > 0 ? Math.min(...losses.map((t) => t.pnl)) : 0,
    avgHoldingPeriod:
      trades.length > 0
        ? trades.reduce((a, t) => a + (t.exitTime - t.entryTime), 0) / trades.length / (3600 * 1000)
        : 0,
    equityCurve,
    trades,
  };
}

// --- Walk-Forward Validation ---

function walkForwardTest(
  strategyFn: StrategyFn,
  candles: OHLC[],
  config: BacktestConfig,
  strategyParams?: Record<string, unknown>
): WalkForwardResult {
  const windows = config.walkForwardWindows;
  const windowSize = Math.floor(candles.length / (windows + 1));
  const inSampleSharpes: number[] = [];
  const outOfSampleSharpes: number[] = [];

  for (let w = 0; w < windows; w++) {
    const trainEnd = (w + 1) * windowSize;
    const testEnd = Math.min(trainEnd + windowSize, candles.length);

    // In-sample
    const trainCandles = candles.slice(0, trainEnd);
    const trainResult = runSingleBacktest(strategyFn, trainCandles, config, strategyParams);
    const trainMetrics = computeMetrics(trainResult.trades, trainResult.equityCurve, config);
    inSampleSharpes.push(trainMetrics.sharpeRatio);

    // Out-of-sample
    const testCandles = candles.slice(0, testEnd);
    const testResult = runSingleBacktest(strategyFn, testCandles, config, strategyParams);
    const testMetrics = computeMetrics(testResult.trades, testResult.equityCurve, config);
    outOfSampleSharpes.push(testMetrics.sharpeRatio);
  }

  const avgInSample =
    inSampleSharpes.reduce((a, b) => a + b, 0) / inSampleSharpes.length;
  const avgOutOfSample =
    outOfSampleSharpes.reduce((a, b) => a + b, 0) / outOfSampleSharpes.length;
  const degradation =
    avgInSample > 0
      ? Math.abs(((avgInSample - avgOutOfSample) / avgInSample) * 100)
      : 0;

  return {
    inSampleSharpe: Math.round(avgInSample * 100) / 100,
    outOfSampleSharpe: Math.round(avgOutOfSample * 100) / 100,
    degradation: Math.round(degradation * 100) / 100,
    consistent: degradation < 30,
  };
}

// --- Monte Carlo Simulation ---

function monteCarloSim(
  trades: BacktestTrade[],
  config: BacktestConfig
): MonteCarloResult {
  if (trades.length < 5) {
    return { p5Return: 0, p50Return: 0, p95Return: 0, p5MaxDD: 0, ruinProbability: 0 };
  }

  const iterations = config.monteCarloIterations;
  const results: number[] = [];
  const maxDDs: number[] = [];
  let ruinCount = 0;

  for (let iter = 0; iter < iterations; iter++) {
    // Shuffle trades randomly
    const shuffled = [...trades].sort(() => Math.random() - 0.5);

    let equity = config.initialBalance;
    let peak = equity;
    let maxDD = 0;

    for (const trade of shuffled) {
      equity += trade.pnl;
      if (equity > peak) peak = equity;
      const dd = ((peak - equity) / peak) * 100;
      if (dd > maxDD) maxDD = dd;

      if (equity <= config.initialBalance * 0.5) {
        ruinCount++;
        break;
      }
    }

    results.push(((equity - config.initialBalance) / config.initialBalance) * 100);
    maxDDs.push(maxDD);
  }

  results.sort((a, b) => a - b);
  maxDDs.sort((a, b) => a - b);

  const percentile = (arr: number[], p: number) =>
    arr[Math.floor((p / 100) * arr.length)] ?? 0;

  return {
    p5Return: Math.round(percentile(results, 5) * 100) / 100,
    p50Return: Math.round(percentile(results, 50) * 100) / 100,
    p95Return: Math.round(percentile(results, 95) * 100) / 100,
    p5MaxDD: Math.round(percentile(maxDDs, 95) * 100) / 100, // 95th percentile of DD = worst case
    ruinProbability: Math.round((ruinCount / iterations) * 10000) / 100,
  };
}

// --- Public API ---

/** Run full backtest with walk-forward and Monte Carlo */
export function runBacktest(
  strategyFn: StrategyFn,
  candles: OHLC[],
  strategyId: string,
  config: Partial<BacktestConfig> = {},
  strategyParams?: Record<string, unknown>
): BacktestResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Run main backtest
  const { trades, equityCurve } = runSingleBacktest(strategyFn, candles, cfg, strategyParams);
  const metrics = computeMetrics(trades, equityCurve, cfg);

  // Walk-forward validation
  const walkForward = walkForwardTest(strategyFn, candles, cfg, strategyParams);

  // Monte Carlo simulation
  const monteCarlo = monteCarloSim(trades, cfg);

  return {
    strategyId,
    config: cfg,
    ...metrics,
    walkForward,
    monteCarlo,
    timestamp: Date.now(),
  };
}
