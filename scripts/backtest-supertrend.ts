#!/usr/bin/env npx tsx
// ============================================================
// Standalone Backtest: SuperTrend Strategy vs Real Kraken Data
// Fetches BTC/USD 1h candles from Kraken public API
// Runs bar-by-bar simulation with realistic fees & slippage
// ============================================================

// --- Inline indicator implementations (no alias deps) ---
// Using trading-signals library directly

import {
  RSI as TSrsi,
  EMA as TSema,
  ADX as TSadx,
  ATR as TSatr,
} from "trading-signals";

interface OHLC {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface BacktestTrade {
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

interface BacktestResult {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  totalPnlPercent: number;
  maxDrawdown: number;
  sharpeRatio: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  avgHoldingBars: number;
  trades: BacktestTrade[];
  equityCurve: number[];
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

function computeRSI(closes: number[], period = 14): number[] {
  const indicator = new TSrsi(period);
  const result: number[] = [];
  for (const v of closes) {
    indicator.add(v);
    const r = indicator.getResult();
    result.push(r !== null ? Number(r) : NaN);
  }
  return result;
}

function computeATR(candles: OHLC[], period = 14): number[] {
  const indicator = new TSatr(period);
  const result: number[] = [];
  for (const c of candles) {
    indicator.add({ high: c.high, low: c.low, close: c.close });
    const r = indicator.getResult();
    result.push(r !== null ? Number(r) : c.high - c.low);
  }
  return result;
}

function computeADX(candles: OHLC[], period = 14): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  const indicator = new TSadx(period);
  const adxArr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    indicator.add({ high: candles[i].high, low: candles[i].low, close: candles[i].close });
    const r = indicator.getResult();
    adxArr.push(r !== null ? Number(r) : NaN);

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

  const smoothedTR = computeEMA(tr, period);
  const smoothedPlusDM = computeEMA(plusDM, period);
  const smoothedMinusDM = computeEMA(minusDM, period);

  const plusDI = [NaN, ...smoothedPlusDM.map((v, i) => smoothedTR[i] > 0 ? (v / smoothedTR[i]) * 100 : 0)];
  const minusDI = [NaN, ...smoothedMinusDM.map((v, i) => smoothedTR[i] > 0 ? (v / smoothedTR[i]) * 100 : 0)];

  return { adx: adxArr, plusDI, minusDI };
}

function computeSuperTrend(candles: OHLC[], period = 10, multiplier = 3) {
  const atrValues = computeATR(candles, period);
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

function resampleCandles(candles: OHLC[], factor: number): OHLC[] {
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

function computeMACD(closes: number[], fast = 12, slow = 26, signalPeriod = 9) {
  const fastEma = computeEMA(closes, fast);
  const slowEma = computeEMA(closes, slow);
  const macdLine = fastEma.map((f, i) => f - slowEma[i]);
  const signalLine = computeEMA(macdLine, signalPeriod);
  const histogram = macdLine.map((m, i) => m - signalLine[i]);
  return { macd: macdLine, signal: signalLine, histogram };
}

function computeOBV(candles: OHLC[]): number[] {
  const result: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) result.push(result[i - 1] + candles[i].volume);
    else if (candles[i].close < candles[i - 1].close) result.push(result[i - 1] - candles[i].volume);
    else result.push(result[i - 1]);
  }
  return result;
}

// --- Fetch real data from Kraken ---

async function fetchKrakenOHLC(pair: string, interval: number, since?: number): Promise<OHLC[]> {
  const url = new URL("https://api.kraken.com/0/public/OHLC");
  url.searchParams.set("pair", pair);
  url.searchParams.set("interval", String(interval));
  if (since) url.searchParams.set("since", String(since));

  const resp = await fetch(url.toString());
  const json = await resp.json() as { error: string[]; result: Record<string, unknown[][]> };

  if (json.error?.length > 0) {
    throw new Error(`Kraken API error: ${json.error.join(", ")}`);
  }

  const resultKey = Object.keys(json.result).find(k => k !== "last");
  if (!resultKey) return [];

  const rawCandles = json.result[resultKey] as (string | number)[][];
  return rawCandles.map(c => ({
    time: Number(c[0]),
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[6]),
  }));
}

// Fetch multiple pages by walking backwards from now
// Kraken returns ~720 candles per call starting from `since` going forward
// So we request sequential windows: oldest first, then newer, then newest
async function fetchExtendedHistory(pair: string, interval: number, pages: number): Promise<OHLC[]> {
  let allCandles: OHLC[] = [];
  const now = Math.floor(Date.now() / 1000);
  const candleDuration = interval * 60;
  const candlesPerPage = 720;

  for (let page = 0; page < pages; page++) {
    // Calculate the start time for each page window (oldest pages first)
    const pageOffset = pages - 1 - page; // count backwards from oldest
    const since = now - (pageOffset + 1) * candlesPerPage * candleDuration;

    console.log(`  Fetching page ${page + 1}/${pages} (since ${new Date(since * 1000).toISOString().slice(0, 10)})...`);

    const url = new URL("https://api.kraken.com/0/public/OHLC");
    url.searchParams.set("pair", pair);
    url.searchParams.set("interval", String(interval));
    url.searchParams.set("since", String(since));

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      console.log(`    HTTP ${resp.status}, skipping...`);
      continue;
    }
    const json = await resp.json() as { error: string[]; result: Record<string, unknown> };

    if (json.error?.length > 0) {
      console.log(`    API error: ${json.error.join(", ")}, skipping...`);
      continue;
    }

    const resultKey = Object.keys(json.result).find(k => k !== "last");
    if (!resultKey) break;

    const rawCandles = json.result[resultKey] as (string | number)[][];
    const candles = rawCandles.map(c => ({
      time: Number(c[0]),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[6]),
    }));

    allCandles.push(...candles);
    console.log(`    Got ${candles.length} candles (total so far: ${allCandles.length})`);

    // Rate limit: 1 req/sec for Kraken public API
    if (page < pages - 1) await new Promise(r => setTimeout(r, 1500));
  }

  // Deduplicate by timestamp and sort
  const seen = new Set<number>();
  allCandles = allCandles.filter(c => {
    if (seen.has(c.time)) return false;
    seen.add(c.time);
    return true;
  }).sort((a, b) => a.time - b.time);

  console.log(`  After dedup: ${allCandles.length} unique candles`);
  return allCandles;
}

// --- SuperTrend Signal Generator (confluence scoring) ---

interface Signal {
  bar: number;
  side: "long" | "short";
  confidence: number;
  stopLoss: number;
  takeProfit: number;
  price: number;
}

function generateSignals(candles: OHLC[], fastPeriod = 10, fastMult = 1, slowMult = 1.5): Signal[] {
  const closes = candles.map(c => c.close);
  const signals: Signal[] = [];

  const stFast = computeSuperTrend(candles, fastPeriod, fastMult);
  const atrValues = computeATR(candles, 14);
  const rsiValues = computeRSI(closes, 14);
  const macdResult = computeMACD(closes);
  const ema20 = computeEMA(closes, 20);
  const ema50 = computeEMA(closes, 50);

  let lastSignalBar = -20; // minimum bars between signals
  const minBarsBetween = 6; // at least 6 bars (24h on 4h chart) between trades

  for (let i = 60; i < candles.length; i++) {
    const currentPrice = closes[i];
    const currentATR = atrValues[i];
    const currentRSI = rsiValues[i] ?? 50;

    // Minimum spacing between signals
    if (i - lastSignalBar < minBarsBetween) continue;

    // Determine bias from multiple indicators
    let bullScore = 0;
    let bearScore = 0;

    // 1. SuperTrend direction (weight: 2)
    if (stFast.direction[i] === 1) bullScore += 2;
    else bearScore += 2;

    // 2. EMA cross (weight: 1.5)
    if (ema20[i] > ema50[i]) bullScore += 1.5;
    else bearScore += 1.5;

    // 3. Price vs EMA20 (weight: 1)
    if (currentPrice > ema20[i]) bullScore += 1;
    else bearScore += 1;

    // 4. MACD histogram (weight: 1)
    if (macdResult.histogram[i] > 0) bullScore += 1;
    else bearScore += 1;

    // 5. RSI momentum (weight: 1)
    if (currentRSI > 55) bullScore += 1;
    else if (currentRSI < 45) bearScore += 1;

    const totalScore = Math.max(bullScore, bearScore);
    const threshold = 4.5; // need strong confluence

    if (totalScore < threshold) continue;

    const side: "long" | "short" = bullScore > bearScore ? "long" : "short";

    // RSI extreme filter
    if (side === "long" && currentRSI > 78) continue;
    if (side === "short" && currentRSI < 22) continue;

    const confidence = Math.min(0.93, 0.35 + totalScore * 0.08);
    const atrMultSL = 2; // 2 ATR stop loss
    const atrMultTP = 3; // 3 ATR take profit (1.5:1 R:R)

    signals.push({
      bar: i,
      side,
      confidence,
      stopLoss: side === "long"
        ? currentPrice - currentATR * atrMultSL
        : currentPrice + currentATR * atrMultSL,
      takeProfit: side === "long"
        ? currentPrice + currentATR * atrMultTP
        : currentPrice - currentATR * atrMultTP,
      price: currentPrice,
    });

    lastSignalBar = i;
  }

  return signals;
}

// --- Backtester ---

function runBacktest(
  candles: OHLC[],
  signals: Signal[],
  config: {
    initialBalance: number;
    positionSizePercent: number; // % of equity per trade
    feePercent: number;         // per side (Kraken taker = 0.26%)
    slippageBps: number;        // basis points
  }
): BacktestResult {
  const { initialBalance, positionSizePercent, feePercent, slippageBps } = config;

  let equity = initialBalance;
  let peakEquity = initialBalance;
  let maxDrawdown = 0;
  const equityCurve: number[] = [initialBalance];
  const trades: BacktestTrade[] = [];
  const returns: number[] = [];

  let inPosition = false;
  let positionSide: "long" | "short" = "long";
  let entryPrice = 0;
  let entryBar = 0;
  let stopLoss = 0;
  let takeProfit = 0;
  let positionSize = 0; // in USD notional

  for (const signal of signals) {
    const bar = signal.bar;
    const price = signal.price;

    // Check if current position should be closed first
    if (inPosition) {
      // Check stop/take profit on all bars between entry and this signal
      let exitPrice = 0;
      let exitBar = bar;
      let exitReason = "";

      // Simplified: check if price hit SL/TP between last signal and this one
      for (let b = entryBar + 1; b <= bar; b++) {
        if (positionSide === "long") {
          if (candles[b].low <= stopLoss) {
            exitPrice = stopLoss;
            exitBar = b;
            exitReason = "stop-loss";
            break;
          }
          if (candles[b].high >= takeProfit) {
            exitPrice = takeProfit;
            exitBar = b;
            exitReason = "take-profit";
            break;
          }
        } else {
          if (candles[b].high >= stopLoss) {
            exitPrice = stopLoss;
            exitBar = b;
            exitReason = "stop-loss";
            break;
          }
          if (candles[b].low <= takeProfit) {
            exitPrice = takeProfit;
            exitBar = b;
            exitReason = "take-profit";
            break;
          }
        }
      }

      // If no SL/TP hit, close on opposite signal or same bar
      if (!exitPrice && signal.side !== positionSide) {
        exitPrice = price;
        exitBar = bar;
        exitReason = "signal-reversal";
      }

      if (exitPrice) {
        // Apply slippage (adverse)
        const slippage = exitPrice * (slippageBps / 10000);
        if (positionSide === "long") exitPrice -= slippage;
        else exitPrice += slippage;

        // Calculate PnL
        const grossPnl = positionSide === "long"
          ? (exitPrice - entryPrice) / entryPrice * positionSize
          : (entryPrice - exitPrice) / entryPrice * positionSize;

        const fees = positionSize * feePercent / 100 * 2; // entry + exit
        const netPnl = grossPnl - fees;
        const pnlPercent = (netPnl / equity) * 100;

        equity += netPnl;
        returns.push(netPnl / (equity - netPnl));

        trades.push({
          entryBar,
          exitBar,
          entryPrice,
          exitPrice,
          side: positionSide,
          pnl: netPnl,
          pnlPercent,
          reason: exitReason,
          entryTime: new Date(candles[entryBar].time * 1000).toISOString(),
          exitTime: new Date(candles[exitBar].time * 1000).toISOString(),
        });

        equityCurve.push(equity);
        peakEquity = Math.max(peakEquity, equity);
        const dd = ((peakEquity - equity) / peakEquity) * 100;
        maxDrawdown = Math.max(maxDrawdown, dd);

        inPosition = false;
      }
    }

    // Open new position if not in one (or just closed)
    if (!inPosition && equity > 0) {
      positionSide = signal.side;
      positionSize = equity * positionSizePercent / 100;

      // Apply entry slippage (adverse)
      const slippage = price * (slippageBps / 10000);
      entryPrice = positionSide === "long" ? price + slippage : price - slippage;
      entryBar = bar;
      stopLoss = signal.stopLoss;
      takeProfit = signal.takeProfit;
      inPosition = true;
    }
  }

  // Close any remaining position at last bar
  if (inPosition && candles.length > 0) {
    const lastPrice = candles[candles.length - 1].close;
    const slippage = lastPrice * (slippageBps / 10000);
    const exitPrice = positionSide === "long" ? lastPrice - slippage : lastPrice + slippage;

    const grossPnl = positionSide === "long"
      ? (exitPrice - entryPrice) / entryPrice * positionSize
      : (entryPrice - exitPrice) / entryPrice * positionSize;
    const fees = positionSize * feePercent / 100 * 2;
    const netPnl = grossPnl - fees;

    equity += netPnl;
    trades.push({
      entryBar,
      exitBar: candles.length - 1,
      entryPrice,
      exitPrice,
      side: positionSide,
      pnl: netPnl,
      pnlPercent: (netPnl / (equity - netPnl)) * 100,
      reason: "end-of-data",
      entryTime: new Date(candles[entryBar].time * 1000).toISOString(),
      exitTime: new Date(candles[candles.length - 1].time * 1000).toISOString(),
    });
    equityCurve.push(equity);
    returns.push(netPnl / (equity - netPnl));
  }

  // Calculate stats
  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl <= 0);
  const totalPnl = equity - initialBalance;

  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdReturn = returns.length > 1
    ? Math.sqrt(returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / (returns.length - 1))
    : 0;
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0; // annualized

  const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));

  return {
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
    totalPnl,
    totalPnlPercent: (totalPnl / initialBalance) * 100,
    maxDrawdown,
    sharpeRatio,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgWin: winningTrades.length > 0 ? grossProfit / winningTrades.length : 0,
    avgLoss: losingTrades.length > 0 ? grossLoss / losingTrades.length : 0,
    bestTrade: trades.length > 0 ? Math.max(...trades.map(t => t.pnl)) : 0,
    worstTrade: trades.length > 0 ? Math.min(...trades.map(t => t.pnl)) : 0,
    avgHoldingBars: trades.length > 0
      ? trades.reduce((sum, t) => sum + (t.exitBar - t.entryBar), 0) / trades.length
      : 0,
    trades,
    equityCurve,
  };
}

// --- Main ---

async function main() {
  // Use 4h candles for more history (720 candles * 4h = ~120 days)
  // Single fetch is enough for meaningful backtest
  const interval = 240; // 4h in minutes
  const intervalLabel = "4h";

  console.log("=".repeat(60));
  console.log(`  SUPERTREND STRATEGY BACKTEST`);
  console.log(`  Pair: BTC/USD | Timeframe: ${intervalLabel} | Source: Kraken`);
  console.log("=".repeat(60));
  console.log();

  console.log(`Fetching BTC/USD ${intervalLabel} candles from Kraken...`);
  const candles = await fetchKrakenOHLC("XBTUSD", interval);
  console.log(`  Got ${candles.length} candles`);

  if (candles.length < 100) {
    console.error("Not enough data. Need at least 100 candles.");
    process.exit(1);
  }

  const firstDate = new Date(candles[0].time * 1000).toISOString().slice(0, 10);
  const lastDate = new Date(candles[candles.length - 1].time * 1000).toISOString().slice(0, 10);
  console.log(`  Date range: ${firstDate} to ${lastDate}`);
  console.log(`  Price range: $${Math.min(...candles.map(c => c.low)).toFixed(0)} - $${Math.max(...candles.map(c => c.high)).toFixed(0)}`);
  console.log();

  // Test multiple SuperTrend parameter combos
  const paramSets = [
    { fastPeriod: 7, fastMult: 1, slowMult: 2, label: "ST(7,1/2)" },
    { fastPeriod: 10, fastMult: 1, slowMult: 1.5, label: "ST(10,1/1.5)" },
    { fastPeriod: 10, fastMult: 1.5, slowMult: 2.5, label: "ST(10,1.5/2.5)" },
    { fastPeriod: 10, fastMult: 2, slowMult: 3, label: "ST(10,2/3)" },
    { fastPeriod: 14, fastMult: 1, slowMult: 2, label: "ST(14,1/2)" },
  ];

  // Also test different position sizes
  const positionSizes = [5, 10, 15];

  console.log("Testing parameter combinations...\n");
  console.log("  Params            | Size | Trades | WR   | PnL      | DD      | Sharpe | PF");
  console.log("  " + "-".repeat(85));

  let bestResult: BacktestResult | null = null;
  let bestLabel = "";
  let bestSignals: Signal[] = [];

  for (const params of paramSets) {
    const sigs = generateSignals(candles, params.fastPeriod, params.fastMult, params.slowMult);
    for (const pctSize of positionSizes) {
      const res = runBacktest(candles, sigs, {
        initialBalance: 10_000,
        positionSizePercent: pctSize,
        feePercent: 0.26,
        slippageBps: 5,
      });
      const pnlStr = `${res.totalPnlPercent >= 0 ? "+" : ""}${res.totalPnlPercent.toFixed(2)}%`;
      console.log(`  ${params.label.padEnd(18)} | ${String(pctSize).padStart(3)}% | ${String(res.totalTrades).padStart(6)} | ${res.winRate.toFixed(0).padStart(3)}% | ${pnlStr.padStart(8)} | ${res.maxDrawdown.toFixed(2).padStart(6)}% | ${res.sharpeRatio.toFixed(2).padStart(6)} | ${res.profitFactor === Infinity ? "  inf" : res.profitFactor.toFixed(2).padStart(5)}`);

      if (!bestResult || res.totalPnl > bestResult.totalPnl) {
        bestResult = res;
        bestLabel = `${params.label} @ ${pctSize}%`;
        bestSignals = sigs;
      }
    }
  }

  console.log(`\n  Best: ${bestLabel}\n`);
  const signals = bestSignals;
  const result = bestResult!;

  // Print results
  console.log();
  console.log("=".repeat(60));
  console.log("  RESULTS");
  console.log("=".repeat(60));
  console.log();
  console.log(`  Total Trades:      ${result.totalTrades}`);
  console.log(`  Winning:           ${result.winningTrades} (${result.winRate.toFixed(1)}%)`);
  console.log(`  Losing:            ${result.losingTrades}`);
  console.log();
  console.log(`  Total PnL:         $${result.totalPnl.toFixed(2)} (${result.totalPnlPercent.toFixed(2)}%)`);
  console.log(`  Max Drawdown:      ${result.maxDrawdown.toFixed(2)}%`);
  console.log(`  Sharpe Ratio:      ${result.sharpeRatio.toFixed(2)}`);
  console.log(`  Profit Factor:     ${result.profitFactor === Infinity ? "inf" : result.profitFactor.toFixed(2)}`);
  console.log();
  console.log(`  Avg Win:           $${result.avgWin.toFixed(2)}`);
  console.log(`  Avg Loss:          $${result.avgLoss.toFixed(2)}`);
  console.log(`  Best Trade:        $${result.bestTrade.toFixed(2)}`);
  console.log(`  Worst Trade:       $${result.worstTrade.toFixed(2)}`);
  console.log(`  Avg Holding:       ${result.avgHoldingBars.toFixed(1)} bars (${(result.avgHoldingBars).toFixed(1)}h)`);
  console.log();

  // Print last 10 trades
  console.log("-".repeat(60));
  console.log("  RECENT TRADES (last 10)");
  console.log("-".repeat(60));
  const recentTrades = result.trades.slice(-10);
  for (const t of recentTrades) {
    const icon = t.pnl > 0 ? "+" : "";
    console.log(`  ${t.side.padEnd(5)} | Entry: $${t.entryPrice.toFixed(0)} | Exit: $${t.exitPrice.toFixed(0)} | PnL: ${icon}$${t.pnl.toFixed(2)} | ${t.reason} | ${t.entryTime.slice(0, 10)}`);
  }

  // Equity curve (ASCII)
  console.log();
  console.log("-".repeat(60));
  console.log("  EQUITY CURVE");
  console.log("-".repeat(60));
  const curve = result.equityCurve;
  const minEq = Math.min(...curve);
  const maxEq = Math.max(...curve);
  const width = 50;
  const step = Math.max(1, Math.floor(curve.length / 20));
  for (let i = 0; i < curve.length; i += step) {
    const normalized = ((curve[i] - minEq) / (maxEq - minEq || 1)) * width;
    const bar = "#".repeat(Math.max(1, Math.round(normalized)));
    console.log(`  $${curve[i].toFixed(0).padStart(6)} |${bar}`);
  }
  // Always show last point
  if ((curve.length - 1) % step !== 0) {
    const last = curve[curve.length - 1];
    const normalized = ((last - minEq) / (maxEq - minEq || 1)) * width;
    const bar = "#".repeat(Math.max(1, Math.round(normalized)));
    console.log(`  $${last.toFixed(0).padStart(6)} |${bar}`);
  }

  console.log();
  console.log("=".repeat(60));
  console.log(`  Final Equity: $${(10_000 + result.totalPnl).toFixed(2)} (started: $10,000)`);
  console.log("=".repeat(60));
}

main().catch(console.error);
