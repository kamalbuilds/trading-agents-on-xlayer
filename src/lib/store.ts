"use client";

import { create } from "zustand";
import {
  getRiskLimits,
  DEFAULT_STRATEGIES,
  INITIAL_BALANCE,
} from "@/lib/config";
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
  balance: INITIAL_BALANCE,
  equity: INITIAL_BALANCE,
  positions: [],
  openOrders: [],
  totalPnl: 0,
  totalTrades: 0,
  winRate: 0,
  sharpeRatio: 0,
  maxDrawdown: 0,
  timestamp: Date.now(),
};

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  systemState: {
    isRunning: false,
    mode: "paper",
    portfolio: EMPTY_PORTFOLIO,
    activeStrategies: DEFAULT_STRATEGIES,
    riskLimits: getRiskLimits(),
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
