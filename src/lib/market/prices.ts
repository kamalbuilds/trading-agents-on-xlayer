// Real price fetcher using CoinGecko free API (no API key needed)

import type { OHLC } from "@/lib/types";

export interface LivePrice {
  pair: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  timestamp: number;
}

const COINGECKO_IDS: Record<string, string> = {
  "BTC/USD": "bitcoin",
  "ETH/USD": "ethereum",
  "SOL/USD": "solana",
  "OKB/USD": "okb",
};

let priceCache: Record<string, LivePrice> = {};
let lastFetch = 0;
const CACHE_TTL = 10_000; // 10 seconds

export async function fetchLivePrices(): Promise<Record<string, LivePrice>> {
  const now = Date.now();
  if (now - lastFetch < CACHE_TTL && Object.keys(priceCache).length > 0) {
    return priceCache;
  }

  const ids = Object.values(COINGECKO_IDS).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();

    const result: Record<string, LivePrice> = {};
    for (const [pair, geckoId] of Object.entries(COINGECKO_IDS)) {
      const coin = data[geckoId];
      if (coin) {
        result[pair] = {
          pair,
          price: coin.usd ?? 0,
          change24h: coin.usd_24h_change ?? 0,
          high24h: 0,
          low24h: 0,
          volume24h: coin.usd_24h_vol ?? 0,
          timestamp: now,
        };
      }
    }

    priceCache = result;
    lastFetch = now;
    return result;
  } catch (err) {
    console.error("CoinGecko fetch failed:", err);
    if (Object.keys(priceCache).length > 0) return priceCache;
    throw err;
  }
}

export async function getPrice(pair: string): Promise<number> {
  const prices = await fetchLivePrices();
  return prices[pair]?.price ?? 0;
}

// Fetch OHLC candles with volume from CoinGecko market_chart endpoint
// Returns proper OHLC objects compatible with our strategy library
let ohlcCache: Record<string, { candles: OHLC[]; fetchedAt: number }> = {};
const OHLC_CACHE_TTL = 60_000; // 1 minute (OHLC doesn't change as fast)

export async function fetchOHLCHistory(
  geckoId: string,
  days: number = 7
): Promise<OHLC[]> {
  const cacheKey = `${geckoId}-${days}`;
  const cached = ohlcCache[cacheKey];
  if (cached && Date.now() - cached.fetchedAt < OHLC_CACHE_TTL) {
    return cached.candles;
  }

  // Use market_chart which returns prices + volumes (OHLC endpoint lacks volume)
  const url = `https://api.coingecko.com/api/v3/coins/${geckoId}/market_chart?vs_currency=usd&days=${days}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) throw new Error(`CoinGecko market_chart ${res.status}`);
  const data = await res.json();

  // data.prices: [[timestamp, price], ...]
  // data.total_volumes: [[timestamp, volume], ...]
  const prices: [number, number][] = data.prices ?? [];
  const volumes: [number, number][] = data.total_volumes ?? [];

  // Build volume lookup by timestamp (approximate match)
  const volumeMap = new Map<number, number>();
  for (const [ts, vol] of volumes) {
    volumeMap.set(Math.floor(ts / 3600000), vol); // hourly bucket
  }

  // Convert price points to OHLC candles (4-hour candles for strategy use)
  const candleDurationMs = 4 * 3600 * 1000; // 4 hours
  const candles: OHLC[] = [];
  let currentCandle: OHLC | null = null;

  for (const [ts, price] of prices) {
    const candleStart = Math.floor(ts / candleDurationMs) * candleDurationMs;
    const hourBucket = Math.floor(ts / 3600000);
    const vol = volumeMap.get(hourBucket) ?? 0;

    if (!currentCandle || currentCandle.time !== candleStart) {
      if (currentCandle) candles.push(currentCandle);
      currentCandle = {
        time: candleStart,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: vol,
      };
    } else {
      currentCandle.high = Math.max(currentCandle.high, price);
      currentCandle.low = Math.min(currentCandle.low, price);
      currentCandle.close = price;
      currentCandle.volume += vol;
    }
  }
  if (currentCandle) candles.push(currentCandle);

  ohlcCache[cacheKey] = { candles, fetchedAt: Date.now() };
  return candles;
}

// Map pair name to CoinGecko ID
export function pairToGeckoId(pair: string): string | undefined {
  return COINGECKO_IDS[pair];
}
