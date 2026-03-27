// Smart Money Strategy - Nansen On-Chain Intelligence
// Uses Nansen CLI to detect whale accumulation/distribution patterns
// Signals based on: smart money netflows, DEX trades, and holdings concentration
// Best for swing trades (4h-1d), complements technical strategies with on-chain data

import type { TradeSignal, StrategyResult } from "@/lib/types";
import type { SmartMoneySignal } from "@/lib/nansen";

export interface SmartMoneyConfig {
  pair: string;
  chain: string;
  netflowThreshold: number;       // USD threshold for significant netflow
  buyPressureThreshold: number;   // 0-1, above this = bullish
  sellPressureThreshold: number;  // 0-1, below this = bearish
  minHolderCount: number;         // Min whale holders for signal
  minConfidence: number;          // Min confidence to emit signal
}

const DEFAULT_CONFIG: SmartMoneyConfig = {
  pair: "BTC/USD",
  chain: "ethereum",
  netflowThreshold: 500_000,
  buyPressureThreshold: 0.6,
  sellPressureThreshold: 0.4,
  minHolderCount: 5,
  minConfidence: 0.35,
};

export function analyzeSmartMoney(
  signal: SmartMoneySignal | null,
  config: Partial<SmartMoneyConfig> = {}
): StrategyResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!signal) {
    return {
      strategy: "smart_money",
      signals: [],
      analysis: "No Nansen data available",
      indicators: {},
      timestamp: Date.now(),
    };
  }

  const { aggregated, netflows, topBuys, topHoldings } = signal;
  let bullScore = 0;
  let bearScore = 0;
  const reasons: string[] = [];

  // 1. Net flow direction (24h)
  if (aggregated.totalNetflow24h > cfg.netflowThreshold) {
    bullScore += 1.5;
    reasons.push(`24h netflow +$${(aggregated.totalNetflow24h / 1e6).toFixed(1)}M`);
  } else if (aggregated.totalNetflow24h < -cfg.netflowThreshold) {
    bearScore += 1.5;
    reasons.push(`24h netflow -$${(Math.abs(aggregated.totalNetflow24h) / 1e6).toFixed(1)}M`);
  }

  // 2. Net flow direction (7d, lower weight as it's less timely)
  if (aggregated.totalNetflow7d > cfg.netflowThreshold * 3) {
    bullScore += 1;
    reasons.push(`7d netflow +$${(aggregated.totalNetflow7d / 1e6).toFixed(1)}M`);
  } else if (aggregated.totalNetflow7d < -cfg.netflowThreshold * 3) {
    bearScore += 1;
    reasons.push(`7d netflow -$${(Math.abs(aggregated.totalNetflow7d) / 1e6).toFixed(1)}M`);
  }

  // 3. Buy pressure from DEX trades
  if (aggregated.buyPressure > cfg.buyPressureThreshold) {
    bullScore += 1;
    reasons.push(`Buy pressure ${(aggregated.buyPressure * 100).toFixed(0)}%`);
  } else if (aggregated.buyPressure < cfg.sellPressureThreshold) {
    bearScore += 1;
    reasons.push(`Sell pressure ${((1 - aggregated.buyPressure) * 100).toFixed(0)}%`);
  }

  // 4. Whale activity classification
  if (aggregated.whaleActivity === "accumulating") {
    bullScore += 1.5;
    reasons.push("Whales accumulating");
  } else if (aggregated.whaleActivity === "distributing") {
    bearScore += 1.5;
    reasons.push("Whales distributing");
  }

  // 5. Holdings concentration (many whales holding = strong conviction)
  const highConvictionTokens = topHoldings.filter(h => h.holders_count >= cfg.minHolderCount);
  if (highConvictionTokens.length > 3) {
    bullScore += 0.5;
    reasons.push(`${highConvictionTokens.length} high-conviction holdings`);
  }

  // 6. Accumulation tokens count vs distribution
  if (aggregated.topAccumulated.length > aggregated.topDistributed.length) {
    bullScore += 0.5;
    reasons.push(`${aggregated.topAccumulated.length} tokens accumulated`);
  } else if (aggregated.topDistributed.length > aggregated.topAccumulated.length) {
    bearScore += 0.5;
    reasons.push(`${aggregated.topDistributed.length} tokens distributed`);
  }

  // 7. Trade volume intensity (more trades = higher conviction)
  if (topBuys.length >= 15) {
    const totalValue = topBuys.reduce((s, t) => s + t.trade_value_usd, 0);
    if (totalValue > 100_000) {
      bullScore += 0.5;
      reasons.push(`Active trading ($${(totalValue / 1e6).toFixed(1)}M volume)`);
    }
  }

  // Generate signal
  const signals: TradeSignal[] = [];
  let analysis = "";
  const minConfluence = 2.5;

  const netScore = bullScore - bearScore;
  const absScore = Math.max(bullScore, bearScore);

  if (bullScore >= minConfluence && netScore > 0.5) {
    const confidence = Math.min(0.88, 0.35 + bullScore * 0.08);
    if (confidence >= cfg.minConfidence) {
      signals.push({
        id: `sm-${Date.now()}`,
        strategy: "smart_money",
        pair: cfg.pair,
        side: "buy",
        type: "market",
        amount: 0,
        confidence,
        reasoning: `Smart money bullish (${bullScore.toFixed(1)}/7): ${reasons.join(", ")}`,
        timestamp: Date.now(),
        metadata: {
          chain: cfg.chain,
          netflow24h: aggregated.totalNetflow24h,
          netflow7d: aggregated.totalNetflow7d,
          buyPressure: aggregated.buyPressure,
          whaleActivity: aggregated.whaleActivity,
          topAccumulated: aggregated.topAccumulated,
          confluenceScore: bullScore,
        },
      });
      analysis = `BULLISH SMART MONEY (${bullScore.toFixed(1)}/7). ${reasons.join(", ")}`;
    }
  } else if (bearScore >= minConfluence && netScore < -0.5) {
    const confidence = Math.min(0.88, 0.35 + bearScore * 0.08);
    if (confidence >= cfg.minConfidence) {
      signals.push({
        id: `sm-${Date.now()}`,
        strategy: "smart_money",
        pair: cfg.pair,
        side: "sell",
        type: "market",
        amount: 0,
        confidence,
        reasoning: `Smart money bearish (${bearScore.toFixed(1)}/7): ${reasons.join(", ")}`,
        timestamp: Date.now(),
        metadata: {
          chain: cfg.chain,
          netflow24h: aggregated.totalNetflow24h,
          netflow7d: aggregated.totalNetflow7d,
          buyPressure: aggregated.buyPressure,
          whaleActivity: aggregated.whaleActivity,
          topDistributed: aggregated.topDistributed,
          confluenceScore: bearScore,
        },
      });
      analysis = `BEARISH SMART MONEY (${bearScore.toFixed(1)}/7). ${reasons.join(", ")}`;
    }
  }

  if (!analysis) {
    analysis = `No signal (bull: ${bullScore.toFixed(1)}, bear: ${bearScore.toFixed(1)}, need ${minConfluence}). Whale: ${aggregated.whaleActivity}, buy pressure: ${(aggregated.buyPressure * 100).toFixed(0)}%`;
  }

  return {
    strategy: "smart_money",
    signals,
    analysis,
    indicators: {
      netflow24h: aggregated.totalNetflow24h,
      netflow7d: aggregated.totalNetflow7d,
      buyPressure: aggregated.buyPressure,
      whaleActivityScore: aggregated.whaleActivity === "accumulating" ? 1 : aggregated.whaleActivity === "distributing" ? -1 : 0,
      holdersConviction: highConvictionTokens.length,
      accumulatedCount: aggregated.topAccumulated.length,
      distributedCount: aggregated.topDistributed.length,
      tradeCount: topBuys.length,
      confluenceBull: bullScore,
      confluenceBear: bearScore,
      dataConfidence: aggregated.confidence,
    },
    timestamp: Date.now(),
  };
}
