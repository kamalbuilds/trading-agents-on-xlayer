// ============================================================
// Historical OHLC Ingestion
// Fetches 6-12 months of historical candles from Kraken OHLC API
// via MCP client, caches to disk as append-only JSON files.
// ============================================================

import { getOHLC } from "@/lib/kraken/market-data";
import type { OHLC } from "@/lib/types";
import * as fs from "fs";
import * as path from "path";

const CACHE_DIR = path.join(process.cwd(), "src/data/ohlc");

// Kraken pair mapping
const PAIR_MAP: Record<string, string> = {
  "BTC/USD": "XBTUSD",
  "ETH/USD": "ETHUSD",
  "SOL/USD": "SOLUSD",
};

interface CachedOHLC {
  pair: string;
  interval: number;
  lastTimestamp: number;
  candles: OHLC[];
}

function getCachePath(pair: string, interval: number): string {
  const safePair = pair.replace("/", "-");
  const intervalLabel = interval === 240 ? "4h" : `${interval}m`;
  return path.join(CACHE_DIR, `${safePair}_${intervalLabel}.json`);
}

function loadCache(pair: string, interval: number): CachedOHLC | null {
  const filePath = getCachePath(pair, interval);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as CachedOHLC;
  } catch {
    return null;
  }
}

function saveCache(data: CachedOHLC): void {
  const filePath = getCachePath(data.pair, data.interval);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Fetch historical OHLC candles from Kraken, paginating backward to get
 * the desired number of months. Caches to disk and only fetches the delta
 * on subsequent calls.
 *
 * Kraken returns up to 720 candles per request for 4h interval.
 * 6 months = ~1080 candles (4h), 12 months = ~2160 candles.
 */
export async function fetchHistoricalOHLC(
  pair: string,
  months: number = 6,
  interval: number = 240
): Promise<OHLC[]> {
  const krakenPair = PAIR_MAP[pair];
  if (!krakenPair) {
    throw new Error(`Unknown pair: ${pair}. Supported: ${Object.keys(PAIR_MAP).join(", ")}`);
  }

  const cached = loadCache(pair, interval);
  const now = Math.floor(Date.now() / 1000);
  const targetStart = now - months * 30 * 24 * 3600;

  // If we have a recent cache, only fetch the delta
  if (cached && cached.candles.length > 0) {
    const lastTs = cached.lastTimestamp;
    const cacheAge = now - lastTs;

    // If cache is fresh enough (within 2 candle periods), return as-is
    if (cacheAge < interval * 60 * 2) {
      return cached.candles;
    }

    // Fetch delta since last cached candle
    try {
      const delta = await getOHLC(krakenPair, interval, lastTs);
      if (delta.length > 0) {
        // Merge: remove overlap, append new
        const existingTimes = new Set(cached.candles.map((c) => c.time));
        const newCandles = delta.filter((c) => !existingTimes.has(c.time));
        cached.candles.push(...newCandles);
        cached.candles.sort((a, b) => a.time - b.time);
        cached.lastTimestamp = cached.candles[cached.candles.length - 1].time;
        saveCache(cached);
      }
      return cached.candles;
    } catch (err) {
      console.warn(`[historical-ohlc] Delta fetch failed, returning cache:`, err);
      return cached.candles;
    }
  }

  // No cache: paginate backward from now to targetStart
  console.log(`[historical-ohlc] Fetching ${months} months of ${pair} ${interval}m candles from Kraken...`);

  const allCandles: OHLC[] = [];
  const seenTimes = new Set<number>();
  let since = targetStart;
  let attempts = 0;
  const maxAttempts = 20; // safety limit

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const batch = await getOHLC(krakenPair, interval, since);
      if (batch.length === 0) break;

      // Merge with dedup using persistent Set
      const newCandles = batch.filter((c) => !seenTimes.has(c.time));
      if (newCandles.length === 0) break;

      for (const c of newCandles) seenTimes.add(c.time);
      allCandles.push(...newCandles);

      // Move since to after the last candle we got
      const lastBatchTime = batch[batch.length - 1].time;
      if (lastBatchTime >= now - interval * 60) break; // reached present
      since = lastBatchTime;

      // Yield between API calls
      await new Promise<void>((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(`[historical-ohlc] Fetch error at attempt ${attempts}:`, err);
      if (allCandles.length > 0) break; // return what we have
      throw err;
    }
  }

  allCandles.sort((a, b) => a.time - b.time);

  if (allCandles.length > 0) {
    const cacheData: CachedOHLC = {
      pair,
      interval,
      lastTimestamp: allCandles[allCandles.length - 1].time,
      candles: allCandles,
    };
    saveCache(cacheData);
    console.log(`[historical-ohlc] Cached ${allCandles.length} candles for ${pair}`);
  }

  return allCandles;
}

/**
 * Get cached candle count without fetching (for status display)
 */
export function getCachedCandleCount(pair: string, interval: number = 240): number {
  const cached = loadCache(pair, interval);
  return cached?.candles.length ?? 0;
}

/**
 * Get all cached pairs info
 */
export function getCacheStatus(): Record<string, { candles: number; lastUpdate: string }> {
  const status: Record<string, { candles: number; lastUpdate: string }> = {};
  for (const pair of Object.keys(PAIR_MAP)) {
    const cached = loadCache(pair, 240);
    if (cached) {
      status[pair] = {
        candles: cached.candles.length,
        lastUpdate: new Date(cached.lastTimestamp * 1000).toISOString(),
      };
    }
  }
  return status;
}
