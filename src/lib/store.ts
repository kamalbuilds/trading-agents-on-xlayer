"use client";

import { create } from "zustand";
import { INITIAL_BALANCE } from "@/lib/config";
import type {
  SystemState,
  PortfolioState,
  Order,
  AgentMessage,
  RiskLimits,
  StrategyConfig,
} from "@/lib/types";
import type {
  DashboardSnapshot,
  TradingCycleResult,
  RiskEngineState,
  StrategyAnalysis,
  RBIStatusResponse,
} from "@/lib/trading/data-contract";
import type { SmartMoneySignal } from "@/lib/nansen";

// --- PnL History for Chart ---

export interface PnlDataPoint {
  time: string;
  pnl: number;
  equity: number;
}

// --- Auth helper ---

function getAuthHeaders(): Record<string, string> {
  const key =
    typeof window !== "undefined"
      ? (window as unknown as Record<string, unknown>).__API_KEY__ as string | undefined
      : undefined;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
  };
  if (key) {
    headers["Authorization"] = `Bearer ${key}`;
  }
  return headers;
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...getAuthHeaders(), ...init?.headers },
  });
  if (!res.ok) throw new Error(`API ${url} returned ${res.status}`);
  return res.json() as Promise<T>;
}

// --- Store ---

interface DashboardStore {
  // Core state
  systemState: SystemState;
  pnlHistory: PnlDataPoint[];
  isLoading: boolean;
  lastError: string | null;
  initialFetchDone: boolean;

  // Extended state from dedicated endpoints
  riskState: RiskEngineState | null;
  strategyAnalysis: StrategyAnalysis | null;
  rbiStatus: RBIStatusResponse | null;
  nansenSignal: SmartMoneySignal | null;

  // Polling handles
  _intervals: ReturnType<typeof setInterval>[];

  // Actions
  toggleRunning: () => void;
  toggleMode: () => void;
  refreshData: () => Promise<void>;
  addAgentMessage: (msg: AgentMessage) => void;
  recordTrade: (trade: Order) => void;
  startPolling: () => void;
  stopPolling: () => void;
  setApiKey: (key: string) => void;

  // Dedicated fetchers
  fetchStatus: () => Promise<void>;
  fetchCycle: () => Promise<void>;
  fetchRisk: () => Promise<void>;
  fetchStrategies: () => Promise<void>;
  fetchRBI: () => Promise<void>;
  fetchNansen: () => Promise<void>;
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

const EMPTY_RISK_LIMITS: RiskLimits = {
  maxPositionSize: 5,
  maxDrawdown: 15,
  maxDailyLoss: 3,
  maxOpenPositions: 5,
  maxLeverage: 1,
  stopLossPercent: 2,
  takeProfitPercent: 4,
  maxCorrelation: 0.7,
  cooldownAfterLoss: 300,
};

function makePnlPoint(portfolio: PortfolioState): PnlDataPoint {
  return {
    time: new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    pnl: portfolio.totalPnl ?? 0,
    equity: portfolio.equity ?? INITIAL_BALANCE,
  };
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  systemState: {
    isRunning: false,
    mode: "paper",
    portfolio: EMPTY_PORTFOLIO,
    activeStrategies: [],
    riskLimits: EMPTY_RISK_LIMITS,
    recentTrades: [],
    agentMessages: [],
    errors: [],
    startTime: Date.now(),
    lastUpdate: Date.now(),
  },
  pnlHistory: [],
  isLoading: false,
  lastError: null,
  initialFetchDone: false,
  riskState: null,
  strategyAnalysis: null,
  rbiStatus: null,
  nansenSignal: null,
  _intervals: [],

  setApiKey: (key: string) => {
    if (typeof window !== "undefined") {
      (window as unknown as Record<string, unknown>).__API_KEY__ = key;
    }
  },

  // --- Dedicated fetchers ---

  fetchStatus: async () => {
    try {
      const data = await apiFetch<DashboardSnapshot>("/api/status");
      set((state) => {
        // Only update portfolio if the API returned real data (not null/empty)
        const hasPortfolio = data.portfolio && data.portfolio.timestamp > 0;
        const portfolio = hasPortfolio ? data.portfolio : state.systemState.portfolio;
        const hasTradeData = data.recentTrades && data.recentTrades.length > 0;
        const recentTrades = hasTradeData ? data.recentTrades : state.systemState.recentTrades;

        return {
          systemState: {
            ...state.systemState,
            isRunning: data.isRunning,
            mode: data.mode,
            portfolio,
            recentTrades,
            lastUpdate: Date.now(),
          },
          initialFetchDone: true,
          lastError: data.error ?? null,
          pnlHistory: hasPortfolio
            ? [...state.pnlHistory.slice(-99), makePnlPoint(data.portfolio!)]
            : state.pnlHistory,
        };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to fetch status";
      set((state) => ({ lastError: msg, initialFetchDone: state.initialFetchDone || false }));
    }
  },

  fetchCycle: async () => {
    const { systemState } = get();
    if (!systemState.isRunning) return;
    try {
      const data = await apiFetch<TradingCycleResult>("/api/cycle");
      set((state) => ({
        systemState: {
          ...state.systemState,
          isRunning: data.isRunning,
          mode: (data.mode as SystemState["mode"]) ?? state.systemState.mode,
          portfolio: data.portfolio ?? state.systemState.portfolio,
          recentTrades: data.recentTrades ?? state.systemState.recentTrades,
          agentMessages: data.agentMessages ?? state.systemState.agentMessages,
          errors: data.errors ?? state.systemState.errors,
          lastUpdate: Date.now(),
        },
        pnlHistory: data.portfolio
          ? [...state.pnlHistory.slice(-99), makePnlPoint(data.portfolio)]
          : state.pnlHistory,
        lastError: null,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to fetch cycle";
      set({ lastError: msg });
    }
  },

  fetchRisk: async () => {
    try {
      const data = await apiFetch<RiskEngineState>("/api/trade");
      set({
        riskState: data,
        systemState: {
          ...get().systemState,
          riskLimits: data.limits ?? get().systemState.riskLimits,
        },
      });
    } catch {
      // Keep last known risk state on error
    }
  },

  fetchStrategies: async () => {
    try {
      const data = await apiFetch<StrategyAnalysis>("/api/strategies");
      set({ strategyAnalysis: data });
    } catch {
      // Keep last known strategy data on error
    }
  },

  fetchRBI: async () => {
    try {
      const data = await apiFetch<RBIStatusResponse>("/api/rbi/status");
      set({ rbiStatus: data });
    } catch {
      // Keep last known RBI data on error
    }
  },

  fetchNansen: async () => {
    try {
      const resp = await apiFetch<{ status: string; data: SmartMoneySignal }>("/api/nansen?endpoint=signal");
      if (resp.data) {
        set({ nansenSignal: resp.data });
      }
    } catch {
      // Keep last known Nansen data on error
    }
  },

  // --- Polling ---

  startPolling: () => {
    const { _intervals } = get();
    if (_intervals.length > 0) return;

    // Initial hydration
    get().fetchStatus();
    get().fetchRisk();
    get().fetchStrategies();
    get().fetchRBI();
    get().fetchNansen();

    const intervals: ReturnType<typeof setInterval>[] = [];

    // Status: 5s
    intervals.push(setInterval(() => get().fetchStatus(), 5_000));

    // Cycle data: 15s (only runs when engine is active)
    intervals.push(setInterval(() => get().fetchCycle(), 15_000));

    // Risk: 10s
    intervals.push(setInterval(() => get().fetchRisk(), 10_000));

    // Strategies: 30s
    intervals.push(setInterval(() => get().fetchStrategies(), 30_000));

    // RBI: 60s
    intervals.push(setInterval(() => get().fetchRBI(), 60_000));

    // Nansen: static data, no repeated polling needed

    set({ _intervals: intervals });
  },

  stopPolling: () => {
    const { _intervals } = get();
    for (const id of _intervals) clearInterval(id);
    set({ _intervals: [] });
  },

  // --- Actions ---

  toggleRunning: () => {
    const { systemState } = get();
    const newRunning = !systemState.isRunning;

    apiFetch<TradingCycleResult>("/api/cycle", {
      method: "POST",
      body: JSON.stringify({ action: newRunning ? "start" : "stop" }),
    })
      .then((data) => {
        set((state) => ({
          systemState: {
            ...state.systemState,
            isRunning: data.isRunning ?? newRunning,
            portfolio: data.portfolio ?? state.systemState.portfolio,
            recentTrades: data.recentTrades ?? state.systemState.recentTrades,
            agentMessages: data.agentMessages ?? state.systemState.agentMessages,
            errors: data.errors ?? state.systemState.errors,
            lastUpdate: Date.now(),
          },
          pnlHistory: data.portfolio
            ? [...state.pnlHistory.slice(-99), makePnlPoint(data.portfolio)]
            : state.pnlHistory,
        }));
      })
      .catch(() => {});

    set((state) => ({
      systemState: {
        ...state.systemState,
        isRunning: newRunning,
        lastUpdate: Date.now(),
      },
    }));
  },

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
      await Promise.all([
        get().fetchStatus(),
        get().fetchRisk(),
        get().fetchStrategies(),
        get().fetchRBI(),
      ]);
      if (get().systemState.isRunning) {
        await get().fetchCycle();
      }
    } finally {
      set({ isLoading: false });
    }
  },
}));
