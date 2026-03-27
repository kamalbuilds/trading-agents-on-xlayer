import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { MARKET_ANALYST_PROMPT } from "./prompts";
import type { MarketTicker, OHLC, OrderBook } from "@/lib/types";

export interface MarketAnalysis {
  pair: string;
  sentiment: "strongly_bullish" | "bullish" | "neutral" | "bearish" | "strongly_bearish";
  summary: string;
  technicals: {
    trend: string;
    support: number[];
    resistance: number[];
    indicators: Record<string, number>;
  };
  microstructure: {
    spreadBps: number;
    bookImbalance: number;
    volumeProfile: string;
  };
  alerts: string[];
  timestamp: number;
}

// Dynamic imports for trading modules (written by other agents)
async function fetchTicker(pair: string): Promise<MarketTicker | null> {
  try {
    const mod = await import("@/lib/kraken");
    if (mod.getTicker) return await mod.getTicker(pair);
    return null;
  } catch {
    return null;
  }
}

async function fetchOHLC(pair: string, interval?: number): Promise<OHLC[]> {
  try {
    const mod = await import("@/lib/kraken");
    if (mod.getOHLC) return await mod.getOHLC(pair, interval);
    return [];
  } catch {
    return [];
  }
}

async function fetchOrderBook(pair: string): Promise<OrderBook | null> {
  try {
    const mod = await import("@/lib/kraken");
    if (mod.getOrderBook) return await mod.getOrderBook(pair);
    return null;
  } catch {
    return null;
  }
}

export async function runMarketAnalyst(pair: string): Promise<MarketAnalysis> {
  const { text } = await generateText({
    model: "anthropic/claude-sonnet-4.6",
    system: MARKET_ANALYST_PROMPT,
    tools: {
      getTicker: tool({
        description: "Get current price ticker for a trading pair",
        inputSchema: z.object({
          pair: z.string().describe("Trading pair e.g. XBTUSD"),
        }),
        execute: async ({ pair }) => {
          const ticker = await fetchTicker(pair);
          if (!ticker) return { error: "Ticker unavailable", pair };
          return ticker;
        },
      }),
      getCandles: tool({
        description: "Get OHLC candle data for technical analysis",
        inputSchema: z.object({
          pair: z.string().describe("Trading pair"),
          interval: z.number().optional().describe("Candle interval in minutes (1, 5, 15, 60, 240, 1440)"),
        }),
        execute: async ({ pair, interval }) => {
          const candles = await fetchOHLC(pair, interval);
          if (!candles.length) return { error: "OHLC data unavailable", pair };
          return { pair, interval: interval ?? 60, candles: candles.slice(-50) };
        },
      }),
      getOrderBook: tool({
        description: "Get order book depth for microstructure analysis",
        inputSchema: z.object({
          pair: z.string().describe("Trading pair"),
        }),
        execute: async ({ pair }) => {
          const book = await fetchOrderBook(pair);
          if (!book) return { error: "Order book unavailable", pair };
          return {
            topBids: book.bids.slice(0, 10),
            topAsks: book.asks.slice(0, 10),
            bidDepth: book.bids.reduce((s, [, v]) => s + v, 0),
            askDepth: book.asks.reduce((s, [, v]) => s + v, 0),
          };
        },
      }),
    },
    stopWhen: stepCountIs(5),
    prompt: `Analyze the current market conditions for ${pair}.
Use the available tools to fetch real-time data, then provide a comprehensive analysis including:
1. Price action and trend direction
2. Key support/resistance levels
3. Technical indicator readings
4. Order book microstructure assessment
5. Any alerts or unusual activity

Return your analysis as JSON with this structure:
{
  "pair": "${pair}",
  "sentiment": "strongly_bullish|bullish|neutral|bearish|strongly_bearish",
  "summary": "brief market overview",
  "technicals": { "trend": "...", "support": [numbers], "resistance": [numbers], "indicators": {} },
  "microstructure": { "spreadBps": number, "bookImbalance": number, "volumeProfile": "..." },
  "alerts": ["any unusual observations"]
}`,
  });

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as MarketAnalysis;
    }
  } catch {
    // Fall through to default
  }

  return {
    pair,
    sentiment: "neutral",
    summary: text,
    technicals: { trend: "unknown", support: [], resistance: [], indicators: {} },
    microstructure: { spreadBps: 0, bookImbalance: 0, volumeProfile: "unknown" },
    alerts: [],
    timestamp: Date.now(),
  };
}
