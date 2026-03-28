import { NextRequest, NextResponse } from "next/server";
import { checkApiKey, unauthorized } from "@/lib/auth";
import {
  analyzeTrendFollowing,
  analyzeMeanReversion,
  analyzeMomentum,
  analyzeBreakout,
  analyzeEnsemble,
} from "@/lib/strategies";
import { getOHLC } from "@/lib/kraken/market-data";
import { fetchOHLCHistory } from "@/lib/market/prices";
import { standardToKraken } from "@/lib/utils/pairs";
import type { OHLC } from "@/lib/types";

async function getCandles(pair: string, interval: number): Promise<{ candles: OHLC[]; source: string }> {
  // Try Kraken first, fall back to CoinGecko
  try {
    const krakenPair = standardToKraken(pair);
    const candles = await getOHLC(krakenPair, interval);
    if (candles.length > 0) return { candles, source: "kraken" };
  } catch {
    // Kraken unavailable, fall through to CoinGecko
  }

  // CoinGecko fallback: map pair to gecko ID and fetch 14 days of 4h candles
  const geckoMap: Record<string, string> = {
    "BTC/USD": "bitcoin", "ETH/USD": "ethereum", "SOL/USD": "solana", "OKB/USD": "okb",
  };
  const geckoId = geckoMap[pair];
  if (geckoId) {
    const candles = await fetchOHLCHistory(geckoId, 14);
    if (candles.length > 0) return { candles, source: "coingecko" };
  }

  return { candles: [], source: "none" };
}

export async function GET(request: NextRequest) {
  if (!checkApiKey(request)) return unauthorized();

  try {
    const { candles, source } = await getCandles("BTC/USD", 60);

    if (!candles.length) {
      return NextResponse.json(
        { error: "No market data available from Kraken or CoinGecko" },
        { status: 503 }
      );
    }

    const ensemble = analyzeEnsemble({ candles });

    return NextResponse.json({
      status: "active",
      mode: "live_data",
      dataSource: source,
      candleCount: candles.length,
      ensemble: {
        consensus: ensemble.consensus,
        consensusStrength: ensemble.consensusStrength,
        signals: ensemble.aggregatedSignals,
        analysis: ensemble.analysis,
      },
      strategies: Object.fromEntries(
        Object.entries(ensemble.strategyResults).map(([name, result]) => [
          name,
          {
            analysis: result.analysis,
            signalCount: result.signals.length,
            indicators: result.indicators,
          },
        ])
      ),
      timestamp: Date.now(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Strategy analysis failed";
    return NextResponse.json(
      { error: msg, detail: "Both Kraken and CoinGecko data sources failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!checkApiKey(request)) return unauthorized();

  const body = await request.json();
  const { strategy, candles: rawCandles, pair, interval } = body as {
    strategy?: string;
    candles?: OHLC[];
    pair?: string;
    interval?: number;
  };

  try {
    // Use provided candles or fetch from Kraken/CoinGecko
    let candles: OHLC[];
    if (rawCandles && rawCandles.length > 0) {
      candles = rawCandles;
    } else {
      const result = await getCandles(pair ?? "BTC/USD", interval ?? 60);
      candles = result.candles;

      if (!candles.length) {
        return NextResponse.json(
          { error: `No OHLC data available for ${pair ?? "BTC/USD"}` },
          { status: 503 }
        );
      }
    }

    const cfg = { pair: pair ?? "BTC/USD" };

    let result;
    switch (strategy) {
      case "trend_following":
        result = analyzeTrendFollowing(candles, cfg);
        break;
      case "mean_reversion":
        result = analyzeMeanReversion(candles, cfg);
        break;
      case "momentum":
        result = analyzeMomentum(candles, cfg);
        break;
      case "breakout":
        result = analyzeBreakout(candles, cfg);
        break;
      case "ensemble":
      default:
        result = analyzeEnsemble({ candles }, cfg);
        break;
    }

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Strategy analysis failed";
    return NextResponse.json(
      { error: msg, detail: "Check Kraken MCP connection" },
      { status: 500 }
    );
  }
}
