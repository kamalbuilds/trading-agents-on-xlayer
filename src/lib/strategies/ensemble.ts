// Multi-Strategy Ensemble
// Weighted signal aggregation with confidence-based position sizing
// Allocation: 30% funding arb, 25% trend, 20% mean reversion, 15% momentum, 10% breakout

import type { OHLC, TradeSignal, StrategyResult, StrategyType } from "@/lib/types";
import { ENSEMBLE_WEIGHTS } from "@/lib/config";
import { analyzeTrendFollowing } from "./trend-following";
import { analyzeMeanReversion } from "./mean-reversion";
import { analyzeMomentum } from "./momentum";
import { analyzeFundingRate, type FundingRateData } from "./funding-rate";
import { analyzeBreakout } from "./breakout";
import { analyzeIchimokuCloud } from "./ichimoku-cloud";
import { analyzeSuperTrend } from "./supertrend";
import { analyzeEvolvedTrend } from "./evolved-trend";

export interface EnsembleConfig {
  weights: Record<string, number>;
  minConfidence: number;       // Min confidence to include signal
  maxSignals: number;          // Max concurrent signals
  correlationPenalty: number;  // Reduce confidence for correlated signals
  pair: string;
}

const DEFAULT_CONFIG: EnsembleConfig = {
  weights: ENSEMBLE_WEIGHTS,
  minConfidence: 0.55,
  maxSignals: 3,
  correlationPenalty: 0.15,
  pair: "BTC/USD",
};

export interface EnsembleInput {
  candles: OHLC[];
  fundingData?: FundingRateData;
  historicalFundingRates?: number[];
}

export interface EnsembleResult extends StrategyResult {
  strategyResults: Record<string, StrategyResult>;
  aggregatedSignals: TradeSignal[];
  consensus: "bullish" | "bearish" | "neutral" | "mixed";
  consensusStrength: number;
}

export function analyzeEnsemble(
  input: EnsembleInput,
  config: Partial<EnsembleConfig> = {}
): EnsembleResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { candles, fundingData, historicalFundingRates } = input;

  const strategyResults: Record<string, StrategyResult> = {};

  // Run each strategy
  strategyResults.trend_following = analyzeTrendFollowing(candles, { pair: cfg.pair });
  strategyResults.mean_reversion = analyzeMeanReversion(candles, { pair: cfg.pair });
  strategyResults.momentum = analyzeMomentum(candles, { pair: cfg.pair });
  strategyResults.breakout = analyzeBreakout(candles, { pair: cfg.pair });
  strategyResults.ichimoku_cloud = analyzeIchimokuCloud(candles, { pair: cfg.pair });
  strategyResults.supertrend = analyzeSuperTrend(candles, { pair: cfg.pair });

  // Evolved trend strategy (genetically optimized, highest backtest performance)
  strategyResults.evolved_trend = analyzeEvolvedTrend(candles, { pair: cfg.pair });

  if (fundingData && historicalFundingRates) {
    strategyResults.funding_rate_arb = analyzeFundingRate(
      fundingData,
      historicalFundingRates,
      { pair: cfg.pair }
    );
  }

  // Collect all signals with weights applied
  const weightedSignals: (TradeSignal & { weight: number; strategyType: string })[] = [];

  for (const [stratType, result] of Object.entries(strategyResults)) {
    const weight = cfg.weights[stratType] ?? 0.1;
    for (const signal of result.signals) {
      if (signal.confidence >= cfg.minConfidence) {
        weightedSignals.push({
          ...signal,
          weight,
          strategyType: stratType,
          confidence: signal.confidence,
        });
      }
    }
  }

  // Calculate consensus using weight * confidence for proper influence
  let bullishScore = 0;
  let bearishScore = 0;
  for (const sig of weightedSignals) {
    const weightedConfidence = sig.confidence * sig.weight;
    if (sig.side === "buy") bullishScore += weightedConfidence;
    else bearishScore += weightedConfidence;
  }

  // Also factor in strategies with no signal (implicit neutral)
  const totalWeight = Object.values(cfg.weights).reduce((a, b) => a + b, 0);
  const activeWeight = weightedSignals.reduce((sum, s) => sum + s.weight, 0);
  const neutralWeight = totalWeight - activeWeight;

  let consensus: "bullish" | "bearish" | "neutral" | "mixed";
  let consensusStrength: number;

  if (bullishScore === 0 && bearishScore === 0) {
    consensus = "neutral";
    consensusStrength = 0;
  } else if (bullishScore > 0 && bearishScore > 0) {
    // Mixed signals, check which is stronger
    const diff = Math.abs(bullishScore - bearishScore);
    if (diff < 0.1) {
      consensus = "mixed";
      consensusStrength = diff;
    } else {
      consensus = bullishScore > bearishScore ? "bullish" : "bearish";
      consensusStrength = diff / (bullishScore + bearishScore);
    }
  } else {
    consensus = bullishScore > 0 ? "bullish" : "bearish";
    consensusStrength = (bullishScore + bearishScore) / (totalWeight);
  }

  // Apply correlation penalty: same-direction signals from correlated strategies
  // (e.g., trend + momentum both bullish are somewhat correlated)
  const correlatedPairs: [string, string][] = [
    ["trend_following", "momentum"],
    ["trend_following", "supertrend"],
    ["supertrend", "ichimoku_cloud"],
    ["mean_reversion", "breakout"],
    ["evolved_trend", "trend_following"],
    ["evolved_trend", "momentum"],
  ];

  for (const [a, b] of correlatedPairs) {
    const sigA = weightedSignals.find((s) => s.strategyType === a);
    const sigB = weightedSignals.find((s) => s.strategyType === b);
    if (sigA && sigB && sigA.side === sigB.side) {
      // Reduce the lower-confidence one
      if (sigA.confidence < sigB.confidence) {
        sigA.confidence *= 1 - cfg.correlationPenalty;
      } else {
        sigB.confidence *= 1 - cfg.correlationPenalty;
      }
    }
  }

  // Sort by weighted confidence, take top N
  const aggregatedSignals = weightedSignals
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, cfg.maxSignals)
    .map(({ weight: _w, strategyType: _st, ...signal }) => ({
      ...signal,
      id: `ens-${signal.id}`,
      strategy: `ensemble:${signal.strategy}`,
    }));

  // Build combined analysis
  const analyses = Object.entries(strategyResults)
    .map(([name, r]) => `[${name}] ${r.analysis}`)
    .join("\n");

  const combinedIndicators: Record<string, number> = {
    bullishScore,
    bearishScore,
    neutralWeight,
    consensusStrength,
    activeStrategies: Object.keys(strategyResults).length,
    totalSignals: weightedSignals.length,
  };

  // Merge key indicators from each strategy
  for (const [name, result] of Object.entries(strategyResults)) {
    for (const [key, val] of Object.entries(result.indicators)) {
      combinedIndicators[`${name}_${key}`] = val;
    }
  }

  return {
    strategy: "ensemble",
    signals: aggregatedSignals,
    analysis: `ENSEMBLE [${consensus.toUpperCase()}] strength: ${(consensusStrength * 100).toFixed(0)}%\n${analyses}`,
    indicators: combinedIndicators,
    timestamp: Date.now(),
    strategyResults,
    aggregatedSignals,
    consensus,
    consensusStrength,
  };
}
