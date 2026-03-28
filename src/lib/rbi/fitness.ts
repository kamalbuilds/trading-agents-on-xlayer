// ============================================================
// Fitness Function & Strategy Ranking
// Multi-metric composite scoring with tier classification
// ============================================================

import type {
  BacktestResult,
  StrategyRanking,
  StrategyTier,
} from "./types";

/** Score trade frequency: sweet spot is 0.5-3 trades/day */
function tradeFreqScore(tradesPerDay: number): number {
  if (tradesPerDay < 0.1) return 10;
  if (tradesPerDay < 0.5) return 40;
  if (tradesPerDay <= 3) return 100;
  if (tradesPerDay <= 10) return 60;
  return 20;
}

/** Compute composite fitness score (0-100) from backtest result */
export function computeFitness(result: BacktestResult): number {
  const scores = {
    // Sharpe: 0 = 0pts, 1 = 33pts, 2 = 67pts, 3+ = 100pts
    sharpe: Math.min(100, Math.max(0, result.sharpeRatio * 33.3)),

    // Max DD: 0% = 100pts, 10% = 80pts, 25% = 50pts, 50%+ = 0pts
    maxDrawdown: Math.max(0, 100 - result.maxDrawdown * 2),

    // Win rate: 40% = 25pts, 50% = 50pts, 60% = 75pts, 70%+ = 100pts
    winRate: Math.min(100, Math.max(0, (result.winRate - 0.3) * 250)),

    // Profit factor: 1.0 = 0pts, 1.5 = 25pts, 2.0 = 50pts, 3.0 = 100pts
    profitFactor: Math.min(100, Math.max(0, (result.profitFactor - 1) * 50)),

    // Walk-forward consistency: < 10% degradation = 100pts, > 50% = 0pts
    consistency: Math.max(0, 100 - result.walkForward.degradation * 2),

    // Trade frequency
    tradeFrequency: tradeFreqScore(result.avgTradesPerDay),
  };

  // Weighted composite
  return (
    scores.sharpe * 0.25 +
    scores.maxDrawdown * 0.20 +
    scores.winRate * 0.15 +
    scores.profitFactor * 0.15 +
    scores.consistency * 0.15 +
    scores.tradeFrequency * 0.10
  );
}

/** Map fitness score to tier */
function getTier(score: number): StrategyTier {
  if (score >= 85) return "S";
  if (score >= 70) return "A";
  if (score >= 55) return "B";
  if (score >= 40) return "C";
  return "F";
}

/** Rank an array of backtest results into sorted rankings */
export function rankStrategies(
  results: { strategyId: string; name: string; backtest: BacktestResult }[]
): StrategyRanking[] {
  const ranked = results.map((r) => {
    const fitness = computeFitness(r.backtest);
    const tier = getTier(fitness);

    return {
      strategyId: r.strategyId,
      name: r.name,
      fitnessScore: Math.round(fitness * 100) / 100,
      scores: {
        sharpe: Math.min(100, Math.max(0, r.backtest.sharpeRatio * 33.3)),
        maxDrawdown: Math.max(0, 100 - r.backtest.maxDrawdown * 2),
        winRate: Math.min(100, Math.max(0, (r.backtest.winRate - 0.3) * 250)),
        profitFactor: Math.min(100, Math.max(0, (r.backtest.profitFactor - 1) * 50)),
        consistency: Math.max(0, 100 - r.backtest.walkForward.degradation * 2),
        tradeFrequency: tradeFreqScore(r.backtest.avgTradesPerDay),
      },
      rank: 0, // set below
      tier,
      eligibleForEvolution: tier !== "F",
      eligibleForDeploy: tier === "S" || tier === "A",
      timestamp: Date.now(),
    };
  });

  // Sort by fitness descending, assign ranks
  ranked.sort((a, b) => b.fitnessScore - a.fitnessScore);
  ranked.forEach((r, i) => {
    r.rank = i + 1;
  });

  return ranked;
}
