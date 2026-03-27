#!/usr/bin/env npx tsx
// ============================================================
// Trend Following Backtest (inspired by Bitcoin Strategy channel)
//
// Key insight: Crypto has massive cycles. Trend following exploits this.
// 32% win rate but avg win >> avg loss = profitable.
// Uses simple moving average crossover with trailing stops.
// ============================================================

import { EMA as TSema } from "trading-signals";

interface OHLC {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Trade {
  entryBar: number;
  exitBar: number;
  entryPrice: number;
  exitPrice: number;
  side: "long" | "short";
  pnl: number;
  pnlPercent: number;
  reason: string;
  entryTime: string;
  exitTime: string;
}

// --- Indicators ---

function computeEMA(data: number[], period: number): number[] {
  const indicator = new TSema(period);
  const result: number[] = [];
  for (const v of data) {
    indicator.add(v);
    const r = indicator.getResult();
    result.push(r !== null ? Number(r) : v);
  }
  return result;
}

function computeSMA(data: number[], period: number): number[] {
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

function computeATR(candles: OHLC[], period = 14): number[] {
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      trs.push(candles[i].high - candles[i].low);
    } else {
      trs.push(Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      ));
    }
  }
  return computeEMA(trs, period);
}

// --- Data fetching ---

async function fetchKrakenOHLC(pair: string, interval: number): Promise<OHLC[]> {
  const url = new URL("https://api.kraken.com/0/public/OHLC");
  url.searchParams.set("pair", pair);
  url.searchParams.set("interval", String(interval));

  const resp = await fetch(url.toString());
  const json = await resp.json() as { error: string[]; result: Record<string, unknown[][]> };

  if (json.error?.length > 0) throw new Error(`Kraken: ${json.error.join(", ")}`);

  const key = Object.keys(json.result).find(k => k !== "last");
  if (!key) return [];

  return (json.result[key] as (string | number)[][]).map(c => ({
    time: Number(c[0]),
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[6]),
  }));
}

async function fetchExtendedHistory(pair: string, interval: number, pages: number): Promise<OHLC[]> {
  let allCandles: OHLC[] = [];
  const now = Math.floor(Date.now() / 1000);
  const candleDuration = interval * 60;

  for (let page = 0; page < pages; page++) {
    const pageOffset = pages - 1 - page;
    const since = now - (pageOffset + 1) * 720 * candleDuration;

    process.stdout.write(`  Page ${page + 1}/${pages}...`);
    const url = new URL("https://api.kraken.com/0/public/OHLC");
    url.searchParams.set("pair", pair);
    url.searchParams.set("interval", String(interval));
    url.searchParams.set("since", String(since));

    try {
      const resp = await fetch(url.toString());
      const json = await resp.json() as { error: string[]; result: Record<string, unknown> };
      if (json.error?.length > 0) { console.log(" error"); continue; }
      const key = Object.keys(json.result).find(k => k !== "last");
      if (!key) { console.log(" no data"); break; }
      const raw = json.result[key] as (string | number)[][];
      const candles = raw.map(c => ({
        time: Number(c[0]), open: Number(c[1]), high: Number(c[2]),
        low: Number(c[3]), close: Number(c[4]), volume: Number(c[6]),
      }));
      allCandles.push(...candles);
      console.log(` ${candles.length} candles`);
    } catch { console.log(" fetch failed"); }

    if (page < pages - 1) await new Promise(r => setTimeout(r, 1500));
  }

  const seen = new Set<number>();
  allCandles = allCandles.filter(c => {
    if (seen.has(c.time)) return false;
    seen.add(c.time);
    return true;
  }).sort((a, b) => a.time - b.time);

  return allCandles;
}

// --- Strategy: Moving Average Trend Follower ---
// Inspired by BitcoinStrategy channel's approach:
// - Simple MA crossover for direction
// - Trailing stop based on ATR (let winners run, cut losers fast)
// - Only trades in direction of higher timeframe trend

interface TFSignal {
  bar: number;
  side: "long" | "short";
  price: number;
  atr: number;
}

function trendFollowingSignals(
  candles: OHLC[],
  fastMA: number,
  slowMA: number,
  atrPeriod: number,
  atrTrailMult: number,
): TFSignal[] {
  const closes = candles.map(c => c.close);
  const fast = computeEMA(closes, fastMA);
  const slow = computeEMA(closes, slowMA);
  const atr = computeATR(candles, atrPeriod);

  const signals: TFSignal[] = [];
  let currentSide: "long" | "short" | null = null;

  const warmup = Math.max(fastMA, slowMA, atrPeriod) + 5;

  for (let i = warmup; i < candles.length; i++) {
    const fastAbove = fast[i] > slow[i];
    const prevFastAbove = fast[i - 1] > slow[i - 1];

    // Signal on MA crossover
    if (fastAbove && !prevFastAbove && currentSide !== "long") {
      currentSide = "long";
      signals.push({ bar: i, side: "long", price: closes[i], atr: atr[i] });
    } else if (!fastAbove && prevFastAbove && currentSide !== "short") {
      currentSide = "short";
      signals.push({ bar: i, side: "short", price: closes[i], atr: atr[i] });
    }
  }

  return signals;
}

// --- Backtester with trailing stops ---

interface BacktestConfig {
  initialBalance: number;
  positionSizePercent: number;
  feePercent: number;
  slippageBps: number;
  atrTrailMult: number;  // trailing stop distance in ATR
  useTrailingStop: boolean;
}

function runBacktest(candles: OHLC[], signals: TFSignal[], config: BacktestConfig) {
  const { initialBalance, positionSizePercent, feePercent, slippageBps, atrTrailMult, useTrailingStop } = config;

  let equity = initialBalance;
  let peakEquity = initialBalance;
  let maxDrawdown = 0;
  const equityCurve: number[] = [initialBalance];
  const trades: Trade[] = [];
  const returns: number[] = [];

  let inPosition = false;
  let posSide: "long" | "short" = "long";
  let entryPrice = 0;
  let entryBar = 0;
  let positionSize = 0;
  let trailStop = 0;
  let bestPrice = 0; // best price since entry (for trailing)

  function closePosition(exitPrice: number, exitBar: number, reason: string) {
    const slip = exitPrice * (slippageBps / 10000);
    const adjExit = posSide === "long" ? exitPrice - slip : exitPrice + slip;

    const grossPnl = posSide === "long"
      ? (adjExit - entryPrice) / entryPrice * positionSize
      : (entryPrice - adjExit) / entryPrice * positionSize;
    const fees = positionSize * feePercent / 100 * 2;
    const netPnl = grossPnl - fees;

    equity += netPnl;
    const pnlPct = (netPnl / (equity - netPnl)) * 100;
    returns.push(netPnl / (equity - netPnl));

    trades.push({
      entryBar, exitBar, entryPrice, exitPrice: adjExit,
      side: posSide, pnl: netPnl, pnlPercent: pnlPct, reason,
      entryTime: new Date(candles[entryBar].time * 1000).toISOString(),
      exitTime: new Date(candles[exitBar].time * 1000).toISOString(),
    });

    equityCurve.push(equity);
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdown = Math.max(maxDrawdown, ((peakEquity - equity) / peakEquity) * 100);
    inPosition = false;
  }

  for (let si = 0; si < signals.length; si++) {
    const sig = signals[si];
    const nextSigBar = si + 1 < signals.length ? signals[si + 1].bar : candles.length;

    // If in position, check trailing stop bar by bar until next signal
    if (inPosition) {
      let stopped = false;
      for (let b = entryBar + 1; b < Math.min(sig.bar, candles.length); b++) {
        if (useTrailingStop) {
          // Update trailing stop
          if (posSide === "long") {
            bestPrice = Math.max(bestPrice, candles[b].high);
            trailStop = bestPrice - sig.atr * atrTrailMult;
            if (candles[b].low <= trailStop) {
              closePosition(trailStop, b, "trailing-stop");
              stopped = true;
              break;
            }
          } else {
            bestPrice = Math.min(bestPrice, candles[b].low);
            trailStop = bestPrice + sig.atr * atrTrailMult;
            if (candles[b].high >= trailStop) {
              closePosition(trailStop, b, "trailing-stop");
              stopped = true;
              break;
            }
          }
        }
      }

      // Close on signal reversal if still in position
      if (!stopped && inPosition && sig.side !== posSide) {
        closePosition(sig.price, sig.bar, "signal-reversal");
      }
    }

    // Open new position
    if (!inPosition && equity > 0) {
      posSide = sig.side;
      positionSize = equity * positionSizePercent / 100;
      const slip = sig.price * (slippageBps / 10000);
      entryPrice = posSide === "long" ? sig.price + slip : sig.price - slip;
      entryBar = sig.bar;
      bestPrice = sig.price;
      trailStop = posSide === "long"
        ? sig.price - sig.atr * atrTrailMult
        : sig.price + sig.atr * atrTrailMult;
      inPosition = true;

      // Check trailing stop until next signal
      for (let b = sig.bar + 1; b < Math.min(nextSigBar, candles.length); b++) {
        if (useTrailingStop) {
          if (posSide === "long") {
            bestPrice = Math.max(bestPrice, candles[b].high);
            trailStop = bestPrice - sig.atr * atrTrailMult;
            if (candles[b].low <= trailStop) {
              closePosition(trailStop, b, "trailing-stop");
              break;
            }
          } else {
            bestPrice = Math.min(bestPrice, candles[b].low);
            trailStop = bestPrice + sig.atr * atrTrailMult;
            if (candles[b].high >= trailStop) {
              closePosition(trailStop, b, "trailing-stop");
              break;
            }
          }
        }
      }
    }
  }

  // Close remaining at end
  if (inPosition) {
    closePosition(candles[candles.length - 1].close, candles.length - 1, "end-of-data");
  }

  // Stats
  const winning = trades.filter(t => t.pnl > 0);
  const losing = trades.filter(t => t.pnl <= 0);
  const totalPnl = equity - initialBalance;
  const avgRet = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdRet = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / (returns.length - 1))
    : 0;
  const grossProfit = winning.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losing.reduce((s, t) => s + t.pnl, 0));

  return {
    totalTrades: trades.length,
    winningTrades: winning.length,
    losingTrades: losing.length,
    winRate: trades.length > 0 ? (winning.length / trades.length) * 100 : 0,
    totalPnl,
    totalPnlPercent: (totalPnl / initialBalance) * 100,
    maxDrawdown,
    sharpeRatio: stdRet > 0 ? (avgRet / stdRet) * Math.sqrt(252) : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgWin: winning.length > 0 ? grossProfit / winning.length : 0,
    avgLoss: losing.length > 0 ? grossLoss / losing.length : 0,
    avgWinPct: winning.length > 0 ? winning.reduce((s, t) => s + t.pnlPercent, 0) / winning.length : 0,
    avgLossPct: losing.length > 0 ? losing.reduce((s, t) => s + Math.abs(t.pnlPercent), 0) / losing.length : 0,
    bestTrade: trades.length > 0 ? Math.max(...trades.map(t => t.pnl)) : 0,
    worstTrade: trades.length > 0 ? Math.min(...trades.map(t => t.pnl)) : 0,
    avgHoldingBars: trades.length > 0
      ? trades.reduce((s, t) => s + (t.exitBar - t.entryBar), 0) / trades.length
      : 0,
    trades,
    equityCurve,
  };
}

// --- Main ---

async function main() {
  console.log("=".repeat(65));
  console.log("  TREND FOLLOWING BACKTEST (Bitcoin Strategy method)");
  console.log("  Pair: BTC/USD | Source: Kraken | Capital: $10,000");
  console.log("=".repeat(65));
  console.log();

  // Strategy 1: Daily candles (1440min) for longer-term trend
  // Strategy 2: 4h candles for medium-term
  const timeframes = [
    { interval: 1440, label: "1D", pages: 1 },
    { interval: 240, label: "4H", pages: 3 },
  ];

  for (const tf of timeframes) {
    console.log(`\n${"=".repeat(65)}`);
    console.log(`  Timeframe: ${tf.label}`);
    console.log("=".repeat(65));

    let candles: OHLC[];
    if (tf.pages > 1) {
      candles = await fetchExtendedHistory("XBTUSD", tf.interval, tf.pages);
    } else {
      candles = await fetchKrakenOHLC("XBTUSD", tf.interval);
    }

    console.log(`  ${candles.length} candles loaded`);
    if (candles.length < 60) {
      console.log("  Not enough data, skipping...");
      continue;
    }

    const firstDate = new Date(candles[0].time * 1000).toISOString().slice(0, 10);
    const lastDate = new Date(candles[candles.length - 1].time * 1000).toISOString().slice(0, 10);
    const startPrice = candles[0].close;
    const endPrice = candles[candles.length - 1].close;
    const buyHoldReturn = ((endPrice - startPrice) / startPrice * 100);

    console.log(`  Range: ${firstDate} to ${lastDate}`);
    console.log(`  Price: $${startPrice.toFixed(0)} -> $${endPrice.toFixed(0)} (Buy & Hold: ${buyHoldReturn >= 0 ? "+" : ""}${buyHoldReturn.toFixed(1)}%)`);
    console.log();

    // Test different MA combinations
    const maParams = [
      { fast: 10, slow: 30, label: "EMA(10/30)" },
      { fast: 20, slow: 50, label: "EMA(20/50)" },
      { fast: 20, slow: 100, label: "EMA(20/100)" },
      { fast: 50, slow: 200, label: "EMA(50/200)" },
    ];

    const atrTrailMults = [2, 3, 4];

    console.log("  MA Params      | Trail | Trades | WR   | PnL       | DD      | Sharpe | PF    | AvgW/AvgL");
    console.log("  " + "-".repeat(95));

    let bestPnl = -Infinity;
    let bestLabel = "";
    let bestResult: ReturnType<typeof runBacktest> | null = null;

    for (const ma of maParams) {
      // Skip combos where slow > candle count
      if (ma.slow + 10 > candles.length) continue;

      for (const trail of atrTrailMults) {
        const sigs = trendFollowingSignals(candles, ma.fast, ma.slow, 14, trail);
        if (sigs.length < 2) continue;

        const res = runBacktest(candles, sigs, {
          initialBalance: 10_000,
          positionSizePercent: 20, // 20% per trade (trend following uses bigger size)
          feePercent: 0.26,
          slippageBps: 5,
          atrTrailMult: trail,
          useTrailingStop: true,
        });

        const pnlStr = `${res.totalPnlPercent >= 0 ? "+" : ""}${res.totalPnlPercent.toFixed(2)}%`;
        const rrRatio = res.avgLoss > 0 ? (res.avgWin / res.avgLoss).toFixed(1) : "inf";
        console.log(
          `  ${ma.label.padEnd(15)} | ${String(trail).padStart(4)}x | ${String(res.totalTrades).padStart(6)} ` +
          `| ${res.winRate.toFixed(0).padStart(3)}% | ${pnlStr.padStart(9)} | ${res.maxDrawdown.toFixed(2).padStart(6)}% ` +
          `| ${res.sharpeRatio.toFixed(2).padStart(6)} | ${(res.profitFactor === Infinity ? "inf" : res.profitFactor.toFixed(2)).padStart(5)} ` +
          `| ${rrRatio}:1`
        );

        if (res.totalPnl > bestPnl) {
          bestPnl = res.totalPnl;
          bestLabel = `${tf.label} ${ma.label} trail=${trail}x`;
          bestResult = res;
        }
      }
    }

    if (bestResult) {
      console.log(`\n  Best: ${bestLabel}`);
      console.log(`  PnL: ${bestResult.totalPnlPercent >= 0 ? "+" : ""}${bestResult.totalPnlPercent.toFixed(2)}% vs Buy&Hold ${buyHoldReturn >= 0 ? "+" : ""}${buyHoldReturn.toFixed(1)}%`);
      console.log(`  Win Rate: ${bestResult.winRate.toFixed(1)}% | Avg Win: +${bestResult.avgWinPct.toFixed(2)}% | Avg Loss: -${bestResult.avgLossPct.toFixed(2)}%`);
      console.log(`  R:R Ratio: ${bestResult.avgLoss > 0 ? (bestResult.avgWin / bestResult.avgLoss).toFixed(1) : "inf"}:1`);

      // Show trades
      console.log(`\n  Trades:`);
      for (const t of bestResult.trades) {
        const icon = t.pnl > 0 ? "W" : "L";
        console.log(`    [${icon}] ${t.side.padEnd(5)} $${t.entryPrice.toFixed(0)} -> $${t.exitPrice.toFixed(0)} | ${t.pnlPercent >= 0 ? "+" : ""}${t.pnlPercent.toFixed(2)}% | ${t.reason} | ${t.entryTime.slice(0, 10)} to ${t.exitTime.slice(0, 10)}`);
      }

      // ASCII equity curve
      console.log(`\n  Equity Curve:`);
      const curve = bestResult.equityCurve;
      const minEq = Math.min(...curve);
      const maxEq = Math.max(...curve);
      for (let i = 0; i < curve.length; i++) {
        const w = 40;
        const norm = ((curve[i] - minEq) / (maxEq - minEq || 1)) * w;
        console.log(`    $${curve[i].toFixed(0).padStart(6)} |${"#".repeat(Math.max(1, Math.round(norm)))}`);
      }
    }
  }

  // Also test: no trailing stop (pure MA cross, hold until reversal)
  console.log(`\n${"=".repeat(65)}`);
  console.log("  COMPARISON: With vs Without Trailing Stops (4H, EMA 20/50)");
  console.log("=".repeat(65));

  const candles4h = await fetchKrakenOHLC("XBTUSD", 240);
  const sigs = trendFollowingSignals(candles4h, 20, 50, 14, 3);

  const withTrail = runBacktest(candles4h, sigs, {
    initialBalance: 10_000, positionSizePercent: 20,
    feePercent: 0.26, slippageBps: 5, atrTrailMult: 3, useTrailingStop: true,
  });

  const noTrail = runBacktest(candles4h, sigs, {
    initialBalance: 10_000, positionSizePercent: 20,
    feePercent: 0.26, slippageBps: 5, atrTrailMult: 3, useTrailingStop: false,
  });

  console.log(`  With trailing stop:    ${withTrail.totalTrades} trades, ${withTrail.winRate.toFixed(0)}% WR, ${withTrail.totalPnlPercent >= 0 ? "+" : ""}${withTrail.totalPnlPercent.toFixed(2)}% PnL, ${withTrail.maxDrawdown.toFixed(2)}% DD`);
  console.log(`  Without trailing stop: ${noTrail.totalTrades} trades, ${noTrail.winRate.toFixed(0)}% WR, ${noTrail.totalPnlPercent >= 0 ? "+" : ""}${noTrail.totalPnlPercent.toFixed(2)}% PnL, ${noTrail.maxDrawdown.toFixed(2)}% DD`);
  console.log();
}

main().catch(console.error);
