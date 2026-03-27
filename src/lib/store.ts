"use client";

import { create } from "zustand";
import type {
  SystemState,
  PortfolioState,
  Order,
  AgentMessage,
  StrategyConfig,
  RiskLimits,
} from "@/lib/types";

// --- PnL History for Chart ---

export interface PnlDataPoint {
  time: string;
  pnl: number;
  equity: number;
}

// --- Store ---

interface DashboardStore {
  systemState: SystemState;
  pnlHistory: PnlDataPoint[];
  isLoading: boolean;
  lastError: string | null;
  toggleRunning: () => void;
  toggleMode: () => void;
  refreshData: () => Promise<void>;
  addAgentMessage: (msg: AgentMessage) => void;
  recordTrade: (trade: Order) => void;
}

const EMPTY_PORTFOLIO: PortfolioState = {
  balance: 0,
  equity: 0,
  positions: [],
  openOrders: [],
  totalPnl: 0,
  totalTrades: 0,
  winRate: 0,
  sharpeRatio: 0,
  maxDrawdown: 0,
  timestamp: Date.now(),
};

const DEFAULT_STRATEGIES: StrategyConfig[] = [
  {
    name: "Trend Following",
    type: "trend_following",
    pairs: ["BTC/USD", "ETH/USD"],
    timeframe: "4h",
    allocation: 35,
    enabled: true,
    params: { maFast: 20, maSlow: 50, atrMultiplier: 2.5 },
  },
  {
    name: "Momentum",
    type: "momentum",
    pairs: ["ETH/USD", "SOL/USD"],
    timeframe: "1h",
    allocation: 25,
    enabled: true,
    params: { rsiPeriod: 14, rsiOverbought: 70, rsiOversold: 30 },
  },
  {
    name: "Mean Reversion",
    type: "mean_reversion",
    pairs: ["SOL/USD", "AVAX/USD"],
    timeframe: "15m",
    allocation: 20,
    enabled: true,
    params: { bbPeriod: 20, bbStdDev: 2, entryThreshold: 1.5 },
  },
  {
    name: "Breakout",
    type: "breakout",
    pairs: ["BTC/USD"],
    timeframe: "1d",
    allocation: 15,
    enabled: false,
    params: { lookbackPeriod: 20, volumeThreshold: 1.5 },
  },
  {
    name: "Funding Arb",
    type: "funding_rate_arb",
    pairs: ["BTC/USD", "ETH/USD"],
    timeframe: "8h",
    allocation: 5,
    enabled: true,
    params: { minFundingRate: 0.01, maxExposure: 0.1 },
  },
];

const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxPositionSize: 5,
  maxDrawdown: 15,
  maxDailyLoss: 3,
  maxOpenPositions: 5,
  maxLeverage: 3,
  stopLossPercent: 2,
  takeProfitPercent: 4,
  maxCorrelation: 0.7,
  cooldownAfterLoss: 300,
};

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  systemState: {
    isRunning: false,
    mode: "paper",
    portfolio: EMPTY_PORTFOLIO,
    activeStrategies: DEFAULT_STRATEGIES,
    riskLimits: DEFAULT_RISK_LIMITS,
    recentTrades: [],
    agentMessages: [],
    errors: [],
    startTime: Date.now(),
    lastUpdate: Date.now(),
  },
  pnlHistory: [],
  isLoading: false,
  lastError: null,

  toggleRunning: () =>
    set((state) => ({
      systemState: {
        ...state.systemState,
        isRunning: !state.systemState.isRunning,
        lastUpdate: Date.now(),
      },
    })),

  toggleMode: () =>
    set((state) => ({
      systemState: {
        ...state.systemState,
        mode: state.systemState.mode === "paper" ? "live" : "paper",
        lastUpdate: Date.now(),
      },
    })),

  addAgentMessage: (msg: AgentMessage) =>
    set((state) => ({
      systemState: {
        ...state.systemState,
        agentMessages: [...state.systemState.agentMessages.slice(-99), msg],
        lastUpdate: Date.now(),
      },
    })),

  recordTrade: (trade: Order) =>
    set((state) => ({
      systemState: {
        ...state.systemState,
        recentTrades: [...state.systemState.recentTrades.slice(-99), trade],
        lastUpdate: Date.now(),
      },
    })),

  refreshData: async () => {
    const { isLoading } = get();
    if (isLoading) return;

    set({ isLoading: true, lastError: null });

    try {
      // Fetch real portfolio and system state from the backend
      const res = await fetch("/api/status", {
        headers: { "Cache-Control": "no-cache" },
      });

      if (!res.ok) {
        throw new Error(`Status API returned ${res.status}`);
      }

      const data = await res.json();

      set((state) => {
        // Build PnL history from real trade data
        const newPnlPoint: PnlDataPoint = {
          time: new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
          pnl: data.portfolio?.totalPnl ?? state.systemState.portfolio.totalPnl,
          equity: data.portfolio?.equity ?? state.systemState.portfolio.equity,
        };

        return {
          systemState: {
            ...state.systemState,
            isRunning: data.isRunning ?? state.systemState.isRunning,
            mode: data.mode ?? state.systemState.mode,
            portfolio: data.portfolio ?? state.systemState.portfolio,
            recentTrades: data.recentTrades ?? state.systemState.recentTrades,
            agentMessages: data.agentMessages ?? state.systemState.agentMessages,
            errors: data.errors ?? state.systemState.errors,
            lastUpdate: Date.now(),
          },
          // Append to PnL history, keep last 100 points
          pnlHistory: [...state.pnlHistory.slice(-99), newPnlPoint],
          isLoading: false,
        };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to fetch status";
      set({ isLoading: false, lastError: msg });
    }
  },
}));
