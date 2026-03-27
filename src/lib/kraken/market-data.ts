// ============================================================
// Market Data Module
// Fetches ticker, OHLC, orderbook, and recent trades from
// Kraken via the MCP client.
// ============================================================

import { ensureConnected, KrakenMcpClient } from "./mcp-client";
import type { MarketTicker, OHLC, OrderBook } from "@/lib/types";

export interface RecentTrade {
  price: number;
  volume: number;
  time: number;
  side: "buy" | "sell";
  type: "market" | "limit";
}

async function getClient(): Promise<KrakenMcpClient> {
  return ensureConnected();
}

export async function getTicker(pair: string): Promise<MarketTicker> {
  const client = await getClient();
  const raw = (await client.callTool("market_ticker", { pair })) as Record<string, unknown>;

  const arr = (key: string, idx: number): unknown => {
    const val = raw[key];
    return Array.isArray(val) ? val[idx] : undefined;
  };

  return {
    pair,
    price: Number(raw.last ?? arr("c", 0) ?? 0),
    bid: Number(raw.bid ?? arr("b", 0) ?? 0),
    ask: Number(raw.ask ?? arr("a", 0) ?? 0),
    volume24h: Number(raw.volume ?? arr("v", 1) ?? 0),
    high24h: Number(raw.high ?? arr("h", 1) ?? 0),
    low24h: Number(raw.low ?? arr("l", 1) ?? 0),
    change24h: Number(raw.change ?? arr("p", 1) ?? 0),
    timestamp: Date.now(),
  };
}

export async function getTickers(pairs: string[]): Promise<MarketTicker[]> {
  return Promise.all(pairs.map((p) => getTicker(p)));
}

export async function getOHLC(
  pair: string,
  interval: number = 60,
  since?: number
): Promise<OHLC[]> {
  const client = await getClient();
  const args: Record<string, unknown> = { pair, interval };
  if (since) args.since = since;

  const raw = (await client.callTool("market_ohlc", args)) as unknown[];

  if (!Array.isArray(raw)) return [];

  return raw.map((candle: unknown) => {
    const c = candle as (string | number)[];
    return {
      time: Number(c[0]),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[6] ?? c[5]),
    };
  });
}

export async function getOrderBook(
  pair: string,
  count: number = 25
): Promise<OrderBook> {
  const client = await getClient();
  const raw = (await client.callTool("market_order_book", {
    pair,
    count,
  })) as Record<string, unknown>;

  const parseLevels = (levels: unknown): [number, number][] => {
    if (!Array.isArray(levels)) return [];
    return levels.map((l: unknown) => {
      const level = l as (string | number)[];
      return [Number(level[0]), Number(level[1])] as [number, number];
    });
  };

  return {
    bids: parseLevels(raw.bids),
    asks: parseLevels(raw.asks),
    timestamp: Date.now(),
  };
}

export async function getRecentTrades(
  pair: string,
  since?: number
): Promise<RecentTrade[]> {
  const client = await getClient();
  const args: Record<string, unknown> = { pair };
  if (since) args.since = since;

  const raw = (await client.callTool("market_trades", args)) as unknown[];

  if (!Array.isArray(raw)) return [];

  return raw.map((t: unknown) => {
    const trade = t as (string | number)[];
    return {
      price: Number(trade[0]),
      volume: Number(trade[1]),
      time: Number(trade[2]),
      side: trade[3] === "b" ? ("buy" as const) : ("sell" as const),
      type: trade[4] === "m" ? ("market" as const) : ("limit" as const),
    };
  });
}

export async function getSpread(pair: string): Promise<{ bid: number; ask: number; spread: number }> {
  const ticker = await getTicker(pair);
  return {
    bid: ticker.bid,
    ask: ticker.ask,
    spread: ticker.ask - ticker.bid,
  };
}
