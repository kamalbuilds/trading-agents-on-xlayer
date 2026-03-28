// RBI System - Research, Backtest, Implement
// Autonomous strategy discovery and evolution pipeline

export { runRBICycle, getRBIStatus } from "./orchestrator";
export { loadLeaderboard } from "./leaderboard";
export { runBacktest } from "./agents/backtester";
export { runEvolution, evolveGeneration } from "./agents/evolver";
export { computeFitness, rankStrategies } from "./fitness";
export {
  GENE_SCHEMAS,
  createInitialPopulation,
  createRandomGene,
  createSeededGene,
  decodeGene,
  encodeGene,
} from "./gene";
export { eventBus } from "./event-bus";
export type * from "./types";
