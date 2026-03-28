// ============================================================
// Leaderboard: Persistent Strategy Rankings
// JSON-file backed, no external DB needed
// ============================================================

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type {
  Leaderboard,
  LeaderboardEntry,
  StrategyRanking,
  BacktestResult,
  StrategyGene,
  StrategySource,
  StrategyType,
} from "./types";

const DATA_DIR = join(process.cwd(), "src", "data", "rbi");
const LEADERBOARD_PATH = join(DATA_DIR, "leaderboard.json");

function createEmptyLeaderboard(): Leaderboard {
  return {
    version: 1,
    lastUpdated: Date.now(),
    strategies: [],
    totalDiscovered: 0,
    totalBacktested: 0,
    totalDeployed: 0,
    totalRetired: 0,
    generationsRun: 0,
    bestFitnessEver: 0,
  };
}

export async function loadLeaderboard(): Promise<Leaderboard> {
  try {
    const data = await readFile(LEADERBOARD_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return createEmptyLeaderboard();
  }
}

export async function saveLeaderboard(lb: Leaderboard): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  lb.lastUpdated = Date.now();
  await writeFile(LEADERBOARD_PATH, JSON.stringify(lb, null, 2));
}

/** Update leaderboard with new ranking results */
export async function updateLeaderboard(
  rankings: StrategyRanking[],
  backtestResults: Map<string, BacktestResult>,
  genes: Map<string, StrategyGene>,
  source: StrategySource = "evolved"
): Promise<Leaderboard> {
  const lb = await loadLeaderboard();

  for (const ranking of rankings) {
    const backtest = backtestResults.get(ranking.strategyId);
    const gene = genes.get(ranking.strategyId);

    const existing = lb.strategies.find((s) => s.strategyId === ranking.strategyId);

    if (existing) {
      // Update existing entry
      existing.tier = ranking.tier;
      existing.fitnessScore = ranking.fitnessScore;
      existing.sharpeRatio = backtest?.sharpeRatio ?? existing.sharpeRatio;
      existing.maxDrawdown = backtest?.maxDrawdown ?? existing.maxDrawdown;
      existing.winRate = backtest?.winRate ?? existing.winRate;
      existing.profitFactor = backtest?.profitFactor ?? existing.profitFactor;
      existing.totalReturn = backtest?.totalReturn ?? existing.totalReturn;
      existing.generation = gene?.generation ?? existing.generation;
      existing.fitnessHistory.push({
        generation: gene?.generation ?? existing.generation,
        fitness: ranking.fitnessScore,
        timestamp: Date.now(),
      });
      existing.updatedAt = Date.now();
      existing.status = "ranked";
    } else {
      // New entry
      const entry: LeaderboardEntry = {
        strategyId: ranking.strategyId,
        name: ranking.name,
        strategyType: (gene?.strategyType ?? "custom") as StrategyType,
        source,
        status: "ranked",
        tier: ranking.tier,
        fitnessScore: ranking.fitnessScore,
        sharpeRatio: backtest?.sharpeRatio ?? 0,
        maxDrawdown: backtest?.maxDrawdown ?? 0,
        winRate: backtest?.winRate ?? 0,
        profitFactor: backtest?.profitFactor ?? 0,
        totalReturn: backtest?.totalReturn ?? 0,
        generation: gene?.generation ?? 0,
        parents: gene?.parents ?? [],
        fitnessHistory: [
          {
            generation: gene?.generation ?? 0,
            fitness: ranking.fitnessScore,
            timestamp: Date.now(),
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      lb.strategies.push(entry);
    }
  }

  // Update aggregate stats
  lb.totalBacktested += rankings.length;
  const bestFitness = Math.max(...rankings.map((r) => r.fitnessScore), 0);
  if (bestFitness > lb.bestFitnessEver) lb.bestFitnessEver = bestFitness;

  // Sort by fitness
  lb.strategies.sort((a, b) => b.fitnessScore - a.fitnessScore);

  await saveLeaderboard(lb);
  return lb;
}
