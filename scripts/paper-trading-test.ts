// Paper Trading E2E Test
// Tests the full pipeline: Kraken data → Strategy → Risk Engine → Execution
// Uses Kraken's public REST API (no keys needed) + our strategy + risk engine

import { analyzeEvolvedTrend } from "../src/lib/strategies/evolved-trend";
import { analyzeEnsemble } from "../src/lib/strategies/ensemble";
import { createRiskEngine, getDefaultRiskLimits } from "../src/lib/risk";
import type { OHLC, TradeSignal, PortfolioState } from "../src/lib/types";

// --- Kraken Public API (no keys needed) ---

async function fetchKrakenOHLC(pair: string, interval: number): Promise<OHLC[]> {
  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`;
  const res = await fetch(url);
  const json = await res.json() as { result: Record<string, unknown[][]>; error: string[] };

  if (json.error?.length > 0) {
    throw new Error(`Kraken API error: ${json.error.join(", ")}`);
  }

  const dataKey = Object.keys(json.result).find(k => k !== "last")!;
  const raw = json.result[dataKey] as unknown[][];

  return raw.map(c => ({
    time: Number(c[0]) * 1000,
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[6]),
  }));
}

async function fetchKrakenTicker(pair: string): Promise<{ price: number; bid: number; ask: number }> {
  const url = `https://api.kraken.com/0/public/Ticker?pair=${pair}`;
  const res = await fetch(url);
  const json = await res.json() as { result: Record<string, Record<string, unknown>> };
  const key = Object.keys(json.result)[0];
  const data = json.result[key];

  return {
    price: Number((data.c as string[])[0]),
    bid: Number((data.b as string[])[0]),
    ask: Number((data.a as string[])[0]),
  };
}

// --- Paper Trading Simulator ---

interface PaperTrade {
  id: number;
  signal: TradeSignal;
  riskApproved: boolean;
  riskReason: string;
  executedPrice: number;
  amount: number;
  fee: number;
  timestamp: number;
}

interface PaperPortfolio {
  cash: number;
  positions: Record<string, { amount: number; avgPrice: number }>;
  trades: PaperTrade[];
  startingEquity: number;
}

function getPortfolioValue(portfolio: PaperPortfolio, prices: Record<string, number>): number {
  let value = portfolio.cash;
  for (const [asset, pos] of Object.entries(portfolio.positions)) {
    const pair = `${asset}/USD`;
    const price = prices[pair] || pos.avgPrice;
    value += pos.amount * price;
  }
  return value;
}

function toPortfolioState(portfolio: PaperPortfolio, prices: Record<string, number>): PortfolioState {
  const equity = getPortfolioValue(portfolio, prices);
  return {
    balance: portfolio.cash,
    equity,
    positions: Object.entries(portfolio.positions).map(([asset, pos]) => ({
      pair: `${asset}/USD`,
      side: "buy" as const,
      entryPrice: pos.avgPrice,
      currentPrice: prices[`${asset}/USD`] || pos.avgPrice,
      amount: pos.amount,
      unrealizedPnl: pos.amount * ((prices[`${asset}/USD`] || pos.avgPrice) - pos.avgPrice),
      realizedPnl: 0,
      openTime: Date.now(),
    })),
    openOrders: [],
    totalPnl: equity - portfolio.startingEquity,
    totalTrades: portfolio.trades.length,
    maxDrawdown: 0,
    winRate: 0,
    sharpeRatio: 0,
    timestamp: Date.now(),
  };
}

// --- Main Test ---

async function main() {
  console.log("=== Paper Trading E2E Test ===\n");

  // 1. Fetch real market data
  console.log("1. Fetching real Kraken market data...");
  const [btcCandles1D, btcCandles4H, ethCandles1D, btcTicker, ethTicker] = await Promise.all([
    fetchKrakenOHLC("XBTUSD", 1440),
    fetchKrakenOHLC("XBTUSD", 240),
    fetchKrakenOHLC("ETHUSD", 1440),
    fetchKrakenTicker("XBTUSD"),
    fetchKrakenTicker("ETHUSD"),
  ]);

  console.log(`   BTC/USD 1D: ${btcCandles1D.length} candles (${new Date(btcCandles1D[0].time).toISOString().split("T")[0]} to ${new Date(btcCandles1D[btcCandles1D.length - 1].time).toISOString().split("T")[0]})`);
  console.log(`   BTC/USD 4H: ${btcCandles4H.length} candles`);
  console.log(`   ETH/USD 1D: ${ethCandles1D.length} candles`);
  console.log(`   BTC price: $${btcTicker.price.toFixed(2)}`);
  console.log(`   ETH price: $${ethTicker.price.toFixed(2)}\n`);

  // 2. Run evolved strategy
  console.log("2. Running Evolved Trend Strategy (SMA 25/105 + ATR 13/5.23x)...");
  const btcSignal = analyzeEvolvedTrend(btcCandles1D, { pair: "BTC/USD" });
  const ethSignal = analyzeEvolvedTrend(ethCandles1D, { pair: "ETH/USD" });
  const btc4hSignal = analyzeEvolvedTrend(btcCandles4H, { pair: "BTC/USD" });

  console.log(`   BTC 1D: ${btcSignal.analysis}`);
  console.log(`   ETH 1D: ${ethSignal.analysis}`);
  console.log(`   BTC 4H: ${btc4hSignal.analysis}\n`);

  // 3. Run ensemble strategy
  console.log("3. Running Full Ensemble Strategy (8 strategies)...");
  const ensembleResult = analyzeEnsemble({ candles: btcCandles1D }, { pair: "BTC/USD" });
  console.log(`   Consensus: ${ensembleResult.consensus.toUpperCase()} (strength: ${(ensembleResult.consensusStrength * 100).toFixed(0)}%)`);
  console.log(`   Active signals: ${ensembleResult.aggregatedSignals.length}`);
  console.log(`   Strategy results:`);
  for (const [name, result] of Object.entries(ensembleResult.strategyResults)) {
    const signalStr = result.signals.length > 0 ? `${result.signals[0].side.toUpperCase()} (${(result.signals[0].confidence * 100).toFixed(0)}%)` : "no signal";
    console.log(`     [${name}] ${signalStr}`);
  }
  console.log();

  // 4. Risk assessment
  console.log("4. Risk Engine Assessment...");
  const riskEngine = createRiskEngine({ limits: getDefaultRiskLimits() });

  const portfolio: PaperPortfolio = {
    cash: 100000,
    positions: {},
    trades: [],
    startingEquity: 100000,
  };

  const prices: Record<string, number> = {
    "BTC/USD": btcTicker.price,
    "ETH/USD": ethTicker.price,
  };

  const portfolioState = toPortfolioState(portfolio, prices);

  // Assess all signals from all strategies
  const allSignals = [
    ...btcSignal.signals,
    ...ethSignal.signals,
    ...ensembleResult.aggregatedSignals,
  ];

  if (allSignals.length === 0) {
    console.log("   No signals generated. Market conditions don't meet entry criteria.");
    console.log("   This is correct behavior: the strategy avoids trading when uncertain.\n");
  } else {
    for (const signal of allSignals) {
      // Size the position respecting risk limits (max 4% of equity per position)
      if (signal.amount === 0) {
        const maxPositionPct = 0.04; // 4% of equity, under the 5% risk limit
        const price = signal.price || prices[signal.pair] || btcTicker.price;
        signal.amount = (portfolio.cash * maxPositionPct) / price;
      }

      const assessment = riskEngine.assess(signal, portfolioState);
      console.log(`   Signal: ${signal.side.toUpperCase()} ${signal.amount.toFixed(4)} ${signal.pair}`);
      console.log(`   Strategy: ${signal.strategy}, Confidence: ${(signal.confidence * 100).toFixed(0)}%`);
      console.log(`   Risk: ${assessment.approved ? "APPROVED" : "BLOCKED"} (score: ${assessment.riskScore.toFixed(2)})`);
      if (!assessment.approved) {
        console.log(`   Reasons: ${assessment.reasons.join(", ")}`);
      }
      console.log();

      // Simulate execution if approved
      if (assessment.approved) {
        const tradePrice = signal.price || btcTicker.price;
        const fee = signal.amount * tradePrice * 0.0026;

        portfolio.trades.push({
          id: portfolio.trades.length + 1,
          signal,
          riskApproved: true,
          riskReason: "passed",
          executedPrice: tradePrice,
          amount: signal.amount,
          fee,
          timestamp: Date.now(),
        });

        if (signal.side === "buy") {
          const asset = signal.pair.split("/")[0];
          const existing = portfolio.positions[asset] || { amount: 0, avgPrice: 0 };
          const totalCost = existing.amount * existing.avgPrice + signal.amount * tradePrice;
          const totalAmount = existing.amount + signal.amount;
          portfolio.positions[asset] = {
            amount: totalAmount,
            avgPrice: totalCost / totalAmount,
          };
          portfolio.cash -= signal.amount * tradePrice + fee;
        }

        console.log(`   EXECUTED: ${signal.side.toUpperCase()} ${signal.amount.toFixed(4)} ${signal.pair} @ $${tradePrice.toFixed(2)}`);
        console.log(`   Fee: $${fee.toFixed(2)}`);
        console.log(`   Cash remaining: $${portfolio.cash.toFixed(2)}\n`);
      }
    }
  }

  // 5. Portfolio summary
  console.log("5. Portfolio Summary");
  const finalEquity = getPortfolioValue(portfolio, prices);
  const pnl = finalEquity - portfolio.startingEquity;
  const pnlPct = (pnl / portfolio.startingEquity) * 100;

  console.log(`   Starting equity: $${portfolio.startingEquity.toFixed(2)}`);
  console.log(`   Current equity:  $${finalEquity.toFixed(2)}`);
  console.log(`   PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`);
  console.log(`   Cash: $${portfolio.cash.toFixed(2)}`);
  console.log(`   Positions:`);
  for (const [asset, pos] of Object.entries(portfolio.positions)) {
    const currentPrice = prices[`${asset}/USD`] || pos.avgPrice;
    const posValue = pos.amount * currentPrice;
    const posPnl = pos.amount * (currentPrice - pos.avgPrice);
    console.log(`     ${asset}: ${pos.amount.toFixed(4)} @ avg $${pos.avgPrice.toFixed(2)} = $${posValue.toFixed(2)} (PnL: $${posPnl.toFixed(2)})`);
  }
  console.log(`   Total trades executed: ${portfolio.trades.length}`);
  console.log(`   Total fees paid: $${portfolio.trades.reduce((s, t) => s + t.fee, 0).toFixed(2)}`);

  // 6. Risk engine state
  console.log("\n6. Risk Engine State");
  const drawdown = riskEngine.getDrawdownState();
  const breakers = riskEngine.getCircuitBreakers().getActiveBreakers();
  console.log(`   Current drawdown: ${drawdown.currentDrawdown.toFixed(2)}%`);
  console.log(`   High water mark: $${drawdown.highWaterMark.toFixed(2)}`);
  console.log(`   Active circuit breakers: ${breakers.length > 0 ? breakers.join(", ") : "none"}`);

  console.log("\n=== Paper Trading E2E Test Complete ===");
}

main().catch(console.error);
