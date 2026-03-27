// ============================================================
// Account Module
// Balance, trade history, open orders, and ledger queries
// via Kraken MCP.
// ============================================================

import { ensureConnected, KrakenMcpClient } from "./mcp-client";
import type { Order, OrderStatus, OrderSide, OrderType } from "@/lib/types";

export interface AccountBalance {
  currency: string;
  total: number;
  available: number;
  held: number;
}

async function getClient(): Promise<KrakenMcpClient> {
  return ensureConnected();
}

export async function getBalance(): Promise<AccountBalance[]> {
  const client = await getClient();
  const raw = (await client.callTool("account_balance", {})) as Record<string, unknown>;

  return Object.entries(raw).map(([currency, amount]) => ({
    currency,
    total: Number(amount),
    available: Number(amount), // Kraken separates in extended balance
    held: 0,
  }));
}

export async function getExtendedBalance(): Promise<AccountBalance[]> {
  const client = await getClient();
  const raw = (await client.callTool("account_balance_extended", {})) as Record<
    string,
    Record<string, string>
  >;

  return Object.entries(raw).map(([currency, balances]) => ({
    currency,
    total: Number(balances.balance ?? 0),
    available: Number(balances.available ?? balances.balance ?? 0),
    held: Number(balances.hold_trade ?? 0),
  }));
}

export async function getOpenOrders(): Promise<Order[]> {
  const client = await getClient();
  const raw = (await client.callTool("account_open_orders", {})) as Record<
    string,
    Record<string, unknown>
  >;

  return Object.entries(raw).map(([id, order]) => parseOrder(id, order));
}

export async function getClosedOrders(opts?: {
  start?: number;
  end?: number;
  offset?: number;
}): Promise<Order[]> {
  const client = await getClient();
  const args: Record<string, unknown> = {};
  if (opts?.start) args.start = opts.start;
  if (opts?.end) args.end = opts.end;
  if (opts?.offset) args.ofs = opts.offset;

  const raw = (await client.callTool("account_closed_orders", args)) as {
    closed?: Record<string, Record<string, unknown>>;
  };

  if (!raw?.closed) return [];

  return Object.entries(raw.closed).map(([id, order]) => parseOrder(id, order));
}

export async function getTradeHistory(opts?: {
  start?: number;
  end?: number;
  offset?: number;
}): Promise<Order[]> {
  const client = await getClient();
  const args: Record<string, unknown> = {};
  if (opts?.start) args.start = opts.start;
  if (opts?.end) args.end = opts.end;
  if (opts?.offset) args.ofs = opts.offset;

  const raw = (await client.callTool("account_trades_history", args)) as {
    trades?: Record<string, Record<string, unknown>>;
  };

  if (!raw?.trades) return [];

  return Object.entries(raw.trades).map(([id, trade]) => parseTradeToOrder(id, trade));
}

export async function queryOrders(txids: string[]): Promise<Order[]> {
  const client = await getClient();
  const raw = (await client.callTool("account_query_orders", {
    txid: txids.join(","),
  })) as Record<string, Record<string, unknown>>;

  return Object.entries(raw).map(([id, order]) => parseOrder(id, order));
}

// --- Parsers ---

function parseOrder(id: string, raw: Record<string, unknown>): Order {
  const descr = (raw.descr ?? {}) as Record<string, string>;
  return {
    id,
    pair: String(descr.pair ?? raw.pair ?? ""),
    side: parseSide(descr.type ?? (raw.type as string) ?? "buy"),
    type: parseOrderType(descr.ordertype ?? (raw.ordertype as string) ?? "market"),
    price: Number(raw.price ?? descr.price ?? 0),
    amount: Number(raw.vol ?? 0),
    filled: Number(raw.vol_exec ?? 0),
    status: parseStatus(String(raw.status ?? "pending")),
    fee: Number(raw.fee ?? 0),
    timestamp: Number(raw.opentm ?? raw.closetm ?? 0) * 1000,
    strategy: undefined,
  };
}

function parseTradeToOrder(id: string, raw: Record<string, unknown>): Order {
  return {
    id,
    pair: String(raw.pair ?? ""),
    side: parseSide(String(raw.type ?? "buy")),
    type: parseOrderType(String(raw.ordertype ?? "market")),
    price: Number(raw.price ?? 0),
    amount: Number(raw.vol ?? 0),
    filled: Number(raw.vol ?? 0),
    status: "filled",
    fee: Number(raw.fee ?? 0),
    timestamp: Number(raw.time ?? 0) * 1000,
    strategy: undefined,
  };
}

function parseSide(s: string): OrderSide {
  return s.toLowerCase() === "sell" ? "sell" : "buy";
}

function parseOrderType(s: string): OrderType {
  const map: Record<string, OrderType> = {
    market: "market",
    limit: "limit",
    "stop-loss": "stop-loss",
    "take-profit": "take-profit",
    "trailing-stop": "trailing-stop",
    "stop-loss-limit": "stop-loss",
    "take-profit-limit": "take-profit",
  };
  return map[s.toLowerCase()] ?? "market";
}

function parseStatus(s: string): OrderStatus {
  const map: Record<string, OrderStatus> = {
    pending: "pending",
    open: "open",
    closed: "filled",
    canceled: "cancelled",
    cancelled: "cancelled",
    expired: "expired",
  };
  return map[s.toLowerCase()] ?? "pending";
}
