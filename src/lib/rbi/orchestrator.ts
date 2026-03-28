// ============================================================
// RBI Orchestrator - The Autonomous Loop
// Chains: Backtest -> Rank -> Evolve -> Deploy
// Runs against existing 7 strategies with genetic parameter evolution
// ============================================================

import type { OHLC } from "@/lib/types";
import type {
  RBIConfig,
  RBICycleResult,
  StrategyGene,
  BacktestResult,
  StrategyRanking,
  GenerationResult,
  StrategyResult,
} from "./types";
import {
  GENE_SCHEMAS,
  createInitialPopulation,
  decodeGene,
} from "./gene";
import { runBacktest } from "./agents/backtester";
import { rankStrategies, computeFitness } from "./fitness";
import { runEvolution } from "./agents/evolver";
import { updateLeaderboard, loadLeaderboard } from "./leaderboard";
import { eventBus } from "./event-bus";

// Strategy imports
import { analyzeSuperTrend } from "@/lib/strategies/supertrend";
import { analyzeIchimokuCloud } from "@/lib/strategies/ichimoku-cloud";
import { analyzeMomentum } from "@/lib/strategies/momentum";
import { analyzeMeanReversion } from "@/lib/strategies/mean-reversion";
import { analyzeTrendFollowing } from "@/lib/strategies/trend-following";
import { analyzeBreakout } from "@/lib/strategies/breakout";
import { analyzeEvolvedTrend } from "@/lib/strategies/evolved-trend";

// --- Strategy Registry ---
// Maps strategy type to its analysis function and default "champion" params

interface StrategyEntry {
  name: string;
  geneType: string; // key in GENE_SCHEMAS
  fn: (candles: OHLC[], config?: Record<string, unknown>) => StrategyResult;
  championParams: Record<string, number>;
}

const STRATEGY_REGISTRY: StrategyEntry[] = [
  {
    name: "SuperTrend",
    geneType: "supertrend",
    fn: (candles, config) => analyzeSuperTrend(candles, config) as unknown as StrategyResult,
    championParams: { fastPeriod: 10, fastMultiplier: 2, slowPeriod: 10, slowMultiplier: 3, adxPeriod: 14, adxThreshold: 25 },
  },
  {
    name: "Ichimoku Cloud",
    geneType: "ichimoku",
    fn: (candles, config) => analyzeIchimokuCloud(candles, config) as unknown as StrategyResult,
    championParams: { conversionPeriod: 9, basePeriod: 26, spanBPeriod: 52, displacement: 26 },
  },
  {
    name: "Momentum",
    geneType: "momentum",
    fn: (candles, config) => analyzeMomentum(candles, config) as unknown as StrategyResult,
    championParams: { rsiPeriod: 14, rocPeriod: 12, stochRsiPeriod: 14, overbought: 70, oversold: 30 },
  },
  {
    name: "Mean Reversion",
    geneType: "mean_reversion",
    fn: (candles, config) => analyzeMeanReversion(candles, config) as unknown as StrategyResult,
    championParams: { bbPeriod: 20, bbStdDev: 2.0, cciPeriod: 20, zScoreEntry: 2.0, zScoreExit: 0.5 },
  },
  {
    name: "Trend Following",
    geneType: "trend_following",
    fn: (candles, config) => analyzeTrendFollowing(candles, config) as unknown as StrategyResult,
    championParams: { fastEMA: 12, slowEMA: 50, adxPeriod: 14, adxThreshold: 25, atrPeriod: 14, atrMultiplier: 2.5 },
  },
  {
    name: "Breakout",
    geneType: "breakout",
    fn: (candles, config) => analyzeBreakout(candles, config) as unknown as StrategyResult,
    championParams: { keltnerPeriod: 20, keltnerMultiplier: 1.5, bbPeriod: 20, bbStdDev: 2.0, volumeThreshold: 1.5 },
  },
  {
    name: "Evolved Trend",
    geneType: "evolved_trend",
    fn: (candles, config) => analyzeEvolvedTrend(candles, config) as unknown as StrategyResult,
    championParams: { fastMAPeriod: 25, slowMAPeriod: 105, atrPeriod: 13, atrTrailMult: 5.23, positionSizePct: 25 },
  },
];

// --- Default Config ---

const DEFAULT_RBI_CONFIG: RBIConfig = {
  discoveryBatchSize: 10,
  backtestPairs: ["BTC/USD"],
  backtestDays: 90,
  populationSize: 6, // small for speed, can increase later
  generationsPerCycle: 2,
  autoDeployThreshold: 85,
  cycleCooldownMs: 3600000,
};

/** Yield event loop so server doesn't block */
const yieldLoop = () => new Promise<void>((r) => setTimeout(r, 0));

// --- Module State ---

let isRunning = false;
let lastCycleResult: RBICycleResult | null = null;
let cycleCount = 0;

// --- Public API ---

export function getRBIStatus() {
  return {
    isRunning,
    cycleCount,
    lastCycleResult,
    registeredStrategies: STRATEGY_REGISTRY.map((s) => s.name),
  };
}

/**
 * Run one full RBI cycle:
 * 1. For each strategy type, create a population of parameter variants
 * 2. Backtest each variant against historical OHLC
 * 3. Rank by composite fitness
 * 4. Evolve top performers through genetic crossover/mutation
 * 5. Update leaderboard with results
 */
export async function runRBICycle(
  candles: OHLC[],
  config: Partial<RBIConfig> = {}
): Promise<RBICycleResult> {
  if (isRunning) throw new Error("RBI cycle already running");

  isRunning = true;
  cycleCount++;
  const startedAt = Date.now();
  const cfg = { ...DEFAULT_RBI_CONFIG, ...config };

  eventBus.emit({
    type: "rbi:cycle_start",
    agentId: "orchestrator",
    data: { cycleCount, config: cfg },
    timestamp: startedAt,
  });

  const allGenerationResults: GenerationResult[] = [];
  const allBacktestResults = new Map<string, BacktestResult>();
  const allGenes = new Map<string, StrategyGene>();
  const allRankings: StrategyRanking[] = [];

  let globalBestFitness = 0;
  let globalBestStrategy = "";

  // Process each strategy type
  for (const entry of STRATEGY_REGISTRY) {
    if (!GENE_SCHEMAS[entry.geneType]) continue;
    await yieldLoop(); // yield between strategy types to avoid blocking event loop

    try {
      // Create initial population: champion + random variants
      const population = createInitialPopulation(
        entry.geneType,
        entry.championParams,
        cfg.populationSize
      );

      // Evaluate initial population
      for (const gene of population) {
        await yieldLoop();
        const params = decodeGene(gene);
        const result = runBacktest(
          (c, p) => entry.fn(c, { ...p }),
          candles,
          gene.strategyId,
          { lookbackDays: cfg.backtestDays },
          params
        );
        gene.fitness = computeFitness(result);
        allBacktestResults.set(gene.strategyId, result);
        allGenes.set(gene.strategyId, gene);
      }

      // Run evolution
      const { finalPopulation, generationResults, bestGene } = await runEvolution(
        population,
        (c, p) => entry.fn(c, { ...p }),
        candles,
        cfg.generationsPerCycle,
        { populationSize: cfg.populationSize }
      );

      allGenerationResults.push(...generationResults);

      // Store final population genes and results
      for (const gene of finalPopulation) {
        allGenes.set(gene.strategyId, gene);
        if (!allBacktestResults.has(gene.strategyId)) {
          await yieldLoop();
          const params = decodeGene(gene);
          const result = runBacktest(
            (c, p) => entry.fn(c, { ...p }),
            candles,
            gene.strategyId,
            { lookbackDays: cfg.backtestDays },
            params
          );
          allBacktestResults.set(gene.strategyId, result);
        }
      }

      // Rank this strategy type's population
      const rankInput = finalPopulation.map((g) => ({
        strategyId: g.strategyId,
        name: `${entry.name} [${g.strategyId.slice(0, 12)}]`,
        backtest: allBacktestResults.get(g.strategyId)!,
      }));
      const rankings = rankStrategies(rankInput);
      allRankings.push(...rankings);

      // Track global best
      if (bestGene.fitness > globalBestFitness) {
        globalBestFitness = bestGene.fitness;
        globalBestStrategy = `${entry.name} (${bestGene.strategyId})`;
      }

      eventBus.emit({
        type: "strategy:evolved",
        strategyId: bestGene.strategyId,
        agentId: "evolver",
        data: {
          strategyType: entry.name,
          bestFitness: bestGene.fitness,
          generations: cfg.generationsPerCycle,
          params: decodeGene(bestGene),
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      eventBus.emit({
        type: "rbi:error",
        agentId: "orchestrator",
        data: { strategy: entry.name, error: String(error) },
        timestamp: Date.now(),
      });
      console.error(`[RBI] Error evolving ${entry.name}:`, error);
    }
  }

  // Update leaderboard
  await updateLeaderboard(allRankings, allBacktestResults, allGenes, "evolved");

  const completedAt = Date.now();
  lastCycleResult = {
    cycleNumber: cycleCount,
    startedAt,
    completedAt,
    discovered: 0, // discovery agent not yet implemented
    converted: 0,
    backtested: allBacktestResults.size,
    evolved: allGenes.size,
    deployed: 0,
    bestFitness: Math.round(globalBestFitness * 100) / 100,
    bestStrategy: globalBestStrategy,
    generationResults: allGenerationResults,
  };

  isRunning = false;

  eventBus.emit({
    type: "rbi:cycle_complete",
    agentId: "orchestrator",
    data: lastCycleResult,
    timestamp: completedAt,
  });

  return lastCycleResult;
}
