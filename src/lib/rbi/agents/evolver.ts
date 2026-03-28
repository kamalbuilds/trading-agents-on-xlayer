// ============================================================
// Evolver Agent
// Genetic algorithm that breeds strategy parameter combinations
// Uses tournament selection, uniform crossover, gaussian mutation
// ============================================================

import type { OHLC } from "@/lib/types";
import type {
  StrategyGene,
  GenerationResult,
  StrategyResult,
} from "../types";
import { tournamentSelect, crossover, mutate, decodeGene } from "../gene";
import { computeFitness } from "../fitness";
import { runBacktest } from "./backtester";

type StrategyFn = (candles: OHLC[], config?: Record<string, unknown>) => StrategyResult;

export interface EvolutionConfig {
  populationSize: number;
  eliteCount: number;
  mutationRate: number;
  mutationStrength: number;
  tournamentSize: number;
}

const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
  populationSize: 20,
  eliteCount: 4,
  mutationRate: 0.2,
  mutationStrength: 0.1,
  tournamentSize: 3,
};

/**
 * Run one generation of evolution:
 * 1. Sort by fitness
 * 2. Keep elites unchanged
 * 3. Fill rest with crossover + mutation
 * 4. Evaluate all new offspring via backtest
 */
export async function evolveGeneration(
  population: StrategyGene[],
  strategyFn: StrategyFn,
  candles: OHLC[],
  config: Partial<EvolutionConfig> = {}
): Promise<{ population: StrategyGene[]; result: GenerationResult }> {
  const cfg = { ...DEFAULT_EVOLUTION_CONFIG, ...config };

  // Sort by fitness (best first)
  population.sort((a, b) => b.fitness - a.fitness);

  // Elite preservation
  const nextGen: StrategyGene[] = population.slice(0, cfg.eliteCount).map((g) => ({ ...g }));

  // Fill rest with crossover + mutation
  while (nextGen.length < cfg.populationSize) {
    const parentA = tournamentSelect(population, cfg.tournamentSize);
    const parentB = tournamentSelect(population, cfg.tournamentSize);
    let child = crossover(parentA, parentB);
    child = mutate(child, cfg.mutationRate, cfg.mutationStrength);
    nextGen.push(child);
  }

  // Evaluate all offspring (skip elites that already have fitness)
  let improvements = 0;
  for (const gene of nextGen) {
    if (gene.fitness > 0) continue; // already evaluated (elite)
    await new Promise<void>((r) => setTimeout(r, 0)); // yield event loop

    const params = decodeGene(gene);
    const backtestResult = runBacktest(strategyFn, candles, gene.strategyId, {}, params);
    gene.fitness = computeFitness(backtestResult);

    // Check if child improved over best parent
    if (gene.parents.length > 0) {
      const bestParentFitness = Math.max(
        ...gene.parents
          .map((pid) => population.find((p) => p.strategyId === pid)?.fitness ?? 0)
      );
      if (gene.fitness > bestParentFitness) improvements++;
    }
  }

  // Sort final population
  nextGen.sort((a, b) => b.fitness - a.fitness);

  const fitnesses = nextGen.map((g) => g.fitness);
  const result: GenerationResult = {
    generation: nextGen[0]?.generation ?? 0,
    populationSize: nextGen.length,
    bestFitness: Math.round((fitnesses[0] ?? 0) * 100) / 100,
    avgFitness: Math.round((fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length) * 100) / 100,
    worstFitness: Math.round((fitnesses[fitnesses.length - 1] ?? 0) * 100) / 100,
    bestStrategyId: nextGen[0]?.strategyId ?? "",
    improvements,
  };

  return { population: nextGen, result };
}

/**
 * Run multiple generations of evolution
 */
export async function runEvolution(
  population: StrategyGene[],
  strategyFn: StrategyFn,
  candles: OHLC[],
  generations: number,
  config: Partial<EvolutionConfig> = {}
): Promise<{
  finalPopulation: StrategyGene[];
  generationResults: GenerationResult[];
  bestGene: StrategyGene;
}> {
  let currentPop = [...population];
  const generationResults: GenerationResult[] = [];

  for (let gen = 0; gen < generations; gen++) {
    const { population: nextPop, result } = await evolveGeneration(
      currentPop,
      strategyFn,
      candles,
      config
    );
    currentPop = nextPop;
    generationResults.push(result);
  }

  return {
    finalPopulation: currentPop,
    generationResults,
    bestGene: currentPop[0],
  };
}
