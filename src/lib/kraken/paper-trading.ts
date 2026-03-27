// ============================================================
// Paper Trading Module
// Uses Kraken CLI's built-in paper trading sandbox.
// No API keys required, uses live market prices, 0.26% taker fee.
// ============================================================

import { ensureConnected, KrakenMcpClient } from "./mcp-client";
import type { Order, OrderSide, Position } from "@/lib/types";

export interface PaperAccount {
  balances: Record<string, number>;
  openOrders: PaperOrder[];
  tradeHistory: PaperOrder[];
}

export interface PaperOrder {
  id: string;
  pair: string;
  side: OrderSide;
  price: number;
  amount: number;
  fee: number;
  timestamp: number;
  status: string;
}

async function getClient(): Promise<KrakenMcpClient> {
  return ensureConnected();
}

export async function initPaperTrading(
  startingBalance?: number
): Promise<PaperAccount> {
  const client = await getClient();
  const args: Record<string, unknown> = {};
  if (startingBalance) args.balance = startingBalance;

  const raw = (await client.callTool("paper_init", args)) as Record<string, unknown>;

  return parsePaperAccount(raw);
}

export async function paperBuy(
  pair: string,
  amount: number,
  price?: number
): Promise<Order> {
  const client = await getClient();
  const args: Record<string, unknown> = { pair, volume: amount };
  if (price) args.price = price;

  const raw = (await client.callTool("paper_buy", args)) as Record<string, unknown>;

  const executedPrice = Number(raw.price ?? price ?? 0);
  const executedAmount = Number(raw.vol_exec ?? amount);

  return {
    id: String(raw.txid ?? raw.id ?? `paper-${Date.now()}`),
    pair,
    side: "buy",
    type: price ? "limit" : "market",
    price: executedPrice,
    amount,
    filled: executedAmount,
    status: "filled",
    fee: Number(raw.fee ?? executedAmount * executedPrice * 0.0026),
    timestamp: Date.now(),
  };
}

export async function paperSell(
  pair: string,
  amount: number,
  price?: number
): Promise<Order> {
  const client = await getClient();
  const args: Record<string, unknown> = { pair, volume: amount };
  if (price) args.price = price;

  const raw = (await client.callTool("paper_sell", args)) as Record<string, unknown>;

  const executedPrice = Number(raw.price ?? price ?? 0);
  const executedAmount = Number(raw.vol_exec ?? amount);

  return {
    id: String(raw.txid ?? raw.id ?? `paper-${Date.now()}`),
    pair,
    side: "sell",
    type: price ? "limit" : "market",
    price: executedPrice,
    amount,
    filled: executedAmount,
    status: "filled",
    fee: Number(raw.fee ?? executedAmount * executedPrice * 0.0026),
    timestamp: Date.now(),
  };
}

export async function getPaperStatus(): Promise<PaperAccount> {
  const client = await getClient();
  const raw = (await client.callTool("paper_status", {})) as Record<string, unknown>;
  return parsePaperAccount(raw);
}

export async function getPaperHistory(): Promise<PaperOrder[]> {
  const client = await getClient();
  const raw = (await client.callTool("paper_history", {})) as unknown[];

  if (!Array.isArray(raw)) return [];

  return raw.map((t: unknown) => {
    const trade = t as Record<string, unknown>;
    return {
      id: String(trade.id ?? trade.txid ?? ""),
      pair: String(trade.pair ?? ""),
      side: (String(trade.type ?? trade.side ?? "buy").toLowerCase() === "sell"
        ? "sell"
        : "buy") as OrderSide,
      price: Number(trade.price ?? 0),
      amount: Number(trade.vol ?? trade.amount ?? 0),
      fee: Number(trade.fee ?? 0),
      timestamp: Number(trade.time ?? trade.timestamp ?? 0) * 1000 || Date.now(),
      status: String(trade.status ?? "filled"),
    };
  });
}

export async function getPaperPositions(): Promise<Position[]> {
  const status = await getPaperStatus();
  const positions: Position[] = [];

  // Derive positions from balances (non-USD assets with value)
  for (const [currency, amount] of Object.entries(status.balances)) {
    if (currency === "USD" || currency === "ZUSD" || amount <= 0) continue;

    // We track positions at the portfolio level; this returns raw holdings
    positions.push({
      pair: `${currency}/USD`,
      side: "buy",
      entryPrice: 0, // Set by portfolio tracker
      currentPrice: 0,
      amount,
      unrealizedPnl: 0,
      realizedPnl: 0,
      openTime: Date.now(),
    });
  }

  return positions;
}

export async function resetPaperTrading(): Promise<PaperAccount> {
  const client = await getClient();
  const raw = (await client.callTool("paper_reset", {})) as Record<string, unknown>;
  return parsePaperAccount(raw);
}

// --- Parser ---

function parsePaperAccount(raw: Record<string, unknown>): PaperAccount {
  const balances: Record<string, number> = {};
  const rawBalances = (raw.balances ?? raw.balance ?? {}) as Record<string, unknown>;

  for (const [k, v] of Object.entries(rawBalances)) {
    balances[k] = Number(v);
  }

  return {
    balances,
    openOrders: [],
    tradeHistory: [],
  };
}
