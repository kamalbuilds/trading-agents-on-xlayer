// ============================================================
// RBI System Types - Research, Backtest, Implement
// Autonomous strategy discovery, validation, and evolution
// ============================================================

import type { OHLC, OrderSide } from "@/lib/types";

// --- Strategy Types ---
export type StrategyType =
  | "trend_following"
  | "mean_reversion"
  | "momentum"
  | "breakout"
  | "ichimoku"
  | "supertrend"
  | "funding_rate"
  | "evolved"
  | "ensemble"
  | "custom";

export type StrategySource = "tradingview" | "github" | "evolved" | "manual";

// --- Strategy Function Signature ---
export type StrategyFn = (
  candles: OHLC[],
  config?: Partial<Record<string, unknown>>
) => StrategyResult;

export interface StrategyResult {
  strategy: string;
  signal: "buy" | "sell" | "hold";
  confidence: number;
  signals: TradeSignalCompact[];
  analysis: string;
  indicators: Record<string, number | string>;
}

export interface TradeSignalCompact {
  side: OrderSide;
  confidence: number;
  reasoning: string;
}

// --- Gene Encoding ---
export interface GeneParam {
  name: string;
  min: number;
  max: number;
  step: number;
  type: "int" | "float";
}

export interface StrategyGene {
  strategyId: string;
  name: string;
  strategyType: StrategyType;
  chromosome: number[]; // normalized [0,1] values
  schema: GeneParam[];
  generation: number;
  parents: string[];
  mutationHistory: string[];
  fitness: number;
}

// --- Backtest ---
export interface BacktestConfig {
  pairs: string[];
  timeframes: string[];
  lookbackDays: number;
  initialBalance: number;
  feeRate: number;
  slippageBps: number;
  walkForwardWindows: number;
  monteCarloIterations: number;
}

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  side: OrderSide;
  entryPrice: number;
  exitPrice: number;
  amount: number;
  pnl: number;
  pnlPercent: number;
  fees: number;
  strategy: string;
}

export interface WalkForwardResult {
  inSampleSharpe: number;
  outOfSampleSharpe: number;
  degradation: number;
  consistent: boolean;
}

export interface MonteCarloResult {
  p5Return: number;
  p50Return: number;
  p95Return: number;
  p5MaxDD: number;
  ruinProbability: number;
}

export interface BacktestResult {
  strategyId: string;
  config: BacktestConfig;
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownDuration: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  avgTradesPerDay: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  avgHoldingPeriod: number;
  walkForward: WalkForwardResult;
  monteCarlo: MonteCarloResult;
  equityCurve: { time: number; equity: number }[];
  trades: BacktestTrade[];
  timestamp: number;
}

// --- Ranking ---
export type StrategyTier = "S" | "A" | "B" | "C" | "F";

export interface StrategyRanking {
  strategyId: string;
  name: string;
  fitnessScore: number;
  scores: {
    sharpe: number;
    maxDrawdown: number;
    winRate: number;
    profitFactor: number;
    consistency: number;
    tradeFrequency: number;
  };
  rank: number;
  tier: StrategyTier;
  eligibleForEvolution: boolean;
  eligibleForDeploy: boolean;
  timestamp: number;
}

// --- Leaderboard ---
export interface LeaderboardEntry {
  strategyId: string;
  name: string;
  strategyType: StrategyType;
  source: StrategySource;
  status: "candidate" | "backtesting" | "ranked" | "evolving" | "shadowing" | "live" | "retired";
  tier: StrategyTier;
  fitnessScore: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  totalReturn: number;
  generation: number;
  parents: string[];
  fitnessHistory: { generation: number; fitness: number; timestamp: number }[];
  livePerformance?: {
    deployedAt: number;
    ensembleWeight: number;
    liveSharpe: number;
    livePnl: number;
    liveWinRate: number;
    daysActive: number;
  };
  createdAt: number;
  updatedAt: number;
}

export interface Leaderboard {
  version: number;
  lastUpdated: number;
  strategies: LeaderboardEntry[];
  totalDiscovered: number;
  totalBacktested: number;
  totalDeployed: number;
  totalRetired: number;
  generationsRun: number;
  bestFitnessEver: number;
}

// --- Event Bus ---
export type RBIEventType =
  | "strategy:discovered"
  | "strategy:converted"
  | "strategy:backtest_complete"
  | "strategy:ranked"
  | "strategy:evolved"
  | "strategy:deployed"
  | "strategy:retired"
  | "rbi:cycle_start"
  | "rbi:cycle_complete"
  | "rbi:error";

export interface RBIEvent {
  type: RBIEventType;
  strategyId?: string;
  data: unknown;
  agentId: string;
  timestamp: number;
}

// --- RBI Config ---
export interface RBIConfig {
  discoveryBatchSize: number;
  backtestPairs: string[];
  backtestDays: number;
  populationSize: number;
  generationsPerCycle: number;
  autoDeployThreshold: number;
  cycleCooldownMs: number;
}

// --- Orchestrator State ---
export interface RBICycleResult {
  cycleNumber: number;
  startedAt: number;
  completedAt: number;
  discovered: number;
  converted: number;
  backtested: number;
  evolved: number;
  deployed: number;
  bestFitness: number;
  bestStrategy: string;
  generationResults: GenerationResult[];
}

export interface GenerationResult {
  generation: number;
  populationSize: number;
  bestFitness: number;
  avgFitness: number;
  worstFitness: number;
  bestStrategyId: string;
  improvements: number; // how many improved over parent
}
