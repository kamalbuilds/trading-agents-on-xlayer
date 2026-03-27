/**
 * DATA CONTRACT: Trading Engine → Dashboard UI
 *
 * This file defines the real-time state API that the dashboard consumes.
 * The Dashboard UI Builder should import these types and use the documented
 * API endpoints to replace hardcoded mock data in the Zustand store.
 *
 * All endpoints require Bearer token auth (Authorization: Bearer <API_SECRET_KEY>).
 *
 * ENDPOINTS:
 *
 * GET  /api/status          → DashboardSnapshot
 *   Full portfolio state, recent trades, uptime. Poll every 5-10s.
 *
 * GET  /api/cycle            → TradingCycleResult
 *   Runs a trading cycle and returns full state including strategy breakdown
 *   and agent messages. Only call when engine isRunning=true.
 *
 * POST /api/cycle            → TradingCycleResult
 *   {action: "start"|"stop"|"reset"} to control the engine.
 *
 * GET  /api/trade            → RiskEngineState
 *   Current drawdown, active circuit breakers, risk limits.
 *
 * GET  /api/strategies       → StrategyAnalysis
 *   Live ensemble strategy analysis with per-strategy breakdown.
 *
 * GET  /api/rbi/status       → RBIStatusResponse
 *   Genetic evolution status + leaderboard of top strategies.
 *
 * GET  /api/rbi/leaderboard  → Leaderboard
 *   Full strategy leaderboard from genetic evolution.
 */

import type {
  PortfolioState,
  Order,
  AgentMessage,
  RiskLimits,
  RiskAssessment,
  Position,
  StrategyConfig,
} from "@/lib/types";

/** GET /api/status response */
export interface DashboardSnapshot {
  status: "ok" | "error";
  isRunning: boolean;
  mode: "paper" | "live" | "xlayer";
  portfolio: PortfolioState;
  recentTrades: Order[];
  uptime: number;
  timestamp: number;
  error?: string;
}

/** GET/POST /api/cycle response */
export interface TradingCycleResult {
  portfolio: PortfolioState;
  recentTrades: Order[];
  agentMessages: AgentMessage[];
  isRunning: boolean;
  mode: string;
  errors: string[];
  strategyBreakdown?: Record<string, {
    analysis: string;
    signal?: string;
    indicators: Record<string, number>;
  }>;
}

/** GET /api/trade response */
export interface RiskEngineState {
  drawdown: {
    currentDrawdown: number;
    maxDrawdown: number;
    peakEquity: number;
    valleyEquity: number;
    isRecovering: boolean;
  };
  activeBreakers: Array<{
    type: string;
    key: string;
    reason: string;
    trippedAt: number;
  }>;
  limits: RiskLimits;
}

/** GET /api/strategies response */
export interface StrategyAnalysis {
  status: string;
  mode: string;
  dataSource: string;
  candleCount: number;
  ensemble: {
    consensus: string;
    consensusStrength: number;
    signals: Array<{
      pair: string;
      side: string;
      confidence: number;
      strategy: string;
    }>;
    analysis: string;
  };
  strategies: Record<string, {
    analysis: string;
    signalCount: number;
    indicators: Record<string, number>;
  }>;
  timestamp: number;
}

/** GET /api/rbi/status response */
export interface RBIStatusResponse {
  isRunning: boolean;
  cyclesCompleted: number;
  leaderboard: {
    totalStrategies: number;
    totalBacktested: number;
    generationsRun: number;
    bestFitnessEver: number;
    topStrategies: Array<{
      name: string;
      tier: string;
      fitness: number;
      sharpe: number;
      winRate: number;
      maxDD: number;
      source: string;
      generation: number;
    }>;
  };
}

/**
 * POLLING STRATEGY FOR DASHBOARD:
 *
 * 1. On mount: GET /api/status to hydrate initial state
 * 2. While running: POST /api/cycle (no action) every 10-30s for full cycle data
 * 3. Risk panel: GET /api/trade every 10s for drawdown/breakers
 * 4. Strategy panel: GET /api/strategies every 30s for ensemble analysis
 * 5. RBI panel: GET /api/rbi/status every 60s for evolution progress
 *
 * All responses use the types exported from @/lib/types.
 * The Order type now includes `simulated?: boolean` to distinguish
 * paper trades from live fills.
 */
