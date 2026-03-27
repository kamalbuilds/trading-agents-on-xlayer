#!/usr/bin/env npx tsx
// ============================================================
// AUTONOMOUS STRATEGY EVOLUTION ENGINE
//
// Inspired by:
//   - MoonDev/OpenClaw: RBI loop, test everything, log to CSV
//   - CGA-Agent (arxiv): genetic algo + multi-agent optimization
//   - FinClaw: 484-factor DNA, arena competition, walk-forward
//   - BitcoinStrategy: trend following in crypto still works
//
// Architecture:
//   1. Strategy DNA = parameter vector (MA periods, ATR mults, indicators, risk)
//   2. Population of N strategies
//   3. Each generation: evaluate all via backtesting on real Kraken data
//   4. Fitness = weighted(Sharpe, PnL, MaxDD, ProfitFactor, WinRate)
//   5. Selection: elite (top 20%) + weighted probability
//   6. Crossover + mutation -> new generation
//   7. Repeat until convergence or max generations
//   8. Log everything to CSV
// ============================================================

import { EMA as TSema } from "trading-signals";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// Types
// ============================================================

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
}

// Strategy DNA: the parameter vector that gets evolved
interface StrategyDNA {
  id: string;
  generation: number;
  // Trend indicators
  fastMAPeriod: number;      // 5-50
  slowMAPeriod: number;      // 20-200
  maType: "ema" | "sma";
  // ATR-based risk
  atrPeriod: number;         // 7-21
  atrTrailMult: number;      // 1.0-6.0
  // Position sizing
  positionSizePct: number;   // 5-40
  // Regime filter
  useRegimeFilter: boolean;
  regimeMAPeriod: number;    // 50-200 (only trade in direction of this MA)
  // Signal filter
  minBarsBetweenTrades: number; // 0-20 (prevent overtrading)
  // Short selling
  allowShorts: boolean;
  // Entry timing
  useRedDayEntry: boolean;   // BitcoinStrategy insight: buy on red days
}

interface FitnessScore {
  total: number;             // weighted composite (0-100)
  sharpe: number;
  pnlPercent: number;
  maxDrawdown: number;
  profitFactor: number;
  winRate: number;
  totalTrades: number;
  avgWinLossRatio: number;
}

interface BacktestResult {
  dna: StrategyDNA;
  fitness: FitnessScore;
  trades: Trade[];
  equityCurve: number[];
}

// ============================================================
// Indicators
// ============================================================

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
    if (i < period - 1) { result.push(NaN); continue; }
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

function computeMA(data: number[], period: number, type: "ema" | "sma"): number[] {
  return type === "ema" ? computeEMA(data, period) : computeSMA(data, period);
}

// ============================================================
// Data Fetching (Kraken public API)
// ============================================================

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
    time: Number(c[0]), open: Number(c[1]), high: Number(c[2]),
    low: Number(c[3]), close: Number(c[4]), volume: Number(c[6]),
  }));
}

async function fetchExtendedHistory(pair: string, interval: number, pages: number): Promise<OHLC[]> {
  let allCandles: OHLC[] = [];
  const now = Math.floor(Date.now() / 1000);
  const candleDuration = interval * 60;

  for (let page = 0; page < pages; page++) {
    const pageOffset = pages - 1 - page;
    const since = now - (pageOffset + 1) * 720 * candleDuration;
    const url = new URL("https://api.kraken.com/0/public/OHLC");
    url.searchParams.set("pair", pair);
    url.searchParams.set("interval", String(interval));
    url.searchParams.set("since", String(since));

    try {
      const resp = await fetch(url.toString());
      const json = await resp.json() as { error: string[]; result: Record<string, unknown> };
      if (json.error?.length > 0) continue;
      const key = Object.keys(json.result).find(k => k !== "last");
      if (!key) break;
      const raw = json.result[key] as (string | number)[][];
      allCandles.push(...raw.map(c => ({
        time: Number(c[0]), open: Number(c[1]), high: Number(c[2]),
        low: Number(c[3]), close: Number(c[4]), volume: Number(c[6]),
      })));
    } catch { /* skip failed page */ }

    if (page < pages - 1) await new Promise(r => setTimeout(r, 1200));
  }

  const seen = new Set<number>();
  allCandles = allCandles.filter(c => {
    if (seen.has(c.time)) return false;
    seen.add(c.time);
    return true;
  }).sort((a, b) => a.time - b.time);

  return allCandles;
}

// ============================================================
// Signal Generation from DNA
// ============================================================

interface Signal {
  bar: number;
  side: "long" | "short";
  price: number;
  atr: number;
}

function generateSignals(candles: OHLC[], dna: StrategyDNA): Signal[] {
  const closes = candles.map(c => c.close);
  const fast = computeMA(closes, dna.fastMAPeriod, dna.maType);
  const slow = computeMA(closes, dna.slowMAPeriod, dna.maType);
  const atrVals = computeATR(candles, dna.atrPeriod);

  // Regime filter: only trade in direction of long-term MA
  let regimeMA: number[] | null = null;
  if (dna.useRegimeFilter) {
    regimeMA = computeMA(closes, dna.regimeMAPeriod, "ema");
  }

  const signals: Signal[] = [];
  let lastSignalBar = -999;
  const warmup = Math.max(dna.fastMAPeriod, dna.slowMAPeriod, dna.atrPeriod, dna.regimeMAPeriod) + 5;

  for (let i = warmup; i < candles.length; i++) {
    // Min bars between trades filter
    if (i - lastSignalBar < dna.minBarsBetweenTrades) continue;

    const fastAbove = fast[i] > slow[i];
    const prevFastAbove = fast[i - 1] > slow[i - 1];

    // Red day entry filter (BitcoinStrategy insight)
    if (dna.useRedDayEntry && candles[i].close > candles[i].open) {
      // Green candle, skip (we want to enter on red candles for better prices)
      // But still detect the crossover, just delay entry
    }

    // Detect MA crossover
    if (fastAbove && !prevFastAbove) {
      // Bullish crossover
      if (dna.useRegimeFilter && regimeMA && closes[i] < regimeMA[i]) continue; // below regime MA, skip long
      if (dna.useRedDayEntry && candles[i].close > candles[i].open) {
        // Look ahead for next red candle (max 3 bars)
        for (let j = i + 1; j <= Math.min(i + 3, candles.length - 1); j++) {
          if (candles[j].close < candles[j].open) {
            signals.push({ bar: j, side: "long", price: closes[j], atr: atrVals[j] });
            lastSignalBar = j;
            break;
          }
        }
      } else {
        signals.push({ bar: i, side: "long", price: closes[i], atr: atrVals[i] });
        lastSignalBar = i;
      }
    } else if (!fastAbove && prevFastAbove) {
      // Bearish crossover
      if (dna.allowShorts) {
        if (dna.useRegimeFilter && regimeMA && closes[i] > regimeMA[i]) continue;
        signals.push({ bar: i, side: "short", price: closes[i], atr: atrVals[i] });
        lastSignalBar = i;
      } else {
        // Exit signal for longs (we'll handle this in the backtester via reversal)
        signals.push({ bar: i, side: "short", price: closes[i], atr: atrVals[i] });
        lastSignalBar = i;
      }
    }
  }

  return signals;
}

// ============================================================
// Backtester (proven from our previous work)
// ============================================================

function runBacktest(candles: OHLC[], signals: Signal[], dna: StrategyDNA): {
  trades: Trade[];
  equityCurve: number[];
  finalEquity: number;
  maxDrawdown: number;
} {
  const initialBalance = 10_000;
  const feePercent = 0.26;
  const slippageBps = 5;

  let equity = initialBalance;
  let peakEquity = initialBalance;
  let maxDrawdown = 0;
  const equityCurve: number[] = [initialBalance];
  const trades: Trade[] = [];

  let inPosition = false;
  let posSide: "long" | "short" = "long";
  let entryPrice = 0;
  let entryBar = 0;
  let positionSize = 0;
  let bestPrice = 0;

  function closePos(exitPrice: number, exitBar: number, reason: string) {
    const slip = exitPrice * (slippageBps / 10000);
    const adjExit = posSide === "long" ? exitPrice - slip : exitPrice + slip;
    const grossPnl = posSide === "long"
      ? (adjExit - entryPrice) / entryPrice * positionSize
      : (entryPrice - adjExit) / entryPrice * positionSize;
    const fees = positionSize * feePercent / 100 * 2;
    const netPnl = grossPnl - fees;

    equity += netPnl;
    trades.push({
      entryBar, exitBar, entryPrice, exitPrice: adjExit,
      side: posSide, pnl: netPnl,
      pnlPercent: (netPnl / (equity - netPnl)) * 100,
      reason,
    });

    equityCurve.push(equity);
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdown = Math.max(maxDrawdown, ((peakEquity - equity) / peakEquity) * 100);
    inPosition = false;
  }

  for (let si = 0; si < signals.length; si++) {
    const sig = signals[si];
    const nextSigBar = si + 1 < signals.length ? signals[si + 1].bar : candles.length;

    // Check trailing stop for current position
    if (inPosition) {
      let stopped = false;
      for (let b = entryBar + 1; b < Math.min(sig.bar, candles.length); b++) {
        if (posSide === "long") {
          bestPrice = Math.max(bestPrice, candles[b].high);
          const trail = bestPrice - sig.atr * dna.atrTrailMult;
          if (candles[b].low <= trail) {
            closePos(trail, b, "trailing-stop");
            stopped = true;
            break;
          }
        } else {
          bestPrice = Math.min(bestPrice, candles[b].low);
          const trail = bestPrice + sig.atr * dna.atrTrailMult;
          if (candles[b].high >= trail) {
            closePos(trail, b, "trailing-stop");
            stopped = true;
            break;
          }
        }
      }

      if (!stopped && inPosition && sig.side !== posSide) {
        closePos(sig.price, sig.bar, "signal-reversal");
      }
    }

    // Open new position
    if (!inPosition && equity > 0) {
      // Don't go short if shorts disabled (but use the signal to close longs)
      if (!dna.allowShorts && sig.side === "short") continue;

      posSide = sig.side;
      positionSize = equity * dna.positionSizePct / 100;
      const slip = sig.price * (slippageBps / 10000);
      entryPrice = posSide === "long" ? sig.price + slip : sig.price - slip;
      entryBar = sig.bar;
      bestPrice = sig.price;
      inPosition = true;

      // Check trailing stop until next signal
      for (let b = sig.bar + 1; b < Math.min(nextSigBar, candles.length); b++) {
        if (posSide === "long") {
          bestPrice = Math.max(bestPrice, candles[b].high);
          const trail = bestPrice - sig.atr * dna.atrTrailMult;
          if (candles[b].low <= trail) {
            closePos(trail, b, "trailing-stop");
            break;
          }
        } else {
          bestPrice = Math.min(bestPrice, candles[b].low);
          const trail = bestPrice + sig.atr * dna.atrTrailMult;
          if (candles[b].high >= trail) {
            closePos(trail, b, "trailing-stop");
            break;
          }
        }
      }
    }
  }

  // Close remaining at end
  if (inPosition) {
    closePos(candles[candles.length - 1].close, candles.length - 1, "end-of-data");
  }

  return { trades, equityCurve, finalEquity: equity, maxDrawdown };
}

// ============================================================
// Fitness Function (CGA-Agent inspired: multi-metric weighted)
// ============================================================

function calculateFitness(trades: Trade[], equityCurve: number[], maxDrawdown: number): FitnessScore {
  const initialBalance = 10_000;
  const finalEquity = equityCurve[equityCurve.length - 1] || initialBalance;
  const pnlPercent = ((finalEquity - initialBalance) / initialBalance) * 100;

  const winning = trades.filter(t => t.pnl > 0);
  const losing = trades.filter(t => t.pnl <= 0);
  const winRate = trades.length > 0 ? (winning.length / trades.length) * 100 : 0;
  const grossProfit = winning.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losing.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 10 : 0;

  const avgWin = winning.length > 0 ? grossProfit / winning.length : 0;
  const avgLoss = losing.length > 0 ? grossLoss / losing.length : 0;
  const avgWinLossRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 10 : 0;

  // Sharpe ratio (annualized)
  const returns = trades.map(t => t.pnl / initialBalance);
  const avgRet = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdRet = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / (returns.length - 1))
    : 0;
  const sharpe = stdRet > 0 ? (avgRet / stdRet) * Math.sqrt(252) : 0;

  // Weighted composite fitness (0-100 scale)
  // Weights inspired by CGA-Agent paper
  const w = {
    sharpe: 0.25,          // risk-adjusted returns
    pnl: 0.20,            // raw profitability
    maxDD: 0.20,           // capital preservation
    profitFactor: 0.15,    // gross profit / gross loss
    winRate: 0.10,         // psychological comfort
    tradeCount: 0.10,      // enough trades for statistical significance
  };

  // Normalize each metric to 0-100
  const sharpeScore = Math.max(0, Math.min(100, (sharpe + 2) * 25)); // -2 to 2 -> 0 to 100
  const pnlScore = Math.max(0, Math.min(100, (pnlPercent + 10) * 5)); // -10% to 10% -> 0 to 100
  const ddScore = Math.max(0, 100 - maxDrawdown * 5); // 0% DD = 100, 20% DD = 0
  const pfScore = Math.max(0, Math.min(100, profitFactor * 33)); // 0 to 3 -> 0 to 100
  const wrScore = winRate; // already 0-100
  const tradeScore = Math.min(100, trades.length * 5); // 20 trades = 100

  const total =
    w.sharpe * sharpeScore +
    w.pnl * pnlScore +
    w.maxDD * ddScore +
    w.profitFactor * pfScore +
    w.winRate * wrScore +
    w.tradeCount * tradeScore;

  return {
    total,
    sharpe,
    pnlPercent,
    maxDrawdown,
    profitFactor,
    winRate,
    totalTrades: trades.length,
    avgWinLossRatio,
  };
}

// ============================================================
// Genetic Operators
// ============================================================

let dnaCounter = 0;

function randomDNA(generation: number): StrategyDNA {
  dnaCounter++;
  return {
    id: `gen${generation}_${dnaCounter}`,
    generation,
    fastMAPeriod: randInt(5, 50),
    slowMAPeriod: randInt(30, 200),
    maType: Math.random() > 0.5 ? "ema" : "sma",
    atrPeriod: randInt(7, 21),
    atrTrailMult: randFloat(1.0, 6.0),
    positionSizePct: randInt(5, 40),
    useRegimeFilter: Math.random() > 0.4,
    regimeMAPeriod: randInt(50, 200),
    minBarsBetweenTrades: randInt(0, 15),
    allowShorts: Math.random() > 0.5,
    useRedDayEntry: Math.random() > 0.6,
  };
}

function crossover(parent1: StrategyDNA, parent2: StrategyDNA, generation: number): StrategyDNA {
  dnaCounter++;
  // Uniform crossover: each gene randomly from parent1 or parent2
  const pick = () => Math.random() > 0.5;
  return {
    id: `gen${generation}_${dnaCounter}`,
    generation,
    fastMAPeriod: pick() ? parent1.fastMAPeriod : parent2.fastMAPeriod,
    slowMAPeriod: pick() ? parent1.slowMAPeriod : parent2.slowMAPeriod,
    maType: pick() ? parent1.maType : parent2.maType,
    atrPeriod: pick() ? parent1.atrPeriod : parent2.atrPeriod,
    atrTrailMult: pick() ? parent1.atrTrailMult : parent2.atrTrailMult,
    positionSizePct: pick() ? parent1.positionSizePct : parent2.positionSizePct,
    useRegimeFilter: pick() ? parent1.useRegimeFilter : parent2.useRegimeFilter,
    regimeMAPeriod: pick() ? parent1.regimeMAPeriod : parent2.regimeMAPeriod,
    minBarsBetweenTrades: pick() ? parent1.minBarsBetweenTrades : parent2.minBarsBetweenTrades,
    allowShorts: pick() ? parent1.allowShorts : parent2.allowShorts,
    useRedDayEntry: pick() ? parent1.useRedDayEntry : parent2.useRedDayEntry,
  };
}

function mutate(dna: StrategyDNA, generation: number, mutationRate = 0.15): StrategyDNA {
  dnaCounter++;
  const d = { ...dna, id: `gen${generation}_${dnaCounter}`, generation };

  if (Math.random() < mutationRate) d.fastMAPeriod = clamp(d.fastMAPeriod + randInt(-10, 10), 3, 50);
  if (Math.random() < mutationRate) d.slowMAPeriod = clamp(d.slowMAPeriod + randInt(-30, 30), 20, 200);
  if (Math.random() < mutationRate) d.maType = d.maType === "ema" ? "sma" : "ema";
  if (Math.random() < mutationRate) d.atrPeriod = clamp(d.atrPeriod + randInt(-5, 5), 5, 25);
  if (Math.random() < mutationRate) d.atrTrailMult = clamp(d.atrTrailMult + randFloat(-1.5, 1.5), 0.5, 8.0);
  if (Math.random() < mutationRate) d.positionSizePct = clamp(d.positionSizePct + randInt(-10, 10), 3, 50);
  if (Math.random() < mutationRate) d.useRegimeFilter = !d.useRegimeFilter;
  if (Math.random() < mutationRate) d.regimeMAPeriod = clamp(d.regimeMAPeriod + randInt(-30, 30), 30, 250);
  if (Math.random() < mutationRate) d.minBarsBetweenTrades = clamp(d.minBarsBetweenTrades + randInt(-5, 5), 0, 20);
  if (Math.random() < mutationRate) d.allowShorts = !d.allowShorts;
  if (Math.random() < mutationRate) d.useRedDayEntry = !d.useRedDayEntry;

  // Ensure fast < slow
  if (d.fastMAPeriod >= d.slowMAPeriod) {
    d.fastMAPeriod = Math.max(3, d.slowMAPeriod - 10);
  }

  return d;
}

// Selection: elite (top 20%) + weighted probability (CGA-Agent method)
function selectParents(population: BacktestResult[]): BacktestResult[] {
  const sorted = [...population].sort((a, b) => b.fitness.total - a.fitness.total);
  const eliteCount = Math.max(2, Math.floor(population.length * 0.2));
  const elite = sorted.slice(0, eliteCount);

  // Weighted probability selection for rest
  const minFitness = Math.min(...population.map(p => p.fitness.total));
  const weights = population.map(p => p.fitness.total - minFitness + 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const selected = [...elite];
  while (selected.length < population.length) {
    let r = Math.random() * totalWeight;
    for (let i = 0; i < population.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        selected.push(population[i]);
        break;
      }
    }
  }

  return selected;
}

// ============================================================
// Utility
// ============================================================

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ============================================================
// CSV Logger (MoonDev style: log everything)
// ============================================================

function initCSV(filePath: string) {
  const header = [
    "id", "generation", "fitness",
    "sharpe", "pnl_pct", "max_dd", "profit_factor", "win_rate", "trades", "avg_wl_ratio",
    "fast_ma", "slow_ma", "ma_type", "atr_period", "atr_trail",
    "pos_size_pct", "regime_filter", "regime_ma", "min_bars", "allow_shorts", "red_day_entry",
  ].join(",");
  fs.writeFileSync(filePath, header + "\n");
}

function appendCSV(filePath: string, result: BacktestResult) {
  const d = result.dna;
  const f = result.fitness;
  const row = [
    d.id, d.generation, f.total.toFixed(2),
    f.sharpe.toFixed(3), f.pnlPercent.toFixed(3), f.maxDrawdown.toFixed(3),
    f.profitFactor.toFixed(3), f.winRate.toFixed(1), f.totalTrades, f.avgWinLossRatio.toFixed(2),
    d.fastMAPeriod, d.slowMAPeriod, d.maType, d.atrPeriod, d.atrTrailMult.toFixed(2),
    d.positionSizePct, d.useRegimeFilter, d.regimeMAPeriod, d.minBarsBetweenTrades,
    d.allowShorts, d.useRedDayEntry,
  ].join(",");
  fs.appendFileSync(filePath, row + "\n");
}

// ============================================================
// Main Evolution Loop
// ============================================================

async function main() {
  const POPULATION_SIZE = 30;
  const GENERATIONS = 10;
  const ELITE_PRESERVE = 4;

  console.log("=".repeat(70));
  console.log("  AUTONOMOUS STRATEGY EVOLUTION ENGINE");
  console.log("  Population: " + POPULATION_SIZE + " | Generations: " + GENERATIONS);
  console.log("=".repeat(70));

  // Fetch data
  console.log("\n[1/4] Fetching real market data from Kraken...");

  // Use multiple timeframes and assets for robustness (FinClaw arena style)
  const datasets: { label: string; candles: OHLC[] }[] = [];

  // Daily BTC (primary)
  const btcDaily = await fetchKrakenOHLC("XBTUSD", 1440);
  datasets.push({ label: "BTC/USD 1D", candles: btcDaily });
  console.log(`  BTC/USD 1D: ${btcDaily.length} candles`);

  await new Promise(r => setTimeout(r, 1200));

  // 4H BTC
  const btc4h = await fetchKrakenOHLC("XBTUSD", 240);
  datasets.push({ label: "BTC/USD 4H", candles: btc4h });
  console.log(`  BTC/USD 4H: ${btc4h.length} candles`);

  await new Promise(r => setTimeout(r, 1200));

  // Daily ETH (cross-validation: strategy must work on multiple assets)
  const ethDaily = await fetchKrakenOHLC("XETHZUSD", 1440);
  datasets.push({ label: "ETH/USD 1D", candles: ethDaily });
  console.log(`  ETH/USD 1D: ${ethDaily.length} candles`);

  // Setup CSV logging
  const outDir = path.join(process.cwd(), "scripts", "evolution-results");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const csvPath = path.join(outDir, `evolution_${timestamp}.csv`);
  initCSV(csvPath);
  console.log(`  Results logging to: ${csvPath}`);

  // [2/4] Initialize population
  console.log(`\n[2/4] Generating initial population of ${POPULATION_SIZE} random strategies...`);
  let population: StrategyDNA[] = [];
  for (let i = 0; i < POPULATION_SIZE; i++) {
    population.push(randomDNA(0));
  }

  // Seed with known good params (our proven trend follower)
  population[0] = {
    ...population[0],
    fastMAPeriod: 20, slowMAPeriod: 100, maType: "ema",
    atrPeriod: 14, atrTrailMult: 4.0, positionSizePct: 20,
    useRegimeFilter: false, regimeMAPeriod: 100,
    minBarsBetweenTrades: 0, allowShorts: true, useRedDayEntry: false,
  };
  population[1] = {
    ...population[1],
    fastMAPeriod: 12, slowMAPeriod: 33, maType: "sma", // BitcoinStrategy's ETH optimal
    atrPeriod: 14, atrTrailMult: 3.0, positionSizePct: 15,
    useRegimeFilter: true, regimeMAPeriod: 100,
    minBarsBetweenTrades: 2, allowShorts: false, useRedDayEntry: true,
  };

  // [3/4] Evolution loop
  console.log(`\n[3/4] Starting evolution...`);
  let allTimeLeaderboard: BacktestResult[] = [];

  for (let gen = 0; gen < GENERATIONS; gen++) {
    const genStart = Date.now();
    console.log(`\n${"─".repeat(70)}`);
    console.log(`  Generation ${gen + 1}/${GENERATIONS}`);
    console.log("─".repeat(70));

    // Evaluate each strategy across ALL datasets (arena competition)
    const results: BacktestResult[] = [];

    for (const dna of population) {
      let combinedFitness: FitnessScore = {
        total: 0, sharpe: 0, pnlPercent: 0, maxDrawdown: 0,
        profitFactor: 0, winRate: 0, totalTrades: 0, avgWinLossRatio: 0,
      };
      let allTrades: Trade[] = [];
      let bestCurve: number[] = [10_000];

      for (const ds of datasets) {
        if (ds.candles.length < 100) continue;

        const signals = generateSignals(ds.candles, dna);
        if (signals.length < 1) continue;

        const bt = runBacktest(ds.candles, signals, dna);
        const fitness = calculateFitness(bt.trades, bt.equityCurve, bt.maxDrawdown);

        // Aggregate fitness across datasets (average)
        combinedFitness.sharpe += fitness.sharpe;
        combinedFitness.pnlPercent += fitness.pnlPercent;
        combinedFitness.maxDrawdown += fitness.maxDrawdown;
        combinedFitness.profitFactor += fitness.profitFactor;
        combinedFitness.winRate += fitness.winRate;
        combinedFitness.totalTrades += fitness.totalTrades;
        combinedFitness.avgWinLossRatio += fitness.avgWinLossRatio;
        combinedFitness.total += fitness.total;

        allTrades.push(...bt.trades);
        if (bt.equityCurve.length > bestCurve.length) bestCurve = bt.equityCurve;
      }

      // Average across datasets
      const n = datasets.filter(d => d.candles.length >= 100).length || 1;
      combinedFitness.total /= n;
      combinedFitness.sharpe /= n;
      combinedFitness.pnlPercent /= n;
      combinedFitness.maxDrawdown /= n;
      combinedFitness.profitFactor /= n;
      combinedFitness.winRate /= n;
      combinedFitness.avgWinLossRatio /= n;

      const result: BacktestResult = {
        dna,
        fitness: combinedFitness,
        trades: allTrades,
        equityCurve: bestCurve,
      };

      results.push(result);
      appendCSV(csvPath, result);
    }

    // Sort by fitness
    results.sort((a, b) => b.fitness.total - a.fitness.total);

    // Print generation leaderboard
    console.log(`\n  Top 5 this generation:`);
    console.log(`  ${"Rank".padEnd(6)} ${"ID".padEnd(18)} ${"Fitness".padStart(8)} ${"PnL%".padStart(8)} ${"Sharpe".padStart(8)} ${"MaxDD%".padStart(8)} ${"WR%".padStart(6)} ${"Trades".padStart(7)} ${"PF".padStart(6)}`);
    for (let i = 0; i < Math.min(5, results.length); i++) {
      const r = results[i];
      console.log(
        `  ${String(i + 1).padEnd(6)} ${r.dna.id.padEnd(18)} ` +
        `${r.fitness.total.toFixed(1).padStart(8)} ` +
        `${(r.fitness.pnlPercent >= 0 ? "+" : "") + r.fitness.pnlPercent.toFixed(2).padStart(7)}% ` +
        `${r.fitness.sharpe.toFixed(2).padStart(8)} ` +
        `${r.fitness.maxDrawdown.toFixed(2).padStart(7)}% ` +
        `${r.fitness.winRate.toFixed(0).padStart(5)}% ` +
        `${String(r.fitness.totalTrades).padStart(7)} ` +
        `${r.fitness.profitFactor.toFixed(2).padStart(6)}`
      );
    }

    // Show best DNA
    const best = results[0];
    console.log(`\n  Best DNA: MA(${best.dna.fastMAPeriod}/${best.dna.slowMAPeriod} ${best.dna.maType}) ` +
      `ATR(${best.dna.atrPeriod}, trail=${best.dna.atrTrailMult.toFixed(1)}x) ` +
      `size=${best.dna.positionSizePct}% ` +
      `regime=${best.dna.useRegimeFilter ? best.dna.regimeMAPeriod : "off"} ` +
      `shorts=${best.dna.allowShorts} redDay=${best.dna.useRedDayEntry}`);

    // Update all-time leaderboard
    allTimeLeaderboard.push(...results);
    allTimeLeaderboard.sort((a, b) => b.fitness.total - a.fitness.total);
    allTimeLeaderboard = allTimeLeaderboard.slice(0, 20); // keep top 20

    const elapsed = ((Date.now() - genStart) / 1000).toFixed(1);
    console.log(`  Generation time: ${elapsed}s`);

    // Create next generation (skip last gen)
    if (gen < GENERATIONS - 1) {
      const selected = selectParents(results);
      const nextPopulation: StrategyDNA[] = [];
      const nextGen = gen + 1;

      // Preserve elite unchanged
      for (let i = 0; i < ELITE_PRESERVE && i < selected.length; i++) {
        nextPopulation.push({ ...selected[i].dna, id: `gen${nextGen}_elite${i}`, generation: nextGen });
      }

      // Fill rest with crossover + mutation
      while (nextPopulation.length < POPULATION_SIZE) {
        const p1 = selected[randInt(0, Math.min(selected.length - 1, 9))];
        const p2 = selected[randInt(0, Math.min(selected.length - 1, 9))];
        let child = crossover(p1.dna, p2.dna, nextGen);
        child = mutate(child, nextGen, 0.2);

        // Ensure fast < slow
        if (child.fastMAPeriod >= child.slowMAPeriod) {
          child.fastMAPeriod = Math.max(3, child.slowMAPeriod - 10);
        }

        nextPopulation.push(child);
      }

      population = nextPopulation;
    }
  }

  // [4/4] Final leaderboard
  console.log(`\n${"=".repeat(70)}`);
  console.log("  ALL-TIME LEADERBOARD (Top 10)");
  console.log("=".repeat(70));
  console.log(`  ${"Rank".padEnd(5)} ${"ID".padEnd(18)} ${"Fit".padStart(6)} ${"PnL%".padStart(8)} ${"Shrp".padStart(6)} ${"DD%".padStart(7)} ${"WR".padStart(5)} ${"PF".padStart(6)} | DNA`);
  console.log("  " + "─".repeat(95));

  for (let i = 0; i < Math.min(10, allTimeLeaderboard.length); i++) {
    const r = allTimeLeaderboard[i];
    const d = r.dna;
    console.log(
      `  ${String(i + 1).padEnd(5)} ${d.id.padEnd(18)} ` +
      `${r.fitness.total.toFixed(1).padStart(6)} ` +
      `${(r.fitness.pnlPercent >= 0 ? "+" : "") + r.fitness.pnlPercent.toFixed(2).padStart(7)}% ` +
      `${r.fitness.sharpe.toFixed(2).padStart(6)} ` +
      `${r.fitness.maxDrawdown.toFixed(2).padStart(6)}% ` +
      `${r.fitness.winRate.toFixed(0).padStart(4)}% ` +
      `${r.fitness.profitFactor.toFixed(2).padStart(6)} ` +
      `| MA(${d.fastMAPeriod}/${d.slowMAPeriod} ${d.maType}) ATR(${d.atrPeriod},${d.atrTrailMult.toFixed(1)}) ` +
      `sz=${d.positionSizePct}% reg=${d.useRegimeFilter ? d.regimeMAPeriod : "off"} sh=${d.allowShorts ? "Y" : "N"} rd=${d.useRedDayEntry ? "Y" : "N"}`
    );
  }

  // Winner details
  const winner = allTimeLeaderboard[0];
  if (winner) {
    console.log(`\n${"=".repeat(70)}`);
    console.log("  WINNER");
    console.log("=".repeat(70));
    console.log(`  Strategy: ${winner.dna.id}`);
    console.log(`  Fast MA: ${winner.dna.fastMAPeriod} (${winner.dna.maType})`);
    console.log(`  Slow MA: ${winner.dna.slowMAPeriod} (${winner.dna.maType})`);
    console.log(`  ATR Period: ${winner.dna.atrPeriod}`);
    console.log(`  ATR Trail Multiplier: ${winner.dna.atrTrailMult.toFixed(2)}x`);
    console.log(`  Position Size: ${winner.dna.positionSizePct}%`);
    console.log(`  Regime Filter: ${winner.dna.useRegimeFilter ? `EMA(${winner.dna.regimeMAPeriod})` : "OFF"}`);
    console.log(`  Allow Shorts: ${winner.dna.allowShorts ? "YES" : "NO"}`);
    console.log(`  Red Day Entry: ${winner.dna.useRedDayEntry ? "YES" : "NO"}`);
    console.log(`  Min Bars Between Trades: ${winner.dna.minBarsBetweenTrades}`);
    console.log();
    console.log(`  Performance (avg across BTC 1D, BTC 4H, ETH 1D):`);
    console.log(`    Fitness Score: ${winner.fitness.total.toFixed(1)}/100`);
    console.log(`    PnL: ${winner.fitness.pnlPercent >= 0 ? "+" : ""}${winner.fitness.pnlPercent.toFixed(2)}%`);
    console.log(`    Sharpe Ratio: ${winner.fitness.sharpe.toFixed(3)}`);
    console.log(`    Max Drawdown: ${winner.fitness.maxDrawdown.toFixed(2)}%`);
    console.log(`    Profit Factor: ${winner.fitness.profitFactor.toFixed(2)}`);
    console.log(`    Win Rate: ${winner.fitness.winRate.toFixed(1)}%`);
    console.log(`    Total Trades: ${winner.fitness.totalTrades}`);
    console.log(`    Avg Win/Loss Ratio: ${winner.fitness.avgWinLossRatio.toFixed(2)}:1`);

    // Save winner DNA to JSON
    const winnerPath = path.join(outDir, `winner_${timestamp}.json`);
    fs.writeFileSync(winnerPath, JSON.stringify({
      dna: winner.dna,
      fitness: winner.fitness,
      timestamp: new Date().toISOString(),
      datasets: datasets.map(d => ({ label: d.label, candles: d.candles.length })),
    }, null, 2));
    console.log(`\n  Winner saved to: ${winnerPath}`);
  }

  console.log(`\n  Full results CSV: ${csvPath}`);
  console.log(`  Total strategies evaluated: ${POPULATION_SIZE * GENERATIONS}`);
  console.log();
}

main().catch(console.error);
