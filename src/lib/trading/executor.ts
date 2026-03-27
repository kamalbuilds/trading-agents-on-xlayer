// ============================================================
// Order Executor
// Routes trade signals to paper or live Kraken trading.
// Validates signals before execution and emits events.
// ============================================================

import { paperBuy, paperSell } from "@/lib/kraken/paper-trading";
import { ensureConnected } from "@/lib/kraken/mcp-client";
import { executeXLayerSignal } from "@/lib/xlayer";
import { tradingEvents } from "./events";
import type { TradeSignal, Order, OrderSide } from "@/lib/types";

export type ExecutionMode = "paper" | "live" | "xlayer";

interface ExecutorConfig {
  mode: ExecutionMode;
  minConfidence: number; // Minimum signal confidence to execute (0-1)
  maxSlippagePercent: number; // Max allowed slippage
  dryRun: boolean; // Log but don't execute
}

const defaultConfig: ExecutorConfig = {
  mode: "paper",
  minConfidence: 0.30,
  maxSlippagePercent: 1.0,
  dryRun: false,
};

let config: ExecutorConfig = { ...defaultConfig };

interface ModeTransition {
  from: ExecutionMode;
  to: ExecutionMode;
  timestamp: number;
  confirmedAt?: number;
}

const modeTransitionLog: ModeTransition[] = [];
let lastLiveModeActivation = 0;
const LIVE_MODE_COOLDOWN_MS = 5000;

export function configureExecutor(
  opts: Partial<ExecutorConfig>,
  confirmation?: string
): void {
  const newMode = opts.mode;
  const oldMode = config.mode;

  if (newMode && newMode !== oldMode && (newMode === "live")) {
    if (confirmation !== "CONFIRM") {
      throw new Error(
        "Switching to live mode requires confirmation. " +
        "Pass confirmation: 'CONFIRM' to proceed."
      );
    }

    const now = Date.now();
    const elapsed = now - lastLiveModeActivation;
    if (lastLiveModeActivation > 0 && elapsed < LIVE_MODE_COOLDOWN_MS) {
      throw new Error(
        `Live mode cooldown active. Wait ${Math.ceil((LIVE_MODE_COOLDOWN_MS - elapsed) / 1000)}s before switching again.`
      );
    }

    lastLiveModeActivation = now;
    modeTransitionLog.push({
      from: oldMode,
      to: newMode,
      timestamp: now,
      confirmedAt: now,
    });
    tradingEvents.emit("mode_switch", { from: oldMode, to: newMode, confirmed: true }, "executor");
  } else if (newMode && newMode !== oldMode) {
    modeTransitionLog.push({
      from: oldMode,
      to: newMode,
      timestamp: Date.now(),
    });
    tradingEvents.emit("mode_switch", { from: oldMode, to: newMode }, "executor");
  }

  config = { ...config, ...opts };
}

export function getExecutorConfig(): ExecutorConfig {
  return { ...config };
}

export function getModeTransitionLog(): ModeTransition[] {
  return [...modeTransitionLog];
}

export interface ExecutionResult {
  order: Order | null;
  status: "executed" | "rejected" | "dry_run" | "error";
  reason?: string;
  simulated?: boolean;
}

export async function executeSignal(signal: TradeSignal): Promise<ExecutionResult> {
  // Validate confidence threshold
  if (signal.confidence < config.minConfidence) {
    tradingEvents.emit("trade_signal", {
      ...signal,
      rejected: true,
      reason: `Confidence ${signal.confidence} below threshold ${config.minConfidence}`,
    }, "executor");
    return {
      order: null,
      status: "rejected",
      reason: `Confidence ${signal.confidence} below threshold ${config.minConfidence}`,
    };
  }

  tradingEvents.emitSignal(signal, "executor");

  if (config.dryRun) {
    console.log(`[DRY RUN] Would execute: ${signal.side} ${signal.amount} ${signal.pair}`);
    return { order: null, status: "dry_run", reason: "Dry run mode" };
  }

  let order: Order;
  if (config.mode === "xlayer") {
    order = await executeXLayerSignal(signal);
  } else if (config.mode === "paper") {
    order = await executePaper(signal);
    order.status = "filled";
    order.simulated = true;
  } else {
    order = await executeLive(signal);
  }

  tradingEvents.emitOrderPlaced(order, "executor");

  if (order.status === "filled") {
    tradingEvents.emitOrderFilled(order, "executor");
  }

  return {
    order,
    status: "executed",
    simulated: config.mode === "paper",
  };
}

export async function executeBatch(signals: TradeSignal[]): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];
  for (const signal of signals) {
    const result = await executeSignal(signal);
    results.push(result);
  }
  return results;
}

export async function cancelOrder(orderId: string): Promise<boolean> {
  if (config.mode === "paper" || config.mode === "xlayer") {
    // Paper trading doesn't have persistent open orders to cancel
    return true;
  }

  try {
    const client = await ensureConnected();
    await client.callTool("trade_cancel_order", { txid: orderId });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    tradingEvents.emitError(`Cancel failed for ${orderId}: ${message}`, "executor");
    return false;
  }
}

export async function cancelAllOrders(): Promise<boolean> {
  if (config.mode === "paper" || config.mode === "xlayer") return true;

  try {
    const client = await ensureConnected();
    await client.callTool("trade_cancel_all", {});
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    tradingEvents.emitError(`Cancel all failed: ${message}`, "executor");
    return false;
  }
}

// --- Convenience API (used by agent modules) ---

export async function placeOrder(
  pair: string,
  side: OrderSide,
  type: string,
  amount: number,
  price?: number
): Promise<Order | null> {
  const signal: TradeSignal = {
    id: `order-${Date.now()}`,
    strategy: "manual",
    pair,
    side,
    type: (type as TradeSignal["type"]) ?? "market",
    amount,
    price,
    confidence: 1,
    reasoning: "Direct order placement",
    timestamp: Date.now(),
  };
  const result = await executeSignal(signal);
  if (result.status === "error") throw new Error(result.reason);
  return result.order;
}

export async function placeStopLoss(
  pair: string,
  side: OrderSide,
  amount: number,
  stopPrice: number
): Promise<Order | null> {
  const signal: TradeSignal = {
    id: `stoploss-${Date.now()}`,
    strategy: "risk-management",
    pair,
    side,
    type: "stop-loss",
    amount,
    price: stopPrice,
    confidence: 1,
    reasoning: "Stop-loss order",
    timestamp: Date.now(),
  };
  const result = await executeSignal(signal);
  if (result.status === "error") throw new Error(result.reason);
  return result.order;
}

// --- Internal ---

async function executePaper(signal: TradeSignal): Promise<Order> {
  if (signal.side === "buy") {
    return paperBuy(signal.pair, signal.amount, signal.price);
  }
  return paperSell(signal.pair, signal.amount, signal.price);
}

async function executeLive(signal: TradeSignal): Promise<Order> {
  const client = await ensureConnected();

  const args: Record<string, unknown> = {
    pair: signal.pair,
    type: signal.side,
    ordertype: signal.type === "market" ? "market" : "limit",
    volume: signal.amount,
  };

  if (signal.price && signal.type !== "market") {
    args.price = signal.price;
  }

  // Add close orders for stop-loss/take-profit if metadata provides them
  if (signal.metadata?.stopLoss) {
    args["close[ordertype]"] = "stop-loss";
    args["close[price]"] = signal.metadata.stopLoss;
  }

  const raw = (await client.callTool("trade_add_order", args)) as Record<string, unknown>;
  const txids = (raw.txid ?? []) as string[];

  return {
    id: txids[0] ?? `live-${Date.now()}`,
    pair: signal.pair,
    side: signal.side,
    type: signal.type,
    price: Number(raw.price ?? signal.price ?? 0),
    amount: signal.amount,
    filled: 0,
    status: "pending",
    fee: 0,
    timestamp: Date.now(),
    strategy: signal.strategy,
  };
}
