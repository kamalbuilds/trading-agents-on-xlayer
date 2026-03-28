// Server-side trading engine using TradingView-grade strategies
// Runs SuperTrend, Ichimoku, Momentum, Mean Reversion, Breakout, Ensemble
// against real OHLC candles from CoinGecko with live prices
// State persists via globalThis to survive Next.js module reloads in dev mode

import { fetchLivePrices, fetchOHLCHistory, pairToGeckoId, type LivePrice } from "./prices";
import { INITIAL_BALANCE, getRiskLimits } from "@/lib/config";
import { createRiskEngine, type RiskEngine } from "@/lib/risk/risk-engine";
import { analyzeEnsemble, type EnsembleResult } from "@/lib/strategies/ensemble";
import type {
  OHLC,
  Order,
  Position,
  AgentMessage,
  PortfolioState,
  TradeSignal,
  AgentRole,
} from "@/lib/types";

// --- CycleResult type ---
type CycleResult = {
  portfolio: PortfolioState;
  recentTrades: Order[];
  agentMessages: AgentMessage[];
  isRunning: boolean;
  mode: string;
  errors: string[];
  strategyBreakdown?: Record<string, { analysis: string; signal?: string; indicators: Record<string, number> }>;
};

// --- Persistent server state (via globalThis to survive Next.js module reloads) ---
interface EngineState {
  balance: number;
  positions: Position[];
  completedTrades: Order[];
  agentMessages: AgentMessage[];
  peakEquity: number;
  isRunning: boolean;
  cycleCount: number;
  candleCache: Record<string, OHLC[]>;
  startTime: number;
  lastEnsembleResult: EnsembleResult | null;
  loopTimer: ReturnType<typeof setTimeout> | null;
  lastCycleResult: CycleResult | null;
  riskEngine: RiskEngine | null;
}

const g = globalThis as unknown as { __tradex_engine?: EngineState };

function S(): EngineState {
  if (!g.__tradex_engine) {
    g.__tradex_engine = {
      balance: INITIAL_BALANCE,
      positions: [],
      completedTrades: [],
      agentMessages: [],
      peakEquity: INITIAL_BALANCE,
      isRunning: false,
      cycleCount: 0,
      candleCache: {},
      startTime: Date.now(),
      lastEnsembleResult: null,
      loopTimer: null,
      lastCycleResult: null,
      riskEngine: null,
    };
  }
  return g.__tradex_engine;
}

// --- Agent message helpers ---
function agentMsg(role: AgentRole, content: string): AgentMessage {
  const s = S();
  const msg: AgentMessage = { role, content, timestamp: Date.now() };
  s.agentMessages.push(msg);
  if (s.agentMessages.length > 200) s.agentMessages = s.agentMessages.slice(-200);
  return msg;
}

// --- Append live price as new candle to OHLC history ---
function appendLiveCandle(pair: string, livePrice: LivePrice): void {
  const s = S();
  if (!s.candleCache[pair]) s.candleCache[pair] = [];
  const candles = s.candleCache[pair];
  const now = Date.now();
  const candleDuration = 4 * 3600 * 1000; // 4h candles
  const candleStart = Math.floor(now / candleDuration) * candleDuration;

  const last = candles[candles.length - 1];
  if (last && last.time === candleStart) {
    last.high = Math.max(last.high, livePrice.price);
    last.low = Math.min(last.low, livePrice.price);
    last.close = livePrice.price;
    last.volume += livePrice.volume24h / (24 * 6);
  } else {
    candles.push({
      time: candleStart,
      open: livePrice.price,
      high: livePrice.price,
      low: livePrice.price,
      close: livePrice.price,
      volume: livePrice.volume24h / (24 * 6),
    });
  }

  if (candles.length > 200) s.candleCache[pair] = candles.slice(-200);
}

// --- Risk management ---
function getRiskEngine(): RiskEngine {
  const s = S();
  if (!s.riskEngine) {
    s.riskEngine = createRiskEngine({ limits: getRiskLimits() });
  }
  return s.riskEngine;
}

function assessRisk(signal: TradeSignal, currentPrice: number): { approved: boolean; positionSize: number; reason: string } {
  const s = S();
  const limits = getRiskLimits();
  const equity = getEquity(currentPrice);
  const engine = getRiskEngine();

  const portfolio: PortfolioState = {
    balance: s.balance,
    equity,
    positions: s.positions,
    openOrders: [],
    totalPnl: 0,
    totalTrades: s.completedTrades.length,
    winRate: 0,
    sharpeRatio: 0,
    maxDrawdown: s.peakEquity > 0 ? ((s.peakEquity - equity) / s.peakEquity) * 100 : 0,
    timestamp: Date.now(),
  };

  engine.updateEquity(equity);
  const assessment = engine.assess(signal, portfolio);

  if (!assessment.approved) {
    return { approved: false, positionSize: 0, reason: assessment.reasons.join("; ") };
  }

  const maxPositionValue = equity * (limits.maxPositionSize / 100);
  const positionSize = assessment.positionSizeRecommended > 0
    ? assessment.positionSizeRecommended
    : maxPositionValue / currentPrice;
  return { approved: true, positionSize, reason: "Risk check passed" };
}

function getEquity(currentBtcPrice?: number): number {
  const s = S();
  let posValue = 0;
  for (const p of s.positions) {
    const price = currentBtcPrice && p.pair === "BTC/USD" ? currentBtcPrice : p.currentPrice;
    posValue += price * p.amount;
  }
  return s.balance + posValue;
}

// --- Trade execution ---
function executePaperTrade(signal: TradeSignal, price: number, amount: number): Order {
  const s = S();
  const fee = price * amount * 0.001;
  const order: Order = {
    id: `trade-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    pair: signal.pair,
    side: signal.side,
    type: "market",
    price,
    amount,
    filled: amount,
    status: "filled",
    fee,
    timestamp: Date.now(),
    strategy: signal.strategy,
  };

  if (signal.side === "buy") {
    const existing = s.positions.find((p) => p.pair === signal.pair);
    if (existing) {
      const totalAmount = existing.amount + amount;
      existing.entryPrice = (existing.entryPrice * existing.amount + price * amount) / totalAmount;
      existing.amount = totalAmount;
      existing.currentPrice = price;
    } else {
      s.positions.push({
        pair: signal.pair,
        side: "buy",
        entryPrice: price,
        currentPrice: price,
        amount,
        unrealizedPnl: 0,
        realizedPnl: 0,
        openTime: Date.now(),
        strategy: signal.strategy,
      });
    }
    s.balance -= price * amount + fee;
  } else {
    const existing = s.positions.find((p) => p.pair === signal.pair);
    if (existing) {
      const sellAmount = Math.min(amount, existing.amount);
      const pnl = (price - existing.entryPrice) * sellAmount - fee;
      existing.realizedPnl += pnl;
      existing.amount -= sellAmount;
      s.balance += price * sellAmount - fee;

      if (existing.amount < 0.00000001) {
        s.positions = s.positions.filter((p) => p !== existing);
      }
    }
  }

  s.completedTrades.push(order);
  if (s.completedTrades.length > 500) s.completedTrades = s.completedTrades.slice(-500);

  return order;
}

// --- Main cycle ---
export async function runTradingCycle(): Promise<CycleResult> {
  const s = S();
  s.cycleCount++;
  const errors: string[] = [];

  try {
    // 1. Fetch real live prices
    const livePrices = await fetchLivePrices();
    const btcPrice = livePrices["BTC/USD"]?.price ?? 0;
    const ethPrice = livePrices["ETH/USD"]?.price ?? 0;

    if (btcPrice === 0) {
      errors.push("Could not fetch BTC price");
      agentMsg("market_analyst", "Failed to fetch live prices from CoinGecko");
    }

    // 2. Update position prices
    for (const pos of s.positions) {
      const livePrice = livePrices[pos.pair]?.price;
      if (livePrice) {
        pos.currentPrice = livePrice;
        pos.unrealizedPnl = (livePrice - pos.entryPrice) * pos.amount;
      }
    }

    // 3. Market overview
    const btcChange = livePrices["BTC/USD"]?.change24h ?? 0;
    const ethChange = livePrices["ETH/USD"]?.change24h ?? 0;
    agentMsg(
      "market_analyst",
      `Cycle #${s.cycleCount} | BTC: $${btcPrice.toLocaleString()} (${btcChange >= 0 ? "+" : ""}${btcChange.toFixed(2)}%) | ETH: $${ethPrice.toLocaleString()} (${ethChange >= 0 ? "+" : ""}${ethChange.toFixed(2)}%)`
    );

    // 4. Load OHLC candle history
    const pairs = ["BTC/USD", "ETH/USD"];
    for (const pair of pairs) {
      const geckoId = pairToGeckoId(pair);
      if (!geckoId) continue;

      if (!s.candleCache[pair] || s.candleCache[pair].length < 60 || s.cycleCount % 30 === 1) {
        try {
          const historicalCandles = await fetchOHLCHistory(geckoId, 14);
          s.candleCache[pair] = historicalCandles;
          agentMsg("market_analyst", `Loaded ${historicalCandles.length} OHLC candles for ${pair} (14-day history)`);
        } catch (err) {
          agentMsg("market_analyst", `Could not fetch OHLC history for ${pair}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (livePrices[pair]) {
        appendLiveCandle(pair, livePrices[pair]);
      }
    }

    // 5. Run strategies on each pair
    const allSignals: TradeSignal[] = [];
    const strategyBreakdown: Record<string, { analysis: string; signal?: string; indicators: Record<string, number> }> = {};

    for (const pair of pairs) {
      const candles = s.candleCache[pair];
      if (!candles || candles.length < 60) {
        agentMsg("strategist", `${pair}: Need 60+ candles, have ${candles?.length ?? 0}. Building history...`);
        continue;
      }

      const ensembleResult = analyzeEnsemble({ candles }, { pair });
      s.lastEnsembleResult = ensembleResult;

      for (const [stratName, stratResult] of Object.entries(ensembleResult.strategyResults)) {
        strategyBreakdown[`${pair}:${stratName}`] = {
          analysis: stratResult.analysis,
          signal: stratResult.signals.length > 0
            ? `${stratResult.signals[0].side.toUpperCase()} (${(stratResult.signals[0].confidence * 100).toFixed(0)}%)`
            : undefined,
          indicators: stratResult.indicators,
        };
      }

      agentMsg(
        "strategist",
        `${pair} ENSEMBLE [${ensembleResult.consensus.toUpperCase()}] strength: ${(ensembleResult.consensusStrength * 100).toFixed(0)}% | ` +
        `Active strategies: ${Object.keys(ensembleResult.strategyResults).length} | ` +
        `Signals: ${ensembleResult.aggregatedSignals.length}`
      );

      for (const [name, result] of Object.entries(ensembleResult.strategyResults)) {
        if (result.signals.length > 0) {
          const sig = result.signals[0];
          agentMsg(
            "strategist",
            `  [${name}] ${sig.side.toUpperCase()} ${(sig.confidence * 100).toFixed(0)}% - ${sig.reasoning.slice(0, 120)}`
          );
        }
      }

      for (const signal of ensembleResult.aggregatedSignals) {
        allSignals.push({ ...signal, pair });
      }
    }

    // 6. Strategy consensus summary
    if (allSignals.length > 0) {
      const buySignals = allSignals.filter((s) => s.side === "buy");
      const sellSignals = allSignals.filter((s) => s.side === "sell");
      agentMsg(
        "strategist",
        `TOTAL: ${allSignals.length} ensemble signals: ${buySignals.length} buy, ${sellSignals.length} sell. ` +
        allSignals.map((s) => `${s.strategy} ${s.pair} ${s.side} (${(s.confidence * 100).toFixed(0)}%)`).join(" | ")
      );
    } else {
      agentMsg("strategist", `No actionable signals this cycle. Strategies see no clear opportunity.`);
    }

    // 7. Risk assessment and execution
    for (const signal of allSignals) {
      const price = livePrices[signal.pair]?.price ?? 0;
      if (price === 0) continue;

      if (signal.side === "sell") {
        const existing = s.positions.find((p) => p.pair === signal.pair);
        if (!existing) {
          agentMsg("risk_manager", `Skipping sell ${signal.pair}: no open position`);
          continue;
        }
      }

      const risk = assessRisk(signal, price);

      if (!risk.approved) {
        agentMsg("risk_manager", `REJECTED ${signal.strategy} ${signal.pair} ${signal.side}: ${risk.reason}`);
        continue;
      }

      agentMsg("risk_manager", `APPROVED ${signal.strategy} ${signal.pair} ${signal.side}: size ${risk.positionSize.toFixed(6)} at $${price.toLocaleString()}`);

      const amount = signal.side === "sell"
        ? (s.positions.find((p) => p.pair === signal.pair)?.amount ?? 0)
        : risk.positionSize;

      if (amount <= 0) continue;

      const order = executePaperTrade(signal, price, amount);
      agentMsg(
        "executor",
        `EXECUTED ${order.side.toUpperCase()} ${order.amount.toFixed(6)} ${order.pair} @ $${order.price.toLocaleString()} | Fee: $${order.fee.toFixed(2)} | Strategy: ${signal.strategy}`
      );
    }

    // 8. Check stop-losses on existing positions
    for (const pos of [...s.positions]) {
      const price = livePrices[pos.pair]?.price;
      if (!price) continue;

      const limits = getRiskLimits();
      const loss = ((price - pos.entryPrice) / pos.entryPrice) * 100;

      if (loss < -limits.stopLossPercent) {
        agentMsg("risk_manager", `STOP-LOSS triggered for ${pos.pair}: loss ${loss.toFixed(2)}% exceeds -${limits.stopLossPercent}%`);
        const stopSignal: TradeSignal = {
          id: `stop-${Date.now()}`,
          strategy: "risk:stop-loss",
          pair: pos.pair,
          side: "sell",
          type: "stop-loss",
          price,
          amount: pos.amount,
          confidence: 1,
          reasoning: `Stop-loss at ${loss.toFixed(2)}% loss`,
          timestamp: Date.now(),
        };
        executePaperTrade(stopSignal, price, pos.amount);
        agentMsg("executor", `STOP-LOSS SOLD ${pos.amount.toFixed(6)} ${pos.pair} @ $${price.toLocaleString()}`);
      }

      if (loss > limits.takeProfitPercent) {
        agentMsg("risk_manager", `TAKE-PROFIT triggered for ${pos.pair}: gain ${loss.toFixed(2)}% exceeds +${limits.takeProfitPercent}%`);
        const tpSignal: TradeSignal = {
          id: `tp-${Date.now()}`,
          strategy: "risk:take-profit",
          pair: pos.pair,
          side: "sell",
          type: "take-profit",
          price,
          amount: pos.amount,
          confidence: 1,
          reasoning: `Take-profit at ${loss.toFixed(2)}% gain`,
          timestamp: Date.now(),
        };
        executePaperTrade(tpSignal, price, pos.amount);
        agentMsg("executor", `TAKE-PROFIT SOLD ${pos.amount.toFixed(6)} ${pos.pair} @ $${price.toLocaleString()}`);
      }
    }

    // 9. Portfolio update
    const equity = getEquity(btcPrice);
    if (equity > s.peakEquity) s.peakEquity = equity;
    const totalPnl = equity - INITIAL_BALANCE;
    const drawdown = s.peakEquity > 0 ? ((s.peakEquity - equity) / s.peakEquity) * 100 : 0;

    agentMsg(
      "portfolio_manager",
      `Equity: $${equity.toFixed(2)} | PnL: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)} | Positions: ${s.positions.length} | Drawdown: ${drawdown.toFixed(2)}%`
    );

    const sellTrades = s.completedTrades.filter((t) => t.side === "sell");
    let wins = 0;
    for (const sell of sellTrades) {
      const buys = s.completedTrades.filter(
        (t) => t.pair === sell.pair && t.side === "buy" && t.timestamp < sell.timestamp
      );
      if (buys.length > 0) {
        const avgBuy = buys.reduce((sum, t) => sum + t.price * t.filled, 0) / buys.reduce((sum, t) => sum + t.filled, 0);
        if (sell.price > avgBuy) wins++;
      }
    }

    const portfolio: PortfolioState = {
      balance: s.balance,
      equity,
      positions: s.positions.map((p) => ({ ...p })),
      openOrders: [],
      totalPnl,
      totalTrades: s.completedTrades.length,
      winRate: sellTrades.length > 0 ? wins / sellTrades.length : 0,
      sharpeRatio: calculateSharpe(),
      maxDrawdown: drawdown,
      timestamp: Date.now(),
    };

    return {
      portfolio,
      recentTrades: s.completedTrades.slice(-50),
      agentMessages: s.agentMessages.slice(-100),
      isRunning: s.isRunning,
      mode: "paper",
      errors,
      strategyBreakdown,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    agentMsg("executor", `ERROR: ${msg}`);

    return {
      portfolio: {
        balance: s.balance,
        equity: getEquity(),
        positions: s.positions.map((p) => ({ ...p })),
        openOrders: [],
        totalPnl: getEquity() - INITIAL_BALANCE,
        totalTrades: s.completedTrades.length,
        winRate: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        timestamp: Date.now(),
      },
      recentTrades: s.completedTrades.slice(-50),
      agentMessages: s.agentMessages.slice(-100),
      isRunning: s.isRunning,
      mode: "paper",
      errors,
    };
  }
}

// --- Engine loop: runs cycles continuously while isRunning ---
const CYCLE_INTERVAL_MS = 15_000;

async function engineLoop(): Promise<void> {
  const s = S();
  if (!s.isRunning) return;
  try {
    s.lastCycleResult = await runTradingCycle();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    agentMsg("executor", `Cycle error (will retry): ${msg}`);
  }
  if (s.isRunning) {
    s.loopTimer = setTimeout(engineLoop, CYCLE_INTERVAL_MS);
  }
}

export function setRunning(val: boolean): void {
  const s = S();
  s.isRunning = val;
  if (val) {
    s.startTime = Date.now();
    agentMsg("executor", "Trading engine STARTED - Running TradingView-grade strategies (SuperTrend, Ichimoku, Momentum, Mean Reversion, Breakout, Ensemble)");
    if (s.loopTimer) clearTimeout(s.loopTimer);
    engineLoop();
  } else {
    if (s.loopTimer) { clearTimeout(s.loopTimer); s.loopTimer = null; }
    agentMsg("executor", "Trading engine STOPPED");
  }
}

export function getLastCycleResult(): CycleResult | null {
  return S().lastCycleResult;
}

export function getRunning(): boolean {
  return S().isRunning;
}

export function getStartTime(): number {
  return S().startTime;
}

export function resetEngine(): void {
  const s = S();
  s.balance = INITIAL_BALANCE;
  s.positions = [];
  s.completedTrades = [];
  s.agentMessages = [];
  s.peakEquity = INITIAL_BALANCE;
  s.cycleCount = 0;
  s.candleCache = {};
  s.lastEnsembleResult = null;
  s.lastCycleResult = null;
  agentMsg("portfolio_manager", "Engine reset. Starting balance: $" + INITIAL_BALANCE.toLocaleString());
}

export function getLastEnsemble(): EnsembleResult | null {
  return S().lastEnsembleResult;
}

function calculateSharpe(): number {
  const s = S();
  if (s.completedTrades.length < 4) return 0;
  const returns: number[] = [];
  const sells = s.completedTrades.filter((t) => t.side === "sell" && t.price > 0);
  const usedBuys = new Set<number>();

  for (const sell of sells) {
    const buyIdx = s.completedTrades.findIndex(
      (t, idx) => t.pair === sell.pair && t.side === "buy" && t.timestamp < sell.timestamp && !usedBuys.has(idx)
    );
    if (buyIdx >= 0) {
      usedBuys.add(buyIdx);
      returns.push((sell.price - s.completedTrades[buyIdx].price) / s.completedTrades[buyIdx].price);
    }
  }

  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  return stdDev === 0 ? 0 : (mean / stdDev) * Math.sqrt(365);
}
