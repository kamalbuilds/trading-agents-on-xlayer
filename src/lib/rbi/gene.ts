// ============================================================
// Gene Encoding/Decoding + Genetic Operators
// Encodes strategy parameters as normalized [0,1] chromosomes
// for uniform crossover and mutation across strategy types
// ============================================================

import type { StrategyGene, GeneParam, StrategyType } from "./types";

// --- Gene Schemas for Each Strategy ---

export const GENE_SCHEMAS: Record<string, GeneParam[]> = {
  supertrend: [
    { name: "fastPeriod", min: 5, max: 30, step: 1, type: "int" },
    { name: "fastMultiplier", min: 1.0, max: 5.0, step: 0.1, type: "float" },
    { name: "slowPeriod", min: 10, max: 40, step: 1, type: "int" },
    { name: "slowMultiplier", min: 1.5, max: 6.0, step: 0.1, type: "float" },
    { name: "adxPeriod", min: 10, max: 30, step: 1, type: "int" },
    { name: "adxThreshold", min: 15, max: 35, step: 1, type: "int" },
  ],
  ichimoku: [
    { name: "conversionPeriod", min: 5, max: 15, step: 1, type: "int" },
    { name: "basePeriod", min: 20, max: 35, step: 1, type: "int" },
    { name: "spanBPeriod", min: 40, max: 65, step: 1, type: "int" },
    { name: "displacement", min: 20, max: 35, step: 1, type: "int" },
  ],
  momentum: [
    { name: "rsiPeriod", min: 10, max: 20, step: 1, type: "int" },
    { name: "rocPeriod", min: 8, max: 20, step: 1, type: "int" },
    { name: "stochRsiPeriod", min: 10, max: 20, step: 1, type: "int" },
    { name: "overbought", min: 65, max: 85, step: 1, type: "int" },
    { name: "oversold", min: 15, max: 35, step: 1, type: "int" },
  ],
  mean_reversion: [
    { name: "bbPeriod", min: 15, max: 30, step: 1, type: "int" },
    { name: "bbStdDev", min: 1.5, max: 3.0, step: 0.1, type: "float" },
    { name: "cciPeriod", min: 14, max: 30, step: 1, type: "int" },
    { name: "zScoreEntry", min: 1.5, max: 3.0, step: 0.1, type: "float" },
    { name: "zScoreExit", min: 0.3, max: 1.0, step: 0.1, type: "float" },
  ],
  trend_following: [
    { name: "fastEMA", min: 8, max: 25, step: 1, type: "int" },
    { name: "slowEMA", min: 30, max: 100, step: 1, type: "int" },
    { name: "adxPeriod", min: 10, max: 25, step: 1, type: "int" },
    { name: "adxThreshold", min: 15, max: 35, step: 1, type: "int" },
    { name: "atrPeriod", min: 10, max: 25, step: 1, type: "int" },
    { name: "atrMultiplier", min: 1.5, max: 4.0, step: 0.1, type: "float" },
  ],
  breakout: [
    { name: "keltnerPeriod", min: 15, max: 30, step: 1, type: "int" },
    { name: "keltnerMultiplier", min: 1.0, max: 3.0, step: 0.1, type: "float" },
    { name: "bbPeriod", min: 15, max: 30, step: 1, type: "int" },
    { name: "bbStdDev", min: 1.5, max: 3.0, step: 0.1, type: "float" },
    { name: "volumeThreshold", min: 1.2, max: 2.5, step: 0.1, type: "float" },
  ],
  evolved_trend: [
    { name: "fastMAPeriod", min: 5, max: 50, step: 1, type: "int" },
    { name: "slowMAPeriod", min: 50, max: 200, step: 1, type: "int" },
    { name: "atrPeriod", min: 5, max: 30, step: 1, type: "int" },
    { name: "atrTrailMult", min: 1.0, max: 8.0, step: 0.01, type: "float" },
    { name: "positionSizePct", min: 5, max: 50, step: 1, type: "int" },
  ],
};

// --- Encoding/Decoding ---

/** Encode real parameter values to normalized [0,1] chromosome */
export function encodeGene(
  params: Record<string, number>,
  schema: GeneParam[]
): number[] {
  return schema.map((p) => {
    const val = params[p.name] ?? (p.min + p.max) / 2;
    return Math.max(0, Math.min(1, (val - p.min) / (p.max - p.min)));
  });
}

/** Decode normalized [0,1] chromosome back to real parameters */
export function decodeGene(gene: StrategyGene): Record<string, number> {
  const params: Record<string, number> = {};
  for (let i = 0; i < gene.schema.length; i++) {
    const { name, min, max, step, type } = gene.schema[i];
    let val = min + gene.chromosome[i] * (max - min);
    val = Math.round(val / step) * step;
    if (type === "int") val = Math.round(val);
    params[name] = val;
  }
  return params;
}

// --- Genetic Operators ---

/** Tournament selection: pick best of k random candidates */
export function tournamentSelect(
  population: StrategyGene[],
  k = 3
): StrategyGene {
  const tournament: StrategyGene[] = [];
  for (let i = 0; i < k; i++) {
    tournament.push(
      population[Math.floor(Math.random() * population.length)]
    );
  }
  return tournament.reduce((best, g) =>
    g.fitness > best.fitness ? g : best
  );
}

/** Uniform crossover: for each gene, randomly pick from parent A or B */
export function crossover(
  parentA: StrategyGene,
  parentB: StrategyGene
): StrategyGene {
  const child = parentA.chromosome.map((_, i) =>
    Math.random() < 0.5
      ? parentA.chromosome[i]
      : parentB.chromosome[i]
  );

  return {
    ...parentA,
    strategyId: `gen${parentA.generation + 1}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    chromosome: child,
    generation: parentA.generation + 1,
    parents: [parentA.strategyId, parentB.strategyId],
    mutationHistory: [],
    fitness: 0,
  };
}

/** Gaussian mutation: perturb each gene with probability mutationRate */
export function mutate(
  gene: StrategyGene,
  mutationRate = 0.2,
  mutationStrength = 0.1
): StrategyGene {
  const mutationHistory: string[] = [];
  const mutated = gene.chromosome.map((val, i) => {
    if (Math.random() > mutationRate) return val;
    const delta = (Math.random() * 2 - 1) * mutationStrength;
    mutationHistory.push(gene.schema[i].name);
    return Math.max(0, Math.min(1, val + delta));
  });

  return {
    ...gene,
    chromosome: mutated,
    mutationHistory,
  };
}

/** Create a random gene for a strategy type */
export function createRandomGene(
  strategyType: string,
  name: string,
  generation = 0
): StrategyGene {
  const schema = GENE_SCHEMAS[strategyType];
  if (!schema) throw new Error(`No gene schema for strategy type: ${strategyType}`);

  return {
    strategyId: `gen${generation}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    strategyType: strategyType as StrategyType,
    chromosome: schema.map(() => Math.random()),
    schema,
    generation,
    parents: [],
    mutationHistory: [],
    fitness: 0,
  };
}

/** Create a gene from known good parameters (seed the population) */
export function createSeededGene(
  strategyType: string,
  name: string,
  params: Record<string, number>,
  generation = 0
): StrategyGene {
  const schema = GENE_SCHEMAS[strategyType];
  if (!schema) throw new Error(`No gene schema for strategy type: ${strategyType}`);

  return {
    strategyId: `seed_${strategyType}_${Date.now()}`,
    name,
    strategyType: strategyType as StrategyType,
    chromosome: encodeGene(params, schema),
    schema,
    generation,
    parents: [],
    mutationHistory: [],
    fitness: 0,
  };
}

/** Create initial population: seeded champions + random individuals */
export function createInitialPopulation(
  strategyType: string,
  championParams: Record<string, number>,
  populationSize = 20
): StrategyGene[] {
  const population: StrategyGene[] = [];

  // Seed #1: current champion (known good params)
  population.push(
    createSeededGene(strategyType, `${strategyType}_champion`, championParams)
  );

  // Seed #2: slight mutation of champion
  const mutatedChamp = mutate(population[0], 1.0, 0.05); // mutate all genes slightly
  mutatedChamp.strategyId = `seed_${strategyType}_mutated_${Date.now()}`;
  mutatedChamp.name = `${strategyType}_champion_v2`;
  population.push(mutatedChamp);

  // Fill rest with random individuals
  while (population.length < populationSize) {
    population.push(
      createRandomGene(strategyType, `${strategyType}_rand_${population.length}`)
    );
  }

  return population;
}
