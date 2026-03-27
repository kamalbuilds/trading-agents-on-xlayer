// ============================================================
// Core Types for AI Trading Agent System
// ============================================================

// --- Market Data ---
export interface MarketTicker {
  pair: string;
  price: number;
  bid: number;
  ask: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  change24h: number;
  timestamp: number;
}

export interface OHLC {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderBook {
  bids: [number, number][]; // [price, volume]
  asks: [number, number][];
  timestamp: number;
}

// --- Trading ---
export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop-loss" | "take-profit" | "trailing-stop";
export type OrderStatus = "pending" | "open" | "filled" | "cancelled" | "expired";

export interface TradeSignal {
  id: string;
  strategy: string;
  pair: string;
  side: OrderSide;
  type: OrderType;
  price?: number;
  amount: number;
  confidence: number; // 0-1
  reasoning: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface Order {
  id: string;
  pair: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  amount: number;
  filled: number;
  status: OrderStatus;
  fee: number;
  timestamp: number;
  strategy?: string;
  simulated?: boolean;
}

export interface Position {
  pair: string;
  side: OrderSide;
  entryPrice: number;
  currentPrice: number;
  amount: number;
  unrealizedPnl: number;
  realizedPnl: number;
  openTime: number;
  strategy?: string;
}

// --- Portfolio ---
export interface PortfolioState {
  balance: number;
  equity: number;
  positions: Position[];
  openOrders: Order[];
  totalPnl: number;
  totalTrades: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  timestamp: number;
}

// --- Risk Management ---
export interface RiskLimits {
  maxPositionSize: number;      // % of portfolio per position
  maxDrawdown: number;          // % max drawdown before circuit breaker
  maxDailyLoss: number;         // % max daily loss
  maxOpenPositions: number;     // max concurrent positions
  maxLeverage: number;          // max leverage allowed
  stopLossPercent: number;      // default stop-loss %
  takeProfitPercent: number;    // default take-profit %
  maxCorrelation: number;       // max correlation between positions
  cooldownAfterLoss: number;    // seconds to wait after loss
}

export interface RiskAssessment {
  approved: boolean;
  adjustedSignal?: TradeSignal;
  reasons: string[];
  riskScore: number;  // 0-100
  positionSizeRecommended: number;
  stopLoss: number;
  takeProfit: number;
}

// --- Agent System ---
export type AgentRole = "strategist" | "risk_manager" | "market_analyst" | "executor" | "portfolio_manager";

export interface AgentMessage {
  role: AgentRole;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface AgentDecision {
  signal: TradeSignal | null;
  analysis: string;
  confidence: number;
  dissent?: string[];
  timestamp: number;
}

// --- Strategy ---
export type StrategyType =
  | "trend_following"
  | "mean_reversion"
  | "momentum"
  | "funding_rate_arb"
  | "statistical_arb"
  | "breakout"
  | "sentiment"
  | "evolved_trend"
  | "smart_money";

export interface StrategyConfig {
  name: string;
  type: StrategyType;
  pairs: string[];
  timeframe: string;
  allocation: number;  // % of portfolio allocated
  enabled: boolean;
  params: Record<string, number | string | boolean>;
}

export interface StrategyResult {
  strategy: string;
  signals: TradeSignal[];
  analysis: string;
  indicators: Record<string, number>;
  timestamp: number;
}

// --- System State ---
export interface SystemState {
  isRunning: boolean;
  mode: "paper" | "live" | "xlayer";
  portfolio: PortfolioState;
  activeStrategies: StrategyConfig[];
  riskLimits: RiskLimits;
  recentTrades: Order[];
  agentMessages: AgentMessage[];
  errors: string[];
  startTime: number;
  lastUpdate: number;
}

// --- Events ---
export type EventType =
  | "trade_signal"
  | "order_placed"
  | "order_filled"
  | "position_opened"
  | "position_closed"
  | "risk_alert"
  | "circuit_breaker"
  | "strategy_update"
  | "agent_message"
  | "system_error"
  | "mode_switch";

export interface TradingEvent {
  type: EventType;
  data: unknown;
  timestamp: number;
  source: string;
}
